// pages/memory/memory.js
const app = getApp()

function callMemory(action, extra = {}) {
  return wx.cloud.callFunction({ name: 'memory', data: { action, ...extra } })
    .then(r => r.result)
}

function cloudUpload(filePath, type) {
  const ext = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg'
  const cloudPath = `memories/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  console.log('[cloudUpload] filePath:', filePath, 'cloudPath:', cloudPath)
  return wx.cloud.uploadFile({ cloudPath, filePath })
    .then(r => {
      console.log('[cloudUpload] success fileID:', r.fileID)
      return r.fileID
    })
    .catch(e => {
      console.error('[cloudUpload] error:', JSON.stringify(e))
      throw e
    })
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
    if (!app.checkLogin()) return
    this._fetchAll()
  },

  onShow() {
    if (!app.checkLogin()) return
    this._fetchAll()
  },

  async _fetchAll() {
    this.setData({ loading: true })
    try {
      const res = await callMemory('list')
      if (res.code === 0) {
        const photos = res.data || []
        this.setData({
          photos,
          videoCount: photos.filter(p => p.type === 'video').length
        })
      } else {
        wx.showToast({ title: res.msg || '加载失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

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
        const fileID = await cloudUpload(file.tempFilePath, 'image')
        await callMemory('add', {
          data: { type: 'image', url: fileID, thumb: fileID, caption: '' }
        })
      }
      wx.showToast({ title: `已添加 ${files.length} 项`, icon: 'success' })
      this._fetchAll()
    } catch (e) {
      wx.showToast({ title: '上传失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  showPhotoDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/memory/detail/detail?id=${id}` })
  },

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
            photoForm: { caption: photo.caption || '', type: photo.type || 'image' }
          })
        } else if (res.tapIndex === 2) {
          this._deletePhoto(photo.id)
        }
      }
    })
  },

  async _deletePhoto(id) {
    const modal = await wx.showModal({
      title: '删除照片',
      content: '确定要删除这张照片吗？',
      confirmText: '删除',
      confirmColor: '#ff5c5c'
    })
    if (!modal.confirm) return
    wx.showLoading({ title: '删除中…' })
    try {
      const res = await callMemory('delete', { id })
      if (res.code === 0) {
        wx.showToast({ title: '已删除', icon: 'success' })
        this._fetchAll()
      } else {
        wx.showToast({ title: res.msg || '删除失败', icon: 'none' })
      }
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  hidePhotoEditModal() {
    this.setData({ showPhotoEditModal: false, editingPhoto: null })
    this._tempAddFile = null
    this._tempAddThumb = null
  },

  onPhotoCaptionInput(e) {
    this.setData({ 'photoForm.caption': e.detail.value })
  },

  async savePhotoEdit() {
    const { photoForm, editingPhoto } = this.data
    wx.showLoading({ title: '保存中…', mask: true })
    try {
      if (editingPhoto) {
        await callMemory('update', { id: editingPhoto.id, data: { caption: photoForm.caption } })
        wx.showToast({ title: '已更新', icon: 'success' })
      } else {
        const fileID = await cloudUpload(this._tempAddFile, photoForm.type)
        const thumbID = photoForm.type === 'video' && this._tempAddThumb
          ? await cloudUpload(this._tempAddThumb, 'image')
          : fileID
        await callMemory('add', {
          data: { type: photoForm.type, url: fileID, thumb: thumbID, caption: photoForm.caption }
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
