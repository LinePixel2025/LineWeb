# LineWeb 游戏 API 接入文档（十一款游戏：单机 / 好友联机）

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


---

# 二、斗地主（doudizhu）单机 / 好友联机

> 2026-10 新增。单机为纯前端（引擎 + AI），联机复用 2048 的邀请 / presence /
> 轮询降级基础设施；端点前缀 `/api/games/doudizhu`，实时事件复用 `/ws/chat`。

## 1. 概述

- 3 人房间（恰好 3 人才能开局）：邀请流程与 2048 一致（60 秒有效、房主等待房间）；
- 开局后进入叫分（0–3 分，叫 3 分立即成交；连续 3 轮无人叫分流局解散）；
- 地主拿 3 张底牌并先出牌；先出完手牌者所在阵营获胜；
- 计分：底分 100 × 倍率（炸弹 / 王炸 / 春天 / 反春各 ×2）；地主赢 +2 份、输 −2 份；
- 服务端权威：客户端只提交叫分 / 出牌（手牌 id）/ 不出，牌型与压牌校验全部在服务端；
- **手牌隐私**：对局 DTO 按观看者裁剪，`myHand` 只含自己的牌，其他玩家只有 `cardCount`；
- 与 2048 **跨游戏互斥**：任意游戏中未结束的房间 / 对局会让另一游戏的发起与接受邀请返回 409。

## 2. 对局状态机

```
waiting（等待房间，最多 30 分钟）
  └─ POST /matches/:id/start（房主，恰 3 人）→ bidding（叫分）
       ├─ 叫 3 分 / 三人叫完最高分>0 → playing（出牌）
       │    ├─ 有人出完 → finished（hand_empty，含春天 / 反春倍率）
       │    └─ POST /matches/:id/resign → finished（resign，按当前倍率判负）
       └─ 三人全不叫 → 重新发牌（首叫轮转，最多 3 轮）→ 超过 → finished（no_bid）
```

- 回合时限 90 秒；超时或当前回合玩家离线超 30 秒由 sweeper 自动托管
  （应叫 = 不叫、领出 = 最小可拆单张、跟牌 = 不出）；
- 全员连续不可用 10 分钟 → 对局废弃（abandoned）；
- 对局 / 邀请均为内存态（无数据库表），结束 5 分钟后回收。

## 3. REST 端点（全部需账号登录令牌）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/games/doudizhu/friends` | 好友大厅（含 online / inMatch，inMatch 覆盖全部游戏） |
| GET | `/api/games/doudizhu/invites` | 收到 / 发出的邀请（invite 带 `game:"doudizhu"`） |
| POST | `/api/games/doudizhu/invites` | 邀请好友加入等待房间（body `{friendId}`，无房间自动创建） |
| POST | `/api/games/doudizhu/invites/:id/respond` | 接受 / 拒绝（body `{action}`） |
| DELETE | `/api/games/doudizhu/invites/:id` | 取消自己发出的邀请 |
| GET | `/api/games/doudizhu/sync?matchId=` | 轮询降级统一同步（serverTime + invites + match） |
| POST | `/api/games/doudizhu/presence` | 在线心跳（与 2048 共用 presence TTL 存储） |
| GET | `/api/games/doudizhu/matches/active` | 当前等待 / 叫分 / 出牌中的对局 |
| GET | `/api/games/doudizhu/matches/:id` | 对局详情（按观看者裁剪；非参与者 404） |
| POST | `/api/games/doudizhu/matches/:id/start` | 房主开始（需恰好 3 人） |
| POST | `/api/games/doudizhu/matches/:id/leave` | 离开等待房间（房主离开即解散） |
| POST | `/api/games/doudizhu/matches/:id/actions` | **统一动作入口**（见下） |
| POST | `/api/games/doudizhu/matches/:id/resign` | 认输（叫分阶段认输 = 解散，无积分） |

`actions` 请求体（限流 900/5min/用户，已在全局 600/15min 限流中豁免）：

```json
{ "type": "bid", "bid": 0 }        // 不叫（1–3 为叫分，须高于当前最高）
{ "type": "play", "cards": [12, 25] } // 出牌：手牌 id 列表（服务端校验牌型与压牌）
{ "type": "pass" }                   // 不出（领出 / 新一轮时禁止）
```

## 4. 对局 DTO（按观看者裁剪）

```jsonc
{
  "id": 1, "game": "doudizhu", "hostId": 1,
  "status": "bidding",              // waiting | bidding | playing | finished
  "version": 3,
  "winnerSide": null,               // landlord | farmers | null
  "multiplier": 1,                  // 底分 100 × 倍率 = 每份积分
  "landlordId": null,
  "bottomCards": [],                // 叫分结束后对所有人可见（3 张）
  "seat": 0,                        // 观看者座位（players 按座位排序）
  "players": [{ "userId": 1, "username": "a", "online": true,
                "role": null, "cardCount": 17, "status": "playing",
                "bid": null, "scoreDelta": null }],
  "myHand": [ /* 仅自己的手牌 */ ],
  "bidding": { "turnUserId": 1, "highestBid": 0, "highestBidderId": null,
               "bids": [], "round": 1, "deadline": "ISO" },
  "playing": { "turnUserId": 1, "lastMove": { ... }, "recentMoves": [ ... ], "deadline": "ISO" }
}
```

