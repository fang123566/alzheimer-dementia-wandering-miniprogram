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
    family: { name: '', members: 0 },
    deviceBound: false
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
          family: d.family,
          deviceBound: !!(d.family && d.family.deviceBound)
        })
      }
      if (contactsRes.code === 0) {
        this.setData({ contacts: this._sortContacts(contactsRes.data) })
      }
      if (keywordsRes.code === 0) {
        this.setData({ fraudKeywords: keywordsRes.data })
      }
    } catch (e) {
      wx.showToast({ title: '加载设置失败', icon: 'none' })
    }
  },

  _sortContacts(list = []) {
    return (list || []).slice().sort((a, b) => (a.priority || 999999) - (b.priority || 999999))
  },

  async _refreshContacts() {
    const r = await settingsAPI.getContacts()
    if (r.code === 0) this.setData({ contacts: this._sortContacts(r.data) })
    return r
  },

  callContact(e) {
    const { phone, name } = e.currentTarget.dataset
    if (!phone) return
    wx.makePhoneCall({
      phoneNumber: phone,
      fail() {}
    })
  },

  editContact(e) {
    const id = e.currentTarget.dataset.id
    const contact = this.data.contacts.find(c => String(c.id) === String(id))
    if (!contact) return

    wx.showActionSheet({
      itemList: ['修改姓名', '修改手机号', '修改关系', '删除联系人'],
      success: async (res) => {
        const tap = res.tapIndex
        try {
          if (tap === 0) {
            wx.showModal({
              title: '修改姓名',
              editable: true,
              content: contact.name || '',
              placeholderText: '请输入姓名',
              success: async (m) => {
                if (!m.confirm) return
                const name = (m.content || '').trim()
                if (!name) { wx.showToast({ title: '姓名不能为空', icon: 'none' }); return }
                await settingsAPI.updateContact(contact.id, { name })
                await this._refreshContacts()
                wx.showToast({ title: '已保存', icon: 'success' })
              }
            })
          } else if (tap === 1) {
            wx.showModal({
              title: '修改手机号',
              editable: true,
              content: contact.phone || '',
              placeholderText: '请输入手机号',
              success: async (m) => {
                if (!m.confirm) return
                const phone = (m.content || '').trim()
                if (!phone) { wx.showToast({ title: '手机号不能为空', icon: 'none' }); return }
                await settingsAPI.updateContact(contact.id, { phone })
                await this._refreshContacts()
                wx.showToast({ title: '已保存', icon: 'success' })
              }
            })
          } else if (tap === 2) {
            const relations = ['子女', '配偶', '亲属', '邻居', '护工', '朋友']
            wx.showActionSheet({
              itemList: relations,
              success: async (r) => {
                await settingsAPI.updateContact(contact.id, { relation: relations[r.tapIndex] })
                await this._refreshContacts()
                wx.showToast({ title: '已保存', icon: 'success' })
              }
            })
          } else if (tap === 3) {
            wx.showModal({
              title: '删除联系人',
              content: `确认删除「${contact.name}」？`,
              confirmText: '删除',
              confirmColor: '#ff5c5c',
              success: async (m) => {
                if (!m.confirm) return
                await settingsAPI.deleteContact(contact.id)
                await this._refreshContacts()
                wx.showToast({ title: '已删除', icon: 'success' })
              }
            })
          }
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  addContact() {
    // 第一步：输入姓名
    wx.showModal({
      title: '添加紧急联系人',
      editable: true,
      placeholderText: '请输入联系人姓名',
      success: (res) => {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        if (!name) { wx.showToast({ title: '姓名不能为空', icon: 'none' }); return }
        // 第二步：输入手机号
        wx.showModal({
          title: `${name} 的手机号`,
          editable: true,
          placeholderText: '请输入手机号码',
          success: (res2) => {
            if (!res2.confirm) return
            const phone = (res2.content || '').trim()
            if (!phone) { wx.showToast({ title: '手机号不能为空', icon: 'none' }); return }
            // 第三步：选择关系
            const relations = ['子女', '配偶', '亲属', '邻居', '护工', '朋友']
            wx.showActionSheet({
              itemList: relations,
              success: async (res3) => {
                const relation = relations[res3.tapIndex]
                try {
                  await settingsAPI.addContact({ name, phone, relation, avatar: '👤' })
                  await this._refreshContacts()
                  wx.showToast({ title: '添加成功', icon: 'success' })
                } catch (e) {
                  wx.showToast({ title: '添加失败', icon: 'none' })
                }
              },
              fail: async () => {
                // 未选择关系，默认"家属"
                try {
                  await settingsAPI.addContact({ name, phone, relation: '家属', avatar: '👤' })
                  await this._refreshContacts()
                  wx.showToast({ title: '添加成功', icon: 'success' })
                } catch (e) {
                  wx.showToast({ title: '添加失败', icon: 'none' })
                }
              }
            })
          }
        })
      }
    })
  },

  editElderly() {
    const fields = ['修改姓名', '修改年龄', '修改身份证号', '修改病史']
    wx.showActionSheet({
      itemList: fields,
      success: (res) => {
        const tap = res.tapIndex
        if (tap === 0) {
          wx.showModal({
            title: '修改姓名',
            editable: true,
            content: this.data.elderly.name || '',
            placeholderText: '请输入老人姓名',
            success: async (m) => {
              if (!m.confirm) return
              const name = (m.content || '').trim()
              if (!name) { wx.showToast({ title: '姓名不能为空', icon: 'none' }); return }
              try {
                await settingsAPI.updateElderly({ name })
                this.setData({ 'elderly.name': name })
                wx.showToast({ title: '已保存', icon: 'success' })
              } catch (e) { wx.showToast({ title: '保存失败', icon: 'none' }) }
            }
          })
        } else if (tap === 1) {
          wx.showModal({
            title: '修改年龄',
            editable: true,
            content: String(this.data.elderly.age || ''),
            placeholderText: '请输入年龄',
            success: async (m) => {
              if (!m.confirm) return
              const age = parseInt((m.content || '').trim())
              if (!age || age <= 0) { wx.showToast({ title: '请输入有效年龄', icon: 'none' }); return }
              try {
                await settingsAPI.updateElderly({ age })
                this.setData({ 'elderly.age': age })
                wx.showToast({ title: '已保存', icon: 'success' })
              } catch (e) { wx.showToast({ title: '保存失败', icon: 'none' }) }
            }
          })
        } else if (tap === 2) {
          wx.showModal({
            title: '修改身份证号',
            editable: true,
            content: this.data.elderly.idCard || '',
            placeholderText: '请输入身份证号码',
            success: async (m) => {
              if (!m.confirm) return
              const idCard = (m.content || '').trim()
              if (!idCard) { wx.showToast({ title: '身份证号不能为空', icon: 'none' }); return }
              try {
                await settingsAPI.updateElderly({ idCard })
                this.setData({ 'elderly.idCard': idCard })
                wx.showToast({ title: '已保存', icon: 'success' })
              } catch (e) { wx.showToast({ title: '保存失败', icon: 'none' }) }
            }
          })
        } else if (tap === 3) {
          wx.showModal({
            title: '修改病史',
            editable: true,
            content: this.data.elderly.medicalHistory || '',
            placeholderText: '请输入病史信息（如：高血压、糖尿病）',
            success: async (m) => {
              if (!m.confirm) return
              const medicalHistory = (m.content || '').trim()
              try {
                await settingsAPI.updateElderly({ medicalHistory })
                this.setData({ 'elderly.medicalHistory': medicalHistory })
                wx.showToast({ title: '已保存', icon: 'success' })
              } catch (e) { wx.showToast({ title: '保存失败', icon: 'none' }) }
            }
          })
        }
      }
    })
  },

  editDialect() {
    const dialects = ['普通话', '武汉话', '四川话', '粤语', '东北话', '闽南语', '湖南话', '上海话', '河南话', '客家话']
    wx.showActionSheet({
      itemList: dialects,
      success: async (res) => {
        const dialect = dialects[res.tapIndex]
        this.setData({ 'settings.dialect': dialect })
        try {
          await settingsAPI.updateSettings({ dialect })
          wx.showToast({ title: '方言已切换为' + dialect, icon: 'success' })
        } catch (e) { wx.showToast({ title: '保存失败', icon: 'none' }) }
      }
    })
  },

  editSpeed() {
    const speeds = ['慢速', '正常', '快速']
    wx.showActionSheet({
      itemList: speeds,
      success: async (res) => {
        const speechSpeed = speeds[res.tapIndex]
        this.setData({ 'settings.speechSpeed': speechSpeed })
        try {
          await settingsAPI.updateSettings({ speechSpeed })
          wx.showToast({ title: '语速已调整为' + speechSpeed, icon: 'success' })
        } catch (e) { wx.showToast({ title: '保存失败', icon: 'none' }) }
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

  editNotifyMethod() {
    const methods = ['电话 + 推送', '仅推送', '仅电话', '短信 + 电话']
    wx.showActionSheet({
      itemList: methods,
      success: async (res) => {
        const notifyMethod = methods[res.tapIndex]
        if (!notifyMethod) return
        this.setData({ 'settings.notifyMethod': notifyMethod })
        try {
          await settingsAPI.updateSettings({ notifyMethod })
          wx.showToast({ title: '通知方式已更新', icon: 'success' })
        } catch (e) {
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  editFence() {
    wx.switchTab({ url: '/pages/location/location' })
  },

  showFamilyGroupInfo() {
    wx.navigateTo({ url: '/pages/family-group/family-group' })
  },

  goBinding() {
    wx.navigateTo({ url: '/pages/binding/binding' })
  },

  goReminders() {
    wx.navigateTo({ url: '/pages/reminders/reminders' })
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
