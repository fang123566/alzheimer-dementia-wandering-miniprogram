// cloudfunctions/aiChat/index.js
// 完整版：方言全流程 + AI记忆(修复) + 反诈预警 + 用药提醒 + 历史记录 + 清空功能 + 武汉天气
const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.getWXContext().ENV })
const db = cloud.database()
const _ = db.command

// ── 千问 API 配置 ──────────────────────────────────────────
const QIANWEN_API_KEY = 'sk-9a154a15e68b41229e30ea1562680dd5'
const QIANWEN_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
const QIANWEN_MODEL = 'qwen-turbo'

// ── Dify 方言翻译 API ──────────────────────────────────────
const DIFY_API_KEY  = 'app-mLJLNtiPQIy8oUO8Ti449Ulk'
const DIFY_BASE_URL = 'https://api.dify.ai/v1'

// ── 和风天气 武汉配置（新增） ───────────────────────────────
const WEATHER_API_KEY = "ca74ffe9604742c9b587a56951156086"
const WEATHER_CITY_ID = "101200101" // 武汉
const WEATHER_CITY_NAME = "武汉"

// ── 数据库集合名（全部保留）──────────────────────────────────
const COL_MESSAGES = 'chat_messages'   // 聊天记录
const COL_MEMORIES = 'chat_memories'   // 关键记忆（核心修复）
const COL_ALERTS = 'alerts'            // 反诈预警
const COL_REMIND = 'reminders'         // 用药提醒

// ==============================================
// 方言翻译规则库（完整保留）
// ==============================================
const TO_DIALECT = {
  '四川话': {
    map: [
      ['不知道', '不晓得'], ['什么', '啥子'], ['去哪里', '走哪里切'],
      ['吃饭', '恰饭'], ['这里', '这哈'], ['那里', '那哈'],
      ['怎么', '咋'], ['没有', '冇得'], ['很好', '安逸惨了'],
      ['是吗', '是哦'], ['好的', '要得'], ['厉害', '巴适得板'],
      ['我不舒服', '我难受惨了'], ['需要帮助', '要人帮'], ['我想回家', '我要回屋头'],
      ['帮我打电话', '帮我整个电话'], ['我饿了', '我饿惨了'],
      ['我需要吃药', '我要吃药了'], ['我要去厕所', '我要上茅厕'],
      ['我想休息', '我要歇哈'], ['我很好', '老子安逸得很']
    ]
  },
  '粤语': {
    map: [
      ['不知道', '唔知'], ['什么', '咩嘢'], ['去哪里', '去边度'],
      ['吃饭', '食饭'], ['这里', '呢度'], ['那里', '嗰度'],
      ['怎么', '点'], ['没有', '冇'], ['很好', '好正'],
      ['是吗', '係咩'], ['好的', '好嘅'], ['厉害', '犀利'],
      ['我不舒服', '我唔舒服'], ['需要帮助', '需要人帮手'],
      ['我想回家', '我想返屋企'], ['帮我打电话', '帮我打个电话'],
      ['我饿了', '我肚饿'], ['我需要吃药', '我要食药'],
      ['我要去厕所', '我要上厕所'], ['我想休息', '我想休息下'],
      ['我很好', '我好好']
    ]
  },
  '东北话': {
    map: [
      ['不知道', '不知道整啥'], ['什么', '啥玩意'], ['去哪里', '上哪旮旯去'],
      ['吃饭', '整点吃的'], ['这里', '这旮旯'], ['那里', '那旮旯'],
      ['怎么', '咋'], ['没有', '没整'], ['很好', '老得劲了'],
      ['是吗', '是咋地'], ['好的', '行行行'], ['厉害', '老铁'],
      ['我不舒服', '俺难受'], ['需要帮助', '得有人搭把手'],
      ['我想回家', '俺想回家'], ['帮我打电话', '帮俺打个电话'],
      ['我饿了', '俺饿了'], ['我需要吃药', '俺得吃药'],
      ['我要去厕所', '俺要上厕所'], ['我想休息', '俺想歇会儿'],
      ['我很好', '俺可好了'], ['我', '俺']
    ]
  }
}

