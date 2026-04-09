// pages/dialect/dialect.js
const app = getApp()
const { speechAPI } = require('../../utils/api')

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
      ['我要去厕所', '我要上厕所'], ['我想休息', '我想休息下'],
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

// ── 方言 → 讯飞 accent 参数映射 ──────────────────────────
const DIALECT_ACCENT_MAP = {
  '四川话': 'x3_yezi_sc',
  '粤语':   'x3_xiaoyue',
  '东北话': 'x4_ziyang_oral',
}

// ── 方言 → 讯飞 TTS 发音人映射 ───────────────────────────
const DIALECT_VOICE_MAP = {
  '四川话': 'x3_yezi_sc',
  '粤语':   'x3_xiaoyue',
  '东北话': 'x4_ziyang_oral',
}

Page({
  data: {
    dialect: '四川话',
    direction: 'toDialect',
    dirFrom: '普通话',
    dirTo: '四川话',
    inputText: '',
    result: '',
    phonetic: '',
    loading: false,
    recording: false,
    isPlayingRecord: false,
    recordTempPath: '',
    phrases: PHRASES,
    history: []
  },

  onLoad() {
    if (!app.checkLogin()) return
    const settings = wx.getStorageSync('settings') || {}
    const dialect = settings.dialect || '四川话'
    this.setData({ dialect, dirTo: dialect })
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init()
    }
  },

  onUnload() {
    if (this._recordAudio) {
      this._recordAudio.destroy()
      this._recordAudio = null
    }
    if (this._audioContext) {
      this._audioContext.destroy()
      this._audioContext = null
    }
  },

  // ==============================================
  // 【完整】按住录音（WAV格式）
  // ==============================================
  startRecord() {
    this.setData({ recording: true })
    const recorder = wx.getRecorderManager()
    this._recordAudio = recorder

    recorder.start({
      format: 'wav',
      sampleRate: 16000,
      encodeBitRate: 48000,
      audioChannels: 1
    })

    recorder.onStop((res) => {
      const path = res.tempFilePath
      this.setData({ recordTempPath: path, recording: false })
      this._recognizeSpeech(path)
    })
  },

  stopRecord() {
    if (this._recordAudio) {
      this._recordAudio.stop()
    }
  },

  // ==============================================
  // 新增：选择本地音频文件（测试专用）
  // ==============================================
  chooseLocalAudio() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['mp3', 'wav', 'pcm', 'aac'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].path
        console.log('选中音频文件路径：', tempFilePath)
        this.setData({ recordTempPath: tempFilePath })
        this._recognizeSpeech(tempFilePath)
      },
      fail: (err) => {
        console.error('选择文件失败：', err)
        wx.showToast({ title: '选择音频失败', icon: 'none' })
      }
    })
  },

  // ==============================================
  // 语音识别【修复：方言大模型mulacc参数】
  // ==============================================
  _recognizeSpeech(tempFilePath) {
    wx.showLoading({ title: '识别中…', mask: true })

    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      encoding: 'base64',
      success: async (fileRes) => {
        console.log('📂 音频读取成功，Base64长度：', fileRes.data?.length)

        if (!fileRes.data || fileRes.data.length === 0) {
          wx.hideLoading()
          wx.showToast({ title: '音频数据为空', icon: 'none' })
          return
        }

        try {
          // 云端语音对话（WAV → AI → WAV）
          wx.cloud.callFunction({
            name: 'aiChat',
            data: {
              action: 'speechChat',
              audioBase64: fileRes.data,
              dialect: this.data.dialect
            },
            success: (resp) => {
              wx.hideLoading()
              const res = resp.result
              if (res.code === 0) {
                this.setData({
                  inputText: res.data.userText,
                  result: res.data.botText
                })
                this.playReplyAudio(res.data.audioBase64)
                this.translate()
              } else {
                wx.showToast({ title: res.msg, icon: 'none' })
              }
            },
            fail: () => {
              wx.hideLoading()
              wx.showToast({ title: '语音对话失败', icon: 'none' })
            }
          })
        } catch (err) {
          wx.hideLoading()
          console.error('❌ ASR 错误：', err)
          wx.showToast({ title: '识别失败，请重试', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('❌ 读取音频失败：', err)
        wx.showToast({ title: '读取音频失败', icon: 'none' })
      }
    })
  },

  // ==============================================
  // 播放AI返回的WAV语音
  // ==============================================
  playReplyAudio(audioBase64) {
    const filePath = `${wx.env.USER_DATA_PATH}/reply_${Date.now()}.wav`
    wx.getFileSystemManager().writeFile({
      filePath,
      data: audioBase64,
      encoding: 'base64',
      success: () => {
        const audio = wx.createInnerAudioContext()
        this._audioContext = audio
        audio.src = filePath
        audio.obeyMuteSwitch = false
        audio.play()
      }
    })
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
      wx.showToast({ title: '请先输入或上传音频', icon: 'none' })
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

  // 修复BUG：for...in 改为 for...of
  _applyRules(text, rules) {
    if (!rules || rules.length === 0) return text
    let out = text
    const sorted = [...rules].sort((a, b) => b[0].length - a[0].length)
    for (const [from, to] of sorted) {
      out = out.split(from).join(to)
    }
    return out
  },

  // ==============================================
  // 语音合成
  // ==============================================
  async _speak(text) {
    if (!text) return

    if (this._audioContext) {
      this._audioContext.destroy()
      this._audioContext = null
    }

    wx.showLoading({ title: '合成中…', mask: true })

    try {
      const { dialect, direction } = this.data
      const voiceName = direction === 'toDialect'
        ? (DIALECT_VOICE_MAP[dialect] || 'x4_ziyang_oral')
        : 'xiaoyan'

      const res = await speechAPI.tts(text, 'zh_cn', voiceName)
      wx.hideLoading()

      if (!res.success) {
        wx.showToast({ title: res.message || '合成失败', icon: 'none' })
        return
      }

      const filePath = `${wx.env.USER_DATA_PATH}/tts_${Date.now()}.mp3`
      wx.getFileSystemManager().writeFile({
        filePath,
        data: res.data,
        encoding: 'base64',
        success: () => {
          const audio = wx.createInnerAudioContext()
          this._audioContext = audio
          audio.src = filePath
          audio.obeyMuteSwitch = false
          audio.play()

          audio.onError((err) => {
            console.error('播放失败:', err)
          })
        },
        fail: (err) => {
          console.error('音频写入失败:', err)
        }
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '合成失败', icon: 'none' })
      console.error('TTS 错误:', err)
    }
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