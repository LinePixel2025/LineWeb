# LineWeb AI 对话（DeepSeek）API 接入文档

> 适用版本：2026-10（多会话 / SSE 流式回复 / 每日提问上限 / 图片与拍照提问）
> 相关文档：[`api.md`](./api.md)（全部端点）、[`auth-api.md`](./auth-api.md)（账号登录令牌与角色能力）、[`chat-api.md`](./chat-api.md)（私信聊天，图片链路同源）
> 服务端实现：`server/src/routes/aiChat.ts`、`server/src/services/aiChatService.ts`、`server/src/services/aiChatImageService.ts`
> 前端实现：`client/src/pages/DeepSeekChatPage.tsx`（/deepseek）、`client/src/pages/admin/AiChatAdminPage.tsx`（/admin/ai-chat）、`client/src/lib/aiChat.ts`

---

## 1. 概述

AI 对话是由**站内后端统一代理**的通用对话功能（用户无需自己的 API Key），与首页 AI 助手（`/api/ai/*`，`AiConfig` 配置）**相互独立**：

- **多会话**：每个用户可创建多个会话，标题取首条消息前 20 字，历史落库（换设备登录后仍在）。
- **流式回复**：`POST /messages` 返回 `text/event-stream`，逐块下发 delta，服务端同时落库。
- **每日提问上限**：管理员可设每用户每日上限（Asia/Shanghai 0 点重置，0 = 不限）；**上游调用失败不计数**（该条 user 消息 `counted=false` 自动退还）。
- **图片提问**：上传/拍照附件（≤4 张/条）统一 sharp 转 WebP 存到存储节点 `_ai/<userId>/`，发送时以 OpenAI 多模态 `image_url`（base64 data URL）传给模型；**需模型支持视觉输入**（DeepSeek 官方 API 为纯文本，管理页有提示）。
- **配额口径**：AI 对话图片计入上传者的网盘空间配额（与聊天图片一致，见 `driveQuota.getDriveUsage`）。
- 仍不支持：会话改名、消息撤回/编辑、导出。

---

## 2. 认证与通用约定

| 项 | 说明 |
|---|---|
| 基础 URL | `/api`（开发 `http://localhost:3001/api`，生产 `https://web.linetech.online/api`） |
| 凭证 | 账号登录令牌：`Authorization: Bearer <token>`（`POST /api/auth/login` 获取） |
| 匿名访问 | **不支持**：全部端点要求登录（路由不在 `publicApiPaths` 白名单，未登录 401） |
| 应用令牌 | **不可用**：`/api/ai-chat/*` 不在 OAuth 应用端点白名单（`APP_ENDPOINT_RULES`），一律 403 |
| 错误格式 | `{ "error": "中文错误信息" }`；429 额外携带 `quota` 对象 |
| 状态码 | `400` 参数/附件无效；`401` 未登录；`403` 应用令牌或非 `ai:configure`；`404` 会话/图片不存在或非本人（不泄露存在性）；`429` 当日次数用完；`502/503/504` 上游 AI 或存储节点异常 |
| 频控 | AI 对话写操作（POST/DELETE）：每用户 5 分钟 120 次（与聊天写操作同参）；全局 `/api` 600/15min/IP 兜底 |
| 时间 | `createdAt` 等为 ISO 8601 字符串 |

---

## 3. 数据模型（Prisma）

| 模型 | 表 | 说明 |
|---|---|---|
| `AiChatConfig` | `ai_chat_config` | 全站单行配置：provider/model/apiKey/baseUrl/systemPrompt/dailyLimit/isEnabled |
| `AiConversation` | `ai_conversations` | 会话：userId、title（首条消息前 20 字）、updatedAt（按最近活跃排序） |
| `AiMessage` | `ai_messages` | 消息：role('user'\|'assistant')、content、model（assistant 消息记录生成模型）、`counted`（是否计入当日配额，失败退还即置 false） |
| `AiChatImage` | `ai_chat_images` | 图片附件：imagePath（`_ai/<userId>/<uuid>.webp`）、width/height/size；`messageId=null` 表示已上传待发送 |

