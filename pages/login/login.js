// pages/login/login.js
const app = getApp()

Page({
  data: {
    mode: 'login',   // 'login' | 'register'
    form: {
      name: '',
      phone: '',
      password: '',
      role: 'family'
    },
    loading: false,
    errorMsg: ''
  },

  onLoad() {
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

  // 【修复】优化输入绑定逻辑，增加调试日志
  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    // 调试：打印输入的字段和值，方便排查
    console.log(`输入字段：${key}，输入值："${value}"`)
    
    // 确保数据更新路径正确
    const updateData = {}
    updateData[`form.${key}`] = value
    updateData.errorMsg = ''
    this.setData(updateData)
    
    // 调试：确认数据已更新
    console.log('更新后form.name：', this.data.form.name)
  },

  selectRole(e) {
    this.setData({ 'form.role': e.currentTarget.dataset.role, errorMsg: '' })
  },

  async submit() {
    if (this.data.loading) return
    const { mode, form } = this.data

    // 调试：打印提交时的完整数据
    console.log('提交模式：', mode)
    console.log('提交form数据：', form)
    console.log('姓名trim后："', form.name.trim(), '"')

    // 【修复】优化姓名校验逻辑（兼容全角空格/特殊空格）
    if (mode === 'register') {
      // 移除所有类型的空格（包括全角、半角）
      const pureName = form.name.replace(/\s+/g, '')
      if (!pureName) {
        return this.setData({ errorMsg: '请填写姓名（不可为空或仅含空格）' })
      }
    }
    if (!form.phone.trim()) {
      return this.setData({ errorMsg: '请填写手机号' })
    }
    if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) {
      return this.setData({ errorMsg: '请填写正确的手机号' })
    }
    if (!form.password.trim()) {
      return this.setData({ errorMsg: '请填写密码' })
    }
    if (mode === 'register' && form.password.length < 6) {
      return this.setData({ errorMsg: '密码至少 6 位' })
    }

    this.setData({ loading: true, errorMsg: '' })

    try {
      const { result } = await wx.cloud.callFunction({
        name: 'auth',
        data: {
          action:   mode,           
          name:     form.name.replace(/\s+/g, ''), // 确保姓名无空格
          phone:    form.phone.trim(),
          password: form.password,
          role:     form.role
        }
      })

      if (result.code === 0) {
        const { token, user } = result.data
        wx.setStorageSync('token',    token)
        wx.setStorageSync('userInfo', user)
        wx.setStorageSync('role',     user.role)

        app.globalData.userInfo = user
        app.globalData.role     = user.role
        app.globalData.elderlyInfo = user.role === 'elderly'
          ? {
              name:      user.name,
              elderlyId: user.elderlyId,
              age:       user.age    || '',
              avatar:    user.avatar || ''
            }
          : app.globalData.elderlyInfo

        wx.showToast({ title: mode === 'login' ? '登录成功' : '注册成功', icon: 'success' })
        setTimeout(() => this._goHome(), 800)

      } else {
        this.setData({ errorMsg: result.msg || '操作失败，请重试' })
      }

    } catch (err) {
      console.error('云函数调用失败：', err)
      this.setData({ errorMsg: '网络连接失败，请稍后重试' })
    } finally {
      this.setData({ loading: false })
    }
  },

  _goHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  }
})