// pages/aichat/aichat.js
const app = getApp()
const { chatAPI } = require('../../utils/api')

Page({
  data: {
    role: 'family',
    emotion: 'calm',
    inputText: '',
    scrollTo: '',
    sending: false,
    messages: []
  },

  onLoad() {
    if (!app.checkLogin()) return
    this.setData({ role: app.globalData.role })
    this._fetchHistory()
  },

  onShow() {
    this.setData({ role: app.globalData.role })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  async _fetchHistory() {
    try {
      const res = await chatAPI.getHistory()
      if (res.code === 0) {
        this.setData({ messages: res.data })
        this._scrollToBottom()
      }
    } catch (e) {
      // 离线时不显示错误，静默降级
    }
  },

  setEmotion(e) {
    this.setData({ emotion: e.currentTarget.dataset.e })
  },

  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  async sendMessage() {
    const text = this.data.inputText.trim()
    if (!text || this.data.sending) return

    this.setData({ inputText: '', sending: true })

    // 先乐观追加用户气泡
    const now = new Date()
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    const tempId = Date.now()
    const tempMsg = { id: tempId, role: 'user', text, time, emotionNote: '' }
    this.setData({ messages: [...this.data.messages, tempMsg] })
    this._scrollToBottom()

    try {
      const res = await chatAPI.sendMessage(text)
      if (res.code === 0) {
        const { userMsg, botMsg, emotion } = res.data
        // 用服务端返回的正式消息替换临时消息
        const msgs = this.data.messages.filter(m => m.id !== tempId)
        this.setData({
          messages: [...msgs, userMsg, botMsg],
          emotion: emotion || this.data.emotion
        })
        this._scrollToBottom()
      }
    } catch (e) {
      // 网络失败时保留乐观消息，追加本地降级回复
      const fallback = {
        id: Date.now(),
        role: 'bot', botName: '小守',
        text: '网络好像有点问题，稍后再试试吧～',
        time, isFraudAlert: false, isSoothe: false, tip: ''
      }
      this.setData({ messages: [...this.data.messages, fallback] })
      this._scrollToBottom()
    } finally {
      this.setData({ sending: false })
    }
  },

  _scrollToBottom() {
    const msgs = this.data.messages
    if (msgs.length > 0) {
      this.setData({ scrollTo: `msg-${msgs[msgs.length - 1].id}` })
    }
  }
})
