const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// ── 工具函数 ──────────────────────────────────────────
/** 生成老人唯一 ID，格式：EL + 时间戳 + 4位随机数 */
function genElderlyId() {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `EL-${ts}-${rand}`
}

/** 简单哈希密码（生产建议用 bcrypt，替换 YOUR_SALT 为自定义盐值） */
function hashPassword(pwd) {
  const SALT = 'your_custom_salt_2026' // 替换成任意字符串，比如你的项目名
  return crypto.createHash('sha256').update(pwd + SALT).digest('hex')
}

/** 生成 token（简单版；生产建议用 JWT） */
function genToken(userId, role) {
  const payload = `${userId}:${role}:${Date.now()}`
  return crypto.createHash('sha256').update(payload).digest('hex')
}

// ── 注册 ──────────────────────────────────────────────
async function register({ name, phone, password, role }) {
  try {
    // 1. 查重（两个集合都查）
    const col = role === 'elderly' ? 'elderly' : 'family'
    const existRes = await db.collection(col)
      .where({ phone })
      .count()

    if (existRes.total > 0) {
      return { code: 1, msg: `该手机号已注册为${role === 'elderly' ? '老人' : '家属'}账号` }
    }

    // 2. 构造新用户文档
    const now = new Date()
    const baseUser = {
      name,
      phone,
      password: hashPassword(password),
      role,
      createdAt: now,
      updatedAt: now
    }

    // 老人额外生成唯一 elderlyId
    if (role === 'elderly') {
      baseUser.elderlyId = genElderlyId()
      baseUser.age = ''
      baseUser.avatar = ''
      baseUser.bindFamilyIds = []   // 关联的家属 openid 列表
    } else {
      baseUser.bindElderlyId = ''   // 绑定的老人 elderlyId
    }

    // 3. 写入对应集合
    const addRes = await db.collection(col).add({ data: baseUser })

    // 4. 返回脱敏用户信息
    const { password: _, ...safeUser } = baseUser
    safeUser._id = addRes._id

    const token = genToken(addRes._id, role)
    // 存入 token 集合
    await db.collection('tokens').add({
      data: { userId: addRes._id, role, token, createdAt: now }
    })

    return { code: 0, msg: '注册成功', data: { token, user: safeUser } }
  } catch (err) {
    console.error('注册失败：', err)
    // 返回具体的错误信息给前端
    return { code: 2, msg: `注册失败：${err.message || '数据库操作异常'}` }
  }
}

// ── 登录 ──────────────────────────────────────────────
async function login({ phone, password }) {
  try {
    const hashed = hashPassword(password)

    // 同时在两个集合查找
    const [resE, resF] = await Promise.all([
      db.collection('elderly').where({ phone, password: hashed }).get(),
      db.collection('family').where({ phone, password: hashed }).get()
    ])

    const user = resE.data[0] || resF.data[0]
    if (!user) {
      return { code: 1, msg: '手机号或密码错误' }
    }

    const { password: _, ...safeUser } = user
    const token = genToken(user._id, user.role)

    await db.collection('tokens').add({
      data: {
        userId: user._id,
        role: user.role,
        token,
        createdAt: new Date()
      }
    })

    return { code: 0, msg: '登录成功', data: { token, user: safeUser } }
  } catch (err) {
    console.error('登录失败：', err)
    return { code: 2, msg: `登录失败：${err.message || '数据库操作异常'}` }
  }
}

// ── 入口 ──────────────────────────────────────────────
exports.main = async (event) => {
  try {
    const { action, ...params } = event
    console.log('云函数接收参数：', event) // 打印参数，方便调试

    if (action === 'register') return register(params)
    if (action === 'login')    return login(params)
    return { code: -1, msg: '未知操作：请传入 login 或 register' }
  } catch (err) {
    console.error('云函数入口错误：', err)
    return { code: -2, msg: `系统异常：${err.message}` }
  }
}