// server/routes/sos.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')

// POST /api/sos — 触发 SOS 紧急求助
router.post('/', (req, res) => {
  const { latitude, longitude, address } = req.body

  // 更新位置为紧急状态
  store.location.status = 'emergency'
  if (latitude)  store.location.latitude  = latitude
  if (longitude) store.location.longitude = longitude
  if (address)   store.location.address   = address
  store.location.updatedAt = new Date().toISOString()

  // 写入紧急预警
  const now = new Date()
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const alert = {
    id: store.nextId(store.alerts),
    level: 'danger',
    type: 'SOS 紧急求助',
    content: `老人主动触发 SOS！当前位置：${address || store.location.address}，请立即确认安全状况`,
    location: address || store.location.address,
    phone: store.contacts[0]?.phone || '',
    category: 'lost',
    read: false,
    time: now.toISOString(),
    timeLabel: `今天 ${timeStr}`
  }
  store.alerts.unshift(alert)

  res.json({
    code: 0,
    msg: 'SOS 已发送',
    data: {
      alert,
      contacts: store.contacts,
      location: store.location
    }
  })
})

module.exports = router
