// pages/aichat/aichat.js
// 小守 AI 伴聊页面 —— 支持记忆提取 | 反诈预警气泡 | 提醒确认

const app = getApp()
const { chatAPI } = require('../../utils/api')

const QUICK_ACTIONS = [
  { id: 'weather',   label: '查天气',   icon: '🌤️', text: '今天天气怎么样' },
  { id: 'health',    label: '记健康',   icon: '💊', text: '我刚吃药了' },
  { id: 'emergency', label: '紧急求助', icon: '🆘', text: '我迷路了，救命' },
  { id: 'chat',      label: '陪我聊聊', icon: '💬', text: '你好小守，我想和你聊聊天' }
]

function normalizeMessage(message) {
  const role  = message.role || 'bot'
  const isBot = role === 'bot'
  const isUser = role === 'user'
  return {
    ...message,
    role,
    isBot,
    isUser,
    displayName: isBot ? (message.botName || '小守') : '老人',
    bubbleClass: isBot ? 'bubble-bot' : 'bubble-user',
    canSpeak:    isBot && !!message.text
  }
}

function buildViewState(patch = {}) {
  const elderlyMode = !!patch.elderlyMode
  const autoSpeak   = !!patch.autoSpeak
  const isRecording = !!patch.isRecording
  const inputText   = patch.inputText || ''
  const sending     = !!patch.sending

  return {
    pageClass:       elderlyMode ? 'elderly-mode' : '',
    autoSpeakClass:  autoSpeak ? 'active' : '',
    autoSpeakLabel:  autoSpeak ? '🔊' : '🔇',
    elderlyModeClass: elderlyMode ? 'active' : '',
    elderlyModeLabel: elderlyMode ? '大' : '标',
    voiceBtnClass:   isRecording ? 'recording' : '',
    sendBtnClass:    `${inputText ? 'active' : ''} ${sending ? 'sending' : ''}`.trim(),
    sendBtnText:     sending ? '发送中' : '发送'
  }
}

