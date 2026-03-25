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
    activeMember: 'all',
    members: [{ id: 'all', name: '全部', avatar: '' }],
    photos: [],
    memoryHints: [],
    loading: false,
    // 成员弹窗
    showMemberModal: false,
    editingMember: null,
    memberForm: { name: '', relation: '' },
    // 照片详情弹窗
    showDetailModal: false,
    detailPhoto: { memberNames: [] },
    // 照片编辑弹窗
    showPhotoEditModal: false,
    editingPhoto: null,
    photoForm: { caption: '', members: [], type: 'image' },
    selectableMembers: []
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
        memoryAPI.getPhotos(this.data.activeMember === 'all' ? undefined : this.data.activeMember),
        memoryAPI.getHints()
      ])
      if (membersRes.code === 0) {
        const members = [{ id: 'all', name: '全部', avatar: '' }, ...membersRes.data]
        this.setData({ members })
      }
      if (photosRes.code === 0) {
        const photos = (photosRes.data || []).map(item => ({
          ...item,
          thumb: toAbsoluteUrl(item.thumb || item.cover || item.url),
          url: toAbsoluteUrl(item.url || item.thumb),
          cover: toAbsoluteUrl(item.cover || item.thumb || item.url)
        }))
        this.setData({ photos })
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

  // ══════ 成员筛选 ══════
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
              this._buildSelectableMembers([])
              this.setData({
                showPhotoEditModal: true,
                editingPhoto: null,
                photoForm: { caption: '', members: [], type: mediaType }
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
          this._buildSelectableMembers(photo.members || [])
          this.setData({
            showPhotoEditModal: true,
            editingPhoto: photo,
            photoForm: {
              caption: photo.caption || '',
              members: [...(photo.members || [])],
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
  _buildSelectableMembers(selectedIds) {
    const realMembers = this.data.members.filter(m => m.id !== 'all')
    const selectable = realMembers.map(m => ({
      id: m.id,
      name: m.name,
      selected: selectedIds.includes(m.id)
    }))
    this.setData({ selectableMembers: selectable })
  },

  hidePhotoEditModal() {
    this.setData({ showPhotoEditModal: false })
    this._tempAddFile = null
    this._tempAddThumb = null
  },

  onPhotoCaptionInput(e) {
    this.setData({ 'photoForm.caption': e.detail.value })
  },

  togglePhotoMember(e) {
    const id = e.currentTarget.dataset.id
    const list = this.data.selectableMembers.map(m => {
      if (m.id === id) return { ...m, selected: !m.selected }
      return m
    })
    const selectedIds = list.filter(m => m.selected).map(m => m.id)
    this.setData({ selectableMembers: list, 'photoForm.members': selectedIds })
  },

  async savePhotoEdit() {
    const { photoForm, editingPhoto } = this.data
    wx.showLoading({ title: '保存中…' })
    try {
      if (editingPhoto) {
        await memoryAPI.updatePhoto(editingPhoto.id, {
          caption: photoForm.caption,
          members: photoForm.members,
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
          voiceNote: { url: '', duration: 0, text: '' },
          members: photoForm.members
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

  // ══════ 成员管理 ══════
  showAddMember() {
    this.setData({
      showMemberModal: true,
      editingMember: null,
      memberForm: { name: '', relation: '' }
    })
  },

  manageMember(e) {
    const member = e.currentTarget.dataset.member
    if (member.id === 'all') return
    this.setData({
      showMemberModal: true,
      editingMember: member,
      memberForm: { name: member.name, relation: member.relation }
    })
  },

  hideMemberModal() {
    this.setData({ showMemberModal: false })
  },

  stopPropagation() {},

  onMemberNameInput(e) {
    this.setData({ 'memberForm.name': e.detail.value })
  },

  onMemberRelationInput(e) {
    this.setData({ 'memberForm.relation': e.detail.value })
  },

  async saveMember() {
    const { memberForm, editingMember } = this.data
    if (!memberForm.name.trim()) {
      wx.showToast({ title: '请输入姓名', icon: 'none' })
      return
    }
    if (!memberForm.relation.trim()) {
      wx.showToast({ title: '请输入关系', icon: 'none' })
      return
    }
    wx.showLoading({ title: '保存中…' })
    try {
      if (editingMember) {
        await memoryAPI.updateMember(editingMember.id, memberForm)
        wx.showToast({ title: '已更新', icon: 'success' })
      } else {
        await memoryAPI.addMember(memberForm)
        wx.showToast({ title: '已添加', icon: 'success' })
      }
      this.hideMemberModal()
      this._fetchAll()
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  },

  async deleteMember() {
    const { editingMember } = this.data
    if (!editingMember) return
    const res = await wx.showModal({
      title: '确认删除',
      content: `确定要删除「${editingMember.name}（${editingMember.relation}）」吗？`,
      confirmText: '删除',
      confirmColor: '#ff5c5c'
    })
    if (!res.confirm) return
    wx.showLoading({ title: '删除中…' })
    try {
      await memoryAPI.deleteMember(editingMember.id)
      wx.showToast({ title: '已删除', icon: 'success' })
      this.hideMemberModal()
      this._fetchAll()
    } catch (e) {
      wx.showToast({ title: '删除失败', icon: 'none' })
    } finally {
      wx.hideLoading()
    }
  }
})
