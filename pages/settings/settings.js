// pages/settings/settings.js
const { settingsAPI } = require('../../utils/api')

Page({
  data: {
    contacts: [],
    elderly: { name: '', age: 0 },
    settings: {
      dialect: '四川话',
      speechSpeed: '较慢（-30%）',
      sensitivity: '标准',
      notifyMethod: '电话 + 推送',
      nightMode: true
    },
    fraudKeywords: [],
    family: { name: '', members: 0 }
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this._fetchAll()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this._fetchAll()
  },

  async _fetchAll() {
    try {
      const [settingsRes, contactsRes, keywordsRes] = await Promise.all([
        settingsAPI.getSettings(),
        settingsAPI.getContacts(),
        settingsAPI.getKeywords()
      ])
      if (settingsRes.code === 0) {
        const d = settingsRes.data
        this.setData({
          elderly: d.elderly,
          settings: d.settings,
          family: d.family
        })
      }
      if (contactsRes.code === 0) {
        this.setData({ contacts: contactsRes.data })
      }
      if (keywordsRes.code === 0) {
        this.setData({ fraudKeywords: keywordsRes.data })
      }
    } catch (e) {
      wx.showToast({ title: '加载设置失败', icon: 'none' })
    }
  },

  editContact(e) {
    const id = e.currentTarget.dataset.id
    const contact = this.data.contacts.find(c => c.id === id)
    wx.showToast({ title: `编辑：${contact?.name || ''}`, icon: 'none' })
  },

  addContact() {
    wx.showModal({
      title: '添加紧急联系人',
      editable: true,
      placeholderText: '姓名,电话,关系（逗号分隔）',
      success: async (res) => {
        if (res.confirm && res.content) {
          const parts = res.content.split(',').map(s => s.trim())
          if (parts.length < 2) {
            wx.showToast({ title: '格式：姓名,电话,关系', icon: 'none' })
            return
          }
          try {
            await settingsAPI.addContact({
              name: parts[0],
              phone: parts[1],
              relation: parts[2] || '家属',
              avatar: '👤'
            })
            const r = await settingsAPI.getContacts()
            if (r.code === 0) this.setData({ contacts: r.data })
            wx.showToast({ title: '添加成功', icon: 'success' })
          } catch (e) {
            wx.showToast({ title: '添加失败', icon: 'none' })
          }
        }
      }
    })
  },

  editElderly() {
    const { name, age } = this.data.elderly
    wx.showModal({
      title: '编辑老人信息',
      editable: true,
      content: `${name},${age}`,
      placeholderText: '姓名,年龄',
      success: async (res) => {
        if (res.confirm && res.content) {
          const parts = res.content.split(',').map(s => s.trim())
          try {
            await settingsAPI.updateElderly({ name: parts[0], age: parseInt(parts[1]) || age })
            this.setData({ 'elderly.name': parts[0], 'elderly.age': parseInt(parts[1]) || age })
            wx.showToast({ title: '已保存', icon: 'success' })
          } catch (e) {
            wx.showToast({ title: '保存失败', icon: 'none' })
          }
        }
      }
    })
  },

  editDialect() {
    const dialects = ['普通话', '四川话', '粤语', '东北话', '闽南语']
    wx.showActionSheet({
      itemList: dialects,
      success: async (res) => {
        const dialect = dialects[res.tapIndex]
        this.setData({ 'settings.dialect': dialect })
        await settingsAPI.updateSettings({ dialect })
      }
    })
  },

  editSpeed() {
    const speeds = ['正常', '较慢（-15%）', '较慢（-30%）', '很慢（-50%）']
    wx.showActionSheet({
      itemList: speeds,
      success: async (res) => {
        const speechSpeed = speeds[res.tapIndex]
        this.setData({ 'settings.speechSpeed': speechSpeed })
        await settingsAPI.updateSettings({ speechSpeed })
      }
    })
  },

  editSensitivity() {
    const levels = ['低', '标准', '高', '极高']
    wx.showActionSheet({
      itemList: levels,
      success: async (res) => {
        const sensitivity = levels[res.tapIndex]
        this.setData({ 'settings.sensitivity': sensitivity })
        await settingsAPI.updateSettings({ sensitivity })
      }
    })
  },

  editFence() {
    wx.switchTab({ url: '/pages/location/location' })
  },

  async toggleNightMode(e) {
    const nightMode = e.detail.value
    this.setData({ 'settings.nightMode': nightMode })
    try {
      await settingsAPI.updateSettings({ nightMode })
      wx.showToast({ title: nightMode ? '夜间模式已开启' : '夜间模式已关闭', icon: 'none' })
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' })
    }
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (res.confirm) getApp().logout()
      }
    })
  },

  addKeyword() {
    wx.showModal({
      title: '添加防诈关键词',
      editable: true,
      placeholderText: '输入关键词',
      success: async (res) => {
        if (res.confirm && res.content) {
          const kw = res.content.trim()
          try {
            const r = await settingsAPI.addKeyword(kw)
            if (r.code === 0) this.setData({ fraudKeywords: r.data })
            wx.showToast({ title: '已添加', icon: 'success' })
          } catch (e) {
            wx.showToast({ title: '添加失败', icon: 'none' })
          }
        }
      }
    })
  }
})
