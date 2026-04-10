// pages/dialect/dialect.js
const app = getApp()
const { speechAPI } = require('../../utils/api')

// 翻译规则库（包含新增的上海话、闽南语、湖南话、湖北话、河南话）
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
      ['是吗', '是咋地'], ['好的', '行行行'], ['厉害', '老厉害了'],
      ['我不舒服', '俺难受'], ['需要帮助', '得有人搭把手'],
      ['我想回家', '俺想回家'], ['帮我打电话', '帮俺打个电话'],
      ['我饿了', '俺饿了'], ['我需要吃药', '俺得吃药'],
      ['我要去厕所', '俺要上厕所'], ['我想休息', '俺想歇会儿'],
      ['我很好', '俺可好了'], ['我', '俺']
    ],
    phonetic: '（儿化音丰富，声调平缓，语速偏快）'
  },
  '上海话': {
    map: [
      ['不知道', '勿晓得'], ['什么', '啥物事'], ['去哪里', '到啥地方去'],
      ['吃饭', '吃饭'], ['这里', '搿搭'], ['那里', '埃搭'],
      ['怎么了', '哪能了'], ['没有', '呒没'], ['很好', '交关好'],
      ['是吗', '是哦'], ['好的', '好个'], ['厉害', '结棍'],
      ['我不舒服', '我勿适意'], ['需要帮助', '需要人帮忙'],
      ['我想回家', '我想转去'], ['帮我打电话', '帮我打只电话'],
      ['我饿了', '我饿了'], ['我需要吃药', '我要吃藥'],
      ['我要去厕所', '我要上厕所'], ['我想休息', '我想休息歇'],
      ['我很好', '我交关好']
    ],
    phonetic: '（吴语太湖片，声调8个，轻声音节多）'
  },
  '闽南语': {
    map: [
      ['不知道', '毋捌'], ['什么', '啥物'], ['去哪里', '去叨位'],
      ['吃饭', '食饭'], ['这里', '遮'], ['那里', '遐'],
      ['怎么了', '按怎'], ['没有', '无'], ['很好', '真佳'],
      ['是吗', '是无'], ['好的', '好个'], ['厉害', '有够厉害'],
      ['我不舒服', '我袂爽'], ['需要帮助', '需要人帮忙'],
      ['我想回家', '我想倒转去'], ['帮我打电话', '帮我打支电话'],
      ['我饿了', '我腹肚饿'], ['我需要吃药', '我欲食药'],
      ['我要去厕所', '我欲去厕所'], ['我想休息', '我想歇睏'],
      ['我很好', '我真舒适']
    ],
    phonetic: '（泉漳片，声调7个，鼻化韵丰富）'
  },
  '湖南话': {
    map: [
      ['不知道', '不晓得'], ['什么', '么子'], ['去哪里', '克哪里'],
      ['吃饭', '恰饭'], ['这里', '咯里'], ['那里', '那里'],
      ['怎么了', '何什咯'], ['没有', '冇得'], ['很好', '蛮好'],
      ['是吗', '哦是吧'], ['好的', '要得'], ['厉害', '要得'],
      ['我不舒服', '我不舒糊'], ['需要帮助', '要人帮忙'],
      ['我想回家', '我想回克'], ['帮我打电话', '帮我打个电话'],
      ['我饿了', '我饿哒'], ['我需要吃药', '我要恰药'],
      ['我要去厕所', '我要上厕所'], ['我想休息', '我想歇哈'],
      ['我很好', '我蛮好']
    ],
    phonetic: '（长沙话，声调6个，入声归阳平）'
  },
  '湖北话': {
    map: [
      ['不知道', '不晓得'], ['什么', '么事'], ['去哪里', '克哪哈'],
      ['吃饭', '七饭'], ['这里', '这哈'], ['那里', '那哈'],
      ['怎么了', '搞么斯'], ['没有', '冇得'], ['很好', '蛮好'],
      ['是吗', '是撒'], ['好的', '要得'], ['厉害', '扎实'],
      ['我不舒服', '我不舒坦'], ['需要帮助', '要人帮忙'],
      ['我想回家', '我想回克'], ['帮我打电话', '帮我打个电话'],
      ['我饿了', '我饿哒'], ['我需要吃药', '我要七药'],
      ['我要去厕所', '我要上厕所'], ['我想休息', '我想歇哈'],
      ['我很好', '我蛮好']
    ],
    phonetic: '（武汉话，声调4个，儿化音少）'
  },
  '河南话': {
    map: [
      ['不知道', '不沾闲'], ['什么', '啥'], ['去哪里', '上哪去'],
      ['吃饭', '吃饭'], ['这里', '这搭'], ['那里', '那搭'],
      ['怎么了', '咋着了'], ['没有', '木有'], ['很好', '可得劲'],
      ['是吗', '是哩'], ['好的', '中'], ['厉害', '中'],
      ['我不舒服', '我不得劲'], ['需要帮助', '需要人帮忙'],
      ['我想回家', '我想回家'], ['帮我打电话', '帮我打个电话'],
      ['我饿了', '我饿了'], ['我需要吃药', '我得吃药'],
      ['我要去厕所', '我要上厕所'], ['我想休息', '我想歇会儿'],
      ['我很好', '我可得劲']
    ],
    phonetic: '（郑州话，声调4个，儿化音丰富）'
  }
}

