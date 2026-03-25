// server/data/store.js
// 内存数据存储（模拟数据库），可替换为真实数据库

const store = {
  // 当前位置
  location: {
    latitude: 30.572815,
    longitude: 104.066803,
    address: '成都市锦江区东御街18号',
    status: 'safe', // safe / warning / emergency
    updatedAt: new Date().toISOString(),
    distance: 120
  },

  // 今日轨迹
  trajectory: [
    { id: 1, type: 'start',   time: '07:20', address: '家（出发）',           note: '' },
    { id: 2, type: 'normal',  time: '08:15', address: '社区早餐店',           note: '' },
    { id: 3, type: 'warning', time: '09:47', address: '锦江区东御街（越界）', note: '触发围栏预警' },
    { id: 4, type: 'normal',  time: '10:30', address: '社区公园',             note: '' },
    { id: 5, type: 'current', time: '14:32', address: '家附近（当前）',       note: '' }
  ],

  // 安全围栏
  fences: [
    { id: 1, name: '家（主围栏）', latitude: 30.572, longitude: 104.066, radius: 500, enabled: true },
    { id: 2, name: '社区公园',     latitude: 30.574, longitude: 104.068, radius: 300, enabled: true }
  ],

  // 预警记录
  alerts: [
    {
      id: 1, level: 'danger', type: '走失高危',
      time: new Date(Date.now() - 2 * 3600000).toISOString(),
      timeLabel: '今天 14:32', read: false,
      content: '老人超出安全围栏 500 米，当前位置：锦江区东御街，已停留 15 分钟',
      location: '成都市锦江区东御街',
      phone: '13800000001',
      category: 'lost'
    },
    {
      id: 2, level: 'danger', type: '防诈拦截',
      time: new Date(Date.now() - 5 * 3600000).toISOString(),
      timeLabel: '今天 11:07', read: false,
      content: '检测到高危诈骗话术：对话中出现"转账""中奖"关键词，AI 已介入安抚并拦截',
      location: '',
      phone: '13800000001',
      category: 'fraud'
    },
    {
      id: 3, level: 'warning', type: '围栏提醒',
      time: new Date(Date.now() - 24 * 3600000).toISOString(),
      timeLabel: '昨天 09:20', read: true,
      content: '老人离开社区公园围栏，朝东方向步行约 200 米',
      location: '社区公园东侧',
      phone: '',
      category: 'fence'
    },
    {
      id: 4, level: 'info', type: '用药提醒',
      time: new Date(Date.now() - 25 * 3600000).toISOString(),
      timeLabel: '昨天 08:00', read: true,
      content: 'AI 伴聊已提醒老人服用早上药物，老人确认回复',
      location: '',
      phone: '',
      category: 'health'
    }
  ],

  // 聊天记录
  chatHistory: [
    {
      id: 1, role: 'bot', botName: '小守',
      text: '王叔，早上好！今天天气不错，要不要出去走走？记得带好手机哦～',
      time: '08:00', isSoothe: false, isFraudAlert: false
    },
    {
      id: 2, role: 'user',
      text: '我不知道这是哪里啊',
      time: '09:47', emotionNote: '检测到语速急促、声音颤抖'
    },
    {
      id: 3, role: 'bot', botName: '小守 · 安抚模式',
      text: '王叔不用怕，我在这里陪您\n您就站在这里，建国马上就到～',
      time: '09:47', isSoothe: true, isFraudAlert: false
    }
  ],

  // 记忆相册
  photos: [
    {
      id: 1,
      type: 'image',
      thumb: '',
      url: '',
      cover: '',
      caption: '建国结婚那天，1998年',
      story: '那天家里特别热闹，亲戚朋友都来了，您一直笑得很开心。建国穿着西装，和新娘一起给长辈敬茶。',
      voiceNote: {
        url: '',
        duration: 0,
        text: '这是建国结婚那天，您高兴得一整天都没闲着。'
      },
      members: ['m1'],
      location: '成都',
      createdAt: '1998-06-15'
    },
    {
      id: 2,
      type: 'image',
      thumb: '',
      url: '',
      cover: '',
      caption: '全家去峨眉山，2010年',
      story: '这是全家第一次一起去峨眉山旅游，路上还下了点小雨，但大家都特别开心。',
      voiceNote: {
        url: '',
        duration: 0,
        text: '这一年我们一家人一起去了峨眉山，拍了很多照片。'
      },
      members: ['m1','m2','m3'],
      location: '峨眉山',
      createdAt: '2010-08-10'
    },
    {
      id: 3,
      type: 'video',
      thumb: '',
      url: '',
      cover: '',
      caption: '小孙女满月视频',
      story: '这是小孙女满月时录下的视频，大家围着她唱生日歌，场面特别温馨。',
      voiceNote: {
        url: '',
        duration: 0,
        text: '这是小孙女小时候满月时的视频，您那天一直抱着她。'
      },
      members: ['m3'],
      location: '家里',
      createdAt: '2018-03-20'
    },
    {
      id: 4,
      type: 'image',
      thumb: '',
      url: '',
      cover: '',
      caption: '一家人吃团圆饭',
      story: '',
      voiceNote: {
        url: '',
        duration: 0,
        text: ''
      },
      members: ['m2'],
      location: '家里',
      createdAt: '2022-01-05'
    }
  ],

  // 家庭成员
  members: [
    { id: 'm1', name: '建国',   relation: '儿子',  avatar: '' },
    { id: 'm2', name: '王丽',   relation: '女儿',  avatar: '' },
    { id: 'm3', name: '小孙女', relation: '孙女',  avatar: '' }
  ],

  // AI 记忆提示
  memoryHints: [
    { id: 1, text: '王叔，这是您儿子建国，在成都开公司，他每周末来看您。' },
    { id: 2, text: '这是您孙女小雨，今年上小学三年级，很喜欢唱歌。' },
    { id: 3, text: '您以前是小学语文老师，教了三十多年，学生都很喜欢您。' }
  ],

  // 设置
  settings: {
    dialect: '四川话',
    speechSpeed: '较慢（-30%）',
    sensitivity: '标准',
    notifyMethod: '电话 + 推送',
    nightMode: true,
    nightStart: '22:00',
    nightEnd: '06:00'
  },

  // 紧急联系人
  contacts: [
    { id: 1, avatar: '👨', relation: '儿子', name: '王建国', phone: '13800000001', priority: 1 },
    { id: 2, avatar: '👩', relation: '女儿', name: '王丽',   phone: '13900000002', priority: 2 }
  ],

  // 防诈关键词
  fraudKeywords: ['转账', '中奖', '公检法', '验证码', '保证金', '陌生账户', '刷单', '贷款'],

  // 老人信息
  elderly: {
    name: '王建明',
    age: 78,
    avatar: ''
  },

  // 家庭组信息
  family: {
    name: '王家',
    members: 4
  }
}

// 辅助：下一个自增 ID
store.nextId = function (list) {
  return list.length > 0 ? Math.max(...list.map(i => i.id)) + 1 : 1
}

module.exports = store
