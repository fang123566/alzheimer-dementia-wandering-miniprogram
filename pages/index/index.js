// pages/index/index.js
const app = getApp()
const { locationAPI, alertsAPI, sosAPI, settingsAPI } = require('../../utils/api')
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
    fenceName: '',
    stats: {
      distance: 0,
      alerts: 0,
      aiChats: 0
    },
    distanceIcon: '📍',
    distanceLabel: '安全范围',
    distanceText: '在范围内',
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

    if (this.data.role === 'elderly') {
      this._startAutoLocationTracking()
    }
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

    if (this.data.role === 'elderly') {
      this._startAutoLocationTracking()
    }

    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  onHide() {
    this._stopFreshnessTimer()
    if (this.data.role === 'elderly') {
      this._stopAutoLocationTracking()
    }
  },

  onUnload() {
    this._stopFreshnessTimer()
    if (this.data.role === 'elderly') {
      this._stopAutoLocationTracking()
    }
  },

  async _fetchData() {
    try {
      const [locRes, unreadRes, alertsRes] = await Promise.all([
        locationAPI.getLocation().catch(e => ({ code: -1, msg: e.message })),
        alertsAPI.getUnreadCount().catch(e => ({ code: -1, msg: e.message })),
        alertsAPI.getAlerts().catch(e => ({ code: -1, msg: e.message }))
      ])

      if (locRes.code === 0 && locRes.data) {
        const loc = locRes.data
        app.globalData.currentLocation = loc
        this.setData({
          currentLocation: loc,
          'stats.distance': loc.distance || 0,
          fenceName: loc.fenceName || ''
        })
        this._formatDistance(loc.distance || 0, loc.fenceName || '')
        this._updateStatusTag(loc.status)
        this._updateFreshness()
      }

      let unreadCount = 0
      if (unreadRes.code === 0) {
        unreadCount = unreadRes.data?.count || 0
      }
      app.globalData.unreadAlerts = unreadCount
      this.setData({
        'stats.alerts': unreadCount,
        alertsHot: unreadCount > 0
      })
      this._formatAlerts(unreadCount)

      this.setData({ 'stats.aiChats': 0 })

      if (alertsRes.code === 0 && alertsRes.data) {
        console.log('[首页] 获取到预警数据:', alertsRes.data.length, '条')
        const recent = (alertsRes.data || []).slice(0, 3).map(a => ({
          id: a.id,
          level: a.level,
          title: (a.type || '预警') + '：' + String(a.content || '').slice(0, 18) + (String(a.content || '').length > 18 ? '…' : ''),
          time: a.time || ''
        }))
        this.setData({ recentAlerts: recent })
        console.log('[首页] 最近预警:', recent)
      } else {
        console.warn('[首页] 预警数据加载失败:', alertsRes)
      }
    } catch (e) {
      console.error('[首页] 数据加载异常:', e)
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

  _formatDistance(meters, fenceName) {
    const m = Number(meters) || 0
    const name = fenceName || '安全范围'

    if (m === 0) {
      this.setData({
        distanceIcon: '✅',
        distanceLabel: name,
        distanceText: '在范围内'
      })
    } else if (m < 1000) {
      this.setData({
        distanceIcon: '📍',
        distanceLabel: '离' + name,
        distanceText: m + ' m'
      })
    } else {
      const km = (m / 1000).toFixed(1)
      this.setData({
        distanceIcon: '📍',
        distanceLabel: '离' + name,
        distanceText: km + ' km'
      })
    }
  },

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

  _startFreshnessTimer() {
    this._stopFreshnessTimer()
    this._updateFreshness()
    this._freshnessTimer = setInterval(() => this._updateFreshness(), 15000)
  },

  _stopFreshnessTimer() {
    if (this._freshnessTimer) {
      clearInterval(this._freshnessTimer)
      this._freshnessTimer = null
    }
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
    if (stale && this.data.statusLevel === 'safe') {
      this._updateStatusTag('emergency')
    }
  },

  toggleAddressExpand() {
    this.setData({ addressExpanded: !this.data.addressExpanded })
  },

  async toggleFence() {
    const next = !this.data.fenceEnabled
    this.setData({ fenceEnabled: next })
    wx.showToast({ title: next ? '围栏预警已开启' : '围栏预警已关闭', icon: 'none' })
    try {
      await settingsAPI.updateSettings({ fenceEnabled: next })
    } catch (e) {}
  },

  goLocation()  { wx.switchTab({ url: '/pages/location/location' }) },
  goAlert()     { wx.switchTab({ url: '/pages/alert/alert' }) },
  goMemory()    { wx.navigateTo({ url: '/pages/memory/memory' }) },
  goChat()      { wx.switchTab({ url: '/pages/aichat/aichat' }) },
  goDialect()   { wx.switchTab({ url: '/pages/dialect/dialect' }) },

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
          'stats.distance': loc.distance || 0,
          fenceName: loc.fenceName || ''
        })
        this._formatDistance(loc.distance || 0, loc.fenceName || '')
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
  },

  _startAutoLocationTracking() {
    this._stopAutoLocationTracking()

    const self = this
    let lastReportTime = 0

    wx.startLocationUpdate({
      success() {
        console.log('[自动定位] 实时位置监听已开启')
        self._autoTrackingEnabled = true

        wx.onLocationChange(function(res) {
          const now = Date.now()
          if (now - lastReportTime < 30000) return
          lastReportTime = now
          self._reportLocation(res.latitude, res.longitude)
        })
      },
      fail(err) {
        console.warn('[自动定位] 开启实时监听失败，降级为定时上报:', err)
        self._autoLocationTimer = setInterval(() => {
          self._getLocationAndReport()
        }, 30000)
        self._getLocationAndReport()
      }
    })
  },

  _stopAutoLocationTracking() {
    if (this._autoLocationTimer) {
      clearInterval(this._autoLocationTimer)
      this._autoLocationTimer = null
    }
    if (this._autoTrackingEnabled) {
      wx.stopLocationUpdate({
        success: () => console.log('[自动定位] 已停止位置监听'),
        fail: () => {}
      })
      wx.offLocationChange()
      this._autoTrackingEnabled = false
    }
  },

  async _getLocationAndReport() {
    try {
      const res = await this._getWxLocation('gcj02')
      await this._reportLocation(res.latitude, res.longitude)
    } catch (e) {
      console.warn('[自动定位] 获取位置失败:', e)
    }
  },

  async _reportLocation(latitude, longitude) {
    try {
      let address = '当前位置'
      try {
        const addrDetail = await amap.regeoDetail(latitude, longitude)
        if (addrDetail.formatted) address = addrDetail.formatted
      } catch (e) {
        console.warn('[自动定位] 地址解析失败:', e)
      }

      const updateRes = await locationAPI.updateLocation({
        latitude,
        longitude,
        address,
        distance: this.data.stats.distance
      })

      if (updateRes.code === 0) {
        const loc = updateRes.data
        app.globalData.currentLocation = loc
        this.setData({
          currentLocation: loc,
          'stats.distance': loc.distance || 0,
          fenceName: loc.fenceName || ''
        })
        this._formatDistance(loc.distance || 0, loc.fenceName || '')
        this._updateStatusTag(loc.status)
        console.log('[自动定位] 位置上报成功:', loc.status)

        if (loc.status === 'warning' || loc.status === 'emergency') {
          wx.showToast({
            title: loc.status === 'warning' ? '已离开安全区域' : '紧急：远离安全区域',
            icon: 'none',
            duration: 3000
          })
        }
      }
    } catch (e) {
      console.error('[自动定位] 上报失败:', e)
    }
  }
})
