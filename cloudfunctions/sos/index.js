const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

// 根据触发者 openid 找到对应的老人 openid
// 老人触发 → 直接返回自己；家属触发 → 通过 bindings 找绑定的老人
async function findElderlyOpenid(callerOpenid) {
  // 先查 elderly 集合，看触发者本身是不是老人
  const [e1, e2] = await Promise.all([
    db.collection('elderly').where({ _openid: callerOpenid }).limit(1).get(),
    db.collection('elderly').where({ openid: callerOpenid }).limit(1).get()
  ])
  const elder = e1.data[0] || e2.data[0]
  if (elder) return { elderlyOpenid: callerOpenid, elderName: elder.nickName || elder.name || '老人' }

  // 不是老人，当家属处理：通过 bindings 找绑定的老人
  const { data: bindings } = await db.collection('bindings')
    .where({ fromOpenid: callerOpenid })
    .limit(1)
    .get()
  if (bindings.length && bindings[0].toOpenid) {
    return { elderlyOpenid: bindings[0].toOpenid, elderName: '老人' }
  }

  // 找不到任何老人，返回调用者自身（兜底，至少写进去）
  return { elderlyOpenid: callerOpenid, elderName: '用户' }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  const { latitude, longitude, address = '' } = event

  console.log('[sos] 触发者 OPENID:', OPENID)

  // 1. 找到对应的老人 openid（alerts 读取时用老人 openid 过滤）
  const { elderlyOpenid, elderName } = await findElderlyOpenid(OPENID)
  console.log('[sos] 老人 openid:', elderlyOpenid, '名字:', elderName)

  // 2. 找所有绑定该老人的家属 openid
  const { data: bindings } = await db.collection('bindings')
    .where({ toOpenid: elderlyOpenid })
    .get()
  const familyOpenids = bindings.map(b => b.fromOpenid).filter(Boolean)
  console.log('[sos] 绑定家属列表:', familyOpenids)

  // 3. 写入 alerts 集合
  //    openid 字段存老人的 openid —— 与 alerts 云函数读取逻辑一致
  const now = Date.now()
  const content = address
    ? `${elderName} 触发了 SOS 紧急求助，当前位置：${address}`
    : `${elderName} 触发了 SOS 紧急求助`

  await db.collection('alerts').add({
    data: {
      openid: elderlyOpenid,   // ← 关键：存老人 openid，alerts 云函数才能查到
      category: 'sos',
      type: 'SOS求助',
      title: 'SOS 紧急求助',
      content,
      description: content,
      level: 3,
      latitude: latitude || null,
      longitude: longitude || null,
      location: address || '',
      read: false,
      createdAt: now
    }
  })

  console.log('[sos] 已写入 alerts，老人 openid:', elderlyOpenid)
  console.log('[sos] 绑定家属数量:', familyOpenids.length)

  return { code: 0, msg: 'ok', notified: familyOpenids.length || 1 }
}
