// pages/memory/memory.js
const { memoryAPI } = require('../../utils/api')

Page({
  data: {
    activeMember: 'all',
    members: [{ id: 'all', name: '全部', avatar: '' }],
    photos: [],
    memoryHints: [],
    loading: false
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this._fetchAll()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this._fetchAll()
  },

  async _fetchAll() {
    this.setData({ loading: true })
    try {
      const [membersRes, photosRes, hintsRes] = await Promise.all([
        memoryAPI.getMembers(),
        memoryAPI.getPhotos(),
        memoryAPI.getHints()
      ])
      if (membersRes.code === 0) {
        const members = [{ id: 'all', name: '全部', avatar: '' }, ...membersRes.data]
        this.setData({ members })
      }
      if (photosRes.code === 0) {
        this.setData({ photos: photosRes.data })
      }
      if (hintsRes.code === 0) {
        this.setData({ memoryHints: hintsRes.data })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async filterByMember(e) {
    const id = e.currentTarget.dataset.id
    this.setData({ activeMember: id })
    try {
      const res = await memoryAPI.getPhotos(id === 'all' ? undefined : id)
      if (res.code === 0) this.setData({ photos: res.data })
    } catch (e) {
      wx.showToast({ title: '筛选失败', icon: 'none' })
    }
  },

  viewPhoto(e) {
    const id = e.currentTarget.dataset.id
    const photo = this.data.photos.find(p => p.id === id)
    if (photo?.thumb) {
      wx.previewImage({ current: photo.thumb, urls: [photo.thumb] })
    } else {
      wx.showToast({ title: photo?.caption || '暂无图片', icon: 'none' })
    }
  },

  addPhoto() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      success: async (res) => {
        wx.showLoading({ title: '上传中…', mask: true })
        try {
          for (const file of res.tempFiles) {
            await memoryAPI.addPhoto({ thumb: file.tempFilePath, caption: '', members: [] })
          }
          wx.hideLoading()
          wx.showToast({ title: '上传成功', icon: 'success' })
          this._fetchAll()
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  }
})
