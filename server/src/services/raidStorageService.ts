/**
 * 搜打撤仓库服务：撤离战利品入仓、材料回收折积分、仓库升级。
 *
 * 并发口径：
 *   - 仓库物品按 [userId, itemKey] 聚合，listedAmount 为交易行在售预留数量；
 *   - 所有扣减都带守卫条件（amount >= listedAmount + n）并在写后复核
 *     listedAmount <= amount，违反即 throw 回滚，保证不变式永不被并发破坏；
 *   - Prisma 的 where 无法比较两列，因此先在事务内重读行、再把快照值写进守卫条件。
 */

import prisma from '../lib/prisma.js'
import type { Prisma, PrismaClient, RaidStorage } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { RAID_LOOT_MAP } from '../lib/petRaid.js'
import {
  RAID_MARKET_FEE_RATE,
  nextStorageUpgrade,
  planWarehouseInsert,
  raidRecycleValue,
  safeCapacityFor,
  storageLevelInfo,
  type WarehouseStack,
} from '../lib/raidStorage.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'

type Db = Prisma.TransactionClient

/* ============================================================
   行确保（事务内 / 事务外各一份）
   ============================================================ */

/** 事务内惰性建行（首访自动建 1 级仓库） */
export async function ensureRaidStorageTx(tx: Db, userId: number): Promise<RaidStorage> {
  return tx.raidStorage.upsert({ where: { userId }, create: { userId }, update: {} })
}

/** 事务外惰性建行（读接口 / 对局动作使用） */
export async function ensureRaidStorage(userId: number): Promise<RaidStorage> {
  return prisma.$transaction((tx) => ensureRaidStorageTx(tx, userId))
}

/* ============================================================
   DTO
   ============================================================ */

export interface RaidStorageItemDto {
  itemKey: string
  name: string
  emoji: string
  rarity: string
  /** 单件目录价值 */
  value: number
  amount: number
  listedAmount: number
  /** amount - listedAmount（可回收 / 可上架 / 可当升级材料的数量） */
  freeAmount: number
}

export interface RaidStorageUpgradeItemDto {
  itemKey: string
  name: string
  emoji: string
  count: number
  have: number
}

export interface RaidStorageUpgradePreviewDto {
  level: number
  capacity: number
  safeCapacity: number
  upgradePoints: number
  /** 积分是否足够 */
  pointsOk: boolean
  /** 材料是否足够 */
  materialsOk: boolean
  items: RaidStorageUpgradeItemDto[]
}

export interface RaidStorageViewDto {
  level: number
  capacity: number
  used: number
  free: number
  safeCapacity: number
  items: RaidStorageItemDto[]
  nextUpgrade: RaidStorageUpgradePreviewDto | null
  feeRate: number
  balance: number
}

export interface RaidRecycleResultDto {
  itemKey: string
  recycled: number
  remaining: number
  points: number
  balance: number
}

/* ============================================================
   查询
   ============================================================ */

async function sumInventoryAmount(client: Db | PrismaClient, userId: number): Promise<number> {
  const agg = await client.raidInventoryItem.aggregate({
    where: { userId },
    _sum: { amount: true },
  })
  return agg._sum.amount ?? 0
}

/** 仓库概要（惰性建行）；getRaidOverview / 对局 DTO 使用 */
export async function getRaidStorageSummary(userId: number): Promise<{
  level: number
  capacity: number
  used: number
  safeCapacity: number
}> {
  const row = await ensureRaidStorage(userId)
  const info = storageLevelInfo(row.level)
  const used = await sumInventoryAmount(prisma, userId)
  return { level: info.level, capacity: info.capacity, used, safeCapacity: info.safeCapacity }
}

/** 事务内版本（finishRaid 结算用） */
export async function getRaidStorageSummaryTx(tx: Db, userId: number): Promise<{
  level: number
  capacity: number
  used: number
  safeCapacity: number
}> {
  const row = await ensureRaidStorageTx(tx, userId)
  const info = storageLevelInfo(row.level)
  const used = await sumInventoryAmount(tx, userId)
  return { level: info.level, capacity: info.capacity, used, safeCapacity: info.safeCapacity }
}

