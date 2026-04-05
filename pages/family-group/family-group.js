// pages/family-group/family-group.js
const app = getApp()
const { settingsAPI } = require('../../utils/api')

Page({
  data: {
    members: [],
    isAdmin: false,
    showQrModal: false,
    qrCodeUrl: '',
    inviteCode: ''
  },

  onLoad() {
    if (!app.checkLogin()) return
    this._fetchMembers()
  },

  onShow() {
    this._fetchMembers()
  },

  async _fetchMembers() {
    try {
      const res = await settingsAPI.getFamilyGroup()
      if (res.code === 0) {
        const data = res.data || {}
        this.setData({
          members: data.members || [],
          isAdmin: !!data.isAdmin
        })
      }
    } catch (e) {
      // 如果接口尚未实现，使用模拟数据
      this.setData({
        members: [],
        isAdmin: true
      })
    }
  },

  async inviteMember() {
    wx.showLoading({ title: '生成邀请码…', mask: true })
    try {
      const res = await settingsAPI.createInvite()
      wx.hideLoading()
      if (res.code === 0) {
        this.setData({
          showQrModal: true,
          qrCodeUrl: res.data.qrCodeUrl || '',
          inviteCode: res.data.inviteCode || ''
        })
      } else {
        wx.showToast({ title: res.msg || '生成失败', icon: 'none' })
      }
    } catch (e) {
      wx.hideLoading()
      // 模拟邀请码
      const code = 'FG' + Date.now().toString(36).toUpperCase().slice(-6)
      this.setData({
        showQrModal: true,
        qrCodeUrl: '',
        inviteCode: code
      })
    }
  },

  closeQrModal() {
    this.setData({ showQrModal: false })
  },

  copyInviteCode() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({
      data: this.data.inviteCode,
      success() {
        wx.showToast({ title: '已复制邀请码', icon: 'success' })
      }
    })
  },

  shareInvite() {
    // 触发微信分享
    wx.showToast({ title: '请点击右上角分享', icon: 'none' })
  },

  onShareAppMessage() {
    return {
      title: '邀请你加入家庭守护组',
      path: `/pages/family-group/family-group?invite=${this.data.inviteCode}`
    }
  },

  onMemberAction(e) {
    const { id, name, role } = e.currentTarget.dataset
    const isTargetAdmin = role === 'admin'
    const actions = isTargetAdmin
      ? ['取消管理员', '移出家庭组']
      : ['设为管理员', '移出家庭组']

    wx.showActionSheet({
      itemList: actions,
      success: (res) => {
        if (res.tapIndex === 0) {
          this._changeRole(id, name, isTargetAdmin ? 'member' : 'admin')
        } else if (res.tapIndex === 1) {
          this._removeMember(id, name)
        }
      }
    })
  },

  async _changeRole(id, name, newRole) {
    const label = newRole === 'admin' ? '管理员' : '普通成员'
    wx.showModal({
      title: '修改权限',
      content: `确认将「${name}」设为${label}？`,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await settingsAPI.updateMemberRole(id, newRole)
          wx.showToast({ title: '权限已更新', icon: 'success' })
          this._fetchMembers()
        } catch (e) {
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  },

  async _removeMember(id, name) {
    wx.showModal({
      title: '移出成员',
      content: `确认将「${name}」移出家庭组？移出后将无法查看老人信息。`,
      confirmText: '确认移出',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await settingsAPI.removeMember(id)
          wx.showToast({ title: '已移出', icon: 'success' })
          this._fetchMembers()
        } catch (e) {
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  }
})
