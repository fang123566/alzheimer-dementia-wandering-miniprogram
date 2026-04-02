// pages/dialect/dialect.js
const app = getApp()

// ── 翻译规则库（普通话 → 各方言） ────────────────────────
const TO_DIALECT = {
  '四川话': {
    map: [
      ['不知道', '不晓得'], ['什么', '啥子'], ['去哪里', '走哪里切'],
      ['吃饭', '恰饭'], ['这里', '这哈'], ['那里', '那哈'],
      ['怎么了', '咋啦'], ['没有', '冇得'], ['很好', '安逸惨了'],
      ['是吗', '是哦'], ['好的', '要得'], ['厉害', '巴适得板'],
      ['我不舒服', '我难受惨了'], ['需要帮助', '要人帮'], ['我想回家', '我要回屋头'],
      ['帮我打电话', '帮我整个电话'], ['我饿了', '我饿惨了'],
      ['我需要吃药', '我要吃药了'], ['我要去厕所', '我要上茅厕'],
      ['我想休息', '我要歇哈'], ['我很好', '老子安逸得很']
    ],
    phonetic: '（发音偏平调，语速略快，儿化音少）'
  },
  '粤语': {
    map: [
      ['不知道', '唔知'], ['什么', '咩嘢'], ['去哪里', '去边度'],
      ['吃饭', '食饭'], ['这里', '呢度'], ['那里', '嗰度'],
      ['怎么了', '点解咁㗎'], ['没有', '冇'], ['很好', '好正'],
      ['是吗', '係咩'], ['好的', '好嘅'], ['厉害', '犀利'],
      ['我不舒服', '我唔舒服'], ['需要帮助', '需要人帮手'],
      ['我想回家', '我想返屋企'], ['帮我打电话', '帮我打个电话'],
      ['我饿了', '我肚饿'], ['我需要吃药', '我要食药'],
      ['我要去厕所', '我要去厕所'], ['我想休息', '我想休息下'],
      ['我很好', '我好好']
    ],
    phonetic: '（广州话，九声六调，注意平上去入各有阴阳）'
  },
  '东北话': {
    map: [
      ['不知道', '不知道整啥'], ['什么', '啥玩意'], ['去哪里', '上哪旮旯去'],
      ['吃饭', '整点吃的'], ['这里', '这旮旯'], ['那里', '那旮旯'],
      ['怎么了', '咋整啦'], ['没有', '没整'], ['很好', '老得劲了'],
      ['是吗', '是咋地'], ['好的', '行行行'], ['厉害', '老铁'],
      ['我不舒服', '俺难受'], ['需要帮助', '得有人搭把手'],
      ['我想回家', '俺想回家'], ['帮我打电话', '帮俺打个电话'],
      ['我饿了', '俺饿了'], ['我需要吃药', '俺得吃药'],
      ['我要去厕所', '俺要上厕所'], ['我想休息', '俺想歇会儿'],
      ['我很好', '俺可好了'], ['我', '俺']
    ],
    phonetic: '（儿化音丰富，声调平缓，语速偏快）'
  }
}

// ── 方言 → 普通话（反向规则） ────────────────────────────
function buildReverse(dialectKey) {
  const rules = TO_DIALECT[dialectKey]
  if (!rules) return []
  return rules.map.map(([std, dia]) => [dia, std])
}

const PHRASES = [
  { id: 1, emoji: '🏥', text: '我不舒服，需要帮助' },
  { id: 2, emoji: '🏠', text: '我想回家' },
  { id: 3, emoji: '📞', text: '帮我打电话给家人' },
  { id: 4, emoji: '🍚', text: '我饿了，想吃饭' },
  { id: 5, emoji: '💊', text: '我需要吃药' },
  { id: 6, emoji: '🚿', text: '我要去厕所' },
  { id: 7, emoji: '😴', text: '我想休息一下' },
  { id: 8, emoji: '😊', text: '我很好，不用担心' }
]

const DIALECTS = ['四川话', '粤语', '东北话']

