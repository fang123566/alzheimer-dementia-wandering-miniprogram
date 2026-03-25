// pages/memory/detail/detail.js
const { memoryAPI } = require('../../../utils/api')
const http = require('../../../utils/request')

const recorderManager = wx.getRecorderManager()

function toAbsoluteUrl(url) {
  if (!url) return ''
  if (/^https?:\/\//.test(url)) return url
  if (url.startsWith('/')) return `${http.ROOT_URL}${url}`
  return url
}

Page({
  data: {
    id: '',
    memory: { voiceNote: {} },
    memberNames: [],
    editingStory: false,
    storyDraft: '',
    editingVoiceText: false,
    voiceTextDraft: '',
    recording: false
  },

  onLoad(options) {
    if (!getApp().checkLogin()) return
    this.audio = wx.createInnerAudioContext()
    this.setData({ id: options.id || '' })
    this._bindRecorder()
    this._fetchDetail()
  },

  onUnload() {
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
      try {
        const uploadRes = await memoryAPI.uploadMedia(res.tempFilePath, 'audio')
        await memoryAPI.updatePhoto(this.data.id, {
          voiceNote: {
            url: uploadRes.data.url,
            duration,
            text: this.data.memory.voiceNote?.text || this.data.voiceTextDraft || ''
          }
        })
        this.setData({ recording: false })
        wx.showToast({ title: '语音已保存', icon: 'success' })
        this._fetchDetail()
      } catch (e) {
        this.setData({ recording: false })
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
      const [detailRes, membersRes] = await Promise.all([
        memoryAPI.getPhoto(this.data.id),
        memoryAPI.getMembers()
      ])
      if (detailRes.code !== 0) throw new Error(detailRes.msg || '加载失败')
      const rawMemory = detailRes.data || {}
      const memory = {
        ...rawMemory,
        thumb: toAbsoluteUrl(rawMemory.thumb || rawMemory.cover || rawMemory.url),
        cover: toAbsoluteUrl(rawMemory.cover || rawMemory.thumb || rawMemory.url),
        url: toAbsoluteUrl(rawMemory.url || rawMemory.thumb),
        voiceNote: {
          ...(rawMemory.voiceNote || {}),
          url: toAbsoluteUrl(rawMemory.voiceNote?.url || '')
        }
      }
      const members = membersRes.code === 0 ? membersRes.data : []
      const memberNames = (memory.members || []).map(id => {
        const match = members.find(item => item.id === id)
        return match ? `${match.name}${match.relation ? `（${match.relation}）` : ''}` : id
      })
      this.setData({
        memory,
        memberNames,
        storyDraft: memory.story || '',
        voiceTextDraft: memory.voiceNote?.text || ''
      })
    } catch (e) {
      wx.showToast({ title: e.message || '加载失败', icon: 'none' })
    }
  },

  toggleEditStory() {
    this.setData({
      editingStory: !this.data.editingStory,
      storyDraft: this.data.memory.story || ''
    })
  },

  onStoryInput(e) {
    this.setData({ storyDraft: e.detail.value })
  },

  cancelEditStory() {
    this.setData({ editingStory: false, storyDraft: this.data.memory.story || '' })
  },

  async saveStory() {
    try {
      wx.showLoading({ title: '保存中…' })
      await memoryAPI.updatePhoto(this.data.id, { story: this.data.storyDraft })
      this.setData({ editingStory: false })
      wx.showToast({ title: '故事已保存', icon: 'success' })
      this._fetchDetail()
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  toggleVoiceTextEdit() {
    this.setData({
      editingVoiceText: !this.data.editingVoiceText,
      voiceTextDraft: this.data.memory.voiceNote?.text || ''
    })
  },

  onVoiceTextInput(e) {
    this.setData({ voiceTextDraft: e.detail.value })
  },

  cancelVoiceTextEdit() {
    this.setData({ editingVoiceText: false, voiceTextDraft: this.data.memory.voiceNote?.text || '' })
  },

  async saveVoiceText() {
    try {
      wx.showLoading({ title: '保存中…' })
      await memoryAPI.updatePhoto(this.data.id, {
        voiceNote: {
          url: this.data.memory.voiceNote?.url || '',
          duration: this.data.memory.voiceNote?.duration || 0,
          text: this.data.voiceTextDraft
        }
      })
      this.setData({ editingVoiceText: false })
      wx.showToast({ title: '文字已保存', icon: 'success' })
      this._fetchDetail()
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async toggleRecordVoice() {
    if (this.data.recording) {
      recorderManager.stop()
      return
    }

    try {
      const setting = await new Promise((resolve, reject) => {
        wx.getSetting({ success: resolve, fail: reject })
      })

      if (!setting.authSetting['scope.record']) {
        await new Promise((resolve, reject) => {
          wx.authorize({ scope: 'scope.record', success: resolve, fail: reject })
        })
      }

      recorderManager.start({
        duration: 60000,
        format: 'mp3'
      })
      this.setData({ recording: true })
      wx.showToast({ title: '开始录音', icon: 'none' })
    } catch (e) {
      wx.showModal({
        title: '需要录音权限',
        content: '请先开启麦克风权限后再录制语音记忆。',
        showCancel: false
      })
    }
  },

  playVoice() {
    const url = this.data.memory.voiceNote?.url
    if (!url) {
      wx.showToast({ title: '暂无语音记忆', icon: 'none' })
      return
    }
    this.audio.src = url
    this.audio.play()
  },

  async deleteMemory() {
    const res = await wx.showModal({
      title: '删除记忆',
      content: '确定要删除这条记忆吗？删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#ff5c5c'
    })
    if (!res.confirm) return
    try {
      wx.showLoading({ title: '删除中…' })
      await memoryAPI.deletePhoto(this.data.id)
      wx.showToast({ title: '已删除', icon: 'success' })
      setTimeout(() => wx.navigateBack(), 300)
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})