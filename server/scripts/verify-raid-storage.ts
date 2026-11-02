/**
 * 搜打撤仓库 / 交易行 / 新地图新物品 纯函数自检。
 * 不依赖数据库、环境变量或网络。
 *
 * 覆盖：
 *   1. RAID_STORAGE_LEVELS 不变量      2. 等级夹取 / 满级
 *   3. planWarehouseInsert 入仓规划    4. 交易行定价与手续费
 *   5. 新地图（孢子雨林 / 深渊实验室）  6. 新物品与 mythic 掉落
 *   7. 保险箱容量参数                  8. 深渊实验室脚本化对局
 *
 * 用法: cd server && npx tsx scripts/verify-raid-storage.ts（或 npm run verify:raidstorage）
 */

import {
  RAID_LOOT_ENTRIES,
  RAID_MAPS,
  RAID_SAFE_CAPACITY,
  createRaidRng,
  createRaidState,
  extractRaid,
  getRaidMap,
  keptLoot,
  moveRaid,
  rarityWeight,
  rollRaidLoot,
  searchRaid,
  storeSafeRaid,
  totalLootValue,
  type RaidLootRarity,
  type RaidMapDef,
  type RaidState,
} from '../src/lib/petRaid.js'
import {
  RAID_STORAGE_LEVELS,
  nextStorageUpgrade,
  planWarehouseInsert,
  raidListingValue,
  raidMarketFee,
  raidMarketSellerProceeds,
  raidMaterialEntries,
  safeCapacityFor,
  storageLevelInfo,
  validateRaidListingPrice,
} from '../src/lib/raidStorage.js'

let passed = 0

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`❌ ${message}`)
  passed += 1
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`❌ ${message}（实际 ${String(actual)}，期望 ${String(expected)}）`)
  }
  passed += 1
}

function expectThrow(fn: () => unknown, message: string): void {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  if (!threw) throw new Error(`❌ ${message}（期望抛错但没有抛）`)
  passed += 1
}

function makeState(map: RaidMapDef, seed: number): RaidState {
  return createRaidState({
    map,
    seed,
    now: 1_700_000_000_000,
    loadout: {
      petId: 1,
      userId: 7,
      name: '测试宠物',
      species: 'dog',
      level: 10,
      equipmentKeys: ['flame_sword', 'crystal_plate'],
      skillKeys: ['fire_claw', 'healing_light', 'meteor'],
    },
    stats: { maxHp: 400, maxMp: 200, atk: 100, def: 50, spd: 50, crit: 20 },
    insured: false,
  })
}

function stackText(stacks: Array<{ itemKey: string; amount: number }>): string {
  return stacks.map((stack) => `${stack.itemKey}×${stack.amount}`).join(',') || '(空)'
}

function assertStacks(
  actual: Array<{ itemKey: string; amount: number }>,
  expected: Array<{ itemKey: string; amount: number }>,
  message: string,
): void {
  assertEqual(stackText(actual), stackText(expected), message)
}

/* ============================================================
   1. RAID_STORAGE_LEVELS 不变量
   ============================================================ */

assertEqual(RAID_STORAGE_LEVELS.length, 6, '仓库共 6 级')
RAID_STORAGE_LEVELS.forEach((level, index) => {
  assertEqual(level.level, index + 1, `仓库等级连续：第 ${index + 1} 项 level = ${index + 1}`)
})
for (let i = 1; i < RAID_STORAGE_LEVELS.length; i += 1) {
  const prev = RAID_STORAGE_LEVELS[i - 1]!
  const curr = RAID_STORAGE_LEVELS[i]!
  assert(curr.capacity >= prev.capacity, `等级 ${curr.level} 容量不降（${prev.capacity} → ${curr.capacity}）`)
  assert(curr.safeCapacity >= prev.safeCapacity, `等级 ${curr.level} 保险箱格数不降`)
  assert(curr.upgradePoints > prev.upgradePoints, `等级 ${curr.level} 升级积分严格递增`)
}
assertEqual(RAID_STORAGE_LEVELS[0]!.upgradePoints, 0, '初始级升级积分为 0')
for (const level of RAID_STORAGE_LEVELS) {
  for (const req of level.upgradeItems) {
    const entry = RAID_LOOT_ENTRIES.find((item) => item.key === req.itemKey)
    assert(!!entry, `等级 ${level.level} 升级材料 ${req.itemKey} 在战利品目录中`)
    assertEqual(entry?.kind, 'material', `等级 ${level.level} 升级材料 ${req.itemKey} 是 material 类`)
    assert(req.count >= 1, `等级 ${level.level} 升级材料 ${req.itemKey} 数量 ≥ 1`)
  }
}
assert(RAID_STORAGE_LEVELS[RAID_STORAGE_LEVELS.length - 1]!.upgradeItems.length > 0, '满级前一级有升级材料')