// 方言→普通话反向规则
function buildReverse(dialectKey) {
  const rules = TO_DIALECT[dialectKey]
  if (!rules) return []
  return rules.map.map(([std, dia]) => [dia, std])
}

// 常用短语
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

// 完整方言列表（和翻译规则对应）
const DIALECTS = ['普通话', '四川话', '粤语', '东北话', '上海话', '闽南语', '湖南话', '湖北话', '河南话']

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
    history: [],
    // ========== 新增：弹窗相关变量（核心缺失项） ==========
    showDialectModal: false,   // 弹窗显隐（默认隐藏）
    selectLangType: 'from',    // 标记修改from/to
    currentSelectLang: '',     // 当前选中的方言
    dialectList: DIALECTS.map((name, index) => ({ id: index + 1, name })) // 方言列表赋值
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

  // ========== 核心修复：打开方言选择弹窗（改用data-type传参） ==========
  openDialectSelect(e) {
    // 从data-type获取类型（替代原有的class判断，更稳定）
    const type = e.currentTarget.dataset.type || 'from'
    // 赋值弹窗变量，显示弹窗
    this.setData({
      showDialectModal: true,
      selectLangType: type,
      currentSelectLang: type === 'from' ? this.data.dirFrom : this.data.dirTo
    })
  },

  // ========== 核心新增：关闭方言选择弹窗 ==========
  closeDialectModal() {
    this.setData({ showDialectModal: false })
  },

  // ========== 核心新增：阻止弹窗内容区点击冒泡（避免点选项关闭弹窗） ==========
  stopPropagation() {},

  // ========== 核心修复：选择方言并更新显示 ==========
  selectDialect(e) {
    const lang = e.currentTarget.dataset.lang
    const type = e.currentTarget.dataset.type
    if (!lang || !type) return; // 容错处理
    
    // 更新from/to方言
    const updateData = {}
    if (type === 'from') {
      updateData.dirFrom = lang
    } else {
      updateData.dirTo = lang
      updateData.dialect = lang // 同步更新dialect变量
    }
    // 关闭弹窗 + 更新数据
    this.setData({
      ...updateData,
      showDialectModal: false
    })
  },

  // 交换翻译方向
  swapDirection() {
    const { dirFrom, dirTo } = this.data
    // 交换from/to
    const newFrom = dirTo
    const newTo = dirFrom
    // 更新方向和输入/结果
    this.setData({
      dirFrom: newFrom,
      dirTo: newTo,
      direction: newFrom === '普通话' ? 'toDialect' : 'toPutonghua',
      inputText: this.data.result || '',
      result: '', 
      phonetic: ''
    })
  },

  // ========== 补充：录音开始（原代码缺失的实现） ==========
  // ========== 修复：开始录音（正确API + 强制WAV + 权限校验）
