// cloudfunctions/locationFences/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()

  try {
    const user = await findUser(OPENID)
    if (!user) return { code: 1, msg: '用户不存在' }

    let targetOpenid = OPENID
    if (user.role === 'family') {
      const eid = await findElderlyOpenid(OPENID)
      if (!eid) return { code: 1, msg: '未绑定老人账号' }
      targetOpenid = eid
    }

    const snap = await db.collection('fences')
      .where({ ownerOpenid: targetOpenid })
      .orderBy('createdAt', 'desc')
      .get()

    const fences = snap.data.map(f => ({
      id:        f._id,
      name:      f.name || '围栏',
      latitude:  f.latitude,
      longitude: f.longitude,
      radius:    f.radius,
      enabled:   f.enabled !== false,
      createdAt: f.createdAt
    }))

    return { code: 0, data: fences }
  } catch (e) {
    console.error('[locationFences]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}