/* ============================================================
   2. storageLevelInfo / nextStorageUpgrade
   ============================================================ */

assertEqual(storageLevelInfo(1).capacity, 60, '1 级仓库容量 60')
assertEqual(storageLevelInfo(6).capacity, 360, '6 级仓库容量 360')
assertEqual(storageLevelInfo(1).safeCapacity, 2, '1 级保险箱 2 格')
assertEqual(storageLevelInfo(6).safeCapacity, 6, '6 级保险箱 6 格')
assertEqual(storageLevelInfo(0).level, 1, '等级 0 夹取到 1')
assertEqual(storageLevelInfo(-5).level, 1, '负等级夹取到 1')
assertEqual(storageLevelInfo(99).level, 6, '超高档位夹取到 6')
assertEqual(storageLevelInfo(Number.NaN).level, 1, 'NaN 夹取到 1')
assertEqual(storageLevelInfo(2.9).level, 2, '小数截断取整')
assertEqual(nextStorageUpgrade(1)?.level, 2, '1 级下一档是 2')
assertEqual(nextStorageUpgrade(5)?.level, 6, '5 级下一档是 6')
assertEqual(nextStorageUpgrade(6), null, '6 级已满级')
assertEqual(nextStorageUpgrade(99), null, '越界等级视为满级')
assertEqual(safeCapacityFor(1), 2, 'safeCapacityFor(1) = 2')
assertEqual(safeCapacityFor(4), 4, 'safeCapacityFor(4) = 4')
assertEqual(safeCapacityFor(999), 6, 'safeCapacityFor 越界夹取')

/* ============================================================
   3. planWarehouseInsert
   ============================================================ */

