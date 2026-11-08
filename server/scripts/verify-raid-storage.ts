/**
 * 搜打撤仓库 / 官方商店纯函数自检（不依赖数据库 / 网络）。
 *
 * 覆盖：仓库等级表、容量与保险箱、存入规划（不自动出售）、回收价与商店价、
 *       装备箱 / 技能卷轴档次、背包与胸挂容量换算、物品目录不变量。
 *
 * 用法: cd server && npx tsx scripts/verify-raid-storage.ts（或 npm run verify:raidstorage）
 */

import {
  RAID_GEAR_SHOP_PREMIUM,
  RAID_GEARS,
  RAID_ITEMS,
  RAID_ITEM_MAP,
  RAID_RARITY_ORDER,
  gearStorageGate,
  raidItemValue,
  raidSellPrice,
  raidShopGearPrice,
  raidShopItemPrice,
} from '../src/lib/raidRun.js'
import {
  RAID_STORAGE_LEVELS,
  RAID_STORAGE_MAX_LEVEL,
  backpackCapacityOf,
  gearCacheTierLabel,
  isRaidStorableItem,
  nextStorageUpgrade,
  planWarehouseInsert,
  raidRecycleUnitPrice,
  raidRecycleValue,
  rigCapacityOf,
  safeCapacityFor,
  storageLevelInfo,
  warehouseUsedUnits,
} from '../src/lib/raidStorage.js'

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

function assertThrows(fn: () => unknown, message: string): void {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  assert(threw, message)
}

/* ============================================================
   仓库等级表
   ============================================================ */

assertEqual(RAID_STORAGE_LEVELS.length, 6, '仓库共 6 级')
assertEqual(RAID_STORAGE_MAX_LEVEL, 6, '仓库满级 6')
assertEqual(RAID_STORAGE_LEVELS.map((level) => level.level).join(','), '1,2,3,4,5,6', '等级连续')
assert(RAID_STORAGE_LEVELS.every((level, index) => index === 0 || level.capacity > (RAID_STORAGE_LEVELS[index - 1]?.capacity ?? 0)), '容量随等级严格递增')
assert(RAID_STORAGE_LEVELS.every((level, index) => index === 0 || level.safeCapacity >= (RAID_STORAGE_LEVELS[index - 1]?.safeCapacity ?? 0)), '保险箱格数不下降')
assertEqual(RAID_STORAGE_LEVELS[0]?.upgradePoints, 0, '1 级无升级积分')
assert(RAID_STORAGE_LEVELS.slice(1).every((level, index) => level.upgradePoints > (RAID_STORAGE_LEVELS[index]?.upgradePoints ?? 0)), '升级积分严格递增')
for (const level of RAID_STORAGE_LEVELS.slice(1)) {
  assert(level.upgradeItems.length > 0, `Lv.${level.level} 有升级材料`)
  for (const item of level.upgradeItems) {
    const def = RAID_ITEM_MAP.get(item.itemKey)
    assert(!!def, `Lv.${level.level} 升级材料存在：${item.itemKey}`)
    assertEqual(def?.kind, 'material', `Lv.${level.level} 升级材料是 material：${item.itemKey}`)
    assert(item.count >= 1, `Lv.${level.level} 升级材料数量 ≥ 1`)
  }
}
assertEqual(storageLevelInfo(0).level, 1, '等级 0 夹取到 1')
assertEqual(storageLevelInfo(-5).level, 1, '负数等级夹取到 1')
assertEqual(storageLevelInfo(99).level, 6, '超过满级夹取到 6')
assertEqual(storageLevelInfo(Number.NaN).level, 1, 'NaN 夹取到 1')
assertEqual(storageLevelInfo(3.9).level, 3, '小数向下取整')
assertEqual(safeCapacityFor(1), 2, '1 级保险箱 2 格')
assertEqual(safeCapacityFor(6), 6, '6 级保险箱 6 格')
assertEqual(safeCapacityFor(99), 6, '越界保险箱按满级')
assertEqual(nextStorageUpgrade(1)?.level, 2, '1 级下一级 2')
assertEqual(nextStorageUpgrade(6), null, '满级没有下一级')
assertEqual(nextStorageUpgrade(99), null, '越界满级没有下一级')

/* ============================================================
   存入规划（绝不自动出售）
   ============================================================ */

const empty = planWarehouseInsert(10, 0, [])
assertEqual(empty.accepted.length, 0, '空入仓无接受项')
assertEqual(empty.remaining.length, 0, '空入仓无剩余')

const partial = planWarehouseInsert(10, 6, [
  { itemKey: 'scrap_metal', amount: 3 },
  { itemKey: 'copper_wire', amount: 5 },
])
assertEqual(partial.accepted.map((stack) => `${stack.itemKey}:${stack.amount}`).join(','), 'scrap_metal:3,copper_wire:1', '先装满再截断')
assertEqual(partial.remaining.map((stack) => `${stack.itemKey}:${stack.amount}`).join(','), 'copper_wire:4', '装不下的部分留在容器（不折积分）')

