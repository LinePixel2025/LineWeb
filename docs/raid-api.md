# 搜打撤 v2 API（2026-11-03）

> 元气骑士式实时房间制搜打撤：`/api/pets/raid*`，全部需登录并挂 `requireFeature('pet')`。
> 共享引擎 `server/src/lib/raidRun.ts` 为唯一真相源，客户端 `client/src/lib/raid/raidRun.ts` 为逐字副本。

## 1. 对局

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pets/raid` | 概览：地图列表 / 当前对局（含地图布局）/ 战绩 / 每日契约 / 出击装配 / 仓库容量 |
| POST | `/api/pets/raid/start` | `{ mapKey, insured? }` 开局，扣门票与可选保险，返回 `RaidRun` |
| POST | `/api/pets/raid/events` | `{ version, events[] }` 批量事件，返回 `{ run, errors, settlement }` |
| POST | `/api/pets/raid/abandon` | 主动放弃，返回结算 |
| POST | `/api/pets/raid/contracts/:key/claim` | 领取每日契约奖励 |

`events` 为以下判别联合（单批 ≤120 条）：

```json
{ "type": "enterRoom", "roomId": 3 }
{ "type": "kill", "enemyId": "e-3-0" }
{ "type": "clearRoom", "roomId": 3 }
{ "type": "openContainer", "containerId": "c-3-0" }
{ "type": "takeLoot", "containerId": "c-3-0", "lootId": "loot-0", "target": "backpack" }
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
- `takeLoot` 的 `target` 容量为 0 或已满时拒绝；`rig` 只能放消耗品；
- `damage` 由服务端按头盔 / 护甲减伤并扣耐久，HP ≤ 0 判阵亡；
- `extractStart` 只在撤离房间、清场后可开始，`extractDone` 需满 6 秒读条；
- 版本不一致返回 409 `RAID_VERSION`，客户端刷新对局后继续。

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
