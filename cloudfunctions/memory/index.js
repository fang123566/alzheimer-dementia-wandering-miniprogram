// cloudfunctions/memory/index.js
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const COL = 'memories'

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext()
  const action = event.action

  switch (action) {
    case 'list':   return actionList(OPENID)
    case 'get':    return actionGet(OPENID, event.id)
    case 'add':    return actionAdd(OPENID, event.data)
    case 'update': return actionUpdate(OPENID, event.id, event.data)
    case 'delete': return actionDelete(OPENID, event.id)
    case 'deleteVoice': return actionDeleteVoice(OPENID, event.id)
    default: return { code: -1, msg: '未知指令' }
  }
}

async function actionList(openid) {
  try {
    console.log('[memory] list openid:', openid)
    const { data } = await db.collection(COL)
      .where({ openid })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
    console.log('[memory] list count:', data.length)
    return { code: 0, data: data.map(normalize) }
  } catch (e) {
    console.error('[memory] list error:', e.message)
    return { code: -1, msg: e.message }
  }
}

async function actionGet(openid, id) {
  if (!id) return { code: 1, msg: '缺少 id' }
  try {
    const { data } = await db.collection(COL).doc(id).get()
    if (data.openid !== openid) return { code: 403, msg: '无权限' }
    return { code: 0, data: normalize(data) }
  } catch (e) { return { code: -1, msg: e.message } }
}

async function actionAdd(openid, payload = {}) {
  try {
    const now = Date.now()
    const doc = {
      openid,
      type:      payload.type || 'image',
      url:       payload.url || '',
      thumb:     payload.thumb || payload.url || '',
      caption:   payload.caption || '',
      story:     payload.story || '',
      voiceNote: payload.voiceNote || { url: '', duration: 0, text: '' },
      members:   payload.members || [],
      createdAt: now,
      updatedAt: now
    }
    const res = await db.collection(COL).add({ data: doc })
    return { code: 0, data: { id: res._id } }
  } catch (e) { return { code: -1, msg: e.message } }
}

async function actionUpdate(openid, id, payload = {}) {
  if (!id) return { code: 1, msg: '缺少 id' }
  try {
    const { data } = await db.collection(COL).doc(id).get()
    if (data.openid !== openid) return { code: 403, msg: '无权限' }
    const update = { updatedAt: Date.now() }
    if (payload.caption  !== undefined) update.caption  = payload.caption
    if (payload.story    !== undefined) update.story    = payload.story
    if (payload.voiceNote !== undefined) update.voiceNote = payload.voiceNote
    if (payload.members  !== undefined) update.members  = payload.members
    await db.collection(COL).doc(id).update({ data: update })
    return { code: 0 }
  } catch (e) { return { code: -1, msg: e.message } }
}

async function actionDelete(openid, id) {
  if (!id) return { code: 1, msg: '缺少 id' }
  try {
    const { data } = await db.collection(COL).doc(id).get()
    if (data.openid !== openid) return { code: 403, msg: '无权限' }
    // 删除云存储文件
    const fileIds = [data.url, data.thumb, data.voiceNote?.url].filter(f => f && f.startsWith('cloud://'))
    if (fileIds.length) {
      await cloud.deleteFile({ fileList: fileIds }).catch(() => {})
    }
    await db.collection(COL).doc(id).remove()
    return { code: 0 }
  } catch (e) { return { code: -1, msg: e.message } }
}

async function actionDeleteVoice(openid, id) {
  if (!id) return { code: 1, msg: '缺少 id' }
  try {
    const { data } = await db.collection(COL).doc(id).get()
    if (data.openid !== openid) return { code: 403, msg: '无权限' }
    const voiceUrl = data.voiceNote?.url
    if (voiceUrl && voiceUrl.startsWith('cloud://')) {
      await cloud.deleteFile({ fileList: [voiceUrl] }).catch(() => {})
    }
    await db.collection(COL).doc(id).update({
      data: { voiceNote: { url: '', duration: 0, text: '' }, updatedAt: Date.now() }
    })
    return { code: 0 }
  } catch (e) { return { code: -1, msg: e.message } }
}

function normalize(doc) {
  const ts = doc.createdAt
  let dateStr = ''
  if (ts) {
    const d = new Date(typeof ts === 'number' ? ts : ts)
    dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  }
  return {
    id:        doc._id,
    type:      doc.type || 'image',
    url:       doc.url || '',
    thumb:     doc.thumb || doc.url || '',
    caption:   doc.caption || '',
    story:     doc.story || '',
    voiceNote: doc.voiceNote || { url: '', duration: 0, text: '' },
    members:   doc.members || [],
    createdAt: dateStr
  }
}