const exact = planWarehouseInsert(10, 0, [{ itemKey: 'scrap_metal', amount: 10 }])
assertEqual(exact.accepted[0]?.amount, 10, '刚好装满')
assertEqual(exact.remaining.length, 0, '刚好装满无剩余')

const overflow = planWarehouseInsert(2, 0, [
  { itemKey: 'scrap_metal', amount: 2 },
  { itemKey: 'copper_wire', amount: 3 },
])
assertEqual(overflow.accepted.length, 1, '容量只够第一件')
assertEqual(overflow.remaining[0]?.amount, 3, '后续物品全部留下')

const zeroCapacity = planWarehouseInsert(0, 0, [{ itemKey: 'scrap_metal', amount: 1 }])
assertEqual(zeroCapacity.accepted.length, 0, '容量 0 全部留下')
assertEqual(zeroCapacity.remaining[0]?.amount, 1, '容量 0 剩余 1')

const alreadyOver = planWarehouseInsert(10, 15, [{ itemKey: 'scrap_metal', amount: 2 }])
assertEqual(alreadyOver.accepted.length, 0, '仓库已超容时不再接受')

const merged = planWarehouseInsert(10, 0, [
  { itemKey: 'scrap_metal', amount: 2 },
  { itemKey: 'copper_wire', amount: 1 },
  { itemKey: 'scrap_metal', amount: 3 },
])
assertEqual(merged.accepted.map((stack) => `${stack.itemKey}:${stack.amount}`).join(','), 'scrap_metal:5,copper_wire:1', '同名物品先合并且保持首次出现顺序')

const zeroAmount = planWarehouseInsert(10, 0, [{ itemKey: 'scrap_metal', amount: 0 }])
assertEqual(zeroAmount.accepted.length, 0, '数量 0 被忽略')

assertThrows(() => planWarehouseInsert(-1, 0, []), '负容量抛错')
assertThrows(() => planWarehouseInsert(10, -1, []), '负已用抛错')
assertThrows(() => planWarehouseInsert(10, 0, [{ itemKey: 'scrap_metal', amount: 1.5 }]), '小数数量抛错')
assertThrows(() => planWarehouseInsert(10, 0, [{ itemKey: '', amount: 1 }]), '空 itemKey 抛错')
assertThrows(() => planWarehouseInsert(10, 0, [{ itemKey: 'scrap_metal', amount: Number.NaN }]), 'NaN 数量抛错')

/* ============================================================
   回收价 / 商店价
   ============================================================ */

assertEqual(raidItemValue('scrap_metal'), 35, '废金属价值 35')
assertEqual(raidItemValue('nope'), 0, '未知物品价值 0')
assertEqual(raidRecycleUnitPrice('scrap_metal'), 35, '材料回收 100%')
assertEqual(raidRecycleUnitPrice('medkit'), 72, '消耗品回收 60%')
assertEqual(raidRecycleUnitPrice('gear_cache'), 182, '装备箱回收 70%')
assertEqual(raidRecycleValue('scrap_metal', 3), 105, '整组回收价')
assertEqual(raidRecycleValue('nope', 3), 0, '未知物品回收 0')
assertEqual(raidSellPrice('heart_of_africa', 1), 30000, '神话材料全额回收（非洲之心已上调到 30000）')
assertEqual(raidSellPrice('medkit_plus', 2), 384, '强效医疗箱回收 60% × 2')

assertEqual(raidShopItemPrice('medkit'), 168, '急救包商店价 = 120 × 1.4')
assertEqual(raidShopItemPrice('bandage'), 70, '绷带商店价 = 50 × 1.4')
assertEqual(raidShopItemPrice('nope'), 0, '未知物品商店价 0')
assertEqual(raidShopGearPrice('helmet_t1'), 150, '1 级头盔商店价 150')
assertEqual(raidShopGearPrice('armor_t3'), 1100, '3 级护甲商店价 1100')
assertEqual(raidShopGearPrice('nope'), 0, '未知装备商店价 0')

/* ============================================================
   装备箱 / 技能卷轴
   ============================================================ */

