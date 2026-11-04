/**
 * 搜打撤仓库服务（2026-11-03 重构）：仓库 / 背包 / 胸挂 / 安全箱 / 官方商店回收 / 升级。
 *
 * 口径：
 *   - 交易行已删除，物品只能按官方回收价卖给系统商店；
 *   - 撤离后战利品留在容器里，必须手动存入仓库；仓库满时整笔拒绝，绝不自动出售；
 *   - 容器容量由已装备的背包 / 胸挂 / 仓库等级派生，容量不足时禁止卸下或换小。
 */

import prisma from '../lib/prisma.js'
import type { Prisma, RaidBagItem, RaidGear, RaidInventoryItem } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_CONTAINER_LABELS,
  RAID_GEAR_MAP,
  RAID_ITEM_MAP,
  addItemToContainer,
  getRaidItem,
  normalizeContainer,
  raidSellPrice,
  type RaidContainerKind,
  type RaidItemStack,
} from '../lib/raidRun.js'
import { RAID_STORAGE_LEVELS, nextStorageUpgrade, storageLevelInfo } from '../lib/raidStorage.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'
import { assertNoActiveRaid } from './raidRunService.js'
import {
  bagRowsToStacks,
  bagRowsOf,
  capacitiesOf,
  ensureRaidStorageTx,
  equippedGearRows,
  gearDto,
  loadRaidLoadoutTx,
  writeContainersTx,
  type RaidBagContainer,
  type RaidGearDto,
} from './raidCommon.js'

type Db = Prisma.TransactionClient

/* ============================================================
   DTO
   ============================================================ */

export interface RaidItemInfoDto {
  itemKey: string
  name: string
  emoji: string
  rarity: string
  kind: string
  value: number
  sellUnit: number
  stackMax: number
  description: string
}

function itemInfo(itemKey: string): RaidItemInfoDto {
  const def = RAID_ITEM_MAP.get(itemKey)
  return {
    itemKey,
    name: def?.name ?? itemKey,
    emoji: def?.emoji ?? '📦',
    rarity: def?.rarity ?? 'common',
    kind: def?.kind ?? 'material',
    value: def?.value ?? 0,
    sellUnit: raidSellPrice(itemKey, 1),
    stackMax: def?.stackMax ?? 1,
    description: def?.description ?? '',
  }
}

export interface RaidStorageItemDto extends RaidItemInfoDto {
  amount: number
}

export interface RaidBagItemDto extends RaidItemInfoDto {
  slotIndex: number
  amount: number
}

export interface RaidContainerDto {
  container: RaidBagContainer
  label: string
  capacity: number
  usedSlots: number
  usedUnits: number
  items: RaidBagItemDto[]
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
  pointsOk: boolean
  materialsOk: boolean
  items: RaidStorageUpgradeItemDto[]
}

export interface RaidEquippedSummaryDto {
  helmet: RaidGearDto | null
  armor: RaidGearDto | null
  boots: RaidGearDto | null
  backpack: RaidGearDto | null
  rig: RaidGearDto | null
}

export interface RaidStorageViewDto {
  level: number
  capacity: number
  used: number
  free: number
  safeCapacity: number
  backpackSlots: number
  rigSlots: number
  points: number
  items: RaidStorageItemDto[]
  containers: {
    backpack: RaidContainerDto
    rig: RaidContainerDto
    safe: RaidContainerDto
  }
  gear: RaidGearDto[]
  equipped: RaidEquippedSummaryDto
  upgrade: RaidStorageUpgradePreviewDto | null
}

/* ============================================================
   视图
   ============================================================ */

function containerDto(
  container: RaidBagContainer,
  rows: readonly RaidBagItem[],
  capacity: number,
): RaidContainerDto {
  const items = bagRowsOf(rows, container)
    .sort((a, b) => a.slotIndex - b.slotIndex)
    .map((row) => ({
      ...itemInfo(row.itemKey),
      slotIndex: row.slotIndex,
      amount: row.amount,
    }))
  return {
    container,
    label: RAID_CONTAINER_LABELS[container],
    capacity,
    usedSlots: items.length,
    usedUnits: items.reduce((sum, item) => sum + item.amount, 0),
    items,
  }
}

