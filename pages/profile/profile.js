// pages/profile/profile.js
const app = getApp()
const { statsAPI, alertsAPI, settingsAPI, bindingAPI } = require('../../utils/api')

Page({
  data: {
    role: 'family',
    userInfo: {},
    elderlyInfo: {},
    currentLocation: {},
    locationStatus: 'safe',
    contacts: [],
    binding: null,
    stats: { unreadAlerts: 0, totalAlerts: 0, chatCount: 0 }
  },

  onLoad() {
    if (!app.checkLogin()) return
    this._loadLocal()
    this._fetchData()
  },

  onShow() {
    if (!app.checkLogin()) return
    this._loadLocal()
    this._fetchData()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  _loadLocal() {
    const loc = app.globalData.currentLocation || {}
    this.setData({
      role:            app.globalData.role        || 'family',
      userInfo:        app.globalData.userInfo    || {},
      elderlyInfo:     app.globalData.elderlyInfo || {},
      currentLocation: loc,
      locationStatus:  loc.status || 'safe',
      contacts:        app.globalData.contacts   || []
    })
  },

  async _fetchData() {
    const role = app.globalData.role
    try {
      // 所有角色都加载绑定状态
      const bindingRes = await bindingAPI.getBinding()
      if (bindingRes.code === 0 && bindingRes.data) {
        this.setData({ binding: bindingRes.data })
        if (role === 'family') {
          app.globalData.elderlyInfo = bindingRes.data.linkedUser
        }
      } else {
        this.setData({ binding: null })
      }

      if (role === 'family') {
        const [statsRes, alertsRes] = await Promise.all([
          statsAPI.getStats(),
          alertsAPI.getAlerts()
        ])
        if (statsRes.code === 0) {
          const d = statsRes.data
          app.globalData.currentLocation = d.location
          this.setData({
            currentLocation: d.location,
            locationStatus:  d.location.status || 'safe',
            'stats.unreadAlerts': d.unreadAlerts,
            'stats.chatCount':    d.chatCount
          })
        }
        if (alertsRes.code === 0) {
          this.setData({ 'stats.totalAlerts': alertsRes.data.length })
        }
      } else {
        const res = await settingsAPI.getContacts()
        if (res.code === 0) {
          app.globalData.contacts = res.data
          this.setData({ contacts: res.data })
        }
      }
    } catch (e) {}
  },

  // 老人端一键拨打
  callContact(e) {
    const { phone, name } = e.currentTarget.dataset
    wx.showModal({
      title: `拨打 ${name}`,
      content: `确认拨打 ${phone}？`,
      confirmText: '立即拨打',
      confirmColor: '#5dd97f',
      success(res) {
        if (res.confirm && phone) wx.makePhoneCall({ phoneNumber: phone })
      }
    })
  },

  goBinding()  { wx.navigateTo({ url: '/pages/binding/binding' }) },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }) },
  goAlert()    { wx.switchTab({ url: '/pages/alert/alert' }) },
  goMemory()   { wx.navigateTo({ url: '/pages/memory/memory' }) },
  goLocation() { wx.switchTab({ url: '/pages/location/location' }) },
  goChat()     { wx.switchTab({ url: '/pages/aichat/aichat' }) },
  goDialect()  { wx.switchTab({ url: '/pages/dialect/dialect' }) },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (res.confirm) app.logout()
      }
    })
  }
})
