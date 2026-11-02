/**
 * 搜打撤仓库 / 交易行纯函数（等级表 / 入仓规划 / 定价与手续费）。
 *
 * 口径：
 *   - 仓库共 6 级，容量（可堆放物品总数）与保险箱格数随等级提升；
 *   - 升级除积分外还要消耗仓库里的 material 类战利品（升级材料不入积分）；
 *   - 撤离结算时 material 先入仓，仓库装不下的部分按目录价值折积分；
 *   - 交易行挂单价必须落在「目录总价值 × 0.5–1.5」区间，卖家收 5% 手续费（最低 1）。
 *
 * 本文件不碰数据库，全部为纯函数，供 raidStorageService / petRaidService / 自检共用。
 */

import { RAID_LOOT_ENTRIES, RAID_LOOT_MAP, type RaidLootEntry } from './petRaid.js'

/* ============================================================
   仓库等级表
   ============================================================ */

export interface RaidStorageLevel {
  level: number
  /** 仓库容量（可堆放物品总数） */
  capacity: number
  /** 单局保险箱格数 */
  safeCapacity: number
  /** 升级到下一级需要的积分（level 1 为初始级，此值对 level 1 无意义恒为 0） */
  upgradePoints: number
  /** 升级到下一级需要的仓库材料（level 1 无） */
  upgradeItems: ReadonlyArray<{ itemKey: string; count: number }>
}

export const RAID_STORAGE_LEVELS: readonly RaidStorageLevel[] = [
  { level: 1, capacity: 60, safeCapacity: 2, upgradePoints: 0, upgradeItems: [] },
  { level: 2, capacity: 100, safeCapacity: 3, upgradePoints: 300, upgradeItems: [{ itemKey: 'canned_food', count: 5 }, { itemKey: 'copper_wire', count: 5 }] },
  { level: 3, capacity: 150, safeCapacity: 3, upgradePoints: 600, upgradeItems: [{ itemKey: 'old_watch', count: 5 }, { itemKey: 'circuit_board', count: 3 }] },
  { level: 4, capacity: 210, safeCapacity: 4, upgradePoints: 1200, upgradeItems: [{ itemKey: 'circuit_board', count: 5 }, { itemKey: 'encrypted_drive', count: 3 }] },
  { level: 5, capacity: 280, safeCapacity: 5, upgradePoints: 2500, upgradeItems: [{ itemKey: 'gold_compass', count: 4 }, { itemKey: 'experiment_data', count: 3 }] },
  { level: 6, capacity: 360, safeCapacity: 6, upgradePoints: 5000, upgradeItems: [{ itemKey: 'black_box', count: 2 }, { itemKey: 'dragon_shard', count: 1 }] },
]

export const RAID_STORAGE_MAX_LEVEL = RAID_STORAGE_LEVELS.length

/** 等级越界时夹取到 1–6 */
export function storageLevelInfo(level: number): RaidStorageLevel {
  const clean = Number.isFinite(level) ? Math.trunc(level) : 1
  const clamped = Math.max(1, Math.min(RAID_STORAGE_MAX_LEVEL, clean))
  return RAID_STORAGE_LEVELS[clamped - 1] ?? RAID_STORAGE_LEVELS[0]
}

/** 下一级升级需求；已满级返回 null */
export function nextStorageUpgrade(level: number): RaidStorageLevel | null {
  const info = storageLevelInfo(level)
  if (info.level >= RAID_STORAGE_MAX_LEVEL) return null
  return RAID_STORAGE_LEVELS[info.level] ?? null
}

/** 单局保险箱格数 = 仓库等级派生（越界夹取） */
export function safeCapacityFor(level: number): number {
  return storageLevelInfo(level).safeCapacity
}

/* ============================================================
   入仓规划
   ============================================================ */

export interface WarehouseStack {
  itemKey: string
  amount: number
}

export interface WarehouseStackPlan {
  /** 装得下的部分（按传入顺序填充） */
  accepted: WarehouseStack[]
  /** 仓库装不下、按目录价值折积分的部分 */
  overflow: WarehouseStack[]
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`仓库容量参数异常：${label} 必须是非负整数`)
  }
}

/**
 * 入仓规划：按 stacks 传入顺序逐个填充，仓库剩余容量不够时把余量划入 overflow。
 * 同名物品多段堆放会先合并（合并后按首次出现位置排序），保证结果确定性。
 */