function equippedSummary(rows: readonly RaidGear[]): RaidEquippedSummaryDto {
  const equipped = equippedGearRows(rows)
  const pick = (slot: string): RaidGearDto | null => {
    const row = equipped.find((item) => item.slot === slot)
    return row ? gearDto(row) : null
  }
  return {
    helmet: pick('helmet'),
    armor: pick('armor'),
    boots: pick('boots'),
    backpack: pick('backpack'),
    rig: pick('rig'),
  }
}

function upgradePreview(
  level: number,
  points: number,
  warehouse: readonly RaidInventoryItem[],
): RaidStorageUpgradePreviewDto | null {
  const next = nextStorageUpgrade(level)
  if (!next) return null
  const items = next.upgradeItems.map((item) => {
    const def = RAID_ITEM_MAP.get(item.itemKey)
    const have = warehouse.find((row) => row.itemKey === item.itemKey)?.amount ?? 0
    return {
      itemKey: item.itemKey,
      name: def?.name ?? item.itemKey,
      emoji: def?.emoji ?? '📦',
      count: item.count,
      have,
    }
  })
  return {
    level: next.level,
    capacity: next.capacity,
    safeCapacity: next.safeCapacity,
    upgradePoints: next.upgradePoints,
    pointsOk: points >= next.upgradePoints,
    materialsOk: items.every((item) => item.have >= item.count),
    items,
  }
}

export async function buildStorageView(userId: number): Promise<RaidStorageViewDto> {
  const [storage, warehouse, bagRows, gearRows, user] = await Promise.all([
    prisma.$transaction((tx) => ensureRaidStorageTx(tx, userId)),
    prisma.raidInventoryItem.findMany({ where: { userId }, orderBy: { itemKey: 'asc' } }),
    prisma.raidBagItem.findMany({ where: { userId }, orderBy: { slotIndex: 'asc' } }),
    prisma.raidGear.findMany({ where: { userId }, orderBy: [{ slot: 'asc' }, { id: 'asc' }] }),
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
  ])
  const info = storageLevelInfo(storage.level)
  const used = warehouse.reduce((sum, row) => sum + Math.max(0, row.amount), 0)
  const capacities = capacitiesOf(gearRows, storage.level)
  return {
    level: info.level,
    capacity: info.capacity,
    used,
    free: Math.max(0, info.capacity - used),
    safeCapacity: info.safeCapacity,
    backpackSlots: capacities.backpack,
    rigSlots: capacities.rig,
    points: user?.points ?? 0,
    items: warehouse
      .filter((row) => row.amount > 0)
      .map((row) => ({ ...itemInfo(row.itemKey), amount: row.amount })),
    containers: {
      backpack: containerDto('backpack', bagRows, capacities.backpack),
      rig: containerDto('rig', bagRows, capacities.rig),
      safe: containerDto('safe', bagRows, capacities.safe),
    },
    gear: gearRows.map((row) => gearDto(row)),
    equipped: equippedSummary(gearRows),
    upgrade: upgradePreview(info.level, user?.points ?? 0, warehouse),
  }
}

export async function getRaidStorageView(userId: number): Promise<RaidStorageViewDto> {
  return buildStorageView(userId)
}

/* ============================================================
   仓库行工具
   ============================================================ */

async function upsertWarehouseTx(tx: Db, userId: number, itemKey: string, amount: number): Promise<void> {
  if (amount <= 0) return
  await tx.raidInventoryItem.upsert({
    where: { userId_itemKey: { userId, itemKey } },
    create: { userId, itemKey, amount },
    update: { amount: { increment: amount } },
  })
}

async function decrementWarehouseTx(
  tx: Db,
  userId: number,
  itemKey: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return
  const row = await tx.raidInventoryItem.findUnique({
    where: { userId_itemKey: { userId, itemKey } },
  })
  if (!row || row.amount < amount) throw new AppError('仓库里没有这么多物品', 400)
  const left = row.amount - amount
  if (left <= 0) {
    await tx.raidInventoryItem.delete({ where: { id: row.id } })
  } else {
    await tx.raidInventoryItem.update({ where: { id: row.id }, data: { amount: left } })
  }
}

async function decrementBagSlotTx(
  tx: Db,
  userId: number,
  container: RaidBagContainer,
  slotIndex: number,
  amount: number,
): Promise<void> {
  const row = await tx.raidBagItem.findUnique({
    where: { userId_container_slotIndex: { userId, container, slotIndex } },
  })
  if (!row || row.amount < amount) throw new AppError('容器里没有这么多物品', 400)
  const left = row.amount - amount
  if (left <= 0) {
    await tx.raidBagItem.delete({ where: { id: row.id } })
  } else {
    await tx.raidBagItem.update({ where: { id: row.id }, data: { amount: left } })
  }
}

