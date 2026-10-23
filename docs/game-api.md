# LineWeb 游戏 API 接入文档（2048 单机 / 好友联机）

> 适用版本：2026-10（游戏大厅 + 2048 好友联机 + 无 WebSocket 轮询降级）
> 相关文档：[`chat-api.md`](./chat-api.md)（好友关系与聊天 API）、[`api.md`](./api.md)（全部端点）
> 服务端实现：`server/src/routes/games.ts`、`server/src/services/gameService.ts`、`server/src/services/game2048.ts`、`server/src/services/gamePresence.ts`
> 前端实现：`client/src/pages/games/`、`client/src/contexts/GameContext.tsx`、`client/src/lib/games/`

---

## 1. 概述

游戏模块首期提供 **2048**：

- **单机版**：`/games/2048`，游客可用，纯前端运行，不上传棋盘/分数。
- **好友联机版**：`/games/2048/online`，登录后用现有好友关系创建/加入**等待房间**，支持 **2–10 人**同步竞速。
  - 房主邀请好友；好友接受邀请后**双方一同进入房间**（房主在发出邀请时即进入房间）。
  - 房间内任何成员都可继续邀请自己的好友；房主点击「开始游戏」后，所有玩家拿到**完全相同**的初始棋盘（同一 `seed`）。
  - 先合成 **2048** 的玩家获胜。
  - 无路可走/认输/掉线会**淘汰该玩家**，其余玩家继续；最后存活者获胜，全部出局按分数判定。
  - 房主开始时可选择 **1–60 分钟**竞速时长（默认 10 分钟），到时在存活玩家中按分数判定，平分平局。
- **服务端权威**：服务端保存所有玩家棋盘与 RNG 状态，客户端只提交移动方向，不能提交棋盘/分数。
- **实时推送**：复用聊天 WebSocket `/ws/chat` 的 `game:*` 事件；无 WebSocket 时自动降级为 HTTP 轮询。

> 本 MVP **不持久化对局/邀请**：数据保存在服务进程内存中，服务重启后所有对局失效（客户端提示重新开始）。不提供战绩历史、排行榜、观战、群战、陌生人匹配或离线邀请。

---

## 2. 认证与通用约定

| 项 | 说明 |
|---|---|
| 基础 URL | `/api` |
| 凭证 | 账号登录令牌 `Authorization: Bearer <token>`（`POST /api/auth/login`） |
| 应用令牌 | **不可用**：`/api/games/*` 不在 OAuth 应用白名单内，返回 403 |
| 下载票据 | **不可用**：仅允许文件下载端点 |
| 时间 | 所有时间字段为 ISO 8601 字符串 |
| 错误格式 | `{ "error": "中文错误信息" }` |
| 常见状态码 | 400 参数/规则错误；401 未登录；403 非好友/非参与者；404 不存在或非参与者；409 冲突；410 邀请过期；429 频控；503 游戏服务繁忙 |
| 非参与者 | 访问对局统一返回 404，不泄露对局是否存在 |
| 频控 | 移动 900 次 / 5 分钟 / 用户；sync 1800 次 / 5 分钟 / 用户；presence 120 次 / 5 分钟 / 用户；其它游戏写操作 60 次 / 5 分钟 / 用户 |

---

## 3. DTO

### 3.1 `GameInviteDto`

```json
{
  "id": 12,
  "matchId": 7,
  "from": { "id": 1, "username": "alice" },
  "to": { "id": 2, "username": "bob" },
  "createdAt": "2026-10-23T15:00:00.000Z",
  "expiresAt": "2026-10-23T15:01:00.000Z"
}
```

### 3.2 `Game2048MatchDto`

```json
{
  "id": 7,
  "game": "2048",
  "hostId": 1,
  "status": "playing",
  "version": 5,
  "durationMs": 600000,
  "startedAt": "2026-10-23T15:02:00.000Z",
  "endsAt": "2026-10-23T15:12:00.000Z",
  "endedAt": null,
  "winnerId": null,
  "reason": null,
  "players": [
    {
      "userId": 1,
      "username": "alice",
      "score": 124,
      "maxTile": 64,
      "moves": 18,
      "status": "playing",
      "online": true,
      "board": [[2, 0, 4, 0], [0, 8, 0, 0], [0, 0, 16, 0], [0, 0, 0, 32]]
    }
  ]
}
```

