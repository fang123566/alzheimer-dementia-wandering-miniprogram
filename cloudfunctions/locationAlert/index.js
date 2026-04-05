// cloudfunctions/locationAlert/index.js
// 依赖：在此云函数目录下 npm install @alicloud/pop-core

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const Core = require('@alicloud/pop-core')

// ─── 阿里云短信配置（建议存云函数环境变量，不要硬编码）───────
const ALI_SMS = {
  accessKeyId:     'YOUR_ACCESS_KEY_ID',
  accessKeySecret: 'YOUR_ACCESS_KEY_SECRET',
  signName:        '你的短信签名',       // 阿里云审核通过的签名
  templateCode:    'SMS_XXXXXXXXX',    // 阿里云模板Code
  // 模板示例：${name}的老人${reason}，请立即查看！
}

// ─── 可配置阈值 ──────────────────────────────────────────────
const CONFIG = {
  STAY_TIMEOUT_MIN:   30,
  STAY_RADIUS_M:      50,
  WANDER_TIMES:       4,
  WANDER_RADIUS_M:    150,
  ALERT_COOLDOWN_MIN: 20,
  HISTORY_LIMIT:      30,
}

// ─── 主入口 ──────────────────────────────────────────────────
exports.main = async (event, context) => {
  const { openid, latitude, longitude, accuracy, timestamp } = event

  // 兼容你 locationUpdate 里的字段名
  const lat = latitude
  const lng = longitude

  if (!openid || !lat || !lng) {
    return { code: 1, msg: '参数缺失：需要 openid / latitude / longitude' }
  }

  const pointTime = timestamp || Date.now()

  // 1. 写轨迹（你的 locationUpdate 里已写 trajectories，这里可选择不重复写）
  //    如果 locationAlert 单独调用，则写入
  await db.collection('trajectories').add({
    data: {
      openid, latitude: lat, longitude: lng,
      accuracy: accuracy || 0,
      recordedAt: db.serverDate(),
      dateStr: new Date().toISOString().slice(0, 10)
    }
  })

  // 2. 拉最近历史轨迹
  const { data: history } = await db.collection('trajectories')
    .where({ openid: _.eq(openid) })
    .orderBy('recordedAt', 'desc')
    .limit(CONFIG.HISTORY_LIMIT)
    .get()

  const currentPoint = { lat, lng, time: pointTime }

  // 3. 并行执行三项检测
  const [zoneResult, stayResult, wanderResult] = await Promise.all([
    checkGeofence(currentPoint, openid),
    checkLongStay(currentPoint, history),
    checkWandering(currentPoint, history),
  ])

  // 4. 合并预警，按优先级排序
  const alerts = [zoneResult, stayResult, wanderResult].filter(r => r.alerted)
  alerts.sort((a, b) => b.level - a.level)

  if (alerts.length === 0) {
    return { code: 0, alerted: false, msg: '轨迹正常' }
  }

  const topAlert = alerts[0]

  // 5. 冷却期检查
  const canPush = await checkCooldown(openid, topAlert.type)
  if (!canPush) {
    return { code: 0, alerted: false, msg: '冷却期内，跳过推送' }
  }

  // 6. 获取家属手机号（通过 bindings 表找 family）
  const { data: bindList } = await db.collection('bindings')
    .where({ toOpenid: _.eq(openid) })
    .get()
  const familyOpenids = bindList.map(b => b.fromOpenid).filter(Boolean)
  let familyList = []
  if (familyOpenids.length) {
    const { data: fam } = await db.collection('family')
      .where({ _openid: _.in(familyOpenids) })
      .get()
    familyList = fam
  }

  // 7. 发送短信
  const smsResults = await sendSmsAlerts(familyList, topAlert, openid)

  // 8. 写告警记录到 location_alerts
  const category = alertTypeToCategory(topAlert.type)
  await db.collection('location_alerts').add({
    data: {
      openid,
      type:      topAlert.type,
      category,                         // fence/lost/health 等，对应前端 filter
      level:     topAlert.level,
      reason:    topAlert.reason,
      latitude:  lat,
      longitude: lng,
      read:      false,
      notified:  familyList.length,
      createdAt: db.serverDate(),
    }
  })

  return {
    code:       0,
    alerted:    true,
    level:      topAlert.level,
    type:       topAlert.type,
    reason:     topAlert.reason,
    smsResults
  }
}

// ─── type → 前端 category 映射 ─────────────────────────────
function alertTypeToCategory(type) {
  const map = { GEOFENCE: 'fence', LONG_STAY: 'health', WANDERING: 'lost' }
  return map[type] || 'fence'
}

// ─── 检测1：越界（高危 level=3）─────────────────────────────
async function checkGeofence(current, openid) {
  // 从你的 fences 集合读取，字段：latitude/longitude/radius/name/enabled
  const { data: fences } = await db.collection('fences')
    .where({ ownerOpenid: _.eq(openid), enabled: _.eq(true) })
    .get()

  if (!fences || fences.length === 0) return { alerted: false }

  let outsideFence = null
  let maxDist = 0

  fences.forEach(fence => {
    const dist = distanceM(current.lat, current.lng, fence.latitude, fence.longitude)
    if (dist > fence.radius && dist > maxDist) {
      maxDist = dist
      outsideFence = { ...fence, dist }
    }
  })

  if (outsideFence) {
    return {
      alerted: true,
      level:   3,
      type:    'GEOFENCE',
      reason:  `老人已离开"${outsideFence.name || '安全区域'}"，距边界约 ${Math.round(outsideFence.dist - outsideFence.radius)} 米`
    }
  }
  return { alerted: false }
}

