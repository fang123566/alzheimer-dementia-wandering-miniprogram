// server/server.js
// 守护·陪伴 小程序后端服务

const express = require('express')
const cors = require('cors')
const http = require('http')
const WebSocket = require('ws')
const path = require('path')
const fs = require('fs')

const authRouter      = require('./routes/auth')
const locationRouter  = require('./routes/location')
const alertsRouter    = require('./routes/alerts')
const chatRouter      = require('./routes/chat')
const memoryRouter    = require('./routes/memory')
const settingsRouter  = require('./routes/settings')
const remindersRouter = require('./routes/reminders')
const sosRouter       = require('./routes/sos')
const store           = require('./data/store')
const { initDb, dbPath } = require('./db')

const app    = express()
const server = http.createServer(app)
const wss    = new WebSocket.Server({ server })

const PORT = process.env.PORT || 3000
const uploadsDir = path.join(__dirname, 'uploads')

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// ── 中间件 ──────────────────────────────────────────
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use('/uploads', express.static(uploadsDir))

// 简单请求日志
app.use((req, res, next) => {
  console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${req.method} ${req.path}`)
  next()
})

// ── REST 路由 ────────────────────────────────────────
app.use('/api/auth',      authRouter)
app.use('/api/location',  locationRouter)
app.use('/api/alerts',    alertsRouter)
app.use('/api/chat',      chatRouter)
app.use('/api/memory',    memoryRouter)
app.use('/api/settings',  settingsRouter)
app.use('/api/reminders', remindersRouter)
app.use('/api/sos',       sosRouter)

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    code: 0,
    msg: '守护·陪伴后端服务运行中',
    time: new Date().toISOString(),
    version: '1.0.0'
  })
})

// 全局统计
app.get('/api/stats', (req, res) => {
  res.json({
    code: 0,
    data: {
      unreadAlerts: store.alerts.filter(a => !a.read).length,
      totalAlerts:  store.alerts.length,
      chatCount:    store.chatHistory.filter(m => m.role === 'user').length,
      location:     store.location
    }
  })
})

// 404 处理
app.use((req, res) => {
  res.status(404).json({ code: 404, msg: '接口不存在' })
})

// 错误处理
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message)
  res.status(500).json({ code: 500, msg: '服务器内部错误', detail: err.message })
})

// ── WebSocket 实时位置推送 ───────────────────────────
wss.on('connection', (ws, req) => {
  console.log('[WS] 客户端已连接')

  // 连接后立即推送当前位置
  ws.send(JSON.stringify({ type: 'location', data: store.location }))

  // 接收客户端消息
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw)
      // 设备端上报位置
      if (msg.type === 'location_update') {
        Object.assign(store.location, msg.data, { updatedAt: new Date().toISOString() })
        // 广播给所有已连接客户端
        broadcast({ type: 'location', data: store.location })
      }
      // SOS 上报
      if (msg.type === 'sos') {
        store.location.status = 'emergency'
        broadcast({ type: 'sos', data: { ...msg.data, location: store.location } })
      }
    } catch (e) {
      console.error('[WS] 消息解析失败', e.message)
    }
  })

  ws.on('close', () => console.log('[WS] 客户端断开'))
  ws.on('error', (e) => console.error('[WS] 错误', e.message))
})

function broadcast(payload) {
  const str = JSON.stringify(payload)
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(str)
  })
}

// 每 30 秒模拟位置微变化（开发调试用，生产可移除）
setInterval(() => {
  const delta = () => (Math.random() - 0.5) * 0.0002
  store.location.latitude  += delta()
  store.location.longitude += delta()
  store.location.updatedAt  = new Date().toISOString()
  if (wss.clients.size > 0) {
    broadcast({ type: 'location', data: store.location })
  }
}, 30000)

// ── 启动 ─────────────────────────────────────────────
initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`\n✅  守护·陪伴后端服务已启动`)
      console.log(`   HTTP:  http://localhost:${PORT}/api/health`)
      console.log(`   WS:    ws://localhost:${PORT}`)
      console.log(`   DB:    ${dbPath}`)
      console.log(`   环境:  开发模式 (SQLite + 本地文件)\n`)
    })
  })
  .catch((err) => {
    console.error('数据库初始化失败:', err.message)
    process.exit(1)
  })

module.exports = { app, server }
