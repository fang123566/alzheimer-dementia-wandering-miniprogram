// cloudfunctions/locationUpdate/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID || '获取失败'
  
  console.log('=====================================')
  console.log('当前用户 OPENID：', openid)
  console.log('=====================================')
  const { latitude, longitude, address, distance } = event

  if (!latitude || !longitude) {
    return { code: 1, msg: '缺少经纬度参数' }
  }

  try {
    // 查老人表 elderly，用 _openid 字段匹配
    const userSnap = await db.collection('elderly').where({ _openid: openid }).get()
    if (!userSnap.data.length) {
      return { 
        code: 1, 
        msg: '用户不存在',
        currentOpenid: openid,
        tip: '请先注册老人账号，再上报位置'
      }
    }

    const user = userSnap.data[0]
    // 双重校验角色
    if (user.role !== 'elderly') {
      return { code: 1, msg: '仅老人端可上报位置' }
    }

    // 判断围栏状态
    const fenceSnap = await db.collection('fences')
      .where({ ownerOpenid: openid, enabled: true })
      .get()

    let status = 'safe'
    let minDistance = Infinity

    fenceSnap.data.forEach(fence => {
      const dist = getDistanceMeters(latitude, longitude, fence.latitude, fence.longitude)
      if (dist < minDistance) minDistance = dist
      if (dist > fence.radius) {
        status = status === 'safe' ? 'warning' : status
        if (dist > fence.radius * 1.5) status = 'emergency'
      }
    })

    const now = db.serverDate()
    const locData = {
      openid,
      latitude,
      longitude,
      address: address || '',
      distance: minDistance === Infinity ? (distance || 0) : Math.round(minDistance),
      status,
      updatedAt: now
    }

    // upsert：有记录则更新，无则新建
    const existSnap = await db.collection('locations')
      .where({ openid })
      .limit(1)
      .get()

    if (existSnap.data.length) {
      await db.collection('locations').doc(existSnap.data[0]._id).update({ data: locData })
    } else {
      locData.createdAt = now
      await db.collection('locations').add({ data: locData })
    }

    // 同时写一条轨迹记录
    await db.collection('trajectories').add({
      data: {
        openid,
        latitude,
        longitude,
        address: address || '',
        recordedAt: now,
        dateStr: new Date().toISOString().slice(0, 10)
      }
    })

    return {
      code: 0,
      data: {
        latitude,
        longitude,
        address: address || '',
        status,
        distance: locData.distance,
        updatedAt: new Date().toISOString()
      }
    }
  } catch (e) {
    console.error('[locationUpdate]', e)
    return { code: 500, msg: e.message || '服务器错误' }
  }
}

/** Haversine 距离（米） */
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}