# 搜打撤 v2 API（2026-11-04）

> 元气骑士式实时房间制搜打撤：`/api/pets/raid*`，全部需登录并挂 `requireFeature('pet')`。
> 共享引擎 `server/src/lib/raidRun.ts` 为唯一真相源，客户端 `client/src/lib/raid/raidRun.ts` 为逐字副本。
>
> **2026-11-07 更新**（`RAID_STATE_VERSION` 保持 4，删除的字段向后兼容）：
> - **非 PvP 爆率回调**：`normal` 品质权重恢复 v4 下调前（T5 神话重新为 4），容器段数恢复非 Boss 1–3 / Boss 2–4；
>   boss 首段保底恢复 rare+/epic+，并按 `item.weight` 加权、过滤退役与 `pityEligible:false` 物品。
> - **非洲之心**（`heart_of_africa`，即「非洲之星」）解除 `pvpOnly`，两种模式均可掉落；单件权重 1 → 0.25、
>   目录价 9999 → 30000，并排除在首领首段保底池之外。
> - **删除撤离失败机制**：删除 25% 运输故障、60 秒冷却、失效撤离点与救援队兜底；`extractDone` 读条满 6 秒必定
>   `extracted`。对局 DTO 删除 `extractDisabled` / `extractBlockedUntil` / `extractGuaranteed`。
> - **撤离信号弹停产**：目录数据保留（旧仓库仍可回收 180），但不再掉落 / 出售 / 可使用。
> - **新地图「日蚀要塞」`citadel`**：6×5、nightmare、T5、1500 入场；房间内生成隔断与掩体；独有「轨道炮火」——
>   每 24 秒锁定玩家位置，3.6 秒后 3 发炮弹落下，墙体阻断视线可免伤（纯客户端模拟，伤害仍走 `damage` 事件）。
>   地图列表项新增可选 `gimmickLabel`，地图节点新增可选 `gimmick`。
>
> **2026-11-04 更新**（`RAID_STATE_VERSION` 2 → 3，旧对局读时按废弃结算）：
> - **丢弃物品**：新增事件 `dropItem`（从容器格丢到当前房间地面，落点=玩家坐标服务端夹取）与
>   `takeGround`（捡起地面物品进背包/胸挂）；地面物品走 `RaidRunState.groundLoot`（单房上限 24），
>   DTO 带 `groundLoot/groundSeq`，组队世界增量新增 `groundDropped/groundTaken`
>   （成员发号基址按出击顺序 ×100 错开防撞 id）；客户端走过地面物品自动捡起。
> - **胸挂放宽**：不再限消耗品，任意物品可入胸挂（takeLoot / moveItem / withdraw / 容器清洗 4 处校验移除）。
> - **背包扩容**：新增 7/8 级背包 `backpack_t7`（36 格）/`backpack_t8`（48 格），神话品质、掉落限定；
>   掉落来源为新增神话物品「深渊装备箱 `gear_cache_mythic`」（开 6–8 级装备，仅 lootTier 5 图）。
> - **人机增强**：`createRaidEnemy` 血量系数 1/1.9/4.2 → 1.2/2.4/5.0、伤害 1/1.2/1.5 → 1.15/1.45/1.8、
>   远程概率 scout 70%→85% / soldier 45%→65%、速度微调；各图 `enemyLevel` +1、`enemyBudget` +2~4；
>   客户端远程射击节奏 1700/1200ms → 1500/1100ms、近战 1000→950ms。
> - **触屏操控**：摇杆改悬浮式（按下即在触点生成、跟随手指漂移）；开火自动锁敌（±75° 锥内最近可视敌人，
>   仅触屏 `aimAssist`）；技能伤害类全平台自动朝最近可视敌人（`skillAutoTarget`）。
> - **组队响应契约**：`POST /raid/squad/invite` 与 `/respond` 统一返回 `{ squad }`（拒绝为 `{ squad: null }`），
>   客户端对 404「邀请不存在」静默移除本地邀请（双端竞态不报错）。
> - **一键回收**：新增 `POST /raid/storage/recycle-all`（`{ keepUpgradeItems? }` 默认 true 跳过仓库升级材料），
>   事务内按官方回收价整仓结算。

