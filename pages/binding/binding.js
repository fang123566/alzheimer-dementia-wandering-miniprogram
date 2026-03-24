// pages/binding/binding.js
const app = getApp()
const { bindingAPI } = require('../../utils/api')

Page({
  data: {
    role: 'family',
    userInfo: {},
    binding: null,
    linkedUser: null,
    elderlyPhone: '',
    errMsg: '',
    binding_loading: false
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

  async _fetchBinding() {
    try {
      const res = await bindingAPI.getBinding()
      if (res.code === 0 && res.data) {
        const { binding, linkedUser } = res.data
        // 格式化绑定时间
        const createdAt = binding.createdAt
          ? new Date(binding.createdAt).toLocaleDateString('zh-CN')
          : ''
        this.setData({
          binding: { ...binding, createdAt },
          linkedUser
        })
        // 同步 globalData：家属端更新 elderlyInfo
        if (app.globalData.role === 'family') {
          app.globalData.elderlyInfo = linkedUser
        }
      } else {
        this.setData({ binding: null, linkedUser: null })
      }
    } catch (e) {}
  },

  onPhoneInput(e) {
    this.setData({ elderlyPhone: e.detail.value, errMsg: '' })
  },

  async doBinding() {
    const phone = this.data.elderlyPhone.trim()
    if (!phone) return this.setData({ errMsg: '请输入老人的手机号' })
    if (!/^1[3-9]\d{9}$/.test(phone)) return this.setData({ errMsg: '手机号格式不正确' })
    if (this.data.binding_loading) return

    this.setData({ binding_loading: true, errMsg: '' })
    try {
      const res = await bindingAPI.createBinding(phone)
      if (res.code === 0) {
        wx.showToast({ title: '关联成功！', icon: 'success' })
        const { binding, linkedUser } = res.data
        const createdAt = binding.createdAt
          ? new Date(binding.createdAt).toLocaleDateString('zh-CN')
          : ''
        this.setData({
          binding: { ...binding, createdAt },
          linkedUser,
          elderlyPhone: ''
        })
        app.globalData.elderlyInfo = linkedUser
      } else {
        this.setData({ errMsg: res.msg || '关联失败' })
      }
    } catch (e) {
      this.setData({ errMsg: e.message || '网络错误，请重试' })
    } finally {
      this.setData({ binding_loading: false })
    }
  },

  unbind() {
    wx.showModal({
      title: '解除关联',
      content: '解除后将无法查看老人的位置和预警信息，确认解除？',
      confirmText: '确认解除',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await bindingAPI.deleteBinding()
          if (r.code === 0) {
            wx.showToast({ title: '已解除关联', icon: 'success' })
            this.setData({ binding: null, linkedUser: null })
            app.globalData.elderlyInfo = {}
          } else {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: '网络错误', icon: 'none' })
        }
      }
    })
  }
})