export async function getRaidWarehouseUsed(userId: number, tx: Db = prisma): Promise<number> {
  const rows = await tx.raidInventoryItem.findMany({ where: { userId }, select: { amount: true } })
  return rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0)
}

/* ============================================================
   存入 / 取出
   ============================================================ */

export interface RaidDepositInput {
  container: RaidContainerKind
  slotIndex: number
  amount: number
}

/** 单格整笔存入仓库：仓库剩余容量不足时整笔失败，物品留在原容器 */
export async function depositRaidItems(userId: number, input: RaidDepositInput): Promise<RaidStorageViewDto> {
  await assertNoActiveRaid(userId)
  const container = input.container
  const amount = Math.max(1, Math.trunc(input.amount))
  await prisma.$transaction(async (tx) => {
    const row = await tx.raidBagItem.findUnique({
      where: { userId_container_slotIndex: { userId, container, slotIndex: input.slotIndex } },
    })
    if (!row) throw new AppError('这个格子里没有物品', 404)
    if (row.amount < amount) throw new AppError('数量超过格子里的持有量', 400)
    const storage = await ensureRaidStorageTx(tx, userId)
    const info = storageLevelInfo(storage.level)
    const used = await getRaidWarehouseUsed(userId, tx)
    if (used + amount > info.capacity) {
      throw new AppError(`仓库空间不足（剩余 ${Math.max(0, info.capacity - used)} 件），先清理仓库或升级吧`, 400)
    }
    await decrementBagSlotTx(tx, userId, container, input.slotIndex, amount)
    await upsertWarehouseTx(tx, userId, row.itemKey, amount)
  })
  return buildStorageView(userId)
}

export interface RaidDepositAllResult extends RaidStorageViewDto {
  movedUnits: number
  remainingUnits: number
}

/** 一键存入：按容器顺序（背包 → 胸挂 → 安全箱）尽量装入，装不下的留在原处 */
export async function depositAllRaidItems(userId: number): Promise<RaidDepositAllResult> {
  await assertNoActiveRaid(userId)
  let movedUnits = 0
  await prisma.$transaction(async (tx) => {
    const storage = await ensureRaidStorageTx(tx, userId)
    const info = storageLevelInfo(storage.level)
    let free = info.capacity - (await getRaidWarehouseUsed(userId, tx))
    const rows = await tx.raidBagItem.findMany({
      where: { userId },
      orderBy: [{ container: 'asc' }, { slotIndex: 'asc' }],
    })
    for (const row of rows) {
      if (free <= 0) break
      const take = Math.min(row.amount, free)
      if (take <= 0) continue
      await decrementBagSlotTx(tx, userId, row.container as RaidBagContainer, row.slotIndex, take)
      await upsertWarehouseTx(tx, userId, row.itemKey, take)
      movedUnits += take
      free -= take
    }
  })
  const view = await buildStorageView(userId)
  return {
    ...view,
    movedUnits,
    remainingUnits:
      view.containers.backpack.usedUnits +
      view.containers.rig.usedUnits +
      view.containers.safe.usedUnits,
  }
}

export interface RaidWithdrawInput {
  container: RaidContainerKind
  itemKey: string
  amount: number
}

/** 从仓库取出到容器（背包/胸挂/安全箱），容器放不下则整笔失败 */
export async function withdrawRaidItems(userId: number, input: RaidWithdrawInput): Promise<RaidStorageViewDto> {
  await assertNoActiveRaid(userId)
  const amount = Math.max(1, Math.trunc(input.amount))
  const def = getRaidItem(input.itemKey)
  if (!def) throw new AppError('没有这件物品', 404)
  await prisma.$transaction(async (tx) => {
    const loadout = await loadRaidLoadoutTx(tx, userId)
    const capacity = input.container === 'rig'
      ? loadout.capacities.rig
      : input.container === 'safe'
        ? loadout.capacities.safe
        : loadout.capacities.backpack
    if (capacity <= 0) {
      throw new AppError(`还没有装备${RAID_CONTAINER_LABELS[input.container]}，先去商店买一个吧`, 400)
    }
    const rows = await tx.raidBagItem.findMany({ where: { userId, container: input.container } })
    const stacks: RaidItemStack[] = bagRowsToStacks(rows)
    const next = addItemToContainer(stacks, capacity, input.itemKey, amount)
    if (!next) throw new AppError(`${RAID_CONTAINER_LABELS[input.container]}已满，装不下了`, 400)
    await decrementWarehouseTx(tx, userId, input.itemKey, amount)
    await writeContainersTx(tx, userId, {
      [input.container]: normalizeContainer(next, capacity),
    })
  })
  return buildStorageView(userId)
}

