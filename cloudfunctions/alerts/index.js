const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const COL_ALERTS = 'alerts'                 // AI 反诈等
const COL_LOC_ALERTS = 'location_alerts'    // 位置预警
async function findUser(openid) {
  const [eSnap, fSnap] = await Promise.all([
    db.collection('elderly').where({ _openid: openid }).limit(1).get(),
    db.collection('family').where({ _openid: openid }).limit(1).get()
  ])
  if (eSnap.data.length) return { ...eSnap.data[0], role: 'elderly' }
  if (fSnap.data.length) return { ...fSnap.data[0], role: 'family' }
  return null
}
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
function levelNumToClass(n) {
  if (n >= 3) return 'danger'
  if (n === 2) return 'warning'
  return 'info'
}
function safeDate(d) {
  if (!d) return null
  if (d instanceof Date) return d
  const t = new Date(d)
  return isNaN(t.getTime()) ? null : t
}
function formatTime(t) {
  const d = safeDate(t)
  if (!d) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function normalizeAlertFromAlerts(doc) {
  const levelNum = Number(doc.level) || 1
  return {
    id: `a:${doc._id}`,
    rawId: doc._id,
    source: COL_ALERTS,
    category: doc.category || 'fraud',
    levelNum,
    level: levelNumToClass(levelNum),
    type: doc.title || '预警',
    content: doc.description || doc.content || '',
    location: doc.location || '',
    phone: doc.phone || '',
    read: !!doc.read,
    latitude: doc.latitude,
    longitude: doc.longitude,
    openid: doc.openid,
    createdAt: doc.createdAt,
    time: formatTime(doc.createdAt)
  }
}
function normalizeAlertFromLocationAlerts(doc) {
  const levelNum = Number(doc.level) || 1
  const typeText = doc.type === 'GEOFENCE'
    ? '围栏预警'
    : (doc.type === 'LONG_STAY' ? '久留提醒' : (doc.type === 'WANDERING' ? '徘徊疑似走失' : (doc.type || '位置预警')))
  return {
    id: `l:${doc._id}`,
    rawId: doc._id,
    source: COL_LOC_ALERTS,
    category: doc.category || 'fence',
    levelNum,
    level: levelNumToClass(levelNum),
    type: typeText,
    content: doc.reason || doc.content || '',
    location: doc.location || '',
    phone: doc.phone || '',
    read: !!doc.read,
    latitude: doc.latitude,
    longitude: doc.longitude,
    openid: doc.openid,
    createdAt: doc.createdAt,
    time: formatTime(doc.createdAt)
  }
}
function parseId(id) {
  const s = String(id || '')
  const idx = s.indexOf(':')
  if (idx < 0) return null
  const prefix = s.slice(0, idx)
  const rawId = s.slice(idx + 1)
  if (!rawId) return null
  if (prefix === 'a') return { col: COL_ALERTS, rawId }
  if (prefix === 'l') return { col: COL_LOC_ALERTS, rawId }
  return null
}
async function getTargetOpenid(callerOpenid) {
  const user = await findUser(callerOpenid)
  if (!user) return { code: 1, msg: '用户不存在' }
  if (user.role === 'elderly') return { code: 0, role: 'elderly', targetOpenid: callerOpenid }
  const eid = await findElderlyOpenid(callerOpenid)
  if (!eid) return { code: 1, msg: '未绑定老人账号' }
  return { code: 0, role: 'family', targetOpenid: eid }
}
exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || 'get'
  const targetRes = await getTargetOpenid(OPENID)
  if (targetRes.code !== 0) return targetRes
  const targetOpenid = targetRes.targetOpenid
  try {
    if (action === 'get') {
      const category = event?.category ? String(event.category) : ''
      const whereBase = { openid: _.eq(targetOpenid) }
      const [aRes, lRes] = await Promise.all([
        db.collection(COL_ALERTS)
          .where(category ? { ...whereBase, category: _.eq(category) } : whereBase)
          .orderBy('createdAt', 'desc')
          .limit(Math.min(Number(event?.limit) || 50, 100))
          .get()
          .catch(() => ({ data: [] })),
        db.collection(COL_LOC_ALERTS)
          .where(category ? { ...whereBase, category: _.eq(category) } : whereBase)
          .orderBy('createdAt', 'desc')
          .limit(Math.min(Number(event?.limit) || 50, 100))
          .get()
          .catch(() => ({ data: [] })),
      ])
      const merged = [
        ...(aRes.data || []).map(normalizeAlertFromAlerts),
        ...(lRes.data || []).map(normalizeAlertFromLocationAlerts),
      ].sort((x, y) => {
        const tx = safeDate(x.createdAt)?.getTime() || 0
        const ty = safeDate(y.createdAt)?.getTime() || 0
        return ty - tx
      })
      const unread = merged.filter(i => !i.read).length
      return { code: 0, data: merged, unread }
    }
    if (action === 'unreadCount') {
      const [aCnt, lCnt] = await Promise.all([
        db.collection(COL_ALERTS).where({ openid: _.eq(targetOpenid), read: _.neq(true) }).count().catch(() => ({ total: 0 })),
        db.collection(COL_LOC_ALERTS).where({ openid: _.eq(targetOpenid), read: _.neq(true) }).count().catch(() => ({ total: 0 })),
      ])
      return { code: 0, data: { count: (aCnt.total || 0) + (lCnt.total || 0) } }
    }
    if (action === 'markRead') {
      const parsed = parseId(event?.id)
      if (!parsed) return { code: 1, msg: 'id 无效' }
      await db.collection(parsed.col).doc(parsed.rawId).update({ data: { read: true } })
      return { code: 0, msg: 'ok' }
    }
    if (action === 'delete') {
      const parsed = parseId(event?.id)
      if (!parsed) return { code: 1, msg: 'id 无效' }
      await db.collection(parsed.col).doc(parsed.rawId).remove()
      return { code: 0, msg: 'ok' }
    }
    return { code: -1, msg: '未知 action' }
  } catch (e) {
    console.error('[alerts]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}
