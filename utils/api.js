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

// ── 认证 ────────────────────────────────────────
const authAPI = {
  login:    (phone, password)       => http.post('/auth/login',    { phone, password }),
  register: (name, phone, password, role) => http.post('/auth/register', { name, phone, password, role }),
  logout:   ()                      => http.post('/auth/logout'),
  cancelAccount: ()                 => http.delete('/auth/account'),
  profile:  ()                      => http.get('/auth/profile')
}

// ── 位置（已迁移至微信云函数）────────────────────────────
const locationAPI = {
  getLocation:    ()     => callCloud('locationGetCurrent'),
  updateLocation: (data) => callCloud('locationUpdate', data),
  getTrajectory:  ()     => callCloud('locationTrajectory'),
  getFences:      ()     => callCloud('locationFences'),
  addFence:       (data)   => http.post('/location/fences', data),
  toggleFence:    (id, en) => http.patch(`/location/fences/${id}`, { enabled: en }),
  deleteFence:    (id)     => http.delete(`/location/fences/${id}`)
}

// ── 预警 ──────────────────────────────────────────────
const alertsAPI = {
  getAlerts:      (category) => http.get('/alerts', category ? { category } : {}),
  getUnreadCount: ()         => http.get('/alerts/unread-count'),
  createAlert:    (data)     => http.post('/alerts', data),
  markRead:       (id)       => http.patch(`/alerts/${id}/read`),
  deleteAlert:    (id)       => http.delete(`/alerts/${id}`)
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
    callCloud('aiChat', { action: 'getMemories' })
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
  getSettings:     ()     => http.get('/settings', {}, true),
  updateSettings:  (data) => http.put('/settings', data),
  updateElderly:   (data) => http.put('/settings/elderly', data),
  getContacts:     ()     => http.get('/settings/contacts'),
  addContact:      (data) => http.post('/settings/contacts', data),
  updateContact:   (id, d)=> http.put(`/settings/contacts/${id}`, d),
  deleteContact:   (id)   => http.delete(`/settings/contacts/${id}`),
  getKeywords:     ()     => http.get('/settings/keywords'),
  addKeyword:      (kw)   => http.post('/settings/keywords', { keyword: kw }),
  deleteKeyword:   (kw)   => http.delete(`/settings/keywords/${encodeURIComponent(kw)}`)
}

// ── 账号关联 ──────────────────────────────────────────
const bindingAPI = {
  getBinding:    ()            => http.get('/auth/binding'),
  getBindings:   ()            => http.get('/auth/binding'),
  createBinding: (linkedPhone, note) => http.post('/auth/binding', {
    linkedPhone,
    elderlyPhone: linkedPhone,
    familyPhone: linkedPhone,
    note
  }),
  updateBinding: (id, data)    => http.put(`/auth/binding/${id}`, data),
  deleteBinding: (id)          => http.delete(`/auth/binding/${id}`)
}

// ── 今日提醒 ───────────────────────────────────────────
const remindersAPI = {
  getTemplates:   ()        => http.get('/reminders/templates'),
  addTemplate:    (data)    => http.post('/reminders/templates', data),
  updateTemplate: (id, d)   => http.put(`/reminders/templates/${id}`, d),
  deleteTemplate: (id)      => http.delete(`/reminders/templates/${id}`),
  getToday:       ()        => http.get('/reminders/today'),
  markDone:       (id)      => http.post(`/reminders/${encodeURIComponent(id)}/done`),
  markUndone:     (id)      => http.post(`/reminders/${encodeURIComponent(id)}/undone`)
}

// ── SOS ───────────────────────────────────────────────
const sosAPI = {
  trigger: (data) => http.post('/sos', data)
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