- `hostId` 为房主；只有房主可以开始游戏/解散等待房间。
- `durationMs`：竞速时长（毫秒）；等待房间中为默认 10 分钟（600000），开始后为房主选择值（1–60 分钟）。
- `status`：`waiting`（等待房间，1–10 人）、`playing`（竞速中）、`finished`（已结束）。
- `players` 为 **1–10 名玩家**；等待房间中玩家 `status = "waiting"` 且 `board` 为空棋盘；开始后统一初始化为 `playing`。`board` 为 4×4 数字矩阵，`0` 表示空位。
- `online` 由服务端判定：聊天 WebSocket 在线 **或** 最近 90 秒内收到游戏 presence 心跳。
- `reason`：`target`（合成 2048）、`timeout`（超时按分数）、`last_standing`（最后存活）、`elimination`（全部出局按分数）、`cancelled`（房间解散）；兼容保留 `blocked` / `resign` / `forfeit` 文案。进行中为 `null`。
- `timeout` / `elimination` 且 `winnerId === null` 表示平局。
- `version` 单调递增；客户端应丢弃低于当前版本的旧状态。

### 3.3 `GameFriendDto`

```json
{ "id": 2, "username": "bob", "online": true, "inMatch": false }
```

---

## 4. REST 端点

### 4.1 好友列表

```http
GET /api/games/2048/friends
```

响应：

```json
{ "friends": [{ "id": 2, "username": "bob", "online": true, "inMatch": false }] }
```

- 仅返回当前用户的好友；`online` 使用 WS/presence 可用性；`inMatch` 表示好友正在进行一场对局。

### 4.2 邀请列表

```http
GET /api/games/2048/invites
```

响应：

```json
{ "incoming": [], "outgoing": [{ "id": 12, "from": { "id": 1, "username": "alice" }, "to": { "id": 2, "username": "bob" }, "createdAt": "...", "expiresAt": "..." }] }
```

- 只返回未过期的待处理邀请。

### 4.3 发起邀请

```http
POST /api/games/2048/invites
Content-Type: application/json

{ "friendId": 2 }
```

响应 `201`：

```json
{
  "invite": { "id": 12, "matchId": 7, "from": { "id": 1, "username": "alice" }, "to": { "id": 2, "username": "bob" }, "createdAt": "...", "expiresAt": "..." },
  "match": { "id": 7, "game": "2048", "hostId": 1, "status": "waiting", "version": 1, "players": [] }
}
```

规则：

- 只能邀请好友；目标必须可用（WS 在线或 presence 未过期）；目标不能已在等待房间/对局中。
- 邀请者没有等待房间时自动创建，邀请者为房主；同一房间可以向多名好友同时发出邀请。
- 房间最多 **10 人**（含房主）；房间满时返回 409。
- 同一好友重复发起会幂等返回已有邀请；目标已有反向待处理邀请时返回 409。
- 邀请有效期 60 秒。

### 4.4 响应邀请

```http
POST /api/games/2048/invites/12/respond
Content-Type: application/json

{ "action": "accept" }
```

`action` 为 `accept` 或 `decline`。

响应（接受）：

```json
{ "ok": true, "match": { "id": 7, "game": "2048", "hostId": 1, "status": "waiting", "version": 2, "players": [] } }
```

响应（拒绝）：

```json
{ "ok": true }
```

规则：

- 仅收件人可操作；邀请过期返回 410；房间已开始/已解散、房间已满返回 409 并清理邀请。
- 接受后**加入等待房间**（不会立刻开局），双方收到 `game:match:update`；接受者应跳转到房间页。
- 房间内任意成员都可以继续邀请好友，直到 10 人上限。
- 接受者的其它邀请会被清理，避免同时加入多个房间。

### 4.5 取消邀请

```http
DELETE /api/games/2048/invites/12
```

响应：`{ "ok": true }`。仅邀请人可操作。

### 4.6 统一状态同步（轮询降级）

```http
GET /api/games/2048/sync
GET /api/games/2048/sync?matchId=7
```

响应：

```json
{
  "serverTime": "2026-10-23T15:02:03.000Z",
  "invites": { "incoming": [], "outgoing": [] },
  "match": { "id": 7, "game": "2048", "status": "playing", "version": 3, "players": [] }
}
```

