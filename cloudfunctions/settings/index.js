const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL_USER_SETTINGS = 'user_settings'
const COL_CONTACTS = 'contacts'
const COL_KEYWORDS = 'fraud_keywords'
const COL_TOKENS = 'tokens'

async function resolveSession(openid, token) {
  if (!openid || !token) return null
  try {
    const snap = await db.collection(COL_TOKENS).where({ openid, token }).limit(1).get()
    const rec = snap.data && snap.data[0]
    if (!rec || !rec.userId || !rec.role) return null
    return { userId: rec.userId, role: rec.role }
  } catch (e) {
    console.error('[settings] resolveSession', e)
    return null
  }
}

async function findUserById(role, userId) {
  if (!userId) return null
  try {
    const col = role === 'elderly' ? 'elderly' : 'family'
    const snap = await db.collection(col).doc(userId).get()
    return snap.data ? { ...snap.data, role } : null
  } catch (e) {
    return null
  }
}

async function findElderlyTarget(familyOpenid, familyUserId) {
  const q = familyUserId ? { fromUserId: familyUserId } : { fromOpenid: familyOpenid }
  const { data } = await db.collection('bindings')
    .where(q)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  if (!data.length) return null
  const binding = data[0]
  if (binding.toUserId) {
    // 尝试读老人 doc，拿到 openid（兼容页面/旧字段）
    const elderDoc = await db.collection('elderly').doc(binding.toUserId).get().catch(() => null)
    const elder = elderDoc && elderDoc.data ? elderDoc.data : null
    const eid = elder ? (elder.openid || elder._openid || '') : ''
    return { userId: binding.toUserId, openid: eid }
  }
  if (binding.toOpenid) {
    // 老数据：只有 openid，无法区分同 openid 多账号；退化为手机号路径
  }
  if (binding.toPhone) {
    const { data: elders } = await db.collection('elderly')
      .where({ phone: binding.toPhone }).limit(1).get()
    if (elders.length) {
      const elder = elders[0]
      const eid = elder.openid || elder._openid || ''
      // 回填 toUserId（优先），并保留 toOpenid 兼容
      await db.collection('bindings').doc(binding._id)
        .update({ data: { toUserId: elder._id, toOpenid: eid } }).catch(() => {})
      return { userId: elder._id, openid: eid }
    }
  }
  return null
}

async function getTargetUser(eventOpenid, token) {
  const session = await resolveSession(eventOpenid, token)
  if (!session) return { code: 1, msg: '登录已失效，请重新登录' }
  const user = await findUserById(session.role, session.userId)
  if (!user) return { code: 1, msg: '用户不存在' }

  if (session.role === 'elderly') {
    const oid = user.openid || user._openid || eventOpenid
    return { code: 0, role: 'elderly', targetUserId: session.userId, targetOpenid: oid }
  }

  const target = await findElderlyTarget(eventOpenid, session.userId)
  if (!target || !target.userId) return { code: 1, msg: '未绑定老人账号' }
  return { code: 0, role: 'family', targetUserId: target.userId, targetOpenid: target.openid || '' }
}

