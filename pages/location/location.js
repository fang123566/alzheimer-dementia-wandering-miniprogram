// pages/location/location.js
const app = getApp()
const { locationAPI } = require('../../utils/api')

Page({
  data: {
    location: {},
    statusTag: 'tag-safe',
    statusText: '安全范围内',
    markers: [],
    polyline: [],
    circles: [],
    trajectory: [],
    fences: []
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this._fetchAll()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this._fetchAll()
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  async _fetchAll() {
    try {
      const [locRes, trajRes, fenceRes] = await Promise.all([
        locationAPI.getLocation(),
        locationAPI.getTrajectory(),
        locationAPI.getFences()
      ])

      if (locRes.code === 0) {
        const loc = locRes.data
        const statusMap = {
          safe:      { tag: 'tag-safe',    text: '安全范围内' },
          warning:   { tag: 'tag-warning', text: '轻微预警'  },
          emergency: { tag: 'tag-danger',  text: '紧急！'    }
        }
        const s = statusMap[loc.status] || statusMap['safe']
        this.setData({
          location: loc,
          statusTag: s.tag,
          statusText: s.text,
          markers: [{
            id: 1,
            latitude: loc.latitude,
            longitude: loc.longitude,
            title: app.globalData.elderlyInfo.name + '（当前）',
            width: 40, height: 40
          }]
        })
      }

      if (trajRes.code === 0) {
        const traj = trajRes.data
        this.setData({ trajectory: traj })
        if (traj.length >= 2) {
          const points = traj.map(t => ({
            latitude: t.latitude || locRes.data.latitude,
            longitude: t.longitude || locRes.data.longitude
          }))
          this.setData({
            polyline: [{ points, color: '#f5a623aa', width: 5, dottedLine: false }]
          })
        }
      }

      if (fenceRes.code === 0) {
        const circles = fenceRes.data
          .filter(f => f.enabled)
          .map(f => ({
            latitude: f.latitude,
            longitude: f.longitude,
            radius: f.radius,
            color: '#3ecfcf33',
            fillColor: '#3ecfcf11',
            strokeWidth: 2
          }))
        this.setData({ fences: fenceRes.data, circles })
      }
    } catch (e) {
      const loc = app.globalData.currentLocation
      if (loc) this.setData({ location: loc })
    }
  },

  addFence() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  }
})
