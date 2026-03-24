// server/routes/chat.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')

// 防诈关键词检测
function detectFraud(text) {
  return store.fraudKeywords.some(kw => text.includes(kw))
}

// 情绪关键词检测
function detectEmotion(text) {
  const panicWords = ['救命', '不知道', '找不到', '迷路', '害怕', '在哪里']
  const anxiousWords = ['怎么办', '着急', '担心', '不对劲']
  if (panicWords.some(w => text.includes(w))) return 'panic'
  if (anxiousWords.some(w => text.includes(w))) return 'anxious'
  return 'calm'
}

// 生成 AI 回复（本地规则，可替换为真实 LLM API）
function generateReply(userText, isFraud, emotion) {
  if (isFraud) {
    return {
      botName: '小守 · 反诈拦截',
      text: '千万别信这个！这是骗子！\n不要转账，不要给任何人钱，先联系建国确认，好不好？',
      isFraudAlert: true,
      isSoothe: false,
      tip: `关键词检测命中 · 已推送家属紧急提醒`
    }
  }
  if (emotion === 'panic') {
    return {
      botName: '小守 · 安抚模式',
      text: '王叔不用怕，我在这里陪您 🌸\n您先站在原地别动，我已经通知建国了，他马上过来～',
      isFraudAlert: false,
      isSoothe: true,
      tip: ''
    }
  }
  if (emotion === 'anxious') {
    return {
      botName: '小守 · 安抚模式',
      text: '没事的，王叔慢慢说，我听着呢。\n您放松一下，深呼吸，有我陪着您。',
      isFraudAlert: false,
      isSoothe: true,
      tip: ''
    }
  }
  // 普通回复
  const normalReplies = [
    '好的，我听到了～有什么需要帮忙的吗？',
    '嗯嗯，王叔，您说得对！',
    '哈哈，王叔今天心情不错嘛～',
    '好的好的，我记住了。需要我提醒建国吗？',
    '王叔，您说的我都记着呢，放心！'
  ]
  return {
    botName: '小守',
    text: normalReplies[Math.floor(Math.random() * normalReplies.length)],
    isFraudAlert: false,
    isSoothe: false,
    tip: ''
  }
}

// GET /api/chat/history — 获取聊天历史
router.get('/history', (req, res) => {
  res.json({ code: 0, data: store.chatHistory })
})

// POST /api/chat/message — 发送消息，获取 AI 回复
router.post('/message', (req, res) => {
  const { text, emotion } = req.body
  if (!text || !text.trim()) {
    return res.status(400).json({ code: 1, msg: '消息内容不能为空' })
  }

  const now = new Date()
  const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const isFraud = detectFraud(text)
  const detectedEmotion = detectEmotion(text)

  // 保存用户消息
  const userMsg = {
    id: store.nextId(store.chatHistory),
    role: 'user',
    text: text.trim(),
    time: timeStr,
    emotionNote: detectedEmotion !== 'calm' ? `检测到情绪异常：${detectedEmotion === 'panic' ? '恐慌' : '焦虑'}` : ''
  }
  store.chatHistory.push(userMsg)

  // 生成 AI 回复
  const replyData = generateReply(text, isFraud, detectedEmotion)
  const botMsg = {
    id: store.nextId(store.chatHistory),
    role: 'bot',
    ...replyData,
    time: timeStr
  }
  store.chatHistory.push(botMsg)

  // 若检测到诈骗，自动写入预警
  if (isFraud) {
    const alert = {
      id: store.nextId(store.alerts),
      level: 'danger', type: '防诈拦截',
      content: `检测到诈骗话术，对话内容："${text.slice(0, 50)}"`,
      location: '', phone: store.contacts[0]?.phone || '',
      category: 'fraud', read: false,
      time: now.toISOString(),
      timeLabel: `今天 ${timeStr}`
    }
    store.alerts.unshift(alert)
  }

  res.json({
    code: 0,
    data: {
      userMsg,
      botMsg,
      isFraud,
      emotion: detectedEmotion
    }
  })
})

// DELETE /api/chat/history — 清空聊天记录
router.delete('/history', (req, res) => {
  store.chatHistory = []
  res.json({ code: 0, msg: '聊天记录已清空' })
})

module.exports = router