function asInt(v) {
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v)
  return Number.isFinite(n) ? n : NaN
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || 'getSettings'
  const token = event?.token || ''

  try {
    const targetRes = await getTargetUser(OPENID, token)
    if (targetRes.code !== 0) return targetRes
    const targetOpenid = targetRes.targetOpenid
    const targetUserId = targetRes.targetUserId

    // ── 基础设置总览（settings 页面初始化用） ─────────────
    if (action === 'getSettings') {
      const [elderSnap, setSnap] = await Promise.all([
        db.collection('elderly').doc(targetUserId).get().catch(() => ({ data: {} })),
        db.collection(COL_USER_SETTINGS).where({ userId: targetUserId }).limit(1).get()
      ])
      const elderly = elderSnap.data || {}
      const settings = setSnap.data?.[0]?.settings || {}

      // 家庭组信息先做轻量返回（你原页面只展示 members/deviceBound）
      const family = { name: '家庭组', members: 0, deviceBound: true }
      return { code: 0, data: { elderly, settings, family } }
    }

    if (action === 'updateSettings') {
      const patch = event?.data || {}
      const exist = await db.collection(COL_USER_SETTINGS).where({ userId: targetUserId }).limit(1).get()
      const now = db.serverDate()
      if (exist.data?.length) {
        const current = exist.data[0]
        await db.collection(COL_USER_SETTINGS).doc(current._id).update({
          data: { settings: { ...(current.settings || {}), ...patch }, updatedAt: now }
        })
      } else {
        await db.collection(COL_USER_SETTINGS).add({
          data: { userId: targetUserId, openid: targetOpenid, settings: patch, createdAt: now, updatedAt: now }
        })
      }
      return { code: 0, msg: 'ok' }
    }

    // ── 老人信息 ───────────────────────────────────────
    if (action === 'updateElderly') {
      const patch = event?.data || {}
      const update = {}
      if (patch.name !== undefined) update.name = String(patch.name || '').trim()
      if (patch.age !== undefined) update.age = asInt(patch.age)
      if (patch.avatar !== undefined) update.avatar = String(patch.avatar || '')
      if (patch.idCard !== undefined) update.idCard = String(patch.idCard || '').trim()
      if (patch.medicalHistory !== undefined) update.medicalHistory = String(patch.medicalHistory || '').trim()
      update.updatedAt = db.serverDate()

      const elderSnap = await db.collection('elderly').doc(targetUserId).get().catch(() => ({ data: null }))
      if (!elderSnap.data) return { code: 1, msg: '老人档案不存在，请先注册老人账号' }
      await db.collection('elderly').doc(targetUserId).update({ data: update })
      const newSnap = await db.collection('elderly').doc(targetUserId).get()
      return { code: 0, data: newSnap.data }
    }

    // ── 紧急联系人 ─────────────────────────────────────
    if (action === 'getContacts') {
      const snap = await db.collection(COL_CONTACTS).where({
        userId: _.eq(targetUserId)
      })
        .orderBy('priority', 'asc')
        .orderBy('createdAt', 'desc')
        .get()
      const list = (snap.data || []).map(c => ({
        id: c._id,
        name: c.name || '',
        phone: c.phone || '',
        relation: c.relation || '家属',
        avatar: c.avatar || '👤',
        priority: c.priority || 999999
      }))
      return { code: 0, data: list }
    }

    if (action === 'addContact') {
      const name = String(event?.data?.name || '').trim()
      const phone = String(event?.data?.phone || '').trim()
      const relation = String(event?.data?.relation || '家属').trim()
      const avatar = String(event?.data?.avatar || '👤')
      const priority = event?.data?.priority !== undefined ? asInt(event.data.priority) : 999999
      if (!name || !phone || !relation) return { code: 1, msg: '缺少联系人字段' }
      const now = db.serverDate()
      const addRes = await db.collection(COL_CONTACTS).add({
        data: { userId: targetUserId, openid: targetOpenid, name, phone, relation, avatar, priority, createdAt: now, updatedAt: now }
      })
      return { code: 0, data: { id: addRes._id } }
    }

    if (action === 'updateContact') {
      const id = String(event?.id || '').trim()
      if (!id) return { code: 1, msg: '缺少 id' }
      const patch = event?.data || {}
      const update = { updatedAt: db.serverDate() }
      if (patch.name !== undefined) update.name = String(patch.name || '').trim()
      if (patch.phone !== undefined) update.phone = String(patch.phone || '').trim()
      if (patch.relation !== undefined) update.relation = String(patch.relation || '').trim()
      if (patch.avatar !== undefined) update.avatar = String(patch.avatar || '')
      if (patch.priority !== undefined) update.priority = asInt(patch.priority)
      await db.collection(COL_CONTACTS).doc(id).update({ data: update })
      return { code: 0, msg: 'ok' }
    }

    if (action === 'deleteContact') {
      const id = String(event?.id || '').trim()
      if (!id) return { code: 1, msg: '缺少 id' }
      await db.collection(COL_CONTACTS).doc(id).remove()
      return { code: 0, msg: 'ok' }
    }

    // ── 防诈关键词 ─────────────────────────────────────
    if (action === 'getKeywords') {
      const snap = await db.collection(COL_KEYWORDS)
        .where({ userId: targetUserId })
        .orderBy('createdAt', 'desc')
        .get()
      return { code: 0, data: (snap.data || []).map(i => i.keyword).filter(Boolean) }
    }

    if (action === 'addKeyword') {
      const keyword = String(event?.keyword || '').trim()
      if (!keyword) return { code: 1, msg: '关键词不能为空' }
      const exist = await db.collection(COL_KEYWORDS)
        .where({ userId: targetUserId, keyword: _.eq(keyword) })
        .limit(1).get()
      if (!exist.data?.length) {
        await db.collection(COL_KEYWORDS).add({
          data: { userId: targetUserId, openid: targetOpenid, keyword, createdAt: db.serverDate() }
        })
      }
      return exports.main({ action: 'getKeywords' }, context)
    }

    if (action === 'deleteKeyword') {
      const keyword = String(event?.keyword || '').trim()
      if (!keyword) return { code: 1, msg: '关键词不能为空' }
      const snap = await db.collection(COL_KEYWORDS)
        .where({ userId: targetUserId, keyword: _.eq(keyword) })
        .get()
      for (const d of (snap.data || [])) {
        await db.collection(COL_KEYWORDS).doc(d._id).remove()
      }
      return exports.main({ action: 'getKeywords' }, context)
    }

    return { code: -1, msg: '未知 action' }
  } catch (e) {
    console.error('[settings]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}

