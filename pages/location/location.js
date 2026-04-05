// pages/location/location.js
const app = getApp()
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

// ── 云函数封装（替代 locationAPI 的四个接口）──────────────
function cloudGetLocation() {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'locationGetCurrent',
      success: res => resolve(res.result),
      fail: err => reject(new Error(err.errMsg || '云函数调用失败'))
    })
  })
}

function cloudUpdateLocation(data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'locationUpdate',
      data,
      success: res => resolve(res.result),
      fail: err => reject(new Error(err.errMsg || '云函数调用失败'))
    })
  })
}

function cloudGetTrajectory() {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'locationTrajectory',
      success: res => resolve(res.result),
      fail: err => reject(new Error(err.errMsg || '云函数调用失败'))
    })
  })
}

function cloudGetFences() {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'locationFences',
      success: res => resolve(res.result),
      fail: err => reject(new Error(err.errMsg || '云函数调用失败'))
    })
  })
}

Page({
  data: {
    role: 'family',
    location: {
      latitude: 30.572815,
      longitude: 104.066803,
      address: '正在获取位置…',
      status: 'safe',
      updatedAt: ''
    },
    statusTag: 'tag-safe',
    statusText: '安全范围内',
    markers: [],
    polyline: [],
    circles: [],
    trajectory: [],
    fences: [],
    locating: false,
    addrDetail: null,
    noLocationData: false,
    showFenceRule: false,
    timeStale: false,
    displayTime: '',
    // 历史轨迹相关
    histTrajMode: false,
    showHistPicker: false,
    histRange: 'today',
    histStartDate: '',
    histEndDate: '',
    histLoading: false,
    showStopPopup: false,
    stopDetail: {},
    // 备份实时数据，退出历史模式时恢复
    _realtimePolyline: [],
    _realtimeMarkers: []
  },

  _loaded: false,

  onLoad() {
    if (!getApp().checkLogin()) return
    // 用 globalData 缓存初始化地图，保证地图立即可见
    const cached = app.globalData.currentLocation
    if (cached && cached.latitude) {
      this.setData({
        location: cached,
        markers: [{
          id: 1, latitude: cached.latitude, longitude: cached.longitude,
          title: '上次位置', width: 40, height: 40
        }]
      })
    }
    this.setData({ role: app.globalData.role || 'family' })
    this._loaded = true
    this._fetchAll()
  },

  onShow() {
    if (!getApp().checkLogin()) return
    this.setData({ role: app.globalData.role || 'family' })
    if (this._loaded) {
      this._fetchAll()
    }
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
    // 启动自动追踪
    this._startAutoTracking()
  },

  onHide() {
    this._stopAutoTracking()
  },

  onUnload() {
    this._stopAutoTracking()
  },

  async _fetchAll() {
    this._lastFetchOk = false
    try {
      const [locRes, trajRes, fenceRes] = await Promise.all([
        cloudGetLocation().catch(e => ({ code: -1, msg: e.message })),
        cloudGetTrajectory().catch(e => ({ code: -1, msg: e.message })),
        cloudGetFences().catch(e => ({ code: -1, msg: e.message }))
      ])

      console.log('[位置] locRes:', JSON.stringify(locRes))
      console.log('[位置] trajRes:', JSON.stringify(trajRes))
      console.log('[位置] fenceRes:', JSON.stringify(fenceRes))

      let locData = null
      if (locRes.code === 0 && locRes.data) {
        this._lastFetchOk = true
        this.setData({ noLocationData: false })
        const loc = { ...locRes.data }
        locData = loc
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
        // 优先使用服务端计算的超时状态，避免日期解析问题
        if (typeof loc.isStale === 'boolean') {
          this._applyServerStale(loc)
        } else {
          this._updateTimeDisplay(loc.updatedAt)
        }
      } else {
        // 云函数返回异常，给出提示
        const errMsg = locRes.msg || '获取位置失败'
        console.warn('[位置] 获取位置失败:', errMsg)
        this.setData({ noLocationData: true })
        wx.showToast({ title: errMsg, icon: 'none', duration: 3000 })
        // 使用缓存位置兜底
        const cached = app.globalData.currentLocation
        if (cached && cached.latitude) {
          locData = cached
          this.setData({
            location: cached,
            markers: [{
              id: 1, latitude: cached.latitude, longitude: cached.longitude,
              title: '上次位置', width: 40, height: 40
            }]
          })
        }
      }

      if (trajRes.code === 0 && trajRes.data) {
        const traj = trajRes.data
        this.setData({ trajectory: traj })
        if (traj.length >= 2) {
          const points = traj.map(t => ({
            latitude: t.latitude || (locData ? locData.latitude : 30.5),
            longitude: t.longitude || (locData ? locData.longitude : 114.3)
          }))
          this.setData({
            polyline: [{ points, color: '#f5a623aa', width: 5, dottedLine: false }]
          })
        }
      }

      if (fenceRes.code === 0 && fenceRes.data) {
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
        // 先获取当前设备 GPS，上报到云端更新老人位置
        const hasPermission = await this._ensureLocationPermission()
        if (hasPermission) {
          const gps = await getWxLocation('gcj02')
          let addr = ''
          try {
            const detail = await amap.regeoDetail(gps.latitude, gps.longitude)
            if (detail && detail.formatted) addr = detail.formatted
          } catch (e) {}
          await cloudUpdateLocation({
            latitude: gps.latitude,
            longitude: gps.longitude,
            address: addr,
            distance: 0
          }).catch(e => console.warn('[位置] 家属代替上报失败:', e))
        }
        // 然后拉取最新数据展示
        await this._fetchAll()
        if (this._lastFetchOk) {
          wx.showToast({ title: '老人位置已刷新', icon: 'success' })
        } else {
          wx.showToast({ title: '刷新失败，请稍后重试', icon: 'none' })
        }
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

      const updateRes = await cloudUpdateLocation({
        latitude: res.latitude,
        longitude: res.longitude,
        address: fallbackAddress,
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
        // 老人端刚更新，用当前时间刷新显示
        this._updateTimeDisplay(new Date().toISOString())
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

  // ══════════════════════════════════════════
  // 自动位置追踪（老人端上报）
  // ══════════════════════════════════════════

  _startAutoTracking() {
    this._stopAutoTracking()
    if (this.data.role === 'elderly') {
      this._startElderlyTracking()
    }
  },

  _stopAutoTracking() {
    // 清除老人端降级轮询定时器
    if (this._elderlyFallbackTimer) {
      clearInterval(this._elderlyFallbackTimer)
      this._elderlyFallbackTimer = null
    }
    // 停止老人端位置监听
    if (this._elderlyTracking) {
      wx.stopLocationUpdate({
        success: () => console.log('[位置] 已停止位置监听'),
        fail: () => {}
      })
      wx.offLocationChange()
      this._elderlyTracking = false
    }
  },

  // ── 老人端：开启实时位置上报 ──────────────────
  _startElderlyTracking() {
    const self = this
    this._lastReportTime = 0
    wx.startLocationUpdate({
      success() {
        console.log('[位置] 老人端位置监听已开启')
        self._elderlyTracking = true
        wx.onLocationChange(function (res) {
          self._onElderlyLocationChange(res)
        })
      },
      fail(err) {
        console.warn('[位置] 开启位置监听失败:', err)
        // 降级：每 30 秒主动获取一次
        self._elderlyFallbackTimer = setInterval(() => {
          self._elderlyFallbackReport()
        }, 30000)
        // 先立即获取一次
        self._elderlyFallbackReport()
      }
    })
  },

  // 老人端位置变化回调（节流：至少 15 秒上报一次）
  _onElderlyLocationChange(res) {
    const now = Date.now()
    if (now - this._lastReportTime < 15000) return
    this._lastReportTime = now
    this._reportElderlyLocation(res.latitude, res.longitude)
  },

  // 老人端降级：主动获取位置并上报
  async _elderlyFallbackReport() {
    try {
      const res = await getWxLocation('gcj02')
      this._reportElderlyLocation(res.latitude, res.longitude)
    } catch (e) {
      console.warn('[位置] 降级定位失败:', e)
    }
  },

  // 老人端位置上报到云端
  async _reportElderlyLocation(latitude, longitude) {
    try {
      let address = this.data.location.address || '当前位置'
      try {
        const addrDetail = await amap.regeoDetail(latitude, longitude)
        if (addrDetail && addrDetail.formatted) address = addrDetail.formatted
      } catch (e) {}

      const updateRes = await cloudUpdateLocation({
        latitude, longitude, address,
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
        loc.address = address
        app.globalData.currentLocation = loc
        const elderlyName = app.globalData.elderlyInfo?.name || '老人'
        this.setData({
          location: loc,
          statusTag: s.tag,
          statusText: s.text,
          markers: [{
            id: 1, latitude: loc.latitude, longitude: loc.longitude,
            title: elderlyName + '（当前）', width: 40, height: 40
          }]
        })
        this._updateTimeDisplay(new Date().toISOString())
      }
    } catch (e) {
      console.warn('[位置] 自动上报失败:', e)
    }
  },

  // ── 使用服务端计算的超时状态（最可靠） ──────────────
  _applyServerStale(loc) {
    const stale = loc.isStale
    const pad = n => String(n).padStart(2, '0')
    let displayTime = '暂无'
    if (loc.updatedAt) {
      try {
        const t = new Date(loc.updatedAt)
        if (!isNaN(t.getTime())) {
          displayTime = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
        }
      } catch (e) {}
    }
    const update = { displayTime, timeStale: stale }
    if (stale) {
      update.statusTag = 'tag-danger'
      update.statusText = loc.minutesAgo >= 0 ? `定位超时(${loc.minutesAgo}分钟前)` : '定位异常'
    }
    console.log('[位置] 服务端超时判断: isStale=', stale, 'minutesAgo=', loc.minutesAgo, 'updatedAt=', loc.updatedAt)
    this.setData(update)
  },

  // ── 时间展示与超时检测（客户端降级） ──────────────────
  _updateTimeDisplay(updatedAt) {
    if (!updatedAt) {
      this.setData({ displayTime: '暂无', timeStale: false })
      return
    }
    // 兼容 Cloud DB serverDate 返回的多种格式
    let t
    if (updatedAt instanceof Date) {
      t = updatedAt
    } else if (typeof updatedAt === 'number') {
      t = new Date(updatedAt)
    } else if (typeof updatedAt === 'object' && updatedAt.$date) {
      t = new Date(updatedAt.$date)
    } else {
      t = new Date(updatedAt)
    }
    if (isNaN(t.getTime())) {
      this.setData({ displayTime: String(updatedAt), timeStale: false })
      return
    }
    const now = Date.now()
    const diffMin = (now - t.getTime()) / 60000
    const stale = diffMin > 10
    const pad = n => String(n).padStart(2, '0')
    const formatted = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
    const update = { displayTime: formatted, timeStale: stale }
    if (stale) {
      update.statusTag = 'tag-danger'
      update.statusText = '定位异常'
    }
    this.setData(update)
  },

  // ── 复制地址到剪贴板 ──────────────────────────
  copyAddress() {
    const addr = this.data.location.address
    if (!addr || addr === '正在获取位置…' || addr === '暂无地址信息') {
      wx.showToast({ title: '暂无可复制的地址', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: addr,
      success: () => wx.showToast({ title: '地址已复制', icon: 'success' })
    })
  },

  // ── 安全状态标签点击 → 展开/收起围栏规则说明 ──────
  onStatusTagTap() {
    this.setData({ showFenceRule: !this.data.showFenceRule })
  },

  // ── 地址标签点击 → 筛选对应区域的历史轨迹 ──────
  onAddrTagTap(e) {
    const { tag, value } = e.currentTarget.dataset
    if (!value) return
    const filtered = (this.data.trajectory || []).filter(item => {
      return (item.address || '').indexOf(value) !== -1
    })
    if (filtered.length === 0) {
      wx.showToast({ title: `未找到「${value}」相关轨迹`, icon: 'none' })
      return
    }
    wx.showToast({ title: `已筛选「${value}」${filtered.length} 条轨迹`, icon: 'none' })
    // 高亮匹配的轨迹点
    if (filtered.length >= 2) {
      const points = filtered.map(t => ({
        latitude: t.latitude, longitude: t.longitude
      })).filter(p => p.latitude && p.longitude)
      if (points.length >= 2) {
        this.setData({
          polyline: [{ points, color: '#2a9d6ecc', width: 6, dottedLine: false }]
        })
      }
    }
  },

  // ── 更新时间点击 → 查看位置更新历史 ──────────
  onTimeTap() {
    const traj = this.data.trajectory || []
    if (traj.length === 0) {
      wx.showToast({ title: '暂无位置更新记录', icon: 'none' })
      return
    }
    const items = traj.slice(0, 10).map(t => {
      const time = t.recordedAt ? new Date(t.recordedAt).toLocaleTimeString() : (t.time || '')
      return `${time}  ${t.address || '未知位置'}`
    })
    wx.showActionSheet({
      itemList: items.length > 6 ? items.slice(0, 6) : items,
      fail: () => {}
    })
  },

  // ── 围栏开关快速切换 ──────────────────────────
  toggleFence(e) {
    const { id, index } = e.currentTarget.dataset
    const fences = this.data.fences
    if (!fences || !fences[index]) return
    const newEnabled = !fences[index].enabled
    const key = `fences[${index}].enabled`
    this.setData({ [key]: newEnabled })

    // 同步更新地图 circles
    const circles = fences
      .map((f, i) => ({ ...f, enabled: i === index ? newEnabled : f.enabled }))
      .filter(f => f.enabled)
      .map(f => ({
        latitude: f.latitude,
        longitude: f.longitude,
        radius: f.radius,
        color: '#3ecfcf33',
        fillColor: '#3ecfcf11',
        strokeWidth: 2
      }))
    this.setData({ circles })

    // 调用云函数持久化
    wx.cloud.callFunction({
      name: 'locationFences',
      data: { action: 'toggle', fenceId: id, enabled: newEnabled }
    }).then(() => {
      wx.showToast({ title: newEnabled ? '围栏已开启' : '围栏已关闭', icon: 'success' })
    }).catch(() => {
      this.setData({ [key]: !newEnabled })
      wx.showToast({ title: '操作失败，请重试', icon: 'none' })
    })
  },

  // ── 点击围栏项 → 跳转编辑页 ──────────────────
  editFence(e) {
    const { id } = e.currentTarget.dataset
    wx.navigateTo({ url: `/pages/settings/settings?fenceId=${id}` })
  },

  addFence() {
    wx.navigateTo({ url: '/pages/settings/settings?action=addFence' })
  },

  // ══════════════════════════════════════════
  // 历史轨迹功能
  // ══════════════════════════════════════════

  onHistTrajTap() {
    if (this.data.histTrajMode) {
      this.setData({
        histTrajMode: false,
        showHistPicker: false,
        showStopPopup: false,
        markers: this.data._realtimeMarkers,
        polyline: this.data._realtimePolyline
      })
      wx.showToast({ title: '已退出历史轨迹', icon: 'none' })
      return
    }
    const pad = n => String(n).padStart(2, '0')
    const now = new Date()
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    this.setData({
      showHistPicker: true,
      histRange: 'today',
      histStartDate: todayStr,
      histEndDate: todayStr,
      _realtimeMarkers: this.data.markers,
      _realtimePolyline: this.data.polyline
    })
  },

  closeHistPicker() {
    this.setData({ showHistPicker: false })
  },

  onHistShortcut(e) {
    const range = e.currentTarget.dataset.range
    const pad = n => String(n).padStart(2, '0')
    const now = new Date()
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    const todayStr = fmt(now)
    let start = todayStr
    let end = todayStr
    if (range === 'yesterday') {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      start = fmt(y)
      end = fmt(y)
    } else if (range === 'week') {
      const w = new Date(now)
      w.setDate(w.getDate() - 6)
      start = fmt(w)
    }
    this.setData({ histRange: range, histStartDate: start, histEndDate: end })
  },

  onHistStartChange(e) {
    this.setData({ histStartDate: e.detail.value })
  },

  onHistEndChange(e) {
    this.setData({ histEndDate: e.detail.value })
  },

  async loadHistTrajectory() {
    if (this.data.histLoading) return
    const { histStartDate, histEndDate } = this.data
    if (!histStartDate || !histEndDate) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return
    }
    this.setData({ histLoading: true })
    try {
      const res = await new Promise((resolve, reject) => {
        wx.cloud.callFunction({
          name: 'locationTrajectory',
          data: { startDate: histStartDate, endDate: histEndDate },
          success: r => resolve(r.result),
          fail: err => reject(err)
        })
      })
      if (res.code !== 0 || !res.data || res.data.length === 0) {
        wx.showToast({ title: '该时段暂无轨迹数据', icon: 'none' })
        this.setData({ histLoading: false })
        return
      }
      const trajData = res.data
      const fences = this.data.fences || []
      const normalPoints = []
      const breachPoints = []
      const stopMarkers = []
      let markerId = 100
      trajData.forEach((pt, idx) => {
        if (!pt.latitude || !pt.longitude) return
        const coord = { latitude: pt.latitude, longitude: pt.longitude }
        const isOutside = this._isOutsideFences(coord, fences)
        if (isOutside) {
          breachPoints.push(coord)
          if (normalPoints.length > 0) normalPoints.push(coord)
        } else {
          normalPoints.push(coord)
          if (breachPoints.length > 0) breachPoints.push(coord)
        }
        if (idx > 0 && pt.stayMinutes && pt.stayMinutes >= 5) {
          const pad2 = n => String(n).padStart(2, '0')
          const arrive = pt.arriveAt ? new Date(pt.arriveAt) : null
          const leave = pt.leaveAt ? new Date(pt.leaveAt) : null
          stopMarkers.push({
            id: markerId++,
            latitude: pt.latitude,
            longitude: pt.longitude,
            title: pt.address || '停留点',
            width: 28,
            height: 28,
            callout: {
              content: `停留 ${pt.stayMinutes} 分钟`,
              display: 'ALWAYS',
              fontSize: 12,
              borderRadius: 8,
              padding: 6,
              bgColor: '#fffbeb',
              color: '#92400e'
            },
            _stopDetail: {
              address: pt.address || '未知位置',
              duration: this._formatDuration(pt.stayMinutes),
              arriveTime: arrive ? `${pad2(arrive.getHours())}:${pad2(arrive.getMinutes())}` : '--',
              leaveTime: leave ? `${pad2(leave.getHours())}:${pad2(leave.getMinutes())}` : '--'
            }
          })
        }
      })
      const polylines = []
      if (normalPoints.length >= 2) {
        polylines.push({ points: normalPoints, color: '#38a169cc', width: 6, dottedLine: false })
      }
      if (breachPoints.length >= 2) {
        polylines.push({ points: breachPoints, color: '#e53935cc', width: 6, dottedLine: false })
      }
      this._stopMarkersData = stopMarkers
      this.setData({
        histTrajMode: true,
        showHistPicker: false,
        histLoading: false,
        polyline: polylines,
        markers: stopMarkers
      })
      const allPts = [...normalPoints, ...breachPoints]
      if (allPts.length > 0) {
        const mapCtx = wx.createMapContext('elderlyMap', this)
        mapCtx.includePoints({ points: allPts, padding: [60, 60, 60, 60] })
      }
      wx.showToast({ title: `已加载 ${trajData.length} 条轨迹`, icon: 'success' })
    } catch (e) {
      console.error('[历史轨迹] 加载失败:', e)
      wx.showToast({ title: '加载失败，请重试', icon: 'none' })
      this.setData({ histLoading: false })
    }
  },

  _isOutsideFences(coord, fences) {
    if (!fences || fences.length === 0) return false
    const enabledFences = fences.filter(f => f.enabled)
    if (enabledFences.length === 0) return false
    for (const f of enabledFences) {
      if (!f.latitude || !f.longitude || !f.radius) continue
      const dist = this._calcDistance(coord.latitude, coord.longitude, f.latitude, f.longitude)
      if (dist <= f.radius) return false
    }
    return true
  },

  _calcDistance(lat1, lng1, lat2, lng2) {
    const rad = Math.PI / 180
    const dLat = (lat2 - lat1) * rad
    const dLng = (lng2 - lng1) * rad
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  },

  _formatDuration(minutes) {
    if (!minutes || minutes < 1) return '不到 1 分钟'
    if (minutes < 60) return `${minutes} 分钟`
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h} 小时 ${m} 分钟` : `${h} 小时`
  },

  onMarkerTap(e) {
    if (!this.data.histTrajMode) return
    const markerId = e.markerId || e.detail?.markerId
    const markers = this._stopMarkersData || []
    const found = markers.find(m => m.id === markerId)
    if (found && found._stopDetail) {
      this.setData({ showStopPopup: true, stopDetail: found._stopDetail })
    }
  },

  closeStopPopup() {
    this.setData({ showStopPopup: false })
  }
})