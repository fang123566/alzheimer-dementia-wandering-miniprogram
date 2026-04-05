// pages/index/index.js
const app = getApp()
const { locationAPI, alertsAPI, statsAPI, sosAPI, settingsAPI } = require('../../utils/api')
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
    statusIcon: '✅',
    statusLevel: 'safe',
    addressExpanded: false,
    freshnessText: '',
    freshnessStale: false,
    fenceEnabled: true,
    stats: {
      distance: 0,
      alerts: 0,
      aiChats: 0
    },
    distanceIcon: '🏠',
    distanceText: '在家中',
    alertsIcon: '🛡️',
    alertsText: '无预警',
    alertsHot: false,
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
    this._startFreshnessTimer()
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
        this._formatDistance(d.distance)
        this._formatAlerts(d.unreadAlerts)
        this._updateStatusTag(loc.status)
        this._updateFreshness()
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

  // ── 智能距离显示 ──────────────────────────────────
  _formatDistance(meters) {
    const m = Number(meters) || 0
    if (m === 0) {
      this.setData({ distanceIcon: '🏠', distanceText: '在家中' })
    } else if (m < 1000) {
      this.setData({ distanceIcon: '🚶', distanceText: '距离家 ' + m + ' m' })
    } else {
      const km = (m / 1000).toFixed(1)
      this.setData({ distanceIcon: '🚗', distanceText: '距离家 ' + km + ' km' })
    }
  },

  // ── 预警状态显示 ──────────────────────────────────
  _formatAlerts(count) {
    const n = Number(count) || 0
    if (n === 0) {
      this.setData({ alertsIcon: '🛡️', alertsText: '无预警', alertsHot: false })
    } else {
      this.setData({ alertsIcon: '🔔', alertsText: n + ' 次预警', alertsHot: true })
    }
  },

  _updateStatusTag(status = 'safe') {
    const map = {
      safe:      { tag: 'tag-safe',    text: '安全范围内',    icon: '✅', level: 'safe' },
      warning:   { tag: 'tag-warning', text: '超出安全范围',  icon: '⚠️', level: 'warning' },
      emergency: { tag: 'tag-danger',  text: '定位异常',      icon: '🔴', level: 'danger' }
    }
    const s = map[status] || map['safe']
    this.setData({ statusTag: s.tag, statusText: s.text, statusIcon: s.icon, statusLevel: s.level })
  },

  // ── 时效性计算 ──────────────────────────────────
  _startFreshnessTimer() {
    this._stopFreshnessTimer()
    this._updateFreshness()
    this._freshnessTimer = setInterval(() => this._updateFreshness(), 15000)
  },
  _stopFreshnessTimer() {
    if (this._freshnessTimer) { clearInterval(this._freshnessTimer); this._freshnessTimer = null }
  },
  _updateFreshness() {
    const loc = this.data.currentLocation
    if (!loc || !loc.updatedAt) {
      this.setData({ freshnessText: '暂无更新', freshnessStale: true })
      return
    }
    const updatedTime = typeof loc.updatedAt === 'number' ? loc.updatedAt : new Date(loc.updatedAt).getTime()
    if (isNaN(updatedTime)) {
      this.setData({ freshnessText: loc.updatedAt, freshnessStale: false })
      return
    }
    const diffMs = Date.now() - updatedTime
    const diffMin = Math.floor(diffMs / 60000)
    let text, stale = false
    if (diffMin < 1) {
      text = '刚刚更新（正常）'
    } else if (diffMin < 10) {
      text = '更新于 ' + diffMin + ' 分钟前（正常）'
    } else if (diffMin < 60) {
      text = '更新于 ' + diffMin + ' 分钟前（异常）'
      stale = true
    } else {
      const diffH = Math.floor(diffMin / 60)
      text = '更新于 ' + diffH + ' 小时前（异常）'
      stale = true
    }
    this.setData({ freshnessText: text, freshnessStale: stale })
    // 超过 10 分钟自动标为定位异常
    if (stale && this.data.statusLevel === 'safe') {
      this._updateStatusTag('emergency')
    }
  },

  // ── 地址展开/收起 ──────────────────────────────────
  toggleAddressExpand() {
    this.setData({ addressExpanded: !this.data.addressExpanded })
  },

  // ── 围栏快捷开关 ──────────────────────────────────
  async toggleFence() {
    const next = !this.data.fenceEnabled
    this.setData({ fenceEnabled: next })
    wx.showToast({ title: next ? '围栏预警已开启' : '围栏预警已关闭', icon: 'none' })
    // 持久化到设置（如有可用接口）
    try { await settingsAPI.updateSettings({ fenceEnabled: next }) } catch (e) {}
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
    wx.showActionSheet({
      itemList: ['一键拨号 · ' + name, '发送紧急消息'],
      success: (res) => {
        if (res.tapIndex === 0) {
          wx.showModal({
            title: '确认紧急呼叫',
            content: '确定向 ' + name + ' 发起紧急呼叫？',
            confirmText: '立即呼叫',
            confirmColor: '#dc2626',
            success(r) {
              if (r.confirm && phone) wx.makePhoneCall({ phoneNumber: phone })
            }
          })
        } else if (res.tapIndex === 1) {
          wx.showModal({
            title: '发送紧急消息',
            content: '确定向 ' + name + ' 发送紧急求助消息？',
            confirmText: '立即发送',
            confirmColor: '#dc2626',
            success: async (r) => {
              if (!r.confirm) return
              try {
                wx.showLoading({ title: '发送中…', mask: true })
                await sosAPI.trigger({
                  type: 'message',
                  address: app.globalData.currentLocation?.address || ''
                })
                wx.hideLoading()
                wx.showToast({ title: '紧急消息已发送', icon: 'success' })
              } catch (e) {
                wx.hideLoading()
                wx.showToast({ title: '发送失败，请重试', icon: 'none' })
              }
            }
          })
        }
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
