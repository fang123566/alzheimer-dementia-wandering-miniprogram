// pages/index/index.js
const app = getApp()

Page({
  data: {
    role: 'family',
    greeting: '',
    elderlyInfo: {},
    currentLocation: {},
    statusTag: 'tag-safe',
    statusText: '安全范围内',
    stats: {
      distance: 120,
      battery: 85,
      alerts: 2,
      aiChats: 6
    },
    recentAlerts: [
      { id: 1, level: 'warning', title: '离家超过500米', time: '今天 14:32' },
      { id: 2, level: 'danger',  title: '检测到疑似诈骗对话', time: '今天 11:07' }
    ]
  },

  onLoad() {
    this.setData({
      role: app.globalData.role,
      elderlyInfo: app.globalData.elderlyInfo,
      currentLocation: app.globalData.currentLocation,
      greeting: this._getGreeting()
    })
    this._updateStatusTag()
  },

  onShow() {
    // 每次显示时刷新角色和位置
    this.setData({ role: app.globalData.role })
  },

  _getGreeting() {
    const h = new Date().getHours()
    if (h < 6)  return '凌晨好'
    if (h < 12) return '早上好'
    if (h < 18) return '下午好'
    return '晚上好'
  },

  _updateStatusTag() {
    const status = app.globalData.currentLocation.status
    const map = {
      safe:      { tag: 'tag-safe',    text: '安全范围内' },
      warning:   { tag: 'tag-warning', text: '轻微预警'  },
      emergency: { tag: 'tag-danger',  text: '紧急！'    }
    }
    const s = map[status] || map['safe']
    this.setData({ statusTag: s.tag, statusText: s.text })
  },

  switchRole(e) {
    const role = e.currentTarget.dataset.role
    app.switchRole(role)
    this.setData({ role })
  },

  goLocation()  { wx.switchTab({ url: '/pages/location/location' }) },
  goAlert()     { wx.switchTab({ url: '/pages/alert/alert' }) },
  goMemory()    { wx.switchTab({ url: '/pages/memory/memory' }) },
  goSettings()  { wx.navigateTo({ url: '/pages/settings/settings' }) },

  callEmergency() {
    wx.showModal({
      title: '紧急呼叫',
      content: '确认立即拨打紧急联系人 王建国？',
      confirmText: '立即呼叫',
      confirmColor: '#ff5c5c',
      success(res) {
        if (res.confirm) wx.makePhoneCall({ phoneNumber: '138xxxxxxxx' })
      }
    })
  },

  triggerSOS() {
    wx.showToast({ title: 'SOS 已发送给家人！', icon: 'success' })
    // TODO: 上报位置 + 推送通知给家属
  }
})
