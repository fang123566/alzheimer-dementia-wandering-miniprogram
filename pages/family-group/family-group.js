// pages/family-group/family-group.js
const app = getApp()
const { bindingAPI } = require('../../utils/api')

Page({
  data: {
    members: [],
    isAdmin: false,
    role: 'family',
    showInviteModal: false,
    elderlyPhone: ''   // 老人手机号，用于邀请引导文案
  },

  onLoad() {
    if (!app.checkLogin()) return
    this._fetchMembers()
  },

  onShow() {
    this._fetchMembers()
  },

  async _fetchMembers() {
    const role = wx.getStorageSync('role') || 'family'
    this.setData({ role })
    try {
      const res = await bindingAPI.getBindings()
      if (!res || res.code !== 0) return

      const list = res.data || []

      if (role === 'elderly') {
        // 老人视角：list 是绑定了自己的所有家属
        const members = list.map((item, idx) => ({
          id: item.binding.id,
          name: item.linkedUser.name || ('家属' + (idx + 1)),
          phone: item.linkedUser.phone || '',
          avatar: '👤',
          role: idx === 0 ? 'admin' : 'member',
          isSelf: false,
          joinTime: item.binding.createdAt ? _fmt(item.binding.createdAt) : ''
        }))
        this.setData({ members, isAdmin: true })
      } else {
        // 家属视角：list 是自己绑定的老人（最多1个）
        const elderly = list[0]
        const members = elderly ? [{
          id: elderly.binding.id,
          name: elderly.linkedUser.name || '老人',
          phone: elderly.linkedUser.phone || '',
          avatar: '👴',
          role: 'elderly',
          isSelf: false,
          joinTime: elderly.binding.createdAt ? _fmt(elderly.binding.createdAt) : ''
        }] : []
        this.setData({
          members,
          isAdmin: false,
          elderlyPhone: elderly ? (elderly.linkedUser.phone || '') : ''
        })
      }
    } catch (e) {
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  inviteMember() {
    this.setData({ showInviteModal: true })
  },

  closeInviteModal() {
    this.setData({ showInviteModal: false })
  },

  copyElderlyPhone() {
    const phone = this.data.elderlyPhone
    if (!phone) return
    wx.setClipboardData({
      data: phone,
      success() { wx.showToast({ title: '已复制手机号', icon: 'success' }) }
    })
  },

  onShareAppMessage() {
    return {
      title: '守护·陪伴 — 邀请你共同守护老人',
      path: '/pages/index/index'
    }
  },

  shareInvite() {
    wx.showToast({ title: '请点击右上角菜单分享', icon: 'none' })
  },

  onMemberAction(e) {
    if (this.data.role !== 'elderly') return
    const { id, name } = e.currentTarget.dataset
    wx.showActionSheet({
      itemList: ['解除绑定'],
      success: (res) => {
        if (res.tapIndex === 0) this._removeBinding(id, name)
      }
    })
  },

  async _removeBinding(id, name) {
    wx.showModal({
      title: '解除绑定',
      content: `确认将「${name}」移出家庭组？解除后对方将无法查看您的位置信息。`,
      confirmText: '确认解除',
      confirmColor: '#ff5c5c',
      success: async (m) => {
        if (!m.confirm) return
        try {
          const r = await bindingAPI.deleteBinding(id)
          if (r && r.code === 0) {
            wx.showToast({ title: '已解除绑定', icon: 'success' })
            this._fetchMembers()
          } else {
            wx.showToast({ title: (r && r.msg) || '操作失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  }
})

function _fmt(ts) {
  try {
    const d = new Date(typeof ts === 'number' ? ts : ts)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 加入`
  } catch (e) { return '' }
}
