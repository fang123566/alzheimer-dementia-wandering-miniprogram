// pages/memory/memory.js
Page({
  data: {
    activeMember: 'all',
    members: [
      { id: 'all',  name: '全部',   avatar: '' },
      { id: 'm1',   name: '建国',   avatar: '/images/tab-home.png' },
      { id: 'm2',   name: '王丽',   avatar: '/images/tab-sos-active.png' },
      { id: 'm3',   name: '小孙女', avatar: '/images/tab-sos.png' }
    ],
    photos: [
      { id: 1, thumb: '/images/tab-sos.png', caption: '建国结婚那天，1998年', members: ['m1'] },
      { id: 2, thumb: '/images/tab-sos.png', caption: '全家去峨眉山，2010年', members: ['m1','m2','m3'] },
      { id: 3, thumb: '/images/tab-sos.png', caption: '小孙女满月', members: ['m3'] },
      { id: 4, thumb: '/images/tab-sos.png', caption: '',           members: ['m2'] }
    ],
    memoryHints: [
      { id: 1, text: '王叔，这是您儿子建国，在成都开公司，他每周末来看您。' },
      { id: 2, text: '这是您孙女小雨，今年上小学三年级，很喜欢唱歌。' },
      { id: 3, text: '您以前是小学语文老师，教了三十多年，学生都很喜欢您。' }
    ]
  },

  filterByMember(e) {
    this.setData({ activeMember: e.currentTarget.dataset.id })
    // TODO: 按成员筛选照片
  },

  viewPhoto(e) {
    // TODO: 查看照片详情 & 播放语音记忆
  },

  addPhoto() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      success(res) {
        // TODO: 上传图片 & 触发人脸识别标注
        console.log(res.tempFiles)
      }
    })
  }
})
