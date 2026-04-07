// pages/memory/memory.js
const { memoryAPI } = require('../../utils/api')
const http = require('../../utils/request')

function toAbsoluteUrl(url) {
  if (!url) return ''
  if (/^https?:\/\//.test(url)) return url
  if (url.startsWith('/')) return `${http.ROOT_URL}${url}`
  return url
}

Page({
  data: {
    photos: [],
    videoCount: 0,
    loading: false,
    showPhotoEditModal: false,
    editingPhoto: null,
    photoForm: { caption: '', type: 'image' }
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
      const photosRes = await memoryAPI.getPhotos()
      if (photosRes.code === 0) {
        const photos = (photosRes.data || []).map(item => ({
          ...item,
          thumb: toAbsoluteUrl(item.thumb || item.cover || item.url),
          url: toAbsoluteUrl(item.url || item.thumb),
          cover: toAbsoluteUrl(item.cover || item.thumb || item.url)
        }))
        this.setData({
          photos,
          videoCount: photos.filter(p => p.type === 'video').length
        })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // ══════ 添加媒体 ══════
  addPhoto() {
    wx.showActionSheet({
      itemList: ['添加照片', '添加视频'],
      success: (sheetRes) => {
        const mediaType = sheetRes.tapIndex === 1 ? 'video' : 'image'
        wx.chooseMedia({
          count: mediaType === 'video' ? 1 : 9,
          mediaType: [mediaType],
          success: (res) => {
            if (res.tempFiles.length === 1) {
              const file = res.tempFiles[0]
              this._tempAddFile = file.tempFilePath
              this._tempAddThumb = file.thumbTempFilePath || file.tempFilePath
              this.setData({
                showPhotoEditModal: true,
                editingPhoto: null,
                photoForm: { caption: '', type: mediaType }
              })
            } else {
              this._batchAddPhotos(res.tempFiles)
            }
          }
        })
      }
    })
  },

  async _batchAddPhotos(files) {
    wx.showLoading({ title: '上传中…', mask: true })
    try {
      for (const file of files) {
        const uploadRes = await memoryAPI.uploadMedia(file.tempFilePath, 'image')
        await memoryAPI.addPhoto({
          type: 'image',
          thumb: uploadRes.data.url,
          url: uploadRes.data.url,
          cover: uploadRes.data.url,
          caption: '',
          story: '',
          voiceNote: { url: '', duration: 0, text: '' },
          members: []
        })
      }
      wx.hideLoading()
      wx.showToast({ title: `已添加${files.length}项`, icon: 'success' })
      this._fetchAll()
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  // ══════ 详情页跳转 ══════
  showPhotoDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/memory/detail/detail?id=${id}` })
  },

  // 长按照片弹出操作菜单
  showPhotoActions(e) {
    const id = e.currentTarget.dataset.id
    const photo = this.data.photos.find(p => p.id === id)
    if (!photo) return
    wx.showActionSheet({
      itemList: ['查看详情', '编辑基本信息', '删除记忆'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.showPhotoDetail(e)
        } else if (res.tapIndex === 1) {
          this.setData({
            showPhotoEditModal: true,
            editingPhoto: photo,
            photoForm: {
              caption: photo.caption || '',
              type: photo.type || 'image'
            }
          })
        } else if (res.tapIndex === 2) {
          this._deletePhoto(photo.id)
        }
      }
    })
  },

  async _deletePhoto(id) {
    const res = await wx.showModal({
      title: '删除照片',
      content: '确定要删除这张照片吗？',
      confirmText: '删除',
      confirmColor: '#ff5c5c'
    })
    if (!res.confirm) return
    wx.showLoading({ title: '删除中…' })
    try {
      await memoryAPI.deletePhoto(id)
      wx.showToast({ title: '已删除', icon: 'success' })
      this._fetchAll()
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  // ══════ 照片编辑弹窗 ══════
  hidePhotoEditModal() {
    this.setData({ showPhotoEditModal: false })
    this._tempAddFile = null
    this._tempAddThumb = null
  },

  onPhotoCaptionInput(e) {
    this.setData({ 'photoForm.caption': e.detail.value })
  },

  async savePhotoEdit() {
    const { photoForm, editingPhoto } = this.data
    wx.showLoading({ title: '保存中…' })
    try {
      if (editingPhoto) {
        await memoryAPI.updatePhoto(editingPhoto.id, {
          caption: photoForm.caption,
          type: photoForm.type
        })
        wx.showToast({ title: '已更新', icon: 'success' })
      } else {
        const uploadRes = await memoryAPI.uploadMedia(
          this._tempAddFile || '',
          photoForm.type === 'video' ? 'video' : 'image'
        )
        await memoryAPI.addPhoto({
          type: photoForm.type,
          thumb: photoForm.type === 'video' ? (this._tempAddThumb || uploadRes.data.url) : uploadRes.data.url,
          url: uploadRes.data.url,
          cover: photoForm.type === 'video' ? (this._tempAddThumb || uploadRes.data.url) : uploadRes.data.url,
          caption: photoForm.caption,
          story: '',
          voiceNote: { url: '', duration: 0, text: '' }
        })
        wx.showToast({ title: '已添加', icon: 'success' })
      }
      this.hidePhotoEditModal()
      this._fetchAll()
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  stopPropagation() {}
})