Page({
  data: {
    dialect: '四川话',    // 当前选择的方言
    direction: 'toDialect', // 'toDialect' 普通话→方言 | 'toPutonghua' 方言→普通话
    dirFrom: '普通话',
    dirTo: '四川话',
    inputText: '',
    result: '',
    phonetic: '',
    loading: false,
    recording: false,
    phrases: PHRASES,
    history: []
  },

  onLoad() {
    if (!app.checkLogin()) return
    const settings = wx.getStorageSync('settings') || {}
    const dialect = settings.dialect || '四川话'
    this.setData({ dialect, dirTo: dialect })
    this._initRecorder()
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  onUnload() {
    if (this._recorder) {
      this._recorder.stop()
    }
  },

  // ── 录音初始化 ─────────────────────────────────────────
  _initRecorder() {
    const recorder = wx.getRecorderManager()
    this._recorder = recorder

    recorder.onStart(() => {
      this.setData({ recording: true })
    })

    recorder.onStop((res) => {
      this.setData({ recording: false })
      if (res.tempFilePath) {
        this._recognizeSpeech(res.tempFilePath)
      }
    })

    recorder.onError((err) => {
      this.setData({ recording: false })
      wx.showToast({ title: '录音失败，请重试', icon: 'none' })
      console.error('录音错误:', err)
    })
  },

  // ── 语音识别（模拟，接入云 ASR 后替换） ────────────────
  _recognizeSpeech(tempFilePath) {
    wx.showLoading({ title: '识别中…', mask: true })

    // TODO: 调用后端 /api/asr 上传音频，返回识别文字
    // 当前模拟：1.5 秒后提示用户手动确认
    setTimeout(() => {
      wx.hideLoading()
      wx.showToast({ title: '语音已录制，可手动补充', icon: 'none', duration: 2000 })
      // 实际接入示例：
      // wx.uploadFile({
      //   url: app.globalData.serverUrl + '/api/asr',
      //   filePath: tempFilePath,
      //   name: 'audio',
      //   success: (res) => {
      //     const { text } = JSON.parse(res.data)
      //     this.setData({ inputText: text })
      //     this.translate()
      //   }
      // })
    }, 1500)
  },

  startRecord() {
    if (this.data.recording) return
    this._recorder.start({
      duration: 30000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3'
    })
  },

  stopRecord() {
    if (!this.data.recording) return
    this._recorder.stop()
  },

  // ── 方言 / 方向切换 ────────────────────────────────────
  changeDialect() {
    wx.showActionSheet({
      itemList: DIALECTS,
      success: (res) => {
        const dialect = DIALECTS[res.tapIndex]
        const { direction } = this.data
        this.setData({
          dialect,
          dirFrom: direction === 'toDialect' ? '普通话' : dialect,
          dirTo:   direction === 'toDialect' ? dialect  : '普通话',
          result: '', phonetic: ''
        })
        wx.showToast({ title: `已选择${dialect}`, icon: 'none' })
      }
    })
  },

  swapDirection() {
    const { direction, dialect } = this.data
    const newDir = direction === 'toDialect' ? 'toPutonghua' : 'toDialect'
    this.setData({
      direction: newDir,
      dirFrom:   newDir === 'toDialect' ? '普通话' : dialect,
      dirTo:     newDir === 'toDialect' ? dialect  : '普通话',
      inputText: this.data.result || '',
      result: '', phonetic: ''
    })
  },

  // ── 翻译 ───────────────────────────────────────────────
  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  translate() {
    const text = this.data.inputText.trim()
    if (!text) {
      wx.showToast({ title: '请先输入或录音', icon: 'none' })
      return
    }
    this.setData({ loading: true })

    setTimeout(() => {
      const { direction, dialect } = this.data
      let result, phonetic

      if (direction === 'toDialect') {
        result   = this._applyRules(text, TO_DIALECT[dialect]?.map || [])
        phonetic = TO_DIALECT[dialect]?.phonetic || ''
      } else {
        result   = this._applyRules(text, buildReverse(dialect))
        phonetic = '（已还原为普通话表达）'
      }

      const item = {
        id: Date.now(),
        original: text,
        result,
        fromLang: this.data.dirFrom,
        toLang:   this.data.dirTo
      }
      const history = [item, ...this.data.history].slice(0, 8)

      this.setData({ result, phonetic, loading: false, history })
      this._speak(result)
    }, 500)
  },

  _applyRules(text, rules) {
    if (!rules || rules.length === 0) return text
    let out = text
    // 按词长降序排列，避免短词覆盖长词
    const sorted = [...rules].sort((a, b) => b[0].length - a[0].length)
    for (const [from, to] of sorted) {
      out = out.split(from).join(to)
    }
    return out
  },

  _speak(text) {
    // 接入 TTS 后替换此处（如腾讯云 TTS 或微信同声传译插件）
    wx.showToast({ title: '🔊 ' + text.slice(0, 10) + '…', icon: 'none', duration: 2000 })
  },

  replay() {
    if (this.data.result) this._speak(this.data.result)
  },

  clearText() {
    this.setData({ inputText: '', result: '', phonetic: '' })
  },

  usePhrase(e) {
    const text = e.currentTarget.dataset.text
    this.setData({ inputText: text })
    setTimeout(() => this.translate(), 100)
  },

  useHistory(e) {
    this.setData({ inputText: e.currentTarget.dataset.text })
  },

  clearHistory() {
    this.setData({ history: [] })
  }
})
