# 守护·陪伴 后端服务

## 快速启动

```bash
cd server
npm install
npm run dev      # 开发模式（nodemon 热重载）
# 或
npm start        # 生产模式
```

启动后访问 http://localhost:3000/api/health 确认服务正常。

## 接口总览

| 模块 | 前缀 | 说明 |
|------|------|------|
| 统计 | `GET /api/stats` | 首页综合统计 |
| 位置 | `/api/location` | 实时位置 / 轨迹 / 安全围栏 |
| 预警 | `/api/alerts` | 预警列表 / 标记已读 |
| 伴聊 | `/api/chat` | 聊天历史 / 发消息（含防诈检测） |
| 相册 | `/api/memory` | 照片 / 家庭成员 / AI记忆提示 |
| 设置 | `/api/settings` | 设置项 / 联系人 / 关键词 |
| SOS | `POST /api/sos` | 触发紧急求助 |

## WebSocket 实时推送

连接 `ws://localhost:3000` 即可接收位置实时推送。

**收到消息格式：**
```json
{ "type": "location", "data": { "latitude": ..., "longitude": ..., "status": "safe" } }
{ "type": "sos",      "data": { "location": {...} } }
```

**上报位置格式（设备端发送）：**
```json
{ "type": "location_update", "data": { "latitude": 30.57, "longitude": 104.06, "battery": 85 } }
```

## 环境说明

- 当前使用**内存数据存储**，服务重启后数据重置。
- 生产环境请替换 `server/data/store.js` 为 MongoDB / MySQL 等持久化存储。
- AI 伴聊目前使用本地规则引擎，接入真实 LLM 请修改 `server/routes/chat.js` 中的 `generateReply` 函数。

## 前端配置

小程序 `utils/request.js` 中 `BASE_URL` 默认为 `http://localhost:3000/api`。

上线时替换为真实服务器地址，并在微信开发者工具 → 项目设置中配置合法域名。