startRecord() {
    if (this.data.recording) return;
  
    // 1. 正确获取录音管理器（修复报错核心）
    this._recordAudio = wx.getRecorderManager();
  
    // 2. 先校验录音权限（小程序强制要求）
    wx.authorize({
      scope: 'scope.record',
      success: () => {
        // 3. 强制配置 WAV 格式录音
        this._recordAudio.start({
          format: 'wav',          // 核心：强制wav
          sampleRate: 16000,      // 采样率
          numberOfChannels: 1,    // 单声道
          //encodeBitRate: 96000,  // 码率
          duration: 60000         // 最长60秒
        });
  
        // 监听录音开始
        this.setData({ recording: true });
        wx.showToast({ title: '录音中...', icon: 'none' });
      },
      fail: () => {
        wx.showToast({ title: '请开启麦克风权限', icon: 'none' });
      }
    });
  
    // 监听录音错误
    this._recordAudio.onError((err) => {
      console.error('录音错误:', err);
      this.setData({ recording: false });
      wx.showToast({ title: '录音失败', icon: 'none' });
    });
  },
  
  // ========== 修复：结束录音
  stopRecord() {
    if (!this.data.recording || !this._recordAudio) return;
    
    this._recordAudio.stop();
    this.setData({ recording: false });
    wx.hideToast();
  
    // 监听录音完成，获取WAV文件
    this._recordAudio.onStop((res) => {
      console.log('录音文件(WAV):', res.tempFilePath);
      this.setData({ recordTempPath: res.tempFilePath });
      this._recognizeSpeech(res.tempFilePath);
    });
  },

  // 选择本地音频文件（测试用）
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

  // 语音识别
  _recognizeSpeech(tempFilePath) {
    wx.showLoading({ title: '识别中…', mask: true })

    wx.getFileSystemManager().readFile({
      filePath: tempFilePath,
      encoding: 'base64',
      success: async (fileRes) => {
        if (!fileRes.data || fileRes.data.length === 0) {
          wx.hideLoading()
          wx.showToast({ title: '音频数据为空', icon: 'none' })
          return
        }

        try {
          const accent = "mulacc"
          const res = await speechAPI.asr(fileRes.data, 'zh_cn', accent)
          wx.hideLoading()

          if (res.success) {
            this.setData({ inputText: res.data })
            this.translate()
          } else {
            wx.showToast({ title: res.message || '识别失败', icon: 'none' })
          }
        } catch (err) {
          wx.hideLoading()
          console.error('ASR 错误：', err)
          wx.showToast({ title: '识别失败，请重试', icon: 'none' })
        }
      },
      fail: (err) => {
        wx.hideLoading()
        console.error('读取音频失败：', err)
        wx.showToast({ title: '读取音频失败', icon: 'none' })
      }
    })
  },

  // 输入文本
  onInput(e) {
    this.setData({ inputText: e.detail.value })
  },

  // 翻译逻辑
  translate() {
    const text = this.data.inputText.trim()
    if (!text) {
      wx.showToast({ title: '请先输入或上传音频', icon: 'none' })
      return
    }
    this.setData({ loading: true })

    setTimeout(() => {
      const { dirFrom, dirTo } = this.data
      let result, phonetic
      const targetDialect = dirTo !== '普通话' ? dirTo : dirFrom

      // 判断翻译方向：普通话→方言 或 方言→普通话
      if (dirFrom === '普通话' && dirTo !== '普通话') {
        // 普通话转方言
        result   = this._applyRules(text, TO_DIALECT[targetDialect]?.map || [])
        phonetic = TO_DIALECT[targetDialect]?.phonetic || ''
      } else {
        // 方言转普通话
        result   = this._applyRules(text, buildReverse(targetDialect))
        phonetic = '（已还原为普通话表达）'
      }

      const item = {
        id: Date.now(),
        original: text,
        result,
        fromLang: dirFrom,
        toLang: dirTo
      }
      const history = [item, ...this.data.history].slice(0, 8)

      this.setData({ result, phonetic, loading: false, history })
      this._speak(result)
    }, 500)
  },

  // 应用翻译规则
  _applyRules(text, rules) {
    if (!rules || rules.length === 0) return text
    let out = text
    // 按匹配文本长度降序排序，避免短文本覆盖长文本
    const sorted = [...rules].sort((a, b) => b[0].length - a[0].length)
    for (const [from, to] of sorted) {
      // 全局替换
      out = out.replace(new RegExp(from, 'g'), to)
    }
    return out
  },

  // 语音合成
  async _speak(text) {
    if (!text) return

    if (this._audioContext) {
      this._audioContext.destroy()
      this._audioContext = null
    }

    wx.showLoading({ title: '合成中…', mask: true })

    try {
      const { dirTo } = this.data
      // 方言语音合成映射（根据方言选择对应音色）
      const voiceMap = {
        '四川话': 'x3_yezi_sc',
        '粤语': 'x3_xiaoyue',
        '东北话': 'x4_ziyang_oral',
        '上海话': 'x3_ziling',
        '闽南语': 'x3_linlin',
        '湖南话': 'x2_xiaoqiang',
        '湖北话': 'x2_xiaowang',
        '河南话': 'x2_xiaokun',
        '普通话': 'xiaoyan'
      }
      const voiceName = voiceMap[dirTo] || 'xiaoyan'

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
            wx.showToast({ title: '音频播放失败', icon: 'none' })
          })
        },
        fail: (err) => {
          console.error('音频写入失败:', err)
          wx.showToast({ title: '音频保存失败', icon: 'none' })
        }
      })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '合成失败', icon: 'none' })
      console.error('TTS 错误:', err)
    }
  },

  // 重播语音
  replay() {
    if (this.data.result) this._speak(this.data.result)
  },

  // 清空输入
  clearText() {
    this.setData({ inputText: '', result: '', phonetic: '' })
  },

  // 使用常用短语
  usePhrase(e) {
    const text = e.currentTarget.dataset.text
    this.setData({ inputText: text })
    setTimeout(() => this.translate(), 100)
  },

  // 使用历史记录
  useHistory(e) {
    this.setData({ inputText: e.currentTarget.dataset.text })
  },

  // 清空历史记录
  clearHistory() {
    this.setData({ history: [] })
    wx.showToast({ title: '历史记录已清空', icon: 'success' })
  }
})