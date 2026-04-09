// cloudfunctions/locationUpdate/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function writeLocationAlert({ openid, type, category, level, reason, latitude, longitude }) {
  // 冷却：同类型 20 分钟内不重复写
  const since = new Date(Date.now() - 20 * 60 * 1000)
  const { data } = await db.collection('location_alerts')
      .where({
        openid: _.eq(openid),
        type: _.eq(type),
        createdAt: _.gte(since)
      })
      .limit(1)
      .get()
      .catch(() => ({ data: [] }))

  if (data && data.length) {
    console.log('[预警] 冷却期内，跳过重复预警:', type)
    return
  }

  const now = db.serverDate()
  await db.collection('location_alerts').add({
    data: {
      openid,
      type,
      category,
      level,
      reason,
      latitude,
      longitude,
      location: '',
      phone: '',
      content: reason,
      read: false,
      createdAt: now
    }
  })

  console.log('[预警] 成功写入预警记录:', { type, level, reason })
}

/** 家属端查绑定的老人 openid */
async function findElderlyOpenid(familyOpenid) {
  const { data } = await db.collection('bindings')
      .where({ fromOpenid: familyOpenid })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get()
  if (!data.length) return null
  const binding = data[0]
  if (binding.toOpenid) return binding.toOpenid
  if (binding.toPhone) {
    const { data: elders } = await db.collection('elderly')
        .where({ phone: binding.toPhone }).limit(1).get()
    if (elders.length) {
      const eid = elders[0].openid || elders[0]._openid || ''
      if (eid) {
        await db.collection('bindings').doc(binding._id)
            .update({ data: { toOpenid: eid } }).catch(() => {})
        return eid
      }
    }
  }
  return null
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || '获取失败'

  console.log('=====================================')
  console.log('当前用户 OPENID：', openid)
  console.log('=====================================')

  const { latitude, longitude, address, distance } = event
  if (!latitude || !longitude) {
    return { code: 1, msg: '缺少经纬度参数' }
  }

  try {
    // 先判断调用者是老人还是家属
    let targetOpenid = openid
    const [elderlySnap, elderlySnap2] = await Promise.all([
      db.collection('elderly').where({ _openid: openid }).get(),
      db.collection('elderly').where({ openid }).get()
    ])
    const elderlyDoc = elderlySnap.data[0] || elderlySnap2.data[0]
    if (elderlyDoc) {
      // 老人端直接上报
      targetOpenid = openid
    } else {
      // 尝试作为家属端：查找绑定的老人
      const [familySnap, familySnap2] = await Promise.all([
        db.collection('family').where({ _openid: openid }).get(),
        db.collection('family').where({ openid }).get()
      ])
      const familyDoc = familySnap.data[0] || familySnap2.data[0]
      if (familyDoc) {
        const eid = await findElderlyOpenid(openid)
        if (!eid) {
          return { code: 1, msg: '未绑定老人账号，无法刷新位置' }
        }
        targetOpenid = eid
        console.log('[locationUpdate] 家属代替老人上报, elderlyOpenid:', eid)
      } else {
        return {
          code: 1,
          msg: '用户不存在',
          currentOpenid: openid,
          tip: '请先注册账号'
        }
      }
    }

    // 判断围栏状态
    const fenceSnap = await db.collection('fences')
        .where({ ownerOpenid: targetOpenid, enabled: true })
        .get()

    let status = 'safe'
    let minDistance = Infinity

    console.log('[围栏检测] 围栏数量:', fenceSnap.data.length)

    fenceSnap.data.forEach(fence => {
      const dist = getDistanceMeters(latitude, longitude, fence.latitude, fence.longitude)
      console.log('[围栏检测] 围栏:', fence.name, '距离:', dist.toFixed(0), '米, 半径:', fence.radius, '米')

      if (dist < minDistance) minDistance = dist
      if (dist > fence.radius) {
        status = status === 'safe' ? 'warning' : status
        if (dist > fence.radius * 1.5) status = 'emergency'
      }
    })

    console.log('[围栏检测] 最终状态:', status)

    const now = db.serverDate()
    const locData = {
      openid: targetOpenid,
      latitude,
      longitude,
      address: address || '',
      distance: minDistance === Infinity ? (distance || 0) : Math.round(minDistance),
      status,
      updatedAt: now
    }

    // upsert：有记录则更新，无则新建
    const existSnap = await db.collection('locations')
        .where({ openid: targetOpenid })
        .limit(1)
        .get()

    if (existSnap.data.length) {
      await db.collection('locations').doc(existSnap.data[0]._id).update({ data: locData })
    } else {
      locData.createdAt = now
      await db.collection('locations').add({ data: locData })
    }

    // 同时写一条轨迹记录
    await db.collection('trajectories').add({
      data: {
        openid: targetOpenid,
        latitude,
        longitude,
        address: address || '',
        recordedAt: now,
        dateStr: new Date().toISOString().slice(0, 10)
      }
    })

    // 位置预警写入（围栏越界）
    if (fenceSnap.data && fenceSnap.data.length) {
      if (status === 'warning') {
        console.log('[预警] 触发轻微越界预警')
        await writeLocationAlert({
          openid: targetOpenid,
          type: 'GEOFENCE',
          category: 'fence',
          level: 2,
          reason: '老人已离开安全区域（轻微越界）',
          latitude,
          longitude
        })
        // 异步调用 locationAlert 发送短信通知给家属（不阻塞返回）
        callLocationAlert(targetOpenid, latitude, longitude).catch(e => console.error('[locationAlert] 调用失败:', e))
      }
      if (status === 'emergency') {
        console.log('[预警] 触发紧急越界预警')
        await writeLocationAlert({
          openid: targetOpenid,
          type: 'GEOFENCE',
          category: 'fence',
          level: 3,
          reason: '老人已明显离开安全区域（紧急越界）',
          latitude,
          longitude
        })
        // 异步调用 locationAlert 发送短信通知给家属（不阻塞返回）
        callLocationAlert(targetOpenid, latitude, longitude).catch(e => console.error('[locationAlert] 调用失败:', e))
      }
    }

    return {
      code: 0,
      data: {
        latitude,
        longitude,
        address: address || '',
        status,
        distance: locData.distance,
        updatedAt: new Date().toISOString()
      }
    }
  } catch (e) {
    console.error('[locationUpdate]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}

/**
 * 调用 locationAlert 云函数发送短信通知
 * 注意：locationAlert 需要安装 @alicloud/pop-core 依赖
 */
async function callLocationAlert(openid, latitude, longitude) {
  console.log('[callLocationAlert] 调用 locationAlert 云函数:', { openid, latitude, longitude })
  try {
    const res = await cloud.callFunction({
      name: 'locationAlert',
      data: {
        openid,
        latitude,
        longitude,
        accuracy: 0,
        timestamp: Date.now()
      }
    })
    console.log('[callLocationAlert] locationAlert 返回:', res.result)
    return res.result
  } catch (e) {
    console.error('[callLocationAlert] 调用失败:', e)
    throw e
  }
}

/** Haversine 距离（米） */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
