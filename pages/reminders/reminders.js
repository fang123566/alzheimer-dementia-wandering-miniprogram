// pages/reminders/reminders.js
const { remindersAPI, bindingAPI } = require('../../utils/api')

function todayNoticeKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `reminder_notice_${y}${m}${d}`
}

Page({
  data: {
    templates: [],
    today: [],
    mode: 'normal',       // normal | edit | delete
    autoRemind: false,
    selectedMap: {},       // { [id]: true } 删除模式勾选
    selectAll: false,
    selectedCount: 0,
    elderlyOpenid: '',
    elderlyName: ''
  },

  _elderlyOpenid: '',   // 内部缓存，避免 setData 异步延迟

  onLoad() {
    if (!getApp().checkLogin()) return
    this._loadBindingThenRefresh()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this._loadBindingThenRefresh()
    this.startReminderWatcher()
  },

  async _loadBindingThenRefresh() {
    const role = wx.getStorageSync('role') || 'family'
    if (role === 'family') {
      try {
        const br = await bindingAPI.getBindings()
        if (br && br.code === 0 && br.data && br.data.length > 0) {
          const eid = br.data[0].linkedUser.openid || ''
          const ename = br.data[0].linkedUser.name || '老人'
          this._elderlyOpenid = eid
          this.setData({ elderlyOpenid: eid, elderlyName: ename })
        }
      } catch (e) {}
    }
    this.refreshAll()
  },

  onHide() { this.stopReminderWatcher() },
  onUnload() { this.stopReminderWatcher() },

  // ── 数据加载 ──────────────────────────────────────
  async refreshAll() {
    const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
    try {
      const [tRes, todayRes, settingRes] = await Promise.all([
        remindersAPI.getTemplates(eid),
        remindersAPI.getToday(eid),
        remindersAPI.getAutoRemindSetting(eid)
      ])
      if (tRes.code === 0) this.setData({ templates: tRes.data || [] })
      if (todayRes.code === 0) {
        const list = todayRes.data || []
        this.notifyTriggeredReminders(list)
        this.setData({ today: list })
      }
      if (settingRes.code === 0) {
        this.setData({ autoRemind: settingRes.data.autoRemind || false })
      }
    } catch (e) {
      wx.showToast({ title: '加载提醒失败', icon: 'none' })
    }
  },

  startReminderWatcher() {
    this.stopReminderWatcher()
    this._timer = setInterval(() => this.refreshAll(), 30000)
  },
  stopReminderWatcher() {
    if (this._timer) { clearInterval(this._timer); this._timer = null }
  },

  notifyTriggeredReminders(list) {
    const key = todayNoticeKey()
    const notified = wx.getStorageSync(key) || []
    const triggered = (list || []).filter(i => i.reminded && notified.indexOf(i.id) === -1)
    if (!triggered.length) return
    const c = triggered[0]
    const ids = triggered.map(i => i.id)
    wx.setStorageSync(key, notified.concat(ids))
    wx.vibrateShort({ type: 'medium' })
    wx.showModal({
      title: '提醒通知',
      content: c.time + ' ' + c.title,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  // ── 模式切换 ──────────────────────────────────────
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) {
      this.setData({ mode: 'normal', selectedMap: {}, selectAll: false, selectedCount: 0 })
    } else {
      this.setData({ mode, selectedMap: {}, selectAll: false, selectedCount: 0 })
    }
  },

  // ── 新增提醒 ──────────────────────────────────────
  addTemplate() {
    const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
    wx.navigateTo({ url: '/pages/reminders/edit/edit?eid=' + encodeURIComponent(eid) })
  },

  // ── 列表项点击 ────────────────────────────────────
  tapTemplate(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.mode === 'delete') {
      this._toggleSelect(id)
    } else {
      // normal / edit 模式均跳转编辑页
      const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
      wx.navigateTo({ url: '/pages/reminders/edit/edit?id=' + id + '&eid=' + encodeURIComponent(eid) })
    }
  },

  // ── 删除模式：勾选 ────────────────────────────────
  _toggleSelect(id) {
    const map = Object.assign({}, this.data.selectedMap)
    if (map[id]) { delete map[id] } else { map[id] = true }
    const count = Object.keys(map).length
    this.setData({
      selectedMap: map,
      selectedCount: count,
      selectAll: count === this.data.templates.length
    })
  },

  toggleSelectAll() {
    if (this.data.selectAll) {
      this.setData({ selectedMap: {}, selectAll: false, selectedCount: 0 })
    } else {
      const map = {}
      this.data.templates.forEach(t => { map[t.id] = true })
      this.setData({ selectedMap: map, selectAll: true, selectedCount: this.data.templates.length })
    }
  },

  confirmDelete() {
    const ids = Object.keys(this.data.selectedMap)
    if (!ids.length) {
      wx.showToast({ title: '请选择要删除的提醒', icon: 'none' }); return
    }
    wx.showModal({
      title: '确认删除',
      content: '确定删除选中的 ' + ids.length + ' 项提醒吗？',
      confirmText: '删除',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          wx.showLoading({ title: '删除中…', mask: true })
          const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
          const r = await remindersAPI.batchDelete(ids, eid)
          wx.hideLoading()
          if (r.code === 0) {
            this.setData({ mode: 'normal', selectedMap: {}, selectAll: false, selectedCount: 0 })
            await this.refreshAll()
            wx.showToast({ title: '已删除', icon: 'success' })
          } else {
            wx.showToast({ title: r.msg || '删除失败', icon: 'none' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '网络异常，请重试', icon: 'none' })
        }
      }
    })
  },

  // ── 自动提醒开关 ──────────────────────────────────
  async toggleAutoRemind() {
    const next = !this.data.autoRemind
    try {
      wx.showLoading({ title: next ? '开启中…' : '关闭中…', mask: true })
      const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
      const r = await remindersAPI.toggleAutoRemind(next, eid)
      wx.hideLoading()
      if (r.code === 0) {
        this.setData({ autoRemind: next })
        await this.refreshAll()
        wx.showToast({ title: next ? '已开启自动提醒' : '已关闭自动提醒', icon: 'success' })
      } else {
        wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
  },

  // ── 今日预览：手动切换状态 ────────────────────────
  async toggleTodayStatus(e) {
    const templateId = e.currentTarget.dataset.tid
    const current = e.currentTarget.dataset.done
    try {
      const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
      const r = await remindersAPI.toggleDone(templateId, !current, eid)
      if (r.code === 0) await this.refreshAll()
      else wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  noop() {}
})
