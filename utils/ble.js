// utils/ble.js
// BLE 全局管理器 —— 生命周期跟随 App，不随 device 页面销毁而断开
// device.js 只做 UI，所有 BLE 操作均通过 getApp().ble 调用

const { sosAPI } = require('./api')

// ─────────────────────────────────────────────
//  协议常量（与 ESP32 固件保持一致）
// ─────────────────────────────────────────────
const SERVICE_UUID = '12345678-1234-1234-1234-123456789ABC'
const CHAR_RX_UUID = '12345678-1234-1234-1234-123456789AB1' // 手机写 → ESP32
const CHAR_TX_UUID = '12345678-1234-1234-1234-123456789AB2' // ESP32通知 → 手机

const CMD = {
  TEXT_DISPLAY: 0x01,
  AUDIO_CHUNK:  0x02,
  AUDIO_END:    0x03,
  REC_CHUNK:    0x10,
  REC_END:      0x11,
  EMERGENCY:    0x20,
  BTN_EVENT:    0x21,
}

const BLE_CHUNK_SIZE = 480
const SAMPLE_RATE    = 16000

function uuidEq(a, b) {
  return a.toUpperCase().replace(/-/g, '') === b.toUpperCase().replace(/-/g, '')
}

function callCloud(name, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name, data,
      success: res => resolve(res.result),
      fail: err => {
        console.error(`[BLE云函数 ${name}] 失败`, err)
        reject(new Error(err.errMsg || '云函数调用失败'))
      }
    })
  })
}

// ─────────────────────────────────────────────
//  BleManager 类
// ─────────────────────────────────────────────
class BleManager {
  constructor() {
    // 连接状态
    this.deviceId  = ''
    this.serviceId = ''
    this.rxCharId  = ''
    this.txCharId  = ''

    // 状态字符串：idle | scanning | connecting | connected | disconnected
    this.status     = 'idle'
    this.statusText = '未连接'
    this.statusIcon = '🔵'

    // 扫描到的设备列表
    this.deviceList = []

    // 接收硬件录音的 PCM 缓冲
    this._audioBufs = []

    // AI 链路防重入
    this._aiProcessing = false

    // 提醒轮询
    this._reminderTimer = null
    this._notifiedReminderIds = []

    // 本地播放 AudioContext
    this._audioCtx = null

    // UI 回调（device 页面注册，切走后清空，但 BLE 本身不受影响）
    this._uiCallbacks = {}
  }

  // ── UI 回调注册（device 页面 onShow 注册，onHide/onUnload 注销）──────
  // device.js 通过这个机制把自己的 setData / _pushMsg 告知管理器
  registerUI(callbacks) {
    this._uiCallbacks = callbacks || {}
  }
  unregisterUI() {
    this._uiCallbacks = {}
  }

  // 向 UI 推送信息（如果 device 页面不在，静默忽略）
  _uiPushInfo(text) {
    if (this._uiCallbacks.pushInfo) this._uiCallbacks.pushInfo(text)
    else console.log('[BLE]', text)
  }
  _uiPushMsg(msg) {
    if (this._uiCallbacks.pushMsg) this._uiCallbacks.pushMsg(msg)
  }
  _uiSetState(patch) {
    if (this._uiCallbacks.setState) this._uiCallbacks.setState(patch)
  }

  // ── 扫描 ────────────────────────────────────────────────────────────
  startScan() {
    this.deviceList = []
    this._setStatus('scanning', '扫描中...', '🔍')

    wx.openBluetoothAdapter({
      success: () => {
        wx.onBluetoothAdapterStateChange(state => {
          if (!state.available) {
            wx.showModal({ title: '提示', content: '蓝牙已关闭，请重新开启', showCancel: false })
          }
        })
        wx.startBluetoothDevicesDiscovery({
          services: [],
          allowDuplicatesKey: false,
          powerLevel: 'high',
          success: () => {
            wx.onBluetoothDeviceFound(res => {
              const found = res.devices.filter(d =>
                d.name && (d.name.includes('ESP32') || d.name.includes('Voice'))
              )
              if (!found.length) return
              found.forEach(d => {
                if (!this.deviceList.find(x => x.deviceId === d.deviceId)) {
                  this.deviceList.push({ deviceId: d.deviceId, name: d.name || '未知设备', RSSI: d.RSSI })
                }
              })
              this._uiSetState({ deviceList: this.deviceList })
            })
          },
          fail: err => {
            console.error('startBluetoothDevicesDiscovery fail:', err)
            this._setStatus('idle', '扫描失败', '❌')
          }
        })
      },
      fail: () => {
        wx.showModal({ title: '提示', content: '请先开启手机蓝牙', showCancel: false })
        this._setStatus('idle', '未连接', '🔵')
      }
    })
  }