结束原因 `reason`：`hand_empty`（打完）| `resign` | `no_bid` | `cancelled` | `abandoned`。

## 5. WebSocket 事件（复用 /ws/chat）

事件名与 2048 完全一致（`game:invite` / `game:invite:removed` /
`game:match:started|update|ended`），按载荷判别：

- 邀请：`invite.game === "doudizhu"`（2048 的旧响应缺省该字段，前端按 2048 处理）；
- 对局：`match.game === "doudizhu"`，且**每个玩家收到自己视角的 DTO**；
- 邀请 id 由 `server/src/services/gameIds.ts` 跨游戏统一发号，前端可安全合并同一列表。

## 6. 规则口径（引擎双端一致）

- 牌型：单张 / 对子 / 三张 / 三带一 / 三带二 / 顺子(≥5) / 连对(≥3连) /
  飞机(≥2连三，可带同数量单牌或对子) / 四带二单 / 四带二对 / 炸弹 / 王炸；
- 2 与双王不入顺子 / 连对 / 飞机本体；王炸不拆做翅膀；炸弹不拆做翅膀；
- 前端引擎 `client/src/lib/games/doudizhu.ts` 与服务端
  `server/src/services/gameDoudizhu.ts` 为同源双拷贝，
  由 `client/src/lib/games/__tests__/doudizhu.test.ts` 的对齐测试兜底；
- 单机 AI（`client/src/lib/games/doudizhuAi.ts`）：叫分按手牌强度，
  出牌按「剩余手数最少」启发，农民之间不互相压牌。

## 7. 自检与测试

```bash
cd server && npm run verify:ddz       # 引擎 + 状态机 + 托管 + 流局 + 认输（50 断言）
cd client && npx vitest run src/lib/games/__tests__/doudizhu.test.ts
```

自检脚本在每个阶段开局前调用 `setDoudizhuRandomForTest(mulberry32(seed))` 固定发牌与首个叫分座位
（生产不调用，随机源仍为 `Math.random`）；不播种时脚本会撞上「随机牌局正好不满足脚本假设」的情况，
历史上约 1/3 概率失败。

---

# 三、贪吃蛇（snake）单机 / 同屏双人 / 大地图联机

## 1. 概述

三种玩法共用一套引擎语义：

- **单机冲分**与**同屏双人**（一台电脑、P1 = WASD、P2 = 方向键）为纯前端玩法，
  引擎在 `client/src/lib/games/snake.ts`，最高分与战绩存 localStorage，**不走任何 API**；
- **大地图好友联机**（2–8 人，40×40 共享世界）为服务端权威：客户端只提交方向、只渲染 DTO。
  引擎 `server/src/services/gameSnake.ts`，业务 `gameSnakeService.ts`，路由前缀 `/api/games/snake`。

## 2. 步进模型（与 2048 / 斗地主的关键差异）

贪吃蛇是**服务端定时推进**而非回合制：每个进行中的房间有一个 `SNAKE_STEP_MS = 220ms` 的定时器
（`unref`，房间结束时清理），每步调 `stepSnakeWorld()` 并广播一次 `game:match:update`。
DTO 里给出 `step`（已执行步数）、`stepMs`、`remainingMs`（服务端算好的剩余毫秒，前端不要自己减本地时钟）。
无 WebSocket 时轮询 `sync`（2 秒）依旧可用，画面表现为跳步而非补间。

## 3. REST 端点

与 2048 / 斗地主完全同构（前缀 `/api/games/snake`）：
`GET /friends`、`GET|POST /invites`、`POST /invites/:id/respond`、`DELETE /invites/:id`、
`GET /sync?matchId=`、`POST /presence`、`GET /matches/active`、`GET /matches/:id`、
`POST /matches/:id/start`、`POST /matches/:id/leave`、`POST /matches/:id/actions`、`POST /matches/:id/resign`。

动作体：`{ "type": "turn", "direction": "up" | "down" | "left" | "right" }`
—— 180° 掉头返回 `applied: false` 且不递增版本、不广播。

## 4. 规则口径

- 地图 40×40，8 个固定出生点按座位分配（`colorIndex` 0–7）；
- 普通果 +10 分 / 蛇长 +1，金果 +30 分 / 蛇长 +3，场上恒 6 个果，吃掉即时补种；
- 撞墙、撞任意蛇身（含自己）、双头同一步进入同一格 → 该蛇淘汰；
- 默认 5 分钟一局；只剩一条存活蛇 → `last_standing`；全灭或超时按分数（并列 `winnerId: null` 平局）；
- 认输 = 本蛇判死；掉线连续 120 秒且对手可用 → 淘汰（`forfeit`）；等待房间 30 分钟 → `cancelled`。

结束原因：`last_standing | elimination | timeout | resign | forfeit | cancelled`。

## 5. 自检

```bash
cd server && npm run verify:snake     # 引擎 + 房间状态机 + 结算（170 断言）
cd client && npx vitest run src/lib/games/__tests__/snake.test.ts
```

