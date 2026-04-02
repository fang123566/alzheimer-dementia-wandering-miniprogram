# 守护·陪伴 微信小程序框架

阿尔茨海默防走失小程序 — 框架代码说明

## 页面结构

| 页面 | 路径 | 功能 |
|------|------|------|
| 首页·监控 | `pages/index` | 实时状态、快捷操作、最近预警、SOS按钮（老人端） |
| 位置轨迹 | `pages/location` | 地图展示、安全围栏、今日轨迹时间线 |
| 预警中心 | `pages/alert` | 预警列表、分类筛选、已知晓/回拨操作 |
| 记忆相册 | `pages/memory` | 照片网格、成员标注、AI记忆提示 |
| AI伴聊 | `pages/aichat` | 情绪安抚、防诈拦截、语音对话（含关键词检测） |
| 基础设置 | `pages/settings` | 紧急联系人、方言、预警灵敏度、防诈词库 |

## 双角色切换

- **家属端**（默认）：查看轨迹、接收预警、管理记忆、监控对话
- **老人端**：SOS求助、直接对话AI伴聊

角色状态存储在 `app.globalData.role`，通过首页顶部切换条控制。

## 目录结构

```
guardian-miniapp/
├── app.js              # 全局逻辑 & globalData
├── app.json            # 页面注册 & TabBar 配置
├── app.wxss            # 全局样式变量 & 通用组件
├── project.config.json # 开发者工具配置
├── sitemap.json
└── pages/
    ├── index/          # 首页·实时监控
    ├── location/       # 位置轨迹（含地图组件）
    ├── alert/          # 预警中心
    ├── memory/         # 记忆相册
    ├── aichat/         # AI伴聊
    └── settings/       # 基础设置
```

## 使用方式

1. 微信开发者工具 → 导入项目 → 选择本目录
2. 在 `project.config.json` 中填入真实 `appid`
3. `assets/icons/` 目录中放入 TabBar 图标（PNG，40×40）
4. 后端接口 / 云开发初始化在 `app.js` 中标注了 `TODO` 位置

## 待接入能力

- GPS 实时位置上报（`wx.startLocationUpdateBackground`）
- 云开发数据库（预警记录、照片、记忆库）
- AI 伴聊 API（语音 ASR → 文本 → LLM → TTS）
- 微信订阅消息推送（预警通知）
- 人脸识别标注（照片上传后调用）
