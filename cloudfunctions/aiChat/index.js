// cloudfunctions/aiChat/index.js
// 小守 AI 伴聊云函数
// 功能：千问对话 | 记忆提取存储 | 反诈预警 | 提醒检测

const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db    = cloud.database()
const _     = db.command

// ── 千问 API 配置 ──────────────────────────────────────────
const QIANWEN_API_KEY = 'sk-9a154a15e68b41229e30ea1562680dd5'
const QIANWEN_URL     = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
const QIANWEN_MODEL   = 'qwen-turbo'

// ── 数据库集合名 ───────────────────────────────────────────
const COL_MESSAGES = 'chat_messages'   // 聊天记录
const COL_MEMORIES = 'chat_memories'   // AI 提取的老人记忆
const COL_ALERTS   = 'alerts'          // 预警（与 alert.js 共用）
const COL_REMIND   = 'reminders'       // 提醒模板

// ════════════════════════════════════════════════════════════
// 系统提示词 —— 阿尔茨海默症陪伴专用
// ════════════════════════════════════════════════════════════
function buildSystemPrompt(memories = []) {
  const memoryBlock = memories.length
    ? `\n【你记得的关于这位老人的信息，请在对话中自然地运用这些背景，不要生硬地重复】\n${memories.map(m => `- ${m.content}`).join('\n')}\n`
    : ''

  return `你是"小守"，一个专门陪伴阿尔茨海默症老人的贴心AI助手。
${memoryBlock}
【核心原则】
你首先是一个真诚的陪伴者，要认真、完整地回答老人说的每一件事。不要为了"简短"而省略重要内容，老人问什么就好好回答什么。

【说话方式】
1. 语言通俗易懂，避免专业术语和复杂句式，用口语化表达
2. 用温暖、亲切的语气，多用"您"表示尊重，像家人一样陪伴
3. 如果老人重复说同一件事，耐心正常回应，绝对不要指出或提示他在重复
4. 回复长度根据内容自然决定：简单问候可以简短，老人提问或聊往事则要完整回应，不要人为截断
5. 绝对不能催促、纠错或责备老人，保持无限耐心
6. 不要在每次回复末尾固定加问候语或追问，让对话顺其自然

【特殊情境处理】
- 老人迷路或不知道自己在哪 → 先温柔安抚："没关系，我在您身边，请先原地等一下，我来帮您联系家人"
- 老人说身体不舒服 → 关心询问具体情况，视严重程度建议联系家人或拨打120
- 老人认错人或记忆混乱 → 不纠正，顺着他的情绪温柔回应，帮助他平静
- 老人心情低落或孤独 → 陪伴倾听，可以引导聊过去的美好记忆
- 老人说的话难以理解 → 温和地请他再说一遍，不要表现出不耐烦

===== 以下是后台任务指令，绝对不要在正文回复中提及这些内容 =====

【A. 记忆提取】
若对话中老人透露了有价值的个人信息，在你正式回复内容的最末尾另起一行，严格按以下格式追加（一条信息追加一行）：
|||MEMORY:{"type":"<类型>","content":"<内容摘要>"}|||

类型（type）说明：
- family    → 家庭成员相关（如"儿子叫明明，在北京工作"）
- health    → 健康或用药（如"每天早上服用降压药"）
- habit     → 日常规律习惯（如"喜欢下午三点喝茶"）
- preference → 兴趣爱好偏好
- event     → 重要日期或过往事件
- concern   → 老人当前的困扰或需求

注意：只提取明确说出的信息，不要推测；content 用简洁的陈述句，不超过30字。

【B. 反诈检测】
若老人描述的内容涉及以下任一诈骗特征，在回复末尾另起一行追加：
|||FRAUD:{"level":<数字>,"desc":"<简要描述>","keyword":"<触发词>"}|||

风险等级：
- level 3（高危）：有人要求老人转账/汇款/提供银行卡号密码；有人说家人出事急需钱；中奖但要先缴费
- level 2（中危）：有人冒充公检法；有人冒充客服说要退款；陌生人以各种理由借钱
- level 1（可疑）：有人索要身份证号/家庭住址；电话/网络推销保健品或投资理财

注意：老人主动聊自己正常的家庭汇款等不触发；只在对话内容中出现第三方可疑行为时才追加。

【C. 提醒记录】
若老人提到刚吃药、打针、需要复诊等用药健康行为，在回复末尾另起一行追加：
|||REMIND:{"type":"medication","content":"<简要描述，如：老人提到刚服用了降压药>"}|||`
}

