// pages/settings/settings.js
Page({
  data: {
    contacts: [
      { id: 1, avatar: '👨', relation: '儿子', name: '王建国', phone: '138xxxxxxxx', priority: 1 },
      { id: 2, avatar: '👩', relation: '女儿', name: '王丽',   phone: '139xxxxxxxx', priority: 2 }
    ],
    elderly: { name: '王建明', age: 78 },
    settings: {
      dialect:       '四川话',
      speechSpeed:   '较慢（-30%）',
      sensitivity:   '标准',
      notifyMethod:  '电话 + 推送',
      nightMode:     true
    },
    fraudKeywords: ['转账', '中奖', '公检法', '验证码', '保证金', '陌生账户'],
    family: { name: '王家', members: 4 }
  },

  editContact(e) {
    wx.showToast({ title: '编辑联系人', icon: 'none' })
    // TODO: 跳转编辑页
  },

  addContact() {
    wx.showToast({ title: '添加联系人', icon: 'none' })
  },

  editElderly()     { wx.showToast({ title: '编辑老人信息', icon: 'none' }) },
  editDialect()     {
    wx.showActionSheet({
      itemList: ['普通话', '四川话', '粤语', '东北话', '闽南语'],
      success: (res) => {
        const dialects = ['普通话', '四川话', '粤语', '东北话', '闽南语']
        this.setData({ 'settings.dialect': dialects[res.tapIndex] })
      }
    })
  },
  editSpeed()       { wx.showToast({ title: '语速设置', icon: 'none' }) },
  editSensitivity() { wx.showToast({ title: '预警灵敏度', icon: 'none' }) },
  editFence()       { wx.navigateTo({ url: '/pages/location/location' }) },

  toggleNightMode(e) {
    this.setData({ 'settings.nightMode': e.detail.value })
    wx.showToast({
      title: e.detail.value ? '夜间模式已开启' : '夜间模式已关闭',
      icon: 'none'
    })
  },

  addKeyword() {
    wx.showModal({
      title: '添加防诈关键词',
      editable: true,
      placeholderText: '输入关键词',
      success: (res) => {
        if (res.confirm && res.content) {
          const kws = [...this.data.fraudKeywords, res.content.trim()]
          this.setData({ fraudKeywords: kws })
        }
      }
    })
  }
})
