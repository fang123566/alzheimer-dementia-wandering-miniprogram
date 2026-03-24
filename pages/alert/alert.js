// pages/alert/alert.js
const { alertsAPI } = require('../../utils/api')

Page({
  data: {
    activeFilter: 'all',
    filters: [
      { key: 'all',    label: '全部' },
      { key: 'lost',   label: '走失预警' },
      { key: 'fraud',  label: '防诈拦截' },
      { key: 'fence',  label: '围栏异常' },
      { key: 'health', label: '健康提醒' }
    ],
    allAlerts: [],
    alerts: [],
    loading: false
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this._fetchAlerts()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this._fetchAlerts()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  async _fetchAlerts() {
    this.setData({ loading: true })
    try {
      const res = await alertsAPI.getAlerts()
      if (res.code === 0) {
        this.setData({ allAlerts: res.data })
        this._applyFilter(this.data.activeFilter, res.data)
      }
    } catch (e) {
      wx.showToast({ title: '加载预警失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  _applyFilter(key, list) {
    const filtered = key === 'all' ? list : list.filter(a => a.category === key)
    this.setData({ activeFilter: key, alerts: filtered })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this._applyFilter(key, this.data.allAlerts)
  },

  async markRead(e) {
    const id = e.currentTarget.dataset.id
    try {
      await alertsAPI.markRead(id)
      const all = this.data.allAlerts.map(a => a.id === id ? { ...a, read: true } : a)
      this.setData({ allAlerts: all })
      this._applyFilter(this.data.activeFilter, all)
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  callBack(e) {
    const phone = e.currentTarget.dataset.phone
    if (phone) wx.makePhoneCall({ phoneNumber: phone })
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.showToast({ title: `预警 #${id}`, icon: 'none' })
  }
})
