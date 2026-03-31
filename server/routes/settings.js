// server/routes/settings.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')

// GET /api/settings — 获取全部设置
router.get('/', (req, res) => {
  res.json({
    code: 0,
    data: {
      settings: store.settings,
      elderly: store.elderly,
      family: store.family
    }
  })
})

// PUT /api/settings — 更新设置项
router.put('/', (req, res) => {
  const allowed = ['dialect', 'speechSpeed', 'sensitivity', 'notifyMethod', 'nightMode', 'nightStart', 'nightEnd']
  allowed.forEach(key => {
    if (req.body[key] !== undefined) store.settings[key] = req.body[key]
  })
  res.json({ code: 0, data: store.settings })
})

// PUT /api/settings/elderly — 更新老人信息
router.put('/elderly', (req, res) => {
  const { name, age, avatar } = req.body
  if (name !== undefined) store.elderly.name = name
  if (age !== undefined) store.elderly.age = age
  if (avatar !== undefined) store.elderly.avatar = avatar
  res.json({ code: 0, data: store.elderly })
})

// GET /api/settings/contacts — 获取紧急联系人
router.get('/contacts', (req, res) => {
  res.json({ code: 0, data: store.contacts })
})

// POST /api/settings/contacts — 添加联系人
router.post('/contacts', (req, res) => {
  const { avatar, relation, name, phone, priority } = req.body
  if (!name || !phone || !relation) {
    return res.status(400).json({ code: 1, msg: '缺少姓名、电话或关系' })
  }
  const contact = {
    id: store.nextId(store.contacts),
    avatar: avatar || '👤',
    relation, name, phone,
    priority: priority || store.contacts.length + 1
  }
  store.contacts.push(contact)
  res.json({ code: 0, data: contact })
})

// PUT /api/settings/contacts/:id — 更新联系人
router.put('/contacts/:id', (req, res) => {
  const contact = store.contacts.find(c => c.id === parseInt(req.params.id))
  if (!contact) return res.status(404).json({ code: 1, msg: '联系人不存在' })
  const fields = ['avatar', 'relation', 'name', 'phone', 'priority']
  fields.forEach(f => { if (req.body[f] !== undefined) contact[f] = req.body[f] })
  res.json({ code: 0, data: contact })
})

// DELETE /api/settings/contacts/:id — 删除联系人
router.delete('/contacts/:id', (req, res) => {
  const id = parseInt(req.params.id)
  const idx = store.contacts.findIndex(c => c.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '联系人不存在' })
  store.contacts.splice(idx, 1)
  res.json({ code: 0, msg: '已删除' })
})

// GET /api/settings/keywords — 获取防诈关键词
router.get('/keywords', (req, res) => {
  res.json({ code: 0, data: store.fraudKeywords })
})

// POST /api/settings/keywords — 添加关键词
router.post('/keywords', (req, res) => {
  const { keyword } = req.body
  if (!keyword || !keyword.trim()) {
    return res.status(400).json({ code: 1, msg: '关键词不能为空' })
  }
  const kw = keyword.trim()
  if (store.fraudKeywords.includes(kw)) {
    return res.status(400).json({ code: 1, msg: '关键词已存在' })
  }
  store.fraudKeywords.push(kw)
  res.json({ code: 0, data: store.fraudKeywords })
})

// DELETE /api/settings/keywords/:keyword — 删除关键词
router.delete('/keywords/:keyword', (req, res) => {
  const kw = decodeURIComponent(req.params.keyword)
  const idx = store.fraudKeywords.indexOf(kw)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '关键词不存在' })
  store.fraudKeywords.splice(idx, 1)
  res.json({ code: 0, data: store.fraudKeywords })
})

module.exports = router
