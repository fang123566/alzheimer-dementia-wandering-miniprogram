// pages/aichat/aichat.js
const app = getApp()
const { chatAPI } = require('../../utils/api')

let plugin = null
try { plugin = requirePlugin('WechatSI') } catch (e) { console.warn('WechatSI插件未加载', e) }

const QUICK_ACTIONS = [
  { id: 'weather', label: '查天气', icon: '🌤️', text: '今天天气怎么样' },
  { id: 'health', label: '记健康', icon: '💊', text: '我刚吃药了' },
  { id: 'emergency', label: '紧急求助', icon: '🆘', text: '我迷路了，救命' },
  { id: 'chat', label: '陪我聊聊', icon: '💬', text: '你好小守，我想和你聊聊天' }
]

function normalizeMessage(message) {
  const role = message.role || 'bot'
  const isBot = role === 'bot'
  const isUser = role === 'user'
  return {
    ...message,
    role,
    isBot,
    isUser,
    displayName: isBot ? (message.botName || '小守') : '老人',
    bubbleClass: isBot ? 'bubble-bot' : 'bubble-user',
    canSpeak: isBot && !!message.text
  }
}

function buildViewState(patch = {}) {
  const elderlyMode = !!patch.elderlyMode
  const autoSpeak = !!patch.autoSpeak
  const isRecording = !!patch.isRecording
  const inputText = patch.inputText || ''
  const sending = !!patch.sending

  return {
    pageClass: elderlyMode ? 'elderly-mode' : '',
    autoSpeakClass: autoSpeak ? 'active' : '',
    autoSpeakLabel: autoSpeak ? '🔊' : '🔇',
    elderlyModeClass: elderlyMode ? 'active' : '',
    elderlyModeLabel: elderlyMode ? '大' : '标',
    voiceBtnClass: isRecording ? 'recording' : '',
    sendBtnClass: `${inputText ? 'active' : ''} ${sending ? 'sending' : ''}`.trim(),
    sendBtnText: sending ? '发送中' : '发送'
  }
}

