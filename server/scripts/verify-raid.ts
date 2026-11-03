/**
 * 搜打撤 v2 共享引擎自检（纯函数，不依赖数据库 / 网络）。
 *
 * 覆盖：物品与装备目录不变量、地图生成确定性与连通性、房间类型分配、
 *       容器掉落、运行状态机（进房 / 击杀 / 清房 / 开箱 / 拾取 / 使用 / 技能 / 受伤 / 撤离）、
 *       耐久与维修、保险、结算保留规则、每日契约。
 *
 * 用法: cd server && npx tsx scripts/verify-raid.ts（或 npm run verify:raid）
 */

import {
  RAID_CONTRACTS,
  RAID_CONTRACT_MAP,
  RAID_GEAR_MAP,
  RAID_GEARS,
  RAID_ITEMS,
  RAID_ITEM_MAP,
  RAID_MAPS,
  RAID_RARITY_ORDER,
  RAID_REPAIR_FLOOR_RATIO,
  RAID_SKILL_CD_MS,
  RAID_STATE_VERSION,
  addItemToContainer,
  applyRaidEvent,
  applyRaidEvents,
  consumeItemFromContainer,
  createRaidRun,
  findContainerSlot,
  generateRaidMap,
  getRaidGear,
  getRaidItem,
  getRaidMap,
  raidInsuranceCost,
  raidKeptContainers,
  raidLootValue,
  raidSellPrice,
  rarityWeightAtTier,
  repairRaidGear,
  resolveRaidDamage,
  rollRaidItemKey,
  tickRaidRun,
  type RaidEnemyNode,
  type RaidEvent,
  type RaidMapDef,
  type RaidRunState,
} from '../src/lib/raidRun.js'