- 不带 `matchId`：`match` 为当前等待房间或进行中对局，没有则为 `null`。
- 带 `matchId`：返回指定房间/对局（含已结束且仍在 5 分钟保留期内的结果）；不存在或非参与者返回 404。
- 等待房间超过 30 分钟会被 sweeper 解散（`reason = "cancelled"`）。
- 该端点不更新 presence；客户端需单独发送心跳。

### 4.7 在线心跳（轮询降级）

```http
POST /api/games/2048/presence
```

响应：

```json
{ "ok": true, "serverTime": "2026-10-23T15:02:03.000Z" }
```

- 无 WebSocket 的设备应每 20 秒发送一次；服务端 TTL 90 秒。
- 该心跳只用于游戏可用性判定，不改变聊天 WebSocket 的在线语义。

### 4.8 当前/指定对局

```http
GET /api/games/2048/matches/active
GET /api/games/2048/matches/:id
```

`active` 响应 `{ "match": null }` 或 `{ "match": MatchDto }`；`:id` 返回 `{ "match": MatchDto }`。

### 4.9 开始游戏 / 离开房间

```http
POST /api/games/2048/matches/7/start
POST /api/games/2048/matches/7/leave
```

- `start`：仅房主；房间需处于 `waiting` 且人数 **2–10**；可传 `{ "durationMinutes": 3 }`（1–60，默认 10）选择竞速时长。成功后所有玩家获得同一 `seed` 的初始棋盘，`status` 切到 `playing`，推送 `game:match:started`。
- `leave`：仅 `waiting` 房间可用；普通玩家离开会从房间移除，房主离开会解散房间（`status: finished`, `reason: "cancelled"`）。
- 已开始的对局不能 `leave`，请使用 `resign`。

### 4.11 移动

```http
POST /api/games/2048/matches/7/moves
Content-Type: application/json

{ "direction": "left" }
```

`direction`：`up` / `down` / `left` / `right`。

响应：

```json
{ "match": { "id": 7, "version": 4, "players": [] }, "moved": true }
```

- 只有当前对局参与者可操作；已淘汰玩家不能继续移动。
- 无效（棋盘没有变化）移动返回 `200 { "match": ..., "moved": false }`，不递增版本、不广播。
- 有效移动递增 `version`；若玩家合成 2048 → 该玩家获胜（`target`）；若玩家无路可走 → 该玩家淘汰，其余玩家继续；只剩 1 人时 `last_standing`，全部出局时按分数 `elimination`。
- 对局结束/超时返回 409。

### 4.12 认输

```http
POST /api/games/2048/matches/7/resign
```

响应 `{ "match": MatchDto }`；认输者淘汰，其余玩家继续；只剩 1 人时该玩家获胜（`last_standing`）。

---

## 5. WebSocket 事件（复用 `/ws/chat`）

连接与认证方式与聊天完全一致：

1. 连接 `ws(s)://<host>/ws/chat`。
2. 5 秒内发送 `{ "type": "auth", "token": "<账号登录令牌>" }`。
3. 收到 `{ "type": "auth_ok", "userId": N }` 后开始接收事件。
4. 认证失败以 close code `4001` 断开。

### 5.1 游戏事件

| 事件 | 载荷 | 接收方 |
|---|---|---|
| `game:invite` | `{ type, invite: GameInviteDto }` | 被邀请人 |
| `game:invite:removed` | `{ type, inviteId, reason: 'accepted'\|'declined'\|'cancelled'\|'expired' }` | 双方 |
| `game:match:started` | `{ type, match: MatchDto }` | 房间内全部玩家 |
| `game:match:update` | `{ type, match: MatchDto }` | 房间内全部玩家（等待房间加入/离开、对局移动、淘汰） |
| `game:match:ended` | `{ type, match: MatchDto }` | 房间内全部玩家（含房间解散 `reason=cancelled`） |

> 游戏事件与聊天事件共用同一个连接；`ChatContext` 会把非心跳事件转发给订阅者。客户端必须同时处理「WS 事件」与「轮询 sync」两条路径，不能假设 WS 一定可用。

---

## 6. 无 WebSocket 降级

### 6.1 自动切换

