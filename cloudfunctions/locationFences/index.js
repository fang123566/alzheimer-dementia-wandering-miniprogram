// cloudfunctions/locationFences/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
/** 在 elderly + family 两个集合中查找用户 */
async function findUser(openid) {
  const [eSnap, fSnap] = await Promise.all([
    db.collection('elderly').where({ _openid: openid }).limit(1).get(),
    db.collection('family').where({ _openid: openid }).limit(1).get()
  ])
  if (eSnap.data.length) return { ...eSnap.data[0], role: 'elderly' }
  if (fSnap.data.length) return { ...fSnap.data[0], role: 'family' }
  return null
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
    if (elders.length && elders[0]._openid) {
      await db.collection('bindings').doc(binding._id)
        .update({ data: { toOpenid: elders[0]._openid } }).catch(() => {})
      return elders[0]._openid
    }
  }
  return null
}
function asNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v)
  return Number.isFinite(n) ? n : NaN
}
function normalizeFenceDoc(doc) {
  return {
    id:        doc._id,
    name:      doc.name || '围栏',
    placeType: doc.placeType || '',
    latitude:  doc.latitude,
    longitude: doc.longitude,
    radius:    doc.radius,
    enabled:   doc.enabled !== false,
    createdAt: doc.createdAt
  }
}
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  try {
    const user = await findUser(OPENID)
    if (!user) return { code: 1, msg: '用户不存在' }
    const action = event?.action || 'list'
    let targetOpenid = OPENID
    if (user.role === 'family') {
      const eid = await findElderlyOpenid(OPENID)
      if (!eid) return { code: 1, msg: '未绑定老人账号' }
      targetOpenid = eid
    }
    // ── 列表 ─────────────────────────────────────────
    if (action === 'list' || action === 'get') {
      const snap = await db.collection('fences')
        .where({ ownerOpenid: targetOpenid })
        .orderBy('createdAt', 'desc')
        .get()
      return { code: 0, data: (snap.data || []).map(normalizeFenceDoc) }
    }

    // 只允许家属端管理围栏（新增/修改/删除/开关）
    if (user.role !== 'family') {
      return { code: 403, msg: '仅家属端可管理安全围栏' }
    }
    // ── 新增 ─────────────────────────────────────────
    if (action === 'add') {
      const name = String(event?.name || '').trim()
      const placeType = String(event?.placeType || '').trim()
      const latitude  = asNumber(event?.latitude)
      const longitude = asNumber(event?.longitude)
      const radius    = asNumber(event?.radius)
      if (!name) return { code: 1, msg: '请输入围栏名称' }
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { code: 1, msg: '缺少有效经纬度' }
      if (!Number.isFinite(radius) || radius <= 10) return { code: 1, msg: '半径需大于 10 米' }
      const now = db.serverDate()
      const doc = {
        ownerOpenid: targetOpenid,
        name,
        placeType,
        latitude,
        longitude,
        radius: Math.round(radius),
        enabled: event?.enabled === false ? false : true,
        createdAt: now,
        updatedAt: now
      }
      const addRes = await db.collection('fences').add({ data: doc })
      return { code: 0, data: { id: addRes._id, ...doc } }
    }
    // ── 开关 / 修改 ──────────────────────────────────
    if (action === 'toggle' || action === 'update') {
      const fenceId = String(event?.fenceId || '').trim()
      if (!fenceId) return { code: 1, msg: '缺少 fenceId' }
      const update = { updatedAt: db.serverDate() }
      if (event?.enabled !== undefined) update.enabled = !!event.enabled
      if (action === 'update') {
        if (event?.name !== undefined) {
          const nm = String(event.name || '').trim()
          if (!nm) return { code: 1, msg: '围栏名称不能为空' }
          update.name = nm
        }
        if (event?.placeType !== undefined) {
          update.placeType = String(event.placeType || '').trim()
        }
        if (event?.radius !== undefined) {
          const r = asNumber(event.radius)
          if (!Number.isFinite(r) || r <= 10) return { code: 1, msg: '半径需大于 10 米' }
          update.radius = Math.round(r)
        }
        if (event?.latitude !== undefined) {
          const lat = asNumber(event.latitude)
          if (!Number.isFinite(lat)) return { code: 1, msg: 'latitude 无效' }
          update.latitude = lat
        }
        if (event?.longitude !== undefined) {
          const lng = asNumber(event.longitude)
          if (!Number.isFinite(lng)) return { code: 1, msg: 'longitude 无效' }
          update.longitude = lng
        }
      }
      // 安全校验：必须是当前绑定老人（或本人）的围栏
      const fenceSnap = await db.collection('fences').doc(fenceId).get()
      const fence = fenceSnap?.data
      if (!fence) return { code: 1, msg: '围栏不存在' }
      if (fence.ownerOpenid !== targetOpenid) return { code: 403, msg: '无权限操作该围栏' }
      await db.collection('fences').doc(fenceId).update({ data: update })
      const newSnap = await db.collection('fences').doc(fenceId).get()
      return { code: 0, data: normalizeFenceDoc(newSnap.data) }
    }
    // ── 删除 ─────────────────────────────────────────
    if (action === 'delete') {
      const fenceId = String(event?.fenceId || '').trim()
      if (!fenceId) return { code: 1, msg: '缺少 fenceId' }
      const fenceSnap = await db.collection('fences').doc(fenceId).get()
      const fence = fenceSnap?.data
      if (!fence) return { code: 1, msg: '围栏不存在' }
      if (fence.ownerOpenid !== targetOpenid) return { code: 403, msg: '无权限操作该围栏' }
      await db.collection('fences').doc(fenceId).remove()
      return { code: 0, msg: '已删除' }
    }
    return { code: -1, msg: '未知 action' }
  } catch (e) {
    console.error('[locationFences]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}