// ─── 检测2：长时间停留（中危 level=2）───────────────────────
async function checkLongStay(current, history) {
  if (history.length < 2) return { alerted: false }

  let earliestSameSpot = null
  for (const point of history) {
    // trajectories 里存的是 latitude/longitude，注意字段名
    const d = distanceM(current.lat, current.lng, point.latitude, point.longitude)
    if (d <= CONFIG.STAY_RADIUS_M) {
      earliestSameSpot = point
    } else {
      break
    }
  }

  if (!earliestSameSpot) return { alerted: false }

  // recordedAt 是 serverDate 对象，取毫秒
  const stayMs = current.time - new Date(earliestSameSpot.recordedAt).getTime()
  const stayMin = stayMs / 60000

  if (stayMin >= CONFIG.STAY_TIMEOUT_MIN) {
    return {
      alerted: true,
      level:   2,
      type:    'LONG_STAY',
      reason:  `老人已在同一地点停留约 ${Math.round(stayMin)} 分钟，请确认状态`
    }
  }
  return { alerted: false }
}

// ─── 检测3：徘徊（低危 level=1）─────────────────────────────
async function checkWandering(current, history) {
  if (history.length < CONFIG.WANDER_TIMES) return { alerted: false }

  const recent = history.slice(0, CONFIG.WANDER_TIMES)

  // 都在小范围内
  const allNearby = recent.every(p =>
    distanceM(current.lat, current.lng, p.latitude, p.longitude) <= CONFIG.WANDER_RADIUS_M
  )
  if (!allNearby) return { alerted: false }

  // 方向变化次数
  const points = [
    current,
    ...recent.map(p => ({ lat: p.latitude, lng: p.longitude, time: new Date(p.recordedAt).getTime() }))
  ].reverse()

  let directionChanges = 0
  for (let i = 1; i < points.length - 1; i++) {
    const bear1 = bearing(points[i - 1], points[i])
    const bear2 = bearing(points[i], points[i + 1])
    const diff = Math.abs(bear1 - bear2) % 360
    if (diff > 90 && diff < 270) directionChanges++
  }

  if (directionChanges >= 2) {
    const rangeMin = Math.round(
      (current.time - new Date(recent[recent.length - 1].recordedAt).getTime()) / 60000
    )
    return {
      alerted: true,
      level:   1,
      type:    'WANDERING',
      reason:  `老人在 ${CONFIG.WANDER_RADIUS_M} 米范围内来回约 ${rangeMin} 分钟，疑似迷路`
    }
  }
  return { alerted: false }
}

// ─── 冷却期 ──────────────────────────────────────────────────
async function checkCooldown(openid, type) {
  const since = new Date(Date.now() - CONFIG.ALERT_COOLDOWN_MIN * 60 * 1000)
  const { data } = await db.collection('location_alerts')
    .where({
      openid: _.eq(openid),
      type:   _.eq(type),
      createdAt: _.gte(since)
    })
    .limit(1)
    .get()
  return data.length === 0
}

// ─── 阿里云短信发送 ──────────────────────────────────────────
async function sendSmsAlerts(familyList, alert, openid) {
  if (!familyList.length) return []

  // family 表结构假设字段：phone（手机号）、name（家属姓名）、elderlyName（老人名字）
  const client = new Core({
    accessKeyId:     ALI_SMS.accessKeyId,
    accessKeySecret: ALI_SMS.accessKeySecret,
    endpoint:        'https://dysmsapi.aliyuncs.com',
    apiVersion:      '2017-05-25'
  })

  const levelText = { 3: '高危', 2: '中危', 1: '注意' }

  const results = await Promise.allSettled(
    familyList
      .filter(m => m.phone)   // 过滤没有手机号的记录
      .map(member =>
        client.request('SendSms', {
          PhoneNumbers:  member.phone,
          SignName:      ALI_SMS.signName,
          TemplateCode:  ALI_SMS.templateCode,
          // 模板变量，需和阿里云模板参数名对应
          // 示例模板："${name}您好，${elderlyName}${reason}（${level}），请立即处理！"
          TemplateParam: JSON.stringify({
            name:        member.name        || '家属',
            elderlyName: member.elderlyName || '老人',
            reason:      alert.reason.slice(0, 30),  // 短信有字数限制
            level:       levelText[alert.level] || '异常'
          })
        }, { method: 'POST' })
      )
  )

  return results.map((r, i) => ({
    phone:  familyList[i]?.phone,
    status: r.status,
    error:  r.reason?.message || r.value?.Message
  }))
}

// ─── 工具函数 ────────────────────────────────────────────────
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function bearing(p1, p2) {
  const dLng = rad(p2.lng - p1.lng)
  const y = Math.sin(dLng) * Math.cos(rad(p2.lat))
  const x = Math.cos(rad(p1.lat)) * Math.sin(rad(p2.lat)) -
    Math.sin(rad(p1.lat)) * Math.cos(rad(p2.lat)) * Math.cos(dLng)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

function rad(deg) { return deg * Math.PI / 180 }