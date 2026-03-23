// pages/alert/alert.js
Page({
  data: {
    activeFilter: 'all',
    filters: [
      { key: 'all',     label: '全部' },
      { key: 'lost',    label: '走失预警' },
      { key: 'fraud',   label: '防诈拦截' },
      { key: 'fence',   label: '围栏异常' },
      { key: 'health',  label: '健康提醒' }
    ],
    allAlerts: [
      {
        id: 1, level: 'danger', type: '🚨 走失高危',
        time: '今天 14:32', read: false,
        content: '老人超出安全围栏 500 米，当前位置：锦江区东御街，已停留 15 分钟',
        location: '成都市锦江区东御街',
        phone: '138xxxxxxxx',
        category: 'lost'
      },
      {
        id: 2, level: 'danger', type: '🛡️ 防诈拦截',
        time: '今天 11:07', read: false,
        content: '检测到高危诈骗话术：对话中出现"转账""中奖"关键词，AI 已介入安抚并拦截',
        location: '',
        phone: '138xxxxxxxx',
        category: 'fraud'
      },
      {
        id: 3, level: 'warning', type: '⚠️ 围栏提醒',
        time: '昨天 09:20', read: true,
        content: '老人离开社区公园围栏，朝东方向步行约 200 米',
        location: '社区公园东侧',
        phone: '',
        category: 'fence'
      },
      {
        id: 4, level: 'info', type: '💊 用药提醒',
        time: '昨天 08:00', read: true,
        content: 'AI 伴聊已提醒老人服用早上药物，老人确认回复',
        location: '',
        phone: '',
        category: 'health'
      }
    ],
    alerts: []
  },

  onLoad() {
    this.setData({ alerts: this.data.allAlerts })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    const filtered = key === 'all'
      ? this.data.allAlerts
      : this.data.allAlerts.filter(a => a.category === key)
    this.setData({ activeFilter: key, alerts: filtered })
  },

  markRead(e) {
    const id = e.currentTarget.dataset.id
    const all = this.data.allAlerts.map(a => a.id === id ? { ...a, read: true } : a)
    this.setData({ allAlerts: all, alerts: all })
  },

  callBack(e) {
    wx.makePhoneCall({ phoneNumber: e.currentTarget.dataset.phone })
  },

  viewDetail(e) {
    // TODO: 跳转预警详情
  }
})