const DIALECTS = ['四川话', '粤语', '东北话']

// 方言→普通话 反向规则
function buildReverse(dialectKey) {
  const rules = TO_DIALECT[dialectKey]
  if (!rules) return []
  return rules.map.map(([std, dia]) => [dia, std])
}

// 执行文本替换
function applyRules(text, rules) {
  if (!rules || rules.length === 0) return text
  let out = text
  const sorted = [...rules].sort((a, b) => b[0].length - a[0].length)
  for (const [from, to] of sorted) {
    out = out.split(from).join(to)
  }
  return out
}

// ==============================================
// 天气查询函数（新增，不影响原有代码）
// ==============================================
// 【和风天气官方接口】带调试日志，自动打印真实错误，不换接口！
async function getWuhanWeather() {
    return new Promise((resolve) => {
      try {
        const https = require('https');
        const zlib = require('zlib');
        
        const url = `https://mu5khw3ug4.re.qweatherapi.com/v7/weather/now?location=${WEATHER_CITY_ID}&key=${WEATHER_API_KEY}`;
        
        https.get(url, (res) => {
          const encoding = res.headers['content-encoding'];
          let stream = res;
  
          if (encoding === 'gzip') {
            stream = res.pipe(zlib.createGunzip());
          }
  
          let data = '';
          stream.on('data', (chunk) => data += chunk.toString('utf8'));
          
          stream.on('end', () => {
            try {
              const result = JSON.parse(data);
              // 🔥 关键：打印和风天气**真实返回结果**，排查错误用
              console.log('【和风天气真实返回】', result);
              
              // 成功判断
              if (result.code === '200') {
                const w = result.now;
                const weatherStr = `${WEATHER_CITY_NAME}当前天气：${w.text}，温度${w.temp}℃`;
                resolve(weatherStr);
              } else {
                // 直接返回接口的真实错误码
                resolve(`天气查询失败（错误码：${result.code}）`);
              }
            } catch (e) {
              console.error('天气解析错误：', e);
              resolve('暂时无法获取天气信息');
            }
          });
        }).on('error', (err) => {
          console.error('请求失败：', err);
          resolve('暂时无法获取天气信息');
        });
      } catch (err) {
        console.error('函数异常：', err);
        resolve('暂时无法获取天气信息');
      }
    });
  }

// ════════════════════════════════════════════════════════════
// 系统提示词（修复：强制AI提取记忆，保留反诈+提醒）
// ════════════════════════════════════════════════════════════
function buildSystemPrompt(memories = []) {
  const memoryBlock = memories.length
    ? `\n【老人已知信息（请在对话中自然运用）】\n${memories.map(m => `- [${m.type}] ${m.content}`).join('\n')}\n`
    : ''

  return `你是"小守"，专门陪伴阿尔茨海默症老人的AI助手。
${memoryBlock}

【性格与说话风格】
1. 温柔、耐心、话多一些，像老朋友聊天，每次回复至少2~3句话
2. 用简单口语，语气亲切，多用"您"，偶尔用"呀""呢""哦"等语气词
3. 主动关心老人的身体、心情、饮食，适时问一个小问题引导聊天
4. 老人重复讲话不要提醒，正常回应并顺着话题延伸
5. 不催促、不纠正、不责备，遇到老人说错了顺着说
6. 可以讲小故事、回忆往事、说说节气天气、聊聊家常
7. 如果老人说"没事""还好"，要追问一句表示关心

【紧急情况处理】
- 老人不舒服/疼痛：立刻关心，建议联系家人或拨打120，语气要温柔不慌张
- 老人迷路/找不到家：安抚情绪，告诉他原地等待，家人会来找
- 老人情绪低落/哭泣：陪伴倾听，引导聊开心往事，不要急着解决问题
- 老人提到想念去世的人：温柔回应，不否定情绪，引导说说那个人的好

===== 【后台标记规则，不要显示给老人】=====
【1 记忆提取】对话中出现以下信息时，在回复末尾追加标记（可追加多条）：
- 家庭成员姓名/关系 → type:family
- 身体状况/疾病/过敏 → type:health
- 日常习惯/作息 → type:habit
- 喜好/爱好/口味 → type:preference
- 年龄/生日 → type:age
- 住址/家乡 → type:address
格式：|||MEMORY:{"type":"类型","content":"不超过25字的关键信息"}|||
有多条信息就追加多个标记。

【2 反诈预警】老人提到以下情况时追加标记：
|||FRAUD:{"level":3,"desc":"风险描述","keyword":"触发词"}|||
- level3（高危）：被要求转账汇款、告知密码、家人出事急需钱、中奖需缴费
- level2（中危）：冒充公检法/银行/客服、退款退税、陌生人借钱
- level1（低危）：索要身份证号/住址、推销保健品/理财、陌生人加微信

【3 用药提醒】老人提到吃药/复诊/打针/检查时追加：
|||REMIND:{"type":"medication","content":"简要说明，不超过20字"}|||
`
}

