// pages/login/login.js
const app = getApp()

const PHONE_HISTORY_KEY = 'loginPhoneHistory'
const MAX_PHONE_HISTORY = 20

function readPhoneHistory() {
  try {
    const list = wx.getStorageSync(PHONE_HISTORY_KEY)
    if (Array.isArray(list)) {
      return list.filter((x) => x && x.phone && String(x.phone).length >= 11)
    }
  } catch (e) { /* ignore */ }
  return []
}

function upsertPhoneHistory(phone, nickname) {
  const p = String(phone || '').trim()
  if (!/^1[3-9]\d{9}$/.test(p)) return
  const nick = (nickname != null && String(nickname).trim()) || ''
  let list = readPhoneHistory().filter((x) => x.phone !== p)
  list.unshift({ phone: p, nickname: nick })
  if (list.length > MAX_PHONE_HISTORY) list = list.slice(0, MAX_PHONE_HISTORY)
  try {
    wx.setStorageSync(PHONE_HISTORY_KEY, list)
  } catch (e) { /* ignore */ }
}

function removePhoneFromHistory(phone) {
  const p = String(phone || '').trim()
  if (!p) return
  const list = readPhoneHistory().filter((x) => x.phone !== p)
  try {
    wx.setStorageSync(PHONE_HISTORY_KEY, list)
  } catch (e) { /* ignore */ }
}

Page({
  data: {
    mode: 'login',
    form: {
      name: '',
      phone: '',
      password: '',
      role: 'family'
    },
    loading: false,
    errorMsg: '',
    savedPhones: [],
    showPhoneDropdown: false
  },

  onLoad() {
    const token = wx.getStorageSync('token')
    if (token) {
      this._goHome()
      return
    }
    this._loadSavedPhones()
  },

  onShow() {
    if (wx.getStorageSync('token')) return
    this._loadSavedPhones()
  },

  _loadSavedPhones() {
    this.setData({ savedPhones: readPhoneHistory() })
  },

  setMode(e) {
    const m = e.currentTarget.dataset.m
    this.setData({
      mode: m,
      errorMsg: '',
      showPhoneDropdown: false,
      'form.name': '',
      'form.phone': '',
      'form.password': ''
    })
  },

  togglePhoneDropdown() {
    if (!this.data.savedPhones.length) return
    this.setData({ showPhoneDropdown: !this.data.showPhoneDropdown })
  },

  closePhoneDropdown() {
    this.setData({ showPhoneDropdown: false })
  },

  noop() {},

  onPickSavedPhone(e) {
    const phone = e.currentTarget.dataset.phone
    if (!phone) return
    this.setData({
      'form.phone': phone,
      'form.password': '',
      errorMsg: '',
      showPhoneDropdown: false
    })
  },

  onRemoveSavedPhone(e) {
    const phone = e.currentTarget.dataset.phone
    if (!phone) return
    removePhoneFromHistory(phone)
    const list = readPhoneHistory()
    const patch = { savedPhones: list }
    if (this.data.form.phone === phone) {
      patch['form.phone'] = ''
    }
    if (!list.length) {
      patch.showPhoneDropdown = false
    }
    this.setData(patch)
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key
    const value = e.detail.value
    const updateData = {}
    updateData[`form.${key}`] = value
    updateData.errorMsg = ''
    this.setData(updateData)
  },

  selectRole(e) {
    this.setData({ 'form.role': e.currentTarget.dataset.role, errorMsg: '' })
  },

  async submit() {
    if (this.data.loading) return
    const { mode, form } = this.data

    if (mode === 'register') {
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
          action: mode,
          name: form.name.replace(/\s+/g, ''),
          phone: form.phone.trim(),
          password: form.password,
          role: form.role
        }
      })

      if (result.code === 0) {
        const { token, user } = result.data
        wx.setStorageSync('token', token)
        wx.setStorageSync('userInfo', user)
        wx.setStorageSync('role', user.role)

        app.globalData.userInfo = user
        app.globalData.role = user.role
        app.globalData.elderlyInfo =
          user.role === 'elderly'
            ? {
                name: user.name,
                elderlyId: user.elderlyId,
                age: user.age || '',
                avatar: user.avatar || ''
              }
            : app.globalData.elderlyInfo

        const ph = user.phone || form.phone.trim()
        upsertPhoneHistory(ph, user.name || '')

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
  },

  sendCode() {
    const { phone } = this.data.form
    if (!phone || !/^1[3-9]\d{9}$/.test(phone.trim())) {
      wx.showToast({ title: '请填写正确手机号', icon: 'none' })
      return
    }
    wx.showToast({ title: '验证码已发送', icon: 'success' })
  },

  wechatLogin() {
    wx.showToast({ title: '微信登录开发中', icon: 'none' })
  }
})
