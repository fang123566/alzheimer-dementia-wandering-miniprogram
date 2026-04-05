// cloudfunctions/locationGetCurrent/index.js
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

/** 家属端查绑定的老人 openid（兼容 toOpenid 为空时按手机号回填） */
async function findElderlyOpenid(familyOpenid) {
  const { data } = await db.collection('bindings')
    .where({ fromOpenid: familyOpenid })
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get()
  if (!data.length) return null
  const binding = data[0]
  if (binding.toOpenid) return binding.toOpenid
  // toOpenid 为空，用手机号查找并回填
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

    // 取最新一条位置记录
    const locSnap = await db.collection('locations')
      .where({ openid: targetOpenid })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get()

    if (!locSnap.data.length) return { code: 1, msg: '暂无位置数据' }

    const loc = locSnap.data[0]
    return {
      code: 0,
      data: {
        latitude:  loc.latitude,
        longitude: loc.longitude,
        address:   loc.address || '',
        status:    loc.status  || 'safe',
        distance:  loc.distance || 0,
        updatedAt: loc.updatedAt
      }
    }
  } catch (e) {
    console.error('[locationGetCurrent]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}
