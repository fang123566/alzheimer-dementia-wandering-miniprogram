// pages/login/login.js
const app = getApp()
const http = require('../../utils/request')

Page({
  data: {
    mode: 'login',   // 'login' | 'register'
    form: {
      name: '',
      phone: '',
      password: '',
      role: 'family' // 注册时默认家属端
    },
    loading: false,
    errorMsg: ''
  },

  onLoad() {
    // 已登录则直接跳首页
    const token = wx.getStorageSync('token')
    if (token) {
      this._goHome()
    }
  },

  setMode(e) {
    this.setData({
      mode: e.currentTarget.dataset.m,
      errorMsg: '',
      'form.name': '',
      'form.phone': '',
      'form.password': ''
    })
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: e.detail.value, errorMsg: '' })
  },

  selectRole(e) {
    this.setData({ 'form.role': e.currentTarget.dataset.role, errorMsg: '' })
  },

  async submit() {
    if (this.data.loading) return
    const { mode, form } = this.data

    // 前端校验
    if (mode === 'register' && !form.name.trim()) {
      return this.setData({ errorMsg: '请填写姓名' })
    }
    if (!form.phone.trim()) {
      return this.setData({ errorMsg: '请填写手机号' })
    }
    if (!form.password.trim()) {
      return this.setData({ errorMsg: '请填写密码' })
    }
    if (mode === 'register' && form.password.length < 6) {
      return this.setData({ errorMsg: '密码至少 6 位' })
    }

    this.setData({ loading: true, errorMsg: '' })

    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register'
      const body = mode === 'login'
        ? { phone: form.phone, password: form.password }
        : { name: form.name, phone: form.phone, password: form.password, role: form.role }

      const res = await http.post(path, body)

      if (res.code === 0) {
        const { token, user } = res.data

        // 持久化登录态
        wx.setStorageSync('token',    token)
        wx.setStorageSync('userInfo', user)
        wx.setStorageSync('role',     user.role)

        // 写入 globalData
        app.globalData.userInfo    = user
        app.globalData.role        = user.role
        app.globalData.elderlyInfo = user.role === 'elderly'
          ? { name: user.name, age: user.age || '', avatar: user.avatar || '' }
          : app.globalData.elderlyInfo

        wx.showToast({ title: mode === 'login' ? '登录成功' : '注册成功', icon: 'success' })

        setTimeout(() => this._goHome(), 800)
      } else {
        this.setData({ errorMsg: res.msg || '操作失败，请重试' })
      }
    } catch (e) {
      this.setData({ errorMsg: '网络连接失败，请检查服务器' })
    } finally {
      this.setData({ loading: false })
    }
  },

  _goHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
