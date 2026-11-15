/**
 * 搜打撤藏品室服务（2026-11-15）。
 *
 * 口径：
 *   - 藏品是绑定收集品：从仓库移入藏品室后不再参与回收 / 取出 / 公司货栈；
 *   - 每用户每种藏品最多一件，重复获得折算积分；
 *   - 展位固定 12 个，可空；布展先全部清空再写入，避免交换冲突；
 *   - 参观需要登录；isPublic=false 时仅主人可见（非主人 404）。
 */

import prisma from '../lib/prisma.js'
import type { Prisma, RaidCollectionRoom } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_COLLECTION_SLOTS,
  COLLECTIBLE_CATALOG,
  collectibleDuplicatePoints,
  collectionCompletionPct,
  firstFreeDisplaySlot,
  isCollectibleKey,
  normalizeDisplaySlots,
  type DisplaySlotInput,
} from '../lib/raidCollection.js'
import { RAID_ITEM_MAP, RAID_RARITY_ORDER, type RaidItemDef, type RaidRarity } from '../lib/raidRun.js'
import { awardPointsTx, effectiveTitleDto, type UserTitleDto } from './pointsService.js'
import { assertNoActiveRaid } from './raidRunService.js'
import { decrementWarehouseTx } from './raidStorageService.js'

type Db = Prisma.TransactionClient

const PUBLIC_ROOM_LIMIT = 24
const VISIT_THROTTLE_MS = 30 * 60_000
const visitThrottle = new Map<string, number>()

/* ============================================================
   DTO
   ============================================================ */

export interface RaidCollectibleDto {
  itemKey: string
  name: string
  emoji: string
  rarity: RaidRarity
  value: number
  description: string
  source: string
  displaySlot: number | null
  note: string
  obtainedAt: string
  duplicatePoints: number
}

export interface RaidCollectionCatalogEntryDto {
  itemKey: string
  name: string
  emoji: string
  rarity: RaidRarity
  value: number
  description: string
  owned: boolean
  obtainedAt: string | null
}

export interface RaidCollectionWarehouseCandidateDto {
  itemKey: string
  name: string
  emoji: string
  rarity: RaidRarity
  amount: number
  duplicate: boolean
  duplicatePoints: number
}

export interface RaidCollectionStatsDto {
  total: number
  displayed: number
  catalogTotal: number
  completionPct: number
  byRarity: Record<RaidRarity, number>
}

export interface RaidCollectionViewDto {
  exists: boolean
  owner: {
    userId: number
    username: string
    avatarVersion: number | null
    title: UserTitleDto | null
  }
  room: {
    title: string
    intro: string
    isPublic: boolean
    visits: number
    updatedAt: string | null
  }
  viewer: { userId: number; isSelf: boolean }
  items: RaidCollectibleDto[]
  slots: Array<RaidCollectibleDto | null>
  catalog: RaidCollectionCatalogEntryDto[]
  stats: RaidCollectionStatsDto
  /** 仅主人可见：仓库里可收入藏品室的藏品 */
  warehouseCandidates: RaidCollectionWarehouseCandidateDto[]
}

export interface RaidCollectionSummaryDto {
  userId: number
  username: string
  avatarVersion: number | null
  title: string
  intro: string
  visits: number
  total: number
  completionPct: number
  cover: Array<{ itemKey: string; name: string; emoji: string; rarity: RaidRarity }>
  isSelf: boolean
}

export interface CollectRaidItemResult {
  duplicate: boolean
  points: number
  item: RaidCollectibleDto
  view: RaidCollectionViewDto
}

/* ============================================================
   工具
   ============================================================ */

function itemDef(itemKey: string): RaidItemDef | null {
  return RAID_ITEM_MAP.get(itemKey) ?? null
}

function toCollectibleDto(row: {
  itemKey: string
  source: string
  displaySlot: number | null
  note: string
  obtainedAt: Date
}): RaidCollectibleDto | null {
  const def = itemDef(row.itemKey)
  if (!def || def.kind !== 'collectible') return null
  return {
    itemKey: def.key,
    name: def.name,
    emoji: def.emoji,
    rarity: def.rarity,
    value: def.value,
    description: def.description,
    source: row.source,
    displaySlot: row.displaySlot,
    note: row.note,
    obtainedAt: row.obtainedAt.toISOString(),
    duplicatePoints: collectibleDuplicatePoints(def),
  }
}

function emptyByRarity(): Record<RaidRarity, number> {
  return {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0,
  }
}

