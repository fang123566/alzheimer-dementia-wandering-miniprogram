// server/routes/auth.js
const express = require('express')
const router = express.Router()

// 内存用户表（生产环境替换为数据库）
const users = [
  {
    id: 1,
    name: '王建国',
    phone: '13800000001',
    password: '123456',
    role: 'family',
    avatar: '',
    createdAt: '2024-01-01'
  },
  {
    id: 2,
    name: '王建明',
    phone: '13900000001',
    password: '123456',
    role: 'elderly',
    avatar: '',
    createdAt: '2024-01-01'
  }
]

// 账号绑定表（家属 ↔ 老人）
const bindings = [
  { id: 1, familyId: 1, elderlyId: 2, createdAt: '2024-01-01' }
]
let nextBindingId = 2
let nextUserId = 3

// 生成简单 token（生产环境用 JWT）
function genToken(userId) {
  return `token_${userId}_${Date.now()}`
}

// 从请求头解析当前用户（复用于多个路由）
function getCurrentUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const match = token.match(/^token_(\d+)_/)
  if (!match) return null
  return users.find(u => u.id === parseInt(match[1])) || null
}

// POST /api/auth/register — 注册
router.post('/register', (req, res) => {
  const { name, phone, password, role } = req.body

  if (!name || !phone || !password || !role) {
    return res.status(400).json({ code: 1, msg: '请填写完整信息' })
  }
  if (!['family', 'elderly'].includes(role)) {
    return res.status(400).json({ code: 1, msg: '角色参数错误' })
  }
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    return res.status(400).json({ code: 1, msg: '手机号格式不正确' })
  }
  if (users.find(u => u.phone === phone)) {
    return res.status(400).json({ code: 1, msg: '该手机号已注册' })
  }
  if (password.length < 6) {
    return res.status(400).json({ code: 1, msg: '密码至少 6 位' })
  }

  const user = {
    id: nextUserId++,
    name, phone, password, role,
    avatar: '',
    createdAt: new Date().toISOString().slice(0, 10)
  }
  users.push(user)

  const token = genToken(user.id)
  const { password: _, ...safeUser } = user

  res.json({
    code: 0,
    msg: '注册成功',
    data: { token, user: safeUser }
  })
})

// POST /api/auth/login — 登录
router.post('/login', (req, res) => {
  const { phone, password } = req.body

  if (!phone || !password) {
    return res.status(400).json({ code: 1, msg: '请输入手机号和密码' })
  }

  const user = users.find(u => u.phone === phone && u.password === password)
  if (!user) {
    return res.status(401).json({ code: 1, msg: '手机号或密码错误' })
  }

  const token = genToken(user.id)
  const { password: _, ...safeUser } = user

  res.json({
    code: 0,
    msg: '登录成功',
    data: { token, user: safeUser }
  })
})

// POST /api/auth/logout — 登出
router.post('/logout', (req, res) => {
  res.json({ code: 0, msg: '已退出登录' })
})

// GET /api/auth/profile — 获取当前用户信息（凭 token）
router.get('/profile', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ code: 1, msg: '未登录' })

  // 从 token 中解析 userId（生产环境用 JWT verify）
  const match = token.match(/^token_(\d+)_/)
  if (!match) return res.status(401).json({ code: 1, msg: 'token 无效' })

  const user = users.find(u => u.id === parseInt(match[1]))
  if (!user) return res.status(401).json({ code: 1, msg: '用户不存在' })

  const { password: _, ...safeUser } = user
  res.json({ code: 0, data: safeUser })
})

// ── 账号关联 ────────────────────────────────────────────

// GET /api/auth/binding — 查询当前账号的绑定关系
router.get('/binding', (req, res) => {
  const user = getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })

  let binding
  if (user.role === 'family') {
    binding = bindings.find(b => b.familyId === user.id)
    if (!binding) return res.json({ code: 0, data: null })
    const elderly = users.find(u => u.id === binding.elderlyId)
    if (!elderly) return res.json({ code: 0, data: null })
    const { password: _, ...safe } = elderly
    return res.json({ code: 0, data: { binding, linkedUser: safe } })
  } else {
    binding = bindings.find(b => b.elderlyId === user.id)
    if (!binding) return res.json({ code: 0, data: null })
    const family = users.find(u => u.id === binding.familyId)
    if (!family) return res.json({ code: 0, data: null })
    const { password: _, ...safe } = family
    return res.json({ code: 0, data: { binding, linkedUser: safe } })
  }
})

// POST /api/auth/binding — 家属绑定老人（传 elderlyPhone）
router.post('/binding', (req, res) => {
  const user = getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })
  if (user.role !== 'family') {
    return res.status(400).json({ code: 1, msg: '只有家属端可以发起绑定' })
  }

  const { elderlyPhone } = req.body
  if (!elderlyPhone) return res.status(400).json({ code: 1, msg: '请输入老人手机号' })

  const elderly = users.find(u => u.phone === elderlyPhone && u.role === 'elderly')
  if (!elderly) {
    return res.status(404).json({ code: 1, msg: '未找到该手机号的老人账号，请确认手机号正确' })
  }

  if (bindings.find(b => b.familyId === user.id)) {
    return res.status(400).json({ code: 1, msg: '您已绑定一位老人，请先解绑' })
  }
  if (bindings.find(b => b.elderlyId === elderly.id)) {
    return res.status(400).json({ code: 1, msg: '该老人账号已被其他家属绑定' })
  }

  const binding = {
    id: nextBindingId++,
    familyId: user.id,
    elderlyId: elderly.id,
    createdAt: new Date().toISOString()
  }
  bindings.push(binding)

  const { password: _, ...safeElderly } = elderly
  res.json({ code: 0, msg: '绑定成功', data: { binding, linkedUser: safeElderly } })
})

// DELETE /api/auth/binding — 解绑
router.delete('/binding', (req, res) => {
  const user = getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })

  const idx = user.role === 'family'
    ? bindings.findIndex(b => b.familyId === user.id)
    : bindings.findIndex(b => b.elderlyId === user.id)

  if (idx === -1) return res.status(404).json({ code: 1, msg: '没有绑定关系' })

  bindings.splice(idx, 1)
  res.json({ code: 0, msg: '已解除绑定' })
})

module.exports = router
