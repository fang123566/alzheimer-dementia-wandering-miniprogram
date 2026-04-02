// utils/amap.js
const AMAP_KEY = '4334064e1d33a0a68b2f33d33f48d5b3'
const BASE_URL = 'https://restapi.amap.com/v3'

function request(path, data = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${BASE_URL}${path}`,
      method: 'GET',
      data: {
        key: AMAP_KEY,
        ...data
      },
      success: (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`高德请求失败(${res.statusCode})`))
          return
        }
        if (res.data?.status !== '1') {
          reject(new Error(res.data?.info || '高德接口调用失败'))
          return
        }
        resolve(res.data)
      },
      fail: (err) => reject(err)
    })
  })
}

async function regeoDetail(latitude, longitude) {
  const res = await request('/geocode/regeo', {
    location: `${longitude},${latitude}`,
    extensions: 'all',
    radius: 1000,
    roadlevel: 0
  })

  const regeocode = res.regeocode || {}
  const comp = regeocode.addressComponent || {}
  const streetNumber = comp.streetNumber || {}

  return {
    formatted: regeocode.formatted_address || '',
    country: comp.country || '',
    province: comp.province || '',
    city: Array.isArray(comp.city) ? (comp.city[0] || '') : (comp.city || ''),
    district: comp.district || '',
    township: comp.township || '',
    street: streetNumber.street || '',
    streetNum: streetNumber.number || ''
  }
}

module.exports = {
  regeoDetail
}
