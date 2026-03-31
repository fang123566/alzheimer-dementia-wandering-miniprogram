// server/routes/auth.js
const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { get, run } = require('../db')

// 生成简单 token（生产环境用 JWT）
function genToken(userId) {
  return `token_${userId}_${Date.now()}`
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(`guardian:${password}`).digest('hex')
}

function mapUser(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    password: row.password,
    role: row.role,
    avatar: row.avatar || '',
    age: row.age,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function mapBinding(row) {
  if (!row) return null
  return {
    id: row.id,
    familyId: row.family_id,
    elderlyId: row.elderly_id,
    note: row.note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

// 从请求头解析当前用户（复用于多个路由）
async function getCurrentUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return null
  const match = token.match(/^token_(\d+)_/)
  if (!match) return null
  const row = await get('SELECT * FROM users WHERE id = ?', [parseInt(match[1])])
  return mapUser(row)
}

function toSafeUser(user) {
  if (!user) return null
  const { password: _, ...safeUser } = user
  return safeUser
}

async function formatBindingPayload(currentUser, binding) {
  if (!currentUser || !binding) return null

  const linkedUser = currentUser.role === 'family'
    ? mapUser(await get('SELECT * FROM users WHERE id = ?', [binding.elderlyId]))
    : mapUser(await get('SELECT * FROM users WHERE id = ?', [binding.familyId]))

  if (!linkedUser) return null

  return {
    binding: {
      ...binding,
      roleLabel: currentUser.role === 'family' ? '您守护的老人' : '关联家属',
      canUnbind: true
    },
    linkedUser: toSafeUser(linkedUser)
  }
}

async function getBindingRowsForUser(user) {
  if (!user) return []
  return user.role === 'family'
    ? await require('../db').all('SELECT * FROM bindings WHERE family_id = ? ORDER BY created_at DESC', [user.id])
    : await require('../db').all('SELECT * FROM bindings WHERE elderly_id = ? ORDER BY created_at DESC', [user.id])
}

async function formatBindingList(currentUser, rows) {
  const list = []
  for (const row of rows || []) {
    const item = await formatBindingPayload(currentUser, mapBinding(row))
    if (item) list.push(item)
  }
  return list
}

async function resolveLinkedUser(currentUser, linkedPhone) {
  const targetRole = currentUser.role === 'family' ? 'elderly' : 'family'
  return mapUser(await get('SELECT * FROM users WHERE phone = ? AND role = ?', [linkedPhone, targetRole]))
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
  if (password.length < 6) {
    return res.status(400).json({ code: 1, msg: '密码至少 6 位' })
  }

  ;(async () => {
    try {
      const existed = await get('SELECT id FROM users WHERE phone = ?', [phone])
      if (existed) {
        return res.status(400).json({ code: 1, msg: '该手机号已注册' })
      }

      const now = new Date().toISOString()
      const insertRes = await run(
        'INSERT INTO users (name, phone, password, role, avatar, age, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [name.trim(), phone.trim(), hashPassword(password), role, '', role === 'elderly' ? null : null, now, now]
      )

      const user = mapUser(await get('SELECT * FROM users WHERE id = ?', [insertRes.lastID]))
      const token = genToken(user.id)
      return res.json({ code: 0, msg: '注册成功', data: { token, user: toSafeUser(user) } })
    } catch (err) {
      return res.status(500).json({ code: 1, msg: '注册失败', detail: err.message })
    }
  })()
})

// POST /api/auth/login — 登录
router.post('/login', (req, res) => {
  const { phone, password } = req.body

  if (!phone || !password) {
    return res.status(400).json({ code: 1, msg: '请输入手机号和密码' })
  }

  ;(async () => {
    try {
      const user = mapUser(await get('SELECT * FROM users WHERE phone = ? AND password = ?', [phone.trim(), hashPassword(password)]))
      if (!user) {
        return res.status(401).json({ code: 1, msg: '手机号或密码错误' })
      }

      const token = genToken(user.id)
      return res.json({
        code: 0,
        msg: '登录成功',
        data: { token, user: toSafeUser(user) }
      })
    } catch (err) {
      return res.status(500).json({ code: 1, msg: '登录失败', detail: err.message })
    }
  })()
})

// POST /api/auth/logout — 登出
router.post('/logout', (req, res) => {
  res.json({ code: 0, msg: '已退出登录' })
})

// DELETE /api/auth/account — 注销账号
router.delete('/account', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })

  try {
    if (user.role === 'family') {
      await run('DELETE FROM bindings WHERE family_id = ?', [user.id])
    } else {
      await run('DELETE FROM bindings WHERE elderly_id = ?', [user.id])
    }
    await run('DELETE FROM users WHERE id = ?', [user.id])
    res.json({ code: 0, msg: '账号已注销' })
  } catch (err) {
    res.status(500).json({ code: 1, msg: '账号注销失败', detail: err.message })
  }
})

// GET /api/auth/profile — 获取当前用户信息（凭 token）
router.get('/profile', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })
  res.json({ code: 0, data: toSafeUser(user) })
})

// ── 账号关联 ────────────────────────────────────────────