// ════════════════════════════════════════════════════════════
// Dify 方言翻译（调用 /chat-messages 接口）
// ════════════════════════════════════════════════════════════
async function callDifyTranslate(dialectText) {
  return new Promise((resolve) => {
    try {
      const https = require('https')
      const postData = JSON.stringify({
        inputs: {},
        query: `请将以下方言文字翻译成标准普通话，只返回翻译结果，不要解释：${dialectText}`,
        response_mode: 'blocking',
        conversation_id: '',
        user: 'dialect-translator'
      })
      const options = {
        method: 'POST',
        hostname: 'api.dify.ai',
        path: '/v1/chat-messages',
        headers: {
          'Authorization': `Bearer ${DIFY_API_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      }
      const req = https.request(options, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk.toString('utf8') })
        res.on('end', () => {
          try {
            const result = JSON.parse(data)
            console.log('[Dify] 返回:', result)
            const answer = result.answer || result.message || ''
            resolve({ code: 0, data: answer.trim() || dialectText })
          } catch (e) {
            console.error('[Dify] 解析失败:', e)
            resolve({ code: 0, data: dialectText }) // 失败时原文返回
          }
        })
      })
      req.on('error', (e) => {
        console.error('[Dify] 请求失败:', e)
        resolve({ code: 0, data: dialectText })
      })
      req.write(postData)
      req.end()
    } catch (e) {
      console.error('[Dify] 异常:', e)
      resolve({ code: 0, data: dialectText })
    }
  })
}

// ════════════════════════════════════════════════════════════
// 调用通义千问AI（完整保留）
// ════════════════════════════════════════════════════════════
// 【最终修复版】通义千问 - 支持GZIP解压+完整错误处理+永不崩溃
async function callQianwen(messages) {
    return new Promise((resolve) => {
      try {
        const https = require('https');
        const zlib = require('zlib');
  
        const postData = JSON.stringify({
          model: QIANWEN_MODEL,
          input: { messages },
          parameters: { temperature: 0.2, max_tokens: 1024 }
        });
  
        const options = {
          method: 'POST',
          hostname: 'dashscope.aliyuncs.com',
          path: '/api/v1/services/aigc/text-generation/generation',
          headers: {
            'Authorization': `Bearer ${QIANWEN_API_KEY}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };
  
        const req = https.request(options, (res) => {
          // 自动解压gzip
          let stream = res;
          const encoding = res.headers['content-encoding'];
          if (encoding === 'gzip') {
            stream = res.pipe(zlib.createGunzip());
          }
  
          let resultData = '';
          stream.on('data', (chunk) => {
            resultData += chunk.toString('utf8');
          });
  
          stream.on('end', () => {
            try {
              // 打印完整返回值，调试用
              console.log('【千问完整返回】', resultData);
              const result = JSON.parse(resultData);
              
              // 正常返回
              if (result.output && result.output.text) {
                resolve(result.output.text);
              } else {
                // 接口报错，兜底返回
                console.log('【千问接口错误】', result);
                resolve('我在呢，你慢慢说~');
              }
            } catch (e) {
              console.error('解析AI返回失败', e);
              resolve('我在呢，你慢慢说~');
            }
          });
        });
  
        req.on('error', (error) => {
          console.error('AI请求失败', error);
          resolve('我在呢，你慢慢说~');
        });
  
        req.write(postData);
        req.end();
  
      } catch (err) {
        console.error('AI函数异常', err);
        resolve('我在呢，你慢慢说~');
      }
    });
  }

// ════════════════════════════════════════════════════════════
// 【修复】解析记忆/反诈/提醒标记（正则100%生效）
// ════════════════════════════════════════════════════════════
function parseMarkers(rawText) {
  let cleanText = rawText.trim()
  const memories = []
  let fraud = null
  let remind = null

  // 提取所有 MEMORY 标记（支持多条）
  const memRegex = /\|\|\|MEMORY:\s*(\{.*?\})\s*\|\|\|/gs
  let memMatch
  while ((memMatch = memRegex.exec(cleanText)) !== null) {
    try {
      const m = JSON.parse(memMatch[1])
      if (m.type && m.content) memories.push(m)
    } catch (e) {}
  }
  cleanText = cleanText.replace(/\|\|\|MEMORY:\s*\{.*?\}\s*\|\|\|/gs, '').trim()

  // 反诈匹配
  const fraudMatch = cleanText.match(/\|\|\|FRAUD:\s*(\{.*?\})\s*\|\|\|/s)
  if (fraudMatch) {
    try { fraud = JSON.parse(fraudMatch[1]) } catch (e) {}
    cleanText = cleanText.replace(fraudMatch[0], '').trim()
  }

  // 提醒匹配
  const remMatch = cleanText.match(/\|\|\|REMIND:\s*(\{.*?\})\s*\|\|\|/s)
  if (remMatch) {
    try { remind = JSON.parse(remMatch[1]) } catch (e) {}
    cleanText = cleanText.replace(remMatch[0], '').trim()
  }

  return { cleanText, memories, fraud, remind }
}

// 时间格式化
function formatTime() {
  const d = new Date()
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

// ════════════════════════════════════════════════════════════
// 主入口（所有接口完整保留）
// ════════════════════════════════════════════════════════════
exports.main = async (event, context) => {
  const { OPENID: openid } = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'getHistory': return actionGetHistory(openid)
    case 'clearHistory': return actionClearHistory(openid)
    case 'getMemories': return actionGetMemories(openid)
    case 'clearMemories': return actionClearMemories(openid)
    case 'sendMessage': return actionSendMessage(openid, event.text, event.dialect)
    case 'translateDialect': return actionTranslateDialect(openid, event)
    case 'difyTranslate': return actionDifyTranslate(event.text)
    case 'getCount': return actionGetCount(event.targetOpenid || openid)
    default: return { code: -1, msg: '未知指令' }
  }
}

// ════════════════════════════════════════════════════════════
// 核心聊天（全功能保留：方言+记忆+反诈+提醒+天气）
// ════════════════════════════════════════════════════════════
async function actionSendMessage(openid, text, dialect = '') {
  if (!text || !text.trim()) return { code: -1, msg: '内容不能为空' }
  const now = new Date()
  const time = formatTime()
  const useDialect = DIALECTS.includes(dialect) ? dialect : ''

  // ===================== 新增：天气识别 =====================
  const weatherKeywords = /天气|温度|冷|热|下雨|晴|风|阴天|雾霾|雪/
  if (weatherKeywords.test(text.trim())) {
    const weatherText = await getWuhanWeather()
    const botText = useDialect ? applyRules(weatherText, TO_DIALECT[dialect].map) : weatherText

    await db.collection(COL_MESSAGES).add({
      data: { openid, role: 'user', text: text.trim(), time, createdAt: now }
    })
    const botMsg = await db.collection(COL_MESSAGES).add({
      data: { openid, role: 'bot', botName: '小守', text: botText, time, createdAt: now }
    })

    return {
      code: 0,
      data: {
        userMsg: { id: botMsg._id, role: 'user', text: text.trim(), time, isBot: false, isUser: true, displayName: '老人', bubbleClass: 'bubble-user', canSpeak: false },
        botMsg: { id: botMsg._id, role: 'bot', botName: '小守', text: botText, time, isBot: true, isUser: false, displayName: '小守', bubbleClass: 'bubble-bot', canSpeak: true, hasFraudAlert: false, hasRemind: false, fraudLevel: 0 }
      },
      meta: { dialectUsed: useDialect, memorySaved: false, fraudAlert: null, remind: null }
    }
  }
  // ==========================================================

  try {
    // 1. 方言输入 → 转普通话给AI
    const userTextAI = useDialect ? applyRules(text.trim(), buildReverse(dialect)) : text.trim()

    // 2. 读取记忆
    const memRes = await db.collection(COL_MEMORIES)
      .where({ openid }).orderBy('updatedAt', 'desc').limit(20).get()
    const systemPrompt = buildSystemPrompt(memRes.data || [])

    // 3. 读取历史对话
    const histRes = await db.collection(COL_MESSAGES)
      .where({ openid }).orderBy('createdAt', 'desc').limit(10).get()
    const history = (histRes.data || []).reverse().map(m => ({
      role: m.role === 'bot' ? 'assistant' : 'user',
      content: m.text
    }))

    // 4. 请求AI
    const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: userTextAI }]
    const aiReply = await callQianwen(messages)
    const { cleanText, memories, fraud: aiFraud, remind } = parseMarkers(aiReply)

    // 5. 关键词主动反诈检测（兜底，不依赖AI标记）
    let fraud = aiFraud
    if (!fraud) {
      const t = text.trim()
      if (/转账|汇款|打款|密码|验证码|家人出事|出车祸|被抓|中奖|缴费|解冻/.test(t)) {
        fraud = { level: 3, desc: '检测到高危反诈关键词', keyword: t.match(/转账|汇款|打款|密码|验证码|家人出事|出车祸|被抓|中奖|缴费|解冻/)[0] }
      } else if (/公安|法院|检察院|银行客服|退款|退税|陌生人借钱|冒充/.test(t)) {
        fraud = { level: 2, desc: '检测到中危反诈关键词', keyword: t.match(/公安|法院|检察院|银行客服|退款|退税|陌生人借钱|冒充/)[0] }
      } else if (/身份证号|保健品|理财|加微信|投资/.test(t)) {
        fraud = { level: 1, desc: '检测到低危反诈关键词', keyword: t.match(/身份证号|保健品|理财|加微信|投资/)[0] }
      }
    }

    // 6. AI回复 → 转回方言
    const botText = useDialect ? applyRules(cleanText, TO_DIALECT[dialect].map) : cleanText

    // 7. 保存聊天记录
    await db.collection(COL_MESSAGES).add({ data: { openid, role: 'user', text: text.trim(), time, createdAt: now } })
    const botMsg = await db.collection(COL_MESSAGES).add({ data: { openid, role: 'bot', botName: '小守', text: botText, time, createdAt: now } })

    // 8. 保存多条记忆
    for (const mem of memories) {
      if (!mem.type || !mem.content) continue
      const exist = await db.collection(COL_MEMORIES)
        .where({ openid, type: mem.type, content: mem.content }).limit(1).get()
      if (exist.data.length === 0) {
        await db.collection(COL_MEMORIES).add({
          data: { openid, type: mem.type, content: mem.content, source: text.slice(0, 50), createdAt: now, updatedAt: now }
        })
      } else {
        await db.collection(COL_MEMORIES).doc(exist.data[0]._id).update({ data: { updatedAt: now } })
      }
    }

    // 9. 反诈预警存储
    if (fraud && fraud.level >= 1) {
      await db.collection(COL_ALERTS).add({
        data: { openid, category: 'fraud', ...fraud, triggerText: text.slice(0, 100), read: false, createdAt: now }
      })
    }

    // 10. 用药提醒存储
    if (remind && remind.type) {
      await db.collection(COL_REMIND).add({
        data: { openid, ...remind, done: false, source: 'ai_chat', createdAt: now, remindAt: now }
      })
    }

    return {
      code: 0,
      data: {
        userMsg: { id: botMsg._id, role: 'user', text: text.trim(), time, isBot: false, isUser: true, displayName: '老人', bubbleClass: 'bubble-user', canSpeak: false },
        botMsg: { id: botMsg._id, role: 'bot', botName: '小守', text: botText, time, isBot: true, isUser: false, displayName: '小守', bubbleClass: 'bubble-bot', canSpeak: true, hasFraudAlert: !!fraud, hasRemind: !!remind, fraudLevel: fraud?.level || 0 }
      },
      meta: { dialectUsed: useDialect, memorySaved: memories.length > 0, fraudAlert: fraud, remind }
    }

  } catch (err) {
    console.error('AI聊天错误：', err)
    return { code: -1, msg: '小守暂时无法回复，请稍后再试' }
  }
}

