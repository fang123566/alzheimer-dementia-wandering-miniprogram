// app.js
const bleManager = require('./utils/ble')

App({
  globalData: {
    // 当前登录用户信息
    userInfo: null,
    // 当前角色：'elderly'（老人端）或 'family'（家属端）
    role: 'family',
    // 老人模式（大字号+语音播报）
    elderlyMode: wx.getStorageSync('elderlyMode') || false,
    // 老人信息（家属端查看的目标老人）
    elderlyInfo: {
      name: '王建明',
      age: 78,
      avatar: ''
    },
    // 家庭组信息
    familyGroup: {
      name: '王家',
      members: 4
    },
    // 实时位置（由首页 _fetchData 更新）
    currentLocation: {
      latitude: 30.572815,
      longitude: 104.066803,
      address: '成都市锦江区东御街18号',
      status: 'safe',
      updatedAt: ''
    },
    // 紧急联系人缓存
    contacts: [],
    // 未读预警数量
    unreadAlerts: 0,
    // 后端服务地址（开发用 localhost，上线替换）
    serverUrl: 'http://localhost:3000',
    // BLE 硬件通知接口（BLE 连接成功后由 bleManager 自动注册）
    // 结构：{ sendText(text), sendTts(text) }
    bleNotify: null
  },

  onLaunch() {
    // 初始化云开发
    wx.cloud.init({ env: 'cloud1-3gzx0vun034c33f9' })

    // 挂载全局 BLE 管理器（单例，生命周期跟随 App）
    this.ble = bleManager

    // 从本地存储恢复登录态
    const token    = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    const role     = wx.getStorageSync('role')

    if (token && userInfo) {
      this.globalData.token    = token
      this.globalData.userInfo = userInfo
      this.globalData.role     = role || userInfo.role || 'family'
      this._loadContacts()
      // 老人端启动后自动开启位置上报
      if (this.globalData.role === 'elderly') {
        this._startElderlyLocationReporting()
      }
    }
  },

  // 切换老人模式
  toggleElderlyMode() {
    const newMode = !this.globalData.elderlyMode
    this.globalData.elderlyMode = newMode
    wx.setStorageSync('elderlyMode', newMode)
    return newMode
  },

  // 检查是否已登录，供各页面 onLoad 调用
  checkLogin() {
    const token = wx.getStorageSync('token')
    if (!token) {
      wx.reLaunch({ url: '/pages/login/login' })
      return false
    }
    return true
  },

  // 退出登录
  logout() {
    this._stopElderlyLocationReporting()
    try {
      wx.removeStorageSync('token')
      wx.removeStorageSync('userInfo')
      wx.removeStorageSync('role')
    } catch (e) {}
    this.globalData.token       = null
    this.globalData.userInfo    = null
    this.globalData.role        = 'family'
    this.globalData.contacts    = []
    this.globalData.unreadAlerts = 0
    this.globalData.currentLocation = {}
    wx.reLaunch({ url: '/pages/login/login' })
  },

  _loadContacts() {
    wx.cloud.callFunction({
      name: 'settings',
      data: { action: 'getContacts' },
      success: (res) => {
        const r = res.result
        if (r?.code === 0) this.globalData.contacts = r.data || []
      },
      fail: () => {}
    })
  },

  // ── 老人端全局位置上报 ──────────────────────────
  _startElderlyLocationReporting() {
    if (this._elderlyReporting) return
    const self = this
    this._lastReportTime = 0

    wx.startLocationUpdate({
      success() {
        console.log('[App] 老人端全局位置上报已启动')
        self._elderlyReporting = true
        wx.onLocationChange(function (res) {
          const now = Date.now()
          if (now - self._lastReportTime < 15000) return
          self._lastReportTime = now
          self._reportLocation(res.latitude, res.longitude)
        })
      },
      fail(err) {
        console.warn('[App] 开启位置监听失败，使用降级轮询:', err)
        self._elderlyReporting = true
        self._elderlyReportTimer = setInterval(() => {
          wx.getLocation({
            type: 'gcj02',
            success(res) {
              self._reportLocation(res.latitude, res.longitude)
            },
            fail() {}
          })
        }, 30000)
        // 立即获取一次
        wx.getLocation({
          type: 'gcj02',
          success(res) {
            self._reportLocation(res.latitude, res.longitude)
          },
          fail() {}
        })
      }
    })
  },

  _stopElderlyLocationReporting() {
    if (this._elderlyReportTimer) {
      clearInterval(this._elderlyReportTimer)
      this._elderlyReportTimer = null
    }
    if (this._elderlyReporting) {
      wx.stopLocationUpdate({ fail() {} })
      wx.offLocationChange()
      this._elderlyReporting = false
    }
  },

  _reportLocation(latitude, longitude) {
    wx.cloud.callFunction({
      name: 'locationUpdate',
      data: { latitude, longitude, address: '', distance: 0 },
      success(res) {
        const result = res.result
        if (result && result.code === 0 && result.data) {
          getApp().globalData.currentLocation = {
            latitude, longitude,
            address: result.data.address || '',
            status: result.data.status || 'safe',
            updatedAt: new Date().toISOString()
          }
        }
      },
      fail(err) {
        console.warn('[App] 位置上报失败:', err)
      }
    })
  }
})
