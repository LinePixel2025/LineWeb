# LineWeb 聊天 API 接入文档

> 适用版本：2026-10（**聊天已迁移到独立 XMPP 服务 internet_neko**；好友关系仍以 LineWeb 为准）
> 相关文档：[`api.md`](./api.md)（全部端点）、[`auth-api.md`](./auth-api.md)（账号登录令牌与角色能力）
> 服务端实现：`server/src/routes/chatXmpp.ts`、`server/src/routes/chatUploads.ts`、`server/src/services/nekoChat.ts`、`server/src/services/nekoWsProxy.ts`；好友：`routes/chat.ts` + `services/chatService.ts`
> 前端实现：`client/src/pages/ChatPage.tsx`、`client/src/contexts/XmppChatContext.tsx`、`client/src/lib/xmpp/*`

---

## 0. 聊天已迁移到 XMPP（2026-10）

**结论先说**：私信 / 群聊的**消息收发与历史**已整体搬到 `senlinjun/internet_neko` 独立 XMPP 服务（LineWeb 只读调用其迁移 API，未修改 neko 一行代码）。用户**不需要重新注册**：LineWeb 账号由服务端自动同步为 neko 账号，浏览器始终只访问 LineWeb 同源地址。

### 0.1 账号与 JID 映射

| 概念 | 规则 |
|---|---|
| neko 账号 id | `1000000000000 + LineWeb userId`（`NEKO_CHAT_ACCOUNT_BASE`） |
| neko 用户名 | `lw_<LineWeb userId>`，固定不变；LineWeb 用户名写入 `displayName` |
| 单聊 JID | `lw_<U>@<domain>`；neko 原生账号为 `<username>@<domain>` |
| 群聊 JID | `room-<roomId>@muc.<domain>` |
| 会话键（前端） | 单聊 `u<nekoId>`、群聊 `r<roomId>`；游戏邀请需换算回 LineWeb id |

> neko 侧账号由服务端幂等创建（启动后台批量同步 + 注册/改名按需补建 + 停用/删除时同步停用）。密钥（`NEKO_CHAT_TOKEN`）只存在于服务器 `.env`，绝不下发浏览器。

### 0.2 新增端点（前缀 `/api/chat/xmpp`，均需登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/bootstrap` | 一次性票据 + 过滤后的状态（好友 / 有往来的原生联系人 / 群 / 申请 / 置顶） |
| GET | `/ticket` | 重连前换新票据（neko 票据一次性） |
| GET | `/state` | 刷新状态（轮询降级用） |
| GET | `/directory?q=` | 搜 neko 用户（≤30 条；`lw_*` 只回好友；原生账号受 `NEKO_CHAT_ALLOW_NATIVE` 控制） |
| GET | `/users?jids=` | 陌生来信反查 `{nekoId, username, displayName, online}` |
| POST | `/rooms` | 建群 `{name, memberIds}` → `{ok, roomId}` |
| POST | `/rooms/:id/name` | 改群名 `{name}` |
| POST | `/rooms/:id/members` | 加人 `{addIds}` / 移人 `{removeIds}` |
| POST | `/rooms/:id/leave` | 退群 |
| POST | `/rooms/:id/disband` | 解散（群主） |
| POST | `/rooms/:id/role` `/transfer` `/mute` `/mute-all` `/announcement` | 群权限、转让、禁言、公告 |
| POST | `/messages/recall` | 撤回 `{id}`（**窗口 5 分钟**，仅本人的消息） |
| POST | `/messages/admin-recall` | 群主 / 管理员撤回群消息 |
| POST | `/uploads` | 图片上传（`multipart/form-data`，字段 `file`）→ `{ok, url, id, mime}` |
| POST | `/http-session` | 轮询降级：创建 HTTP 会话 |
| POST | `/http-stanza` | 轮询降级：发送一帧（**同样做单聊好友校验**，非好友 403） |
| GET | `/http-poll` | 轮询降级：长轮询取帧（最长 25 秒） |
| POST | `/http-close` | 轮询降级：关闭会话 |

