// server/data/store.js
// 内存数据存储（模拟数据库），可替换为真实数据库

const store = {
  // 当前位置
  location: {
    latitude: 0,
    longitude: 0,
    address: '',
    status: 'safe', // safe / warning / emergency
    updatedAt: new Date().toISOString(),
    distance: 0
  },

  // 今日轨迹
  trajectory: [],

  // 安全围栏
  fences: [],

  // 预警记录
  alerts: [],

  // 聊天记录
  chatHistory: [],

  // 记忆相册
  photos: [],

  // 家庭成员
  members: [],

  // AI 记忆提示
  memoryHints: [],

  // 设置
  settings: {
    dialect: '',
    speechSpeed: '',
    sensitivity: '',
    notifyMethod: '',
    nightMode: false,
    nightStart: '',
    nightEnd: ''
  },

  // 紧急联系人
  contacts: [],

  // 防诈关键词
  fraudKeywords: [],

  // 老人信息
  elderly: {
    name: '',
    age: '',
    avatar: ''
  },

  // 家庭组信息
  family: {
    name: '',
    members: 0
  }
}

// 辅助：下一个自增 ID
store.nextId = function (list) {
  return list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1
}

module.exports = store