export function planWarehouseInsert(
  capacity: number,
  usedCount: number,
  stacks: ReadonlyArray<WarehouseStack>,
): WarehouseStackPlan {
  assertNonNegativeInt(capacity, 'capacity')
  assertNonNegativeInt(usedCount, 'usedCount')
  for (const stack of stacks) {
    if (!Number.isFinite(stack.amount) || !Number.isInteger(stack.amount) || stack.amount < 0) {
      throw new Error(`仓库入仓数量异常：${stack.itemKey} 的数量必须是自然数`)
    }
    if (typeof stack.itemKey !== 'string' || stack.itemKey.length === 0) {
      throw new Error('仓库入仓数量异常：itemKey 不能为空')
    }
  }

  let free = Math.max(0, capacity - usedCount)
  const merged = new Map<string, number>()
  const order: string[] = []
  for (const stack of stacks) {
    if (stack.amount === 0) continue
    if (!merged.has(stack.itemKey)) order.push(stack.itemKey)
    merged.set(stack.itemKey, (merged.get(stack.itemKey) ?? 0) + stack.amount)
  }

  const accepted: WarehouseStack[] = []
  const overflow: WarehouseStack[] = []
  for (const itemKey of order) {
    const amount = merged.get(itemKey) ?? 0
    const take = Math.min(amount, free)
    if (take > 0) {
      accepted.push({ itemKey, amount: take })
      free -= take
    }
    if (amount - take > 0) {
      overflow.push({ itemKey, amount: amount - take })
    }
  }
  return { accepted, overflow }
}

/* ============================================================
   交易行定价
   ============================================================ */

export const RAID_MARKET_FEE_RATE = 0.05
export const RAID_MARKET_PRICE_MIN_RATIO = 0.5
export const RAID_MARKET_PRICE_MAX_RATIO = 1.5
/** 挂单价格硬上限（防恶意天价），与宠物交易行一致 */
export const RAID_MARKET_PRICE_HARD_MAX = 1_000_000

/** 目录条目查询（不存在返回 null） */
export function raidLootEntry(itemKey: string): RaidLootEntry | null {
  return RAID_LOOT_MAP.get(itemKey) ?? null
}

/** 目录价值 = 单件目录价值 × 数量（未知物品按 0 计） */
export function raidListingValue(itemKey: string, amount: number): number {
  const entry = RAID_LOOT_MAP.get(itemKey)
  if (!entry) return 0
  const clean = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0
  return entry.value * clean
}

/** 卖家手续费：ceil(price × 5%)，最低 1（价格 ≤ 0 返回 0） */
export function raidMarketFee(price: number): number {
  const clean = Number.isFinite(price) ? Math.max(0, Math.trunc(price)) : 0
  if (clean <= 0) return 0
  return Math.max(1, Math.ceil(clean * RAID_MARKET_FEE_RATE))
}

/** 卖家到账 = 整单价 − 手续费 */
export function raidMarketSellerProceeds(price: number): number {
  const clean = Number.isFinite(price) ? Math.max(0, Math.trunc(price)) : 0
  return Math.max(0, clean - raidMarketFee(clean))
}

/**
 * 挂单校验：不合法直接 throw Error（文案由服务层转 AppError）。
 * 价格必须落在「目录总价值 × 0.5–1.5」（含端点）之间。
 */
export function validateRaidListingPrice(itemKey: string, amount: number, price: number): void {
  const entry = RAID_LOOT_MAP.get(itemKey)
  if (!entry) throw new Error('没有这件物品')
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 1) {
    throw new Error('数量必须是正整数')
  }
  if (!Number.isFinite(price) || !Number.isInteger(price)) throw new Error('价格必须是整数')
  if (price < 1) throw new Error('价格必须大于 0')
  if (price > RAID_MARKET_PRICE_HARD_MAX) throw new Error(`价格不能超过 ${RAID_MARKET_PRICE_HARD_MAX.toLocaleString()}`)
  const total = raidListingValue(itemKey, amount)
  const min = Math.max(1, Math.floor(total * RAID_MARKET_PRICE_MIN_RATIO))
  const max = Math.max(min, Math.ceil(total * RAID_MARKET_PRICE_MAX_RATIO))
  if (price < min || price > max) {
    throw new Error(`价格需在 ${min}–${max} 积分之间（目录价值 ${total} 的 50%–150%）`)
  }
}

/** 回收可得积分 = 单件目录价值 × 数量（未知物品按 0 计） */
export function raidRecycleValue(itemKey: string, amount: number): number {
  return raidListingValue(itemKey, amount)
}

/** 目录（交易行 / 仓库展示用，只含可入仓的 material 类） */
export function raidMaterialEntries(): readonly RaidLootEntry[] {
  return RAID_LOOT_ENTRIES.filter((item) => item.kind === 'material')
}