**实时连接**：`wss://<站点>/ws/xmpp?token=<登录令牌>` —— Express 字节级中继到 neko `/xmpp-websocket`（剥 Origin、注入内部令牌、空闲 120 秒关闭、单聊好友校验）。WebSocket 不可用或 `?transport=polling` 时自动降级为上面的 `http-*` 长轮询。

**图片读取**：`GET /chat/uploads/<24 位 hex id>?token=<登录令牌>`（挂在 `/api` 之外的同源路径，未带令牌 401；字节透传 neko）。

### 0.3 旧端点去向

| 端点 | 现状 |
|---|---|
| `GET/POST /api/chat/conversations*`、`/api/chat/messages*` | **410 Gone**，`{error:'聊天已迁移到 XMPP 服务', code:'CHAT_MIGRATED'}` |
| `POST /api/chat/conversations/:id/images`、`GET /api/chat/messages/:id/image` | 410（改用 `/api/chat/xmpp/uploads` 与 `/chat/uploads/:id`） |
| `GET /api/chat/summary` | 保留，`unreadTotal` 恒为 `0`（未读改由客户端统计），`pendingFriendRequests` 照旧 |
| 好友：`/api/chat/friends*`、`/users/search`、申请 `respond/remove/remark` | 保留不变（LineWeb Prisma 仍是唯一真相源） |
| `/ws/chat` | 保留，**只承载 `game:*` 与好友事件**；聊天消息不再从这里推送 |

### 0.4 行为差异（与迁移前对比）

- **撤回窗口 2 分钟 → 5 分钟**（neko 固定，前端文案与判断同步）。
- **未读数是客户端水位**（`localStorage['lineweb_neko_read:<会话键>']`）：neko 没有服务端未读接口，换设备 / 清缓存后首屏未读可能偏少。
- **历史消息不迁移**：旧消息仍在 Prisma 表与存储节点 `_chat/` 中，仅作只读存档，UI 不再展示。
- **原生 neko 用户可互通**（默认开放）：能单聊、拉群、被搜到；但他们不是 LineWeb 好友，因此**没有好友申请 / 备注 / 游戏邀请**。关闭开关 `NEKO_CHAT_ALLOW_NATIVE=false` 后只保留 LineWeb 好友之间的会话。
- **单聊好友校验**：发往 `lw_*` 的单聊消息在服务端中继层校验 Prisma 好友关系（WS 与轮询两条路径口径一致），非好友回 `not-authorized`。

### 0.5 下线与降级

- `NEKO_CHAT_ENABLED=false`（或缺少令牌）：`/api/chat/xmpp/*` 返回 `503 NEKO_UNAVAILABLE`，聊天页显示「聊天服务未配置/暂不可用」，站点其他功能不受影响。
- neko 主机不可达：同上（503），不影响文章、网盘、游戏等模块。

> 以下第 1～7 章为**迁移前的自建聊天实现**，仅作存档参考；其中会话 / 消息相关端点已全部返回 410。

---

## 1. 概述（迁移前存档）

聊天模块提供：

- **好友**：搜索用户、发送好友申请、接受 / 拒绝、删除好友（双向删除，保留历史会话）。
- **私聊**：仅好友之间可以创建一对一会话；取消好友后历史仍可查看，但不能再发消息。
- **群聊**：创建者（群主）只能邀请**自己的好友**；群上限 50 人；群主可改名、加人、移人、解散；成员可退群。
- **图片消息**：`multipart/form-data` 上传，服务端用 sharp 统一转成 WebP（EXIF 方向校正、长边 ≤ 2048），文件存到存储节点 `_chat/<conversationId>/`；单张原图上限 10 MB。
- **撤回**：发送者可在**消息发出后 2 分钟内**撤回；双方都看到「你 / xxx 撤回了一条消息」，正文与图片立即清除。
- **实时推送**：REST 负责持久化与校验，`/ws/chat` 负责服务端 → 客户端推送；断线重连后以 REST 为准重新拉取。
- 仍不支持：文件消息、编辑、引用、typing / presence、黑名单。
- **空间配额**：聊天图片计入发送者的网盘空间配额（`User.storageQuota`，默认 2 GiB；`drive:all` 角色不限），撤回后释放。