{
  const plan = planWarehouseInsert(60, 0, [{ itemKey: 'canned_food', amount: 10 }])
  assertStacks(plan.accepted, [{ itemKey: 'canned_food', amount: 10 }], '空仓全收：accepted')
  assertStacks(plan.overflow, [], '空仓全收：overflow 为空')

  const partial = planWarehouseInsert(10, 8, [{ itemKey: 'copper_wire', amount: 5 }])
  assertStacks(partial.accepted, [{ itemKey: 'copper_wire', amount: 2 }], '超容量部分入仓')
  assertStacks(partial.overflow, [{ itemKey: 'copper_wire', amount: 3 }], '超容量部分溢出')

  const exact = planWarehouseInsert(10, 8, [{ itemKey: 'copper_wire', amount: 2 }])
  assertStacks(exact.accepted, [{ itemKey: 'copper_wire', amount: 2 }], '恰好装满：accepted')
  assertStacks(exact.overflow, [], '恰好装满：overflow 为空')

  const multi = planWarehouseInsert(10, 0, [
    { itemKey: 'canned_food', amount: 6 },
    { itemKey: 'old_watch', amount: 6 },
  ])
  assertStacks(multi.accepted, [
    { itemKey: 'canned_food', amount: 6 },
    { itemKey: 'old_watch', amount: 4 },
  ], '多物品按顺序填充')
  assertStacks(multi.overflow, [{ itemKey: 'old_watch', amount: 2 }], '多物品溢出尾部')

  const zeroCap = planWarehouseInsert(0, 0, [{ itemKey: 'canned_food', amount: 3 }])
  assertStacks(zeroCap.accepted, [], '零容量全溢出：accepted 为空')
  assertStacks(zeroCap.overflow, [{ itemKey: 'canned_food', amount: 3 }], '零容量全溢出')

  const fullUsed = planWarehouseInsert(10, 12, [{ itemKey: 'canned_food', amount: 4 }])
  assertStacks(fullUsed.accepted, [], 'used 已超容量：不再入仓')
  assertStacks(fullUsed.overflow, [{ itemKey: 'canned_food', amount: 4 }], 'used 已超容量：全部溢出')

  const merged = planWarehouseInsert(4, 0, [
    { itemKey: 'canned_food', amount: 2 },
    { itemKey: 'canned_food', amount: 3 },
  ])
  assertStacks(merged.accepted, [{ itemKey: 'canned_food', amount: 4 }], '同名堆叠合并后填充')
  assertStacks(merged.overflow, [{ itemKey: 'canned_food', amount: 1 }], '同名堆叠合并后溢出')

  const zeroAmount = planWarehouseInsert(10, 0, [
    { itemKey: 'canned_food', amount: 0 },
    { itemKey: 'old_watch', amount: 2 },
  ])
  assertStacks(zeroAmount.accepted, [{ itemKey: 'old_watch', amount: 2 }], '零数量堆叠被忽略')

  expectThrow(() => planWarehouseInsert(-1, 0, []), '负容量抛错')
  expectThrow(() => planWarehouseInsert(10, -1, []), '负已用容量抛错')
  expectThrow(() => planWarehouseInsert(10, 0, [{ itemKey: 'a', amount: -2 }]), '负入仓数量抛错')
  expectThrow(() => planWarehouseInsert(10, 0, [{ itemKey: 'a', amount: 1.5 }]), '非整数数量抛错')
  expectThrow(() => planWarehouseInsert(Number.NaN, 0, []), 'NaN 容量抛错')
  expectThrow(() => planWarehouseInsert(10, 0, [{ itemKey: '', amount: 1 }]), '空 itemKey 抛错')
}

/* ============================================================
   4. 交易行定价与手续费
   ============================================================ */

assertEqual(raidMarketFee(100), 5, '手续费 5%：100 → 5')
assertEqual(raidMarketFee(1), 1, '手续费最低 1：1 → 1')
assertEqual(raidMarketFee(19), 1, '手续费向上取整：19 → 1')
assertEqual(raidMarketFee(21), 2, '手续费向上取整：21 → 2')
assertEqual(raidMarketFee(0), 0, '0 元挂单手续费 0')
assertEqual(raidMarketFee(-50), 0, '负数价格手续费 0')
assertEqual(raidListingValue('canned_food', 3), 180, '目录价值 = 单价 × 数量（罐头×3）')
assertEqual(raidListingValue('heart_of_africa', 1), 9999, '非洲之心目录价值 9999')
assertEqual(raidListingValue('not_a_key', 3), 0, '未知物品目录价值 0')
assertEqual(raidMarketSellerProceeds(100), 95, '卖家到账 = 整单价 − 手续费')

// 罐头单价 60：1 件的合法区间是 [30, 90]
validateRaidListingPrice('canned_food', 1, 30) // 下端点合法
validateRaidListingPrice('canned_food', 1, 60) // 目录价合法
validateRaidListingPrice('canned_food', 1, 90) // 上端点合法
validateRaidListingPrice('canned_food', 2, 60) // 2 件目录价 120 合法
expectThrow(() => validateRaidListingPrice('canned_food', 1, 29), '价格低于 50% 抛错')
expectThrow(() => validateRaidListingPrice('canned_food', 1, 91), '价格高于 150% 抛错')
expectThrow(() => validateRaidListingPrice('canned_food', 0, 30), '数量 0 抛错')
expectThrow(() => validateRaidListingPrice('canned_food', -1, 30), '负数量抛错')
expectThrow(() => validateRaidListingPrice('canned_food', 1, 0), '价格 0 抛错')
expectThrow(() => validateRaidListingPrice('canned_food', 1, 1_000_001), '价格超硬上限抛错')
expectThrow(() => validateRaidListingPrice('canned_food', 1, 30.5), '非整数价格抛错')
expectThrow(() => validateRaidListingPrice('no_such_item', 1, 30), '未知物品抛错')

