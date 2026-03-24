// server/routes/memory.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')

// GET /api/memory/photos — 获取照片列表，支持 ?member=m1
router.get('/photos', (req, res) => {
  const { member } = req.query
  const list = member ? store.photos.filter(p => p.members.includes(member)) : store.photos
  res.json({ code: 0, data: list })
})

// GET /api/memory/photos/:id — 获取单张照片
router.get('/photos/:id', (req, res) => {
  const photo = store.photos.find(p => p.id === parseInt(req.params.id))
  if (!photo) return res.status(404).json({ code: 1, msg: '照片不存在' })
  res.json({ code: 0, data: photo })
})

// POST /api/memory/photos — 新增照片记录
router.post('/photos', (req, res) => {
  const { thumb, caption, members } = req.body
  const photo = {
    id: store.nextId(store.photos),
    thumb: thumb || '',
    caption: caption || '',
    members: members || [],
    createdAt: new Date().toISOString()
  }
  store.photos.unshift(photo)
  res.json({ code: 0, data: photo })
})

// PUT /api/memory/photos/:id — 更新照片信息（标注成员、修改说明）
router.put('/photos/:id', (req, res) => {
  const photo = store.photos.find(p => p.id === parseInt(req.params.id))
  if (!photo) return res.status(404).json({ code: 1, msg: '照片不存在' })
  const { caption, members } = req.body
  if (caption !== undefined) photo.caption = caption
  if (members !== undefined) photo.members = members
  res.json({ code: 0, data: photo })
})

// DELETE /api/memory/photos/:id — 删除照片
router.delete('/photos/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const idx = store.photos.findIndex(p => p.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '照片不存在' })
  store.photos.splice(idx, 1)
  res.json({ code: 0, msg: '已删除' })
})

// GET /api/memory/members — 获取家庭成员列表
router.get('/members', (req, res) => {
  res.json({ code: 0, data: store.members })
})

// POST /api/memory/members — 添加成员
router.post('/members', (req, res) => {
  const { name, relation, avatar } = req.body
  if (!name || !relation) return res.status(400).json({ code: 1, msg: '缺少姓名或关系' })
  const member = {
    id: `m${store.nextId(store.members.map((m, i) => ({ id: i + 1 })))}`,
    name, relation,
    avatar: avatar || ''
  }
  store.members.push(member)
  res.json({ code: 0, data: member })
})

// GET /api/memory/hints — 获取 AI 记忆提示列表
router.get('/hints', (req, res) => {
  res.json({ code: 0, data: store.memoryHints })
})

// POST /api/memory/hints — 添加记忆提示
router.post('/hints', (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ code: 1, msg: '提示内容不能为空' })
  const hint = {
    id: store.nextId(store.memoryHints),
    text
  }
  store.memoryHints.push(hint)
  res.json({ code: 0, data: hint })
})

// DELETE /api/memory/hints/:id — 删除记忆提示
router.delete('/hints/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const idx = store.memoryHints.findIndex(h => h.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '提示不存在' })
  store.memoryHints.splice(idx, 1)
  res.json({ code: 0, msg: '已删除' })
})

module.exports = router
