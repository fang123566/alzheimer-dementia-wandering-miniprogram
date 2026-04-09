// pages/binding/binding.js
// 改造版：所有 bindingAPI 调用替换为 wx.cloud.callFunction

const app = getApp()

// ─── 统一调用云函数的封装 ──────────────────────────────────────────────────
// 调用云函数 `binding`，传入 action 和其余参数
// 自动注入当前用户 role（优先读 storage，避免全局 role 串号）
function callBinding(action, payload = {}) {
  const role = wx.getStorageSync('role') || app.globalData.role || 'family'
  const token = wx.getStorageSync('token') || ''
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'binding',
      data: {
        action,
        role,
        token,
        ...payload
      },
      success: res => resolve(res.result),
      fail: err => reject(new Error(err.errMsg || '云函数调用失败'))
    })
  })
}

// ─── Page ─────────────────────────────────────────────────────────────────

Page({
  data: {
    role: 'family',
    userInfo: {},
    bindings: [],
    bindingMeta: {
      canCreateBinding: false,
      canUnbind: false
    },
    linkedPhone: '',
    note: '',
    errMsg: '',
    binding_loading: false,
    pageLoading: true
  },

  onLoad() {
    if (!app.checkLogin()) return
    const role = wx.getStorageSync('role') || app.globalData.role || 'family'
    this.setData({
      role,
      userInfo: app.globalData.userInfo || {}
    })
    this._fetchBinding()
  },

  onShow() {
    if (!app.checkLogin()) return
    this._fetchBinding()
  },

  async onPullDownRefresh() {
    await this._fetchBinding()
    wx.stopPullDownRefresh()
  },

  // ── 获取绑定列表 ──────────────────────────────────────────────────────────
  async _fetchBinding() {
    this.setData({ pageLoading: true })
    try {
      const res = await callBinding('getBindings')
      const meta = res.meta || { canCreateBinding: true, canUnbind: true }

      if (res.code === 0) {
        const bindings = (res.data || []).map(item => ({
          ...item,
          binding: {
            ...item.binding,
            // 将时间戳格式化为本地日期字符串
            createdAt: item.binding?.createdAt
              ? new Date(item.binding.createdAt).toLocaleDateString('zh-CN')
              : ''
          }
        }))
        this.setData({ bindings, bindingMeta: meta, pageLoading: false })

        // 家属角色：把第一个绑定老人信息写入全局
        if (app.globalData.role === 'family') {
          app.globalData.elderlyInfo = bindings[0]?.linkedUser || {}
        }
      } else {
        this.setData({ bindings: [], bindingMeta: meta, pageLoading: false })
      }
    } catch (e) {
      console.error('[binding] _fetchBinding error:', e)
      this.setData({ pageLoading: false })
    }
  },

  // ── 输入事件 ──────────────────────────────────────────────────────────────
  onPhoneInput(e) {
    this.setData({ linkedPhone: e.detail.value, errMsg: '' })
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value, errMsg: '' })
  },

  // ── 创建绑定 ──────────────────────────────────────────────────────────────
  async doBinding() {
    const phone = this.data.linkedPhone.trim()
    if (!phone) {
      return this.setData({
        errMsg: `请输入${this.data.role === 'family' ? '老人' : '家属'}的手机号`
      })
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      return this.setData({ errMsg: '手机号格式不正确' })
    }
    if (this.data.binding_loading) return

    this.setData({ binding_loading: true, errMsg: '' })
    try {
      const res = await callBinding('createBinding', {
        linkedPhone: phone,
        note: this.data.note.trim()
      })
      if (res.code === 0) {
        wx.showToast({ title: '关联成功！', icon: 'success' })
        this.setData({ linkedPhone: '', note: '' })
        await this._fetchBinding()
      } else {
        this.setData({ errMsg: res.msg || '关联失败' })
      }
    } catch (e) {
      this.setData({ errMsg: e.message || '网络错误，请重试' })
    } finally {
      this.setData({ binding_loading: false })
    }
  },

  // ── 编辑 / 删除入口（ActionSheet） ───────────────────────────────────────
  editBinding(e) {
    const id = e.currentTarget.dataset.id
    const item = (this.data.bindings || []).find(
      x => String(x.binding?.id) === String(id)
    )
    if (!item) return

    wx.showActionSheet({
      itemList: ['编辑关联账号', '删除关联'],
      success: (res) => {
        if (res.tapIndex === 0) this._editBindingForm(item)
        if (res.tapIndex === 1) this.removeBinding(item)
      }
    })
  },

  // ── 编辑绑定（Modal 表单） ─────────────────────────────────────────────────
  _editBindingForm(item) {
    const current = [
      item.linkedUser?.phone || '',
      item.binding?.note || ''
    ].join(',')

    wx.showModal({
      title: '编辑关联',
      editable: true,
      content: current,
      placeholderText: '手机号,备注(可选)',
      success: async (res) => {
        if (!res.confirm) return
        const content = (res.content || '').trim()
        if (!content) return

        const parts = content.split(',').map(s => s.trim())
        const linkedPhone = parts[0]
        const note = parts[1] || ''

        if (!/^1[3-9]\d{9}$/.test(linkedPhone)) {
          wx.showToast({ title: '手机号格式不正确', icon: 'none' })
          return
        }

        try {
          const r = await callBinding('updateBinding', {
            bindingId: item.binding.id,
            linkedPhone,
            note
          })
          if (r.code === 0) {
            await this._fetchBinding()
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

  // ── 删除绑定 ──────────────────────────────────────────────────────────────
  removeBinding(item) {
    wx.showModal({
      title: '解除关联',
      content: `确认解除与 ${item.linkedUser?.name || '该账号'} 的关联？`,
      confirmText: '确认解除',
      confirmColor: '#ff5c5c',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await callBinding('deleteBinding', {
            bindingId: item.binding.id
          })
          if (r.code === 0) {
            wx.showToast({ title: '已解除关联', icon: 'success' })
            await this._fetchBinding()
          } else {
            wx.showToast({ title: r.msg || '操作失败', icon: 'none' })
          }
        } catch (e) {
          wx.showToast({ title: '网络错误', icon: 'none' })
        }
      }
    })
  },

  // ── 复制手机号 ────────────────────────────────────────────────────────────
  copyPhone(e) {
    const target = e?.currentTarget?.dataset?.target || 'linked'
    const phone = target === 'self'
      ? this.data.userInfo?.phone
      : (e?.currentTarget?.dataset?.phone || this.data.userInfo?.phone)
    if (!phone) return
    wx.setClipboardData({ data: phone })
  }
})