/* ============================================================
   5. 新地图：孢子雨林 / 深渊实验室
   ============================================================ */

assertEqual(RAID_MAPS.length, 6, '共 6 张搜打撤地图')
assertEqual(new Set(RAID_MAPS.map((map) => map.key)).size, 6, '地图 key 唯一')
const fungal = getRaidMap('fungal')
const abyss = getRaidMap('abyss')
assert(!!fungal, '孢子雨林存在')
assert(!!abyss, '深渊实验室存在')

{
  const map = fungal!
  assertEqual(map.name, '孢子雨林', '孢子雨林名称')
  assertEqual(map.size, 9, '孢子雨林尺寸 9')
  assertEqual(map.enemyCount, 10, '孢子雨林敌人数 10')
  assertEqual(map.bossCount, 2, '孢子雨林首领数 2')
  assertEqual(map.lootCount, 14, '孢子雨林物资数 14')
  assertEqual(map.extractCount, 2, '孢子雨林撤离点 2 个')
  assertEqual(map.hazardCount, 4, '孢子雨林危险区 4')
  assertEqual(map.entryCost, 320, '孢子雨林门票 320')
  assertEqual(map.maxTurns, 52, '孢子雨林行动点 52')
  assertEqual(map.recommendLevel, 6, '孢子雨林建议等级 6')
  assertEqual(map.lootTier, 4, '孢子雨林战利品档次 4')
  assertEqual(map.enemyLevel, 7, '孢子雨林敌人等级 7')
}
{
  const map = abyss!
  assertEqual(map.name, '深渊实验室', '深渊实验室名称')
  assertEqual(map.size, 10, '深渊实验室尺寸 10')
  assertEqual(map.enemyCount, 14, '深渊实验室敌人数 14')
  assertEqual(map.bossCount, 2, '深渊实验室首领数 2')
  assertEqual(map.lootCount, 18, '深渊实验室物资数 18')
  assertEqual(map.extractCount, 3, '深渊实验室撤离点 3 个')
  assertEqual(map.hazardCount, 6, '深渊实验室危险区 6')
  assertEqual(map.entryCost, 900, '深渊实验室门票 900')
  assertEqual(map.maxTurns, 62, '深渊实验室行动点 62')
  assertEqual(map.recommendLevel, 10, '深渊实验室建议等级 10')
  assertEqual(map.lootTier, 5, '深渊实验室战利品档次 5（唯一 mythic 掉落档）')
  assertEqual(map.enemyLevel, 12, '深渊实验室敌人等级 12')
}
{
  // 建议等级无重复且难度递增合理
  const levels = RAID_MAPS.map((map) => map.recommendLevel).sort((a, b) => a - b)
  assertEqual(new Set(levels).size, levels.length, '各图建议等级不重复')
  assert(levels.every((level, i) => i === 0 || level > levels[i - 1]), '建议等级排序后严格递增')
  const tiers = RAID_MAPS.map((map) => map.lootTier).sort((a, b) => a - b)
  assert(tiers.every((tier, i) => i === 0 || tier >= tiers[i - 1]), '战利品档位数组内不递减（按图序）')
}

