# 守护·陪伴：阿尔茨海默老人智能守护陪伴小程序

## 项目简介

**守护·陪伴** 是一款面向阿尔茨海默病及认知障碍老人的微信小程序，围绕老人走失风险、家庭照护压力、用药提醒、情感陪伴和方言沟通障碍等问题，提供 **老人端 + 家属端** 双角色智能守护方案。

项目通过微信小程序、微信云开发、实时定位、智能安全围栏、AI 伴聊、方言识别、短信预警等能力，构建了一套从 **老人位置上报 → 云端风险判断 → 家属接收预警 → 及时响应处理** 的闭环系统。

本项目重点突出：

- **阿尔茨海默老人防走失**
- **家属远程守护**
- **智能位置预警**
- **AI 情绪陪伴**
- **方言语音交互**
- **适老化界面设计**
- **微信云开发无服务器架构**

## 项目背景

阿尔茨海默病患者常伴随记忆力衰退、方向感下降和语言表达困难，走失风险较高。传统 GPS 手环、定位器等硬件方案存在佩戴抗拒、忘记充电、成本较高等问题；普通定位软件又缺少适老化设计和主动预警能力。

因此，本项目选择以老人更容易接触的 **手机与微信小程序** 作为载体，不额外增加硬件负担，通过位置监测、智能预警、AI 陪聊和方言识别等方式，为老人和家属提供低成本、易使用、可持续的数字守护方案。

## 核心功能

### 1. 双角色系统

系统分为 **老人端** 和 **家属端** 两类角色。

**老人端功能：**

- 一键 SOS 求助
- 自动后台位置上报
- AI 伴聊与情绪安抚
- 方言语音识别与翻译
- 用药/体检提醒
- 记忆相册查看
- 大字体适老化界面

**家属端功能：**

- 查看老人实时位置
- 查看历史轨迹
- 设置安全围栏
- 接收越界/异常预警
- 查看预警中心
- 管理提醒事项
- 管理家庭组和绑定关系
- 维护老人记忆相册

### 2. 家属与老人绑定

家属可通过老人手机号发起绑定，系统在云数据库中建立绑定关系。绑定后，家属可以查看对应老人的位置、轨迹、预警和提醒信息。

绑定逻辑支持：

- 家属绑定老人手机号
- 老人端与家属端双向关联
- `openid` 与 `_openid` 双字段兼容
- 通过手机号兜底匹配历史数据
- 家属端和老人端均可解除绑定

### 3. 实时定位与轨迹记录

老人端授权定位后，小程序可调用微信定位能力进行位置上报。云函数将经纬度、定位精度、时间等信息写入轨迹集合，家属端可查看老人当前位置和历史轨迹。

相关能力包括：

- 实时位置上报
- 后台持续定位
- 今日轨迹查询
- 轨迹时间线展示
- 家属端地图查看

### 4. 智能安全围栏

家属可为老人设置安全活动区域，例如家附近、公园附近、社区附近等。系统会根据老人实时位置与围栏中心点的距离判断安全状态。

预警等级：

- **安全**：老人仍在安全区域内
- **轻微越界**：老人刚离开围栏范围
- **紧急越界**：老人明显远离安全区域

系统使用 Haversine 公式计算经纬度距离，并在触发风险时写入预警记录。

### 5. 异常行为预警

除电子围栏外，系统还支持老人异常行为检测：

- **围栏越界预警**
- **长时间停留预警**
- **异常徘徊预警**
- **疑似走失风险提醒**

触发预警后，系统会将记录写入 `location_alerts` 或 `alerts` 集合，家属可在预警中心查看。若配置阿里云短信服务，还可向家属发送短信提醒。

### 6. AI 伴聊与防诈骗提醒

AI 伴聊模块用于为老人提供日常陪伴和情绪安抚。老人可通过文字或语音与 AI 对话，AI 会以温和、简短、适合老年人的语气进行回复。

AI 模块可用于：

- 日常陪聊
- 情绪安抚
- 孤独缓解
- 防诈骗提醒
- 异常语义识别

当聊天内容中出现转账、验证码、陌生电话、汇款等疑似诈骗信息时，系统会生成防诈提醒，并可写入预警记录，提醒家属关注。

### 7. 方言语音识别与翻译

