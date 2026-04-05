// cloudfunctions/locationGetCurrent/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID

  try {
    // 查找当前用户绑定的老人 openid（family 查老人；elderly 查自己）
    const userSnap = await db.collection('users').where({ openid }).get()
    if (!userSnap.data.length) return { code: 1, msg: '用户不存在' }

    const user = userSnap.data[0]
    let targetOpenid = openid

    if (user.role === 'family') {
      // 通过绑定关系找老人
      const bindSnap = await db.collection('bindings')
        .where({ familyOpenid: openid })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get()
      if (!bindSnap.data.length) return { code: 1, msg: '未绑定老人账号' }
      targetOpenid = bindSnap.data[0].elderlyOpenid
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