// ════════════════════════════════════════════════════════════
// 调用千问 API
// ════════════════════════════════════════════════════════════
function callQianwen(messages) {
  const body = JSON.stringify({
    model: QIANWEN_MODEL,
    messages,
    max_tokens: 1200,
    temperature: 0.75
  })

  return new Promise((resolve, reject) => {
    const urlObj = new URL(QIANWEN_URL)
    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname,
      method:   'POST',
      headers: {
        'Authorization': `Bearer ${QIANWEN_API_KEY}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 15000
    }

    const req = https.request(options, res => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          if (parsed.error) return reject(new Error(parsed.error.message))
          resolve(parsed)
        } catch (e) {
          reject(new Error('千问返回解析失败: ' + data.slice(0, 200)))
        }
      })
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('千问API请求超时'))
    })
    req.write(body)
    req.end()
  })
}

// ════════════════════════════════════════════════════════════
// 解析 AI 回复中的隐藏标记
// ════════════════════════════════════════════════════════════
function parseMarkers(rawText) {
  let cleanText = rawText
  let memory    = null
  let fraud     = null
  let remind    = null

  // 提取 MEMORY
  const memMatch = rawText.match(/\|\|\|MEMORY:(\{[^}]+\})\|\|\|/)
  if (memMatch) {
    try { memory = JSON.parse(memMatch[1]) } catch (e) {}
    cleanText = cleanText.replace(memMatch[0], '').trim()
  }

  // 提取 FRAUD
  const fraudMatch = rawText.match(/\|\|\|FRAUD:(\{[^}]+\})\|\|\|/)
  if (fraudMatch) {
    try { fraud = JSON.parse(fraudMatch[1]) } catch (e) {}
    cleanText = cleanText.replace(fraudMatch[0], '').trim()
  }

  // 提取 REMIND
  const remMatch = rawText.match(/\|\|\|REMIND:(\{[^}]+\})\|\|\|/)
  if (remMatch) {
    try { remind = JSON.parse(remMatch[1]) } catch (e) {}
    cleanText = cleanText.replace(remMatch[0], '').trim()
  }

  return { cleanText, memory, fraud, remind }
}

// ════════════════════════════════════════════════════════════
// 时间格式化工具
// ════════════════════════════════════════════════════════════
function formatTime(date = new Date()) {
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// ════════════════════════════════════════════════════════════
// 主入口
// ════════════════════════════════════════════════════════════
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid    = wxContext.OPENID

  const { action } = event

  switch (action) {
    case 'getHistory':   return actionGetHistory(openid)
    case 'clearHistory': return actionClearHistory(openid)
    case 'getMemories':  return actionGetMemories(openid)
    case 'sendMessage':  return actionSendMessage(openid, event.text)
    default:             return { code: -1, msg: '未知 action' }
  }
}

// ────────────────────────────────────────────────────────────
// action: 获取历史消息
// ────────────────────────────────────────────────────────────
async function actionGetHistory(openid) {
  try {
    const res = await db.collection(COL_MESSAGES)
      .where({ openid })
      .orderBy('createdAt', 'asc')
      .limit(40)
      .get()

    const messages = (res.data || []).map(m => ({
      id:       m._id,
      role:     m.role,
      botName:  m.botName || '小守',
      text:     m.text,
      time:     m.time,
      read:     true,
      // 前端展示字段
      isBot:  m.role === 'bot',
      isUser: m.role === 'user',
      displayName: m.role === 'bot' ? (m.botName || '小守') : '老人',
      bubbleClass: m.role === 'bot' ? 'bubble-bot' : 'bubble-user',
      canSpeak: m.role === 'bot'
    }))

    return { code: 0, data: messages }
  } catch (e) {
    console.error('[getHistory]', e)
    return { code: -1, msg: '获取历史失败' }
  }
}

// ────────────────────────────────────────────────────────────
// action: 清空历史
// ────────────────────────────────────────────────────────────
async function actionClearHistory(openid) {
  try {
    // 云函数中批量删除需要循环（每次最多删除一条用 where）
    // 用 collection.where().get() + 循环 remove
    const res = await db.collection(COL_MESSAGES).where({ openid }).get()
    const ids  = (res.data || []).map(d => d._id)
    for (const id of ids) {
      await db.collection(COL_MESSAGES).doc(id).remove()
    }
    return { code: 0, msg: '已清空' }
  } catch (e) {
    console.error('[clearHistory]', e)
    return { code: -1, msg: '清空失败' }
  }
}

// ────────────────────────────────────────────────────────────
// action: 获取记忆列表
// ────────────────────────────────────────────────────────────
async function actionGetMemories(openid) {
  try {
    const res = await db.collection(COL_MEMORIES)
      .where({ openid })
      .orderBy('updatedAt', 'desc')
      .limit(50)
      .get()
    return { code: 0, data: res.data || [] }
  } catch (e) {
    return { code: -1, msg: '获取记忆失败' }
  }
}

// ────────────────────────────────────────────────────────────
// action: 发送消息（核心）
// ────────────────────────────────────────────────────────────
async function actionSendMessage(openid, text) {
  if (!text || !text.trim()) return { code: -1, msg: '消息不能为空' }

  const now    = new Date()
  const time   = formatTime(now)

  try {
    // 1. 拉取最近记忆，注入系统提示词
    const memRes  = await db.collection(COL_MEMORIES)
      .where({ openid })
      .orderBy('updatedAt', 'desc')
      .limit(20)
      .get()
    const memories    = memRes.data || []
    const systemPrompt = buildSystemPrompt(memories)

    // 2. 拉取最近 10 条对话作为上下文
    const histRes = await db.collection(COL_MESSAGES)
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get()
    const recentMsgs = (histRes.data || []).reverse()

    // 3. 组装千问 messages
    const qwMessages = [
      { role: 'system', content: systemPrompt },
      ...recentMsgs.map(m => ({
        role:    m.role === 'bot' ? 'assistant' : 'user',
        content: m.text
      })),
      { role: 'user', content: text.trim() }
    ]

    // 4. 调用千问
    const qwRes  = await callQianwen(qwMessages)
    const rawBot = qwRes?.choices?.[0]?.message?.content || '小守暂时没听清楚，您能再说一遍吗？'

    // 5. 解析隐藏标记
    const { cleanText, memory, fraud, remind } = parseMarkers(rawBot)

    // 6. 持久化用户消息
    const userDoc = await db.collection(COL_MESSAGES).add({
      data: {
        openid,
        role:      'user',
        text:      text.trim(),
        time,
        createdAt: now
      }
    })

    // 7. 持久化机器人消息
    const botDoc = await db.collection(COL_MESSAGES).add({
      data: {
        openid,
        role:    'bot',
        botName: '小守',
        text:    cleanText,
        time,
        createdAt: new Date()
      }
    })

    // 8. 存储提取到的记忆
    if (memory && memory.type && memory.content) {
      // 同类型记忆去重更新
      const existRes = await db.collection(COL_MEMORIES)
        .where({ openid, type: memory.type, content: memory.content })
        .limit(1).get()

      if (!existRes.data || existRes.data.length === 0) {
        await db.collection(COL_MEMORIES).add({
          data: {
            openid,
            type:      memory.type,
            content:   memory.content,
            source:    text.trim().slice(0, 50),
            createdAt: now,
            updatedAt: now
          }
        })
      } else {
        await db.collection(COL_MEMORIES)
          .doc(existRes.data[0]._id)
          .update({ data: { updatedAt: now } })
      }
    }

    // 9. 反诈预警 → 写入 alerts 集合（与 alert.js 共用）
    if (fraud && fraud.level >= 1) {
      await db.collection(COL_ALERTS).add({
        data: {
          openid,
          category:    'fraud',
          level:       fraud.level,
          title:       '反诈预警',
          description: fraud.desc || '检测到可疑对话内容',
          keyword:     fraud.keyword || '',
          triggerText: text.trim().slice(0, 100),  // 触发预警的原始语句
          read:        false,
          createdAt:   now
        }
      })
    }

    // 10. 提醒触发 → 写入 reminders 集合
    if (remind && remind.type) {
      await db.collection(COL_REMIND).add({
        data: {
          openid,
          type:      remind.type,
          content:   remind.content || '',
          done:      false,
          source:    'ai_chat',
          createdAt: now,
          remindAt:  now  // 可后续改为定时字段
        }
      })
    }

    // 11. 组装返回（与现有前端 normalizeMessage 兼容）
    const userMsg = {
      id:          userDoc._id,
      role:        'user',
      text:        text.trim(),
      time,
      isBot:       false,
      isUser:      true,
      displayName: '老人',
      bubbleClass: 'bubble-user',
      canSpeak:    false,
      emotionNote: ''
    }

    const botMsg = {
      id:          botDoc._id,
      role:        'bot',
      botName:     '小守',
      text:        cleanText,
      time,
      isBot:       true,
      isUser:      false,
      displayName: '小守',
      bubbleClass: 'bubble-bot',
      canSpeak:    true,
      // 额外标志，前端可用来展示提示
      hasFraudAlert: !!fraud,
      hasRemind:     !!remind,
      fraudLevel:    fraud ? fraud.level : 0
    }

    return {
      code: 0,
      data: { userMsg, botMsg },
      // 透传给前端（可选用于 UI 展示）
      meta: {
        memorySaved: !!memory,
        fraudAlert:  fraud || null,
        remind:      remind || null
      }
    }

  } catch (e) {
    console.error('[sendMessage] error:', e)
    return {
      code: -1,
      msg:  '小守暂时不在线，请稍后再试',
      error: e.message
    }
  }
}