考虑到部分老年人更习惯使用方言表达，项目集成了语音识别与方言处理能力。老人可直接用方言说话，系统将语音转换为文字，并辅助转化为更容易理解的普通话表达。

该功能降低了老人使用智能设备的门槛，是本项目的重要适老化特色。

### 8. 用药与生活提醒

家属可为老人设置用药、喝水、体检、复诊等提醒事项。提醒数据由云函数管理，老人端可以查看当天提醒，辅助老人保持规律生活。

### 9. 记忆相册

家属可上传家庭照片、纪念照片或重要人物照片，并添加文字说明。老人端可通过记忆相册回顾家人、事件和生活片段，辅助记忆唤醒。

## 技术架构

项目采用微信小程序原生开发与微信云开发架构。

```text
┌──────────────────────────────────────┐
│            微信小程序前端              │
│  老人端 / 家属端 / 自定义 TabBar        │
└──────────────────┬───────────────────┘
                   │ wx.cloud.callFunction
┌──────────────────▼───────────────────┐
│              微信云函数                │
│ auth / binding / locationUpdate       │
│ locationAlert / alerts / aiChat       │
│ reminders / memory / settings 等       │
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│              云数据库                  │
│ elderly / family / bindings           │
│ trajectories / fences / alerts        │
│ location_alerts / reminders 等         │
└──────────────────┬───────────────────┘
                   │
┌──────────────────▼───────────────────┐
│            第三方 AI 与短信服务          │
│  讯飞星火 / 阿里通义系列 / 豆包 / 阿里云短信 │
└──────────────────────────────────────┘
```

## 技术栈

### 前端

- 微信小程序原生开发
- WXML
- WXSS
- JavaScript
- 自定义 TabBar
- 微信地图与定位 API
- 微信录音 API

### 后端

- 微信云开发
- Node.js 云函数
- 云数据库
- 云存储
- `wx.cloud.callFunction`

### AI 与第三方服务

- 讯飞星火：语音识别、方言识别、语音交互能力
- 阿里通义系列：AI 伴聊、文本生成、内容润色、防诈话术
- 豆包：文案优化、适老化表达、项目材料辅助
- 阿里云短信：预警短信推送

## 页面说明

| 页面 | 路径 | 主要功能 |
|------|------|----------|
| 登录注册 | `pages/login/login` | 手机号注册、登录、角色选择 |
| 首页 | `pages/index/index` | 双角色首页、状态概览、快捷入口 |
| 位置 | `pages/location/location` | 实时位置、地图、轨迹、安全围栏 |
| 预警 | `pages/alert/alert` | 预警列表、分类筛选、已读处理 |
| 我的 | `pages/profile/profile` | 用户资料、账号设置、退出登录 |
| AI 伴聊 | `pages/aichat/aichat` | AI 对话、情绪安抚、防诈提醒 |
| 方言翻译 | `pages/dialect/dialect` | 录音、方言识别、普通话转写 |
| 记忆相册 | `pages/memory/memory` | 照片管理、记忆辅助 |
| 绑定 | `pages/binding/binding` | 家属绑定老人手机号 |
| 设置 | `pages/settings/settings` | 围栏、提醒、偏好设置 |
| 设备 | `pages/device/device` | 设备状态、老人端状态展示 |
| 提醒 | `pages/reminders/reminders` | 今日提醒、提醒模板管理 |
| 家庭组 | `pages/family-group/family-group` | 家庭成员、绑定/解绑管理 |

## 云函数说明

| 云函数 | 功能说明 |
|--------|----------|
| `auth` | 用户注册、登录、资料更新、注销 |
| `binding` | 老人和家属绑定、查询、修改、删除 |
| `alerts` | 综合预警查询、标记已读、删除 |
| `locationUpdate` | 位置上报、轨迹写入、围栏检测、预警触发 |
| `locationAlert` | 根据绑定关系查找家属并发送短信预警 |
| `locationFences` | 安全围栏新增、修改、启用、删除 |
| `locationGetCurrent` | 获取老人最新位置 |
| `locationTrajectory` | 查询老人历史轨迹 |
| `aiChat` | AI 伴聊、防诈骗检测、聊天记录 |
| `reminders` | 用药、喝水、体检等提醒管理 |
| `settings` | 用户设置、设备绑定状态等 |
| `memory` | 记忆相册图片和说明管理 |
| `sos` | 老人一键求助与家属通知 |
| `asrTts` | 语音识别与语音合成 |