---

## 2. 认证与通用约定

| 项 | 说明 |
|---|---|
| 基础 URL | `/api`（开发 `http://localhost:3001/api`，生产 `https://web.linetech.online/api`） |
| 凭证 | 账号登录令牌：`Authorization: Bearer <token>`（`POST /api/auth/login` 获取） |
| 应用令牌 | **不可用**：聊天端点不在 OAuth 应用白名单内，返回 403；`/ws/chat` 也会拒绝应用令牌与下载票据 |
| 错误格式 | `{ "error": "中文错误信息" }`；参数校验失败可能带 `details` |
| 状态码 | `400` 参数/规则错误；`401` 未登录；`403` 无权限/非好友/群主专属操作；`404` 资源不存在或非成员（不泄露存在性）；`409` 状态冲突（已是好友、申请已处理）；`429` 频控 |
| 频控 | 聊天写操作（POST/PUT/DELETE）：**每用户 5 分钟 120 次**；好友申请额外限制「发出的 pending 申请 ≤ 20 条」 |
| 时间 | 所有 `createdAt` / `lastMessageAt` 为 ISO 8601 字符串 |

> **非成员访问会话/消息统一返回 404**，避免通过状态码探测他人会话是否存在。

---

## 3. 好友

### 3.1 搜索用户

```http
GET /api/chat/users/search?q=<username片段>
```

- `q`：1–50 字符；按用户名 `contains` 匹配（大小写按数据库默认行为，SQLite/PostgreSQL 均为区分大小写）。
- 最多返回 20 条；**不返回邮箱**。

```json
{
  "users": [
    { "id": 2, "username": "alice", "relation": "none" },
    { "id": 5, "username": "alice2", "relation": "outgoing" }
  ]
}
```

`relation`：`none`（无关系）/ `friend`（已是好友）/ `outgoing`（我已发出 pending 申请）/ `incoming`（对方已向我发出 pending 申请）。

### 3.2 好友列表

```http
GET /api/chat/friends
```

```json
{ "friends": [ { "id": 2, "username": "alice" } ] }
```

### 3.3 好友申请

```http
GET  /api/chat/friend-requests
POST /api/chat/friend-requests                { "userId": 2 }
POST /api/chat/friend-requests/:id/accept
POST /api/chat/friend-requests/:id/reject
```

- `GET` 只返回 **pending** 的申请（历史 accepted/rejected 不再展示）：

```json
{
  "incoming": [
    { "id": 9, "user": { "id": 4, "username": "bob" }, "status": "pending", "createdAt": "2026-10-23T12:00:00.000Z" }
  ],
  "outgoing": []
}
```

- `POST` 发送申请：`201`；自己 → 400；用户不存在 → 404；已是好友 → 409；已有同向 pending → 409；对方已有反向 pending → 409；pending 发出数 ≥ 20 → 429。
- 被拒绝后可以重新申请（复用同一条申请记录，状态置回 pending）。
- `accept` / `reject` 仅收件人可操作：非收件人 403、不存在 404、已处理 409。

### 3.4 删除好友

```http
DELETE /api/chat/friends/:userId
```

- 双向删除好友关系；**不删除**历史会话与消息。
- 非好友返回 404。
- 删除后双方私聊 `canSend` 变为 false，发消息返回 403 `你们已不是好友，无法发送消息`。

---

## 4. 会话与消息

### 4.1 会话列表

```http
GET /api/chat/conversations
```

按 `lastMessageAt` 倒序，最多 50 条；返回每个会话的成员、最后一条消息、未读数与是否可发送。

```json
{
  "conversations": [
    {
      "id": 12,
      "type": "direct",
      "name": null,
      "ownerId": null,
      "members": [
        { "id": 1, "username": "me", "role": "member" },
        { "id": 2, "username": "alice", "role": "member" }
      ],
      "lastMessage": {
        "id": 88,
        "conversationId": 12,
        "senderId": 2,
        "sender": { "id": 2, "username": "alice" },
        "content": "在吗",
        "createdAt": "2026-10-23T12:00:00.000Z",
        "type": "text",
        "recalledAt": null,
        "image": null
      },
      "unreadCount": 1,
      "lastMessageAt": "2026-10-23T12:00:00.000Z",
      "canSend": true
    }
  ]
}
```

