const express = require('express')
const store = require('../data/store')

const router = express.Router()

function todayKey() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

function ensureInit() {
  if (!store.reminderTemplates) {
    store.reminderTemplates = [
      { id: 1, icon: '💊', title: '早上用药提醒', time: '08:00' },
      { id: 2, icon: '🚶', title: '下午散步提醒', time: '15:00' },
      { id: 3, icon: '💊', title: '晚上用药提醒', time: '20:00' }
    ]
  }
  if (!store.reminderDone) store.reminderDone = {}
}

function normalizeTime(t) {
  if (typeof t !== 'string') return ''
  const s = t.trim()
  const m = s.match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return ''
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function getMinutesByTime(time) {
  const nt = normalizeTime(time)
  if (!nt) return -1
  const [hour, minute] = nt.split(':').map(n => parseInt(n))
  return hour * 60 + minute
}

function getCurrentMinutes() {
  const now = new Date()
  return now.getHours() * 60 + now.getMinutes()
}

function buildToday() {
  ensureInit()
  const date = todayKey()
  const templates = store.reminderTemplates || []
  const nowMinutes = getCurrentMinutes()

  return templates
    .map(t => {
      const instanceId = `${date}-${t.id}`
      const reminderMinutes = getMinutesByTime(t.time)
      const reminded = reminderMinutes >= 0 && nowMinutes >= reminderMinutes
      return {
        id: instanceId,
        templateId: t.id,
        icon: t.icon || '⏰',
        title: t.title || '提醒',
        time: t.time || '',
        reminded,
        done: reminded,
        statusText: reminded ? '已提醒' : '未提醒'
      }
    })
    .sort((a, b) => String(a.time).localeCompare(String(b.time)))
}

router.get('/templates', (req, res) => {
  ensureInit()
  res.json({ code: 0, data: store.reminderTemplates })
})

router.post('/templates', (req, res) => {
  ensureInit()
  const { icon, title, time } = req.body || {}
  const nt = normalizeTime(time)
  if (!title || !nt) return res.status(400).json({ code: 1, msg: '缺少标题或时间（HH:mm）' })
  const t = {
    id: store.nextId(store.reminderTemplates),
    icon: icon || '⏰',
    title: String(title).trim(),
    time: nt
  }
  store.reminderTemplates.push(t)
  res.json({ code: 0, data: t })
})

router.put('/templates/:id', (req, res) => {
  ensureInit()
  const id = parseInt(req.params.id)
  const t = (store.reminderTemplates || []).find(x => x.id === id)
  if (!t) return res.status(404).json({ code: 1, msg: '提醒不存在' })

  const { icon, title, time } = req.body || {}
  if (icon !== undefined) t.icon = icon || '⏰'
  if (title !== undefined) t.title = String(title).trim()
  if (time !== undefined) {
    const nt = normalizeTime(time)
    if (!nt) return res.status(400).json({ code: 1, msg: '时间格式应为 HH:mm' })
    t.time = nt
  }

  res.json({ code: 0, data: t })
})

router.delete('/templates/:id', (req, res) => {
  ensureInit()
  const id = parseInt(req.params.id)
  const idx = (store.reminderTemplates || []).findIndex(x => x.id === id)
  if (idx === -1) return res.status(404).json({ code: 1, msg: '提醒不存在' })
  const removed = store.reminderTemplates[idx]
  store.reminderTemplates.splice(idx, 1)

  const date = todayKey()
  const doneMap = store.reminderDone[date]
  if (doneMap) {
    const instanceId = `${date}-${removed.id}`
    delete doneMap[instanceId]
  }

  res.json({ code: 0, msg: '已删除' })
})

router.get('/today', (req, res) => {
  res.json({ code: 0, data: buildToday() })
})

module.exports = router