Page({
  data: {
    role: 'family',
    elderlyMode: false,
    pageClass: '',
    autoSpeakClass: '',
    autoSpeakLabel: '🔇',
    elderlyModeClass: '',
    elderlyModeLabel: '标',
    voiceBtnClass: '',
    sendBtnClass: '',
    sendBtnText: '发送',
    inputText: '',
    scrollTo: '',
    sending: false,
    messages: [],
    quickActions: QUICK_ACTIONS,
    capabilityTags: ['天气提醒', '健康记录', '紧急协助', '反诈提醒', '日常陪聊'],
    suggestions: [
      '今天天气怎么样',
      '我刚吃药了',
      '我有点想家',
      '我迷路了怎么办'
    ],
    // 语音相关
    isRecording: false,
    recordingDuration: 0,
    // 语音播报
    autoSpeak: false,
    speaking: false,
    // 安全区域
    safeAreaBottom: 0
  },

  innerAudioContext: null,
  recordingTimer: null,
  voiceRecognizeManager: null,

  onLoad() {
    console.log('[AIChat] 页面加载开始')
    if (!app.checkLogin()) {
      console.log('[AIChat] 未登录，跳转登录')
      return
    }
    const elderlyMode = app.globalData.elderlyMode
    // 计算安全区域高度（适配iPhone底部横条）
    const safeArea = wx.getSystemInfoSync().safeArea
    const screenHeight = wx.getSystemInfoSync().screenHeight
    const safeAreaBottom = (screenHeight - safeArea.bottom) * (750 / wx.getSystemInfoSync().windowWidth)
    console.log('[AIChat] 老人模式:', elderlyMode, '安全区域:', safeAreaBottom)
    this.setData({
      role: app.globalData.role,
      elderlyMode,
      autoSpeak: elderlyMode,
      safeAreaBottom,
      ...buildViewState({ elderlyMode, autoSpeak: elderlyMode, isRecording: false, inputText: '', sending: false })
    })
    this._initVoice()
    this._fetchHistory()
    console.log('[AIChat] 页面加载完成')
  },

  onShow() {
    this.setData({ role: app.globalData.role })
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  onUnload() {
    if (this.innerAudioContext) {
      this.innerAudioContext.destroy()
    }
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer)
    }
    if (this.voiceRecognizeManager) {
      this.voiceRecognizeManager.stop()
    }
  },

  // ========== 语音初始化 ==========

  _initVoice() {
    // 初始化音频播放器（用于 TTS 播报）
    this.innerAudioContext = wx.createInnerAudioContext()
    this.innerAudioContext.onPlay(() => this.setData({ speaking: true }))
    this.innerAudioContext.onStop(() => this.setData({ speaking: false }))
    this.innerAudioContext.onEnded(() => this.setData({ speaking: false }))
    this.innerAudioContext.onError(() => this.setData({ speaking: false }))

    // 初始化语音识别管理器（WechatSI 插件）
    if (plugin && plugin.getRecordRecognitionManager) {
      this.voiceRecognizeManager = plugin.getRecordRecognitionManager()

      this.voiceRecognizeManager.onStart = () => {
        console.log('[ASR] 开始识别')
        this.setData({ isRecording: true, recordingDuration: 0, ...buildViewState({ ...this.data, isRecording: true }) })
        this.recordingTimer = setInterval(() => {
          const d = this.data.recordingDuration + 1
          this.setData({ recordingDuration: d })
          if (d >= 59) this.voiceRecognizeManager.stop()
        }, 1000)
      }

      this.voiceRecognizeManager.onRecognize = (res) => {
        if (res.result) {
          this.setData({ inputText: res.result })
        }
      }

      this.voiceRecognizeManager.onStop = (res) => {
        clearInterval(this.recordingTimer)
        this.setData({ isRecording: false, ...buildViewState({ ...this.data, isRecording: false }) })
        console.log('[ASR] 识别结束', res)
        if (res.result) {
          this.setData({ inputText: res.result })
          this.sendMessage()
        } else {
          wx.showToast({ title: '没有识别到语音，请重试', icon: 'none' })
        }
      }

      this.voiceRecognizeManager.onError = (err) => {
        clearInterval(this.recordingTimer)
        this.setData({ isRecording: false, ...buildViewState({ ...this.data, isRecording: false }) })
        console.error('[ASR] 识别错误', err)
        wx.showToast({ title: '语音识别失败', icon: 'none' })
      }
    }
  },

  // ========== 老人模式 ==========

  toggleElderlyMode() {
    const newMode = app.toggleElderlyMode()
    this.setData({ elderlyMode: newMode, ...buildViewState({ ...this.data, elderlyMode: newMode }) })
    wx.showToast({
      title: newMode ? '已开启大字模式' : '已关闭大字模式',
      icon: 'none'
    })
  },

  // ========== 语音录入（语音识别） ==========

  toggleRecording() {
    if (this.data.isRecording) {
      this._stopRecording()
    } else {
      this._startRecording()
    }
  },

  _startRecording() {
    if (this.data.isRecording || this.data.sending) return

    if (!this.voiceRecognizeManager) {
      wx.showToast({ title: '语音插件未加载，请用文字输入', icon: 'none' })
      return
    }

    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this.voiceRecognizeManager.start({
          lang: 'zh_CN'
        })
      },
      fail: () => {
        wx.showModal({
          title: '需要录音权限',
          content: '请在设置中开启录音权限，以便使用语音输入',
          confirmText: '去设置',
          success: (res) => { if (res.confirm) wx.openSetting() }
        })
      }
    })
  },

  _stopRecording() {
    if (!this.data.isRecording) return
    if (this.voiceRecognizeManager) {
      this.voiceRecognizeManager.stop()
    }
  },

  // ========== TTS 语音播报 ==========

  _speakText(text) {
    if (!text || this.data.speaking) return
    if (!plugin || !plugin.textToSpeech) {
      console.warn('TTS 插件不可用')
      return
    }
    plugin.textToSpeech({
      lang: 'zh_CN',
      tts: true,
      content: text,
      success: (res) => {
        if (res.filename) {
          this.innerAudioContext.src = res.filename
          this.innerAudioContext.play()
        }
      },
      fail: (err) => {
        console.error('TTS 失败', err)
      }
    })
  },

  onSpeakTap(e) {
    const text = e.currentTarget.dataset.text
    if (text) this._speakText(text)
  },

  toggleAutoSpeak() {
    const newVal = !this.data.autoSpeak
    this.setData({ autoSpeak: newVal, ...buildViewState({ ...this.data, autoSpeak: newVal }) })
    wx.showToast({
      title: newVal ? '已开启自动播报' : '已关闭自动播报',
      icon: 'none'
    })
  },

  stopSpeaking() {
    if (this.innerAudioContext) this.innerAudioContext.stop()
    this.setData({ speaking: false })
  },

  // ========== 聊天数据 ==========

  async _fetchHistory() {
    try {
      const res = await chatAPI.getHistory()
      if (res.code === 0) {
        this.setData({ messages: (res.data || []).map(normalizeMessage) })
        this._scrollToBottom()
      }
    } catch (e) {
      // 离线时静默降级
    }
  },

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
    console.log('[AIChat] 输入:', inputText)
    this.setData({ inputText, ...buildViewState({ ...this.data, inputText }) })
  },

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
      this.setData({ messages: [], scrollTo: '' })
      wx.showToast({ title: '已清空', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '清空失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ========== 发送消息（核心链路） ==========

  async sendMessage() {
    const text = (this.data.inputText || '').trim()
    console.log('[AIChat] 发送消息:', text, 'sending:', this.data.sending)
    if (!text) {
      console.log('[AIChat] 消息为空，不发送')
      return
    }
    if (this.data.sending) {
      console.log('[AIChat] 正在发送中，忽略')
      return
    }

    this.setData({ inputText: '', sending: true, ...buildViewState({ ...this.data, inputText: '', sending: true }) })

    const now = new Date()
    const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
    const tempId = Date.now()
    const tempMsg = normalizeMessage({ id: tempId, role: 'user', text, time, emotionNote: '' })
    this.setData({ messages: [...this.data.messages, tempMsg] })
    this._scrollToBottom()

    try {
      console.log('[AIChat] 调用API发送:', text)
      const res = await chatAPI.sendMessage(text)
      console.log('[AIChat] API返回:', res)
      if (res.code === 0) {
        const { userMsg, botMsg } = res.data
        const msgs = this.data.messages.filter(m => m.id !== tempId)
        this.setData({ messages: [...msgs, normalizeMessage(userMsg), normalizeMessage(botMsg)] })
        this._scrollToBottom()

        // 自动播报
        if (this.data.autoSpeak && botMsg && botMsg.text) {
          this._speakText(botMsg.text)
        }
      }
    } catch (e) {
      console.error('[AIChat] 发送失败:', e)
      const fallback = normalizeMessage({
        id: Date.now(),
        role: 'bot', botName: '小守',
        text: '网络好像有点问题，稍后再试试吧～',
        time, isFraudAlert: false, isSoothe: false, tip: ''
      })
      this.setData({ messages: [...this.data.messages, fallback] })
      this._scrollToBottom()
    } finally {
      this.setData({ sending: false, ...buildViewState({ ...this.data, sending: false }) })
    }
  },

  _scrollToBottom() {
    const msgs = this.data.messages
    if (msgs.length > 0) {
      this.setData({ scrollTo: `msg-${msgs[msgs.length - 1].id}` })
    }
  }
})