// ════════════════════════════════════════════════════════════
// 独立方言翻译接口（保留）
// ════════════════════════════════════════════════════════════
async function actionTranslateDialect(openid, { text, dialect, direction = 'toDialect' }) {
  if (!text?.trim()) return { code: -1, msg: '请输入内容' }
  if (!DIALECTS.includes(dialect)) return { code: -1, msg: '不支持该方言' }

  const result = direction === 'toDialect'
    ? applyRules(text.trim(), TO_DIALECT[dialect].map)
    : applyRules(text.trim(), buildReverse(dialect))

  return { code: 0, data: { original: text.trim(), result, dialect, direction } }
}

async function actionDifyTranslate(text) {
  if (!text || !text.trim()) return { code: -1, msg: '内容不能为空' }
  return callDifyTranslate(text.trim())
}

// ════════════════════════════════════════════════════════════
// 历史记录/清空/记忆管理（全部保留）
// ════════════════════════════════════════════════════════════
async function actionGetHistory(openid) {
  try {
    const res = await db.collection(COL_MESSAGES).where({ openid }).orderBy('createdAt', 'asc').limit(40).get()
    const list = res.data.map(m => ({
      id: m._id, role: m.role, text: m.text, time: m.time, isBot: m.role === 'bot', isUser: m.role === 'user',
      displayName: m.role === 'bot' ? '小守' : '老人', bubbleClass: m.role === 'bot' ? 'bubble-bot' : 'bubble-user', canSpeak: m.role === 'bot'
    }))
    return { code: 0, data: list }
  } catch (e) { return { code: -1, msg: '获取历史失败' } }
}

