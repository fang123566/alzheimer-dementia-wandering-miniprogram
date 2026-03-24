// pages/index/index.js
const app = getApp()
const { locationAPI, alertsAPI, statsAPI, sosAPI } = require('../../utils/api')

Page({
  data: {
    role: 'family',
    userInfo: {},
    greeting: '',
    currentDate: '',
    elderlyInfo: {},
    currentLocation: {},
    statusTag: 'tag-safe',
    statusText: '安全范围内',
    stats: {
      distance: 0,
      battery: 0,
      alerts: 0,
      aiChats: 0
    },
    recentAlerts: []
  },

  onLoad() {
    if (!app.checkLogin()) return
    this.setData({
      role:        app.globalData.role,
      userInfo:    app.globalData.userInfo || {},
      elderlyInfo: app.globalData.elderlyInfo,
      greeting:    this._getGreeting(),
      currentDate: this._getDate()
    })
    this._fetchData()
  },

  onShow() {
    if (!app.checkLogin()) return
    this.setData({
      role:        app.globalData.role,
      userInfo:    app.globalData.userInfo || {},
      currentDate: this._getDate()
    })
    this._fetchData()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  async _fetchData() {
    try {
      const [statsRes, alertsRes] = await Promise.all([
        statsAPI.getStats(),
        alertsAPI.getAlerts()
      ])
      if (statsRes.code === 0) {
        const d = statsRes.data
        const loc = d.location
        app.globalData.currentLocation = loc
        app.globalData.unreadAlerts = d.unreadAlerts
        this.setData({
          currentLocation: loc,
          'stats.distance': d.distance,
          'stats.battery':  d.battery,
          'stats.alerts':   d.unreadAlerts,
          'stats.aiChats':  d.chatCount
        })
        this._updateStatusTag(loc.status)
      }
      if (alertsRes.code === 0) {
        const recent = alertsRes.data.slice(0, 3).map(a => ({
          id: a.id,
          level: a.level,
          title: a.type + '：' + a.content.slice(0, 18) + '…',
          time: a.timeLabel
        }))
        this.setData({ recentAlerts: recent })
      }
    } catch (e) {
      // 网络失败时使用 globalData 缓存数据
      this.setData({ currentLocation: app.globalData.currentLocation })
      this._updateStatusTag(app.globalData.currentLocation.status)
    }
  },

  _getGreeting() {
    const h = new Date().getHours()
    if (h < 6)  return '凌晨好'
    if (h < 12) return '早上好'
    if (h < 18) return '下午好'
    return '晚上好'
  },

  _getDate() {
    const d = new Date()
    const weeks = ['日', '一', '二', '三', '四', '五', '六']
    return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日  星期${weeks[d.getDay()]}`
  },

  _updateStatusTag(status = 'safe') {
    const map = {
      safe:      { tag: 'tag-safe',    text: '安全范围内' },
      warning:   { tag: 'tag-warning', text: '轻微预警'  },
      emergency: { tag: 'tag-danger',  text: '紧急！'    }
    }
    const s = map[status] || map['safe']
    this.setData({ statusTag: s.tag, statusText: s.text })
  },

  goLocation()  { wx.switchTab({ url: '/pages/location/location' }) },
  goAlert()     { wx.switchTab({ url: '/pages/alert/alert' }) },
  goMemory()    { wx.navigateTo({ url: '/pages/memory/memory' }) },
  goSettings()  { wx.navigateTo({ url: '/pages/settings/settings' }) },
  goChat()      { wx.switchTab({ url: '/pages/aichat/aichat' }) },
  goDialect()   { wx.switchTab({ url: '/pages/dialect/dialect' }) },

  // 老人端单次点击 SOS 提示（长按才真正触发）
  triggerSOSTap() {
    wx.showToast({ title: '长按 3 秒发送位置', icon: 'none', duration: 2000 })
  },

  callEmergency() {
    const contact = app.globalData.contacts?.[0]
    const name  = contact?.name  || '紧急联系人'
    const phone = contact?.phone || ''
    wx.showModal({
      title: '紧急呼叫',
      content: `确认立即拨打 ${name}？`,
      confirmText: '立即呼叫',
      confirmColor: '#ff5c5c',
      success(res) {
        if (res.confirm && phone) wx.makePhoneCall({ phoneNumber: phone })
      }
    })
  },

  async triggerSOS() {
    wx.showLoading({ title: 'SOS 发送中…', mask: true })
    try {
      wx.getLocation({
        type: 'wgs84',
        success: async (loc) => {
          await sosAPI.trigger({
            latitude: loc.latitude,
            longitude: loc.longitude,
            address: app.globalData.currentLocation.address
          })
          wx.hideLoading()
          wx.showToast({ title: 'SOS 已发送给家人！', icon: 'success' })
          this._updateStatusTag('emergency')
        },
        fail: async () => {
          await sosAPI.trigger({})
          wx.hideLoading()
          wx.showToast({ title: 'SOS 已发送给家人！', icon: 'success' })
        }
      })
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: 'SOS 发送失败，请重试', icon: 'none' })
    }
  }
})