export async function ensureRoomTx(tx: Db, userId: number): Promise<RaidCollectionRoom> {
  const existing = await tx.raidCollectionRoom.findUnique({ where: { userId } })
  if (existing) return existing
  return tx.raidCollectionRoom.create({ data: { userId } })
}

async function ensureRoom(userId: number): Promise<RaidCollectionRoom> {
  return prisma.$transaction((tx) => ensureRoomTx(tx, userId))
}

/* ============================================================
   视图
   ============================================================ */

export async function getCollectionView(
  ownerUserId: number,
  viewerUserId: number,
): Promise<RaidCollectionViewDto> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: {
      id: true,
      username: true,
      avatarVersion: true,
      status: true,
      equippedTitle: { select: { id: true, type: true, name: true, payload: true, rarity: true } },
      equippedLeaderTitle: {
        select: { id: true, game: true, userId: true, effect: true },
      },
    },
  })
  if (!owner || owner.status !== 'active') throw new AppError('这位用户还没有藏品室', 404)

  const isSelf = ownerUserId === viewerUserId
  const room = await prisma.raidCollectionRoom.findUnique({ where: { userId: ownerUserId } })
  const title = effectiveTitleDto({
    id: owner.id,
    equippedTitle: owner.equippedTitle,
    equippedLeaderTitle: owner.equippedLeaderTitle,
  })

  const baseOwner = {
    userId: owner.id,
    username: owner.username,
    avatarVersion: owner.avatarVersion,
    title,
  }

  if (!room) {
    return {
      exists: false,
      owner: baseOwner,
      room: { title: '我的藏品室', intro: '', isPublic: true, visits: 0, updatedAt: null },
      viewer: { userId: viewerUserId, isSelf },
      items: [],
      slots: Array.from({ length: RAID_COLLECTION_SLOTS }, () => null),
      catalog: COLLECTIBLE_CATALOG.map((def) => ({
        itemKey: def.key,
        name: def.name,
        emoji: def.emoji,
        rarity: def.rarity,
        value: def.value,
        description: def.description,
        owned: false,
        obtainedAt: null,
      })),
      stats: {
        total: 0,
        displayed: 0,
        catalogTotal: COLLECTIBLE_CATALOG.length,
        completionPct: 0,
        byRarity: emptyByRarity(),
      },
      warehouseCandidates: [],
    }
  }

  if (!room.isPublic && !isSelf) throw new AppError('这间藏品室没有对外开放', 404)

  const rows = await prisma.raidCollectible.findMany({
    where: { roomId: room.id },
    orderBy: [{ displaySlot: 'asc' }, { obtainedAt: 'asc' }],
  })
  const items = rows
    .map((row) => toCollectibleDto(row))
    .filter((row): row is RaidCollectibleDto => row !== null)

  const slots: Array<RaidCollectibleDto | null> = Array.from(
    { length: RAID_COLLECTION_SLOTS },
    () => null,
  )
  for (const item of items) {
    if (item.displaySlot !== null && item.displaySlot >= 0 && item.displaySlot < RAID_COLLECTION_SLOTS) {
      slots[item.displaySlot] = item
    }
  }

  const byRarity = emptyByRarity()
  for (const item of items) byRarity[item.rarity] += 1

  const ownedKeys = new Set(items.map((item) => item.itemKey))
  const catalog = COLLECTIBLE_CATALOG.map((def) => {
    const owned = ownedKeys.has(def.key)
    const row = owned ? items.find((item) => item.itemKey === def.key) : undefined
    return {
      itemKey: def.key,
      name: def.name,
      emoji: def.emoji,
      rarity: def.rarity,
      value: def.value,
      description: def.description,
      owned,
      obtainedAt: row?.obtainedAt ?? null,
    }
  })

  let visits = room.visits
  if (!isSelf) {
    visits += await registerVisit(room.id, viewerUserId)
  }

  let warehouseCandidates: RaidCollectionWarehouseCandidateDto[] = []
  if (isSelf) {
    const keys = new Set(COLLECTIBLE_CATALOG.map((item) => item.key))
    const warehouseRows = await prisma.raidInventoryItem.findMany({
      where: { userId: ownerUserId, itemKey: { in: [...keys] }, amount: { gt: 0 } },
      orderBy: { itemKey: 'asc' },
    })
    warehouseCandidates = warehouseRows.flatMap((row) => {
      const def = itemDef(row.itemKey)
      if (!def || def.kind !== 'collectible') return []
      return [{
        itemKey: def.key,
        name: def.name,
        emoji: def.emoji,
        rarity: def.rarity,
        amount: row.amount,
        duplicate: ownedKeys.has(def.key),
        duplicatePoints: collectibleDuplicatePoints(def),
      }]
    })
  }

  return {
    exists: true,
    owner: baseOwner,
    room: {
      title: room.title,
      intro: room.intro,
      isPublic: room.isPublic,
      visits,
      updatedAt: room.updatedAt.toISOString(),
    },
    viewer: { userId: viewerUserId, isSelf },
    items,
    slots,
    catalog,
    stats: {
      total: items.length,
      displayed: items.filter((item) => item.displaySlot !== null).length,
      catalogTotal: COLLECTIBLE_CATALOG.length,
      completionPct: collectionCompletionPct(items.length, COLLECTIBLE_CATALOG.length),
      byRarity,
    },
    warehouseCandidates,
  }
}