## 1. 对局

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pets/raid` | 概览：地图列表 / 当前对局（含地图布局）/ 战绩 / 每日契约 / 出击装配 / 仓库容量 |
| POST | `/api/pets/raid/start` | `{ mapKey, insured? }` 开局，扣门票与可选保险，返回 `RaidRun` |
| POST | `/api/pets/raid/events` | `{ version, events[], me? }` 批量事件，返回 `{ run, errors, settlement, squad }`；`me` 为组队时本端位置（纯表现、不落库） |
| POST | `/api/pets/raid/abandon` | 主动放弃，返回结算 |
| POST | `/api/pets/raid/contracts/:key/claim` | 领取每日契约奖励 |

`events` 为以下判别联合（单批 ≤120 条）：

```json
{ "type": "enterRoom", "roomId": 3 }
{ "type": "kill", "enemyId": "e-3-0" }
{ "type": "clearRoom", "roomId": 3 }
{ "type": "openContainer", "containerId": "c-3-0" }
{ "type": "takeLoot", "containerId": "c-3-0", "lootId": "loot-0", "target": "backpack" }
{ "type": "moveItem", "from": "backpack", "to": "safe", "slotIndex": 0, "amount": 2 }
{ "type": "dropItem", "from": "backpack", "slotIndex": 1, "amount": 1, "x": 12.5, "y": 8.2 }
{ "type": "takeGround", "groundId": "g1", "target": "rig" }
{ "type": "useItem", "itemKey": "medkit", "from": "rig" }
{ "type": "castSkill", "skillKey": "ice_shield" }
{ "type": "damage", "amount": 12, "zone": "body" }
{ "type": "extractStart" }
{ "type": "extractDone" }
{ "type": "abandon" }
```

校验口径：

- 地图由 seed 在服务端重算，容器 / 掉落 / 敌人 id 均来自该地图，客户端无法伪造；
- 只能进入相邻房间，且当前房间必须清场；开箱要求房间无存活敌人；
- `takeLoot` 的 `target` 容量为 0 或已满时拒绝；胸挂容量由装备决定（不再限制只能放消耗品）；
- `damage` 由服务端按头盔 / 护甲减伤并扣耐久，HP ≤ 0 判阵亡；
- `extractStart` 只在撤离房间、清场后可开始；`extractDone` 需满 6 秒读条，**读条完成必定撤离成功**；
- 版本号只拒绝「客户端比服务端更新」的情况：队友造成的世界同步会推进本行 `version`，
  客户端落后时照常接受并在响应里回权威状态（`applyServerRun` 自愈）；超前则 409 `RAID_VERSION`。

## 3. 好友组队（2026-11-03）

2–4 人好友共享同一张地图：同一 seed ⇒ 同一份房间布局；**世界状态共享**（击杀、房门解锁、开箱、被拿走的战利品全局唯一），**个人状态独立**（HP / 背包 / 装备 / 撤离结算 / 门票与保险各自一份 `PetRaid` 行）。队伍房间、邀请、实时位置都在内存（与站内其他联机游戏一致，不新增 Prisma 表），服务重启即失效。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pets/raid/squad` | `{ serverTime, squad, friends, incoming, outgoing }`，`friends` 带 `online / inRaid / inOtherGame` |
| GET | `/api/pets/raid/squad/state` | 战斗中队友状态（无 WebSocket 时 2 秒轮询） |
| POST | `/api/pets/raid/squad/invite` | `{ userId }` 非本人建队时自动建房主队伍；非好友 403，对方忙 / 已在队 / 满员 409 |
| POST | `/api/pets/raid/squad/respond` | `{ inviteId, accept }` 邀请 5 分钟有效且一次性核销 |
| POST | `/api/pets/raid/squad/cancel` | `{ inviteId }` 撤回自己发出的邀请 |
| POST | `/api/pets/raid/squad/leave` | 房主退出即解散并通知全员；成员退出只离队，不影响他人对局 |
| POST | `/api/pets/raid/squad/kick` | `{ userId }` 仅房主，且只能在出击前使用 |
| POST | `/api/pets/raid/squad/start` | `{ mapKey, insured }` 房主为全队同一 seed 开局，返回 `{ squad, failed[] }` |

`RaidSquadMember`：`userId / name / displayName / petName / species / level / host / online / hp / maxHp / roomId / x / y / angle / kills / lootValue / status`，
`status` 取 `lobby / active / extracted / died / mia / abandoned / offline`。

出击预检：成员需有存活宠物、有背包容量、积分够门票 + 保险；不合格者进 `failed` 并移出队伍（不开局、不扣费），实际可出击人数 ≥2 才成立。

WebSocket 事件（复用 `/ws/chat`，`chatHub.sendToUser`）：

| 事件 | 载荷 | 用途 |
|---|---|---|
| `raid:squad:invite` | `{ invite }` | 受邀端弹接受 / 拒绝 |
| `raid:squad:invite:removed` | `{ inviteId }` | 撤回 / 过期 / 已处理 |
| `raid:squad:update` | `{ squad \| null }` | 名册变化与解散（`null` 表示队伍没了） |
| `raid:squad:started` | `{ squad }` | 全员按同一 seed 进入战斗 |
| `raid:squad:world` | `{ squadId, byUserId, byName, killedEnemies, openedContainers, takenLoot, clearedRooms }` | 队友造成的世界变化，免等下一次批处理 |
| `raid:squad:state` | `{ squad }` | 位置 / 血量推送（按队伍节流 ≥0.9 秒一次） |

