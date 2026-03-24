// server/routes/location.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')

// GET /api/location — 获取当前位置
router.get('/', (req, res) => {
  res.json({ code: 0, data: store.location })
})

// POST /api/location — 上报位置（设备端调用）
router.post('/', (req, res) => {
  const { latitude, longitude, address, battery, distance } = req.body
  if (!latitude || !longitude) {
    return res.status(400).json({ code: 1, msg: '缺少经纬度参数' })
  }
  store.location = {
    ...store.location,
    latitude,
    longitude,
    address: address || store.location.address,
    battery: battery !== undefined ? battery : store.location.battery,
    distance: distance !== undefined ? distance : store.location.distance,
    updatedAt: new Date().toISOString()
  }

  // 检查是否越出围栏
  const inFence = store.fences.some(fence => {
    if (!fence.enabled) return false
    const R = 6371000
    const dLat = (latitude - fence.latitude) * Math.PI / 180
    const dLon = (longitude - fence.longitude) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(fence.latitude * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2
    const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return dist <= fence.radius
  })

  store.location.status = inFence ? 'safe' : 'warning'

  res.json({ code: 0, data: store.location })
})

// GET /api/location/trajectory — 今日轨迹
router.get('/trajectory', (req, res) => {
  res.json({ code: 0, data: store.trajectory })
})

// GET /api/location/fences — 获取安全围栏列表
router.get('/fences', (req, res) => {
  res.json({ code: 0, data: store.fences })
})

// POST /api/location/fences — 添加安全围栏
router.post('/fences', (req, res) => {
  const { name, latitude, longitude, radius } = req.body
  if (!name || !latitude || !longitude || !radius) {
    return res.status(400).json({ code: 1, msg: '缺少围栏参数' })
  }
  const fence = {
    id: store.nextId(store.fences),
    name, latitude, longitude, radius,
    enabled: true
  }
  store.fences.push(fence)
  res.json({ code: 0, data: fence })
})

// PATCH /api/location/fences/:id — 切换围栏开关
router.patch('/fences/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const fence = store.fences.find(f => f.id === id)
  if (!fence) return res.status(404).json({ code: 1, msg: '围栏不存在' })
  fence.enabled = req.body.enabled !== undefined ? req.body.enabled : !fence.enabled
  res.json({ code: 0, data: fence })
})

// DELETE /api/location/fences/:id — 删除围栏
router.delete('/fences/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const idx = store.fences.findIndex(f => f.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '围栏不存在' })
  store.fences.splice(idx, 1)
  res.json({ code: 0, msg: '已删除' })
})

module.exports = router
