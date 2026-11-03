/**
 * 搜打撤仓库纯函数（等级表 / 存入规划 / 官方商店回收价）。
 *
 * 口径（2026-11-03 重构）：
 *   - 仓库共 6 级，容量按「可堆放物品总件数」计，保险箱格数随等级提升；
 *   - 撤离后战利品留在背包 / 胸挂 / 安全箱，玩家手动存入仓库；
 *     仓库满时不自动出售、不收部分存入（deposit 整笔失败），deposit-all 只填得下的部分；
 *   - 交易行已删除，物品只能按官方回收价卖给系统商店（材料 100% / 消耗品 60% / 箱子 70%）。
 *
 * 本文件不碰数据库，供 raidStorageService / 自检共用。
 */

import { RAID_ITEM_MAP, raidSellPrice } from './raidRun.js'

/* ============================================================
   仓库等级表
   ============================================================ */

export interface RaidStorageLevel {
  level: number
  /** 仓库容量（可堆放物品总件数） */
  capacity: number
  /** 单局安全箱格数 */
  safeCapacity: number
  /** 升级到下一级需要的积分（level 1 初始级恒为 0） */
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

export function storageLevelInfo(level: number): RaidStorageLevel {
  const clean = Number.isFinite(level) ? Math.trunc(level) : 1
  const clamped = Math.max(1, Math.min(RAID_STORAGE_MAX_LEVEL, clean))
  return RAID_STORAGE_LEVELS[clamped - 1] ?? RAID_STORAGE_LEVELS[0]
}

export function nextStorageUpgrade(level: number): RaidStorageLevel | null {
  const info = storageLevelInfo(level)
  if (info.level >= RAID_STORAGE_MAX_LEVEL) return null
  return RAID_STORAGE_LEVELS[info.level] ?? null
}

export function safeCapacityFor(level: number): number {
  return storageLevelInfo(level).safeCapacity
}

/* ============================================================
   存入规划
   ============================================================ */

export interface WarehouseStack {
  itemKey: string
  amount: number
}

export interface WarehouseStackPlan {
  /** 装得下的部分（按传入顺序填充） */
  accepted: WarehouseStack[]
  /** 仓库装不下的剩余部分（留在背包，不会自动出售） */
  remaining: WarehouseStack[]
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`仓库容量参数异常：${label} 必须是非负整数`)
  }
}

/**
 * 存入规划：按 stacks 顺序逐个填充，仓库剩余容量不够时把余量留在 remaining。
 * 同名物品多段先合并（按首次出现位置），保证结果确定性。
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
  const remaining: WarehouseStack[] = []
  for (const itemKey of order) {
    const amount = merged.get(itemKey) ?? 0
    const take = Math.min(amount, free)
    if (take > 0) {
      accepted.push({ itemKey, amount: take })
      free -= take
    }
    if (amount - take > 0) {
      remaining.push({ itemKey, amount: amount - take })
    }
  }
  return { accepted, remaining }
}

/* ============================================================
   官方商店 / 回收
   ============================================================ */

/** 单件回收价（材料 / 珍宝 100%，消耗品 60%，装备箱 / 技能卷轴 70%） */
export function raidRecycleUnitPrice(itemKey: string): number {
  return raidSellPrice(itemKey, 1)
}

/** 整组回收价 */
export function raidRecycleValue(itemKey: string, amount: number): number {
  return raidSellPrice(itemKey, amount)
}

/** 目录条目是否存在且可入仓（未知 / 非物品 key 一律拒绝） */
export function isRaidStorableItem(itemKey: string): boolean {
  return RAID_ITEM_MAP.has(itemKey)
}

/** 装备箱档次提示（商店 / 仓库展示） */
export function gearCacheTierLabel(itemKey: string): string {
  const def = RAID_ITEM_MAP.get(itemKey)
  if (!def || def.kind !== 'gear_cache') return ''
  return `${def.cacheTierMin ?? 1}–${def.cacheTierMax ?? 6} 级`
}

/* ============================================================
   容量换算
   ============================================================ */

/** 背包容量 = 已装备背包的格数（没背包为 0） */
export function backpackCapacityOf(slots: number | null | undefined): number {
  if (!slots || !Number.isFinite(slots)) return 0
  return Math.max(0, Math.trunc(slots))
}

/** 胸挂容量 = 已装备胸挂的格数（没胸挂为 0） */
export function rigCapacityOf(slots: number | null | undefined): number {
  if (!slots || !Number.isFinite(slots)) return 0
  return Math.max(0, Math.trunc(slots))
}

/** 仓库已用件数 = 各物品数量之和 */
export function warehouseUsedUnits(
  rows: ReadonlyArray<{ amount: number }>,
): number {
  return rows.reduce((sum, row) => sum + Math.max(0, Math.trunc(row.amount)), 0)
}
