// server/routes/chat.js
const express = require('express')
const router = express.Router()
const store = require('../data/store')
const http = require('http')
const https = require('https')
const { URL } = require('url')

const AGENT_SERVICE_URL = process.env.AGENT_SERVICE_URL || 'http://127.0.0.1:5001/route'

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

function callAgentService(text, userId) {
  return new Promise((resolve, reject) => {
    const target = new URL(AGENT_SERVICE_URL)
    const payload = JSON.stringify({ text, user_id: userId })
    const client = target.protocol === 'https:' ? https : http

    const req = client.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 10000
      },
      (res) => {
        let body = ''
        res.on('data', chunk => { body += chunk })
        res.on('end', () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`智能体服务返回异常状态: ${res.statusCode}`))
            }
            resolve(JSON.parse(body || '{}'))
          } catch (error) {
            reject(new Error('智能体服务返回数据解析失败'))
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy(new Error('智能体服务请求超时'))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function mapAgentReply(agentResult, fallbackEmotion) {
  const intent = agentResult?.intent || 'chat'
  if (intent === 'fraud') {
    return {
      botName: '小守 · 反诈拦截',
      text: agentResult.reply,
      isFraudAlert: true,
      isSoothe: false,
      tip: '检测到疑似诈骗内容，已触发安全提醒',
      emotion: fallbackEmotion
    }
  }
  if (intent === 'emergency') {
    return {
      botName: '小守 · 紧急协助',
      text: agentResult.reply,
      isFraudAlert: false,
      isSoothe: true,
      tip: '已触发紧急协助流程',
      emotion: 'panic'
    }
  }
  if (intent === 'health') {
    return {
      botName: '小守 · 健康助手',
      text: agentResult.reply,
      isFraudAlert: false,
      isSoothe: false,
      tip: agentResult?.extra?.action ? `已记录：${agentResult.extra.action}` : '',
      emotion: fallbackEmotion
    }
  }
  if (intent === 'weather') {
    return {
      botName: '小守 · 天气助手',
      text: agentResult.reply,
      isFraudAlert: false,
      isSoothe: false,
      tip: agentResult?.extra?.city ? `查询城市：${agentResult.extra.city}` : '',
      emotion: fallbackEmotion
    }
  }
  return {
    botName: '小守',
    text: agentResult?.reply || '好的，我在听，您慢慢说。',
    isFraudAlert: false,
    isSoothe: fallbackEmotion === 'panic' || fallbackEmotion === 'anxious',
    tip: agentResult?.extra?.third_party_called ? '已接入陪聊智能体' : '',
    emotion: fallbackEmotion
  }
}

// GET /api/chat/history — 获取聊天历史
router.get('/history', (req, res) => {
  res.json({ code: 0, data: store.chatHistory })
})

// POST /api/chat/message — 发送消息，获取 AI 回复
router.post('/message', async (req, res) => {
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

  let agentResult
  try {
    agentResult = await callAgentService(text.trim(), 'elderly_user')
  } catch (error) {
    agentResult = {
      intent: isFraud ? 'fraud' : (detectedEmotion === 'panic' ? 'emergency' : 'chat'),
      reply: '智能体服务暂时不可用，我先陪您待一会儿。若情况紧急，请立即联系家人或社区工作人员。',
      extra: {}
    }
  }

  const replyData = mapAgentReply(agentResult, detectedEmotion)
  const botMsg = {
    id: store.nextId(store.chatHistory),
    role: 'bot',
    ...replyData,
    time: timeStr
  }
  store.chatHistory.push(botMsg)

  // 若检测到诈骗，自动写入预警
  if (isFraud || agentResult?.intent === 'fraud') {
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
      isFraud: isFraud || agentResult?.intent === 'fraud',
      emotion: replyData.emotion || detectedEmotion,
      intent: agentResult?.intent || 'chat'
    }
  })
})

// DELETE /api/chat/history — 清空聊天记录
router.delete('/history', (req, res) => {
  store.chatHistory = []
  res.json({ code: 0, msg: '聊天记录已清空' })
})

module.exports = router
