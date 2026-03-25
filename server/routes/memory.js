// server/routes/memory.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')
const multer = require('multer')
const path = require('path')
const fs = require('fs')

const uploadsRoot = path.join(__dirname, '../uploads/memory')
if (!fs.existsSync(uploadsRoot)) {
  fs.mkdirSync(uploadsRoot, { recursive: true })
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const mediaType = req.body.mediaType === 'audio' ? 'audio' : (req.body.mediaType === 'video' ? 'video' : 'image')
    const dir = path.join(uploadsRoot, mediaType)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || (req.body.mediaType === 'audio' ? '.mp3' : '')
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`)
  }
})

const upload = multer({ storage })

// POST /api/memory/upload — 上传媒体文件
router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ code: 1, msg: '未接收到文件' })
  const mediaType = req.body.mediaType === 'audio' ? 'audio' : (req.body.mediaType === 'video' ? 'video' : 'image')
  const relativePath = `/uploads/memory/${mediaType}/${req.file.filename}`
  res.json({
    code: 0,
    data: {
      url: relativePath,
      filename: req.file.filename,
      size: req.file.size,
      mediaType
    }
  })
})

// GET /api/memory/photos — 获取媒体列表，支持 ?member=m1&type=image|video
router.get('/photos', (req, res) => {
  const { member, type } = req.query
  let list = [...store.photos]
  if (member) list = list.filter(p => (p.members || []).includes(member))
  if (type) list = list.filter(p => p.type === type)
  res.json({ code: 0, data: list })
})

// GET /api/memory/photos/:id — 获取单条记忆媒体
router.get('/photos/:id', (req, res) => {
  const photo = store.photos.find(p => p.id === parseInt(req.params.id))
  if (!photo) return res.status(404).json({ code: 1, msg: '记忆内容不存在' })
  res.json({ code: 0, data: photo })
})

// POST /api/memory/photos — 新增记忆媒体
router.post('/photos', (req, res) => {
  const { type, thumb, url, cover, caption, story, voiceNote, members, location, createdAt } = req.body
  const photo = {
    id: store.nextId(store.photos),
    type: type === 'video' ? 'video' : 'image',
    thumb: thumb || '',
    url: url || thumb || '',
    cover: cover || thumb || '',
    caption: caption || '',
    story: story || '',
    voiceNote: {
      url: voiceNote?.url || '',
      duration: voiceNote?.duration || 0,
      text: voiceNote?.text || ''
    },
    members: members || [],
    location: location || '',
    createdAt: createdAt || new Date().toISOString()
  }
  store.photos.unshift(photo)
  res.json({ code: 0, data: photo })
})

// PUT /api/memory/photos/:id — 更新记忆媒体信息
router.put('/photos/:id', (req, res) => {
  const photo = store.photos.find(p => p.id === parseInt(req.params.id))
  if (!photo) return res.status(404).json({ code: 1, msg: '记忆内容不存在' })
  const { type, thumb, url, cover, caption, story, voiceNote, members, location, createdAt } = req.body
  if (type !== undefined) photo.type = type === 'video' ? 'video' : 'image'
  if (thumb !== undefined) photo.thumb = thumb
  if (url !== undefined) photo.url = url
  if (cover !== undefined) photo.cover = cover
  if (caption !== undefined) photo.caption = caption
  if (story !== undefined) photo.story = story
  if (voiceNote !== undefined) {
    photo.voiceNote = {
      url: voiceNote?.url !== undefined ? voiceNote.url : (photo.voiceNote?.url || ''),
      duration: voiceNote?.duration !== undefined ? voiceNote.duration : (photo.voiceNote?.duration || 0),
      text: voiceNote?.text !== undefined ? voiceNote.text : (photo.voiceNote?.text || '')
    }
  }
  if (members !== undefined) photo.members = members
  if (location !== undefined) photo.location = location
  if (createdAt !== undefined) photo.createdAt = createdAt
  res.json({ code: 0, data: photo })
})

// DELETE /api/memory/photos/:id — 删除记忆媒体
router.delete('/photos/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const idx = store.photos.findIndex(p => p.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '记忆内容不存在' })
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

// PUT /api/memory/members/:id — 更新成员信息
router.put('/members/:id', (req, res) => {
  const member = store.members.find(m => m.id === req.params.id)
  if (!member) return res.status(404).json({ code: 1, msg: '成员不存在' })
  const { name, relation, avatar } = req.body
  if (name !== undefined) member.name = name
  if (relation !== undefined) member.relation = relation
  if (avatar !== undefined) member.avatar = avatar
  res.json({ code: 0, data: member })
})

// DELETE /api/memory/members/:id — 删除成员
router.delete('/members/:id', (req, res) => {
  const id = req.params.id
  const idx = store.members.findIndex(m => m.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '成员不存在' })
  // 从所有照片中移除该成员的标注
  store.photos.forEach(p => {
    p.members = p.members.filter(m => m !== id)
  })
  store.members.splice(idx, 1)
  res.json({ code: 0, msg: '已删除' })
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
