// utils/request.js
// Promise 封装 wx.request，统一处理错误和 loading

// ⚠️ 真机调试时，把 localhost 换成你电脑的局域网 IP（如 192.168.1.x）
// 电脑 CMD 执行 ipconfig 查看 IPv4 地址
const BASE_URL = 'http://localhost:3000/api'
const ROOT_URL = BASE_URL.replace(/\/api$/, '')

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

function upload(path, filePath, name = 'file', formData = {}, loading = false) {
  if (loading) wx.showLoading({ title: '上传中…', mask: true })

  const token = wx.getStorageSync('token') || ''

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: BASE_URL + path,
      filePath,
      name,
      formData,
      header: {
        'Authorization': token ? `Bearer ${token}` : ''
      },
      success(res) {
        if (loading) wx.hideLoading()
        try {
          const data = JSON.parse(res.data || '{}')
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data)
          } else {
            const msg = data?.msg || `上传失败 (${res.statusCode})`
            wx.showToast({ title: msg, icon: 'none' })
            reject(new Error(msg))
          }
        } catch (e) {
          reject(new Error('上传返回数据解析失败'))
        }
      },
      fail() {
        if (loading) wx.hideLoading()
        const msg = '上传失败，请检查服务器'
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
  delete: (path, data, loading) => request(path, 'DELETE', data, loading),
  upload,
  BASE_URL,
  ROOT_URL
}

module.exports = http