let passed = 0

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`断言失败：${message}`)
  passed += 1
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${message}（期望 ${String(expected)}，实际 ${String(actual)}）`)
  }
  passed += 1
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`断言失败：${message}（期望 ${expected} ± ${tolerance}，实际 ${actual}）`)
  }
  passed += 1
}

/* ============================================================
   目录不变量
   ============================================================ */

assert(RAID_ITEMS.length >= 48, `物品目录至少 48 种（实际 ${RAID_ITEMS.length}）`)
assertEqual(new Set(RAID_ITEMS.map((item) => item.key)).size, RAID_ITEMS.length, '物品 key 唯一')
assert(RAID_ITEMS.every((item) => item.value > 0), '所有物品目录价值 > 0')
assert(RAID_ITEMS.every((item) => item.stackMax >= 1 && item.stackMax <= 5), '堆叠上限在 1–5')
assert(RAID_ITEMS.every((item) => item.weight > 0), '掉落权重 > 0')
for (const rarity of RAID_RARITY_ORDER) {
  assert(RAID_ITEMS.some((item) => item.rarity === rarity), `品质 ${rarity} 至少有一种物品`)
}
assert(RAID_ITEMS.filter((item) => item.rarity === 'mythic').length >= 2, '神话物品至少 2 种')
assertEqual(RAID_ITEMS.filter((item) => item.kind === 'gear_cache').length, 4, '装备箱共 4 种')
assertEqual(RAID_ITEMS.filter((item) => item.kind === 'skill_cache').length, 3, '技能卷轴共 3 种')
assert(RAID_ITEMS.filter((item) => item.kind === 'consumable').length >= 8, '消耗品至少 8 种')
assert(RAID_ITEMS.filter((item) => item.rarity === 'mythic').every((item) => item.value >= 5000), '神话物品价值 ≥ 5000')

assertEqual(RAID_GEARS.length, 30, '装备目录 30 件（头/甲/鞋/背包/胸挂 × 6 级）')
assertEqual(new Set(RAID_GEARS.map((gear) => gear.key)).size, RAID_GEARS.length, '装备 key 唯一')
for (const slot of ['helmet', 'armor', 'boots', 'backpack', 'rig'] as const) {
  const list = RAID_GEARS.filter((gear) => gear.slot === slot)
  assertEqual(list.length, 6, `${slot} 共 6 级`)
  assertEqual(list.map((gear) => gear.tier).join(','), '1,2,3,4,5,6', `${slot} 等级连续`)
  assert(list.every((gear) => gear.tier <= 3 === gear.shopable), `${slot} 只有 1–3 级可购买`)
}
const helmets = RAID_GEARS.filter((gear) => gear.slot === 'helmet')
assert(
  helmets.every((gear, index) => index === 0 || (gear.defense ?? 0) > (helmets[index - 1]?.defense ?? 0)),
  '头盔减伤随等级严格递增',
)
const armors = RAID_GEARS.filter((gear) => gear.slot === 'armor')
assert(
  armors.every((gear, index) => index === 0 || (gear.maxDurability ?? 0) > (armors[index - 1]?.maxDurability ?? 0)),
  '护甲耐久上限随等级严格递增',
)
const backpacks = RAID_GEARS.filter((gear) => gear.slot === 'backpack')
assertEqual(backpacks.map((gear) => gear.slots).join(','), '8,12,16,20,24,28', '背包容量 8/12/16/20/24/28')
const rigs = RAID_GEARS.filter((gear) => gear.slot === 'rig')
assertEqual(rigs.map((gear) => gear.slots).join(','), '2,3,4,5,6,7', '胸挂容量 2/3/4/5/6/7')
assert(RAID_GEARS.every((gear) => gear.rarity === RAID_RARITY_ORDER[gear.tier - 1]), '装备品质与等级对应')
assert(getRaidGear('helmet_t6')?.defense === 38, '6 级头盔减伤 38%')
assert(getRaidGear('armor_t6')?.defense === 47, '6 级护甲减伤 47%')
assertEqual(getRaidGear('nope'), null, '不存在的装备返回 null')

/* ============================================================
   品质权重
   ============================================================ */

for (let tier = 1; tier <= 5; tier += 1) {
  const total = RAID_RARITY_ORDER.reduce((sum, rarity) => sum + rarityWeightAtTier(rarity, tier), 0)
  assertClose(total, 100, 1e-9, `lootTier ${tier} 品质权重合计 100`)
}
for (let tier = 1; tier <= 4; tier += 1) {
  assertEqual(rarityWeightAtTier('mythic', tier), 0, `lootTier ${tier} 不会掉神话`)
}
assert(rarityWeightAtTier('mythic', 5) > 0, 'lootTier 5 可能掉神话')

let mythicHits = 0
let commonHits = 0
for (let i = 0; i < 6000; i += 1) {
  const key = rollRaidItemKey(() => (i + 0.5) / 6000, 1)
  const def = RAID_ITEM_MAP.get(key)
  assert(!!def, '掷出的物品一定在目录里')
  if (def?.rarity === 'mythic') mythicHits += 1
  if (def?.rarity === 'common') commonHits += 1
}
assertEqual(mythicHits, 0, 'tier 1 固定种子不产出神话')
assert(commonHits > 0, 'tier 1 会产出普通物品')

/* ============================================================
   地图生成
   ============================================================ */

const wasteland = getRaidMap('wasteland') as RaidMapDef
const abyss = getRaidMap('abyss') as RaidMapDef
assertEqual(RAID_MAPS.length, 6, '6 张地图')
assertEqual(new Set(RAID_MAPS.map((map) => map.key)).size, RAID_MAPS.length, '地图 key 唯一')

const mapA = generateRaidMap(123456, wasteland)
const mapB = generateRaidMap(123456, wasteland)
const mapC = generateRaidMap(654321, wasteland)
assertEqual(JSON.stringify(mapA), JSON.stringify(mapB), '同 seed 地图完全一致')
assert(JSON.stringify(mapA) !== JSON.stringify(mapC), '不同 seed 地图不同')
assertEqual(mapA.width, wasteland.cols * 17, '地图宽度 = 列数 × 17')
assertEqual(mapA.height, wasteland.rows * 13, '地图高度 = 行数 × 13')
assertEqual(mapA.tiles.length, mapA.width * mapA.height, '瓦片数量正确')
assert(mapA.tiles.every((tile) => tile >= 0 && tile <= 3), '瓦片取值 0–3')
assertEqual(mapA.rooms.length, wasteland.cols * wasteland.rows, '房间数量正确')
assertEqual(mapA.startRoom, 0, '起点房间为 0')
assertEqual(mapA.rooms[0]?.kind, 'start', '0 号房间是起点')
assertEqual(mapA.rooms.filter((room) => room.kind === 'extract').length, wasteland.extractRooms, '撤离房间数量正确')
assertEqual(mapA.doors.length >= mapA.rooms.length - 1, true, '门数量至少覆盖生成树')
assert(mapA.extracts.length > 0 && mapA.extracts.every((point) => point.roomId >= 0), '撤离点存在')

// 连通性：从起点 BFS 能到达所有房间
const reachable = new Set<number>([0])
const queue = [0]
while (queue.length > 0) {
  const current = queue.shift() as number
  for (const next of mapA.rooms[current]?.neighbors ?? []) {
    if (reachable.has(next)) continue
    reachable.add(next)
    queue.push(next)
  }
}
assertEqual(reachable.size, mapA.rooms.length, '所有房间连通')
assert(mapA.rooms.every((room) => room.neighbors.length >= 1), '每个房间至少有一扇门')

// 敌人 / 容器落在房间内部且 id 唯一
const enemyIds = new Set<string>()
for (const room of mapA.rooms) {
  for (const enemy of room.enemies) {
    assert(!enemyIds.has(enemy.id), `敌人 id 唯一 ${enemy.id}`)
    enemyIds.add(enemy.id)
    assert(enemy.x > room.x && enemy.x < room.x + room.w, `敌人 x 在房间内 ${enemy.id}`)
    assert(enemy.y > room.y && enemy.y < room.y + room.h, `敌人 y 在房间内 ${enemy.id}`)
    assert(enemy.maxHp > 0 && enemy.damage > 0 && enemy.speed > 0, `敌人属性有效 ${enemy.id}`)
  }
  for (const container of room.containers) {
    assert(container.loot.length >= 1, `容器至少一件掉落 ${container.id}`)
    for (const loot of container.loot) {
      assert(!!getRaidItem(loot.itemKey), `容器掉落 key 合法 ${loot.itemKey}`)
      assert(loot.amount >= 1 && loot.amount <= (getRaidItem(loot.itemKey)?.stackMax ?? 1), `容器掉落数量合法 ${loot.id}`)
    }
  }
}
assertEqual(mapA.rooms[0]?.enemies.length, 0, '起点房间没有敌人')
assertEqual(mapA.rooms.filter((room) => room.kind === 'extract').every((room) => room.enemies.length === 0), true, '撤离房间没有敌人')

const abyssMap = generateRaidMap(999, abyss)
assertEqual(abyssMap.rooms.filter((room) => room.kind === 'boss').length, abyss.bossRooms, '深渊首领房间数量正确')
assertEqual(abyssMap.rooms.filter((room) => room.kind === 'elite').length, abyss.eliteRooms, '深渊精英房间数量正确')
assert(abyssMap.rooms.filter((room) => room.kind === 'boss').every((room) => room.enemies.some((enemy) => enemy.kind === 'boss')), '首领房间有 Boss')
assert(abyssMap.rooms.filter((room) => room.kind === 'boss').every((room) => room.containers.length >= 2), '首领房间至少 2 个容器')

/* ============================================================
   运行状态机
   ============================================================ */

function makeRun(overrides: Partial<RaidRunState> = {}): RaidRunState {
  const state = createRaidRun({
    seed: 42,
    mapKey: 'wasteland',
    difficulty: 'normal',
    hp: 200,
    maxHp: 200,
    mp: 80,
    maxMp: 80,
    atk: 30,
    insured: false,
    capacities: { backpack: 8, rig: 2, safe: 2 },
    gear: {
      helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
      armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
      boots: 'boots_t2',
      backpack: 'backpack_t1',
      rig: 'rig_t1',
    },
    backpack: [],
    rig: [],
    safe: [],
    skills: [
      { key: 'fire_claw', name: '烈焰爪', emoji: '🔥', kind: 'damage', mpCost: 25, cooldownMs: 2500 },
      { key: 'healing_light', name: '治愈之光', emoji: '✨', kind: 'heal', mpCost: 25, cooldownMs: 5000, healPct: 30 },
    ],
    startedAt: 1_000_000,
  })
  return Object.assign(state, overrides)
}

const run = makeRun()
assertEqual(run.schemaVersion, RAID_STATE_VERSION, '状态 schema 版本正确')
assertEqual(run.status, 'active', '新对局为 active')
assertEqual(run.currentRoom, 0, '从起点房间开始')
assertEqual(run.hp, 200, '初始 HP 正确')
assertEqual(run.capacities.safe, 2, '安全箱容量来自传入值')
assertEqual(run.log.length, 1, '开局写一条日志')

// 进房：不相邻拒绝；起点无敌人，可直接进入相邻房间
const neighbor = mapA.rooms[0]?.neighbors[0] as number
const farRoom = mapA.rooms.find((room) => room.id !== 0 && !(mapA.rooms[0]?.neighbors ?? []).includes(room.id))
if (farRoom) {
  const bad = applyRaidEvent(run, mapA, { type: 'enterRoom', roomId: farRoom.id }, 1_000_001)
  assert(!!bad.error, '不能进入不相邻的房间')
}
const entered = applyRaidEvent(run, mapA, { type: 'enterRoom', roomId: neighbor }, 1_000_001)
assert(!entered.error, '可以进入相邻房间')
assertEqual(entered.state.currentRoom, neighbor, '当前房间已更新')

// 击杀 / 清房
const room = mapA.rooms[neighbor] as (typeof mapA.rooms)[number]
const firstEnemy = room.enemies[0]
if (firstEnemy) {
  const clearTooEarly = applyRaidEvent(entered.state, mapA, { type: 'clearRoom', roomId: neighbor }, 1_000_002)
  assert(!!clearTooEarly.error, '还有敌人时不能清房')
  const killed = applyRaidEvent(entered.state, mapA, { type: 'kill', enemyId: firstEnemy.id }, 1_000_002)
  assert(!killed.error, '可以击杀当前房间的敌人')
  assertEqual(killed.state.kills, 1, '击杀数 +1')
  const unknownKill = applyRaidEvent(killed.state, mapA, { type: 'kill', enemyId: 'e-999-9' }, 1_000_003)
  assert(!!unknownKill.error, '不能击杀不存在的敌人')
}

// 开箱需要清场
const firstContainer = room.containers[0]
assert(!!firstContainer, '战斗房间至少有一个容器')
if (firstContainer) {
  const notCleared = applyRaidEvent(entered.state, mapA, { type: 'openContainer', containerId: firstContainer.id }, 1_000_004)
  assert(!!notCleared.error, '房间未清场时不能开箱')
}

// 造一个「已清场」的状态：杀光当前房间所有敌人
let clearedState = entered.state
for (const enemy of room.enemies) {
  clearedState = applyRaidEvent(clearedState, mapA, { type: 'kill', enemyId: enemy.id }, 1_000_005).state
}
const cleared = applyRaidEvent(clearedState, mapA, { type: 'clearRoom', roomId: neighbor }, 1_000_006)
assert(!cleared.error, '杀光后可以清房')
assertEqual(cleared.state.clearedRooms.includes(neighbor), true, '清房记录已写入')

// 开箱 + 拾取
if (firstContainer) {
  const opened = applyRaidEvent(cleared.state, mapA, { type: 'openContainer', containerId: firstContainer.id }, 1_000_007)
  assert(!opened.error, '清场后可以开箱')
  const loot = firstContainer.loot[0]
  assert(!!loot, '容器里有掉落')
  if (loot) {
    const take = applyRaidEvent(opened.state, mapA, {
      type: 'takeLoot',
      containerId: firstContainer.id,
      lootId: loot.id,
      target: 'backpack',
    }, 1_000_008)
    assert(!take.error, '可以拾取到背包')
    assertEqual(take.state.backpack.length, 1, '背包多了一格')
    const again = applyRaidEvent(take.state, mapA, {
      type: 'takeLoot',
      containerId: firstContainer.id,
      lootId: loot.id,
      target: 'backpack',
    }, 1_000_009)
    assert(!!again.error, '同一件掉落不能重复拾取')
    const def = getRaidItem(loot.itemKey)
    if (def && def.kind !== 'consumable') {
      const rigTake = applyRaidEvent(cleared.state, mapA, {
        type: 'takeLoot',
        containerId: firstContainer.id,
        lootId: loot.id,
        target: 'rig',
      }, 1_000_010)
      assert(!!rigTake.error, '胸挂只能放消耗品')
    }
  }
}

// 容量为 0 时不能拾取
const noBag = makeRun({ capacities: { backpack: 0, rig: 0, safe: 0 } })
const noBagCleared = { ...noBag, currentRoom: neighbor, clearedRooms: [neighbor], killedEnemies: room.enemies.map((enemy) => enemy.id) }
if (firstContainer) {
  const openedNoBag = applyRaidEvent(noBagCleared, mapA, { type: 'openContainer', containerId: firstContainer.id }, 1_000_011)
  const loot = firstContainer.loot[0]
  if (loot && !openedNoBag.error) {
    const take = applyRaidEvent(openedNoBag.state, mapA, {
      type: 'takeLoot',
      containerId: firstContainer.id,
      lootId: loot.id,
      target: 'backpack',
    }, 1_000_012)
    assert(!!take.error, '没有背包容量时不能拾取')
  }
}

/* ============================================================
   容器工具
   ============================================================ */

const stack = addItemToContainer([], 2, 'scrap_metal', 3)
assert(!!stack && stack.length === 1 && stack[0]?.amount === 3, '空容器放入 3 件')
const stacked = addItemToContainer(stack, 2, 'scrap_metal', 3)
assert(!!stacked && stacked.length === 2 && stacked.reduce((sum, item) => sum + item.amount, 0) === 6, '超过堆叠上限自动开新格')
const overflow = addItemToContainer(stacked, 2, 'scrap_metal', 5)
assertEqual(overflow, null, '容器满时返回 null')
assertEqual(findContainerSlot([{ slotIndex: 0, itemKey: 'scrap_metal', amount: 1 }], 2), 1, '找到下一个空槽')
assertEqual(findContainerSlot([{ slotIndex: 0, itemKey: 'scrap_metal', amount: 1 }, { slotIndex: 1, itemKey: 'copper_wire', amount: 1 }], 2), -1, '容器满时没有空槽')
const consumed = consumeItemFromContainer(stacked, 'scrap_metal', 4)
assert(!!consumed && consumed.reduce((sum, item) => sum + item.amount, 0) === 2, '按数量消耗物品')

/* ============================================================
   伤害 / 耐久 / 维修
   ============================================================ */

const bodyHit = resolveRaidDamage({
  raw: 100,
  zone: 'body',
  helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
  armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
})
assertEqual(bodyHit.hpDamage, 74, '3 级护甲 26% 减伤：100 → 74')
assertEqual(bodyHit.armorLoss, 25, '耐久损耗 = 100 × 0.25')
assertEqual(bodyHit.helmetLoss, 0, '打身体不掉头盔耐久')
const headHit = resolveRaidDamage({
  raw: 100,
  zone: 'head',
  helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
  armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
})
assertEqual(headHit.hpDamage, 80, '3 级头盔 20% 减伤：100 → 80')
assertEqual(headHit.helmetLoss, 25, '头盔掉耐久')
const brokenArmor = resolveRaidDamage({
  raw: 100,
  zone: 'body',
  helmet: null,
  armor: { key: 'armor_t6', durability: 0, maxDurability: 180 },
})
assertEqual(brokenArmor.hpDamage, 100, '耐久为 0 时护甲不再减伤')
assertEqual(brokenArmor.armorLoss, 0, '耐久为 0 时不再扣耐久')

const damaged = makeRun()
const damageEvent = applyRaidEvent(damaged, mapA, { type: 'damage', amount: 100, zone: 'body' }, 1_000_020)
assert(!damageEvent.error, '受伤事件成功')
assertEqual(damageEvent.state.hp, 126, '受伤后 HP 126')
assertEqual(damageEvent.state.gear.armor?.durability, 75, '护甲耐久 100 → 75')
const lethal = applyRaidEvent(damageEvent.state, mapA, { type: 'damage', amount: 100000, zone: 'body' }, 1_000_021)
assertEqual(lethal.state.status, 'died', 'HP 归零判阵亡')

const repairSource = { key: 'armor_t3', durability: 20, maxDurability: 100 }
const repaired = repairRaidGear(repairSource, 'armor_repair')
assert(repaired.ok && !!repaired.gear, '甲修包可以维修护甲')
assertEqual(repaired.gear?.durability, 95, '维修后耐久 20 + 80 → 95（受上限）')
assertEqual(repaired.gear?.maxDurability, 95, '维修后耐久上限 100 → 95')
const repairedTwice = repairRaidGear({ ...repaired.gear!, durability: 50 }, 'armor_repair')
assertEqual(repairedTwice.gear?.maxDurability, Math.floor(95 * 0.95), '再次维修上限继续下降')
assertEqual(repairRaidGear({ key: 'helmet_t3', durability: 10, maxDurability: 70 }, 'armor_repair').ok, false, '甲修包不能修头盔')
assertEqual(repairRaidGear({ key: 'helmet_t3', durability: 70, maxDurability: 70 }, 'helmet_repair').ok, false, '满耐久不需要维修')
const floorRepair = repairRaidGear(
  { key: 'helmet_t1', durability: 0, maxDurability: 40 },
  'helmet_repair',
)
assertEqual(floorRepair.gear?.maxDurability, 38, '首次维修上限 40 → 38')
let floorGear = { key: 'helmet_t1', durability: 0, maxDurability: 40 }
for (let i = 0; i < 50; i += 1) {
  const result = repairRaidGear({ ...floorGear, durability: 0 }, 'helmet_repair')
  if (!result.ok || !result.gear) break
  floorGear = result.gear
}
assert((floorGear.maxDurability ?? 0) >= Math.ceil(40 * RAID_REPAIR_FLOOR_RATIO), '耐久上限不会低于初始 30%')
assert((floorGear.maxDurability ?? 0) < 40, '耐久上限确实被维修磨损')

/* ============================================================
   道具 / 技能 / 撤离
   ============================================================ */

const withMedkit = makeRun({
  hp: 100,
  backpack: [{ slotIndex: 0, itemKey: 'medkit', amount: 1 }],
})
const heal = applyRaidEvent(withMedkit, mapA, { type: 'useItem', itemKey: 'medkit', from: 'backpack' }, 1_000_030)
assert(!heal.error, '可以使用急救包')
assertEqual(heal.state.hp, 170, '急救包回复 35% 最大 HP（200 → 170）')
assertEqual(heal.state.backpack.length, 0, '急救包被消耗')

const fullHp = makeRun({ backpack: [{ slotIndex: 0, itemKey: 'medkit', amount: 1 }] })
assert(!!applyRaidEvent(fullHp, mapA, { type: 'useItem', itemKey: 'medkit', from: 'backpack' }, 1_000_031).error, '满血不能使用急救包')

const skillRun = makeRun()
const cast = applyRaidEvent(skillRun, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_040)
assert(!cast.error, '可以释放已装备技能')
assertEqual(cast.state.mp, 55, '技能扣除 25 MP')
const cooldown = applyRaidEvent(cast.state, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_041)
assert(!!cooldown.error, '冷却中不能再次释放')
const afterCd = applyRaidEvent(cast.state, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_040 + RAID_SKILL_CD_MS)
assert(!afterCd.error, '冷却结束可以再次释放')
const healSkill = applyRaidEvent(
  { ...makeRun({ hp: 100 }), mp: 80 },
  mapA,
  { type: 'castSkill', skillKey: 'healing_light' },
  1_000_050,
)
assert(!healSkill.error, '治疗技能成功')
assertEqual(healSkill.state.hp, 160, '治疗技能回复 30% 最大 HP（100 → 160）')
const noMp = applyRaidEvent({ ...makeRun(), mp: 10 }, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_060)
assert(!!noMp.error, 'MP 不足不能释放技能')

// 撤离：错误房间 / 未读条 / 读条完成
const extractRoom = mapA.rooms.find((room) => room.kind === 'extract') as (typeof mapA.rooms)[number]
const wrongRoom = applyRaidEvent(makeRun(), mapA, { type: 'extractStart' }, 1_000_070)
assert(!!wrongRoom.error, '非撤离房间不能开始撤离')
const atExtract = makeRun({ currentRoom: extractRoom.id, clearedRooms: [extractRoom.id] })
const startExtract = applyRaidEvent(atExtract, mapA, { type: 'extractStart' }, 1_000_071)
assert(!startExtract.error, '撤离房间可以开始读条')
const tooEarly = applyRaidEvent(startExtract.state, mapA, { type: 'extractDone' }, 1_000_072)
assert(!!tooEarly.error, '读条未完成不能撤离')
const done = applyRaidEvent(startExtract.state, mapA, { type: 'extractDone' }, 1_000_071 + 6000)
assertEqual(done.state.status, 'extracted', '读条完成后撤离成功')

// 放弃 / 超时
assertEqual(applyRaidEvent(makeRun(), mapA, { type: 'abandon' }, 1_000_080).state.status, 'abandoned', '主动放弃')
const expired = tickRaidRun(makeRun(), 1_000_000 + wasteland.durationMs)
assertEqual(expired.status, 'mia', '超时判失联')

/* ============================================================
   结算 / 保险 / 契约
   ============================================================ */

const extractedState = makeRun({
  status: 'extracted',
  backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 2 }],
  rig: [{ slotIndex: 0, itemKey: 'medkit', amount: 1 }],
  safe: [{ slotIndex: 0, itemKey: 'gold_compass', amount: 1 }],
})
const keptAll = raidKeptContainers(extractedState)
assertEqual(keptAll.backpack.length, 1, '撤离保留背包')
assertEqual(keptAll.rig.length, 1, '撤离保留胸挂')
assertEqual(keptAll.safe.length, 1, '撤离保留安全箱')
const diedState = { ...extractedState, status: 'died' as const }
const keptSafe = raidKeptContainers(diedState)
assertEqual(keptSafe.backpack.length, 0, '阵亡丢失背包')
assertEqual(keptSafe.rig.length, 0, '阵亡丢失胸挂')
assertEqual(keptSafe.safe.length, 1, '阵亡保留安全箱')
assertEqual(raidLootValue(keptAll.backpack), 70, '战利品价值 = 35 × 2')

const gearValue = {
  helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
  armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
  boots: 'boots_t2',
  backpack: 'backpack_t2',
  rig: 'rig_t1',
}
assertEqual(raidInsuranceCost(gearValue), Math.ceil((900 + 1100 + 320 + 700 + 200) * 0.15), '保险 = 装备价值 15%')
assertEqual(raidInsuranceCost({ helmet: null, armor: null, boots: null, backpack: null, rig: null }), 0, '裸装保险为 0')
assertEqual(raidInsuranceCost({ helmet: { key: 'helmet_t1', durability: 40, maxDurability: 40 }, armor: null, boots: null, backpack: null, rig: null }), 23, '低价值装备保险向上取整')

assertEqual(raidSellPrice('scrap_metal', 2), 70, '材料回收价 100%')
assertEqual(raidSellPrice('medkit', 1), 72, '消耗品回收价 60%')
assertEqual(raidSellPrice('gear_cache', 1), 182, '装备箱回收价 70%')
assertEqual(raidSellPrice('nope', 1), 0, '未知物品回收价 0')

assertEqual(RAID_CONTRACTS.length, 3, '每日契约 3 条')
assert(RAID_CONTRACT_MAP.has('extract_1') && RAID_CONTRACT_MAP.has('kill_3') && RAID_CONTRACT_MAP.has('loot_2500'), '契约 key 正确')
assert(RAID_CONTRACTS.every((contract) => contract.rewardPoints > 0 && contract.target > 0), '契约奖励与目标为正')

/* ---------- 批量事件 ---------- */
const batchRun = makeRun()
const batch = applyRaidEvents(batchRun, mapA, [
  { type: 'enterRoom', roomId: neighbor },
  { type: 'kill', enemyId: 'not-a-real-enemy' },
  { type: 'abandon' },
], 1_000_090)
assertEqual(batch.applied, 2, '批量事件跳过非法条目')
assertEqual(batch.errors.length, 1, '批量事件记录 1 条错误')
assertEqual(batch.state.status, 'abandoned', '批量事件最终状态')

const legacyState = { ...makeRun(), schemaVersion: 1 } as unknown as RaidRunState
assertEqual(legacyState.schemaVersion, 1, '旧 schema 可构造（服务层按放弃处理）')

console.log(`✅ 搜打撤 v2 引擎自检：${passed} 个断言`)