- `unreadCount`：`id > 我的 lastReadMessageId` 且不是自己发送的消息数。
- `canSend`：私聊要求双方仍为好友；群聊恒为 true。

### 4.2 创建 / 获取私聊会话

```http
POST /api/chat/conversations/direct   { "userId": 2 }
```

- 必须好友，否则 403。
- 幂等：同一对用户永远返回同一个会话（`directKey = "minUserId:maxUserId"`）。
- 返回 `{ "conversation": { ...同会话列表项... } }`。

### 4.3 创建群聊

```http
POST /api/chat/conversations/group   { "name": "项目组", "memberIds": [2, 3] }
```

- `name` 1–60 字；`memberIds` 至少 1 人、最多 49 人（含创建者共 ≤ 50）。
- 全部邀请对象必须是**创建者的好友**，否则 400 并列出非好友 id。
- 返回 `201 { "conversation": { ... } }`；创建者 `members[].role = "owner"`。

### 4.4 历史消息（游标分页）

```http
GET /api/chat/conversations/:id/messages?before=<messageId>&limit=30
```

- 仅成员可读，否则 404。
- `limit` 默认 30、最大 100；`before` 为上一页最早一条消息 id（可选）。
- 返回按 id **正序**（旧 → 新）的消息数组与是否还有更早消息：

```json
{
  "messages": [
    {
      "id": 88,
      "conversationId": 12,
      "senderId": 2,
      "sender": { "id": 2, "username": "alice" },
      "content": "在吗",
      "createdAt": "2026-10-23T12:00:00.000Z",
      "type": "text",
      "recalledAt": null,
      "image": null
    }
  ],
  "hasMore": false
}
```

> `type`：`text` | `image`；`recalledAt` 非空表示已撤回（此时 `content` 为空串、`image` 为 `null`）；
> `image` 仅图片消息有值：`{ width, height, size }`，`size` 为字节数字符串。图片内容本身不内联在消息里，用 `GET /chat/messages/:id/image` 读取。

### 4.5 发送文本消息

```http
POST /api/chat/conversations/:id/messages   { "content": "你好" }
```

- 仅成员可发；`content` trim 后 1–2000 字（空消息 400、过长 400）。
- 私聊要求双方仍是好友，否则 403。
- 返回 `201 { "message": { ... } }`，并通过 WebSocket 向全部成员推送 `message:new`（包括发送者自己的其它标签页）。

### 4.6 发送图片消息

```http
POST /api/chat/conversations/:id/images
Content-Type: multipart/form-data
字段：file=<图片文件>
```

- 仅成员可发；私聊要求双方仍是好友；写操作限流同上。
- 支持格式：JPEG / PNG / WebP / GIF；单张**原图上限 10 MB**（服务端处理后 WebP 再限制 4 MiB）。
- 服务端用 sharp 处理：EXIF 方向校正 → 长边缩放到 ≤ 2048（不放大）→ 输出 WebP（quality 82）；处理后文件写入存储节点 `_chat/<conversationId>/<uuid>.webp`。动图（GIF）只保留首帧，统一为静态 WebP。
- 成功返回 `201 { "message": { ... } }`，并广播 `message:new`；图片消息的 `content` 为空串、`type` 为 `image`。
- 错误：
  - `400 仅支持图片格式（JPEG/PNG/WebP/GIF）`
  - `400 图片处理失败，请换一张图片重试`
  - `502 图片保存失败，请稍后重试`（存储节点写入失败）
  - `413` 单张超限：`{ "error": "图片大小超过限制 (10.0 MB)", "code": "IMAGE_TOO_LARGE" }`
  - `413` 配额不足：`{ "error": "网盘空间不足（剩余 1.2 GB）", "code": "QUOTA_EXCEEDED", "quota": "2147483648", "used": "940000000", "remaining": "0" }`（字节数均为字符串）
  - `503 存储节点未接入，暂时无法发送图片`（本地未运行 storage-node 时）
