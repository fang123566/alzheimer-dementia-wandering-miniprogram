// pages/index/index.js
const app = getApp()
const { locationAPI, alertsAPI, statsAPI, sosAPI } = require('../../utils/api')
const amap = require('../../utils/amap')

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
      alerts: 0,
      aiChats: 0
    },
    recentAlerts: [],
    locating: false
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
  },

  // 老人端重新定位 - 使用高德API解析地址并上报
  async refreshLocation() {
    if (this.data.locating) return
    this.setData({ locating: true })

    try {
      const hasPermission = await this._ensureLocationPermission()
      if (!hasPermission) {
        this.setData({ locating: false })
        return
      }

      console.log('[定位] 开始获取位置...')
      const res = await this._getWxLocation('gcj02')
      console.log('[定位] wx.getLocation 成功:', res)

      let address = '当前位置'
      try {
        console.log('[定位] 调用高德逆地理编码...')
        const addrDetail = await amap.regeoDetail(res.latitude, res.longitude)
        console.log('[定位] 高德解析结果:', addrDetail)
        if (addrDetail.formatted) address = addrDetail.formatted
      } catch (e) {
        console.error('[定位] 高德解析失败:', e)
      }

      console.log('[定位] 上报位置到后端...', { latitude: res.latitude, longitude: res.longitude, address })
      const updateRes = await locationAPI.updateLocation({
        latitude: res.latitude,
        longitude: res.longitude,
        address: address,
        distance: this.data.stats.distance
      })
      console.log('[定位] 后端响应:', updateRes)

      if (updateRes.code === 0) {
        const loc = updateRes.data
        app.globalData.currentLocation = loc
        this.setData({
          currentLocation: loc,
          'stats.distance': loc.distance || 0
        })
        this._updateStatusTag(loc.status)
        wx.showToast({ title: '位置已更新', icon: 'success' })
      } else {
        console.error('[定位] 后端返回错误:', updateRes)
        wx.showToast({ title: '上报失败: ' + (updateRes.msg || '未知错误'), icon: 'none' })
      }
    } catch (e) {
      console.error('[定位] 整体流程失败:', e)
      wx.showToast({ title: '定位失败: ' + (e.message || '请检查权限'), icon: 'none' })
    } finally {
      this.setData({ locating: false })
    }
  },

  _getWxLocation(type = 'gcj02') {
    return new Promise((resolve, reject) => {
      wx.getLocation({ type, success: resolve, fail: reject })
    })
  },

  async _ensureLocationPermission() {
    try {
      const settingRes = await new Promise((resolve, reject) => {
        wx.getSetting({ success: resolve, fail: reject })
      })
      const auth = settingRes.authSetting['scope.userLocation']

      if (auth === true) return true

      if (auth === undefined) {
        try {
          await new Promise((resolve, reject) => {
            wx.authorize({ scope: 'scope.userLocation', success: resolve, fail: reject })
          })
          return true
        } catch (e) {
          wx.showModal({
            title: '需要位置权限',
            content: '定位功能需要获取位置信息，请允许定位授权后重试。',
            showCancel: false
          })
          return false
        }
      }

      return await new Promise((resolve) => {
        wx.showModal({
          title: '定位权限未开启',
          content: '请在设置中开启位置权限，才能使用重新定位。',
          confirmText: '去设置',
          cancelText: '取消',
          success: async (res) => {
            if (!res.confirm) return resolve(false)
            try {
              const openRes = await new Promise((resolve, reject) => {
                wx.openSetting({ success: resolve, fail: reject })
              })
              resolve(openRes.authSetting['scope.userLocation'] === true)
            } catch (e) {
              resolve(false)
            }
          }
        })
      })
    } catch (e) {
      wx.showToast({ title: '无法检查定位权限', icon: 'none' })
      return false
    }
  }
})