const gearCaches = RAID_ITEMS.filter((item) => item.kind === 'gear_cache')
assertEqual(gearCaches.length, 5, '装备箱 5 种（含神话档）')
for (const cache of gearCaches) {
  assert((cache.cacheTierMin ?? 0) >= 1, `${cache.key} 最低档次 ≥ 1`)
  assert((cache.cacheTierMax ?? 0) <= 8, `${cache.key} 最高档次 ≤ 8`)
  assert((cache.cacheTierMin ?? 0) <= (cache.cacheTierMax ?? 0), `${cache.key} 档次区间有效`)
  const pool = RAID_GEARS.filter(
    (gear) => gear.tier >= (cache.cacheTierMin ?? 1) && gear.tier <= (cache.cacheTierMax ?? 6),
  )
  assert(pool.length > 0, `${cache.key} 有可开出的装备`)
  assert(pool.every((gear) => gear.tier >= 1 && gear.tier <= 8), `${cache.key} 开出的装备等级合法`)
}
assertEqual(gearCacheTierLabel('gear_cache'), '2–3 级', '装备箱档次文案')
assertEqual(gearCacheTierLabel('relic_cache'), '5–6 级', '遗物箱档次文案')
assertEqual(gearCacheTierLabel('gear_cache_mythic'), '6–8 级', '神话装备箱档次文案')
assertEqual(gearCacheTierLabel('scrap_metal'), '', '非装备箱无档次文案')

const skillCaches = RAID_ITEMS.filter((item) => item.kind === 'skill_cache')
assertEqual(skillCaches.length, 3, '技能卷轴 3 种')
assert(skillCaches.every((cache) => (cache.cacheTierMin ?? 0) >= 1 && (cache.cacheTierMax ?? 0) <= 10), '技能卷轴等级区间合法')

/* ============================================================
   容量换算 / 工具
   ============================================================ */

assertEqual(backpackCapacityOf(8), 8, '背包容量 8')
assertEqual(backpackCapacityOf(null), 0, '没背包容量 0')
assertEqual(backpackCapacityOf(-3), 0, '负容量夹取 0')
assertEqual(backpackCapacityOf(Number.NaN), 0, 'NaN 容量 0')
assertEqual(rigCapacityOf(3), 3, '胸挂容量 3')
assertEqual(rigCapacityOf(undefined), 0, '没胸挂容量 0')
assertEqual(warehouseUsedUnits([{ amount: 3 }, { amount: 5 }]), 8, '仓库已用件数求和')
assertEqual(warehouseUsedUnits([]), 0, '空仓库已用 0')
assertEqual(warehouseUsedUnits([{ amount: -2 }]), 0, '负数按 0 计')
assertEqual(isRaidStorableItem('scrap_metal'), true, '已知物品可入仓')
assertEqual(isRaidStorableItem('nope'), false, '未知物品不可入仓')

/* ============================================================
   目录不变量（与商店 / 仓库共享）
   ============================================================ */

assert(RAID_ITEMS.length >= 48, '物品目录至少 48 种')
assert(RAID_ITEMS.every((item) => RAID_RARITY_ORDER.includes(item.rarity)), '物品品质合法')
assert(RAID_ITEMS.every((item) => item.stackMax >= 1), '堆叠上限 ≥ 1')
assert(RAID_ITEMS.every((item) => raidShopItemPrice(item.key) >= item.value), '商店售价不低于目录价值')
assert(RAID_ITEMS.every((item) => raidSellPrice(item.key, 1) <= item.value), '回收价不高于目录价值')

const shopGears = RAID_GEARS.filter((gear) => gear.shopable)
// 2026-11-04：商店改为全档上架 —— 档位不再决定「能不能买」，而是决定门槛与溢价
assert(shopGears.length === RAID_GEARS.length, '全部装备都在商店上架')
assert(
  RAID_GEARS.filter((gear) => gear.tier <= 3).every((gear) => gearStorageGate(gear.tier) === 0),
  '1–3 级装备没有仓库等级门槛',
)
assert(
  RAID_GEARS.filter((gear) => gear.tier >= 4).every((gear) => gearStorageGate(gear.tier) > 0),
  '4 级及以上装备都要仓库等级门槛',
)
assert(
  RAID_GEARS.filter((gear) => gear.tier <= 3).every((gear) => raidShopGearPrice(gear.key) === gear.price),
  '1–3 级装备按目录价平价出售',
)
assert(
  RAID_GEARS.filter((gear) => gear.tier >= 4).every(
    (gear) => raidShopGearPrice(gear.key) === Math.ceil(gear.price * RAID_GEAR_SHOP_PREMIUM),
  ),
  '4 级及以上装备按目录价 ×2 出售',
)
assertEqual(gearStorageGate(4), 3, '4 级需仓库 Lv.3')
assertEqual(gearStorageGate(5), 4, '5 级需仓库 Lv.4')
assertEqual(gearStorageGate(6), 5, '6 级需仓库 Lv.5')
assertEqual(gearStorageGate(7), 6, 't7 巨型背包需仓库 Lv.6')
assertEqual(gearStorageGate(8), 6, 't8 巨型背包需仓库 Lv.6（仓库满级）')

console.log(`✅ 搜打撤仓库 / 官方商店自检：${passed} 个断言`)