跨游戏互斥：`raidSquadService` 用 `registerGameModule({ name: 'raid' })` 注册探针，在队伍中的玩家会被其他游戏的邀请判定为「对局中」；清扫钩子挂在既有 15 秒 `startGameSweeper` 上（大厅闲置 10 分钟、出击后 `时长 + 3 分钟`、邀请 5 分钟过期）。

限流：组队读接口 `battlePollLimiter`（600/5min），邀请 / 应答 / 出击 `battleInviteLimiter`（30/5min），按用户且管理员豁免。

## 2. 仓库 / 容器 / 官方商店

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pets/raid/storage` | 仓库 + 背包 / 胸挂 / 安全箱 + 装备 + 升级预览 |
| POST | `/api/pets/raid/storage/deposit` | `{ container, slotIndex, amount }` 单格存入（仓库满整笔失败） |
| POST | `/api/pets/raid/storage/deposit-all` | `{}` 尽量存入，返回 `movedUnits / remainingUnits` |
| POST | `/api/pets/raid/storage/withdraw` | `{ container, itemKey, amount }` 仓库取到容器 |
| POST | `/api/pets/raid/storage/recycle` | `{ from, itemKey, amount, slotIndex? }` 卖给官方商店 |
| POST | `/api/pets/raid/storage/upgrade` | `{}` 积分 + 材料升级仓库 |
| GET | `/api/pets/raid/shop` | 官方商店（1–3 级装备 + 补给 / 箱子） |
| POST | `/api/pets/raid/shop/buy` | `{ kind: "gear"|"item", key, amount? }` |
| POST | `/api/pets/raid/gear/equip` | `{ slot, gearKey \| null }` 穿戴 / 卸下 |
| POST | `/api/pets/raid/gear/repair` | `{ gearKey }` 消耗头修包 / 甲修包 |
| POST | `/api/pets/raid/gear/open-cache` | `{ itemKey }` 开启装备箱 / 技能卷轴 |

规则：

- 仓库容量 60/100/150/210/280/360 件（Lv.1–6），安全箱 2/3/3/4/5/6 格；
- 回收价：材料 / 珍宝 100%、消耗品 60%、装备箱 / 技能卷轴 70%；
- 头盔 / 护甲维修每次 `耐久上限 × 0.95`，最低初始上限 30%；
- 行动进行中禁止存取 / 回收 / 穿脱 / 维修 / 开箱，先撤离或放弃；
- 交易行端点已删除（`/api/pets/raid/market*` 返回 404），表保留仅作历史数据。

## 3. 藏品室（2026-11-15）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pets/raid/collection` | 自己的藏品室；不存在时 `exists:false` 并返回默认房间 |
| PUT | `/api/pets/raid/collection` | `{ title?, intro?, isPublic? }` 改房间信息 |
| POST | `/api/pets/raid/collection/collect` | `{ itemKey }` 从仓库收入 1 件藏品；重复藏品折算积分 |
| PUT | `/api/pets/raid/collection/display` | `{ slots: [{ slot, itemKey, note? }] }` 0–11 号展位布展 |
| GET | `/api/pets/raid/collections` | 公开藏品室巡礼列表（含封面、进度、访问数） |
| GET | `/api/pets/raid/collections/:userId` | 参观别人的藏品室；私密且非本人 → 404 |

规则：

- 藏品共 8 件，`kind: "collectible"`，`stackMax: 1`；**不可回收 / 不可取出 / 不可挂交易行 / 不可作为公司抵押**，只能进藏品室；
- 掉落是独立随机流（`collectible:<containerId>` 子 seed），概率 `0.6% + (档位-1)×0.12% + Boss 0.8% + PvP 0.1%`，且受物品 `minLootTier` 限制；
- 重复藏品收入时按 `duplicatePoints` 折算积分，`RaidCollectible` 仍只保留一行（图鉴不重复）；
- 12 个展位、同一展位 / 同一藏品不可重复；布展只接受已拥有藏品，非法输入 400；
- 公开房间访问数按 `userId` 30 分钟去重；私密房间只有本人可读。

## 4. 统一邀请

组队邀请仍发 `raid:squad:invite` / `raid:squad:invite:removed`，同时由 `gameInviteBridge` 发统一的 `game:invite` / `game:invite:removed`（`game: "raid"`、`kind: "squad"`、`squadId`、`expiresAt`）。邀请 5 分钟过期；`GET /api/pets/raid/squad/invites` 返回 `{ incoming, outgoing }` 供无 WS 时轮询。