// GET /api/auth/binding — 查询当前账号的绑定关系
router.get('/binding', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })

  const rows = await getBindingRowsForUser(user)
  return res.json({
    code: 0,
    data: await formatBindingList(user, rows),
    meta: {
      role: user.role,
      canCreateBinding: true,
      canUnbind: true
    }
  })
})

// POST /api/auth/binding — 家属绑定老人（传 elderlyPhone）
router.post('/binding', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })

  const linkedPhone = String(req.body.linkedPhone || req.body.elderlyPhone || req.body.familyPhone || '').trim()
  const note = String(req.body.note || '').trim()
  if (!linkedPhone) return res.status(400).json({ code: 1, msg: `请输入${user.role === 'family' ? '老人' : '家属'}手机号` })
  if (!/^1[3-9]\d{9}$/.test(linkedPhone)) {
    return res.status(400).json({ code: 1, msg: '手机号格式不正确' })
  }
  if (linkedPhone === user.phone) {
    return res.status(400).json({ code: 1, msg: '不能绑定自己的账号' })
  }

  try {
    const linkedUser = await resolveLinkedUser(user, linkedPhone)
    if (!linkedUser) {
      return res.status(404).json({ code: 1, msg: `未找到该手机号的${user.role === 'family' ? '老人' : '家属'}账号，请确认手机号正确` })
    }

    const familyId = user.role === 'family' ? user.id : linkedUser.id
    const elderlyId = user.role === 'family' ? linkedUser.id : user.id
    const existed = await get('SELECT id FROM bindings WHERE family_id = ? AND elderly_id = ?', [familyId, elderlyId])
    if (existed) {
      return res.status(400).json({ code: 1, msg: '该账号已在关联列表中' })
    }

    const now = new Date().toISOString()
    const insertRes = await run('INSERT INTO bindings (family_id, elderly_id, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [familyId, elderlyId, note, now, now])
    const binding = mapBinding(await get('SELECT * FROM bindings WHERE id = ?', [insertRes.lastID]))
    res.json({ code: 0, msg: '绑定成功', data: await formatBindingPayload(user, binding) })
  } catch (err) {
    res.status(500).json({ code: 1, msg: '绑定失败', detail: err.message })
  }
})

router.put('/binding/:id', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })

  const id = parseInt(req.params.id)
  const row = await get('SELECT * FROM bindings WHERE id = ?', [id])
  const binding = mapBinding(row)
  if (!binding) return res.status(404).json({ code: 1, msg: '绑定关系不存在' })

  const ownerMatched = user.role === 'family' ? binding.familyId === user.id : binding.elderlyId === user.id
  if (!ownerMatched) return res.status(403).json({ code: 1, msg: '无权修改该绑定关系' })

  const nextNote = req.body.note !== undefined ? String(req.body.note || '').trim() : binding.note
  let familyId = binding.familyId
  let elderlyId = binding.elderlyId

  if (req.body.linkedPhone !== undefined) {
    const linkedPhone = String(req.body.linkedPhone || '').trim()
    if (!linkedPhone) return res.status(400).json({ code: 1, msg: '请输入关联手机号' })
    if (!/^1[3-9]\d{9}$/.test(linkedPhone)) return res.status(400).json({ code: 1, msg: '手机号格式不正确' })
    const linkedUser = await resolveLinkedUser(user, linkedPhone)
    if (!linkedUser) {
      return res.status(404).json({ code: 1, msg: `未找到该手机号的${user.role === 'family' ? '老人' : '家属'}账号` })
    }
    familyId = user.role === 'family' ? user.id : linkedUser.id
    elderlyId = user.role === 'family' ? linkedUser.id : user.id
    const existed = await get('SELECT id FROM bindings WHERE family_id = ? AND elderly_id = ? AND id <> ?', [familyId, elderlyId, binding.id])
    if (existed) return res.status(400).json({ code: 1, msg: '该账号已在关联列表中' })
  }

  const now = new Date().toISOString()
  await run('UPDATE bindings SET family_id = ?, elderly_id = ?, note = ?, updated_at = ? WHERE id = ?', [familyId, elderlyId, nextNote, now, binding.id])
  const updated = mapBinding(await get('SELECT * FROM bindings WHERE id = ?', [binding.id]))
  return res.json({ code: 0, msg: '已更新', data: await formatBindingPayload(user, updated) })
})

router.delete('/binding/:id', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })

  try {
    const id = parseInt(req.params.id)
    const row = await get('SELECT * FROM bindings WHERE id = ?', [id])
    const binding = mapBinding(row)
    if (!binding) return res.status(404).json({ code: 1, msg: '没有绑定关系' })
    const ownerMatched = user.role === 'family' ? binding.familyId === user.id : binding.elderlyId === user.id
    if (!ownerMatched) return res.status(403).json({ code: 1, msg: '无权删除该绑定关系' })
    const result = await run('DELETE FROM bindings WHERE id = ?', [id])
    if (!result.changes) return res.status(404).json({ code: 1, msg: '没有绑定关系' })
    res.json({ code: 0, msg: '已解除绑定' })
  } catch (err) {
    res.status(500).json({ code: 1, msg: '解绑失败', detail: err.message })
  }
})

module.exports = router