## 数据库集合设计

项目主要使用以下云数据库集合：

| 集合名 | 说明 |
|--------|------|
| `elderly` | 老人用户信息 |
| `family` | 家属用户信息 |
| `tokens` | 登录令牌与会话记录 |
| `bindings` | 老人与家属绑定关系 |
| `trajectories` | 老人位置轨迹 |
| `fences` | 安全围栏数据 |
| `location_alerts` | 位置类预警记录 |
| `alerts` | 综合预警记录，如防诈预警 |
| `reminders` | 提醒事项与模板 |
| `memories` | 记忆相册数据 |
| `settings` | 用户配置与偏好 |

### 关键字段说明

**`elderly` / `family`：**

- `_openid`：微信云开发自动 openid
- `openid`：自定义 openid 兼容字段
- `phone`：手机号
- `nickName` / `name`：昵称或姓名
- `role`：用户角色，`elderly` 或 `family`
- `createdAt`：注册时间

**`bindings`：**

- `fromOpenid`：发起绑定的家属 openid
- `fromPhone`：家属手机号
- `toOpenid`：老人 openid
- `toPhone`：老人手机号
- `note`：备注
- `createdAt`：创建时间

**`location_alerts`：**

- `openid`：老人 openid
- `type`：预警类型
- `category`：预警分类
- `level`：预警等级
- `reason`：预警原因
- `latitude` / `longitude`：触发位置
- `read`：是否已读
- `createdAt`：创建时间

## 运行与部署

### 1. 导入项目

1. 打开微信开发者工具
2. 选择“导入项目”
3. 项目目录选择当前目录 `yuyin`
4. AppID 使用 `project.config.json` 中配置的 AppID，或替换为自己的小程序 AppID

### 2. 配置云开发环境

在 `app.js` 中确认云环境 ID：

```javascript
wx.cloud.init({ env: 'cloud1-3gzx0vun034c33f9' })
```

如果使用自己的云开发环境，请替换为自己的环境 ID。

### 3. 创建数据库集合

在微信云开发控制台中创建以下集合：

```text
elderly
family
tokens
bindings
trajectories
fences
location_alerts
alerts
reminders
memories
settings
```

### 4. 部署云函数

在微信开发者工具中，对 `cloudfunctions` 下的云函数逐个右键：

```text
上传并部署：云端安装依赖
```

建议至少部署：

```text
auth
binding
locationUpdate
locationAlert
locationFences
locationGetCurrent
locationTrajectory
alerts
aiChat
reminders
settings
memory
sos
asrTts
```

### 5. 配置定位权限

`app.json` 已声明定位与录音权限：

```json
"requiredPrivateInfos": [
  "getLocation",
  "startLocationUpdate",
  "startLocationUpdateBackground",
  "onLocationChange"
]
```

真机测试时需在微信中授权定位权限和后台定位权限。

### 6. 配置短信服务

如果需要启用短信预警，需要在 `cloudfunctions/locationAlert/index.js` 中配置阿里云短信参数：

```javascript
const ALI_SMS = {
  accessKeyId: 'YOUR_ACCESS_KEY_ID',
  accessKeySecret: 'YOUR_ACCESS_KEY_SECRET',
  signName: '你的短信签名',
  templateCode: 'SMS_XXXXXXXXX'
}
```

未配置短信时，系统仍可写入预警记录，家属可在小程序预警中心查看。

## 使用流程

### 老人端

1. 注册账号，角色选择“老人”
2. 授权定位和录音权限
3. 进入首页，可使用 SOS、AI 伴聊、方言翻译、提醒、记忆相册
4. 小程序启动后自动进行位置上报
5. 若离开安全围栏，系统自动生成预警

### 家属端

1. 注册账号，角色选择“家属”
2. 进入绑定页面，输入老人手机号
3. 绑定成功后，可查看老人位置和预警
4. 在位置页面设置安全围栏
5. 在预警中心查看风险记录
6. 在家庭组页面管理绑定关系
7. 在提醒页面为老人设置用药、体检等事项

## 项目特色

### 1. 面向阿尔茨海默老人的专用场景

项目不是普通定位工具，而是围绕阿尔茨海默老人走失风险、记忆障碍和家庭照护问题设计，功能更贴近真实养老守护需求。

### 2. 无需额外硬件

