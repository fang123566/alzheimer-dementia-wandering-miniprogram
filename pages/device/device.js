// pages/device/device.js
// 纯 UI 层 —— BLE 连接生命周期由 app.ble（utils/ble.js）管理
// 页面销毁不会断开蓝牙，切换页面后连接持续保持

const CMD_AUDIO_CHUNK = 0x02
const CMD_AUDIO_END   = 0x03
const SAMPLE_RATE     = 16000
const BLE_CHUNK_SIZE  = 480

Page({
  data: {
    // 连接状态（从 app.ble 同步而来）
    status:     'idle',
    statusText: '未连接',
    statusIcon: '🔵',
    deviceList: [],

    // 消息列表 { id, type, content, time }
    messages: [],
    lastMsgId: '',

    // 文字输入
    inputText: '',

    // 录音 / 播放状态（手机侧麦克风）
    isRecording: false,
    isPlaying:   false,

    // AI 链路状态（由 ble.js 回调更新）
    aiStatus:     'idle',
    aiStatusText: '',
  },

  // 私有
  _recorderMgr:  null,
  _audioCtx:     null,
  _msgIdCounter: 0,

  // ── 生命周期 ───────────────────────────────────────────────────────
  onLoad() {
    this._initRecorder()
  },

  onShow() {
    // 每次显示时向 ble 注册 UI 回调，让 ble 能把状态推到页面
    const ble = getApp().ble
    ble.registerUI({
      pushInfo:  (text) => this._pushInfo(text),
      pushMsg:   (msg)  => this._pushMsg(msg),
      setState:  (patch) => this.setData(patch),
    })
    // 同步 ble 管理器的当前状态到 UI（防止切走期间状态变化后回来不刷新）
    this.setData({
      status:     ble.status,
      statusText: ble.statusText,
      statusIcon: ble.statusIcon,
      deviceList: ble.deviceList,
    })
  },

  onHide() {
    // 离开页面时注销 UI 回调，ble 后续操作静默进行（不推 UI）
    getApp().ble.unregisterUI()
  },

  onUnload() {
    getApp().ble.unregisterUI()
    // ⚠️ 不调 disconnect()，不关闭 BLE 连接！
    if (this._audioCtx) { this._audioCtx.destroy(); this._audioCtx = null }
    if (this._recorderMgr) this._recorderMgr.stop()
  },

  // ── 手机侧录音初始化（用于"手机录音→发给硬件"功能）──────────────
  _initRecorder() {
    const rm = wx.getRecorderManager()
    this._recorderMgr = rm

    rm.onStart(() => {
      this.setData({ isRecording: true })
      this._pushInfo('🎙️ 开始录音...')
    })

    rm.onFrameRecorded(({ frameBuffer, isLastFrame }) => {
      getApp().ble.sendAudioChunks(frameBuffer)
      if (isLastFrame) {
        getApp().ble._sendCmd(new Uint8Array([CMD_AUDIO_END]).buffer)
        this.setData({ isRecording: false })
        this._pushInfo('✅ 音频已发送')
      }
    })

    rm.onStop(() => {
      getApp().ble._sendCmd(new Uint8Array([CMD_AUDIO_END]).buffer)
      this.setData({ isRecording: false })
      this._pushInfo('✅ 音频已发送')
    })

    rm.onError(err => {
      console.error('Recorder error:', err)
      this.setData({ isRecording: false })
      wx.showToast({ title: '录音失败', icon: 'error' })
    })
  },

  // ── BLE 扫描 / 连接 ────────────────────────────────────────────────
  startScan() {
    getApp().ble.startScan()
  },

  stopScan() {
    getApp().ble.stopScan()
  },

  connectDevice(e) {
    const { deviceid } = e.currentTarget.dataset
    const device = this.data.deviceList.find(d => d.deviceId === deviceid)
    if (!device) return
    getApp().ble.connect(deviceid, device.name)
  },

  disconnect() {
    getApp().ble.disconnect()
  },

  // ── 发送文字到硬件 ─────────────────────────────────────────────────
  onInputChange(e) {
    this.setData({ inputText: e.detail.value })
  },

  sendText() {
    const text = this.data.inputText.trim()
    if (!text) return
    if (this.data.status !== 'connected') {
      wx.showToast({ title: '请先连接设备', icon: 'none' })
      return
    }
    getApp().ble.sendTextToDevice(text)
    this._pushMsg({ type: 'sent', content: text })
    this.setData({ inputText: '' })
  },

  // ── 手机录音开关（手机麦克风录音 → 发给硬件播放）────────────────
  toggleRecord() {
    if (this.data.status !== 'connected') {
      wx.showToast({ title: '请先连接设备', icon: 'none' })
      return
    }
    if (!this.data.isRecording) {
      wx.authorize({
        scope: 'scope.record',
        success: () => {
          this._recorderMgr.start({
            sampleRate: SAMPLE_RATE,
            numberOfChannels: 1,
            encodeBitRate: 48000,
            format: 'pcm',
            frameSize: 2,
          })
        },
        fail: () => {
          wx.showModal({ title: '需要麦克风权限', content: '请在设置中允许使用麦克风', showCancel: false })
        }
      })
    } else {
      this._recorderMgr.stop()
    }
  },

  // ── 音频消息点击重播 ───────────────────────────────────────────────
  onAudioTap(e) {
    const { path } = e.currentTarget.dataset
    if (!path) return
    if (this._audioCtx) { this._audioCtx.destroy(); this._audioCtx = null }
    this.setData({ isPlaying: true })
    const ctx = wx.createInnerAudioContext()
    this._audioCtx = ctx
    ctx.src = path
    ctx.play()
    ctx.onEnded(() => this.setData({ isPlaying: false }))
    ctx.onError(err => {
      this.setData({ isPlaying: false })
      this._pushInfo('❌ 播放失败: ' + JSON.stringify(err))
    })
  },

  // ── 消息列表工具 ───────────────────────────────────────────────────
  _pushMsg(msg) {
    this._msgIdCounter++
    const id = `msg_${this._msgIdCounter}`
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    const messages = [...this.data.messages, { ...msg, id, time: timeStr }]
    if (messages.length > 100) messages.shift()
    this.setData({ messages, lastMsgId: id })
    return id
  },

  _pushInfo(text) {
    return this._pushMsg({ type: 'info', content: text })
  },
})