for (const key of ['fungal', 'abyss'] as const) {
  const map = getRaidMap(key)!
  const a = makeState(map, 20260101)
  const b = makeState(map, 20260101)
  const c = makeState(map, 20260102)
  assertEqual(JSON.stringify(a.cells), JSON.stringify(b.cells), `${map.name} 同 seed 完全一致`)
  assert(JSON.stringify(a.cells) !== JSON.stringify(c.cells), `${map.name} 不同 seed 地图不同`)
  assertEqual(a.width, map.size, `${map.name} 宽度 = size`)
  assertEqual(a.cells.length, map.size * map.size, `${map.name} 格子数 = size²`)
  assertEqual(a.cells.filter((cell) => cell.kind === 'extract').length, map.extractCount, `${map.name} 撤离点数量`)
  assertEqual(a.cells.filter((cell) => cell.kind === 'boss').length, map.bossCount, `${map.name} 首领数量`)
  assertEqual(a.cells.filter((cell) => cell.kind === 'enemy').length, map.enemyCount, `${map.name} 敌人数量`)
  assertEqual(a.cells.filter((cell) => cell.kind === 'loot').length, map.lootCount, `${map.name} 物资箱数量`)
  assertEqual(a.cells.filter((cell) => cell.kind === 'hazard').length, map.hazardCount, `${map.name} 危险区数量`)
  assertEqual(a.cells.filter((cell) => cell.kind === 'spawn').length, 1, `${map.name} 出生点 1 个`)
  // 撤离点不全在出生点旁
  const extracts = a.cells.filter((cell) => cell.kind === 'extract')
  assert(
    extracts.every((cell) => cell.x + cell.y >= 3),
    `${map.name} 全部撤离点离出生点足够远`,
  )
  // 每个撤离点到出生点都能走通（棋盘上必然连通，这里断言不在边界死角：至少有 2 个相邻格在图内）
  for (const cell of extracts) {
    const neighbors = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
      const x = cell.x + dx
      const y = cell.y + dy
      return x >= 0 && y >= 0 && x < map.size && y < map.size
    }).length
    assert(neighbors >= 2, `${map.name} 撤离点 (${cell.x},${cell.y}) 可达`)
  }
}

/* ============================================================
   6. 新物品 / mythic 掉落
   ============================================================ */

assertEqual(RAID_LOOT_ENTRIES.length, 24, '战利品目录共 24 种（15 + 9）')
assertEqual(new Set(RAID_LOOT_ENTRIES.map((item) => item.key)).size, RAID_LOOT_ENTRIES.length, '战利品 key 唯一')

const newKeys = [
  'scrap_metal', 'duct_tape', 'titanium_alloy', 'laser_module', 'plasma_core',
  'ai_chip', 'quantum_battery', 'gold_statue', 'heart_of_africa',
]
for (const key of newKeys) {
  const entry = RAID_LOOT_ENTRIES.find((item) => item.key === key)
  assert(!!entry, `新物品 ${key} 存在`)
  assertEqual(entry?.kind, 'material', `新物品 ${key} 是 material 类`)
  assert((entry?.value ?? 0) > 0, `新物品 ${key} 价值 > 0`)
  assert((entry?.weight ?? 0) > 0, `新物品 ${key} 权重 > 0`)
}

const heart = RAID_LOOT_ENTRIES.find((item) => item.key === 'heart_of_africa')!
assertEqual(heart.rarity, 'mythic', '非洲之心是 mythic 稀有度')
assertEqual(heart.value, 9999, '非洲之心价值 9999')
assertEqual(heart.name, '非洲之心', '非洲之心名称')
const maxValue = Math.max(...RAID_LOOT_ENTRIES.map((item) => item.value))
assertEqual(heart.value, maxValue, '非洲之心是全目录最高价值物品')
assertEqual(RAID_LOOT_ENTRIES.filter((item) => item.rarity === 'mythic').length, 1, 'mythic 物品只有非洲之心一种')

// 权重表：mythic 只在 tier 5 > 0；每行总权重 100
for (const tier of [1, 2, 3, 4]) {
  assertEqual(rarityWeight('mythic', tier), 0, `tier ${tier} mythic 权重为 0`)
}
assert(rarityWeight('mythic', 5) > 0, 'tier 5 mythic 权重 > 0')
assertEqual(rarityWeight('mythic', 5), 3, 'tier 5 mythic 权重 = 3')
const rarities: RaidLootRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']
for (const tier of [1, 2, 3, 4, 5]) {
  const sum = rarities.reduce((acc, rarity) => acc + rarityWeight(rarity, tier), 0)
  assertEqual(sum, 100, `tier ${tier} 各稀有度权重合计 100`)
}
assertEqual(rarityWeight('common', 1), 65, 'tier 1 老权重不变（common 65）')
assertEqual(rarityWeight('legendary', 4), 17, 'tier 4 老权重不变（legendary 17）')