- 图片字节数计入**发送者**的网盘配额；撤回后从配额中释放。

### 4.7 读取图片

```http
GET /api/chat/messages/:id/image
Authorization: Bearer <token>        # 或 ?token=<token>（<img src> 直链）
```

- 返回 `image/webp`，带 `Cache-Control: private, max-age=31536000, immutable`（图片内容不可变，可按 URL 长期缓存）。
- 仅会话成员可读，否则 404（不泄露存在性）；非图片消息、已撤回消息同样 404。
- 存储节点未接入返回 503。
- `<img src="...">` 无法设置请求头，因此支持 `?token=` 查询参数（下载直链同款机制）；不要把带令牌的 URL 长期保存或分享。

### 4.8 撤回消息

```http
POST /api/chat/messages/:id/recall
```

- 仅**发送者本人**可撤回，且仅在消息发出后 **2 分钟内**（服务端时间为准）。
- 撤回后：正文清空、`recalledAt` 置为当前时间；若为图片消息，服务端会删除存储节点上的图片文件并清空 `image` 信息。
- 返回 `{ "message": { ... } }`（已撤回状态），并向全部成员广播 `message:recalled`。
- 错误：非发送者 `403 只能撤回自己发送的消息`；已撤回 `409 消息已撤回`；超时 `400 超过撤回时限（2 分钟）`；不存在 / 非成员 `404 消息不存在`。

### 4.9 标记已读

```http
PUT /api/chat/conversations/:id/read   { "lastMessageId": 88 }
```

- 仅成员；已读位置只前进不后退：`lastReadMessageId = max(原值, min(请求值, 最新消息 id))`。
- 返回 `{ "lastReadMessageId": 88 }`。

### 4.10 摘要（侧边栏角标）

```http
GET /api/chat/summary
```

```json
{ "unreadTotal": 3, "pendingFriendRequests": 1 }
```

---

## 5. 群管理

| 方法 | 路径 | 说明 |
|---|---|---|
| `PUT` | `/api/chat/conversations/:id` | 群主改群名，body `{ "name": "新群名" }`（1–60 字）；非群主 403 |
| `POST` | `/api/chat/conversations/:id/members` | 群主加人，body `{ "userIds": [5, 6] }`；只能加群主的好友；总人数 ≤ 50 |
| `DELETE` | `/api/chat/conversations/:id/members/:userId` | 成员退自己（群主退群 400）；群主移除他人；被移除者立即失去读取权限 |
| `DELETE` | `/api/chat/conversations/:id` | 群主解散群聊（级联删除成员与消息）；非群主 403 |

- 群主不能退群，只能解散。
- 加人 / 改名 / 解散成功后通过 WebSocket 广播 `conversation:updated` 或 `conversation:removed`。
- 群成员可以看到入群之前的历史消息（当前实现不按加入时间过滤）。

---

## 6. WebSocket 实时推送

### 6.1 连接与认证

```
ws(s)://<host>/ws/chat
```

1. 连接建立后 **5 秒内**发送认证帧（HTTP 认证头不适用于 WebSocket）：

```json
{ "type": "auth", "token": "<账号登录令牌>" }
```

2. 认证成功：

```json
{ "type": "auth_ok", "userId": 2 }
```

3. 认证失败、令牌失效、下载票据 / 第三方应用令牌：服务端以 **close code `4001`（认证失败）** 断开。客户端应停止自动重连并提示重新登录。

> 不要在 URL 中携带令牌；令牌只放在认证帧里。

### 6.2 心跳

- 服务端每 30 秒发送协议级 ping，未回应 pong 的连接会被断开。
- 客户端也可发送 `{ "type": "ping" }`，服务端回 `{ "type": "pong" }`。
- 浏览器原生 WebSocket 会自动回应协议级 ping，无需业务代码处理。

### 6.3 服务端推送事件