/** 仓库页视图 */
export async function getRaidStorageView(userId: number): Promise<RaidStorageViewDto> {
  const row = await ensureRaidStorage(userId)
  const [rows, balance] = await Promise.all([
    prisma.raidInventoryItem.findMany({ where: { userId }, orderBy: [{ id: 'asc' }] }),
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
  ])
  const info = storageLevelInfo(row.level)
  const items = buildItemDtos(rows)
  const used = items.reduce((sum, item) => sum + item.amount, 0)
  const next = nextStorageUpgrade(row.level)
  return {
    level: info.level,
    capacity: info.capacity,
    used,
    free: Math.max(0, info.capacity - used),
    safeCapacity: info.safeCapacity,
    items,
    nextUpgrade: next ? await buildUpgradePreview(row.level, balance?.points ?? 0, rows) : null,
    feeRate: RAID_MARKET_FEE_RATE,
    balance: balance?.points ?? 0,
  }
}

function buildItemDtos(rows: Array<{ itemKey: string; amount: number; listedAmount: number }>): RaidStorageItemDto[] {
  // 按目录顺序展示，未知 key（目录被删的残留行）排到最后
  const order = new Map<string, number>()
  let index = 0
  for (const key of RAID_LOOT_MAP.keys()) {
    order.set(key, index)
    index += 1
  }
  return [...rows]
    .filter((row) => row.amount > 0)
    .sort((a, b) => (order.get(a.itemKey) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.itemKey) ?? Number.MAX_SAFE_INTEGER))
    .map((row) => {
      const entry = RAID_LOOT_MAP.get(row.itemKey)
      return {
        itemKey: row.itemKey,
        name: entry?.name ?? row.itemKey,
        emoji: entry?.emoji ?? '📦',
        rarity: entry?.rarity ?? 'common',
        value: entry?.value ?? 0,
        amount: row.amount,
        listedAmount: row.listedAmount,
        freeAmount: row.amount - row.listedAmount,
      }
    })
}

async function buildUpgradePreview(
  level: number,
  balance: number,
  rows: Array<{ itemKey: string; amount: number; listedAmount: number }>,
): Promise<RaidStorageUpgradePreviewDto> {
  const next = nextStorageUpgrade(level)
  if (!next) {
    throw new AppError('仓库已经满级了', 400)
  }
  const available = new Map(rows.map((row) => [row.itemKey, row.amount - row.listedAmount]))
  let materialsOk = true
  const items: RaidStorageUpgradeItemDto[] = next.upgradeItems.map((req) => {
    const entry = RAID_LOOT_MAP.get(req.itemKey)
    const have = available.get(req.itemKey) ?? 0
    if (have < req.count) materialsOk = false
    return {
      itemKey: req.itemKey,
      name: entry?.name ?? req.itemKey,
      emoji: entry?.emoji ?? '📦',
      count: req.count,
      have,
    }
  })
  return {
    level: next.level,
    capacity: next.capacity,
    safeCapacity: next.safeCapacity,
    upgradePoints: next.upgradePoints,
    pointsOk: balance >= next.upgradePoints,
    materialsOk,
    items,
  }
}

/* ============================================================
   回收
   ============================================================ */

/** 回收仓库材料换取积分（listedAmount 预留的部分不可回收） */
export async function recycleRaidItems(
  userId: number,
  itemKey: string,
  amount: number,
): Promise<RaidRecycleResultDto> {
  const entry = RAID_LOOT_MAP.get(itemKey)
  if (!entry) throw new AppError('没有这件物品', 404)
  if (!Number.isInteger(amount) || amount < 1) throw new AppError('回收数量必须是正整数', 400)

  return prisma.$transaction(async (tx) => {
    const row = await tx.raidInventoryItem.findUnique({
      where: { userId_itemKey: { userId, itemKey } },
    })
    if (!row || row.amount < amount) {
      throw new AppError(`仓库里没有这么多「${entry.name}」`, 400)
    }
    const freeAmount = row.amount - row.listedAmount
    if (freeAmount < amount) {
      throw new AppError(`「${entry.name}」有 ${row.listedAmount} 件正在交易行出售，可回收的只剩 ${freeAmount} 件`, 400)
    }

    // 守卫扣减：amount 必须仍能覆盖「listedAmount + 本次回收量」
    const guarded = await tx.raidInventoryItem.updateMany({
      where: { id: row.id, amount: { gte: row.listedAmount + amount } },
      data: { amount: { decrement: amount } },
    })
    if (guarded.count !== 1) throw new AppError('仓库数量已变化，请重试', 409)

    // 写后复核：listedAmount <= amount 不变式
    const after = await tx.raidInventoryItem.findUnique({ where: { id: row.id } })
    if (!after || after.listedAmount > after.amount) {
      throw new AppError('仓库数据异常，回收已回滚', 500)
    }
    if (after.amount === 0) {
      await tx.raidInventoryItem.delete({ where: { id: row.id } })
    }

    const points = raidRecycleValue(itemKey, amount)
    const award = await awardPointsTx(tx, userId, {
      amount: points,
      reason: 'raid_recycle',
      note: `回收 ${entry.name}×${amount}`,
    })
    return {
      itemKey,
      recycled: amount,
      remaining: after.amount,
      points,
      balance: award.balance,
    }
  })
}

