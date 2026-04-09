// pages/family-group/family-group.js
const app = getApp()
const { bindingAPI } = require('../../utils/api')

Page({
  data: {
    members: [],
    isAdmin: false,
    role: 'family',
    canUnbind: false,  // 是否可以解绑（家属端）
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
          avatar: item.linkedUser.avatar || '',
          role: idx === 0 ? 'admin' : 'member',
          isSelf: false,
          joinTime: item.binding.createdAt ? _fmt(item.binding.createdAt) : ''
        }))
        this.setData({ members, isAdmin: true, canUnbind: false })
      } else {
        // 家属视角：list 是自己绑定的老人（最多1个）
        const elderly = list[0]
        const members = elderly ? [{
          id: elderly.binding.id,
          name: elderly.linkedUser.name || '老人',
          phone: elderly.linkedUser.phone || '',
          avatar: elderly.linkedUser.avatar || '',
          role: 'elderly',
          isSelf: false,
          joinTime: elderly.binding.createdAt ? _fmt(elderly.binding.createdAt) : ''
        }] : []
        this.setData({
          members,
          isAdmin: false,
          canUnbind: !!elderly,  // 有绑定就可以解绑
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
    const { id, name, role: memberRole } = e.currentTarget.dataset
    const isElderly = this.data.role === 'elderly'

    // 老人端：可以解除与任何家属的绑定
    // 家属端：只能解除与老人的绑定（即唯一的成员）
    if (isElderly) {
      wx.showActionSheet({
        itemList: ['解除绑定'],
        success: (res) => {
          if (res.tapIndex === 0) this._doUnbind(id, name, 'elderly')
        }
      })
    } else {
      // 家属端直接确认解绑
      wx.showModal({
        title: '解除绑定',
        content: `确认解除与「${name}」的绑定？解除后将无法查看该老人的位置信息。`,
        confirmText: '确认解除',
        confirmColor: '#ff5c5c',
        success: (m) => {
          if (m.confirm) this._doUnbind(id, name, 'family')
        }
      })
    }
  },

  // 家属端解绑入口（直接执行，不再二次弹窗）
  handleUnbind() {
    const member = this.data.members[0]
    if (!member) return
    this._doUnbind(member.id, member.name, 'family')
  },

  // 统一解绑执行函数
  async _doUnbind(id, name, userRole) {
    try {
      wx.showLoading({ title: '解除中...', mask: true })
      const r = await bindingAPI.deleteBinding(id)
      wx.hideLoading()

      if (r && r.code === 0) {
        wx.showToast({ title: '已解除绑定', icon: 'success' })
        this._fetchMembers()
      } else {
        console.error('[解绑失败]', r)
        wx.showModal({
          title: '解除绑定失败',
          content: (r && r.msg) || '操作失败，请重试',
          showCancel: false
        })
      }
    } catch (e) {
      wx.hideLoading()
      console.error('[解绑异常]', e)
      wx.showModal({
        title: '解除绑定失败',
        content: '网络异常，请检查连接后重试',
        showCancel: false
      })
    }
  },
})

function _fmt(ts) {
  try {
    const d = new Date(typeof ts === 'number' ? ts : ts)
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} 加入`
  } catch (e) { return '' }
}