---

# 四、扫雷（minesweeper）单机 / 好友轮流点

## 1. 概述

- **单机**三档（9×9/10、12×12/22、16×16/40）纯前端，引擎 `client/src/lib/games/minesweeper.ts`，
  首点必安全、洪水展开、双击和弦、最佳时间存 localStorage；
- **好友联机**（2–4 人）是**轮流制**：轮到自己时只允许一次动作（开一格或插/拔一面旗），
  随后立即轮到下一名存活玩家。服务端权威，盘面 12×12 / 22 雷。

## 2. REST 端点

同构前缀 `/api/games/minesweeper`，动作体为联合类型：

```json
{ "type": "open", "index": 42 }
{ "type": "flag", "index": 42 }
```

`index = y * width + x`。非当前回合玩家调用返回 409「还没轮到你」；点已翻开格返回 `applied: false` 且不轮转。

## 3. 信息裁剪（不泄露雷位）

DTO 只包含**已翻开**的格子 `opened: [{index, mine, adjacent}]` 与旗子 `flags: [{index, by}]`；
未翻开格从不出现在响应里，服务端也不会在终局前公布雷位（`minePositions` 仅供单机/复盘使用）。

## 4. 规则口径

- `open` 命中数字 0 时自动洪水展开整片连通区，这些合起来仍算「一次动作」；
- 踩雷 → 该玩家 `booms += 1` 并淘汰，其余玩家继续；只剩 1 人时立即结束（`boom`）；
- 全部安全格翻开 → `cleared`，按 `opened` 最多者获胜（并列平局）；
- 回合 30 秒未动作 → `turn.skips += 1` 并轮转，累计 3 次跳过 → 该玩家淘汰（`forfeit`）；
- 全局 10 分钟 → `timeout` 按 `opened` 判定。

## 5. 自检

```bash
cd server && npm run verify:minesweeper   # 引擎 + 轮流/跳过/踩雷/全清结算（385 断言）
cd client && npx vitest run src/lib/games/__tests__/minesweeper.test.ts
```

---

# 五、跳一跳（jump）单机 / 好友轮流跳

## 1. 概述

对齐微信小游戏的核心逻辑：按住蓄力 → 松手起跳 → 蓄力时长线性映射距离 → 按落点相对目标盒中心的偏移判定。

- **单机**纯前端（引擎 `client/src/lib/games/jump.ts`，canvas 2.5D 等距渲染、镜头跟随、蓄力压扁形变），
  最高分存 localStorage；
- **好友联机**（2–6 人）轮流各跳一次，**同一条盒子路线**（seed 确定性生成、按需续写），
  每人有自己的进度；客户端只提交蓄力毫秒数，落点与得分由服务端判定。

## 2. 物理常量（前后端唯一真相源，两份实现必须逐字一致）

```
JUMP_MAX_CHARGE_MS = 2000     JUMP_MAX_DISTANCE = 260
JUMP_GAP_MIN = 60   JUMP_GAP_MAX = 150      // 相邻盒中心间距
JUMP_SIZE_MIN = 26  JUMP_SIZE_MAX = 36      // 盒面上表面半宽
JUMP_CENTER_RATIO = 0.30      JUMP_COMBO_CAP = 5     JUMP_MAX_SCORE_GAIN = 32
```

判定：`offset = jumpDistance(chargeMs) - gap`；
`|offset| <= size * 0.30` → `center`；`|offset| <= size` → `normal`；
`offset < -size` → `short`（落空）；`offset > size` → `long`（越过）。

计分：`normal` +1 且连击清零；`center` 连击 +1，得分 `min(2^连击, 32)`（2/4/8/16/32 封顶）；
落空即淘汰。`bonus` 字段为原作音乐盒等彩蛋预留，当前恒 `false`。

**RNG 取数顺序是协议的一部分**：`gap`（第 0 盒不取）→ `size` → `kind`，两端必须同序，
否则同一 seed 生成不同路线。

## 3. REST 端点

同构前缀 `/api/games/jump`，动作体 `{ "type": "jump", "chargeMs": 900 }`（1–2000，本地
`performance.now()` 差值）。非当前回合 409；回合 20 秒未跳 → 服务端以 `chargeMs = 1` 代跳（必 `short`）并淘汰该玩家。

DTO：`boxes`（共享路线）、`turn {userId, deadline}`、`lastResult {userId, kind, gained, offset, scoreAfter, comboAfter}`、
`players[] {score, combo, jumps, boxIndex, offset}`。

## 4. 规则口径

只剩 1 人存活 → `last_standing`；6 分钟时长到或全灭 → 按 `score` 判定（并列平局）；
认输 = 自己出局；掉线 120 秒 → 淘汰（`forfeit`）。

## 5. 自检

```bash
cd server && npm run verify:jump      # 物理 + 轮流/淘汰结算（207 断言）
cd client && npx vitest run src/lib/games/__tests__/jump.test.ts
```

---

# 六、我的世界（minecraft）单机 / 好友联机共享世界

## 1. 概述

三维体素沙盒（three.js 渲染，致敬像素沙盒玩法；**全部贴图为程序化生成的原创素材**，不含任何第三方版权资源）。