| 事件 | 载荷 | 触发时机 |
|---|---|---|
| `message:new` | `{ type, conversationId, message }` | 新消息（推给全部成员；发送者自己的其它标签页也会收到） |
| `message:recalled` | `{ type, conversationId, message }` | 消息被撤回，`message` 为撤回后的状态（`recalledAt` 非空） |
| `conversation:updated` | `{ type, conversationId }` | 建群、群改名、加人、移除成员（剩余成员）、好友关系变化后的列表刷新提示 |
| `conversation:removed` | `{ type, conversationId }` | 被移出群 / 退群 / 群解散 |
| `friend:request` | `{ type, request: { id, from: { id, username }, createdAt } }` | 收到好友申请 |
| `friend:accepted` | `{ type, friend: { id, username } }` | 对方接受了我的申请 |
| `friend:rejected` | `{ type, userId }` | 对方拒绝了我的申请 |
| `friend:removed` | `{ type, userId }` | 对方删除了与我的好友关系 |

`message` 字段与 REST 中的消息结构一致（`id / conversationId / senderId / sender / content / createdAt / type / recalledAt / image`）。

> WebSocket 是**尽力实时**通道：断线重连后请重新调用 `GET /chat/conversations` 与当前会话的历史消息接口，未读数以 `GET /chat/summary` / 会话列表为准。

---

## 7. 典型流程（curl）

```bash
BASE=http://localhost:3001/api
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"alice","password":"你的密码"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 搜索用户
curl "$BASE/chat/users/search?q=bob" -H "Authorization: Bearer $TOKEN"

# 发送好友申请（bob 的 userId = 5）
curl -X POST $BASE/chat/friend-requests -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"userId":5}'

# 对方接受后，创建私聊并发送消息
curl -X POST $BASE/chat/conversations/direct -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"userId":5}'
curl -X POST $BASE/chat/conversations/12/messages -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"content":"你好"}'

# 创建群聊（userId 5、6 必须都是我的好友）
curl -X POST $BASE/chat/conversations/group -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"项目组","memberIds":[5,6]}'

# 发送图片（multipart，字段名 file）
curl -X POST $BASE/chat/conversations/12/images -H "Authorization: Bearer $TOKEN" \
  -F "file=@photo.jpg;type=image/jpeg"

# 读取图片（<img> 直链可带令牌；curl 用认证头更方便）
curl "$BASE/chat/messages/89/image" -H "Authorization: Bearer $TOKEN" -o photo.webp

# 撤回 2 分钟内的消息
curl -X POST $BASE/chat/messages/88/recall -H "Authorization: Bearer $TOKEN"
```

---

## 8. 错误码速查

| 场景 | 状态码 |
|---|---|
| 未登录 / 令牌失效 | 401 |
| 非好友创建私聊、取消好友后发消息、非群主操作群、撤回他人消息 | 403 |
| 会话不存在 / 非成员访问、好友申请不存在、图片不存在 / 已撤回 | 404 |
| 已是好友、重复 pending 申请、申请已处理、消息已撤回 | 409 |
| 好友申请过多、写操作过频 | 429 |
| 参数校验失败（空消息、群名过长、成员超限、撤回超时等） | 400 |
| 图片单张超限 / 网盘空间不足 | 413 |
| 存储节点未接入（发图 / 读图） | 503 |

---

## 9. 无 WebSocket 轮询降级

当浏览器不支持 WebSocket、握手被代理阻断或连接超时时，聊天会自动降级为 HTTP 轮询（REST 契约不变）：

| 数据 | 轮询间隔 |
|---|---|
| 当前会话消息 `GET /conversations/:id/messages?limit=50` | 10 秒 |
| 会话列表 `GET /conversations` | 30 秒 |
| 未读摘要 `GET /summary` | 30 秒 |
| 好友 + 好友申请 | 60 秒 |

- 所有发送/撤回/已读/好友操作仍走原有 REST。
- `ChatContext` 暴露 `transport: 'ws' | 'polling'`，界面显示「轮询模式」提示。
- WebSocket 恢复后自动切回实时模式，并补拉一次当前会话与会话列表。
- 轮询模式只合并最近 50 条消息，极旧消息的撤回可能延迟到刷新。
- 调试/排障：`?transport=polling` 强制轮询，`?transport=auto` 恢复自动检测。
- 单标签页轮询约 180 次 / 15 分钟，低于全局 600 次限制；多标签页时请注意频率。
