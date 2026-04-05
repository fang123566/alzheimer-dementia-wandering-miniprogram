// pages/alert/alert.js
const { alertsAPI } = require('../../utils/api')

Page({
  data: {
    activeFilter: 'all',
    filters: [
      { key: 'all',    label: '全部'     },
      { key: 'lost',   label: '走失预警' },
      { key: 'fraud',  label: '防诈拦截' },
      { key: 'fence',  label: '围栏异常' },
      { key: 'health', label: '健康提醒' }
    ],
    allAlerts: [],
    alerts:    [],
    loading:   false
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

  // ── 拉取并格式化预警列表 ──────────────────────────────────
  async _fetchAlerts() {
    this.setData({ loading: true })
    try {
      const res = await alertsAPI.getAlerts()
      if (res.code === 0) {
        // 格式化，补全前端需要的展示字段
        const formatted = (res.data || []).map(a => ({
          ...a,
          id:         a._id,
          // level 数字 → 文字标签，方便 wxml 直接用
          levelText:  this._levelText(a.level),
          levelClass: this._levelClass(a.level),   // 控制颜色样式
          // 时间格式化
          timeStr:    this._formatTime(a.createdAt),
          // 确保 read 字段存在
          read:       a.read || false,
        }))
        this.setData({ allAlerts: formatted })
        this._applyFilter(this.data.activeFilter, formatted)
      } else {
        wx.showToast({ title: res.msg || '加载失败', icon: 'none' })
      }
    } catch (e) {
      console.error('[alert] fetch error', e)
      wx.showToast({ title: '加载预警失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  // ── 筛选 ──────────────────────────────────────────────────
  _applyFilter(key, list) {
    const filtered = key === 'all' ? list : list.filter(a => a.category === key)
    this.setData({ activeFilter: key, alerts: filtered })
  },

  setFilter(e) {
    const key = e.currentTarget.dataset.key
    this._applyFilter(key, this.data.allAlerts)
  },

  // ── 标记已读 ───────────────────────────────────────────────
  async markRead(e) {
    const id = e.currentTarget.dataset.id
    try {
      await alertsAPI.markRead(id)
      const all = this.data.allAlerts.map(a =>
        a.id === id ? { ...a, read: true } : a
      )
      this.setData({ allAlerts: all })
      this._applyFilter(this.data.activeFilter, all)
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  // ── 拨打回电 ───────────────────────────────────────────────
  callBack(e) {
    const phone = e.currentTarget.dataset.phone
    if (phone) wx.makePhoneCall({ phoneNumber: phone })
  },

  // ── 查看详情（跳地图页） ────────────────────────────────
  viewDetail(e) {
    const { id, latitude, longitude, openid } = e.currentTarget.dataset
    if (latitude && longitude) {
      wx.navigateTo({
        url: `/pages/map/map?alertId=${id}&lat=${latitude}&lng=${longitude}&openid=${openid}`
      })
    } else {
      wx.showToast({ title: '暂无位置信息', icon: 'none' })
    }
  },

  // ── 工具：level → 文字 ────────────────────────────────────
  _levelText(level) {
    return { 3: '高危⚠️', 2: '中危⚠', 1: '注意' }[level] || '未知'
  },

  // ── 工具：level → css class ───────────────────────────────
  _levelClass(level) {
    return { 3: 'danger', 2: 'warning', 1: 'info' }[level] || 'info'
  },

  // ── 工具：时间格式化 ──────────────────────────────────────
  _formatTime(t) {
    if (!t) return ''
    const d = new Date(t)
    const pad = n => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
})