- **世界 192×192×64**（12×12 个 16×16 区块），由 seed 确定性生成：值噪声高度场（基准 18 + fBm，海平面 24）
  + 三维噪声洞穴 + 分层矿石（煤/铁/钻石）+ 湖泊沙滩 + 雪顶（≥45）+ 确定性撒树。
- **单机**纯前端（引擎 `client/src/lib/games/minecraft.ts` + 渲染 `minecraftScene.ts`）：
  创造式玩法（即时挖掘、无限方块、双击空格飞行）、10 分钟昼夜循环、程序化云层、
  WASD + 指针锁定（触屏有虚拟摇杆/按钮）、F3 调试浮层；存档（seed + 修改 + 位置 + 快捷栏）
  自动写 localStorage（`lineweb-mc-sp-v1`），不走任何后端端点。
- **好友联机（2–8 人）**：等待房间 → 房主开局 → 服务端生成权威 seed 与出生点 →
  **各端本地生成同一世界**（服务端不存世界，只存修改日志与玩家快照）。没有胜负与回合，
  世界一直存在直到全员离开/掉线超时。

## 2. 引擎常量（双端唯一真相源，两份拷贝必须逐字一致）

```
MC_WORLD_SIZE = 192   MC_WORLD_HEIGHT = 64   MC_CHUNK_SIZE = 16   MC_SEA_LEVEL = 24
MC_SNOW_HEIGHT = 45   MC_TREE_DENSITY = 0.006   MC_MAX_EDIT_BATCH = 64   MC_MAX_WORLD_EDITS = 30000
玩家：宽 0.6 高 1.8 眼高 1.62   重力 32/s²   跳跃 9.0   步行 4.317   疾跑 5.612   飞行 10.92   触及 4.5
```

**双端对齐兜底**：`client/src/lib/games/minecraft.ts`（完整引擎）与
`server/src/services/gameMinecraftWorld.ts`（世界生成子集）为同拷贝文件，
两侧测试断言同一批 seed 的世界哈希（`20261024 → 96adcfaa`、`1 → a98a7e50`、
`4294967295 → 3267f19b`）与出生点常量（`20261024 → (96.5, 40.01, 96.5)`）——
改任何生成参数都会同时打红两侧测试，防止「同一 seed 生成不同世界」的联机分叉。

## 3. REST 端点（前缀 `/api/games/minecraft`）

形状与扫雷等同构（friends / invites / sync / presence / matches / start / leave / actions），
差异：

- `GET /sync?matchId=&since=`：`since` 为修改日志水位，返回**自 since 之后的增量修改**（二分查找）；
  轮询降级与断线补拉共用。match DTO 含 `seed / world.spawn / editSeq / editCount / maxEdits`，
  **不含世界数据与日志本体**。
- `POST /matches/:id/actions` 两种动作体：
  - `{ "type": "state", x, y, z, yaw, pitch, flying }`：玩家位置快照（客户端 ~2Hz 上报）。
    服务端只更新内存快照并转发给其他玩家（轻量事件），**不递增 version、不广播完整 DTO**；
  - `{ "type": "edit", edits: [{x,y,z,b}] }`（≤64 格/批）：追加修改日志（seq 递增）并转发其他玩家。
    y=0（基岩层）在 zod schema 层即拒绝；与世界最新值相同的修改幂等跳过；
    总修改数达 30000 后 409。
- `POST /matches/:id/leave` 在**等待与进行中都允许**（其他游戏开局后只能 resign）：
  普通玩家移出世界；房主离开进行中的世界会把房主位移交给剩余玩家；最后一人离开世界关闭。
- 限流豁免（全局 600/15min 外）：`/matches/:id/actions`（900/5min/用户）、`/sync`（1800/5min）、
  `/presence`（120/5min）。

## 4. WebSocket 事件（复用 `/ws/chat`）

标准三件套之外新增两个**轻量事件**（都不携带完整对局 DTO）：

- `game:minecraft:state  { matchId, userId, state }`：单个玩家的位置快照（发给其他人）；
- `game:minecraft:edit   { matchId, userId, edits }`：一批新增修改（发给其他人，发送者自己不收）。

无 WebSocket 降级：位置与修改随 `sync?since=` 每 2 秒一拍（位置为跳步而非补间），
presence 心跳与其他游戏共用（TTL 90s）。掉线**不淘汰**：掉线超 10 分钟被移出世界，
全员掉线 10 分钟 → `abandoned` 关闭（结束后原参与者仍可在保留期内读取结果）。

## 5. 客户端同步模型（乐观）

- 本地操作立即生效（引擎 + 场景），随后批量（150ms 窗口、≤64/批）上送；
- 远端修改经 WS 事件 / sync 增量到达，按 seq 水位去重（服务端不回发自己提交的修改）；
- 远端玩家：以最近一次上报的位置做插值（含走路摆腿、头部俯仰），盒子小人配色由 userId 哈希决定。

## 6. 自检

```bash
cd server && npm run verify:minecraft   # 世界生成确定性/哈希常量 + 房间/编辑/掉线/上限（52 断言）
cd client && npx vitest run src/lib/games/__tests__/minecraft.test.ts   # 14 用例（双端哈希对齐兜底在这里）
```

