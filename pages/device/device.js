// pages/device/device.js
// 与 ESP32-S3 语音设备 BLE 通信页面

// ─────────────────────────────────────────────
//  协议常量（与 ESP32 固件保持一致）
// ─────────────────────────────────────────────
const SERVICE_UUID = '12345678-1234-1234-1234-123456789ABC'
const CHAR_RX_UUID = '12345678-1234-1234-1234-123456789AB1' // 手机写 → ESP32
const CHAR_TX_UUID = '12345678-1234-1234-1234-123456789AB2' // ESP32通知 → 手机

const CMD = {
  TEXT_DISPLAY: 0x01,  // 手机 → ESP32: 显示文字
  AUDIO_CHUNK:  0x02,  // 手机 → ESP32: 音频数据块
  AUDIO_END:    0x03,  // 手机 → ESP32: 音频发送完毕
  REC_CHUNK:    0x10,  // ESP32 → 手机: 录音数据块
  REC_END:      0x11,  // ESP32 → 手机: 录音结束
  EMERGENCY:    0x20,  // ESP32 → 手机: 紧急消息
  BTN_EVENT:    0x21,  // ESP32 → 手机: 按键事件
}

// 单次 BLE 写入最大载荷（MTU512，首字节为命令，实际可用511字节，保守取480）
const BLE_CHUNK_SIZE = 480
const SAMPLE_RATE = 16000

// UUID 标准化比较（大写去横线）
function uuidEq(a, b) {
  return a.toUpperCase().replace(/-/g, '') === b.toUpperCase().replace(/-/g, '')
}

