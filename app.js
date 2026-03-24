// app.js
App({
  globalData: {
    // 当前登录用户信息
    userInfo: null,
    // 当前角色：'elderly'（老人端）或 'family'（家属端）
    role: 'family',
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
    serverUrl: 'http://localhost:3000'
  },

  onLaunch() {
    // 初始化云开发（接入后取消注释）
    // wx.cloud.init({ env: 'your-env-id' })

    // 从本地存储恢复登录态
    const token    = wx.getStorageSync('token')
    const userInfo = wx.getStorageSync('userInfo')
    const role     = wx.getStorageSync('role')

    if (token && userInfo) {
      this.globalData.token    = token
      this.globalData.userInfo = userInfo
      this.globalData.role     = role || userInfo.role || 'family'
      this._loadContacts()
    }
    // 未登录时不做跳转，由首页 onLoad 检测后跳转 login
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
    wx.request({
      url: this.globalData.serverUrl + '/api/settings/contacts',
      method: 'GET',
      success: (res) => {
        if (res.data?.code === 0) {
          this.globalData.contacts = res.data.data
        }
      },
      fail: () => {}
    })
  }
})