---

# 七、五子棋（gomoku）好友联机轮流落子

## 1. 概述

15×15 标准棋盘、无禁手 freestyle（连成五子及以上即胜，长连同样获胜），棋盘下满且无人连五为平局。

- **单机**纯前端（引擎 `client/src/lib/games/gomoku.ts`），执黑/执白可选，人机对战
  用与联机托管同一套 `suggestGomokuMove` 启发式；战绩存 localStorage（`lineweb.gomoku.stats`）；
- **好友联机**（恰好 2 人）：房主 = 座位 0 执黑先行，另一位执白。棋盘全量下发
  （无隐藏信息），客户端只提交落子坐标，连五 / 满盘 / 超时 / 掉线判定全部在服务端。

## 2. 引擎常量与坐标（双端唯一真相源，两份拷贝必须逐字一致）

```
GOMOKU_BOARD_SIZE = 15   GOMOKU_CELL_COUNT = 225   GOMOKU_BLACK = 1   GOMOKU_WHITE = 2
棋盘为一维数组：下标 = y * 15 + x（x 列 0–14、y 行 0–14），0 空 / 1 黑 / 2 白
```

**双端对齐兜底**：`server/src/services/gameGomoku.ts` 与 `client/src/lib/games/gomoku.ts`
为逐字同拷贝，`client/src/lib/games/__tests__/gomoku.test.ts` 读两份源文件断言一致（除头注释）——
漂移会让 `npm test` 直接失败。托管与单机 AI 共用 `suggestGomokuMove`
（成五直落 → 必堵对方成五点 → 攻防加权最高分点，候选限已有棋子切比雪夫距离 ≤ 2，空盘落天元）。

## 3. REST 端点（前缀 `/api/games/gomoku`）

同构挂载于 `mountGameEndpoints({ base: 'gomoku', ... })`，动作体 `{ "type": "place", "x": 7, "y": 7 }`。
非当前回合 409「还没轮到你」；坐标越界（zod 0–14）或该点已有棋子 400；
回合 60 秒超时 → 服务端自动托管落子（`lastMove.auto = true`，**不淘汰**，与斗地主托管同口径）；
掉线超过 120 秒且对方在线 → `forfeit` 对方获胜；全局 30 分钟超时未分胜负 → `timeout` 平局。

DTO：`boardSize`、`board`（225 一维）、`turn {userId, deadline}`、
`lastMove {userId, x, y, color, auto}`、`winningLine`（reason='five' 时按 y、x 升序的 ≥5 点）、
`players[] {color, moves, status}`。

## 4. 规则口径

连五及以上（含长连）→ `five` 获胜；认输 → `resign`；掉线 120 秒 → `forfeit`；
全局 30 分钟 → `timeout` 平局（winnerId null）；下满 → `draw` 平局；等待期解散 → `cancelled`。

## 5. 自检

```bash
cd server && npm run verify:gomoku   # 引擎四方向/长连 + 托管/掉线/超时/平局 + 互斥（139+ 断言）
cd client && npx vitest run src/lib/games/__tests__/gomoku.test.ts   # 15 用例（双端源码对齐兜底在这里）
```

---

# 八、骗子酒馆（liar）单机 / 好友联机

## 1. 概述

2–4 人心理战牌桌：20 张牌（K×6 / Q×6 / A×6 / 鬼牌×2），每局每人 5 张，系统随机宣布目标牌面
（K/Q/A，鬼牌万能）。轮到时盖着出 1–3 张，或质疑上一手；质疑只翻开上一手——全真则质疑者输，
掺假则被打出者输。输家扣左轮扳机（6 弹巢，子弹数 = 累计死亡人数 + 1），中弹出局；扣扳机后
无论生死都重洗重发。全员出完无人质疑为流局（flush）。最后存活者获胜。

- **单机**纯前端：`client/src/lib/games/liar.ts`（引擎，与联机逐字同拷贝）+ `LiarPage.tsx`，
  AI 与联机托管共用 `suggestLiarMove`；战绩存 `lineweb.liar.stats`。
- **好友联机**：2–4 人，房主 = 座位 0；手牌与牌堆牌面为隐藏信息，DTO 按观看者裁剪
  （`myHand` 只有自己的手牌，`pile` 只下发 `{userId, count}`），只有被质疑开牌的牌面公开。

## 2. REST 端点（前缀 `/api/games/liar`）

