// 云函数入口文件
const cloud = require('wx-server-sdk')
const WebSocket = require('ws')
const crypto = require('crypto')
const config = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 讯飞鉴权 URL 生成
function getXfyunAuthUrl(host, path, apiKey, apiSecret, method = 'GET') {
    const date = new Date().toUTCString()
    const signatureOrigin = `host: ${host}\ndate: ${date}\n${method} ${path} HTTP/1.1`
    const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64')
    const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
    const authorization = Buffer.from(authorizationOrigin).toString('base64')
    return `wss://${host}${path}?authorization=${encodeURIComponent(authorization)}&date=${encodeURIComponent(date)}&host=${encodeURIComponent(host)}`
}

// ==================== 千问ASR（DashScope WebSocket 协议规范格式） ====================
async function asrRecognize(base64Audio) {
  return new Promise((resolve, reject) => {
    const apiKey = config.DASHSCOPE_API_KEY
    const taskId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')

    const wsUrl = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
    const audioBuffer = Buffer.from(base64Audio, 'base64')

    const ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `bearer ${apiKey}`,
        'X-DashScope-DataInspection': 'enable'
      }
    })

    let finalText = ''
    let taskStarted = false
    const timer = setTimeout(() => { ws.close(); resolve('未识别到语音') }, 15000)

    ws.on('open', () => {
      console.log('[ASR] 连接成功，发送 run-task 指令')
      // Step 1: 发送 run-task 指令
      ws.send(JSON.stringify({
        header: {
          action: 'run-task',
          task_id: taskId,
          streaming: 'duplex'
        },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: 'fun-asr-realtime-2026-02-28',
          parameters: {
            format: 'wav',
            sample_rate: 16000,
            language_hints: ['zh', 'en']
          },
          input: {}
        }
      }))
    })

    ws.on('message', (data) => {
      const res = JSON.parse(data)
      console.log('[ASR] 接收结果:', JSON.stringify(res))

      const event = res.header?.event

      if (event === 'task-started') {
        taskStarted = true
        console.log('[ASR] 任务已启动，开始发送音频数据')
        // Step 2: 发送音频数据
        ws.send(audioBuffer)
        // Step 3: 发送 finish-task 指令
        ws.send(JSON.stringify({
          header: {
            action: 'finish-task',
            task_id: taskId,
            streaming: 'duplex'
          },
          payload: { input: {} }
        }))
      } else if (event === 'result-generated') {
        const sentence = res.payload?.output?.sentence
        if (sentence?.text) {
          finalText = sentence.text
          console.log('[ASR] 识别文本:', finalText)
        }
      } else if (event === 'task-finished') {
        clearTimeout(timer)
        ws.close()
        resolve(finalText || '未识别到语音')
      } else if (event === 'task-failed') {
        clearTimeout(timer)
        ws.close()
        reject(new Error(res.header?.error_message || 'ASR任务失败'))
      }
    })

    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err.message)
    })
  })
}

// ==================== 讯飞TTS ====================
async function ttsSynthesize(text, language = 'zh_cn', voiceName = 'xiaoyan', cfg) {
    return new Promise((resolve, reject) => {
        const host = 'tts-api.xfyun.cn'
        const path = '/v2/tts'
        const authUrl = getXfyunAuthUrl(host, path, cfg.API_KEY, cfg.API_SECRET)
        const ws = new WebSocket(authUrl)
        const audioBuffer = []

        const timeout = setTimeout(() => { ws.close(); reject(new Error('TTS超时')) }, 15000)

        ws.on('open', () => {
            ws.send(JSON.stringify({
                common: { app_id: cfg.APPID },
                business: { aue: 'raw', auf: 'audio/L16;rate=16000', vcn: voiceName, speed: 50, volume: 50, pitch: 50, tte: 'UTF8' },
                data: { status: 2, text: Buffer.from(text).toString('base64') }
            }))
        })

        ws.on('message', (data) => {
            const res = JSON.parse(data)
            if (res.code !== 0) { clearTimeout(timeout); ws.close(); reject(new Error(res.message)) }
            if (res.data?.audio) audioBuffer.push(Buffer.from(res.data.audio, 'base64'))
            if (res.data?.status === 2) {
                clearTimeout(timeout)
                ws.close()
                resolve(addWavHeader(Buffer.concat(audioBuffer), 16000, 16, 1))
            }
        })

        ws.on('error', (err) => { clearTimeout(timeout); reject(err) })
    })
}

// WAV头
function addWavHeader(pcmBuffer, sampleRate, bitDepth, channels) {
    const header = Buffer.alloc(44)
    header.write('RIFF',0); header.writeUInt32LE(36+pcmBuffer.length,4); header.write('WAVE',8)
    header.write('fmt ',12); header.writeUInt32LE(16,16); header.writeUInt16LE(1,20)
    header.writeUInt16LE(channels,22); header.writeUInt32LE(sampleRate,24)
    header.writeUInt32LE(sampleRate*channels*bitDepth/8,28)
    header.writeUInt16LE(channels*bitDepth/8,32); header.writeUInt16LE(bitDepth,34)
    header.write('data',36); header.writeUInt32LE(pcmBuffer.length,40)
    return Buffer.concat([header,pcmBuffer])
}

// ==================== 入口 ====================
exports.main = async (event) => {
    const { type, data, language, accent, voiceName } = event
    try {
        if (type === 'asr') {
            const text = await asrRecognize(data, language, accent, config.ASR)
            return { success: true, data: text }
        }
        if (type === 'tts') {
            const audio = await ttsSynthesize(data, language, voiceName, config.TTS)
            return { success: true, data: audio.toString('base64') }
        }
        return { success: false, message: '类型错误' }
    } catch (e) {
        return { success: false, message: e.message }
    }
}