Page({
  data: {
    role:           'family',
    elderlyMode:    false,
    pageClass:      '',
    autoSpeakClass: '',
    autoSpeakLabel: '🔇',
    elderlyModeClass: '',
    elderlyModeLabel: '标',
    voiceBtnClass:  '',
    sendBtnClass:   '',
    sendBtnText:    '发送',
    inputText:      '',
    scrollTo:       '',
    sending:        false,
    messages:       [],
    quickActions:   QUICK_ACTIONS,
    capabilityTags: ['天气提醒', '健康记录', '紧急协助', '反诈提醒', '日常陪聊'],
    suggestions: [
      '今天天气怎么样',
      '我刚吃药了',
      '我有点想家',
      '我迷路了怎么办'
    ],
    // 语音相关
    isRecording:     false,
    recordingDuration: 0,
    // 语音播报
    autoSpeak:       false,
    speaking:        false,
    // 安全区域
    safeAreaBottom:  0,
    // 反诈预警横幅（当前对话触发时临时展示）
    fraudBanner:     null,   // { level, desc }
    // 提醒确认条（AI 检测到用药提及时展示）
    remindBanner:    null    // { type, content }
  },

  onLoad() {
    if (!app.checkLogin()) return
    const elderlyMode = app.globalData.elderlyMode
    const sysInfo     = wx.getSystemInfoSync()
    const safeArea    = sysInfo.safeArea
    const safeAreaBottom = (sysInfo.screenHeight - safeArea.bottom) *
      (750 / sysInfo.windowWidth)

    this.setData({
      role: app.globalData.role,
      elderlyMode,
      autoSpeak: elderlyMode,
      safeAreaBottom,
      ...buildViewState({ elderlyMode, autoSpeak: elderlyMode })
    })
    this._fetchHistory()
  },

  onShow() {
    this.setData({ role: app.globalData.role })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  // ── 老人模式切换 ──────────────────────────────────────────
  toggleElderlyMode() {
    const newMode = app.toggleElderlyMode()
    this.setData({ elderlyMode: newMode, ...buildViewState({ ...this.data, elderlyMode: newMode }) })
    wx.showToast({ title: newMode ? '已开启大字模式' : '已关闭大字模式', icon: 'none' })
  },

  // ── 自动播报切换 ──────────────────────────────────────────
  toggleAutoSpeak() {
    const newVal = !this.data.autoSpeak
    this.setData({ autoSpeak: newVal, ...buildViewState({ ...this.data, autoSpeak: newVal }) })
    wx.showToast({ title: newVal ? '已开启自动播报' : '已关闭自动播报', icon: 'none' })
  },

  // ── 获取历史 ─────────────────────────────────────────────
  async _fetchHistory() {
    try {
      const res = await chatAPI.getHistory()
      if (res.code === 0) {
        this.setData({ messages: (res.data || []).map(normalizeMessage) })
        this._scrollToBottom()
      }
    } catch (e) {
      console.warn('[AIChat] 离线降级', e)
    }
  },

  // ── 快捷操作 ─────────────────────────────────────────────
  onQuickAction(e) {
    const text = e.currentTarget.dataset.text || ''
    if (!text || this.data.sending) return
    this.setData({ inputText: text })
    this.sendMessage()
  },

  useSuggestion(e) {
    const text = e.currentTarget.dataset.text || ''
    this.setData({ inputText: text })
  },

  onInput(e) {
    const inputText = e.detail.value || ''
    this.setData({ inputText, ...buildViewState({ ...this.data, inputText }) })
  },

  // ── 清空对话 ─────────────────────────────────────────────
  async clearHistory() {
    if (!this.data.messages.length) return
    const res = await wx.showModal({
      title: '清空对话',
      content: '确定清空当前聊天记录吗？',
      confirmText: '清空',
      confirmColor: '#ff5c5c'
    })
    if (!res.confirm) return
    try {
      wx.showLoading({ title: '清空中…' })
      await chatAPI.clearHistory()
      this.setData({ messages: [], scrollTo: '', fraudBanner: null, remindBanner: null })
      wx.showToast({ title: '已清空', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '清空失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ── 发送消息（核心链路）──────────────────────────────────
  async sendMessage() {
    const text = (this.data.inputText || '').trim()
    if (!text || this.data.sending) return

    this.setData({
      inputText: '',
      sending: true,
      fraudBanner: null,
      remindBanner: null,
      ...buildViewState({ ...this.data, inputText: '', sending: true })
    })

    const now    = new Date()
    const time   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    const tempId = Date.now()

    // 先乐观追加用户消息气泡
    const tempMsg = normalizeMessage({ id: tempId, role: 'user', text, time, emotionNote: '' })
    this.setData({ messages: [...this.data.messages, tempMsg] })
    this._scrollToBottom()

    try {
      const res = await chatAPI.sendMessage(text)

      if (res.code === 0) {
        const { userMsg, botMsg } = res.data
        const meta = res.meta || {}

        // 替换乐观消息
        const msgs = this.data.messages.filter(m => m.id !== tempId)
        this.setData({
          messages: [...msgs, normalizeMessage(userMsg), normalizeMessage(botMsg)]
        })
        this._scrollToBottom()

        // ── 反诈预警横幅 ─────────────────────────────────
        if (meta.fraudAlert) {
          const levelMap = { 3: '⚠️ 高危诈骗风险！', 2: '⚠️ 疑似诈骗', 1: '⚠️ 可疑内容' }
          this.setData({
            fraudBanner: {
              level:    meta.fraudAlert.level,
              desc:     meta.fraudAlert.desc,
              title:    levelMap[meta.fraudAlert.level] || '⚠️ 注意风险',
              bgClass:  meta.fraudAlert.level >= 3 ? 'banner-danger' : 'banner-warning'
            }
          })
          // 高危自动震动提示
          if (meta.fraudAlert.level >= 3) {
            wx.vibrateShort({ type: 'heavy' })
            wx.showModal({
              title:   '⚠️ 反诈预警',
              content: `检测到可疑内容：${meta.fraudAlert.desc}\n\n已为您记录预警，请务必谨慎！`,
              showCancel: false,
              confirmText: '我知道了'
            })
          }
        }

        // ── 提醒确认条 ───────────────────────────────────
        if (meta.remind) {
          this.setData({
            remindBanner: {
              type:    meta.remind.type,
              content: meta.remind.content || '用药提醒已记录',
              icon:    meta.remind.type === 'medication' ? '💊' : '🔔'
            }
          })
        }

        // ── 记忆存储提示（静默，不打扰老人）────────────────
        if (meta.memorySaved) {
          console.log('[AIChat] 记忆已存储')
        }

      }
    } catch (e) {
      console.error('[AIChat] 发送失败:', e)
      const fallback = normalizeMessage({
        id: Date.now(),
        role: 'bot', botName: '小守',
        text: '网络好像有点问题，您稍等一下，我马上回来陪您～',
        time, emotionNote: ''
      })
      this.setData({ messages: [...this.data.messages, fallback] })
      this._scrollToBottom()
    } finally {
      this.setData({ sending: false, ...buildViewState({ ...this.data, sending: false }) })
    }
  },

  // ── 关闭反诈横幅 ──────────────────────────────────────────
  closeFraudBanner() {
    this.setData({ fraudBanner: null })
  },

  // ── 前往查看预警详情 ────────────────────────────────────
  viewFraudAlert() {
    this.setData({ fraudBanner: null })
    wx.switchTab({ url: '/pages/alert/alert' })
  },

  // ── 关闭提醒横幅 ──────────────────────────────────────────
  closeRemindBanner() {
    this.setData({ remindBanner: null })
  },

  // ── 工具 ─────────────────────────────────────────────────
  _scrollToBottom() {
    const msgs = this.data.messages
    if (msgs.length > 0) {
      this.setData({ scrollTo: `msg-${msgs[msgs.length - 1].id}` })
    }
  }
})