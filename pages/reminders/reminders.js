// pages/reminders/reminders.js
const { remindersAPI, bindingAPI } = require('../../utils/api')
const app = getApp()

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
    hasBinding: false,
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
      const cachedElderly = app.globalData.elderlyInfo || {}
      let hasBinding = !!cachedElderly.name
      let elderlyOpenid = cachedElderly.openid || cachedElderly._openid || cachedElderly.openId || ''
      let elderlyName = cachedElderly.name || '老人'
      try {
        const br = await bindingAPI.getBindings()
        if (br && br.code === 0 && br.data && br.data.length > 0) {
          const linkedUser = br.data[0].linkedUser || {}
          elderlyOpenid = linkedUser.openid || linkedUser._openid || linkedUser.openId || elderlyOpenid || ''
          elderlyName = linkedUser.name || elderlyName || '老人'
          hasBinding = true
          app.globalData.elderlyInfo = { ...cachedElderly, ...linkedUser }
        }
      } catch (e) {}
      this._elderlyOpenid = elderlyOpenid
      this.setData({ hasBinding, elderlyOpenid, elderlyName })
    } else {
      this.setData({ hasBinding: true })
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

    // ── 额外：通过 BLE 推送到硬件屏幕 + 语音 ──────────
    const bleNotify = app.globalData.bleNotify
    if (bleNotify) {
      triggered.forEach(item => {
        const text = `${item.icon || '⏰'} ${item.time} ${item.title}${item.note ? '，' + item.note : ''}`
        // 1. 发文字到硬件屏幕
        try { bleNotify.sendText(text) } catch (e) { console.error('[reminders] BLE sendText 失败', e) }
        // 2. TTS 合成后发语音到硬件（异步，不阻塞弹窗）
        try { bleNotify.sendTts(text) } catch (e) { console.error('[reminders] BLE sendTts 失败', e) }
      })
    }
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
    if ((wx.getStorageSync('role') || 'family') === 'family' && !this.data.hasBinding) {
      wx.showToast({ title: '请先绑定老人账号', icon: 'none' })
      return
    }
    const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
    wx.navigateTo({ url: '/pages/reminders/edit/edit?eid=' + encodeURIComponent(eid) })
  },

  // ── 列表项点击 ────────────────────────────────────
  tapTemplate(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.mode === 'delete') {
      this._toggleSelect(id)
    } else {
      if ((wx.getStorageSync('role') || 'family') === 'family' && !this.data.hasBinding) {
        wx.showToast({ title: '请先绑定老人账号', icon: 'none' })
        return
      }
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
    if ((wx.getStorageSync('role') || 'family') === 'family' && !this.data.hasBinding) {
      wx.showToast({ title: '请先绑定老人账号', icon: 'none' })
      return
    }
    const next = !this.data.autoRemind
    // 开启时先请求订阅消息授权
    if (next) {
      try {
        const subRes = await new Promise((resolve) => {
          wx.requestSubscribeMessage({
            tmplIds: ['5EfdaXcg118G3660FaPrQwSOM1FnXPLN0Aj9tciy0AI'],
            success: resolve,
            fail: resolve
          })
        })
        const accepted = subRes['5EfdaXcg118G3660FaPrQwSOM1FnXPLN0Aj9tciy0AI'] === 'accept'
        if (!accepted) {
          wx.showToast({ title: '需要授权订阅消息才能开启提醒', icon: 'none' })
          return
        }
      } catch (e) {}
    }
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

  // ── 手动触发单条提醒推送 ──────────────────────────
  async triggerRemind(e) {
    const templateId = e.currentTarget.dataset.id
    const eid = this._elderlyOpenid || this.data.elderlyOpenid || ''
    const elderlyName = this.data.elderlyName || '您'
    // 先请求订阅授权
    try {
      const subRes = await new Promise((resolve) => {
        wx.requestSubscribeMessage({
          tmplIds: ['5EfdaXcg118G3660FaPrQwSOM1FnXPLN0Aj9tciy0AI'],
          success: resolve,
          fail: resolve
        })
      })
      const accepted = subRes['5EfdaXcg118G3660FaPrQwSOM1FnXPLN0Aj9tciy0AI'] === 'accept'
      if (!accepted) {
        wx.showToast({ title: '需要授权才能发送提醒', icon: 'none' })
        return
      }
    } catch (e) {}
    try {
      wx.showLoading({ title: '发送中…', mask: true })
      const r = await remindersAPI.triggerRemind(templateId, eid, elderlyName)
      wx.hideLoading()
      wx.showToast({ title: r.code === 0 ? '提醒已发送' : (r.msg || '发送失败'), icon: r.code === 0 ? 'success' : 'none' })

      // ── 额外：BLE 推送到硬件 ──────────────────────
      if (r.code === 0) {
        // 从当前模板列表中找到这条提醒的内容
        const tpl = (this.data.templates || []).find(t => t.id === templateId || t._id === templateId)
        const bleNotify = app.globalData.bleNotify
        if (bleNotify && tpl) {
          const text = `${tpl.icon || '⏰'} ${tpl.time} ${tpl.title}${tpl.note ? '，' + tpl.note : ''}`
          try { bleNotify.sendText(text) } catch (e) {}
          try { bleNotify.sendTts(text) } catch (e) {}
        }
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '发送失败，请重试', icon: 'none' })
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
