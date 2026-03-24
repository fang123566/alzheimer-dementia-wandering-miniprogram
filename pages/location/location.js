// pages/location/location.js
const app = getApp()
const { locationAPI } = require('../../utils/api')
const amap = require('../../utils/amap')

function getWxLocation(type = 'gcj02') {
  return new Promise((resolve, reject) => {
    wx.getLocation({ type, success: resolve, fail: reject })
  })
}

function getSetting() {
  return new Promise((resolve, reject) => {
    wx.getSetting({ success: resolve, fail: reject })
  })
}

function authorize(scope) {
  return new Promise((resolve, reject) => {
    wx.authorize({ scope, success: resolve, fail: reject })
  })
}

function openSetting() {
  return new Promise((resolve, reject) => {
    wx.openSetting({ success: resolve, fail: reject })
  })
}

Page({
  data: {
    role: 'family',
    location: {},
    statusTag: 'tag-safe',
    statusText: '安全范围内',
    markers: [],
    polyline: [],
    circles: [],
    trajectory: [],
    fences: [],
    locating: false,
    addrDetail: null
  },

  onLoad() {
    if (!getApp().checkLogin()) return
    this.setData({ role: app.globalData.role || 'family' })
    this._fetchAll()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this.setData({ role: app.globalData.role || 'family' })
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
        const loc = { ...locRes.data }
        const statusMap = {
          safe:      { tag: 'tag-safe',    text: '安全范围内' },
          warning:   { tag: 'tag-warning', text: '轻微预警'  },
          emergency: { tag: 'tag-danger',  text: '紧急！'    }
        }
        const s = statusMap[loc.status] || statusMap['safe']
        const elderlyName = app.globalData.elderlyInfo?.name || '老人'
        let addrDetail = null
        try {
          addrDetail = await amap.regeoDetail(loc.latitude, loc.longitude)
          if (addrDetail.formatted) loc.address = addrDetail.formatted
        } catch (e) {}
        app.globalData.currentLocation = loc
        this.setData({
          location: loc,
          statusTag: s.tag,
          statusText: s.text,
          addrDetail,
          markers: [{
            id: 1,
            latitude: loc.latitude,
            longitude: loc.longitude,
            title: elderlyName + '（当前）',
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

  async locate() {
    if (this.data.locating) return
    this.setData({ locating: true })

    if (this.data.role === 'family') {
      try {
        await this._fetchAll()
        wx.showToast({ title: '老人位置已刷新', icon: 'success' })
      } catch (e) {
        wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
      } finally {
        this.setData({ locating: false })
      }
      return
    }

    try {
      const hasPermission = await this._ensureLocationPermission()
      if (!hasPermission) {
        this.setData({ locating: false })
        return
      }

      const res = await getWxLocation('gcj02')
      const elderlyName = app.globalData.elderlyInfo?.name || '老人'
      let fallbackAddress = this.data.location.address || '当前位置'
      let addrDetail = null
      try {
        addrDetail = await amap.regeoDetail(res.latitude, res.longitude)
        if (addrDetail.formatted) fallbackAddress = addrDetail.formatted
      } catch (e) {}
      const updateRes = await locationAPI.updateLocation({
        latitude: res.latitude,
        longitude: res.longitude,
        address: fallbackAddress,
        battery: this.data.location.battery,
        distance: this.data.location.distance
      })

      if (updateRes.code === 0) {
        const loc = { ...updateRes.data }
        const statusMap = {
          safe:      { tag: 'tag-safe',    text: '安全范围内' },
          warning:   { tag: 'tag-warning', text: '轻微预警'  },
          emergency: { tag: 'tag-danger',  text: '紧急！'    }
        }
        const s = statusMap[loc.status] || statusMap['safe']
        if (addrDetail?.formatted) loc.address = addrDetail.formatted
        app.globalData.currentLocation = loc
        this.setData({
          location: loc,
          statusTag: s.tag,
          statusText: s.text,
          addrDetail,
          markers: [{
            id: 1,
            latitude: loc.latitude,
            longitude: loc.longitude,
            title: elderlyName + '（当前）',
            width: 40, height: 40
          }]
        })
        wx.showToast({ title: '位置已更新', icon: 'success' })
      }
    } catch (e) {
      wx.showToast({ title: '定位失败，请检查权限', icon: 'none' })
    } finally {
      this.setData({ locating: false })
    }
  },

  async _ensureLocationPermission() {
    try {
      const settingRes = await getSetting()
      const auth = settingRes.authSetting['scope.userLocation']

      if (auth === true) return true

      if (auth === undefined) {
        try {
          await authorize('scope.userLocation')
          return true
        } catch (e) {
          wx.showModal({
            title: '需要位置权限',
            content: '定位功能需要获取位置信息，请允许定位授权后重试。',
            showCancel: false
          })
          return false
        }
      }

      return await new Promise((resolve) => {
        wx.showModal({
          title: '定位权限未开启',
          content: '请在设置中开启位置权限，才能使用重新定位。',
          confirmText: '去设置',
          cancelText: '取消',
          success: async (res) => {
            if (!res.confirm) return resolve(false)
            try {
              const openRes = await openSetting()
              resolve(openRes.authSetting['scope.userLocation'] === true)
            } catch (e) {
              resolve(false)
            }
          }
        })
      })
    } catch (e) {
      wx.showToast({ title: '无法检查定位权限', icon: 'none' })
      return false
    }
  },

  addFence() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  }
})