/** 参观计数：同一访客 30 分钟内只 +1（进程内节流，重启清零） */
async function registerVisit(roomId: number, viewerId: number): Promise<number> {
  const key = `${roomId}:${viewerId}`
  const now = Date.now()
  const last = visitThrottle.get(key)
  if (last && now - last < VISIT_THROTTLE_MS) return 0
  visitThrottle.set(key, now)
  if (visitThrottle.size > 5000) {
    for (const [entryKey, timestamp] of visitThrottle) {
      if (now - timestamp > VISIT_THROTTLE_MS) visitThrottle.delete(entryKey)
    }
  }
  const updated = await prisma.raidCollectionRoom.update({
    where: { id: roomId },
    data: { visits: { increment: 1 } },
    select: { visits: true },
  })
  return 1
}

export async function listPublicCollections(viewerUserId: number): Promise<{ rooms: RaidCollectionSummaryDto[] }> {
  const rows = await prisma.raidCollectionRoom.findMany({
    where: {
      isPublic: true,
      user: { status: 'active' },
      collectibles: { some: {} },
    },
    orderBy: [{ visits: 'desc' }, { updatedAt: 'desc' }],
    take: PUBLIC_ROOM_LIMIT,
    include: {
      user: { select: { id: true, username: true, avatarVersion: true } },
      _count: { select: { collectibles: true } },
      collectibles: {
        orderBy: [{ displaySlot: 'asc' }, { obtainedAt: 'asc' }],
        take: 4,
      },
    },
  })

  return {
    rooms: rows.map((room) => {
      const cover = room.collectibles.flatMap((row) => {
        const def = itemDef(row.itemKey)
        if (!def || def.kind !== 'collectible') return []
        return [{ itemKey: def.key, name: def.name, emoji: def.emoji, rarity: def.rarity }]
      })
      return {
        userId: room.user.id,
        username: room.user.username,
        avatarVersion: room.user.avatarVersion,
        title: room.title,
        intro: room.intro,
        visits: room.visits,
        total: room._count.collectibles,
        completionPct: collectionCompletionPct(room._count.collectibles, COLLECTIBLE_CATALOG.length),
        cover,
        isSelf: room.user.id === viewerUserId,
      }
    }),
  }
}

/* ============================================================
   写操作
   ============================================================ */

export interface UpdateRoomInput {
  title?: string
  intro?: string
  isPublic?: boolean
}

export async function updateCollectionRoom(
  userId: number,
  input: UpdateRoomInput,
): Promise<RaidCollectionViewDto> {
  const room = await ensureRoom(userId)
  const data: Prisma.RaidCollectionRoomUpdateInput = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (title.length < 1 || title.length > 20) throw new AppError('藏品室名需要 1–20 个字符', 400)
    data.title = title
  }
  if (input.intro !== undefined) {
    const intro = input.intro.trim()
    if (intro.length > 80) throw new AppError('简介最多 80 个字符', 400)
    data.intro = intro
  }
  if (input.isPublic !== undefined) data.isPublic = input.isPublic
  if (Object.keys(data).length > 0) {
    await prisma.raidCollectionRoom.update({ where: { id: room.id }, data })
  }
  return getCollectionView(userId, userId)
}