  stopScan() {
    wx.stopBluetoothDevicesDiscovery()
    this._setStatus('idle', '未连接', '🔵')
  }

  // ── 连接 ────────────────────────────────────────────────────────────
  connect(deviceId, deviceName) {
    wx.stopBluetoothDevicesDiscovery()
    this._setStatus('connecting', `连接中 ${deviceName}`, '⏳')
    this.deviceList = []
    this._uiSetState({ deviceList: [] })
    this.deviceId = deviceId

    wx.createBLEConnection({
      deviceId,
      success: () => this._onConnected(),
      fail: err => {
        console.error('createBLEConnection fail:', err)
        this._setStatus('idle', '连接失败', '❌')
        wx.showToast({ title: '连接失败，请重试', icon: 'none' })
      }
    })
  }

  _onConnected() {
    // 监听断连（不主动 close 时系统回调）
    wx.onBLEConnectionStateChange(res => {
      if (!res.connected && res.deviceId === this.deviceId) {
        console.log('[BLE] 硬件断开')
        this.deviceId = ''
        this.rxCharId = ''
        this.txCharId = ''
        this._stopReminderWatcher()
        this._setStatus('disconnected', '连接已断开', '🔴')
        this._uiPushInfo('⚠️ 设备已断开连接')
        // 注销 bleNotify
        const app = getApp()
        if (app) app.globalData.bleNotify = null
      }
    })

    // 请求大 MTU
    wx.setBLEMTU({
      deviceId: this.deviceId,
      mtu: 512,
      complete: () => this._discoverServices()
    })
  }

  _discoverServices() {
    wx.getBLEDeviceServices({
      deviceId: this.deviceId,
      success: res => {
        const svc = res.services.find(s => uuidEq(s.uuid, SERVICE_UUID))
        if (!svc) {
          wx.showModal({ title: '错误', content: '未找到目标服务，请检查设备固件', showCancel: false })
          return
        }
        this.serviceId = svc.uuid
        this._discoverCharacteristics()
      },
      fail: err => console.error('getBLEDeviceServices fail:', err)
    })
  }

  _discoverCharacteristics() {
    wx.getBLEDeviceCharacteristics({
      deviceId: this.deviceId,
      serviceId: this.serviceId,
      success: res => {
        res.characteristics.forEach(c => {
          if (uuidEq(c.uuid, CHAR_RX_UUID)) this.rxCharId = c.uuid
          if (uuidEq(c.uuid, CHAR_TX_UUID)) this.txCharId = c.uuid
        })
        if (!this.rxCharId || !this.txCharId) {
          wx.showModal({ title: '错误', content: '特征值查找失败，请重试', showCancel: false })
          return
        }
        this._subscribeNotify()
        this._setStatus('connected', '已连接', '🟢')
        this._uiPushInfo('🎉 设备连接成功！单击按键录音，长按发送紧急消息')
        wx.showToast({ title: '连接成功', icon: 'success' })

        // 注册全局 bleNotify
        const app = getApp()
        if (app) {
          app.globalData.bleNotify = {
            sendText: text => this.sendTextToDevice(text),
            sendTts:  text => this.reminderTts(text)
          }
        }
        // 启动提醒轮询
        this._startReminderWatcher()
      },
      fail: err => console.error('getBLEDeviceCharacteristics fail:', err)
    })
  }

  _subscribeNotify() {
    wx.notifyBLECharacteristicValueChange({
      deviceId: this.deviceId,
      serviceId: this.serviceId,
      characteristicId: this.txCharId,
      state: true,
      success: () => {
        wx.onBLECharacteristicValueChange(res => {
          if (res.deviceId === this.deviceId) {
            this._onReceive(res.value)
          }
        })
      }
    })
  }

