const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// ── 工具函数 ──────────────────────────────────────────
function genElderlyId() {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `EL-${ts}-${rand}`
}

function hashPassword(pwd) {
  const SALT = 'your_custom_salt_2026'
  return crypto.createHash('sha256').update(pwd + SALT).digest('hex')
}

function genToken(userId, role) {
  const payload = `${userId}:${role}:${Date.now()}`
  return crypto.createHash('sha256').update(payload).digest('hex')
}

function safeUser(user) {
  if (!user) return null
  const { password, ...safe } = user
  return safe
}

/** 根据 openid 在 elderly 和 family 集合中查找用户 */
async function findUserByOpenid(openid) {
  const [resE, resF] = await Promise.all([
    db.collection('elderly').where({ _openid: openid }).limit(1).get(),
    db.collection('family').where({ _openid: openid }).limit(1).get()
  ])
  return resE.data[0] || resF.data[0] || null
}

// ── 注册 ──────────────────────────────────────────────
async function register(openid, { name, phone, password, role }) {
  try {
    const col = role === 'elderly' ? 'elderly' : 'family'
    const existRes = await db.collection(col).where({ phone }).count()
    if (existRes.total > 0) {
      return { code: 1, msg: `该手机号已注册为${role === 'elderly' ? '老人' : '家属'}账号` }
    }

    const now = new Date()
    const baseUser = {
      _openid: openid,
      name,
      phone,
      password: hashPassword(password),
      role,
      avatar: '',
      createdAt: now,
      updatedAt: now
    }

    if (role === 'elderly') {
      baseUser.elderlyId = genElderlyId()
      baseUser.age = ''
      baseUser.bindFamilyIds = []
    } else {
      baseUser.bindElderlyId = ''
    }

    const addRes = await db.collection(col).add({ data: baseUser })
    const { password: _, ...safe } = baseUser
    safe._id = addRes._id

    const token = genToken(addRes._id, role)
    await db.collection('tokens').add({
      data: { userId: addRes._id, openid, role, token, createdAt: now }
    })

    return { code: 0, msg: '注册成功', data: { token, user: safe } }
  } catch (err) {
    console.error('注册失败：', err)
    return { code: 2, msg: `注册失败：${err.message || '数据库操作异常'}` }
  }
}

// ── 登录 ──────────────────────────────────────────────
async function login(openid, { phone, password }) {
  try {
    const hashed = hashPassword(password)
    const [resE, resF] = await Promise.all([
      db.collection('elderly').where({ phone, password: hashed }).get(),
      db.collection('family').where({ phone, password: hashed }).get()
    ])

    const user = resE.data[0] || resF.data[0]
    if (!user) {
      return { code: 1, msg: '手机号或密码错误' }
    }

    // 关联 openid（首次登录或换设备登录时更新）
    const col = user.role === 'elderly' ? 'elderly' : 'family'
    if (user._openid !== openid) {
      await db.collection(col).doc(user._id).update({
        data: { _openid: openid, updatedAt: new Date() }
      })
    }

    const token = genToken(user._id, user.role)
    await db.collection('tokens').add({
      data: { userId: user._id, openid, role: user.role, token, createdAt: new Date() }
    })

    const safe = safeUser(user)
    safe._openid = openid
    return { code: 0, msg: '登录成功', data: { token, user: safe } }
  } catch (err) {
    console.error('登录失败：', err)
    return { code: 2, msg: `登录失败：${err.message || '数据库操作异常'}` }
  }
}

// ── 退出登录 ──────────────────────────────────────────
async function logout(openid) {
  try {
    const res = await db.collection('tokens').where({ openid }).get()
    for (const doc of res.data) {
      await db.collection('tokens').doc(doc._id).remove()
    }
  } catch (e) { /* 忽略 */ }
  return { code: 0, msg: '已退出登录' }
}

// ── 获取用户信息 ──────────────────────────────────────
async function getProfile(openid) {
  try {
    const user = await findUserByOpenid(openid)
    if (!user) return { code: 1, msg: '用户不存在' }
    return { code: 0, data: safeUser(user) }
  } catch (err) {
    return { code: 2, msg: '获取用户信息失败' }
  }
}

// ── 更新昵称 ──────────────────────────────────────────
async function updateProfile(openid, { name }) {
  if (!name || !name.trim()) {
    return { code: 1, msg: '昵称不能为空' }
  }
  try {
    const user = await findUserByOpenid(openid)
    if (!user) return { code: 1, msg: '用户不存在' }

    const col = user.role === 'elderly' ? 'elderly' : 'family'
    await db.collection(col).doc(user._id).update({
      data: { name: name.trim(), updatedAt: new Date() }
    })

    const updated = await findUserByOpenid(openid)
    return { code: 0, msg: '已更新', data: safeUser(updated) }
  } catch (err) {
    return { code: 2, msg: '更新失败' }
  }
}

// ── 更新头像（接收云存储 fileID） ─────────────────────
async function uploadAvatar(openid, { fileID }) {
  if (!fileID) return { code: 1, msg: '请选择图片' }
  try {
    const user = await findUserByOpenid(openid)
    if (!user) return { code: 1, msg: '用户不存在' }

    const col = user.role === 'elderly' ? 'elderly' : 'family'
    await db.collection(col).doc(user._id).update({
      data: { avatar: fileID, updatedAt: new Date() }
    })

    const updated = await findUserByOpenid(openid)
    return { code: 0, msg: '头像已更新', data: safeUser(updated) }
  } catch (err) {
    return { code: 2, msg: '头像更新失败' }
  }
}

// ── 注销账号 ──────────────────────────────────────────
async function cancelAccount(openid) {
  try {
    const user = await findUserByOpenid(openid)
    if (!user) return { code: 1, msg: '用户不存在' }

    const col = user.role === 'elderly' ? 'elderly' : 'family'
    await db.collection(col).doc(user._id).remove()

    // 清除 token
    const tokenRes = await db.collection('tokens').where({ openid }).get()
    for (const doc of tokenRes.data) {
      await db.collection('tokens').doc(doc._id).remove()
    }

    // 清除相关绑定
    const field = user.role === 'elderly' ? 'toOpenid' : 'fromOpenid'
    const bindRes = await db.collection('bindings').where({ [field]: openid }).get()
    for (const doc of bindRes.data) {
      await db.collection('bindings').doc(doc._id).remove()
    }

    return { code: 0, msg: '账号已注销' }
  } catch (err) {
    console.error('注销失败：', err)
    return { code: 2, msg: '注销失败' }
  }
}

// ── 入口 ──────────────────────────────────────────────
exports.main = async (event) => {
  try {
    const { OPENID } = cloud.getWXContext()
    const { action, ...params } = event
    console.log('[auth] action:', action, 'openid:', OPENID)

    switch (action) {
      case 'register':      return await register(OPENID, params)
      case 'login':         return await login(OPENID, params)
      case 'logout':        return await logout(OPENID)
      case 'profile':       return await getProfile(OPENID)
      case 'updateProfile': return await updateProfile(OPENID, params)
      case 'uploadAvatar':  return await uploadAvatar(OPENID, params)
      case 'cancelAccount': return await cancelAccount(OPENID)
      default:              return { code: -1, msg: '未知操作' }
    }
  } catch (err) {
    console.error('云函数入口错误：', err)
    return { code: -2, msg: `系统异常：${err.message}` }
  }
}