/* ============================================================
   卖给官方商店
   ============================================================ */

export interface RaidRecycleInput {
  from: RaidBagContainer | 'warehouse'
  itemKey: string
  amount: number
  slotIndex?: number
}

export interface RaidRecycleResult {
  points: number
  balance: number
  view: RaidStorageViewDto
}

/** 回收（卖给系统商店）：材料 100% / 消耗品 60% / 箱子 70% 目录价值 */
export async function recycleRaidItems(userId: number, input: RaidRecycleInput): Promise<RaidRecycleResult> {
  await assertNoActiveRaid(userId)
  const amount = Math.max(1, Math.trunc(input.amount))
  const def = getRaidItem(input.itemKey)
  if (!def) throw new AppError('没有这件物品', 404)
  const value = raidSellPrice(input.itemKey, amount)
  if (value <= 0) throw new AppError('这件物品无法回收', 400)
  const result = await prisma.$transaction(async (tx) => {
    if (input.from === 'warehouse') {
      await decrementWarehouseTx(tx, userId, input.itemKey, amount)
    } else {
      const slotIndex = input.slotIndex
      if (slotIndex === undefined || !Number.isInteger(slotIndex)) {
        throw new AppError('缺少容器格位', 400)
      }
      const row = await tx.raidBagItem.findUnique({
        where: { userId_container_slotIndex: { userId, container: input.from, slotIndex } },
      })
      if (!row || row.itemKey !== input.itemKey) throw new AppError('这个格子里没有这件物品', 404)
      await decrementBagSlotTx(tx, userId, input.from, slotIndex, amount)
    }
    return awardPointsTx(tx, userId, {
      amount: value,
      reason: 'raid_recycle',
      note: `回收 ${def.name} ×${amount}`,
    })
  })
  const view = await buildStorageView(userId)
  return { points: value, balance: result.balance, view }
}

export interface RaidRecycleAllInput {
  /** 保留仓库升级材料（默认 true，一键卖光升级料会让你升不起级） */
  keepUpgradeItems?: boolean
}

export interface RaidRecycleAllResult {
  points: number
  count: number
  balance: number
  view: RaidStorageViewDto
}

/** 一键回收整个仓库（官方商店价逐行结算，事务内原子完成） */
export async function recycleAllRaidItems(userId: number, input: RaidRecycleAllInput = {}): Promise<RaidRecycleAllResult> {
  await assertNoActiveRaid(userId)
  const keepUpgradeItems = input.keepUpgradeItems !== false
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.raidInventoryItem.findMany({ where: { userId } })
    if (rows.length === 0) throw new AppError('仓库是空的，没有可以回收的东西', 400)
    // 升级材料白名单：所有等级的 upgradeItems 并集（保留时不回收这些 key）
    const upgradeKeys = new Set<string>()
    if (keepUpgradeItems) {
      for (const level of RAID_STORAGE_LEVELS) {
        for (const item of level.upgradeItems) upgradeKeys.add(item.itemKey)
      }
    }
    const recyclable = rows.filter((row) => !upgradeKeys.has(row.itemKey))
    if (recyclable.length === 0) throw new AppError('除升级材料外没有可回收的物品', 400)
    let total = 0
    let count = 0
    for (const row of recyclable) {
      total += raidSellPrice(row.itemKey, row.amount)
      count += row.amount
    }
    if (total <= 0) throw new AppError('这些物品无法回收', 400)
    await tx.raidInventoryItem.deleteMany({
      where: { userId, itemKey: { in: recyclable.map((row) => row.itemKey) } },
    })
    const award = await awardPointsTx(tx, userId, {
      amount: total,
      reason: 'raid_recycle',
      note: `一键回收 ${count} 件仓库物品`,
    })
    return { points: total, count, balance: award.balance }
  })
  const view = await buildStorageView(userId)
  return { points: result.points, count: result.count, balance: result.balance, view }
}