约定：仅用 `prisma db push` 同步（无 migrations 目录）；本地 SQLite / 生产 PostgreSQL 双轨，容器 entrypoint 启动时自动 push。

---

## 4. 用户端点

### 4.1 `GET /api/ai-chat/quota` — 功能开关与当日额度

响应：

```json
{
  "enabled": true,
  "model": "deepseek-chat",
  "dailyLimit": 20,
  "used": 3,
  "remaining": 17,
  "unlimited": false,
  "resetDate": "2026-10-26"
}
```

- `dailyLimit = 0` → `unlimited: true`、`remaining: null`。
- `resetDate` 为配额重置日期（Asia/Shanghai，即明天）。
- `enabled: false` 时前端显示「管理员未开启此功能」。

### 4.2 `GET /api/ai-chat/conversations` — 会话列表

响应 `{ conversations: [{ id, title, createdAt, updatedAt }] }`（`updatedAt` 倒序，最多 100 条）。

### 4.3 `GET /api/ai-chat/conversations/:id/messages?before=&take=30` — 历史消息（游标分页）

响应 `{ messages: MessageDto[], hasMore: boolean }`；`messages` 升序，`before` 为上一页最早一条的 id。`take` 默认 30、上限 50。

`MessageDto`：

```json
{
  "id": 7,
  "role": "user",
  "content": "这张图是什么？",
  "model": null,
  "createdAt": "2026-10-25T03:29:42.325Z",
  "images": [{ "id": 1, "width": 1024, "height": 768, "size": 81234 }]
}
```

### 4.4 `POST /api/ai-chat/messages` — 发消息（SSE 流式回复）

请求体：

```json
{ "conversationId": 3, "content": "帮我写一段防抖", "imageIds": [1, 2] }
```

- `conversationId` 省略 = 新会话（由 `meta` 事件返回真实 id）；`content`（≤4000 字）与 `imageIds`（≤4）至少其一。
- **SSE 建立前的错误是普通 JSON**：`400` 参数无效、`429` 当日次数用完（带 `quota`）、`503` 功能未开启/未配 Key。

SSE 事件（`data: {...}\n\n`）：

```
data: {"meta":{"conversationId":3,"userMessageId":9,"remaining":16,"unlimited":false}}

data: {"delta":"好的，"}

data: {"delta":"防抖函数…"}

data: {"done":true,"assistantMessageId":10,"model":"deepseek-chat","partial":false,"conversationId":3,"remaining":16,"unlimited":false}
```

或失败终止：`data: {"error":"AI 服务暂时不可用，请稍后再试"}`（此时该条提问已退还，`remaining` 回升）。

语义约定：

- `meta` 在 user 消息落库后立即下发；`remaining` 为本条计入后的剩余次数（发送前剩余 −1）。
- 上游失败：**不落 assistant 消息**，user 消息 `counted=false`（当日已用次数回退），发 `error` 事件结束。
- 客户端中断（fetch abort / 页面关闭）：已生成的**非空部分回复照常落库**（`partial` 不影响落库，重连后以 REST 为准）；完全没有输出则不落 assistant 消息。
- 上下文：system（管理员配置）+ 当前会话最近 20 条历史（历史图片以「（附图）」文字占位）+ 当前消息；**图片仅对当前消息**以 `{type:'image_url', image_url:{url:'data:image/webp;base64,…'}}` 传入。
- 上游参数：`max_tokens 4000`、`temperature 0.7`、`stream: true`；baseUrl 为 OpenAI 兼容端点（DeepSeek 默认 `https://api.deepseek.com`）。

### 4.5 `DELETE /api/ai-chat/conversations/:id` — 删除会话

级联删除消息与图片行；节点上的图片文件 best-effort 删除。响应 `{ ok: true }`。

### 4.6 `POST /api/ai-chat/images` — 上传附件

`multipart/form-data`，字段名 `file`；原始 ≤10 MiB、处理后 WebP ≤4 MiB、JPEG/PNG/WebP/GIF。

- 201 → `{ "id": 1, "width": 1024, "height": 768, "size": 81234 }`
- 413 → `{ "error": "…", "code": "QUOTA_EXCEEDED" | "IMAGE_TOO_LARGE", "quota"?, "used"?, "remaining"? }`（字节数为字符串，与网盘上传一致）
- 503 → 存储节点未接入。

