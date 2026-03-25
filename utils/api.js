// utils/api.js
// 所有接口调用的统一封装

const http = require('./request')

// ── 认证 ────────────────────────────────────────
const authAPI = {
  login:    (phone, password)       => http.post('/auth/login',    { phone, password }),
  register: (name, phone, password, role) => http.post('/auth/register', { name, phone, password, role }),
  logout:   ()                      => http.post('/auth/logout'),
  cancelAccount: ()                 => http.delete('/auth/account'),
  profile:  ()                      => http.get('/auth/profile')
}

// ── 位置 ──────────────────────────────────────────────
const locationAPI = {
  // 获取当前位置
  getLocation:    ()       => http.get('/location'),
  // 上报位置
  updateLocation: (data)   => http.post('/location', data),
  // 今日轨迹
  getTrajectory:  ()       => http.get('/location/trajectory'),
  // 安全围栏列表
  getFences:      ()       => http.get('/location/fences'),
  // 添加围栏
  addFence:       (data)   => http.post('/location/fences', data),
  // 切换围栏开关
  toggleFence:    (id, en) => http.patch(`/location/fences/${id}`, { enabled: en }),
  // 删除围栏
  deleteFence:    (id)     => http.delete(`/location/fences/${id}`)
}

// ── 预警 ──────────────────────────────────────────────
const alertsAPI = {
  // 获取全部预警，可选 category 筛选
  getAlerts:      (category) => http.get('/alerts', category ? { category } : {}),
  // 未读数量
  getUnreadCount: ()         => http.get('/alerts/unread-count'),
  // 新建预警
  createAlert:    (data)     => http.post('/alerts', data),
  // 标记已读
  markRead:       (id)       => http.patch(`/alerts/${id}/read`),
  // 删除预警
  deleteAlert:    (id)       => http.delete(`/alerts/${id}`)
}

// ── AI 伴聊 ───────────────────────────────────────────
const chatAPI = {
  // 获取聊天历史
  getHistory:  ()     => http.get('/chat/history', {}, true),
  // 发送消息
  sendMessage: (text) => http.post('/chat/message', { text }),
  // 清空记录
  clearHistory:()     => http.delete('/chat/history')
}

// ── 记忆相册 ──────────────────────────────────────────
const memoryAPI = {
  // 获取照片列表，可选 member 筛选
  getPhotos:    (member) => http.get('/memory/photos', member ? { member } : {}),
  // 获取单条记忆详情
  getPhoto:     (id)     => http.get(`/memory/photos/${id}`),
  // 上传媒体文件
  uploadMedia:  (filePath, mediaType) => http.upload('/memory/upload', filePath, 'file', { mediaType }, true),
  // 新增照片
  addPhoto:     (data)   => http.post('/memory/photos', data),
  // 更新照片说明/标注
  updatePhoto:  (id, d)  => http.put(`/memory/photos/${id}`, d),
  // 删除照片
  deletePhoto:  (id)     => http.delete(`/memory/photos/${id}`),
  // 家庭成员
  getMembers:   ()       => http.get('/memory/members'),
  addMember:    (data)   => http.post('/memory/members', data),
  updateMember: (id, d)   => http.put(`/memory/members/${id}`, d),
  deleteMember: (id)      => http.delete(`/memory/members/${id}`),
  // AI 记忆提示
  getHints:     ()       => http.get('/memory/hints'),
  addHint:      (text)   => http.post('/memory/hints', { text }),
  deleteHint:   (id)     => http.delete(`/memory/hints/${id}`)
}

// ── 设置 ──────────────────────────────────────────────
const settingsAPI = {
  // 获取全部设置
  getSettings:     ()     => http.get('/settings', {}, true),
  // 更新设置
  updateSettings:  (data) => http.put('/settings', data),
  // 更新老人信息
  updateElderly:   (data) => http.put('/settings/elderly', data),
  // 紧急联系人
  getContacts:     ()     => http.get('/settings/contacts'),
  addContact:      (data) => http.post('/settings/contacts', data),
  updateContact:   (id, d)=> http.put(`/settings/contacts/${id}`, d),
  deleteContact:   (id)   => http.delete(`/settings/contacts/${id}`),
  // 防诈关键词
  getKeywords:     ()     => http.get('/settings/keywords'),
  addKeyword:      (kw)   => http.post('/settings/keywords', { keyword: kw }),
  deleteKeyword:   (kw)   => http.delete(`/settings/keywords/${encodeURIComponent(kw)}`)
}

// ── 账号关联 ──────────────────────────────────────────
const bindingAPI = {
  getBinding:    ()            => http.get('/auth/binding'),
  createBinding: (elderlyPhone)=> http.post('/auth/binding', { elderlyPhone }),
  deleteBinding: ()            => http.delete('/auth/binding')
}

// ── SOS ───────────────────────────────────────────────
const sosAPI = {
  // 触发 SOS，携带当前位置
  trigger: (data) => http.post('/sos', data)
}

// ── 统计 ──────────────────────────────────────────────
const statsAPI = {
  getStats: () => http.get('/stats')
}

module.exports = {
  authAPI,
  locationAPI,
  alertsAPI,
  chatAPI,
  memoryAPI,
  settingsAPI,
  bindingAPI,
  sosAPI,
  statsAPI
}