async function actionClearHistory(openid) {
  try {
    const res = await db.collection(COL_MESSAGES).where({ openid }).get()
    for (const item of res.data) await db.collection(COL_MESSAGES).doc(item._id).remove()
    return { code: 0, msg: '已清空聊天记录' }
  } catch (e) { return { code: -1, msg: '清空失败' } }
}

async function actionGetMemories(openid) {
  try {
    const res = await db.collection(COL_MEMORIES).where({ openid }).orderBy('updatedAt', 'desc').get()
    return { code: 0, data: res.data }
  } catch (e) { return { code: -1, msg: '获取记忆失败' } }
}

async function actionClearMemories(openid) {
  try {
    const res = await db.collection(COL_MEMORIES).where({ openid }).get()
    for (const item of res.data) await db.collection(COL_MEMORIES).doc(item._id).remove()
    return { code: 0, msg: '已清空所有记忆' }
  } catch (e) { return { code: -1, msg: '清空记忆失败' } }
}

async function actionGetCount(openid) {
  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const res = await db.collection(COL_MESSAGES)
      .where({ openid, role: 'user', createdAt: _.gte(today.getTime()) })
      .count()
    return { code: 0, data: { count: res.total || 0 } }
  } catch (e) { return { code: -1, msg: '获取次数失败' } }
}