系统直接使用手机与微信小程序完成定位和预警，不依赖 GPS 手环、定位器等额外硬件，降低成本和使用门槛。

### 3. 双角色闭环守护

老人端负责位置上报、求助和陪伴；家属端负责查看、设置和响应。两端通过云数据库绑定关系形成完整闭环。

### 4. 智能预警能力

系统不仅能展示位置，还能根据安全围栏、轨迹停留和异常行为自动判断风险，实现主动预警。

### 5. AI 陪伴与防诈结合

AI 伴聊不仅用于聊天，还结合情绪安抚和诈骗风险识别，提升老人心理陪伴和安全防护能力。

### 6. 方言语音交互

项目关注老年人的语言习惯，通过方言识别降低老人使用智能产品的难度，体现适老化和无障碍设计理念。

### 7. 微信云开发架构

项目后端基于云函数与云数据库，无需自建服务器，部署简单、成本低、适合快速迭代和比赛展示。

## 测试说明

建议测试以下功能：

- 注册登录：老人端和家属端分别注册
- 绑定关系：家属通过老人手机号绑定
- 解绑功能：家属端和老人端解除绑定
- 定位上报：老人端授权定位后上报当前位置
- 围栏预警：家属设置围栏后测试越界
- 预警中心：家属查看预警列表并标记已读
- AI 伴聊：测试普通聊天、情绪安抚、防诈关键词
- 方言翻译：测试录音、识别和结果展示
- 提醒事项：新增、修改、删除提醒
- 记忆相册：上传照片、查看详情

## 常见问题

### 1. 家属端看不到老人位置

请检查：

- 老人端是否已注册并登录
- 家属是否已绑定老人手机号
- `bindings` 集合中是否存在绑定记录
- 老人端是否授权定位
- `locationUpdate` 云函数是否已部署

### 2. 绑定后仍提示未绑定

请检查：

- `bindings.toPhone` 是否为老人手机号
- `elderly.phone` 是否与绑定手机号一致
- `toOpenid` 是否为空
- `auth` 和 `binding` 云函数是否已部署最新版

系统已兼容 `_openid` 与 `openid` 双字段，但历史数据可能需要老人重新登录一次以补齐 `openid` 字段。

### 3. 预警没有短信通知

请检查：

- `locationAlert` 云函数是否部署
- 阿里云短信 AccessKey、签名、模板是否配置
- 家属账号是否有手机号
- `bindings` 中是否能根据老人 openid 或手机号找到家属

### 4. 真机无法后台定位

请检查：

- 是否在 `app.json` 中声明后台定位能力
- 是否在微信端授权“使用期间和离开后”
- 是否使用真机测试，模拟器可能无法完整模拟后台定位

## 后续优化方向

- 增加更精准的异常轨迹识别模型
- 增加更多方言识别支持
- 引入微信订阅消息推送
- 增加社区志愿者协同守护角色
- 优化 AI 伴聊的记忆能力和长期陪伴能力
- 增强离线缓存与弱网场景处理
- 增加家属 Web 管理后台

## 项目展示
﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿<img width="500" alt="image" src="https://github.com/user-attachments/assets/39d481c7-353b-406e-a1ec-b6e86175e324" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/161728b2-592e-4235-b43d-bc0c2f1e0330" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/6a73cbf4-2d28-4cc3-a9e5-c774a54007d2" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/12b1158a-51fc-47bb-9fc1-8ad96d198b71" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/ba71678f-723e-4f36-99bb-b35433c87505" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/458b7eac-f33f-4408-a288-aa9b6507446b" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/945814da-c4d8-475c-8666-c61bf40cbf95" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/0d0a6635-ae47-4cc7-874a-c849973f6a87" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/6ee46b66-c9f7-4329-bfa7-035856a5d960" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/3542e275-1253-4c90-88fa-f96a108418ba" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/2dc78173-1dfc-4bbd-b84f-2ca852a56535" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/f7ba113e-70a3-4f01-895f-45c124915426" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/bf16759f-6fbb-4d02-b8af-94692f1ba438" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/983e74c5-3917-4778-9039-99c77a7cefa2" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/a655174b-9d4b-4069-92d3-7f97eb89cbdf" />
<img width="500" alt="image" src="https://github.com/user-attachments/assets/ecff5962-1203-4f5d-9149-ecb03a70284d" />








﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿










































