// app.js
App({
  globalData: {
    // 当前角色：'elderly'（老人端）或 'family'（家属端）
    role: 'family',
    // 老人信息
    elderlyInfo: {
      name: '王建明',
      age: 78,
      avatar: '/images/tab-sos.png'
    },
    // 家庭组信息
    familyGroup: {
      name: '王家',
      members: 4
    },
    // 实时位置（示例）
    currentLocation: {
      latitude: 30.572815,
      longitude: 104.066803,
      address: '成都市锦江区东御街18号',
      status: 'safe',           // safe / warning / emergency
      updatedAt: ''
    },
    // 未读预警数量
    unreadAlerts: 2
  },

  onLaunch() {
    // 初始化云开发
    // wx.cloud.init({ env: 'your-env-id' })

    // 获取本地存储的角色设置
    const role = wx.getStorageSync('role')
    if (role) this.globalData.role = role

    console.log('守护·陪伴 启动')
  },

  // 切换角色
  switchRole(role) {
    this.globalData.role = role
    wx.setStorageSync('role', role)
  }
})
