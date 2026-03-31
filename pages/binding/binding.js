// pages/binding/binding.js
const app = getApp()
const { bindingAPI } = require('../../utils/api')

Page({
  data: {
    role: 'family',
    userInfo: {},
    bindings: [],
    bindingMeta: {
      canCreateBinding: false,
      canUnbind: false
    },
    linkedPhone: '',
    note: '',
    errMsg: '',
    binding_loading: false,
    pageLoading: true
  },

  onLoad() {
    if (!app.checkLogin()) return
    this.setData({
      role:     app.globalData.role,
      userInfo: app.globalData.userInfo || {}
    })
    this._fetchBinding()
  },

  onShow() {
    if (!app.checkLogin()) return
    this._fetchBinding()
  },

  async onPullDownRefresh() {
    await this._fetchBinding()
    wx.stopPullDownRefresh()
  },

  async _fetchBinding() {
    this.setData({ pageLoading: true })
    try {
      const res = await bindingAPI.getBindings()
      const meta = res.meta || {
        canCreateBinding: true,
        canUnbind: true
      }
      if (res.code === 0) {
        const bindings = (res.data || []).map(item => ({
          ...item,
          binding: {
            ...item.binding,
            createdAt: item.binding?.createdAt ? new Date(item.binding.createdAt).toLocaleDateString('zh-CN') : ''
          }
        }))
        this.setData({
          bindings,
          bindingMeta: meta,
          pageLoading: false
        })
        if (app.globalData.role === 'family') app.globalData.elderlyInfo = bindings[0]?.linkedUser || {}
      } else {
        this.setData({ bindings: [], bindingMeta: meta, pageLoading: false })
      }
    } catch (e) {
      this.setData({ pageLoading: false })
    }
  },

  onPhoneInput(e) {
    this.setData({ linkedPhone: e.detail.value, errMsg: '' })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value, errMsg: '' })
  },

  async doBinding() {
    const phone = this.data.linkedPhone.trim()
    if (!phone) return this.setData({ errMsg: `请输入${this.data.role === 'family' ? '老人' : '家属'}的手机号` })
    if (!/^1[3-9]\d{9}$/.test(phone)) return this.setData({ errMsg: '手机号格式不正确' })
    if (this.data.binding_loading) return

    this.setData({ binding_loading: true, errMsg: '' })
    try {
      const res = await bindingAPI.createBinding(phone, this.data.note.trim())
      if (res.code === 0) {
        wx.showToast({ title: '关联成功！', icon: 'success' })
        this.setData({
          linkedPhone: '',
          note: ''
        })
        await this._fetchBinding()
      } else {
        this.setData({ errMsg: res.msg || '关联失败' })
      }
    } catch (e) {
      this.setData({ errMsg: e.message || '网络错误，请重试' })
    } finally {
      this.setData({ binding_loading: false })
    }
  },

  editBinding(e) {
    const id = e.currentTarget.dataset.id
    const item = (this.data.bindings || []).find(x => String(x.binding?.id) === String(id))
    if (!item) return
    wx.showActionSheet({
      itemList: ['编辑关联账号', '删除关联'],
      success: (res) => {
        if (res.tapIndex === 0) this._editBindingForm(item)
        if (res.tapIndex === 1) this.removeBinding(item)
      }
    })
  },

  _editBindingForm(item) {
    const current = [item.linkedUser?.phone || '', item.binding?.note || ''].join(',')
    wx.showModal({
      title: '编辑关联',
      editable: true,
      content: current,
      placeholderText: '手机号,备注(可选)',
      success: async (res) => {
        if (!res.confirm) return
        const content = (res.content || '').trim()
        if (!content) return
        const parts = content.split(',').map(s => s.trim())
        const linkedPhone = parts[0]
        const note = parts[1] || ''
        if (!/^1[3-9]\d{9}$/.test(linkedPhone)) {
          wx.showToast({ title: '手机号格式不正确', icon: 'none' })
          return
        }
        try {
          const r = await bindingAPI.updateBinding(item.binding.id, { linkedPhone, note })
          if (r.code === 0) {
            await this._fetchBinding()
            wx.showToast({ title: '已保存', icon: 'success' })
          } else {
            wx.showToast({ title: r.msg || '保存失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: e.message || '保存失败', icon: 'none' })
        }
      }
    })
  },

  removeBinding(item) {
    wx.showModal({
      title: '解除关联',
      content: `确认解除与 ${item.linkedUser?.name || '该账号'} 的关联？`,
      confirmText: '确认解除',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await bindingAPI.deleteBinding(item.binding.id)
          if (r.code === 0) {
            wx.showToast({ title: '已解除关联', icon: 'success' })
            await this._fetchBinding()
          } else {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: '网络错误', icon: 'none' })
        }
      }
    })
  },

  copyPhone(e) {
    const target = e?.currentTarget?.dataset?.target || 'linked'
    const phone = target === 'self'
      ? this.data.userInfo?.phone
      : (e?.currentTarget?.dataset?.phone || this.data.userInfo?.phone)
    if (!phone) return
    wx.setClipboardData({ data: phone })
  }
})
