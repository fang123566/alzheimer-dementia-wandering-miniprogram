// utils/api.js
// 所有接口调用的统一封装
const http = require('./request')
// ── 云函数调用工具 ──────────────────────────────────────
/**
 * 调用微信云函数，返回与 http 模块风格一致的 Promise
 * @param {string} name   - 云函数名称
 * @param {object} data   - 传参
 */
function callCloud(name, data = {}) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name,
      data,
      success: res => resolve(res.result),
      fail: err => {
        console.error(`[云函数 ${name}] 调用失败`, err)
        wx.showToast({ title: '网络请求失败', icon: 'none' })
        reject(new Error(err.errMsg || '云函数调用失败'))
      }
    })
  })
}

function getCurrentRole() {
  try {
    const app = getApp && getApp()
    const role = app && app.globalData ? app.globalData.role : ''
    if (role) return role
  } catch (e) {}
  return wx.getStorageSync('role') || 'family'
}
// ── 认证（已迁移至 auth 云函数）────────────────────────────
const authAPI = {
  login:         (phone, password)              => callCloud('auth', { action: 'login', phone, password }),
  register:      (name, phone, password, role)  => callCloud('auth', { action: 'register', name, phone, password, role }),
  logout:        ()                             => callCloud('auth', { action: 'logout' }),
  cancelAccount: ()                             => callCloud('auth', { action: 'cancelAccount' }),
  profile:       ()                             => callCloud('auth', { action: 'profile', token: wx.getStorageSync('token') }),
  updateProfile: (data)                         => callCloud('auth', { action: 'updateProfile', token: wx.getStorageSync('token'), ...data }),
  uploadAvatar:  (fileID)                       => callCloud('auth', { action: 'uploadAvatar', token: wx.getStorageSync('token'), fileID })
}
// ── 位置（已迁移至微信云函数）────────────────────────────
const locationAPI = {
  getLocation:    ()     => callCloud('locationGetCurrent'),
  updateLocation: (data) => callCloud('locationUpdate', data),
  getTrajectory:  ()     => callCloud('locationTrajectory'),
  getFences:      ()     => callCloud('locationFences', { action: 'list' }),
  addFence:       (data) => callCloud('locationFences', { action: 'add', ...data }),
  toggleFence:    (id, en) => callCloud('locationFences', { action: 'toggle', fenceId: id, enabled: en }),
  deleteFence:    (id)     => callCloud('locationFences', { action: 'delete', fenceId: id })
}
// ── 预警 ──────────────────────────────────────────────
const alertsAPI = {
  getAlerts:      (category) => callCloud('alerts', { action: 'get', ...(category ? { category } : {}) }),
  getUnreadCount: ()         => callCloud('alerts', { action: 'unreadCount' }),
  markRead:       (id)       => callCloud('alerts', { action: 'markRead', id }),
  deleteAlert:    (id)       => callCloud('alerts', { action: 'delete', id })
}
// ── AI 伴聊 ───────────────────────────────────────────
// 全部迁移至 aiChat 云函数，不再走后端 HTTP
const chatAPI = {
  /**
   * 获取历史聊天记录（最近40条）
   */
  getHistory: () =>
    callCloud('aiChat', { action: 'getHistory' }),
  /**
   * 发送消息，云函数负责：
   *   - 调用千问 AI
   *   - 提取记忆并存入 chat_memories
   *   - 检测反诈并写入 alerts
   *   - 触发提醒写入 reminders
   * @param {string} text
   */
  sendMessage: (text) =>
    callCloud('aiChat', { action: 'sendMessage', text }),
  /**
   * 清空当前用户的聊天记录
   */
  clearHistory: () =>
    callCloud('aiChat', { action: 'clearHistory' }),
  /**
   * 获取 AI 提取的老人记忆列表
   * 可在设置/家庭看板页展示
   */
  getMemories: () =>
    callCloud('aiChat', { action: 'getMemories' }),
  /**
   * 调用 Dify 将方言文字翻译成普通话
   * @param {string} text 方言文字
   */
  difyTranslate: (text) =>
    callCloud('aiChat', { action: 'difyTranslate', text })
}
// ── 记忆相册 ──────────────────────────────────────────
const memoryAPI = {
  getPhotos:    (member) => http.get('/memory/photos', member ? { member } : {}),
  getPhoto:     (id)     => http.get(`/memory/photos/${id}`),
  getVoiceNote: (id)     => http.get(`/memory/photos/${id}/voice`),
  uploadMedia:  (filePath, mediaType) => http.upload('/memory/upload', filePath, 'file', { mediaType }, true),
  addPhoto:     (data)   => http.post('/memory/photos', data),
  updatePhoto:  (id, d)  => http.put(`/memory/photos/${id}`, d),
  deleteVoiceNote: (id)  => http.delete(`/memory/photos/${id}/voice`),
  deletePhoto:  (id)     => http.delete(`/memory/photos/${id}`),
  getMembers:   ()       => http.get('/memory/members'),
  addMember:    (data)   => http.post('/memory/members', data),
  updateMember: (id, d)  => http.put(`/memory/members/${id}`, d),
  deleteMember: (id)     => http.delete(`/memory/members/${id}`),
  getHints:     ()       => http.get('/memory/hints'),
  addHint:      (text)   => http.post('/memory/hints', { text }),
  deleteHint:   (id)     => http.delete(`/memory/hints/${id}`)
}
// ── 设置 ──────────────────────────────────────────────
const settingsAPI = {
  getSettings:     ()     => callCloud('settings', { action: 'getSettings', token: wx.getStorageSync('token') }),
  updateSettings:  (data) => callCloud('settings', { action: 'updateSettings', token: wx.getStorageSync('token'), data }),
  updateElderly:   (data) => callCloud('settings', { action: 'updateElderly', token: wx.getStorageSync('token'), data }),
  getContacts:     ()     => callCloud('settings', { action: 'getContacts', token: wx.getStorageSync('token') }),
  addContact:      (data) => callCloud('settings', { action: 'addContact', token: wx.getStorageSync('token'), data }),
  updateContact:   (id, d)=> callCloud('settings', { action: 'updateContact', token: wx.getStorageSync('token'), id, data: d }),
  deleteContact:   (id)   => callCloud('settings', { action: 'deleteContact', token: wx.getStorageSync('token'), id }),
  getKeywords:     ()     => callCloud('settings', { action: 'getKeywords', token: wx.getStorageSync('token') }),
  addKeyword:      (kw)   => callCloud('settings', { action: 'addKeyword', token: wx.getStorageSync('token'), keyword: kw }),
  deleteKeyword:   (kw)   => callCloud('settings', { action: 'deleteKeyword', token: wx.getStorageSync('token'), keyword: kw })
}
// ── 账号关联（已迁移至 binding 云函数）──────────────────────
const bindingAPI = {
  getBinding: () => {
    const role = getCurrentRole()
    return callCloud('binding', { action: 'getBindings', role, token: wx.getStorageSync('token') })
  },
  getBindings: () => {
    const role = getCurrentRole()
    return callCloud('binding', { action: 'getBindings', role, token: wx.getStorageSync('token') })
  },
  createBinding: (linkedPhone, note) => {
    const role = getCurrentRole()
    return callCloud('binding', { action: 'createBinding', role, token: wx.getStorageSync('token'), linkedPhone, note })
  },
  updateBinding: (id, data) => {
    const role = getCurrentRole()
    return callCloud('binding', { action: 'updateBinding', role, token: wx.getStorageSync('token'), bindingId: id, ...data })
  },
  deleteBinding: (id) => {
    const role = getCurrentRole()
    return callCloud('binding', { action: 'deleteBinding', role, token: wx.getStorageSync('token'), bindingId: id })
  }
}
// ── 今日提醒（已迁移至 reminders 云函数）─────────────────
const remindersAPI = {
  getTemplates: (elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'getTemplates', role, elderlyOpenid: elderlyOpenid || '' })
  },
  addTemplate: (data, elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'addTemplate', role, elderlyOpenid: elderlyOpenid || '', ...data })
  },
  updateTemplate: (id, d, elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'updateTemplate', role, elderlyOpenid: elderlyOpenid || '', templateId: id, ...d })
  },
  deleteTemplate: (id, elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'deleteTemplate', role, elderlyOpenid: elderlyOpenid || '', templateId: id })
  },
  batchDelete: (ids, elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'batchDelete', role, elderlyOpenid: elderlyOpenid || '', templateIds: ids })
  },
  getToday: (elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'getToday', role, elderlyOpenid: elderlyOpenid || '' })
  },
  toggleDone: (templateId, done, elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'toggleDone', role, elderlyOpenid: elderlyOpenid || '', templateId, done })
  },
  getAutoRemindSetting: (elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'getAutoRemindSetting', role, elderlyOpenid: elderlyOpenid || '' })
  },
  toggleAutoRemind: (enabled, elderlyOpenid) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'toggleAutoRemind', role, elderlyOpenid: elderlyOpenid || '', enabled })
  },
  triggerRemind: (templateId, elderlyOpenid, elderlyName) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'triggerRemind', role, elderlyOpenid: elderlyOpenid || '', templateId, elderlyName: elderlyName || '' })
  },
  sendSubscribeMsg: (templateId, elderlyOpenid, elderlyName) => {
    const role = getCurrentRole()
    return callCloud('reminders', { action: 'sendSubscribeMsg', role, elderlyOpenid: elderlyOpenid || '', templateId, elderlyName: elderlyName || '' })
  }
}
// ── SOS ───────────────────────────────────────────────
const sosAPI = {
  trigger: (data) => callCloud('sos', data)
}
// ── 统计 ──────────────────────────────────────────────
const statsAPI = {
  getStats: () => http.get('/stats')
}
// ── 语音识别 & 语音合成（asrTts 云函数）──────────────────
const speechAPI = {
  /**
   * 语音识别 ASR
   * @param {string} audioBase64 - base64 编码的音频数据
   * @param {string} language    - 语言，默认 'zh_cn'
   * @param {string} accent      - 方言accent，默认 'mandarin'
   */
  asr: (audioBase64, language = 'zh_cn', accent = 'mandarin') =>
    callCloud('asrTts', { type: 'asr', data: audioBase64, language, accent }),
  /**
   * 语音合成 TTS
   * @param {string} text      - 待合成文本
   * @param {string} language  - 语言，默认 'zh_cn'
   * @param {string} voiceName - 发音人，默认 'xiaoyan'
   */
  tts: (text, language = 'zh_cn', voiceName = 'xiaoyan') =>
    callCloud('asrTts', { type: 'tts', data: text, language, voiceName }),
}
module.exports = {
  authAPI,
  locationAPI,
  alertsAPI,
  chatAPI,
  memoryAPI,
  settingsAPI,
  bindingAPI,
  remindersAPI,
  sosAPI,
  statsAPI,
  speechAPI,
}