/* ============================================================
   升级
   ============================================================ */

/** 仓库升级：花积分 + 消耗仓库材料（预留中的材料不可用） */
export async function upgradeRaidStorage(userId: number): Promise<RaidStorageViewDto> {
  await prisma.$transaction(async (tx) => {
    const storage = await ensureRaidStorageTx(tx, userId)
    const next = nextStorageUpgrade(storage.level)
    if (!next) throw new AppError('仓库已经满级了', 400)
    if (next.upgradeItems.length === 0 && next.upgradePoints <= 0) {
      throw new AppError('仓库已经满级了', 400)
    }

    const rows = await tx.raidInventoryItem.findMany({
      where: { userId, itemKey: { in: next.upgradeItems.map((req) => req.itemKey) } },
    })
    const rowByKey = new Map(rows.map((row) => [row.itemKey, row]))

    // 先整体校验材料与积分，任一不足都不动账
    for (const req of next.upgradeItems) {
      const entry = RAID_LOOT_MAP.get(req.itemKey)
      const row = rowByKey.get(req.itemKey)
      const freeAmount = row ? row.amount - row.listedAmount : 0
      if (freeAmount < req.count) {
        const missing = req.count - freeAmount
        throw new AppError(
          `仓库材料不足：升级还需要 ${entry?.name ?? req.itemKey}×${missing}（预留出售中的材料不能用来升级）`,
          400,
        )
      }
    }
    await spendPointsTx(tx, userId, next.upgradePoints, {
      reason: 'raid_storage_upgrade',
      note: `仓库升级到 ${next.level} 级`,
    })

    // 守卫扣减材料：amount 必须仍能覆盖「listedAmount + 消耗量」
    for (const req of next.upgradeItems) {
      const row = rowByKey.get(req.itemKey)
      if (!row) throw new AppError('仓库材料已被占用，升级失败，请重试', 409)
      const guarded = await tx.raidInventoryItem.updateMany({
        where: { id: row.id, amount: { gte: row.listedAmount + req.count } },
        data: { amount: { decrement: req.count } },
      })
      if (guarded.count !== 1) throw new AppError('仓库材料已被占用，升级失败，请重试', 409)
      // 写后复核：listedAmount <= amount 不变式
      const after = await tx.raidInventoryItem.findUnique({ where: { id: row.id } })
      if (!after || after.listedAmount > after.amount) {
        throw new AppError('仓库数据异常，升级已回滚', 500)
      }
      if (after.amount === 0) {
        await tx.raidInventoryItem.delete({ where: { id: row.id } })
      }
    }

    // 守卫写等级：以事务头读到的 level 为前提条件更新，并发重复升级只有一笔成功
    // （绝对 set 会让并发第二笔双倍扣费，甚至把别人已升到的更高等级回写）
    const levelUpdated = await tx.raidStorage.updateMany({
      where: { userId, level: storage.level },
      data: { level: next.level },
    })
    if (levelUpdated.count !== 1) {
      throw new AppError('仓库等级已变化，请刷新后重试', 409)
    }
  })
  return getRaidStorageView(userId)
}

/* ============================================================
   入仓（finishRaid 结算用）
   ============================================================ */

/**
 * 把已规划好的 accepted 堆叠写入仓库（必须在 finishRaid 的事务内调用）。
 * 规划（容量判断）由调用方用 planWarehouseInsert 完成后传入。
 */
export async function insertWarehouseStacksTx(tx: Db, userId: number, accepted: ReadonlyArray<WarehouseStack>): Promise<void> {
  for (const stack of accepted) {
    if (stack.amount <= 0) continue
    await tx.raidInventoryItem.upsert({
      where: { userId_itemKey: { userId, itemKey: stack.itemKey } },
      create: { userId, itemKey: stack.itemKey, amount: stack.amount, listedAmount: 0 },
      update: { amount: { increment: stack.amount } },
    })
  }
}

/** 保险箱格数（用户级，转发 lib 纯函数） */
export { safeCapacityFor }
