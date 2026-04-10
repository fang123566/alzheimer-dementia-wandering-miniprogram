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
const tokensCol    = db.collection('tokens')

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

/** 用 token 精确定位当前登录账号（避免同一 openid 多账号导致 role/self 串号） */
async function resolveSession(openid, token) {
  if (!openid || !token) return null
  try {
    const tokRes = await tokensCol.where({ openid, token }).limit(1).get()
    const rec = tokRes.data && tokRes.data[0]
    if (!rec || !rec.userId || !rec.role) return null
    return { userId: rec.userId, role: rec.role }
  } catch (e) {
    console.error('[binding] resolveSession error:', e)
    return null
  }
}

// ─── 各 action 处理器 ──────────────────────────────────────────────────────

/**
 * 获取当前用户的所有绑定关系
 * 同时返回 meta（能否新增绑定、能否解绑）
 */
async function getBindings({ openid, role, userId }) {
  const selfCol = getColByRole(role)
  const [selfDocRes] = await Promise.all([
    userId ? selfCol.doc(userId).get().catch(() => ({ data: {} })) : Promise.resolve({ data: {} }),
  ])

  const self = selfDocRes.data || {}
  const selfPhone = self.phone || ''

  // 同一微信 openid 下可能有多个账号：必须优先用 userId 精准查询绑定关系
  const [initiatedRes, receivedRes] = await Promise.all([
    userId
      ? bindingsCol.where({ fromUserId: userId }).get()
      : bindingsCol.where({ fromOpenid: openid }).get(),
    userId
      ? bindingsCol.where({ toUserId: userId }).get()
      : bindingsCol.where({ toOpenid: openid }).get()
  ])

  let rawList = uniqueBindings([...(initiatedRes.data || []), ...(receivedRes.data || [])])

  if (selfPhone) {
    // 兼容历史数据：旧绑定可能没有 toUserId，只能用手机号兜底拉取
    const { data: phoneBindings } = await bindingsCol.where({ toPhone: selfPhone }).get()
    if (phoneBindings.length > 0) {
      rawList = uniqueBindings([...rawList, ...phoneBindings])
      for (const b of phoneBindings) {
        // 不再回填 toOpenid：openid 在多账号场景下不唯一，会造成串号
        // 若当前会话能定位到 userId，则回填 toUserId 以便下次精确查询
        if (userId && !b.toUserId) {
          await bindingsCol.doc(b._id).update({ data: { toUserId: userId } }).catch(() => {})
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
      let peerUserId = ''
      let linkedUser = {}

      if (isCurrentUserInitiator) {
        peerOpenid = item.toOpenid || ''
        peerUserId = item.toUserId || ''
      } else if (isCurrentUserReceiver) {
        peerOpenid = item.fromOpenid || ''
        peerUserId = item.fromUserId || ''
      } else {
        peerOpenid = role === 'elderly' ? item.fromOpenid : item.toOpenid
        peerUserId = role === 'elderly' ? (item.fromUserId || '') : (item.toUserId || '')
      }

      // 优先用对端 userId 精准查询（支持同一 openid 多账号）
      if (peerUserId) {
        const docRes = await peerCol.doc(peerUserId).get().catch(() => ({ data: {} }))
        linkedUser = docRes.data || {}
      }

      // 当前用户在发起侧时，如果对端 openid 为空但 toPhone 存在，尝试用手机号查找并回填
      // 注意：同一微信 openid 多账号时，peerOpenid 可能等于当前 openid，不能用于定位对端账号
      const openidAmbiguous = !!peerOpenid && peerOpenid === openid
      if (!peerUserId && isCurrentUserInitiator && item.toPhone) {
        const { data: phoneUsers } = await peerCol.where({ phone: item.toPhone }).limit(1).get()
        if (phoneUsers.length > 0) {
          linkedUser = phoneUsers[0]
          // 回填 toUserId（优先），并保留旧字段兼容
          await bindingsCol.doc(item._id).update({
            data: {
              toUserId: linkedUser._id || '',
              toOpenid: linkedUser.openid || linkedUser._openid || ''
            }
          }).catch(() => {})
        }
      }

      // 如果 openid 可疑（同 openid 多账号）且还没拿到 linkedUser，则用手机号兜底查找
      if (!linkedUser._id && (openidAmbiguous || !peerOpenid)) {
        const phone = isCurrentUserInitiator ? (item.toPhone || '') : (item.fromPhone || '')
        if (phone) {
          const { data: phoneUsers2 } = await peerCol.where({ phone }).limit(1).get()
          if (phoneUsers2.length > 0) {
            linkedUser = phoneUsers2[0]
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
          avatar: linkedUser.avatar || '',
          phone: linkedUser.phone || (isCurrentUserInitiator ? (item.toPhone || '') : '')
        }
      }
    })
  )

  // meta：家属最多绑定1个老人；老人侧保持现有页面可见能力
  const initiatedCount = (rawList || []).filter(item => {
    if (userId) return item.fromUserId === userId
    // 兜底：历史数据按手机号判断是否“我发起的绑定”
    return !!selfPhone && item.fromPhone === selfPhone
  }).length
  const canCreateBinding = role === 'family' ? initiatedCount === 0 : true
  const canUnbind = rawList.length > 0

  return ok(results, { canCreateBinding, canUnbind })
}

/**
 * 创建绑定
 * payload: { linkedPhone, note }
 * 逻辑：通过手机号在 users 集合里找到老人，写入 bindings
 */
async function createBinding({ openid, role, userId }, { linkedPhone, note }) {
  if (!validPhone(linkedPhone)) return fail('手机号格式不正确')

  // 不能绑自己：在自己的集合里查自己的手机号（兼容 _openid 和 openid）
  const selfCol = getColByRole(role)
  const selfRes = userId
    ? await selfCol.doc(userId).get().catch(() => ({ data: {} }))
    : { data: {} }
  const self = selfRes.data || {}
  if (self.phone === linkedPhone) return fail('不能绑定自己的账号')

  // 通过手机号在对端集合里查找用户（可以不存在，toOpenid 留空，等对端登录后关联）
  const peerCol = getPeerColByRole(role)  // 家属 → elderly；老人 → family
  const { data: peerList } = await peerCol.where({ phone: linkedPhone }).limit(1).get()
  const peer = peerList[0] || null

  // 查重：是否已绑定该手机号
  const existingQuery = userId
    ? { fromUserId: userId, toPhone: linkedPhone }
    : { fromOpenid: openid, toPhone: linkedPhone }
  const { data: existing } = await bindingsCol.where(existingQuery).limit(1).get()
  if (existing.length > 0) return fail('已关联该手机号，请勿重复操作')

  // 家属最多绑1个老人
  if (role === 'family') {
    const { data: myBindings } = await bindingsCol.where(userId ? { fromUserId: userId } : { fromOpenid: openid }).get()
    if (myBindings.length >= 1) return fail('每个家属账号最多关联1位老人')
  }

  const now = Date.now()
  const record = {
    fromOpenid: openid,
    fromUserId: userId || '',
    fromPhone: self.phone || '',  // 家属手机号，用于后续解绑鉴权
    toPhone: linkedPhone,
    toOpenid: peer ? (peer.openid || peer._openid || '') : '',
    toUserId: peer ? (peer._id || '') : '',
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
  const recordRes = await bindingsCol.doc(bindingId).get().catch(() => null)
  const record = recordRes && recordRes.data ? recordRes.data : null
  if (!record || !record._id) return fail('绑定记录不存在')
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
 * 鉴权逻辑：
 * 1. 检查 fromOpenid / toOpenid 匹配（直接匹配）
 * 2. 检查 fromOpenid / toOpenid 匹配（使用 openid 字段兼容 _openid）
 * 3. 检查手机号匹配：通过 openid 查用户手机号，再匹配 binding 的 toPhone/fromPhone
 */
async function deleteBinding({ openid, userId = '' }, { bindingId }) {
  if (!bindingId) return fail('缺少 bindingId')

  console.log('[deleteBinding] 开始解绑，bindingId:', bindingId, 'caller openid:', openid)

  const recordRes = await bindingsCol.doc(bindingId).get().catch((e) => {
    console.error('[deleteBinding] 查询绑定记录失败:', e)
    return null
  })
  const record = recordRes && recordRes.data ? recordRes.data : null

  if (!record) {
    console.log('[deleteBinding] 绑定记录不存在')
    return fail('绑定记录不存在')
  }

  console.log('[deleteBinding] 找到记录:', { fromOpenid: record.fromOpenid, toOpenid: record.toOpenid, toPhone: record.toPhone })

  // 0. userId 精准鉴权（优先）
  if (userId && (record.fromUserId === userId || record.toUserId === userId)) {
    console.log('[deleteBinding] userId 匹配成功，执行删除')
    await bindingsCol.doc(bindingId).remove()
    return ok({ bindingId })
  }

  // 1. 直接 openid 匹配（兼容 _openid 和 openid 字段）
  const fromMatch = record.fromOpenid === openid || record.fromOpenid === ''
  const toMatch = record.toOpenid === openid || record.toOpenid === ''

  if (fromMatch || toMatch) {
    console.log('[deleteBinding] openid 直接匹配成功，执行删除')
    await bindingsCol.doc(bindingId).remove()
    return ok({ bindingId })
  }

  // 2. 手机号匹配：通过 openid 查找用户手机号，验证是否是 toPhone 的拥有者
  // 查老人集合
  const [elderSnap1, elderSnap2, familySnap1, familySnap2] = await Promise.all([
    elderlyCol.where({ _openid: openid }).limit(1).get().catch(() => ({ data: [] })),
    elderlyCol.where({ openid }).limit(1).get().catch(() => ({ data: [] })),
    familyCol.where({ _openid: openid }).limit(1).get().catch(() => ({ data: [] })),
    familyCol.where({ openid }).limit(1).get().catch(() => ({ data: [] }))
  ])

  const elderDoc = elderSnap1.data[0] || elderSnap2.data[0]
  const familyDoc = familySnap1.data[0] || familySnap2.data[0]

  console.log('[deleteBinding] 用户查询结果:', { elderPhone: elderDoc?.phone, familyPhone: familyDoc?.phone })

  // 如果是老人端：检查 record.toPhone 是否等于老人手机号
  if (elderDoc && elderDoc.phone && record.toPhone === elderDoc.phone) {
    console.log('[deleteBinding] 手机号匹配成功（老人端），执行删除并回填 toOpenid')
    // 回填 toOpenid 方便下次
    if (!record.toOpenid) {
      await bindingsCol.doc(bindingId).update({ data: { toOpenid: openid } }).catch(() => {})
    }
    await bindingsCol.doc(bindingId).remove()
    return ok({ bindingId })
  }

  // 如果是家属端：检查 record.fromOpenid 是否为空，或匹配家属 openid
  // 家属创建绑定时 fromOpenid 就是自己的 openid
  if (familyDoc && record.fromOpenid) {
    // 如果 fromOpenid 不为空，但之前没匹配上，说明数据不一致
    // 尝试用家属的手机号来确认（如果 binding 里有 fromPhone 字段）
    if (record.fromPhone && record.fromPhone === familyDoc.phone) {
      console.log('[deleteBinding] 手机号匹配成功（家属端），执行删除')
      await bindingsCol.doc(bindingId).remove()
      return ok({ bindingId })
    }
  }

  console.log('[deleteBinding] 鉴权失败：无匹配权限')
  return fail('无权操作：您不是该绑定的参与方')
}

// ─── 云函数入口 ────────────────────────────────────────────────────────────

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const { action, role = 'family', token = '', ...payload } = event

  const session = await resolveSession(OPENID, token).catch(() => null)
  const caller = {
    openid: OPENID,
    role: (session && session.role) || role,
    userId: session ? session.userId : ''
  }

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