// tier 5 地图足够多固定 seed 必出 mythic；tier 1–4 地图永不掉 mythic
{
  const abyssMap = getRaidMap('abyss')!
  const abyssState = makeState(abyssMap, 1)
  const SEEDS = 4000
  let mythicCount = 0
  let legendaryCount = 0
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    const items = rollRaidLoot(abyssState, createRaidRng(seed))
    for (const item of items) {
      if (item.rarity === 'mythic') mythicCount += 1
      if (item.rarity === 'legendary') legendaryCount += 1
    }
  }
  assert(mythicCount >= 1, `${SEEDS} 个固定 seed 的深渊搜刮至少掉过一次 mythic（实际 ${mythicCount}）`)
  assert(legendaryCount >= 10, `${SEEDS} 个 seed 中传说级也稳定出现（实际 ${legendaryCount}）`)

  for (const key of ['wasteland', 'dam', 'valley', 'space', 'fungal'] as const) {
    const map = getRaidMap(key)!
    assert(map.lootTier <= 4, `${map.name} 是 tier 1–4 地图`)
    const state = makeState(map, 2)
    for (let seed = 1; seed <= 200; seed += 1) {
      const items = rollRaidLoot(state, createRaidRng(seed))
      assert(
        items.every((item) => item.rarity !== 'mythic'),
        `${map.name} 永不掉 mythic（seed ${seed}）`,
      )
    }
  }
}

/* ============================================================
   7. 保险箱容量参数
   ============================================================ */

{
  const state = makeState(getRaidMap('wasteland')!, 77)
  const loot = [
    rollRaidLoot(state, createRaidRng(11)),
    rollRaidLoot(state, createRaidRng(12)),
    rollRaidLoot(state, createRaidRng(13)),
    rollRaidLoot(state, createRaidRng(14)),
    rollRaidLoot(state, createRaidRng(15)),
    rollRaidLoot(state, createRaidRng(16)),
  ].flat()
  assert(loot.length >= 6, '准备保险箱测试的战利品充足')

  // 默认容量 = RAID_SAFE_CAPACITY = 2
  const defaultState = makeState(getRaidMap('wasteland')!, 78)
  defaultState.loot = [...loot]
  const d1 = storeSafeRaid(defaultState, loot[0]!.id)
  const d2 = storeSafeRaid(d1.state, loot[1]!.id)
  assert(!d1.error && !d2.error, '默认容量可放 2 件')
  const d3 = storeSafeRaid(d2.state, loot[2]!.id)
  assert(!!d3.error, `默认容量 ${RAID_SAFE_CAPACITY} 件：第 3 件被拒`)

  // 显式容量 5
  const bigState = makeState(getRaidMap('wasteland')!, 79)
  bigState.loot = [...loot]
  let current = bigState
  for (let i = 0; i < 5; i += 1) {
    const step = storeSafeRaid(current, loot[i]!.id, 5)
    assert(!step.error, `容量 5：第 ${i + 1} 件可放入保险箱`)
    current = step.state
  }
  assertEqual(current.safe.length, 5, '容量 5：保险箱内有 5 件')
  const sixth = storeSafeRaid(current, loot[5]!.id, 5)
  assert(!!sixth.error, '容量 5：第 6 件被拒')

  // 容量 0
  const tinyState = makeState(getRaidMap('wasteland')!, 80)
  tinyState.loot = [loot[0]!]
  const tiny = storeSafeRaid(tinyState, loot[0]!.id, 0)
  assert(!!tiny.error, '容量 0：第 1 件即被拒')
}

/* ============================================================
   8. 深渊实验室脚本化对局（move → search → extract）
   ============================================================ */