/* ============================================================
   批量回收（物品 + 装备，一次事务结算）
   ============================================================ */

export interface RaidRecycleBatchItemInput {
  /** 物品 key */
  key: string
  /** 回收数量，缺省回收该行全部 */
  amount?: number
  /** 来源，缺省仓库 */
  from?: RaidBagContainer | 'warehouse'
  /** 容器格位（from 为容器时用于精确定位，缺省取该容器里第一格匹配的物品） */
  slotIndex?: number
}

export interface RaidRecycleBatchInput {
  items: RaidRecycleBatchItemInput[]
  gearIds: number[]
}

export interface RaidRecycleBatchResult {
  points: number
  /** 回收的物品件数（按数量单位计，与一键回收的 count 同口径） */
  itemCount: number
  /** 回收的装备件数 */
  gearCount: number
  balance: number
  view: RaidStorageViewDto
}

/** 批量回收单次上限（物品条目 + 装备件数合计；路由层 zod 已限，这里兜底） */
const RECYCLE_BATCH_LIMIT = 100

/**
 * 批量回收：物品与装备在同一个事务里逐项校验并计价，任一项失败整体回滚并指明是哪一项。
 *
 * 装备回收价与 raidGearService.recycleRaidGear 同口径（目录价 ×60% 向上取整、最低 1 积分），
 * 在本文件内实现同款计算，避免仅为一个常量引入跨服务依赖（raidGearService 的既有导出不动）。
 */
export async function recycleRaidItemsBatch(userId: number, input: RaidRecycleBatchInput): Promise<RaidRecycleBatchResult> {
  await assertNoActiveRaid(userId)
  if (input.items.length + input.gearIds.length > RECYCLE_BATCH_LIMIT) {
    throw new AppError(`一次最多回收 ${RECYCLE_BATCH_LIMIT} 项`, 400)
  }
  if (input.items.length + input.gearIds.length === 0) {
    throw new AppError('没有选择任何要回收的东西', 400)
  }
  // gearIds 去重：同一件装备出现两次会让第二次条件删除落空（按 409 报错），直接按一件处理
  const gearIds = Array.from(new Set(input.gearIds))
  // 物品条目按「来源 + 格位 + key」去重，避免「缺省整行回收」在重复项上产生歧义
  const seenItems = new Set<string>()
  for (const entry of input.items) {
    const dedupeKey = `${entry.from ?? 'warehouse'}:${entry.slotIndex ?? '*'}:${entry.key}`
    if (seenItems.has(dedupeKey)) {
      const def = RAID_ITEM_MAP.get(entry.key)
      throw new AppError(`回收清单里有重复项：${def?.name ?? entry.key}`, 400)
    }
    seenItems.add(dedupeKey)
  }

  const result = await prisma.$transaction(async (tx) => {
    let total = 0
    let itemCount = 0
    let gearCount = 0

    for (const entry of input.items) {
      const def = getRaidItem(entry.key)
      if (!def) throw new AppError(`回收清单里有未知物品：${entry.key}`, 400)
      const from = entry.from ?? 'warehouse'
      const amount = entry.amount === undefined ? null : Math.trunc(entry.amount)
      if (amount !== null && (!Number.isInteger(amount) || amount < 1)) {
        throw new AppError(`${def.name} 的回收数量必须是正整数`, 400)
      }
      if (from === 'warehouse') {
        const row = await tx.raidInventoryItem.findUnique({
          where: { userId_itemKey: { userId, itemKey: entry.key } },
        })
        if (!row) throw new AppError(`仓库里没有 ${def.name}`, 400)
        const take = amount ?? row.amount
        if (take > row.amount) throw new AppError(`${def.name} 仓库里只有 ${row.amount} 件`, 400)
        const value = raidSellPrice(entry.key, take)
        if (value <= 0) throw new AppError(`${def.name} 无法回收`, 400)
        if (take >= row.amount) {
          await tx.raidInventoryItem.delete({ where: { id: row.id } })
        } else {
          await tx.raidInventoryItem.update({ where: { id: row.id }, data: { amount: row.amount - take } })
        }
        total += value
        itemCount += take
      } else {
        const row = entry.slotIndex !== undefined
          ? await tx.raidBagItem.findUnique({
              where: { userId_container_slotIndex: { userId, container: from, slotIndex: entry.slotIndex } },
            })
          : await tx.raidBagItem.findFirst({ where: { userId, container: from, itemKey: entry.key } })
        if (!row || row.itemKey !== entry.key) {
          throw new AppError(`${RAID_CONTAINER_LABELS[from]}里没有 ${def.name}`, 400)
        }
        const take = amount ?? row.amount
        if (take > row.amount) {
          throw new AppError(`${RAID_CONTAINER_LABELS[from]}里的 ${def.name} 只有 ${row.amount} 件`, 400)
        }
        const value = raidSellPrice(entry.key, take)
        if (value <= 0) throw new AppError(`${def.name} 无法回收`, 400)
        if (take >= row.amount) {
          await tx.raidBagItem.delete({ where: { id: row.id } })
        } else {
          await tx.raidBagItem.update({ where: { id: row.id }, data: { amount: row.amount - take } })
        }
        total += value
        itemCount += take
      }
    }

    for (const gearId of gearIds) {
      const row = await tx.raidGear.findFirst({ where: { id: gearId, userId } })
      if (!row) throw new AppError(`回收清单里有不属于你的装备（id ${gearId}）`, 400)
      const def = RAID_GEAR_MAP.get(row.gearKey)
      if (!def) throw new AppError(`装备数据异常（${row.gearKey}），无法回收`, 400)
      if (row.equipped) throw new AppError(`${def.name} 正在穿戴中，先卸下再回收`, 400)
      // 条件删除：并发下同一件被抢先回收时这里抢不到行，整体回滚而不是重复发分
      const deleted = await tx.raidGear.deleteMany({ where: { id: row.id, userId } })
      if (deleted.count === 0) throw new AppError(`${def.name} 的状态已变化，请重试`, 409)
      total += Math.max(1, Math.round(def.price * 0.6))
      gearCount += 1
    }

    if (total <= 0) throw new AppError('这些物品无法回收', 400)
    const award = await awardPointsTx(tx, userId, {
      amount: total,
      reason: 'raid_recycle',
      note: `批量回收 ${itemCount + gearCount} 件（物品 ${itemCount} + 装备 ${gearCount}）`,
    })
    return { points: total, itemCount, gearCount, balance: award.balance }
  })
  const view = await buildStorageView(userId)
  return { ...result, view }
}