- WebSocket 不存在、构造失败、握手 8 秒超时、连接关闭且尚未重新认证成功时，客户端进入 `transport = 'polling'`。
- WS 重新 `auth_ok` 后自动切回 `transport = 'ws'`。
- 轮询期间所有写操作（邀请、接受、移动、认输、发消息等）仍走 REST。

### 6.2 轮询建议

| 数据 | 间隔 |
|---|---|
| 当前对局状态（`sync?matchId=`） | 2 秒 |
| 邀请/当前对局（`sync`） | 5 秒 |
| presence 心跳 | 20 秒 |
| 聊天当前会话消息 | 10 秒 |
| 聊天会话列表 | 30 秒 |
| 聊天未读摘要 | 30 秒 |
| 聊天好友/申请 | 60 秒 |

### 6.3 在线判定与判负

- 服务端：`online = chatHub.isUserOnline(userId) || gamePresence.isGamePresent(userId)`。
- presence TTL：90 秒；心跳 20 秒。
- 掉线判负：玩家连续不可用超过 **120 秒**，且对手可用，判对手获胜（`forfeit`）。
- 后台标签页节流到约 1 次/分钟时，90 秒 TTL + 120 秒判负仍可容忍。

### 6.4 强制轮询（调试/排障）

- 访问任意页面并带上 `?transport=polling`：写入 `localStorage.lineweb_force_polling=1`，本次及后续加载强制轮询。
- 访问 `?transport=auto`：清除标记，恢复自动检测。
- 该开关主要用于验证降级链路或临时绕过被阻断的 WS；生产默认自动检测，无需用户设置。

### 6.5 降级限制

- 聊天只合并最近 50 条消息；极旧消息的撤回可能延迟到手动刷新/重新进入会话。
- 对局/邀请状态为**尽力实时**：轮询期间对手进度最多延迟约 2 秒，邀请最多延迟约 5 秒。
- 服务进程重启后，内存中的对局与邀请全部失效；客户端 GET 返回 404，应提示重新开始。

---

## 7. 错误码速查

| 场景 | 状态码 |
|---|---|
| 未登录 / 令牌失效 | 401 |
| 非好友邀请、非参与者访问对局 | 403 / 404 |
| 对局/邀请/房间不存在、非参与者 | 404 |
| 对方不可用、已在房间/对局、房间已满（10 人）、重复邀请冲突 | 409 |
| 邀请已过期 | 410 |
| 移动/同步/心跳过频 | 429 |
| 参数错误（方向、friendId、action） | 400 |
| 活跃对局达到上限 | 503 |

---

## 8. 典型流程（curl）

```bash
BASE=http://localhost:3001/api
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"alice","password":"你的密码"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 好友列表
curl "$BASE/games/2048/friends" -H "Authorization: Bearer $TOKEN"

# 邀请好友（bob userId=2）
curl -X POST $BASE/games/2048/invites -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"friendId":2}'

# 对方接受后，查看当前对局
curl "$BASE/games/2048/matches/active" -H "Authorization: Bearer $TOKEN"

# 房主开始游戏（2–10 人）
curl -X POST "$BASE/games/2048/matches/7/start" -H "Authorization: Bearer $TOKEN"

# 移动
curl -X POST "$BASE/games/2048/matches/7/moves" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"direction":"left"}'

# 轮询同步 + 在线心跳（无 WebSocket 设备）
curl "$BASE/games/2048/sync?matchId=7" -H "Authorization: Bearer $TOKEN"
curl -X POST "$BASE/games/2048/presence" -H "Authorization: Bearer $TOKEN"

# 认输
curl -X POST "$BASE/games/2048/matches/7/resign" -H "Authorization: Bearer $TOKEN"
```

---

## 9. 部署与限制

- 不新增数据库表；房间/对局/邀请/presence 均在服务端内存中。
- 每个房间最多 **10 名玩家**（含房主），最少 2 人开局；等待房间 30 分钟过期；房主开始时可选择 1–60 分钟竞速时长。
- 好友接受邀请后，房主与接受者都会被带入同一个等待房间；房主开始后所有参与者自动进入对局页。
- 生产为单 Express 容器；未来水平扩容需 Redis 或数据库承载对局状态。
- 不涉及存储节点、网盘配额或文件上传。
- 客户端单机版最高分保存在浏览器 `localStorage`（`lineweb_2048_best`）。