与 UNO / 象棋一样由 `mountGameEndpoints` 挂载：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/friends` | 好友列表（online / inMatch 覆盖全部游戏） |
| GET | `/invites` | 收到 / 发出的邀请（60 秒有效） |
| POST | `/invites` | `{friendId}` 邀请好友；无房间时自动创建 |
| POST | `/invites/:id/respond` | `{action:'accept'\|'decline'}` |
| DELETE | `/invites/:id` | 取消自己的邀请 |
| GET | `/sync?matchId=` | 轮询降级：`serverTime + invites + match`（按观看者裁剪） |
| POST | `/presence` | 轮询降级心跳（跨游戏共享 TTL） |
| GET | `/matches/active` | 当前等待房间 / 进行中对局或 null |
| GET | `/matches/:id` | 对局详情（非参与者 404） |
| POST | `/matches/:id/start` | 房主开始（2–4 人） |
| POST | `/matches/:id/leave` | 离开等待房间（房主解散） |
| POST | `/matches/:id/actions` | `{type:'play',cards:[0-19]*1-3}` 或 `{type:'challenge'}` |
| POST | `/matches/:id/resign` | 认输：自己出局，多人局继续 |

对局 DTO 字段：`round`、`target`、`turn {userId, deadline}`、`pile[]`、`lastReveal`、
`log[]`（round / play / challenge / reveal / trigger / death / flush）、`gunBullets`、
`myHand[]`、`players[] {handCount, plays, status}`。

## 3. 规则与结束口径

- 回合 60 秒，超时由服务端 `suggestLiarMove` 自动托管；掉线超过 120 秒且其他存活玩家在线判负出局；
- 认输 / 掉线出局会推高子弹数；只剩一人 → `last_standing`；
- 全局 30 分钟超时 → `timeout`（无胜者）；等待房间 30 分钟解散 → `cancelled`；
- 手牌不跨局保留（站内简化口径，避免「手牌出完跳过」等边角状态）。

## 4. 自检

```bash
cd server && npm run verify:liar   # 引擎 + 联机状态机（363 断言）
cd client && npx vitest run src/lib/games/__tests__/liar.test.ts
```

---

# 九、UNO（uno）单机 / 好友联机

## 1. 概述

2–10 人经典 UNO：108 张（四色各 0×1、1–9×2、禁止×2、反转×2、+2×2，万能×4、万能+4×4）。
每人 7 张，翻开第一张非万能牌开局，房主（座位 0）先手。同色 / 同数字 / 同功能可出；
万能牌指定颜色；**万能+4 采用官方限制：手里还有当前颜色的牌时不能出**。
禁止跳过下一家；反转 2 人局视作禁止；+2 / 万能+4 让下一家摸牌并被跳过（不叠加）。
摸一张后可立即打出（只能打刚摸到的那张）或跳过；先出完手牌者获胜。

- **单机**纯前端：`client/src/lib/games/uno.ts` + `UnoPage.tsx`，AI 与联机托管共用
  `suggestUnoMove`（下家手牌 ≤2 时优先功能牌，否则保留功能牌打普通牌；万能牌选择手里最多的颜色）；
- **联机**：2–10 人，DTO 按观看者裁剪（`myHand` 只有自己手牌，其他玩家只下发张数，牌堆只下发张数）；
  `drawnCardId` 为该回合摸到的牌 id（所有观看者可见，但只有该玩家能打出）。

## 2. REST 端点（前缀 `/api/games/uno`）

端点形状与骗子酒馆 / 象棋完全一致；动作体：

```json
{ "type": "play", "cardId": 42, "color": "red" }   // color 仅万能牌需要
{ "type": "draw" }
{ "type": "pass" }                                  // 仅摸牌后可用
```

对局 DTO：`currentColor`、`direction`（1 / -1）、`topCard`、`deckCount`、`discardCount`、
`drawnCardId`、`turn {userId, deadline}`、`lastAction`、`myHand[]`、
`players[] {handCount, plays, status}`。

## 3. 结束口径

- 有人出完手牌 → `hand_empty`；认输 / 掉线 120 秒出局，最后存活者 → `last_standing`；
- 全局 30 分钟超时 → `timeout`；等待解散 → `cancelled`；
- 回合 60 秒超时由服务端自动托管（摸牌后若可出会继续自动打完，不淘汰）。

## 4. 自检

```bash
cd server && npm run verify:uno   # 牌堆/规则/效果/AI 自对弈/联机状态机（310 断言）
cd client && npx vitest run src/lib/games/__tests__/uno.test.ts
```

---

# 十、中国象棋（xiangqi）单机 / 好友联机

## 1. 概述

9×10 标准棋盘，红方（下方）先行，黑方（上方）。完整走子规则：帅/将九宫一步、仕/士斜行、
相/象田字且不过河（象眼不能有子）、马走日别马腿、车走直线、炮隔子吃、兵/卒过河可横走。
走子后不得使己方将帅被将军（含将帅照面）；被将军且无合法着法 = 绝杀（checkmate）；
无合法着法但未被将军 = 困毙（stalemate，判负）；连续 120 个半回合无吃子判和（draw）。

- **单机**：`client/src/lib/games/xiangqi.ts` 引擎 + alpha-beta 搜索（简单 / 普通 / 困难 = 1/2/3 层），
  可选执红 / 执黑；战绩存 `lineweb.xiangqi.stats`；
- **联机**（恰好 2 人）：房主 = 座位 0 执红先行，另一位执黑；棋盘全量下发，无隐藏信息。

## 2. REST 端点（前缀 `/api/games/xiangqi`）

动作体 `{ "type": "move", "from": 64, "to": 37 }`（下标 = y×9+x，0–89）。
非法走子 / 送将 400；非当前回合 409。

对局 DTO：`board`（90 一维，正数红 / 负数黑 / 0 空）、`turn {userId, deadline}`、
`lastMove {userId, from, to, captured, auto}`、`checked`（当前行棋方是否被将军）、
`halfMoveClock`、`players[] {side:'red'|'black', moves, status}`。

## 3. 结束口径

- 绝杀 → `checkmate`；困毙 → `stalemate`；认输 → `resign`；掉线 120 秒 → `forfeit`；
- 连续 120 半回合无吃子 → `draw`；全局 30 分钟 → `timeout`；等待解散 → `cancelled`；
- 回合 60 秒超时由服务端自动托管走子（`lastMove.auto = true`，不淘汰）。

## 4. 自检

```bash
cd server && npm run verify:xiangqi   # 规则/将军/绝杀/困毙/AI/联机状态机（91 断言）
cd client && npx vitest run src/lib/games/__tests__/xiangqi.test.ts
```


---

# 十一、霓虹跑酷（parkour，3D 第三人称三车道）

## 1. 概述

three.js 第三人称三车道跑酷（Subway Surfers / Temple Run 式）：自动前进，左右换道、跳跃、按住滑铲；
躲避列车 / 低路障 / 悬空牌 / 坑洞，收集金币与护盾 / 磁铁 / 冲刺。

- **单机**：`/games/parkour`，无尽霓虹都市，最高纪录存 `lineweb.parkour.best`；
  3D 视图在点击开始时动态加载（three.js 与「我的世界」共用按需 chunk，不进主包）。
- **联机**：`/games/parkour/online`，**2–6 人**在**同一条 seed 的 800m 赛道**上幽灵竞速；
  各端本地 60fps 模拟，互不碰撞；服务端只做进度校验与排名。
- 引擎双端唯一真相源：`server/src/services/gameParkour.ts` ≡ `client/src/lib/games/parkour.ts`
  （client 测试读取双端源码断言逐字一致）；渲染在 `client/src/lib/games/parkourScene.ts`。
- 一次撞击或掉坑即出局；护盾抵挡一次撞击，冲刺 4 秒无敌加速；**没有生命值 / 二段跳**。

## 2. 常量与计分（双端必须一致）

| 项 | 值 |
| --- | --- |
| 车道 | 3 条，宽 2.4m，中心 -2.4 / 0 / +2.4 |
| 速度 | `min(cap, 10 + distanceM × 0.014)`；联机 cap 21m/s，单机 cap 26m/s |
| 跳跃 | 初速 9.8m/s，重力 26m/s²；站立高 1.7m，滑铲高 0.9m |
| 冲刺 | 4s，速度 ×1.4，无敌并可飞越坑洞 |
| 磁铁 | 8s，吸附 4.5m 范围内金币 |
| 护盾 | 抵挡一次撞击 + 1.2s 无敌；不救坑洞 |
| 得分 | `floor(distanceM) + coins × 10 + maxCombo × 20` |

关卡从 40m 后按 seed 确定性生成；前 40m 净空、前 120m 不出列车；同一排只使用一种障碍，
列车绝不占满三条车道；生成器不变量 + 贪心机器人 200 seed × 800m 零碰撞兜底。

## 3. REST 端点（前缀 `/api/games/parkour`）

统一动作入口 `POST /matches/:id/actions`：

```json
{ "type": "progress", "distanceM": 123.4, "coins": 12, "maxCombo": 8,
  "lane": 1, "pose": "run", "alive": true, "cause": "hit" }
{ "type": "finish", "distanceM": 800, "coins": 24, "maxCombo": 12 }
```

- `progress` 约 2Hz；服务端做距离单调、速度上限（约 31m/s）、金币上限、车道 0–2、姿态枚举校验；
  返回 `{ ok: true }`，不返回完整 DTO；广播 `game:match:update` 做 400ms 节流。
- `finish` 要求距离 ≥ 795m 且速度上限允许；按**服务端收到顺序**记名次，距离定格 800m。
- 动作端点专用限流 1500/5min/用户；`sync` / `presence` 与全局 skip 白名单同其他游戏。
- 对局 DTO：`seed`、`startsAt`、`countdownMs`（3 秒倒计时）、`remainingMs`（150 秒，倒计时期间不叠加）、
  `players[] {userId, username, colorIndex, status, distanceM, coins, maxCombo, score, lane, pose,
  rank, finishMs, cause}`；`game:invite` / `game:match:*` 复用 `/ws/chat`。

## 4. 规则与结束口径

- 房主开始后 3 秒倒计时；`startsAt = 开始处理时间 + 3s`，`endsAt = startsAt + 150s`。
- 排名：先按冲线顺序；未冲线者按 距离 > 金币 > maxCombo；无人冲线则最远者胜。
- 全员完赛/出局立即结束；150 秒超时按距离结算；
  原因 `finish`（至少一人冲线）/ `elimination`（全员出局）/ `timeout` / `cancelled`（等待房解散）。
- 掉线：连续 30 秒无 WS/presence 且无进度上报，且仍有其他可用者 → `forfeit`；
  全员不可用不逐个判负，等超时；结果保留 5 分钟，等待房 30 分钟。
- 刷新恢复：客户端从 DTO 的 `distanceM / lane / coins / maxCombo` 重建，给 1.5s 无敌。
- 客户端模拟：服务端不做逐帧物理；防作弊为单调/速度/金币/车道校验，排名以服务端收到 `finish` 的顺序为准。

## 5. 自检

```bash
cd server && npm run verify:parkour   # 引擎/生成器/机器人 + 联机状态机/排名/掉线/互斥（3602 断言）
cd client && npx vitest run src/lib/games/__tests__/parkour.test.ts src/lib/games/__tests__/parkourRecords.test.ts
```


---

# 十二、跨游戏互斥与新增游戏清单

- 所有游戏的房间/邀请都通过 `gameService.registerGameModule({ name, isUserInMatch, sweep })`
  注册进同一张表，`isUserBusyInOtherGames(userId, selfName)` 是**跨游戏互斥的唯一口径**
  （`selfName` 用于排除自己，这样已在自家等待房间的人仍可继续邀请好友）；
  2048 自己也注册了一个探针（`sweep` 为空操作，避免主 sweeper 自我递归）。
- 新增一款游戏需要同时改：`server/src/config/index.ts`（动作 schema）、
  `server/src/routes/games.ts`（用 `mountGameEndpoints({ base: '<id>', ... })` 一行挂载；
  端点形状有差异时（如我的世界 sync 带 `since` 水位、leave 语义不同）则手动挂载）、
  `server/src/index.ts`（`apiLimiterSkipPaths` 三条豁免 + `/api` 自描述条目）、
  `client/src/types/game.ts`、`client/src/lib/games/catalog.ts`、`client/src/App.tsx`（路由）、
  `client/src/contexts/GameContext.tsx`（`GAME_API_BASE` 映射）、`client/src/styles/globals.css`（CSS import）。
  高频进度上报（如霓虹跑酷 2Hz）应在 `routes/games.ts` 给 `mountGameEndpoints` 传 `actionLimiter`
  并新增独立限流器，避免挤占跨游戏共享的 `moveLimiter`。
- 当前已注册：2048、斗地主、贪吃蛇、扫雷、跳一跳、我的世界、五子棋、骗子酒馆、UNO、中国象棋、霓虹跑酷。
- 对局详情页路由统一为 `/games/<id>/online/:matchId`，因此 `GameContext.gameMatchPath()` 可直接拼字符串，
  邀请与对局的 WS 事件名跨游戏共用（`game:invite` / `game:invite:removed` / `game:match:started|update|ended`），
  由载荷里的 `match.game` / `invite.game` 判别。

---

## 12. 游戏战绩与站内排行榜（2026-10）

### 12.1 原则

- 单机 + 联机战绩随账号保存在 `GameStat`（`@@unique([userId, game, variant])`），不再写 localStorage。
- 我的世界存档、贪吃蛇同屏双人战绩仍留本地浏览器。
- 单机结果由客户端上报（服务端白名单 + 上限校验，仅供娱乐）；联机结果由服务端在 `finish*` 后通过 `publishGameEnd` 落库（进程重启后不可回溯）。
- 旧 localStorage 在首次登录后调用 `POST /api/game-stats/import` 一次性合并；服务端用 `User.gameStatsImportedAt` 保证幂等。

### 12.2 端点（全部需登录）

| 端点 | 说明 |
|---|---|
| `GET /api/game-stats` | `{ imported, stats[] }` |
| `POST /api/game-stats/result` | 单机一局 `{game,variant,outcome?,score?,scoreDelta?,timeMs?,distanceM?,coins?,maxCombo?,jumps?,offset?,deaths?}`；120 次/5min/用户 |
| `POST /api/game-stats/import` | `{records:[…]}`，最多 100 条；已导入返回 `imported:false` |
| `GET /api/game-stats/leaderboard?game=&variant=&limit=&page=` | 站内总榜 |

合并规则：`games` 每次 +1；胜负计 wins/losses/draws；`score` 累加且 bestScore 取 max；扫雷 bestTimeMs 仅在胜利时取 min；斗地主 scoreDelta 可负；跑酷距离/金币/连击取 max；跳一跳跳跃/偏差累加。

### 12.3 排行榜

- 全站总榜，不做日/周榜；单机/联机分开；我的世界不参与。
- 指标：2048/贪吃蛇/跳一跳 = bestScore 降序；跑酷 = bestDistance 降序；扫雷单机 = bestTimeMs 升序（排除 null）；扫雷联机/五子棋/骗子酒馆/UNO/中国象棋 = wins 降序；斗地主 = scoreTotal 降序。
- 返回 `entries[]`（rank/userId/username/value/secondary/isMe）、`me`（即使不在当前页）、`total`、`metric/label/unit`；同分使用「比它更好的人数 +1」并列名次。
- 前端 `/games/leaderboard`：游戏 chips、单机/联机/扫雷难度 tabs、前三领奖台、我的名次、空态；单机榜标注「客户端上报，仅供娱乐」。

### 12.4 兼容说明

本文件第 1 节「不提供战绩历史、排行榜」为旧口径，现已被本节替代；对局/邀请仍为内存态，重启失效。
