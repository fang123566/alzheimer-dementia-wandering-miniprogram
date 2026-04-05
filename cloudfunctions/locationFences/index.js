// cloudfunctions/locationFences/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    const userSnap = await db.collection('users').where({ openid }).get()
    if (!userSnap.data.length) return { code: 1, msg: '用户不存在' }

    const user = userSnap.data[0]
    let targetOpenid = openid

    if (user.role === 'family') {
      const bindSnap = await db.collection('bindings')
        .where({ familyOpenid: openid })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
      if (!bindSnap.data.length) return { code: 1, msg: '未绑定老人账号' }
      targetOpenid = bindSnap.data[0].elderlyOpenid
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