  // ── 主动断开 ─────────────────────────────────────────────────────────
  disconnect() {
    if (this.deviceId) {
      wx.closeBLEConnection({ deviceId: this.deviceId })
    }
    this.deviceId = ''
    this.rxCharId = ''
    this.txCharId = ''
    this._stopReminderWatcher()
    this._setStatus('idle', '未连接', '🔵')
    const app = getApp()
    if (app) app.globalData.bleNotify = null
  }

  // ── 接收 ESP32 数据 ──────────────────────────────────────────────────
  _onReceive(buffer) {
    const data = new Uint8Array(buffer)
    if (!data.length) return
    const cmd = data[0]

    switch (cmd) {
      case CMD.REC_CHUNK: {
        if (data.length > 1) this._audioBufs.push(buffer.slice(1))
        break
      }
      case CMD.REC_END: {
        if (this._audioBufs.length > 0) {
          this._uiPushInfo(`📩 收到语音（${this._audioBufs.length} 包），正在处理...`)
          this._startAiPipeline()
        } else {
          this._uiPushInfo('⚠️ 未收到录音数据')
        }
        break
      }
      case CMD.EMERGENCY: {
        // 硬件长按 1.5s 直接发此命令（固件里 sendEmergency()）
        // 触发 SOS 写库流程，与手机端长按完全一致
        this._uiPushInfo('🆘 收到硬件 SOS 指令，正在写入预警...')
        this._triggerHardwareSOS()
        break
      }
      case CMD.BTN_EVENT: {
        const ev = data[1]
        if (ev === 0x01) {
          this._uiPushInfo('👆 按键单击：等待硬件录音...')
          this._uiSetState({ aiStatus: 'listening', aiStatusText: '🎙️ 硬件录音中...' })
        }
        if (ev === 0x02) {
          this._uiPushInfo('🆘 设备长按：触发 SOS 紧急求助')
          this._triggerHardwareSOS()
        }
        break
      }
      default:
        console.warn('[BLE] 未知命令:', cmd)
    }
  }

