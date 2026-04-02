// 云函数入口文件
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const WebSocket = require('ws')
const config = require('./config')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 生成鉴权URL
function getXfyunAuthUrl(host, path, apiKey, apiSecret, method = 'GET') {
    const date = new Date().toUTCString()
    const signatureOrigin = `${method} ${path} HTTP/1.1\nhost: ${host}\ndate: ${date}\n`
    const signatureSha = crypto.createHmac('sha256', apiSecret)
    signatureSha.update(signatureOrigin)
    const signature = signatureSha.digest('base64')
    const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`
    const authorization = Buffer.from(authorizationOrigin).toString('base64')
    return `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`
}

// 方言识别（ASR）
async function asrRecognize(audioData, language = 'zh_cn', accent = 'mandarin') {
    return new Promise((resolve, reject) => {
        const host = 'ws-api.xfyun.cn'
        const path = '/v2/iat'
        const authUrl = getXfyunAuthUrl(host, path, config.API_KEY, config.API_SECRET)
        
        const ws = new WebSocket(authUrl)
        let result = ''

        ws.on('open', () => {
            const startFrame = {
                common: { app_id: config.APPID },
                business: {
                    language: language,
                    accent: accent,
                    domain: 'iat',
                    dwa: 'wpgs'
                },
                data: {
                    status: 0,
                    format: 'audio/L16;rate=16000',
                    audio: Buffer.from(audioData, 'base64').toString('base64'),
                    encoding: 'raw'
                }
            }
            ws.send(JSON.stringify(startFrame))
            const endFrame = { data: { status: 2 } }
            ws.send(JSON.stringify(endFrame))
        })

        ws.on('message', (data) => {
            const res = JSON.parse(data)
            if (res.code !== 0) {
                reject(new Error(`ASR错误: ${res.message}`))
                ws.close()
                return
            }
            if (res.data && res.data.result) {
                result += res.data.result.ws[0].cw.map(item => item.w).join('')
            }
            if (res.data.status === 2) {
                ws.close()
                resolve(result)
            }
        })

        ws.on('error', (err) => reject(err))
    })
}

// 语音合成（TTS）
async function ttsSynthesize(text, language = 'zh_cn', voiceName = 'xiaoyan') {
    return new Promise((resolve, reject) => {
        const host = 'tts-api.xfyun.cn'
        const path = '/v2/tts'
        const authUrl = getXfyunAuthUrl(host, path, config.API_KEY, config.API_SECRET)
        
        const ws = new WebSocket(authUrl)
        const audioBuffer = []

        ws.on('open', () => {
            const frame = {
                common: { app_id: config.APPID },
                business: {
                    aue: 'raw',
                    auf: 'audio/L16;rate=16000',
                    vcn: voiceName,
                    speed: 50,
                    volume: 50,
                    pitch: 50,
                    text: Buffer.from(text).toString('base64')
                },
                data: { status: 2 }
            }
            ws.send(JSON.stringify(frame))
        })

        ws.on('message', (data) => {
            const res = JSON.parse(data)
            if (res.code !== 0) {
                reject(new Error(`TTS错误: ${res.message}`))
                ws.close()
                return
            }
            if (res.data && res.data.audio) {
                audioBuffer.push(Buffer.from(res.data.audio, 'base64'))
            }
            if (res.data.status === 2) {
                ws.close()
                resolve(Buffer.concat(audioBuffer))
            }
        })

        ws.on('error', (err) => reject(err))
    })
}

// 云函数入口
exports.main = async (event, context) => {
    const { type, data, language, accent, voiceName } = event

    try {
        if (type === 'asr') {
            const text = await asrRecognize(data, language, accent)
            return { success: true, data: text }
        } else if (type === 'tts') {
            const audio = await ttsSynthesize(data, language, voiceName)
            return { success: true, data: audio.toString('base64') }
        } else {
            return { success: false, message: '无效的请求类型' }
        }
    } catch (err) {
        return { success: false, message: err.message }
    }
}