附件先落库为**待发送**（`messageId=null`），随消息发送时在事务内认领；超过 24 小时未发送的附件会在本人下次上传时被清理。上传执行网盘配额三道检查（预检 / busboy 截断 / 写后复核回滚），计入 `getDriveUsage`。

### 4.7 `GET /api/ai-chat/images/:id/image` — 读取附件（仅属主）

`image/webp` + `Cache-Control: private, max-age=31536000, immutable`；`<img>` 直链用 `?token=<登录令牌>` 鉴权（与聊天图片同机制）。

### 4.8 `DELETE /api/ai-chat/images/:id` — 撤销未发送附件

仅 `messageId=null` 的附件可删（已发送的随会话删除）；同时删除节点文件。响应 `{ ok: true }`。

---

## 5. 管理端点（能力 `ai:configure`）

### 5.1 `GET /api/ai-chat/config`

响应同配置全字段，`apiKey` 脱敏为 `sk-…xxxx`。

### 5.2 `PUT /api/ai-chat/config`

请求（全部可选）：`{ provider?, model?, apiKey?, baseUrl?(可 null), systemPrompt?, dailyLimit?(0–100000，0=不限), isEnabled? }`。

- `apiKey` 传入脱敏值（`sk-…` 开头）视为未修改并剔除。
- 保存即时生效，无需重启。

> **图片提问约束**：DeepSeek 官方 API（deepseek-chat / deepseek-reasoner）为纯文本模型；需要图片理解时把 `baseUrl` + `model` 指向支持视觉的 OpenAI 兼容端点（如通义千问 qwen-vl 系列、GLM-4V 等）。模型不支持时上游会报错，经统一错误映射返回 502 文案。

---

## 6. 前端

| 位置 | 说明 |
|---|---|
| `/deepseek` | 对话页（`ProtectedRoute`，登录可见）：双栏布局（会话列表 + 对话区，窄屏折叠）、流式渲染、图片/拍照按钮（复用 `ChatCameraDialog`，无 getUserMedia 时退回 `capture` 文件输入）、额度徽标 |
| `/features` | 「功能页面」入口卡（badge「需登录」） |
| 侧边栏 | Personal 分组「AI 对话」项（登录过滤） |
| `/admin/ai-chat` | 「AI 对话设置」管理页：启用开关、DeepSeek/OpenAI/通义千问预设、每日上限、System Prompt、图片能力提示 |
| `lib/aiChat.ts` | REST 封装 + `streamAiChatMessage()`（原生 fetch 解析 SSE；429 错误携带 `quota`） |
| `lib/markdown.ts` | `renderMarkdown`（自 AiAssistant 抽取共享，DOMPurify 消毒） |

---

## 7. 自检

```bash
cd server && npm run verify:aichat   # 纯函数自检（日期边界/配额/标题/DTO 等 36 断言）
```

E2E 联调（无真实 Key）：本地起 OpenAI 兼容 mock（支持 `stream:true` 的 SSE + `[DONE]`），`PUT /api/ai-chat/config` 把 `baseUrl` 指向 mock 后即可全链路验证；测完恢复配置并清理测试会话。

---

## 8. 安全与边界

- **属主校验**：会话与图片统一「非本人/不存在 → 404」，不泄露存在性；附件认领在事务内以「本人 + 未认领」原子限定，不能重放他人 imageId。
- **每日配额**：外层快速失败（429 JSON）+ 事务内复核（封住并发窗口，SQLite 写串行下严格成立）。
- **应用令牌 / 下载票据**：一律 403（不在白名单）；`?token=` 直链仅限图片读取端点。
- **存储隔离**：`_ai/` 已加入 `storageSync.SYSTEM_DIRECTORIES`，不进网盘目录树；`compression` 对 AI 图片与 SSE 端点精确豁免（保留 `Content-Length` / 避免缓冲）。
- **上游错误**：统一经 `toAiError` 映射（401→502 Key 无效、429→429、超时→504、其余→502），不向上游泄露内部信息。
