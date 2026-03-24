// server/routes/alerts.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')

// GET /api/alerts — 获取预警列表，支持 ?category=lost|fraud|fence|health
router.get('/', (req, res) => {
  const { category } = req.query
  const list = category ? store.alerts.filter(a => a.category === category) : store.alerts
  const unread = store.alerts.filter(a => !a.read).length
  res.json({ code: 0, data: list, unread })
})

// GET /api/alerts/unread-count — 未读数量
router.get('/unread-count', (req, res) => {
  const count = store.alerts.filter(a => !a.read).length
  res.json({ code: 0, data: { count } })
})

// GET /api/alerts/:id — 获取单条预警
router.get('/:id', (req, res) => {
  const alert = store.alerts.find(a => a.id === parseInt(req.params.id))
  if (!alert) return res.status(404).json({ code: 1, msg: '预警不存在' })
  res.json({ code: 0, data: alert })
})

// POST /api/alerts — 新建预警（系统内部或设备端触发）
router.post('/', (req, res) => {
  const { level, type, content, location, phone, category } = req.body
  if (!level || !type || !content || !category) {
    return res.status(400).json({ code: 1, msg: '缺少必填字段' })
  }
  const now = new Date()
  const alert = {
    id: store.nextId(store.alerts),
    level, type, content,
    location: location || '',
    phone: phone || '',
    category,
    read: false,
    time: now.toISOString(),
    timeLabel: `今天 ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  }
  store.alerts.unshift(alert)
  res.json({ code: 0, data: alert })
})

// PATCH /api/alerts/:id/read — 标记已读
router.patch('/:id/read', (req, res) => {
  const alert = store.alerts.find(a => a.id === parseInt(req.params.id))
  if (!alert) return res.status(404).json({ code: 1, msg: '预警不存在' })
  alert.read = true
  res.json({ code: 0, data: alert })
})

// PATCH /api/alerts/read-all — 全部标记已读
router.patch('/read-all', (req, res) => {
  store.alerts.forEach(a => { a.read = true })
  res.json({ code: 0, msg: '全部已读' })
})

// DELETE /api/alerts/:id — 删除预警
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const idx = store.alerts.findIndex(a => a.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '预警不存在' })
  store.alerts.splice(idx, 1)
  res.json({ code: 0, msg: '已删除' })
})

module.exports = router
