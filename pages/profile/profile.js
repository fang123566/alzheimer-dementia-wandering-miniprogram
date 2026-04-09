// pages/profile/profile.js
const app = getApp()
const { alertsAPI, settingsAPI, bindingAPI, authAPI, remindersAPI, locationAPI } = require('../../utils/api')

function todayNoticeKey() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `profile_reminder_notice_${y}${m}${d}`
}

Page({
  data: {
    role: 'family',
    userInfo: {},
    elderlyInfo: {},
    currentLocation: {},
    locationStatus: 'safe',
    contacts: [],
    reminders: [],
    bindings: [],
    binding: null,
    stats: { unreadAlerts: 0, totalAlerts: 0, chatCount: 0 },
    avatarFullUrl: '',
    genderLabel: '未设置'
  },

  onLoad() {
    if (!app.checkLogin()) return
    this._loadLocal()
    this._fetchData()
  },

  onShow() {
    if (!app.checkLogin()) return
    this._loadLocal()
    this._fetchData()
    this.startReminderWatcher()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  onHide() {
    this.stopReminderWatcher()
  },

  onUnload() {
    this.stopReminderWatcher()
  },

  _loadLocal() {
    const loc = app.globalData.currentLocation || {}
    const userInfo = app.globalData.userInfo || {}
    this.setData({
      role:            app.globalData.role        || 'family',
      userInfo:        userInfo,
      elderlyInfo:     app.globalData.elderlyInfo || {},
      currentLocation: loc,
      locationStatus:  loc.status || 'safe',
      contacts:        app.globalData.contacts   || [],
      avatarFullUrl:   this._buildAvatarUrl(userInfo.avatar),
      genderLabel:     this._formatGenderLabel(userInfo.gender)
    })
  },

  _formatGenderLabel(g) {
    if (g === 'male') return '男'
    if (g === 'female') return '女'
    return '未设置'
  },

  _buildAvatarUrl(avatar) {
    if (!avatar) return ''
    return avatar
  },

  async _fetchData() {
    const role = app.globalData.role
    try {
      // 所有角色都加载绑定状态
      const bindingRes = await bindingAPI.getBinding()
      const bindingList = bindingRes.code === 0 ? (bindingRes.data || []) : []
      const primaryBinding = bindingList[0] || null
      if (bindingRes.code === 0 && primaryBinding) {
        this.setData({ binding: primaryBinding, bindings: bindingList })
        if (role === 'family') {
          app.globalData.elderlyInfo = primaryBinding.linkedUser
          this.setData({ elderlyInfo: primaryBinding.linkedUser })
        }
      } else {
        this.setData({ binding: null, bindings: [] })
        if (role === 'family') {
          app.globalData.elderlyInfo = {}
          this.setData({ elderlyInfo: {} })
        }
      }

      if (role === 'family') {
        const [locRes, unreadRes, alertsRes] = await Promise.all([
          locationAPI.getLocation().catch(e => ({ code: -1, msg: e.message })),
          alertsAPI.getUnreadCount().catch(e => ({ code: -1, msg: e.message })),
          alertsAPI.getAlerts().catch(e => ({ code: -1, msg: e.message })),
        ])

        if (locRes.code === 0 && locRes.data) {
          app.globalData.currentLocation = locRes.data
          this.setData({
            currentLocation: locRes.data,
            locationStatus:  locRes.data.status || 'safe',
          })
        }
        if (unreadRes.code === 0) {
          this.setData({ 'stats.unreadAlerts': unreadRes.data?.count || 0 })
        }
        // chatCount 先保留 0（原先来自本地后端 /stats）
        this.setData({ 'stats.chatCount': 0 })
        if (alertsRes.code === 0) {
          this.setData({ 'stats.totalAlerts': (alertsRes.data || []).length })
        }
      } else {
        const [contactsRes, remindersRes] = await Promise.all([
          settingsAPI.getContacts(),
          remindersAPI.getToday()
        ])
        if (contactsRes.code === 0) {
          app.globalData.contacts = contactsRes.data
          this.setData({ contacts: contactsRes.data })
        }
        if (remindersRes.code === 0) {
          const nextReminders = remindersRes.data || []
          this.notifyTriggeredReminders(nextReminders)
          this.setData({ reminders: nextReminders })
        }
      }
    } catch (e) {}
  },

  startReminderWatcher() {
    if (this.data.role !== 'elderly') return
    this.stopReminderWatcher()
    this._reminderTimer = setInterval(() => {
      this._fetchData()
    }, 30000)
  },

  stopReminderWatcher() {
    if (this._reminderTimer) {
      clearInterval(this._reminderTimer)
      this._reminderTimer = null
    }
  },

  notifyTriggeredReminders(list) {
    if (this.data.role !== 'elderly') return
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

  // 老人端一键拨打
  callContact(e) {
    const { phone, name } = e.currentTarget.dataset
    wx.showModal({
      title: `拨打 ${name}`,
      content: `确认拨打 ${phone}？`,
      confirmText: '立即拨打',
      confirmColor: '#5dd97f',
      success(res) {
        if (res.confirm && phone) wx.makePhoneCall({ phoneNumber: phone })
      }
    })
  },

  chooseAvatar() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: async (res) => {
        const tempPath = res.tempFiles[0].tempFilePath
        try {
          wx.showLoading({ title: '上传中…', mask: true })
          // 上传到云存储
          const ext = tempPath.split('.').pop() || 'jpg'
          const cloudPath = `avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath,
            filePath: tempPath
          })
          const fileID = uploadRes.fileID
          // 通过云函数更新数据库
          const result = await authAPI.uploadAvatar(fileID)
          wx.hideLoading()
          if (result.code === 0 && result.data) {
            this._syncUserInfo(result.data)
            wx.showToast({ title: '头像已更新', icon: 'success' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '上传失败', icon: 'none' })
        }
      }
    })
  },

  editGender() {
    wx.showActionSheet({
      itemList: ['男', '女'],
      success: async (res) => {
        const genders = ['male', 'female']
        const gender = genders[res.tapIndex]
        if (!gender || gender === this.data.userInfo.gender) return
        try {
          wx.showLoading({ title: '保存中…', mask: true })
          const result = await authAPI.updateProfile({ gender })
          wx.hideLoading()
          if (result.code === 0 && result.data) {
            this._syncUserInfo(result.data)
            wx.showToast({ title: '已更新', icon: 'success' })
          } else {
            wx.showToast({ title: (result && result.msg) || '保存失败', icon: 'none' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '保存失败', icon: 'none' })
        }
      }
    })
  },

  editNickname() {
    const current = this.data.userInfo.name || ''
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      content: current,
      success: async (res) => {
        if (!res.confirm) return
        const name = (res.content || '').trim()
        if (!name) {
          wx.showToast({ title: '昵称不能为空', icon: 'none' })
          return
        }
        if (name === current) return
        try {
          wx.showLoading({ title: '保存中…', mask: true })
          const result = await authAPI.updateProfile({ name })
          wx.hideLoading()
          if (result.code === 0 && result.data) {
            this._syncUserInfo(result.data)
            wx.showToast({ title: '昵称已更新', icon: 'success' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: '修改失败', icon: 'none' })
        }
      }
    })
  },

  _syncUserInfo(userData) {
    app.globalData.userInfo = userData
    wx.setStorageSync('userInfo', userData)
    if (userData.role === 'elderly') {
      app.globalData.elderlyInfo = {
        ...(app.globalData.elderlyInfo || {}),
        name: userData.name,
        elderlyId: userData.elderlyId,
        age: userData.age || '',
        avatar: userData.avatar || ''
      }
    }
    this.setData({
      userInfo: userData,
      avatarFullUrl: this._buildAvatarUrl(userData.avatar),
      genderLabel: this._formatGenderLabel(userData.gender)
    })
  },

  goBinding()  { wx.navigateTo({ url: '/pages/binding/binding' }) },
  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }) },
  goReminders(){ wx.navigateTo({ url: '/pages/reminders/reminders' }) },
  goAlert()    { wx.switchTab({ url: '/pages/alert/alert' }) },
  goMemory()   { wx.navigateTo({ url: '/pages/memory/memory' }) },
  goLocation() { wx.switchTab({ url: '/pages/location/location' }) },
  goChat()     { wx.switchTab({ url: '/pages/aichat/aichat' }) },
  goDialect()  { wx.switchTab({ url: '/pages/dialect/dialect' }) },
  goDevice()   { wx.navigateTo({ url: '/pages/device/device' }) },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '确认退出当前账号？',
      confirmText: '退出',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await authAPI.logout()
        } catch (e) {}
        app.logout()
      }
    })
  },

  cancelAccount() {
    wx.showModal({
      title: '注销账号',
      content: '注销后当前账号及其绑定关系将被永久删除，且无法恢复，确认继续？',
      confirmText: '确认注销',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          wx.showLoading({ title: '注销中…' })
          const result = await authAPI.cancelAccount()
          if (result.code === 0) {
            wx.hideLoading()
            wx.showToast({ title: '账号已注销', icon: 'success' })
            setTimeout(() => app.logout(), 500)
          } else {
            wx.hideLoading()
            wx.showToast({ title: result.msg || '注销失败', icon: 'none' })
          }
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: e.message || '注销失败', icon: 'none' })
        }
      }
    })
  }
})
