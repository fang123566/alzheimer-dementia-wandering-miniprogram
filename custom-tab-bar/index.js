// custom-tab-bar/index.js
const FAMILY_LIST = [
  { text: '首页',  icon: '🏠', pagePath: '/pages/index/index',       badge: 0 },
  { text: '位置',  icon: '📍', pagePath: '/pages/location/location', badge: 0 },
  { text: '预警',  icon: '🔔', pagePath: '/pages/alert/alert',       badge: 0 },
  { text: '我的',  icon: '👤', pagePath: '/pages/profile/profile',   badge: 0 }
]

const ELDERLY_LIST = [
  { text: '首页',  icon: '🏠', pagePath: '/pages/index/index',    badge: 0 },
  { text: '伴聊',  icon: '🤖', pagePath: '/pages/aichat/aichat',  badge: 0 },
  { text: '方言',  icon: '🗣️', pagePath: '/pages/dialect/dialect', badge: 0 },
  { text: '我的',  icon: '👤', pagePath: '/pages/profile/profile', badge: 0 }
]

Component({
  data: {
    selected: 0,
    role: 'family',
    list: FAMILY_LIST
  },

  methods: {
    // 每个 tabBar 页面 onShow 时调用此方法刷新状态
    init() {
      const app = getApp()
      const role = app.globalData.role || 'family'
      const list = role === 'elderly'
        ? ELDERLY_LIST.map(i => ({ ...i }))
        : FAMILY_LIST.map(i => ({ ...i }))

      // 更新预警未读角标（仅家属端）
      if (role === 'family') {
        const alertIdx = list.findIndex(i => i.pagePath === '/pages/alert/alert')
        if (alertIdx >= 0) {
          list[alertIdx].badge = app.globalData.unreadAlerts || 0
        }
      }

      // 根据当前页面路径自动确定选中 index
      const pages = getCurrentPages()
      const currentRoute = '/' + (pages[pages.length - 1]?.route || '')
      const selected = list.findIndex(i => i.pagePath === currentRoute)

      this.setData({ role, list, selected: selected >= 0 ? selected : 0 })
    },

    switchTab(e) {
      const { path, index } = e.currentTarget.dataset
      const currentRoute = '/' + getCurrentPages().slice(-1)[0]?.route
      if (currentRoute === path) return  // 已在当前页，不重复跳转

      this.setData({ selected: index })
      wx.switchTab({ url: path })
    }
  }
})
