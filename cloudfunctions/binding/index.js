// cloudfunctions/binding/index.js
// 微信云开发云函数 —— 统一处理所有 binding 操作
// 入参统一格式：{ action: 'getBindings' | 'createBinding' | 'updateBinding' | 'deleteBinding', ...payload }

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const bindingsCol  = db.collection('bindings')
const elderlyCol   = db.collection('elderly')   // 老人用户集合
const familyCol    = db.collection('family')    // 家属用户集合

// 根据角色返回自己的集合 / 对端的集合
function getColByRole(role) {
  return role === 'elderly' ? elderlyCol : familyCol
}
function getPeerColByRole(role) {
  return role === 'elderly' ? familyCol : elderlyCol
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function ok(data, meta = {}) {
  return { code: 0, data, meta }
}

function fail(msg, code = -1) {
  return { code, msg }
}

function validPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone)
}

// ─── 各 action 处理器 ──────────────────────────────────────────────────────

/**
 * 获取当前用户的所有绑定关系
 * 同时返回 meta（能否新增绑定、能否解绑）
 */
async function getBindings({ openid, role }) {
  // 查询"我发起的"绑定（家属视角）或"别人绑定了我"的记录（老人视角）
  const field = role === 'elderly' ? 'toOpenid' : 'fromOpenid'
  const { data: rawList } = await bindingsCol.where({ [field]: openid }).get()

  // 批量查询对端用户信息
  const peerCol = getPeerColByRole(role)   // 家属 → 查 elderly；老人 → 查 family
  const results = await Promise.all(
    rawList.map(async item => {
      // 对端 openid：家属看老人(toOpenid)，老人看家属(fromOpenid)
      const peerOpenid = role === 'elderly' ? item.fromOpenid : item.toOpenid
      let linkedUser = {}
      if (peerOpenid) {
        const { data: users } = await peerCol.where({ _openid: peerOpenid }).limit(1).get()
        linkedUser = users[0] || {}
      }
      return {
        binding: {
          id: item._id,
          note: item.note || '',
          createdAt: item.createdAt || null
        },
        linkedUser: {
          openid: peerOpenid || '',
          name: linkedUser.nickName || linkedUser.name || '',
          phone: role === 'elderly' ? (linkedUser.phone || '') : (item.toPhone || '')
        }
      }
    })
  )

  // meta：家属最多绑定1个老人；老人不能主动创建绑定
  const canCreateBinding = role === 'family' && rawList.length === 0
  const canUnbind = rawList.length > 0

  return ok(results, { canCreateBinding, canUnbind })
}

/**
 * 创建绑定
 * payload: { linkedPhone, note }
 * 逻辑：通过手机号在 users 集合里找到老人，写入 bindings
 */
async function createBinding({ openid, role }, { linkedPhone, note }) {
  if (!validPhone(linkedPhone)) return fail('手机号格式不正确')

  // 不能绑自己：在自己的集合里查自己的手机号
  const selfCol = getColByRole(role)
  const { data: selfList } = await selfCol.where({ _openid: openid }).limit(1).get()
  const self = selfList[0] || {}
  if (self.phone === linkedPhone) return fail('不能绑定自己的账号')

  // 通过手机号在对端集合里查找用户（可以不存在，toOpenid 留空，等对端登录后关联）
  const peerCol = getPeerColByRole(role)  // 家属 → elderly；老人 → family
  const { data: peerList } = await peerCol.where({ phone: linkedPhone }).limit(1).get()
  const peer = peerList[0] || null

  // 查重：是否已绑定该手机号
  const { data: existing } = await bindingsCol
    .where({ fromOpenid: openid, toPhone: linkedPhone })
    .limit(1).get()
  if (existing.length > 0) return fail('已关联该手机号，请勿重复操作')

  // 家属最多绑1个老人
  if (role === 'family') {
    const { data: myBindings } = await bindingsCol.where({ fromOpenid: openid }).get()
    if (myBindings.length >= 1) return fail('每个家属账号最多关联1位老人')
  }

  const now = Date.now()
  const record = {
    fromOpenid: openid,
    toPhone: linkedPhone,
    toOpenid: peer ? peer._openid : '',
    note: note || '',
    createdAt: now
  }

  const { _id } = await bindingsCol.add({ data: record })
  return ok({ id: _id, ...record })
}

/**
 * 更新绑定（修改手机号或备注）
 * payload: { bindingId, linkedPhone, note }
 */
async function updateBinding({ openid }, { bindingId, linkedPhone, note }) {
  if (!bindingId) return fail('缺少 bindingId')
  if (linkedPhone && !validPhone(linkedPhone)) return fail('手机号格式不正确')

  // 鉴权：只能修改自己的绑定
  const { data: [record] } = await bindingsCol.doc(bindingId).get().catch(() => ({ data: [] }))
  if (!record) return fail('绑定记录不存在')
  if (record.fromOpenid !== openid) return fail('无权操作')

  const update = {}
  if (linkedPhone && linkedPhone !== record.toPhone) {
    // 重新在对端集合（elderly）里查找，updateBinding 只有家属会调用
    const { data: peerList } = await elderlyCol.where({ phone: linkedPhone }).limit(1).get()
    const peer = peerList[0] || null
    update.toPhone = linkedPhone
    update.toOpenid = peer ? peer._openid : ''
  }
  if (note !== undefined) update.note = note

  await bindingsCol.doc(bindingId).update({ data: update })
  return ok({ bindingId, ...update })
}

/**
 * 删除（解除）绑定
 * payload: { bindingId }
 */
async function deleteBinding({ openid }, { bindingId }) {
  if (!bindingId) return fail('缺少 bindingId')

  const { data: [record] } = await bindingsCol.doc(bindingId).get().catch(() => ({ data: [] }))
  if (!record) return fail('绑定记录不存在')
  // 家属（fromOpenid）和老人（toOpenid）都可以解除
  if (record.fromOpenid !== openid && record.toOpenid !== openid) return fail('无权操作')

  await bindingsCol.doc(bindingId).remove()
  return ok({ bindingId })
}

// ─── 云函数入口 ────────────────────────────────────────────────────────────

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, role = 'family', ...payload } = event

  const caller = { openid: OPENID, role }

  try {
    switch (action) {
      case 'getBindings':
        return await getBindings(caller)
      case 'createBinding':
        return await createBinding(caller, payload)
      case 'updateBinding':
        return await updateBinding(caller, payload)
      case 'deleteBinding':
        return await deleteBinding(caller, payload)
      default:
        return fail(`未知 action: ${action}`)
    }
  } catch (e) {
    console.error(`[binding] action=${action} error:`, e)
    return fail(e.message || '服务器错误')
  }
}
