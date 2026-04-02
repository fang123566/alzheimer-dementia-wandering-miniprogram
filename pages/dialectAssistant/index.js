const app = getApp()

Page({
  data: {
    isRecording: false,
    asrResult: '',
    accentList: ['普通话', '粤语', '四川话', '河南话', '东北话'],
    accentMap: { '普通话':'mandarin','粤语':'cantonese','四川话':'sichuan','河南话':'henanese','东北话':'dongbei' },
    accentIndex: 0,
    currentAccent: 'mandarin',

    ttsText: '',
    voiceList: ['普通话-小燕', '粤语-小美', '四川话-小川'],
    voiceMap: { '普通话-小燕':'xiaoyan','粤语-小美':'xiaomei','四川话-小川':'xiaochuan' },
    voiceIndex: 0,
    currentVoice: 'xiaoyan',
    audioUrl: '',

    phraseList: ['我要回家', '我不舒服', '帮我打电话', '今天吃什么', '今天天气怎么样']
  },

  onAccentChange(e) {
    this.setData({ accentIndex: e.detail.value, currentAccent: this.data.accentMap[this.data.accentList[e.detail.value]] })
  },

  onVoiceChange(e) {
    this.setData({ voiceIndex: e.detail.value, currentVoice: this.data.voiceMap[this.data.voiceList[e.detail.value]] })
  },

  onTtsTextInput(e) { this.setData({ ttsText: e.detail.value }) },

  usePhrase(e) {
    this.setData({ ttsText: e.currentTarget.dataset.text })
    this.startTts()
  },

  startRecord() {
    if (this.data.isRecording) {
      wx.stopRecordManagerStop()
      this.setData({ isRecording: false })
      return
    }

    this.setData({ isRecording: true, asrResult: '正在识别...' })
    const recorderManager = wx.getRecorderManager()

    recorderManager.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 96000, format: 'PCM' })

    recorderManager.onStop((res) => {
      this.setData({ isRecording: false })
      wx.getFileSystemManager().readFile({
        filePath: res.tempFilePath,
        encoding: 'base64',
        success: (fileRes) => {
          wx.cloud.callFunction({
            name: 'asrTts',
            data: { type: 'asr', data: fileRes.data, language: 'zh_cn', accent: this.data.currentAccent },
            success: (cloudRes) => {
              this.setData({ asrResult: cloudRes.result.success ? cloudRes.result.data : '识别失败' })
            },
            fail: () => { wx.showToast({ title: '调用失败', icon: 'none' }) }
          })
        },
        fail: () => { wx.showToast({ title: '读取音频失败', icon: 'none' }) }
      })
    })

    recorderManager.onError(() => {
      wx.showToast({ title: '录音失败', icon: 'none' })
      this.setData({ isRecording: false })
    })
  },

  startTts() {
    const text = this.data.ttsText.trim()
    if (!text) { wx.showToast({ title: '请输入文字', icon: 'none' }); return }

    wx.showLoading({ title: '生成语音中...' })
    wx.cloud.callFunction({
      name: 'asrTts',
      data: { type: 'tts', data: text, voiceName: this.data.currentVoice },
      success: (res) => {
        wx.hideLoading()
        if (res.result.success) {
          const tempPath = `${wx.env.USER_DATA_PATH}/tts_audio.pcm`
          wx.getFileSystemManager().writeFile({
            filePath: tempPath,
            data: res.result.data,
            encoding: 'base64',
            success: () => { this.setData({ audioUrl: tempPath }) }
          })
        } else {
          wx.showToast({ title: res.result.message, icon: 'none' })
        }
      },
      fail: () => { wx.hideLoading(); wx.showToast({ title: '调用失败', icon: 'none' }) }
    })
  }
})