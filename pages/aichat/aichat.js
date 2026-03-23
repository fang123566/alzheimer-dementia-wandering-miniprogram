// pages/aichat/aichat.js
const app = getApp()

// 防诈关键词库
const FRAUD_KEYWORDS = ['转账', '中奖', '公检法', '验证码', '保证金', '陌生账户', '刷单', '贷款']

Page({
  data: {
    role: 'family',
    emotion: 'calm',          // calm / anxious / panic
    inputText: '',
    scrollTo: '',
    messages: [
      {
        id: 1, role: 'bot', botName: '小守',
        text: '王叔，早上好！今天天气不错，要不要出去走走？记得带好手机哦～',
        time: '08:00', isSoothe: false, isFraudAlert: false
      },
      {
        id: 2, role: 'user',
        text: '我不知道这是哪里啊',
        time: '09:47', emotionNote: '【检测到语速急促、声音颤抖】'
      },
      {
        id: 3, role: 'bot', botName: '小守 · 安抚模式',
        text: '王叔不用怕，我在这里陪您 🌸\n您就站在这里，建国马上就到～',
        time: '09:47', isSoothe: true, isFraudAlert: false
      },
      {
        id: 4, role: 'user',
        text: '刚才有人说我中奖了，叫我转账500块钱',
        time: '11:07', emotionNote: ''
      },
      {
        id: 5, role: 'bot', botName: '小守 · 反诈拦截',
        text: '千万别信这个！这是骗子！\n您没有中奖，不能转账，先给建国打个电话问问，好不好？',
        time: '11:07', isFraudAlert: true,
        tip: '关键词：中奖、转账 · 已推送家属紧急提醒',
        isSoothe: false
      }
    ]
  },

  onLoad() {
    this.setData({ role: app.globalData.role })
    this._scrollToBottom()
  },

  setEmotion(e) {
    this.setData({ emotion: e.currentTarget.dataset.e })
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  sendMessage() {
    const text = this.data.inputText.trim()
    if (!text) return

    const msgs = this.data.messages
    const newId = msgs.length + 1
    const now = new Date()
    const time = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`

    // 添加用户消息
    const userMsg = { id: newId, role: 'user', text, time, emotionNote: '' }
    const newMsgs = [...msgs, userMsg]

    // 检测防诈关键词
    const isFraud = FRAUD_KEYWORDS.some(kw => text.includes(kw))

    // 模拟 AI 回复
    const botReply = {
      id: newId + 1,
      role: 'bot',
      botName: isFraud ? '小守 · 反诈拦截' : '小守',
      text: isFraud
        ? '千万别信！这是骗子！不要转账，先联系家人确认。'
        : '好的，我听到了～有什么需要帮忙的吗？',
      time,
      isFraudAlert: isFraud,
      tip: isFraud ? '已推送家属紧急提醒' : '',
      isSoothe: false
    }

    this.setData({
      messages: [...newMsgs, botReply],
      inputText: ''
    })
    this._scrollToBottom()
  },

  _scrollToBottom() {
    const msgs = this.data.messages
    if (msgs.length > 0) {
      this.setData({ scrollTo: `msg-${msgs[msgs.length - 1].id}` })
    }
  }
})
