// pages/reminders/edit/edit.js
const { remindersAPI } = require('../../../utils/api')

let _eid = ''   // 本页面内部缓存的老人 openid

const TYPES = [
  { value: 'medication', label: '用药', icon: '💊' },
  { value: 'walk',       label: '散步', icon: '🚶' },
  { value: 'custom',     label: '自定义', icon: '⏰' }
]

Page({
  data: {
    isEdit: false,
    templateId: '',
    types: TYPES,
    typeIndex: 2,
    title: '',
    time: '08:00',
    icon: '⏰',
    note: '',
    allTemplates: []
  },

  onLoad(options) {
    _eid = decodeURIComponent(options.eid || '')
    if (options.id) {
      this.setData({ isEdit: true, templateId: options.id })
      this._loadTemplate(options.id)
    } else if (options.type) {
      const idx = TYPES.findIndex(t => t.value === options.type)
      if (idx >= 0) {
        this.setData({
          typeIndex: idx,
          icon: TYPES[idx].icon,
          title: TYPES[idx].value !== 'custom' ? TYPES[idx].label + '提醒' : ''
        })
      }
    }
    this._loadAllTemplates()
  },

  async _loadTemplate(id) {
    try {
      const res = await remindersAPI.getTemplates(_eid)
      if (res.code === 0) {
        const list = res.data || []
        this.setData({ allTemplates: list })
        const t = list.find(x => x.id === id || x._id === id)
        if (t) {
          const typeIdx = TYPES.findIndex(tp => tp.value === (t.type || 'custom'))
          this.setData({
            title: t.title || '',
            time: t.time || '08:00',
            icon: t.icon || '⏰',
            note: t.note || '',
            typeIndex: typeIdx >= 0 ? typeIdx : 2
          })
        }
      }
    } catch (e) {}
  },

  async _loadAllTemplates() {
    try {
      const res = await remindersAPI.getTemplates(_eid)
      if (res.code === 0) this.setData({ allTemplates: res.data || [] })
    } catch (e) {}
  },

  onTypeChange(e) {
    const idx = Number(e.detail.value)
    const type = TYPES[idx]
    const update = { typeIndex: idx, icon: type.icon }
    if (!this.data.isEdit && type.value !== 'custom') {
      update.title = type.label + '提醒'
    }
    this.setData(update)
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value })
  },

  onTimeChange(e) {
    this.setData({ time: e.detail.value })
  },

  onNoteInput(e) {
    this.setData({ note: (e.detail.value || '').slice(0, 50) })
  },

  async save() {
    const { title, time, icon, note, isEdit, templateId, allTemplates, typeIndex } = this.data
    const type = TYPES[typeIndex].value

    if (!title.trim()) {
      wx.showToast({ title: '请填写提醒名称', icon: 'none' }); return
    }
    if (!time) {
      wx.showToast({ title: '请设置提醒时间', icon: 'none' }); return
    }

    // 客户端时间冲突检查
    const conflict = allTemplates.find(t => t.time === time && t.id !== templateId)
    if (conflict) {
      wx.showToast({ title: '该时间已存在提醒，请修改时间', icon: 'none' }); return
    }

    try {
      wx.showLoading({ title: '保存中…', mask: true })
      let res
      if (isEdit) {
        res = await remindersAPI.updateTemplate(templateId, {
          title: title.trim(), time, icon, type, note: note.trim()
        }, _eid)
      } else {
        res = await remindersAPI.addTemplate({
          title: title.trim(), time, icon, type, note: note.trim()
        }, _eid)
      }
      wx.hideLoading()

      if (res.code === 0) {
        wx.showToast({ title: '保存成功', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      } else {
        wx.showToast({ title: res.msg || '保存失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      wx.showToast({ title: '网络异常，请重试', icon: 'none' })
    }
  },

  cancel() {
    wx.navigateBack()
  }
})