// ─────────────────────────────────────────────
//  Page
// ─────────────────────────────────────────────
Page({
  data: {
    // 连接状态: idle | scanning | connecting | connected | disconnected
    status: 'idle',
    statusText: '未连接',
    statusIcon: '🔵',
    deviceList: [],

    // 消息列表 { id, type: 'sent'|'received'|'audio'|'emergency'|'info', content, time }
    messages: [],

    // 文字输入
    inputText: '',

    // 录音 / 播放状态
    isRecording: false,
    isPlaying: false,
    lastMsgId: '',  // 用于 scroll-into-view
  },

  // ── 私有状态（不进 data）──────────────────────
  _deviceId: '',
  _serviceId: '',
  _rxCharId: '',   // 写特征
  _txCharId: '',   // 通知特征
  _recorderMgr: null,
  _audioBufs: [],  // 接收到的 PCM chunk ArrayBuffer[]
  _audioCtx: null,
  _msgIdCounter: 0,

  // ─────────────────────────────────────────────
  //  生命周期
  // ─────────────────────────────────────────────
  onLoad() {
    this._initRecorder()
  },

  onUnload() {
    this._cleanup()
  },

  // ─────────────────────────────────────────────
  //  录音初始化
  // ─────────────────────────────────────────────
  _initRecorder() {
    const rm = wx.getRecorderManager()
    this._recorderMgr = rm

    rm.onStart(() => {
      this.setData({ isRecording: true })
      this._pushInfo('🎙️ 开始录音...')
    })

    // frameSize 触发时收到原始 PCM 帧
    rm.onFrameRecorded(({ frameBuffer, isLastFrame }) => {
      this._sendAudioChunks(frameBuffer)
      if (isLastFrame) {
        this._sendCmd(new Uint8Array([CMD.AUDIO_END]).buffer)
        this.setData({ isRecording: false })
        this._pushInfo('✅ 音频已发送')
      }
    })

    rm.onStop(() => {
      // 手动 stop() 时也补发结束命令
      this._sendCmd(new Uint8Array([CMD.AUDIO_END]).buffer)
      this.setData({ isRecording: false })
      this._pushInfo('✅ 音频已发送')
    })

    rm.onError((err) => {
      console.error('Recorder error:', err)
      this.setData({ isRecording: false })
      wx.showToast({ title: '录音失败', icon: 'error' })
    })
  },

  // ─────────────────────────────────────────────
  //  BLE 扫描 / 连接
  // ─────────────────────────────────────────────
  startScan() {
    this.setData({ status: 'scanning', statusText: '扫描中...', statusIcon: '🔍', deviceList: [] })

    wx.openBluetoothAdapter({
      success: () => {
        wx.onBluetoothAdapterStateChange((state) => {
          if (!state.available) {
            wx.showModal({ title: '提示', content: '蓝牙已关闭，请重新开启', showCancel: false })
          }
        })

        wx.startBluetoothDevicesDiscovery({
          services: [],  // 不过滤，兼容更多情况
          allowDuplicatesKey: false,
          powerLevel: 'high',
          success: () => {
            wx.onBluetoothDeviceFound((res) => {
              const found = res.devices.filter(d =>
                d.name && (d.name.includes('ESP32') || d.name.includes('Voice'))
              )
              if (found.length === 0) return

              const list = [...this.data.deviceList]
              found.forEach(d => {
                if (!list.find(x => x.deviceId === d.deviceId)) {
                  list.push({ deviceId: d.deviceId, name: d.name || '未知设备', RSSI: d.RSSI })
                }
              })
              this.setData({ deviceList: list })
            })
          },
          fail: (err) => {
            console.error('startBluetoothDevicesDiscovery fail:', err)
            this.setData({ status: 'idle', statusText: '扫描失败', statusIcon: '❌' })
          }
        })
      },
      fail: () => {
        wx.showModal({ title: '提示', content: '请先开启手机蓝牙', showCancel: false })
        this.setData({ status: 'idle', statusText: '未连接', statusIcon: '🔵' })
      }
    })
  },

  stopScan() {
    wx.stopBluetoothDevicesDiscovery()
    this.setData({ status: 'idle', statusText: '未连接', statusIcon: '🔵' })
  },

  connectDevice(e) {
    const { deviceid } = e.currentTarget.dataset
    const device = this.data.deviceList.find(d => d.deviceId === deviceid)
    if (!device) return

    wx.stopBluetoothDevicesDiscovery()
    this.setData({ status: 'connecting', statusText: `连接中 ${device.name}`, statusIcon: '⏳', deviceList: [] })
    this._deviceId = deviceid

    wx.createBLEConnection({
      deviceId: deviceid,
      success: () => this._onBleConnected(device),
      fail: (err) => {
        console.error('createBLEConnection fail:', err)
        this.setData({ status: 'idle', statusText: '连接失败', statusIcon: '❌' })
        wx.showToast({ title: '连接失败，请重试', icon: 'none' })
      }
    })
  },

  _onBleConnected(device) {
    // 监听连接状态变化
    wx.onBLEConnectionStateChange((res) => {
      if (!res.connected && res.deviceId === this._deviceId) {
        this._deviceId = ''
        this.setData({ status: 'disconnected', statusText: '连接已断开', statusIcon: '🔴' })
        this._pushInfo('⚠️ 设备已断开连接')
      }
    })

    // 请求大 MTU
    wx.setBLEMTU({
      deviceId: this._deviceId,
      mtu: 512,
      complete: () => this._discoverServices()
    })
  },

  _discoverServices() {
    wx.getBLEDeviceServices({
      deviceId: this._deviceId,
      success: (res) => {
        const svc = res.services.find(s => uuidEq(s.uuid, SERVICE_UUID))
        if (!svc) {
          wx.showModal({ title: '错误', content: '未找到目标服务，请检查设备固件', showCancel: false })
          return
        }
        this._serviceId = svc.uuid
        this._discoverCharacteristics()
      },
      fail: (err) => {
        console.error('getBLEDeviceServices fail:', err)
      }
    })
  },

  _discoverCharacteristics() {
    wx.getBLEDeviceCharacteristics({
      deviceId: this._deviceId,
      serviceId: this._serviceId,
      success: (res) => {
        res.characteristics.forEach(c => {
          if (uuidEq(c.uuid, CHAR_RX_UUID)) this._rxCharId = c.uuid
          if (uuidEq(c.uuid, CHAR_TX_UUID)) this._txCharId = c.uuid
        })

        if (!this._rxCharId || !this._txCharId) {
          wx.showModal({ title: '错误', content: '特征值查找失败，请重试', showCancel: false })
          return
        }

        this._subscribeNotify()
        this.setData({ status: 'connected', statusText: '已连接', statusIcon: '🟢' })
        this._pushInfo('🎉 设备连接成功！单击按键录音，长按发送紧急消息')
        wx.showToast({ title: '连接成功', icon: 'success' })
      },
      fail: (err) => {
        console.error('getBLEDeviceCharacteristics fail:', err)
      }
    })
  },

  _subscribeNotify() {
    wx.notifyBLECharacteristicValueChange({
      deviceId: this._deviceId,
      serviceId: this._serviceId,
      characteristicId: this._txCharId,
      state: true,
      success: () => {
        wx.onBLECharacteristicValueChange((res) => {
          if (res.deviceId === this._deviceId) {
            this._onReceive(res.value)
          }
        })
      }
    })
  },

  // ─────────────────────────────────────────────
  //  接收 ESP32 数据
  // ─────────────────────────────────────────────
  _onReceive(buffer) {
    const data = new Uint8Array(buffer)
    if (data.length === 0) return
    const cmd = data[0]

    switch (cmd) {
      case CMD.REC_CHUNK: {
        // 累积录音 PCM 块
        if (data.length > 1) {
          this._audioBufs.push(buffer.slice(1))
        }
        break
      }

      case CMD.REC_END: {
        // 组装并播放
        if (this._audioBufs.length > 0) {
          this._pushInfo(`📩 收到语音（${this._audioBufs.length} 包），正在播放...`)
          this._assembleAndPlay()
        }
        break
      }

      case CMD.EMERGENCY: {
        const text = this._decodeUtf8(data.slice(1))
        this._pushMsg({ type: 'emergency', content: `🚨 ${text}` })
        wx.vibrateShort({ type: 'heavy' })
        wx.vibrateShort({ type: 'heavy' })
        wx.showModal({
          title: '⚠️ 紧急消息',
          content: text,
          showCancel: false,
          confirmText: '收到'
        })
        break
      }

      case CMD.BTN_EVENT: {
        const ev = data[1]
        if (ev === 0x01) this._pushInfo('👆 设备按键：单击（开始/停止录音）')
        if (ev === 0x02) this._pushInfo('✊ 设备按键：长按（紧急求助）')
        break
      }

      default:
        console.warn('未知命令:', cmd)
    }
  },

  // ─────────────────────────────────────────────
  //  音频播放（PCM → WAV → 文件 → InnerAudioContext）
  // ─────────────────────────────────────────────
  _assembleAndPlay() {
    // 合并所有 PCM chunk
    const totalBytes = this._audioBufs.reduce((s, b) => s + b.byteLength, 0)
    const pcm = new Uint8Array(totalBytes)
    let offset = 0
    this._audioBufs.forEach(b => {
      pcm.set(new Uint8Array(b), offset)
      offset += b.byteLength
    })
    this._audioBufs = []

    // 拼 WAV 头
    const wavBuffer = this._addWavHeader(pcm.buffer)
    const filePath = `${wx.env.USER_DATA_PATH}/esp_rec_${Date.now()}.wav`

    wx.getFileSystemManager().writeFile({
      filePath,
      data: wavBuffer,
      encoding: 'binary',
      success: () => {
        const msgId = this._pushMsg({ type: 'audio', content: filePath, label: '🔊 点击播放语音' })
        this._playFile(filePath, msgId)
      },
      fail: (err) => {
        console.error('writeFile fail:', err)
        this._pushInfo('❌ 音频保存失败')
      }
    })
  },

  _addWavHeader(pcmBuffer) {
    const numChannels = 1
    const bitsPerSample = 16
    const byteRate = SAMPLE_RATE * numChannels * bitsPerSample / 8
    const blockAlign = numChannels * bitsPerSample / 8
    const dataSize = pcmBuffer.byteLength
    const header = new DataView(new ArrayBuffer(44))

    const w4 = (offset, str) => {
      for (let i = 0; i < 4; i++) header.setUint8(offset + i, str.charCodeAt(i))
    }
    w4(0, 'RIFF');  header.setUint32(4, 36 + dataSize, true)
    w4(8, 'WAVE');  w4(12, 'fmt ')
    header.setUint32(16, 16, true)          // fmt chunk size
    header.setUint16(20, 1, true)           // PCM
    header.setUint16(22, numChannels, true)
    header.setUint32(24, SAMPLE_RATE, true)
    header.setUint32(28, byteRate, true)
    header.setUint16(32, blockAlign, true)
    header.setUint16(34, bitsPerSample, true)
    w4(36, 'data'); header.setUint32(40, dataSize, true)

    const result = new Uint8Array(44 + dataSize)
    result.set(new Uint8Array(header.buffer), 0)
    result.set(new Uint8Array(pcmBuffer), 44)
    return result.buffer
  },

  _playFile(filePath, msgId) {
    if (this._audioCtx) {
      this._audioCtx.destroy()
      this._audioCtx = null
    }
    this.setData({ isPlaying: true })
    const ctx = wx.createInnerAudioContext()
    this._audioCtx = ctx
    ctx.src = filePath
    ctx.play()
    ctx.onEnded(() => this.setData({ isPlaying: false }))
    ctx.onError((e) => {
      console.error('Audio play error:', e)
      this.setData({ isPlaying: false })
      this._pushInfo('❌ 播放失败: ' + JSON.stringify(e))
    })
  },

  // 点击消息列表中的音频消息重播
  onAudioTap(e) {
    const { path } = e.currentTarget.dataset
    if (path) this._playFile(path, '')
  },

  // ─────────────────────────────────────────────
  //  发送文字
  // ─────────────────────────────────────────────
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

    const textBytes = this._encodeUtf8(text)  // ← 替换 TextEncoder
    const packet = new Uint8Array(1 + textBytes.length)
    packet[0] = CMD.TEXT_DISPLAY
    packet.set(textBytes, 1)
    this._sendCmd(packet.buffer)

    this._pushMsg({ type: 'sent', content: text })
    this.setData({ inputText: '' })
  },

  // ─────────────────────────────────────────────
  //  录音发送
  // ─────────────────────────────────────────────
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
            frameSize: 2,  // 每帧约 2KB (~64ms @ 16kHz 16bit)
          })
        },
        fail: () => {
          wx.showModal({
            title: '需要麦克风权限',
            content: '请在设置中允许使用麦克风',
            showCancel: false
          })
        }
      })
    } else {
      this._recorderMgr.stop()
    }
  },

  // ─────────────────────────────────────────────
  //  BLE 写入辅助
  // ─────────────────────────────────────────────
  _sendCmd(buffer) {
    if (!this._deviceId || !this._rxCharId) return
    wx.writeBLECharacteristicValue({
      deviceId: this._deviceId,
      serviceId: this._serviceId,
      characteristicId: this._rxCharId,
      value: buffer,
      fail: (err) => console.error('writeBLE fail:', err)
    })
  },

  // 将大 PCM buffer 分包发送（每包 BLE_CHUNK_SIZE 字节载荷）
  _sendAudioChunks(pcmBuffer) {
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
      // 短延迟避免 BLE 队列溢出
      setTimeout(sendNext, 10)
    }
    sendNext()
  },

  // ─────────────────────────────────────────────
  //  消息列表辅助
  // ─────────────────────────────────────────────
  _pushMsg(msg) {
    this._msgIdCounter++
    const id = `msg_${this._msgIdCounter}`
    const now = new Date()
    const timeStr = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`
    const messages = [...this.data.messages, { ...msg, id, time: timeStr }]
    if (messages.length > 100) messages.shift()
    this.setData({ messages, lastMsgId: id })
    return id
  },

  _pushInfo(text) {
    return this._pushMsg({ type: 'info', content: text })
  },

  // ─────────────────────────────────────────────
  //  断开 / 清理
  // ─────────────────────────────────────────────
  disconnect() {
    if (this._deviceId) {
      wx.closeBLEConnection({ deviceId: this._deviceId })
    }
    this._deviceId = ''
    this.setData({ status: 'idle', statusText: '未连接', statusIcon: '🔵' })
  },

  _cleanup() {
    if (this._deviceId) wx.closeBLEConnection({ deviceId: this._deviceId })
    wx.closeBluetoothAdapter()
    if (this._audioCtx) this._audioCtx.destroy()
    if (this._recorderMgr) this._recorderMgr.stop()
  },

  // ─────────────────────────────────────────────
  //  工具
  // ─────────────────────────────────────────────

  // 替代 TextEncoder，兼容微信小程序低版本基础库
  _encodeUtf8(str) {
    const bytes = []
    for (let i = 0; i < str.length; i++) {
      let code = str.codePointAt(i)
      if (code > 0xFFFF) i++ // 跳过代理对的第二个码元（emoji 等4字节字符）
      if (code <= 0x7F) {
        bytes.push(code)
      } else if (code <= 0x7FF) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
      } else if (code <= 0xFFFF) {
        bytes.push(
          0xE0 | (code >> 12),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        )
      } else {
        bytes.push(
          0xF0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3F),
          0x80 | ((code >> 6) & 0x3F),
          0x80 | (code & 0x3F)
        )
      }
    }
    return new Uint8Array(bytes)
  },

  _decodeUtf8(uint8arr) {
    try {
      return new TextDecoder('utf-8').decode(uint8arr)
    } catch (e) {
      // TextDecoder 不可用时的降级（纯 ASCII）
      return String.fromCharCode(...uint8arr)
    }
  },
})