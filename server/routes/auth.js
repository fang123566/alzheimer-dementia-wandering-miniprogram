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
    createdAt: row.created_at
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
      canUnbind: currentUser.role === 'family'
    },
    linkedUser: toSafeUser(linkedUser)
  }
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

  const bindingRow = user.role === 'family'
    ? await get('SELECT * FROM bindings WHERE family_id = ?', [user.id])
    : await get('SELECT * FROM bindings WHERE elderly_id = ?', [user.id])
  const binding = mapBinding(bindingRow)

  if (!binding) {
    return res.json({
      code: 0,
      data: null,
      meta: {
        role: user.role,
        canCreateBinding: user.role === 'family',
        canUnbind: user.role === 'family'
      }
    })
  }

  return res.json({
    code: 0,
    data: await formatBindingPayload(user, binding),
    meta: {
      role: user.role,
      canCreateBinding: user.role === 'family',
      canUnbind: user.role === 'family'
    }
  })
})

// POST /api/auth/binding — 家属绑定老人（传 elderlyPhone）
router.post('/binding', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })
  if (user.role !== 'family') {
    return res.status(400).json({ code: 1, msg: '只有家属端可以发起绑定' })
  }

  const elderlyPhone = String(req.body.elderlyPhone || '').trim()
  if (!elderlyPhone) return res.status(400).json({ code: 1, msg: '请输入老人手机号' })
  if (!/^1[3-9]\d{9}$/.test(elderlyPhone)) {
    return res.status(400).json({ code: 1, msg: '手机号格式不正确' })
  }
  if (elderlyPhone === user.phone) {
    return res.status(400).json({ code: 1, msg: '不能绑定自己的账号' })
  }

  try {
    const elderly = mapUser(await get('SELECT * FROM users WHERE phone = ? AND role = ?', [elderlyPhone, 'elderly']))
    if (!elderly) {
      return res.status(404).json({ code: 1, msg: '未找到该手机号的老人账号，请确认手机号正确' })
    }

    const familyBinding = await get('SELECT id FROM bindings WHERE family_id = ?', [user.id])
    if (familyBinding) {
      return res.status(400).json({ code: 1, msg: '您已绑定一位老人，请先解绑' })
    }
    const elderlyBinding = await get('SELECT id FROM bindings WHERE elderly_id = ?', [elderly.id])
    if (elderlyBinding) {
      return res.status(400).json({ code: 1, msg: '该老人账号已被其他家属绑定' })
    }

    const now = new Date().toISOString()
    const insertRes = await run('INSERT INTO bindings (family_id, elderly_id, created_at) VALUES (?, ?, ?)', [user.id, elderly.id, now])
    const binding = mapBinding(await get('SELECT * FROM bindings WHERE id = ?', [insertRes.lastID]))
    res.json({ code: 0, msg: '绑定成功', data: await formatBindingPayload(user, binding) })
  } catch (err) {
    res.status(500).json({ code: 1, msg: '绑定失败', detail: err.message })
  }
})

// DELETE /api/auth/binding — 解绑
router.delete('/binding', async (req, res) => {
  const user = await getCurrentUser(req)
  if (!user) return res.status(401).json({ code: 1, msg: '未登录' })
  if (user.role !== 'family') {
    return res.status(403).json({ code: 1, msg: '当前仅支持家属端解绑' })
  }

  try {
    const result = await run('DELETE FROM bindings WHERE family_id = ?', [user.id])
    if (!result.changes) return res.status(404).json({ code: 1, msg: '没有绑定关系' })
    res.json({ code: 0, msg: '已解除绑定' })
  } catch (err) {
    res.status(500).json({ code: 1, msg: '解绑失败', detail: err.message })
  }
})

module.exports = router
