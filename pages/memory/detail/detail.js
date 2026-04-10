// pages/memory/detail/detail.js
const app = getApp()
const recorderManager = wx.getRecorderManager()

function callMemory(action, extra = {}) {
  return wx.cloud.callFunction({ name: 'memory', data: { action, ...extra } })
    .then(r => r.result)
}

function cloudUpload(filePath, type) {
  const ext = type === 'audio' ? 'mp3' : 'jpg'
  const cloudPath = `memories/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  return wx.cloud.uploadFile({ cloudPath, filePath }).then(r => r.fileID)
}

Page({
  data: {
    id: '',
    memory: { voiceNote: { url: '', duration: 0, text: '' } },
    editingStory: false,
    storyDraft: '',
    editingVoiceText: false,
    voiceTextDraft: '',
    recording: false,
    voiceLoading: false,
    playingVoice: false
  },

  onLoad(options) {
    if (!app.checkLogin()) return
    this.audio = wx.createInnerAudioContext()
    this.audio.obeyMuteSwitch = false
    this.audio.onPlay(() => this.setData({ playingVoice: true }))
    this.audio.onStop(() => this.setData({ playingVoice: false }))
    this.audio.onEnded(() => this.setData({ playingVoice: false }))
    this.audio.onError(() => {
      this.setData({ playingVoice: false })
      wx.showToast({ title: '语音播放失败', icon: 'none' })
    })
    this.setData({ id: options.id || '' })
    this._bindRecorder()
    this._fetchDetail()
  },

  onUnload() {
    recorderManager.stop()
    if (this.audio) {
      this.audio.stop()
      this.audio.destroy()
    }
  },

  async onPullDownRefresh() {
    await this._fetchDetail()
    wx.stopPullDownRefresh()
  },

  _bindRecorder() {
    recorderManager.onStop(async (res) => {
      const duration = Math.max(1, Math.round((res.duration || 0) / 1000))
      this.setData({ voiceLoading: true })
      try {
        const fileID = await cloudUpload(res.tempFilePath, 'audio')
        await callMemory('update', {
          id: this.data.id,
          data: {
            voiceNote: {
              url: fileID,
              duration,
              text: this.data.memory.voiceNote?.text || this.data.voiceTextDraft || ''
            }
          }
        })
        this.setData({ recording: false, voiceLoading: false })
        wx.showToast({ title: '语音已保存', icon: 'success' })
        this._fetchDetail()
      } catch (e) {
        this.setData({ recording: false, voiceLoading: false })
        wx.showToast({ title: '语音保存失败', icon: 'none' })
      }
    })
    recorderManager.onError(() => {
      this.setData({ recording: false })
      wx.showToast({ title: '录音失败', icon: 'none' })
    })
  },

  async _fetchDetail() {
    try {
      const res = await callMemory('get', { id: this.data.id })
      if (res.code !== 0) {
        wx.showToast({ title: res.msg || '加载失败', icon: 'none' })
        return
      }
      const memory = res.data
      this.setData({
        memory,
        storyDraft: memory.story || '',
        voiceTextDraft: memory.voiceNote?.text || ''
      })
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  toggleEditStory() {
    this.setData({ editingStory: !this.data.editingStory, storyDraft: this.data.memory.story || '' })
  },

  onStoryInput(e) {
    this.setData({ storyDraft: e.detail.value })
  },

  cancelEditStory() {
    this.setData({ editingStory: false, storyDraft: this.data.memory.story || '' })
  },

  async saveStory() {
    wx.showLoading({ title: '保存中…' })
    try {
      await callMemory('update', { id: this.data.id, data: { story: this.data.storyDraft } })
      this.setData({ editingStory: false, 'memory.story': this.data.storyDraft })
      wx.showToast({ title: '故事已保存', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  toggleVoiceTextEdit() {
    this.setData({ editingVoiceText: !this.data.editingVoiceText, voiceTextDraft: this.data.memory.voiceNote?.text || '' })
  },

  onVoiceTextInput(e) {
    this.setData({ voiceTextDraft: e.detail.value })
  },

  cancelVoiceTextEdit() {
    this.setData({ editingVoiceText: false, voiceTextDraft: this.data.memory.voiceNote?.text || '' })
  },

  async saveVoiceText() {
    wx.showLoading({ title: '保存中…' })
    try {
      const voiceNote = {
        ...this.data.memory.voiceNote,
        text: this.data.voiceTextDraft
      }
      await callMemory('update', { id: this.data.id, data: { voiceNote } })
      this.setData({ editingVoiceText: false, 'memory.voiceNote.text': this.data.voiceTextDraft })
      wx.showToast({ title: '文字已保存', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  toggleRecordVoice() {
    if (this.data.voiceLoading) return
    if (this.data.recording) {
      recorderManager.stop()
      return
    }
    recorderManager.start({ duration: 60000, sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 96000, format: 'mp3' })
    this.setData({ recording: true })
  },

  playVoice() {
    const url = this.data.memory.voiceNote?.url
    if (!url) {
      wx.showToast({ title: '暂无语音记忆', icon: 'none' })
      return
    }
    if (this.data.playingVoice) {
      this.audio.stop()
      return
    }
    this.audio.src = url
    this.audio.play()
  },

  async deleteVoice() {
    if (!this.data.memory.voiceNote?.url) {
      wx.showToast({ title: '暂无可删除的语音', icon: 'none' })
      return
    }
    const modal = await wx.showModal({
      title: '删除语音', content: '确定删除这段语音记忆吗？',
      confirmText: '删除', confirmColor: '#ff5c5c'
    })
    if (!modal.confirm) return
    wx.showLoading({ title: '删除中…' })
    try {
      if (this.data.playingVoice) this.audio.stop()
      await callMemory('deleteVoice', { id: this.data.id })
      this.setData({
        'memory.voiceNote': { url: '', duration: 0, text: '' },
        voiceTextDraft: '',
        playingVoice: false,
        editingVoiceText: false
      })
      wx.showToast({ title: '语音已删除', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async deleteMemory() {
    const modal = await wx.showModal({
      title: '删除记忆', content: '确定要删除这条记忆吗？删除后无法恢复。',
      confirmText: '删除', confirmColor: '#ff5c5c'
    })
    if (!modal.confirm) return
    wx.showLoading({ title: '删除中…' })
    try {
      await callMemory('delete', { id: this.data.id })
      wx.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 300)
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