/** 把仓库里的 1 件藏品收入藏品室；已拥有则折算积分并从仓库扣掉 */
export async function collectRaidItem(userId: number, rawItemKey: string): Promise<CollectRaidItemResult> {
  await assertNoActiveRaid(userId)
  const itemKey = String(rawItemKey ?? '').trim()
  const def = itemDef(itemKey)
  if (!def || def.kind !== 'collectible') throw new AppError('这不是可收藏的藏品', 400)
  if (!isCollectibleKey(itemKey)) throw new AppError('未知藏品', 404)

  const outcome = await prisma.$transaction(async (tx) => {
    const room = await ensureRoomTx(tx, userId)
    const warehouse = await tx.raidInventoryItem.findUnique({
      where: { userId_itemKey: { userId, itemKey } },
    })
    if (!warehouse || warehouse.amount < 1) {
      throw new AppError('仓库里没有这件藏品', 400)
    }
    const existing = await tx.raidCollectible.findUnique({
      where: { roomId_itemKey: { roomId: room.id, itemKey } },
    })
    let points = 0
    let row = existing
    if (existing) {
      points = collectibleDuplicatePoints(def)
      if (points > 0) {
        await awardPointsTx(tx, userId, {
          amount: points,
          reason: 'raid_collectible_duplicate',
          note: `重复藏品·${def.name}`,
        })
      }
    } else {
      const usedSlots = await tx.raidCollectible.findMany({
        where: { roomId: room.id, displaySlot: { not: null } },
        select: { displaySlot: true },
      })
      const slot = firstFreeDisplaySlot(
        usedSlots.flatMap((entry) => (entry.displaySlot === null ? [] : [entry.displaySlot])),
      )
      row = await tx.raidCollectible.create({
        data: {
          roomId: room.id,
          itemKey,
          source: 'raid',
          displaySlot: slot,
        },
      })
    }
    await decrementWarehouseTx(tx, userId, itemKey, 1)
    return { duplicate: Boolean(existing), points, row: row! }
  })

  const item = toCollectibleDto(outcome.row)
  if (!item) throw new AppError('藏品数据异常', 500)
  const view = await getCollectionView(userId, userId)
  return { duplicate: outcome.duplicate, points: outcome.points, item, view }
}

/** 布展：先清空全部展位，再按输入写入（服务层校验，不依赖 DB unique） */
export async function setCollectionDisplay(
  userId: number,
  rawSlots: DisplaySlotInput[],
): Promise<RaidCollectionViewDto> {
  await assertNoActiveRaid(userId)
  const room = await ensureRoom(userId)
  const owned = await prisma.raidCollectible.findMany({
    where: { roomId: room.id },
    select: { itemKey: true },
  })
  const ownedKeys = new Set(owned.map((row) => row.itemKey))
  let slots
  try {
    slots = normalizeDisplaySlots(rawSlots, ownedKeys)
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : '布展数据无效', 400)
  }

  await prisma.$transaction(async (tx) => {
    await tx.raidCollectible.updateMany({
      where: { roomId: room.id },
      data: { displaySlot: null },
    })
    for (const entry of slots) {
      await tx.raidCollectible.update({
        where: { roomId_itemKey: { roomId: room.id, itemKey: entry.itemKey } },
        data: { displaySlot: entry.slot, note: entry.note },
      })
    }
  })
  return getCollectionView(userId, userId)
}

/**
 * 抽奖等系统途径直接发放藏品（不经过仓库）。重复时返回折算积分，不抛错。
 * 调用方在同一个事务里自行 awardPointsTx。
 */
export async function addCollectibleTx(
  tx: Db,
  userId: number,
  itemKey: string,
  source: 'raid' | 'lottery' = 'lottery',
): Promise<{ created: boolean; duplicatePoints: number; def: RaidItemDef }> {
  const def = itemDef(itemKey)
  if (!def || def.kind !== 'collectible') throw new AppError('未知藏品', 404)
  const room = await ensureRoomTx(tx, userId)
  const existing = await tx.raidCollectible.findUnique({
    where: { roomId_itemKey: { roomId: room.id, itemKey } },
  })
  if (existing) {
    return { created: false, duplicatePoints: collectibleDuplicatePoints(def), def }
  }
  const usedSlots = await tx.raidCollectible.findMany({
    where: { roomId: room.id, displaySlot: { not: null } },
    select: { displaySlot: true },
  })
  const slot = firstFreeDisplaySlot(
    usedSlots.flatMap((entry) => (entry.displaySlot === null ? [] : [entry.displaySlot])),
  )
  await tx.raidCollectible.create({
    data: { roomId: room.id, itemKey, source, displaySlot: slot },
  })
  return { created: true, duplicatePoints: 0, def }
}

/** 目录（抽奖服务用）：所有可收藏品的 key / 权重 */
export function collectibleCatalog(): Array<{ key: string; weight: number; def: RaidItemDef }> {
  return COLLECTIBLE_CATALOG.map((def) => ({ key: def.key, weight: def.weight, def }))
}

/** 稀有度顺序（抽奖结果 payload 用） */
export function raidRarityOrder(): readonly RaidRarity[] {
  return RAID_RARITY_ORDER
}