  // ── 硬件长按 SOS ─────────────────────────────────────────────────────
  // 直接调 sosAPI.trigger() 写入 alerts 数据库，与 index.triggerSOS() 内部逻辑完全一致
  async _triggerHardwareSOS() {
    // 防止 3s 内重复触发
    const now = Date.now()
    if (this._lastSOSTime && now - this._lastSOSTime < 3000) return
    this._lastSOSTime = now

    this._uiPushInfo('🆘 正在发送 SOS...')
    wx.vibrateShort({ type: 'heavy' })
    setTimeout(() => wx.vibrateShort({ type: 'heavy' }), 300)
    wx.showLoading({ title: 'SOS 发送中…', mask: true })

    try {
      // 1. 获取位置（失败不阻断）
      const loc = await new Promise(resolve => {
        wx.getLocation({ type: 'wgs84', success: resolve, fail: () => resolve(null) })
      })
      const globalApp = getApp()
      const address = globalApp?.globalData?.currentLocation?.address || ''

      // 2. 调 sos 云函数 → 写入 alerts 集合、通知绑定家属
      const res = await sosAPI.trigger(
        loc ? { latitude: loc.latitude, longitude: loc.longitude, address } : { address }
      )

      wx.hideLoading()

      if (res && res.code === 0) {
        // 三连震动
        wx.vibrateShort({ type: 'heavy' })
        setTimeout(() => wx.vibrateShort({ type: 'heavy' }), 200)
        setTimeout(() => wx.vibrateShort({ type: 'heavy' }), 400)

        wx.showModal({
          title: '🆘 SOS 已发送',
          content: `已通知 ${res.notified || 1} 位家人，请原地等待`,
          showCancel: false,
          confirmText: '知道了'
        })
        this._uiPushInfo(`✅ SOS 已发送给 ${res.notified || 1} 位家人`)

        // 3. 通知 index 页面刷新状态（如果当前在栈中）
        try {
          const pages = getCurrentPages()
          const indexPage = pages.find(p => p.route === 'pages/index/index')
          if (indexPage) {
            indexPage._updateStatusTag('emergency')
            indexPage._fetchData()
          } else {
            // index 不在栈中：设标志，下次 onShow 时刷新
            if (globalApp?.globalData) globalApp.globalData._sosTriggered = true
          }
        } catch (e) { /* 不影响主流程 */ }

      } else {
        wx.showToast({ title: res?.msg || 'SOS 发送失败，请重试', icon: 'none' })
        this._uiPushInfo('❌ SOS 发送失败：' + (res?.msg || '未知错误'))
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: 'SOS 发送失败，请重试', icon: 'none' })
      this._uiPushInfo('❌ SOS 发送异常：' + e.message)
      console.error('[BLE SOS] 异常:', e)
    }
  }

  // ── AI 完整链路：ASR → aiChat → TTS → 回传 ESP32 ────────────────────
  async _startAiPipeline() {
    if (this._aiProcessing) {
      this._uiPushInfo('⚠️ AI 正在处理中，请稍候')
      return
    }
    this._aiProcessing = true

    const wavBase64 = this._assemblePcmToWavBase64()
    this._audioBufs = []

    try {
      // Step 1: ASR
      this._uiSetState({ aiStatus: 'recognizing', aiStatusText: '🔍 识别语音中...' })
      this._uiPushInfo('🔍 正在识别语音...')

      let recognizedText = ''
      try {
        const asrRes = await callCloud('asrTts', { type: 'asr', data: wavBase64, language: 'zh_cn', accent: 'mandarin' })
        if (asrRes && asrRes.success && asrRes.data) {
          recognizedText = asrRes.data
        } else {
          this._uiPushInfo(`⚠️ 语音识别：${asrRes?.message || '识别失败'}`)
        }
      } catch (e) {
        console.error('[AI链路] ASR 失败:', e)
        this._uiPushInfo('❌ 语音识别失败，请重试')
      }

      this._uiPushMsg({ type: 'sent', content: `🎤 ${recognizedText || '未识别到语音'}` })

      if (!recognizedText) {
        this._uiPushInfo('💬 未识别到有效语音内容')
        return
      }

      // Step 2: AI 伴聊
      this._uiSetState({ aiStatus: 'thinking', aiStatusText: '🤔 AI 思考中...' })
      this._uiPushInfo('🤔 小守正在思考回复...')

      let aiReplyText = '好的，我在听，您慢慢说。'
      try {
        const chatRes = await callCloud('aiChat', { action: 'sendMessage', text: recognizedText })
        if (chatRes && chatRes.code === 0 && chatRes.data) {
          aiReplyText = chatRes.data.botMsg?.text || aiReplyText
        }
      } catch (e) {
        console.error('[AI链路] AI伴聊失败:', e)
        aiReplyText = '网络有点问题，我还在呢，请再说一遍。'
        this._uiPushInfo('⚠️ AI 服务暂时不可用，使用降级回复')
      }

      this._uiPushMsg({ type: 'received', content: `🤖 ${aiReplyText}` })

      // Step 3: TTS + 回传
      this._uiSetState({ aiStatus: 'speaking', aiStatusText: '🔊 合成语音中...' })
      this._uiPushInfo('🔊 正在合成语音回复...')

      this.sendTextToDevice(aiReplyText)

      try {
        const ttsRes = await callCloud('asrTts', { type: 'tts', data: aiReplyText, language: 'zh_cn', voiceName: 'x3_yezi_sc' })
        if (ttsRes && ttsRes.success && ttsRes.data) {
          this._uiPushInfo('📤 正在将语音回复发送给硬件...')
          await this.sendAudioBase64ToDevice(ttsRes.data)
          this._uiPushInfo('✅ 语音回复已发送给硬件')
          this._playBase64Audio(ttsRes.data)
        } else {
          this._uiPushInfo(`⚠️ 语音合成失败：${ttsRes?.message || '未知错误'}`)
        }
      } catch (e) {
        console.error('[AI链路] TTS 失败:', e)
        this._uiPushInfo('❌ 语音合成失败，文字回复已发送')
      }

    } finally {
      this._uiSetState({ aiStatus: 'idle', aiStatusText: '' })
      this._aiProcessing = false
    }
  }

  // ── 提醒专用 TTS ─────────────────────────────────────────────────────
  async reminderTts(text) {
    try {
      const ttsRes = await callCloud('asrTts', { type: 'tts', data: text, language: 'zh_cn', voiceName: 'x3_yezi_sc' })
      if (ttsRes && ttsRes.success && ttsRes.data) {
        await this.sendAudioBase64ToDevice(ttsRes.data)
        this._playBase64Audio(ttsRes.data)
      } else {
        console.warn('[reminderTts] TTS 失败:', ttsRes?.message)
      }
    } catch (e) {
      console.error('[reminderTts] 异常:', e)
    }
  }

  // ── 提醒轮询 ─────────────────────────────────────────────────────────
  _startReminderWatcher() {
    this._stopReminderWatcher()
    this._notifiedReminderIds = []
    this._checkAndPushReminders()
    this._reminderTimer = setInterval(() => this._checkAndPushReminders(), 30000)
    console.log('[BLE] 提醒轮询已启动')
  }

  _stopReminderWatcher() {
    if (this._reminderTimer) {
      clearInterval(this._reminderTimer)
      this._reminderTimer = null
    }
  }

  async _checkAndPushReminders() {
    if (this.status !== 'connected') return
    try {
      const role = wx.getStorageSync('role') || 'family'
      const app = getApp()
      const elderlyOpenid = (app?.globalData?.elderlyInfo?.openid)
        || (app?.globalData?.elderlyInfo?._openid) || ''

      const res = await callCloud('reminders', { action: 'getToday', role, elderlyOpenid })
      if (!res || res.code !== 0 || !Array.isArray(res.data)) return

      const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
      const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes()

      const pending = res.data.filter(item => {
        if (this._notifiedReminderIds.indexOf(item.id) !== -1) return false
        if (!item.time) return false
        const [h, m] = item.time.split(':').map(Number)
        const reminderMin = h * 60 + m
        return reminderMin <= nowMinutes && reminderMin >= nowMinutes - 5
      })

      for (const item of pending) {
        this._notifiedReminderIds.push(item.id)
        await this._pushReminderToDevice(item)
      }
    } catch (e) {
      console.error('[BLE] 提醒检查异常:', e)
    }
  }

  async _pushReminderToDevice(item) {
    const text = `${item.icon || '⏰'} ${item.time} ${item.title}${item.note ? '，' + item.note : ''}`
    this._uiPushInfo(`📢 推送提醒到硬件：${text}`)
    this.sendTextToDevice(text)
    await this.reminderTts(text)
  }

  // ── 发文字到硬件屏幕 ─────────────────────────────────────────────────
  sendTextToDevice(text) {
    if (!this.deviceId || !this.rxCharId) return
    try {
      const textBytes = this._encodeUtf8(text)
      const packet = new Uint8Array(1 + textBytes.length)
      packet[0] = CMD.TEXT_DISPLAY
      packet.set(textBytes, 1)
      this._sendCmd(packet.buffer)
    } catch (e) {
      console.error('[BLE] sendTextToDevice 失败:', e)
    }
  }

  // ── 把 base64 音频分包发给 ESP32 ────────────────────────────────────
  sendAudioBase64ToDevice(base64Data) {
    return new Promise(resolve => {
      try {
        const audioBuffer = wx.base64ToArrayBuffer
          ? wx.base64ToArrayBuffer(base64Data)
          : this._base64ToArrayBuffer(base64Data)
        const pcm = new Uint8Array(audioBuffer)
        let offset = 0
        const sendNext = () => {
          if (offset >= pcm.length) {
            this._sendCmd(new Uint8Array([CMD.AUDIO_END]).buffer)
            resolve()
            return
          }
          const slice = pcm.slice(offset, offset + BLE_CHUNK_SIZE)
          const packet = new Uint8Array(1 + slice.length)
          packet[0] = CMD.AUDIO_CHUNK
          packet.set(slice, 1)
          this._sendCmd(packet.buffer)
          offset += slice.length
          setTimeout(sendNext, 15)
        }
        sendNext()
      } catch (e) {
        console.error('[BLE] sendAudioBase64ToDevice 失败:', e)
        resolve()
      }
    })
  }

  // ── 将大 PCM buffer 分包发送（手机录音时用）────────────────────────
  sendAudioChunks(pcmBuffer) {
    const pcm = new Uint8Array(pcmBuffer)
    let offset = 0
    const sendNext = () => {
      if (offset >= pcm.length) return
      const slice = pcm.slice(offset, offset + BLE_CHUNK_SIZE)
      const packet = new Uint8Array(1 + slice.length)
      packet[0] = CMD.AUDIO_CHUNK
      packet.set(slice, 1)
      this._sendCmd(packet.buffer)
      offset += slice.length
      setTimeout(sendNext, 10)
    }
    sendNext()
  }

  // ── BLE 底层写入 ─────────────────────────────────────────────────────
  _sendCmd(buffer) {
    if (!this.deviceId || !this.rxCharId) return
    wx.writeBLECharacteristicValue({
      deviceId: this.deviceId,
      serviceId: this.serviceId,
      characteristicId: this.rxCharId,
      value: buffer,
      fail: err => console.error('[BLE] writeBLE fail:', err)
    })
  }

  // ── 本地播放 base64 音频 ─────────────────────────────────────────────
  _playBase64Audio(base64Data) {
    const filePath = `${wx.env.USER_DATA_PATH}/ble_audio_${Date.now()}.wav`
    wx.getFileSystemManager().writeFile({
      filePath, data: base64Data, encoding: 'base64',
      success: () => {
        if (this._audioCtx) { this._audioCtx.destroy(); this._audioCtx = null }
        const ctx = wx.createInnerAudioContext()
        this._audioCtx = ctx
        ctx.src = filePath
        ctx.obeyMuteSwitch = false
        ctx.play()
        ctx.onError(e => console.error('[BLE] 本地播放失败:', e))
      },
      fail: err => console.error('[BLE] 音频写入失败:', err)
    })
  }

  // ── PCM chunks → WAV base64 ──────────────────────────────────────────
  _assemblePcmToWavBase64() {
    const totalBytes = this._audioBufs.reduce((s, b) => s + b.byteLength, 0)
    const pcm = new Uint8Array(totalBytes)
    let offset = 0
    this._audioBufs.forEach(b => { pcm.set(new Uint8Array(b), offset); offset += b.byteLength })
    const wavBuffer = this._addWavHeader(pcm.buffer)
    return wx.arrayBufferToBase64 ? wx.arrayBufferToBase64(wavBuffer) : this._arrayBufferToBase64(wavBuffer)
  }

  _addWavHeader(pcmBuffer) {
    const ch = 1, bits = 16
    const byteRate  = SAMPLE_RATE * ch * bits / 8
    const blockAlign = ch * bits / 8
    const dataSize  = pcmBuffer.byteLength
    const header    = new DataView(new ArrayBuffer(44))
    const w4 = (off, s) => { for (let i = 0; i < 4; i++) header.setUint8(off + i, s.charCodeAt(i)) }
    w4(0, 'RIFF'); header.setUint32(4, 36 + dataSize, true)
    w4(8, 'WAVE'); w4(12, 'fmt ')
    header.setUint32(16, 16, true); header.setUint16(20, 1, true)
    header.setUint16(22, ch, true); header.setUint32(24, SAMPLE_RATE, true)
    header.setUint32(28, byteRate, true); header.setUint16(32, blockAlign, true)
    header.setUint16(34, bits, true); w4(36, 'data'); header.setUint32(40, dataSize, true)
    const result = new Uint8Array(44 + dataSize)
    result.set(new Uint8Array(header.buffer), 0)
    result.set(new Uint8Array(pcmBuffer), 44)
    return result.buffer
  }

  _arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  _base64ToArrayBuffer(base64) {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes.buffer
  }

  // ── 状态同步 ─────────────────────────────────────────────────────────
  _setStatus(status, statusText, statusIcon) {
    this.status     = status
    this.statusText = statusText
    this.statusIcon = statusIcon
    this._uiSetState({ status, statusText, statusIcon })
  }

  // ── 编解码工具 ───────────────────────────────────────────────────────
  _encodeUtf8(str) {
    const bytes = []
    for (let i = 0; i < str.length; i++) {
      let code = str.codePointAt(i)
      if (code > 0xFFFF) i++
      if      (code <= 0x7F)   { bytes.push(code) }
      else if (code <= 0x7FF)  { bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F)) }
      else if (code <= 0xFFFF) { bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)) }
      else { bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)) }
    }
    return new Uint8Array(bytes)
  }

  _decodeUtf8(uint8arr) {
    try { return new TextDecoder('utf-8').decode(uint8arr) }
    catch (e) { return String.fromCharCode(...uint8arr) }
  }
}

// 单例导出
const bleManager = new BleManager()
module.exports = bleManager
