const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const COL_USER_SETTINGS = 'user_settings'
const COL_CONTACTS = 'contacts'
const COL_KEYWORDS = 'fraud_keywords'

async function findUser(openid) {
  const [eSnap, fSnap] = await Promise.all([
    db.collection('elderly').where({ _openid: openid }).limit(1).get(),
    db.collection('family').where({ _openid: openid }).limit(1).get()
  ])
  if (eSnap.data.length) return { ...eSnap.data[0], role: 'elderly' }
  if (fSnap.data.length) return { ...fSnap.data[0], role: 'family' }
  const [eSnap2, fSnap2] = await Promise.all([
    db.collection('elderly').where({ openid }).limit(1).get(),
    db.collection('family').where({ openid }).limit(1).get()
  ])
  if (eSnap2.data.length) return { ...eSnap2.data[0], role: 'elderly' }
  if (fSnap2.data.length) return { ...fSnap2.data[0], role: 'family' }
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

async function getTargetOpenid(callerOpenid) {
  const user = await findUser(callerOpenid)
  if (!user) return { code: 1, msg: '用户不存在' }
  if (user.role === 'elderly') return { code: 0, role: 'elderly', targetOpenid: callerOpenid }
  const eid = await findElderlyOpenid(callerOpenid)
  if (!eid) return { code: 1, msg: '未绑定老人账号' }
  return { code: 0, role: 'family', targetOpenid: eid }
}

function asInt(v) {
  const n = typeof v === 'string' ? parseInt(v, 10) : Number(v)
  return Number.isFinite(n) ? n : NaN
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = event?.action || 'getSettings'

  try {
    const targetRes = await getTargetOpenid(OPENID)
    if (targetRes.code !== 0) return targetRes
    const targetOpenid = targetRes.targetOpenid

    // ── 基础设置总览（settings 页面初始化用） ─────────────
    if (action === 'getSettings') {
      const [elderSnap, setSnap] = await Promise.all([
        db.collection('elderly').where({ _openid: targetOpenid }).limit(1).get(),
        db.collection(COL_USER_SETTINGS).where({ openid: targetOpenid }).limit(1).get()
      ])
      const elderly = elderSnap.data?.[0] || {}
      const settings = setSnap.data?.[0]?.settings || {}

      // 家庭组信息先做轻量返回（你原页面只展示 members/deviceBound）
      const family = { name: '家庭组', members: 0, deviceBound: true }
      return { code: 0, data: { elderly, settings, family } }
    }

    if (action === 'updateSettings') {
      const patch = event?.data || {}
      const exist = await db.collection(COL_USER_SETTINGS).where({ openid: targetOpenid }).limit(1).get()
      const now = db.serverDate()
      if (exist.data?.length) {
        const current = exist.data[0]
        await db.collection(COL_USER_SETTINGS).doc(current._id).update({
          data: { settings: { ...(current.settings || {}), ...patch }, updatedAt: now }
        })
      } else {
        await db.collection(COL_USER_SETTINGS).add({
          data: { openid: targetOpenid, settings: patch, createdAt: now, updatedAt: now }
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

      const elderSnap = await db.collection('elderly').where({ _openid: targetOpenid }).limit(1).get()
      if (!elderSnap.data?.length) return { code: 1, msg: '老人档案不存在，请先注册老人账号' }
      await db.collection('elderly').doc(elderSnap.data[0]._id).update({ data: update })
      const newSnap = await db.collection('elderly').doc(elderSnap.data[0]._id).get()
      return { code: 0, data: newSnap.data }
    }

    // ── 紧急联系人 ─────────────────────────────────────
    if (action === 'getContacts') {
      const snap = await db.collection(COL_CONTACTS)
        .where({ openid: targetOpenid })
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
        data: { openid: targetOpenid, name, phone, relation, avatar, priority, createdAt: now, updatedAt: now }
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
        .where({ openid: targetOpenid })
        .orderBy('createdAt', 'desc')
        .get()
      return { code: 0, data: (snap.data || []).map(i => i.keyword).filter(Boolean) }
    }

    if (action === 'addKeyword') {
      const keyword = String(event?.keyword || '').trim()
      if (!keyword) return { code: 1, msg: '关键词不能为空' }
      const exist = await db.collection(COL_KEYWORDS)
        .where({ openid: targetOpenid, keyword: _.eq(keyword) })
        .limit(1).get()
      if (!exist.data?.length) {
        await db.collection(COL_KEYWORDS).add({
          data: { openid: targetOpenid, keyword, createdAt: db.serverDate() }
        })
      }
      return exports.main({ action: 'getKeywords' }, context)
    }

    if (action === 'deleteKeyword') {
      const keyword = String(event?.keyword || '').trim()
      if (!keyword) return { code: 1, msg: '关键词不能为空' }
      const snap = await db.collection(COL_KEYWORDS)
        .where({ openid: targetOpenid, keyword: _.eq(keyword) })
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

