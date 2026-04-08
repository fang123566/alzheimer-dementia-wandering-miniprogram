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

function uniqueBindings(list = []) {
  const seen = new Set()
  return list.filter(item => {
    const id = item && item._id
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })
}

// ─── 各 action 处理器 ──────────────────────────────────────────────────────

/**
 * 获取当前用户的所有绑定关系
 * 同时返回 meta（能否新增绑定、能否解绑）
 */
async function getBindings({ openid, role }) {
  const selfCol = getColByRole(role)
  const [selfSnap1, selfSnap2, initiatedRes, receivedRes] = await Promise.all([
    selfCol.where({ _openid: openid }).limit(1).get(),
    selfCol.where({ openid }).limit(1).get(),
    bindingsCol.where({ fromOpenid: openid }).get(),
    bindingsCol.where({ toOpenid: openid }).get()
  ])

  const self = selfSnap1.data[0] || selfSnap2.data[0] || {}
  const selfPhone = self.phone || ''

  let rawList = uniqueBindings([
    ...(initiatedRes.data || []),
    ...(receivedRes.data || [])
  ])

  if (selfPhone) {
    const { data: phoneBindings } = await bindingsCol.where({ toPhone: selfPhone }).get()
    if (phoneBindings.length > 0) {
      rawList = uniqueBindings([...rawList, ...phoneBindings])
      for (const b of phoneBindings) {
        if (!b.toOpenid) {
          await bindingsCol.doc(b._id).update({ data: { toOpenid: openid } }).catch(() => {})
        }
      }
    }
  }

  // 批量查询对端用户信息
  const peerCol = getPeerColByRole(role)   // 家属 → 查 elderly；老人 → 查 family
  const results = await Promise.all(
    rawList.map(async item => {
      const isCurrentUserInitiator = item.fromOpenid === openid
      const isCurrentUserReceiver = item.toOpenid === openid || (!!selfPhone && item.toPhone === selfPhone)
      let peerOpenid = ''
      let linkedUser = {}

      if (isCurrentUserInitiator) {
        peerOpenid = item.toOpenid || ''
      } else if (isCurrentUserReceiver) {
        peerOpenid = item.fromOpenid || ''
      } else {
        peerOpenid = role === 'elderly' ? item.fromOpenid : item.toOpenid
      }

      // 先用 openid 查找对端用户（兼容 _openid 和 openid 两个字段）
      if (peerOpenid) {
        const [snap1, snap2] = await Promise.all([
          peerCol.where({ _openid: peerOpenid }).limit(1).get(),
          peerCol.where({ openid: peerOpenid }).limit(1).get()
        ])
        linkedUser = snap1.data[0] || snap2.data[0] || {}
      }

      // 当前用户在发起侧时，如果对端 openid 为空但 toPhone 存在，尝试用手机号查找并回填
      if (isCurrentUserInitiator && !peerOpenid && item.toPhone) {
        const { data: phoneUsers } = await peerCol.where({ phone: item.toPhone }).limit(1).get()
        if (phoneUsers.length > 0) {
          linkedUser = phoneUsers[0]
          peerOpenid = linkedUser.openid || linkedUser._openid || ''
          // 回填 toOpenid，下次查询不再需要手机号查找
          if (peerOpenid) {
            await bindingsCol.doc(item._id).update({ data: { toOpenid: peerOpenid } }).catch(() => {})
          }
        }
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
          phone: linkedUser.phone || (isCurrentUserInitiator ? (item.toPhone || '') : '')
        }
      }
    })
  )

  // meta：家属最多绑定1个老人；老人侧保持现有页面可见能力
  const initiatedCount = (initiatedRes.data || []).length
  const canCreateBinding = role === 'family' ? initiatedCount === 0 : true
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
    toOpenid: peer ? (peer.openid || peer._openid || '') : '',
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
    update.toOpenid = peer ? (peer.openid || peer._openid || '') : ''
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