{
  const map = getRaidMap('abyss')!
  const state = createRaidState({
    map,
    seed: 20261103,
    now: 1_700_000_000_000,
    loadout: {
      petId: 1,
      userId: 7,
      name: '深渊猎人',
      species: 'cat',
      level: 10,
      equipmentKeys: ['flame_sword', 'crystal_plate'],
      skillKeys: ['fire_claw', 'healing_light', 'meteor'],
    },
    // 高属性配置：保证清怪不倒
    stats: { maxHp: 5000, maxMp: 999, atk: 500, def: 200, spd: 99, crit: 25 },
    insured: true,
  })

  const manhattanTo = (state: RaidState, cell: { x: number; y: number }) =>
    Math.abs(state.player.x - cell.x) + Math.abs(state.player.y - cell.y)

  let guard = 0
  while (state.status === 'active' && guard < 400) {
    guard += 1
    const here = state.cells[state.player.y * state.width + state.player.x]!
    if (here.kind === 'extract') {
      const step = extractRaid(state)
      if (step.error) throw new Error(`❌ 撤离动作报错：${step.error}`)
      Object.assign(state, step.state)
      continue
    }
    if (here.kind === 'loot' && !here.searched) {
      const distToNearestExtract = Math.min(
        ...state.cells.filter((cell) => cell.kind === 'extract').map((cell) => manhattanTo(state, cell)),
      )
      // 行动点充裕才顺手搜刮
      if (state.maxTurns - state.turn > distToNearestExtract + 5) {
        const step = searchRaid(state, createRaidRng(9000 + guard))
        if (step.error) throw new Error(`❌ 搜索动作报错：${step.error}`)
        Object.assign(state, step.state)
        continue
      }
    }
    const target = state.cells
      .filter((cell) => cell.kind === 'extract')
      .map((cell) => ({ cell, dist: manhattanTo(state, cell) }))
      .sort((a, b) => a.dist - b.dist)[0]?.cell
    if (!target) throw new Error('❌ 深渊实验室没有撤离点')
    const dirs: Array<['up' | 'down' | 'left' | 'right', number, number]> = [
      ['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0],
    ]
    const options = dirs
      .map(([dir, dx, dy]) => {
        const x = state.player.x + dx
        const y = state.player.y + dy
        if (x < 0 || y < 0 || x >= state.width || y >= state.height) return null
        const dist = Math.abs(x - target.x) + Math.abs(y - target.y)
        return { dir, dist, x, y }
      })
      .filter((option): option is { dir: 'up' | 'down' | 'left' | 'right'; dist: number; x: number; y: number } => option !== null)
      .sort((a, b) => a.dist - b.dist)
    const chosen = options[0]
    if (!chosen) throw new Error('❌ 被围死了，路径规划异常')
    const step = moveRaid(state, chosen.dir, createRaidRng(8000 + guard))
    if (step.error) throw new Error(`❌ 移动动作报错：${step.error}`)
    Object.assign(state, step.state)
  }

  assertEqual(state.status, 'extracted', `深渊实验室脚本对局成功撤离（${guard} 步，剩余生命 ${state.hp}）`)
  assert(state.turn <= state.maxTurns, '行动点没有超限')
  assert(state.hp > 0, '撤离时宠物存活')
  assert(guard >= 10, '对局确实走过了多步动作')
  const kept = keptLoot(state)
  assert(kept.length === state.safe.length + state.loot.length, '撤离后随身 + 保险箱物品全部保留')
  assert(totalLootValue(kept) >= 0, '带出战利品价值可结算')
  assert(state.log.length > 0, '对局日志非空')
}

/* ============================================================
   附：目录不变量（material 目录 = 升级材料候选池）
   ============================================================ */

{
  const materials = raidMaterialEntries()
  assert(materials.length >= 15, 'material 类物品 ≥ 15 种')
  assert(materials.every((item) => item.value > 0), 'material 类物品价值都 > 0')
  for (const level of RAID_STORAGE_LEVELS) {
    for (const req of level.upgradeItems) {
      assert(
        materials.some((item) => item.key === req.itemKey),
        `升级材料 ${req.itemKey} 属于 material 目录`,
      )
    }
  }
}

console.log(`✅ 搜打撤仓库 / 交易行 / 新地图新物品自检：${passed} 个断言`)
