// pages/aichat/aichat.js
// 小守 AI 伴聊页面 —— 支持记忆提取 | 反诈预警气泡 | 提醒确认 | 语音输入 | 语音朗读

const app = getApp()
const { chatAPI, speechAPI } = require('../../utils/api')

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
  const keyboardHeightRpx = Number(patch.keyboardHeightRpx || 0)

  const inputAreaReserveRpx = elderlyMode ? 260 : 220

  const inputSectionStyle = keyboardHeightRpx > 0
    ? `bottom: ${keyboardHeightRpx}rpx;`
    : `bottom: var(--tab-bar-total-height);`

  const chatBottomSpacerStyle = keyboardHeightRpx > 0
    ? `height: calc(${keyboardHeightRpx}rpx + ${inputAreaReserveRpx}rpx);`
    : `height: calc(var(--tab-bar-total-height) + ${inputAreaReserveRpx}rpx);`

  return {
    pageClass:       elderlyMode ? 'elderly-mode' : '',
    autoSpeakClass:  autoSpeak ? 'active' : '',
    autoSpeakLabel:  autoSpeak ? '🔊' : '🔇',
    elderlyModeClass: elderlyMode ? 'active' : '',
    elderlyModeLabel: elderlyMode ? '大' : '标',
    voiceBtnClass:   isRecording ? 'recording' : '',
    sendBtnClass:    `${inputText ? 'active' : ''} ${sending ? 'sending' : ''}`.trim(),
    sendBtnText:     sending ? '发送中' : '发送',
    inputSectionStyle,
    chatBottomSpacerStyle
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
    capabilityTags: ['日常陪聊', '紧急协助', '反诈提醒'],
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
    rpxPerPx:        0,
    // 键盘高度（rpx），用于输入栏避让
    keyboardHeightRpx: 0,
    inputSectionStyle: '',
    chatBottomSpacerStyle: '',
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
    const rpxPerPx    = 750 / sysInfo.windowWidth
    const safeAreaBottom = (sysInfo.screenHeight - safeArea.bottom) *
      (750 / sysInfo.windowWidth)

    this.setData({
      role: app.globalData.role,
      elderlyMode,
      autoSpeak: elderlyMode,
      safeAreaBottom,
      rpxPerPx,
      ...buildViewState({ elderlyMode, autoSpeak: elderlyMode, keyboardHeightRpx: 0 })
    })

    // 键盘弹出适配
    this._keyboardListener = (res) => {
      const heightPx = Number(res && res.height ? res.height : 0)
      const keyboardHeightRpx = Math.max(0, Math.round(heightPx * (this.data.rpxPerPx || rpxPerPx)))
      this.setData({
        keyboardHeightRpx,
        ...buildViewState({ ...this.data, keyboardHeightRpx })
      })
      if (keyboardHeightRpx > 0) {
        setTimeout(() => this._scrollToBottom(), 80)
      }
    }
    wx.onKeyboardHeightChange(this._keyboardListener)
    this._fetchHistory()
  },

  onUnload() {
    if (this._keyboardListener) {
      wx.offKeyboardHeightChange(this._keyboardListener)
      this._keyboardListener = null
    }
    if (this._audioContext) {
      this._audioContext.destroy()
      this._audioContext = null
    }
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

        // ── 自动播报 ─────────────────────────────────────
        if (this.data.autoSpeak && botMsg.text) {
          this._speak(botMsg.text)
        }

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

        // ── 记忆存储提示（静默）────────────────────────────
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

  // ── 朗读指定消息气泡 ─────────────────────────────────────
  speakMessage(e) {
    const text = e.currentTarget.dataset.text || ''
    if (!text) return
    this._speak(text)
  },

  // ── 语音合成（固定四川话发音人）────────────────────────────
  _speak(text) {
    if (!text) return
    // 销毁上一次播放
    if (this._audioContext) {
      this._audioContext.destroy()
      this._audioContext = null
    }
    wx.showLoading({ title: '合成中…', mask: true })
    speechAPI.tts(text, 'zh_cn', 'x3_yezi_sc')
      .then(res => {
        wx.hideLoading()
        if (!res.success) {
          wx.showToast({ title: res.message || '合成失败', icon: 'none' })
          return
        }
        const filePath = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`
        wx.getFileSystemManager().writeFile({
          filePath,
          data: res.data,
          encoding: 'base64',
          success: () => {
            const audio = wx.createInnerAudioContext()
            this._audioContext = audio
            audio.src = filePath
            audio.obeyMuteSwitch = false
            audio.play()
            audio.onError(err => {
              console.error('[AIChat] 播放失败:', err)
              wx.showToast({ title: '播放失败', icon: 'none' })
            })
          },
          fail: err => {
            console.error('[AIChat] 音频写入失败:', err)
            wx.showToast({ title: '音频保存失败', icon: 'none' })
          }
        })
      })
      .catch(err => {
        wx.hideLoading()
        console.error('[AIChat] TTS 错误:', err)
        wx.showToast({ title: '合成失败', icon: 'none' })
      })
  },

  // ── 录音：按住开始 ───────────────────────────────────────
  startRecord() {
    if (this.data.isRecording) return
    this._recordAudio = wx.getRecorderManager()
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        this._recordAudio.start({
          format: 'wav',
          sampleRate: 16000,
          numberOfChannels: 1,
          duration: 60000
        })
        this.setData({
          isRecording: true,
          ...buildViewState({ ...this.data, isRecording: true })
        })
        wx.showToast({ title: '录音中…', icon: 'none' })
      },
      fail: () => {
        wx.showToast({ title: '请开启麦克风权限', icon: 'none' })
      }
    })
    this._recordAudio.onError(err => {
      console.error('[AIChat] 录音错误:', err)
      this.setData({
        isRecording: false,
        ...buildViewState({ ...this.data, isRecording: false })
      })
      wx.showToast({ title: '录音失败', icon: 'none' })
    })
  },

  // ── 录音：松手结束 ───────────────────────────────────────
  stopRecord() {
    if (!this.data.isRecording || !this._recordAudio) return
    this._recordAudio.stop()
    this.setData({
      isRecording: false,
      ...buildViewState({ ...this.data, isRecording: false })
    })
    wx.hideToast()
    this._recordAudio.onStop(res => {
      console.log('[AIChat] 录音文件:', res.tempFilePath)
      this._recognizeSpeech(res.tempFilePath)
    })
  },

  // ── 语音识别（识别后调 Dify 翻译成普通话）────────────────────
  _recognizeSpeech(tempFilePath) {
    wx.showLoading({ title: '识别中…', mask: true })
    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      encoding: 'base64',
      success: async fileRes => {
        if (!fileRes.data) {
          wx.hideLoading()
          wx.showToast({ title: '音频数据为空', icon: 'none' })
          return
        }
        try {
          const res = await speechAPI.asr(fileRes.data, 'zh_cn', 'mulacc')
          if (!res.success) {
            wx.hideLoading()
            wx.showToast({ title: res.message || '识别失败', icon: 'none' })
            return
          }
          const dialectText = res.data
          // 调 Dify 翻译方言 → 普通话
          wx.showLoading({ title: '翻译中…', mask: true })
          try {
            const transRes = await chatAPI.difyTranslate(dialectText)
            wx.hideLoading()
            const finalText = (transRes && transRes.code === 0 && transRes.data) ? transRes.data : dialectText
            this.setData({
              inputText: finalText,
              ...buildViewState({ ...this.data, inputText: finalText })
            })
          } catch (e) {
            wx.hideLoading()
            // 翻译失败降级：直接用识别结果
            this.setData({
              inputText: dialectText,
              ...buildViewState({ ...this.data, inputText: dialectText })
            })
          }
        } catch (err) {
          wx.hideLoading()
          console.error('[AIChat] ASR 错误:', err)
          wx.showToast({ title: '识别失败，请重试', icon: 'none' })
        }
      },
      fail: err => {
        wx.hideLoading()
        console.error('[AIChat] 读取音频失败:', err)
        wx.showToast({ title: '读取音频失败', icon: 'none' })
      }
    })
  },

  // ── 工具 ─────────────────────────────────────────────────
  _scrollToBottom() {
    const msgs = this.data.messages
    if (msgs.length > 0) {
      this.setData({ scrollTo: `msg-${msgs[msgs.length - 1].id}` })
    }
  }
})