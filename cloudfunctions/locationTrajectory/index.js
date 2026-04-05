// cloudfunctions/locationTrajectory/index.js
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

    // family 端查老人轨迹
    if (user.role === 'family') {
      const bindSnap = await db.collection('bindings')
        .where({ familyOpenid: openid })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
      if (!bindSnap.data.length) return { code: 1, msg: '未绑定老人账号' }
      targetOpenid = bindSnap.data[0].elderlyOpenid
    }

    const todayStr = new Date().toISOString().slice(0, 10)

    const snap = await db.collection('trajectories')
      .where({ openid: targetOpenid, dateStr: todayStr })
      .orderBy('recordedAt', 'asc')
      .limit(100)
      .get()

    const points = snap.data.map(t => ({
      latitude:   t.latitude,
      longitude:  t.longitude,
      address:    t.address || '',
      recordedAt: t.recordedAt
    }))

    return { code: 0, data: points }
  } catch (e) {
    console.error('[locationTrajectory]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}
