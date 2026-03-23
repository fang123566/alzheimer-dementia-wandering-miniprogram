// pages/location/location.js
const app = getApp()

Page({
  data: {
    location: {
      latitude: 30.572815,
      longitude: 104.066803,
      address: '成都市锦江区东御街18号',
      updatedAt: '14:32'
    },
    statusTag: 'tag-safe',
    statusText: '安全范围内',
    markers: [
      {
        id: 1,
        latitude: 30.572815,
        longitude: 104.066803,
        title: '王建明（当前）',
        iconPath: '/images/tab-sos.png',
        width: 40,
        height: 40
      }
    ],
    // 今日轨迹折线
    polyline: [
      {
        points: [
          { latitude: 30.571, longitude: 104.065 },
          { latitude: 30.572, longitude: 104.066 },
          { latitude: 30.572815, longitude: 104.066803 }
        ],
        color: '#f5a623aa',
        width: 5,
        dottedLine: false
      }
    ],
    // 安全围栏圆圈
    circles: [
      {
        latitude: 30.572,
        longitude: 104.066,
        radius: 500,
        color: '#3ecfcf33',
        fillColor: '#3ecfcf11',
        strokeWidth: 2
      }
    ],
    trajectory: [
      { id: 1, type: 'start',   time: '07:20', address: '家（出发）',          note: '' },
      { id: 2, type: 'normal',  time: '08:15', address: '社区早餐店',           note: '' },
      { id: 3, type: 'warning', time: '09:47', address: '锦江区东御街（越界）', note: '⚠️ 触发围栏预警' },
      { id: 4, type: 'normal',  time: '10:30', address: '社区公园',             note: '' },
      { id: 5, type: 'current', time: '14:32', address: '家附近（当前）',       note: '' }
    ]
  },

  onLoad() {
    // TODO: 从云端拉取实时位置
  },

  addFence() {
    wx.navigateTo({ url: '/pages/settings/settings?tab=fence' })
  }
})