/* ============================================================
   升级
   ============================================================ */

export async function upgradeRaidStorage(userId: number): Promise<RaidStorageViewDto> {
  await prisma.$transaction(async (tx) => {
    const storage = await ensureRaidStorageTx(tx, userId)
    const next = nextStorageUpgrade(storage.level)
    if (!next) throw new AppError('仓库已经是满级了', 400)
    const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
    if (!user) throw new AppError('用户不存在', 404)
    if (user.points < next.upgradePoints) {
      throw new AppError(`升级需要 ${next.upgradePoints} 积分，当前只有 ${user.points}`, 400)
    }
    const rows = await tx.raidInventoryItem.findMany({ where: { userId } })
    for (const item of next.upgradeItems) {
      const row = rows.find((entry) => entry.itemKey === item.itemKey)
      if (!row || row.amount < item.count) {
        const def = RAID_ITEM_MAP.get(item.itemKey)
        throw new AppError(`升级材料不足：${def?.name ?? item.itemKey} 需要 ${item.count} 件`, 400)
      }
    }
    if (next.upgradePoints > 0) {
      await spendPointsTx(tx, userId, next.upgradePoints, {
        reason: 'raid_storage_upgrade',
        note: `仓库升级到 Lv.${next.level}`,
      })
    }
    for (const item of next.upgradeItems) {
      await decrementWarehouseTx(tx, userId, item.itemKey, item.count)
    }
    const updated = await tx.raidStorage.updateMany({
      where: { userId, level: storage.level },
      data: { level: next.level },
    })
    if (updated.count !== 1) throw new AppError('仓库等级已变化，请重试', 409)
  })
  return buildStorageView(userId)
}

/** 事务内读容器（结算 / 校验用） */
export async function readContainersTx(
  tx: Db,
  userId: number,
): Promise<Record<RaidBagContainer, RaidItemStack[]>> {
  const rows = await tx.raidBagItem.findMany({ where: { userId } })
  return {
    backpack: bagRowsToStacks(bagRowsOf(rows, 'backpack')),
    rig: bagRowsToStacks(bagRowsOf(rows, 'rig')),
    safe: bagRowsToStacks(bagRowsOf(rows, 'safe')),
  }
}
