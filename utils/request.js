// utils/request.js
// Promise 封装 wx.request，统一处理错误和 loading

const BASE_URL = 'http://localhost:3000/api'

/**
 * 发起 HTTP 请求
 * @param {string} path     - 接口路径（不含 baseUrl），如 '/location'
 * @param {string} method   - 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
 * @param {object} data     - 请求体 / query 参数
 * @param {boolean} loading - 是否显示加载提示
 */
function request(path, method = 'GET', data = {}, loading = false) {
  if (loading) wx.showLoading({ title: '加载中…', mask: true })

  const token = wx.getStorageSync('token') || ''

  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      method,
      data,
      header: {
        'content-type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success(res) {
        if (loading) wx.hideLoading()
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data)
        } else {
          const msg = res.data?.msg || `请求失败 (${res.statusCode})`
          wx.showToast({ title: msg, icon: 'none' })
          reject(new Error(msg))
        }
      },
      fail(err) {
        if (loading) wx.hideLoading()
        const msg = '网络连接失败，请检查服务器'
        wx.showToast({ title: msg, icon: 'none' })
        reject(new Error(msg))
      }
    })
  })
}

const http = {
  get:    (path, data, loading) => request(path, 'GET',    data, loading),
  post:   (path, data, loading) => request(path, 'POST',   data, loading),
  put:    (path, data, loading) => request(path, 'PUT',    data, loading),
  patch:  (path, data, loading) => request(path, 'PATCH',  data, loading),
  delete: (path, data, loading) => request(path, 'DELETE', data, loading)
}

module.exports = http
