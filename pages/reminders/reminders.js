const { remindersAPI } = require('../../utils/api')

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
    today: []
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this.refreshAll()
    this.startReminderWatcher()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this.refreshAll()
    this.startReminderWatcher()
  },

  onHide() {
    this.stopReminderWatcher()
  },

  onUnload() {
    this.stopReminderWatcher()
  },

  async refreshAll() {
    try {
      const [tRes, todayRes] = await Promise.all([
        remindersAPI.getTemplates(),
        remindersAPI.getToday()
      ])
      if (tRes.code === 0) this.setData({ templates: tRes.data || [] })
      if (todayRes.code === 0) {
        const nextToday = todayRes.data || []
        this.notifyTriggeredReminders(nextToday)
        this.setData({ today: nextToday })
      }
    } catch (e) {
      wx.showToast({ title: '加载提醒失败', icon: 'none' })
    }
  },

  startReminderWatcher() {
    this.stopReminderWatcher()
    this._reminderTimer = setInterval(() => {
      this.refreshAll()
    }, 30000)
  },

  stopReminderWatcher() {
    if (this._reminderTimer) {
      clearInterval(this._reminderTimer)
      this._reminderTimer = null
    }
  },

  notifyTriggeredReminders(list) {
    const storageKey = todayNoticeKey()
    const notifiedIds = wx.getStorageSync(storageKey) || []
    const triggered = (list || []).filter(item => item.reminded && !notifiedIds.includes(item.id))
    if (!triggered.length) return
    const current = triggered[0]
    wx.setStorageSync(storageKey, [...notifiedIds, ...triggered.map(item => item.id)])
    wx.vibrateShort({ type: 'medium' })
    wx.showModal({
      title: '提醒通知',
      content: `${current.time} ${current.title}`,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  addTemplate() {
    wx.showModal({
      title: '添加提醒',
      editable: true,
      placeholderText: '标题,时间(HH:mm),图标(可选)',
      success: async (res) => {
        if (!res.confirm) return
        const content = (res.content || '').trim()
        if (!content) return
        const parts = content.split(',').map(s => s.trim())
        const title = parts[0]
        const time = parts[1]
        const icon = parts[2]
        if (!title || !time) {
          wx.showToast({ title: '格式：标题,时间(HH:mm),图标', icon: 'none' })
          return
        }
        try {
          const r = await remindersAPI.addTemplate({ title, time, icon })
          if (r.code === 0) {
            await this.refreshAll()
            wx.showToast({ title: '已添加', icon: 'success' })
          } else {
            wx.showToast({ title: r.msg || '添加失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: e.message || '添加失败', icon: 'none' })
        }
      }
    })
  },

  editTemplate(e) {
    const id = e.currentTarget.dataset.id
    const t = (this.data.templates || []).find(x => String(x.id) === String(id))
    if (!t) return

    const actions = ['编辑', '删除']
    wx.showActionSheet({
      itemList: actions,
      success: (r) => {
        if (r.tapIndex === 0) this._editTemplateForm(t)
        if (r.tapIndex === 1) this._deleteTemplate(t)
      }
    })
  },

  _editTemplateForm(t) {
    const current = [t.title, t.time, t.icon].map(s => (s == null ? '' : String(s))).join(',')
    wx.showModal({
      title: '编辑提醒',
      editable: true,
      content: current,
      placeholderText: '标题,时间(HH:mm),图标(可选)',
      success: async (res) => {
        if (!res.confirm) return
        const content = (res.content || '').trim()
        if (!content) return
        const parts = content.split(',').map(s => s.trim())
        const title = parts[0]
        const time = parts[1]
        const icon = parts[2]
        if (!title || !time) {
          wx.showToast({ title: '格式：标题,时间(HH:mm),图标', icon: 'none' })
          return
        }
        try {
          const r = await remindersAPI.updateTemplate(t.id, { title, time, icon })
          if (r.code === 0) {
            await this.refreshAll()
            wx.showToast({ title: '已保存', icon: 'success' })
          } else {
            wx.showToast({ title: r.msg || '保存失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: e.message || '保存失败', icon: 'none' })
        }
      }
    })
  },

  _deleteTemplate(t) {
    wx.showModal({
      title: '删除提醒',
      content: `确认删除“${t.title}”吗？`,
      confirmText: '删除',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await remindersAPI.deleteTemplate(t.id)
          if (r.code === 0) {
            await this.refreshAll()
            wx.showToast({ title: '已删除', icon: 'success' })
          } else {
            wx.showToast({ title: r.msg || '删除失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: e.message || '删除失败', icon: 'none' })
        }
      }
    })
  },

  noop() {}
})
