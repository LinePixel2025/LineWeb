import prisma from '../lib/prisma.js'
import type { Farm, FarmItem, FarmPlot, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  CROP_MAP,
  FARM_CROPS,
  FERTILIZER_COST,
  FERTILIZER_MAX_PER_CROP,
  INITIAL_FERTILIZER,
  INITIAL_PLOT_COUNT,
  INITIAL_SEEDS,
  MAX_PLOT_COUNT,
  PLOT_EXPANSION_COSTS,
  computeStealPoints,
  cropUnitsValue,
  fertilizeReadyAt,
  getCrop,
  nextExpansion,
  type CropDef,
} from '../lib/farmCrops.js'
import { getTodayDayStart, type PointsConfigDto } from '../lib/pointsRules.js'
import {
  awardPointsTx,
  getPointsConfig,
  getPointsProfile,
  spendPointsTx,
  toUserTitleDto,
  type UserTitleDto,
} from './pointsService.js'

type Db = Prisma.TransactionClient
type FarmWithRelations = Farm & { plots: FarmPlot[]; items: FarmItem[] }

/* ============================================================
   DTO
   ============================================================ */

export interface FarmPlotDto {
  index: number
  crop: CropDef | null
  plantedAt: string | null
  readyAt: string | null
  yieldUnits: number
  stolenCount: number
  fertilized: number
  progress: number
  ready: boolean
  remainingMs: number
}

function plotDto(plot: FarmPlot, now: number): FarmPlotDto {
  const crop = getCrop(plot.crop)
  const readyAt = plot.readyAt ? new Date(plot.readyAt) : null
  const plantedAt = plot.plantedAt ? new Date(plot.plantedAt) : null
  const total = plantedAt && readyAt ? readyAt.getTime() - plantedAt.getTime() : 0
  const progress = crop && plantedAt && readyAt
    ? Math.min(1, Math.max(0, (now - plantedAt.getTime()) / Math.max(1, total)))
    : 0
  const remainingMs = readyAt ? Math.max(0, readyAt.getTime() - now) : 0
  return {
    index: plot.index,
    crop,
    plantedAt: plantedAt ? plantedAt.toISOString() : null,
    readyAt: readyAt ? readyAt.toISOString() : null,
    yieldUnits: plot.yieldUnits,
    stolenCount: plot.stolenCount,
    fertilized: plot.fertilized,
    progress,
    ready: !!crop && remainingMs === 0,
    remainingMs,
  }
}

function seedsOf(items: FarmItem[]) {
  return items
    .filter((item) => item.kind === 'seed' && item.count > 0)
    .map((item) => {
      const crop = getCrop(item.itemKey)
      return crop ? { key: crop.key, name: crop.name, emoji: crop.emoji, count: item.count } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => (getCrop(a.key)?.tier ?? 0) - (getCrop(b.key)?.tier ?? 0))
}

function fertilizerOf(items: FarmItem[]): number {
  return items.find((item) => item.kind === 'fertilizer')?.count ?? 0
}

function economyDto() {
  const expansions = Object.entries(PLOT_EXPANSION_COSTS)
    .map(([plotCount, cost]) => ({ plotCount: Number(plotCount), cost }))
    .sort((a, b) => a.plotCount - b.plotCount)
  return {
    initialPlotCount: INITIAL_PLOT_COUNT,
    maxPlotCount: MAX_PLOT_COUNT,
    fertilizerCost: FERTILIZER_COST,
    fertilizerMaxPerCrop: FERTILIZER_MAX_PER_CROP,
    expansions,
  }
}

async function stealUsedToday(userId: number, now: number): Promise<number> {
  return prisma.farmSteal.count({
    where: { thiefId: userId, createdAt: { gte: getTodayDayStart(now) } },
  })
}

async function recentSteals(userId: number) {
  const [made, received] = await Promise.all([
    prisma.farmSteal.findMany({
      where: { thiefId: userId },
      orderBy: { id: 'desc' },
      take: 8,
      include: { victim: { select: { id: true, username: true } } },
    }),
    prisma.farmSteal.findMany({
      where: { victimId: userId },
      orderBy: { id: 'desc' },
      take: 8,
      include: { thief: { select: { id: true, username: true } } },
    }),
  ])
  return {
    made: made.map((row) => ({
      id: row.id,
      crop: getCrop(row.crop),
      points: row.points,
      createdAt: row.createdAt.toISOString(),
      user: row.victim,
    })),
    received: received.map((row) => ({
      id: row.id,
      crop: getCrop(row.crop),
      points: row.points,
      createdAt: row.createdAt.toISOString(),
      user: row.thief,
    })),
  }
}

export interface FarmView {
  farm: {
    id: number
    name: string
    plotCount: number
    tutorialDone: boolean
    createdAt: string
    harvested: number
    harvestPoints: number
    stolenPoints: number
  } | null
  plots: FarmPlotDto[]
  inventory: { seeds: ReturnType<typeof seedsOf>; fertilizer: number }
  catalog: readonly CropDef[]
  economy: ReturnType<typeof economyDto>
  points: number
  stealQuota: { used: number; limit: number; remaining: number }
  recentSteals: Awaited<ReturnType<typeof recentSteals>>
}

/* ============================================================
   读取
   ============================================================ */

export async function getFarmView(userId: number): Promise<FarmView> {
  const now = Date.now()
  const [farm, profile, config, used] = await Promise.all([
    prisma.farm.findUnique({
      where: { userId },
      include: { plots: true, items: true },
    }),
    getPointsProfile(userId),
    getPointsConfig(),
    stealUsedToday(userId, now),
  ])

  const base = {
    catalog: FARM_CROPS,
    economy: economyDto(),
    points: profile.balance,
    stealQuota: {
      used,
      limit: config.farm.stealDailyLimit,
      remaining: Math.max(0, config.farm.stealDailyLimit - used),
    },
    recentSteals: await recentSteals(userId),
  }

  if (!farm) {
    return {
      ...base,
      farm: null,
      plots: [],
      inventory: { seeds: [], fertilizer: 0 },
    }
  }

  return {
    ...base,
    farm: {
      id: farm.id,
      name: farm.name,
      plotCount: farm.plotCount,
      tutorialDone: farm.tutorialDone,
      createdAt: farm.createdAt.toISOString(),
      harvested: farm.harvested,
      harvestPoints: farm.harvestPoints,
      stolenPoints: farm.stolenPoints,
    },
    plots: farm.plots
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((plot) => plotDto(plot, now)),
    inventory: { seeds: seedsOf(farm.items), fertilizer: fertilizerOf(farm.items) },
  }
}

/* ============================================================
   农场基础操作
   ============================================================ */

export async function createFarm(userId: number, name?: string): Promise<FarmView> {
  const config = await getPointsConfig()
  await prisma.$transaction(async (tx) => {
    const existing = await tx.farm.findUnique({ where: { userId }, select: { id: true } })
    if (existing) throw new AppError('你已经拥有农场了', 409)

    const farm = await tx.farm.create({
      data: {
        userId,
        name: (name?.trim() || '我的农场').slice(0, 20),
        plotCount: INITIAL_PLOT_COUNT,
      },
    })
    for (let index = 0; index < INITIAL_PLOT_COUNT; index += 1) {
      await tx.farmPlot.create({ data: { farmId: farm.id, index } })
    }
    for (const [key, count] of Object.entries(INITIAL_SEEDS)) {
      await tx.farmItem.create({ data: { farmId: farm.id, kind: 'seed', itemKey: key, count } })
    }
    await tx.farmItem.create({
      data: { farmId: farm.id, kind: 'fertilizer', itemKey: 'fertilizer', count: INITIAL_FERTILIZER },
    })
    if (config.farm.welcomePoints > 0) {
      await awardPointsTx(tx, userId, {
        amount: config.farm.welcomePoints,
        reason: 'farm_welcome',
        note: '农场开荒礼包',
      })
    }
  })
  return getFarmView(userId)
}

export async function renameFarm(userId: number, name: string): Promise<FarmView> {
  const clean = name.trim().slice(0, 20)
  if (!clean) throw new AppError('农场名字不能为空', 400)
  await prisma.farm.update({ where: { userId }, data: { name: clean } })
  return getFarmView(userId)
}

export async function expandFarm(userId: number): Promise<FarmView> {
  await prisma.$transaction(async (tx) => {
    const farm = await tx.farm.findUnique({ where: { userId } })
    if (!farm) throw new AppError('还没有农场，先开一块地吧', 404)
    const next = nextExpansion(farm.plotCount)
    if (!next) throw new AppError('农田已经是最大面积了', 400)
    await spendPointsTx(tx, userId, next.cost, { reason: 'farm_expand', note: `农田扩建至 ${next.plotCount} 块` })
    await tx.farm.update({ where: { userId }, data: { plotCount: next.plotCount } })
    for (let index = farm.plotCount; index < next.plotCount; index += 1) {
      await tx.farmPlot.upsert({
        where: { farmId_index: { farmId: farm.id, index } },
        create: { farmId: farm.id, index },
        update: {},
      })
    }
  })
  return getFarmView(userId)
}

export async function markTutorialDone(userId: number): Promise<void> {
  await prisma.farm.update({ where: { userId }, data: { tutorialDone: true } })
}

/* ============================================================
   商店（种子 / 肥料）
   ============================================================ */

export async function buyFarmItem(
  userId: number,
  input: { type: 'seed' | 'fertilizer'; key: string; count: number },
): Promise<FarmView> {
  const count = Math.trunc(input.count)
  if (!Number.isInteger(count) || count < 1 || count > 99) throw new AppError('购买数量需在 1–99 之间', 400)

  await prisma.$transaction(async (tx) => {
    const farm = await tx.farm.findUnique({ where: { userId } })
    if (!farm) throw new AppError('还没有农场，先开一块地吧', 404)

    let unitCost = 0
    let itemKey = ''
    if (input.type === 'fertilizer') {
      unitCost = FERTILIZER_COST
      itemKey = 'fertilizer'
    } else {
      const crop = getCrop(input.key)
      if (!crop) throw new AppError('未知的种子', 400)
      unitCost = crop.seedCost
      itemKey = crop.key
    }

    await spendPointsTx(tx, userId, unitCost * count, {
      reason: 'farm_shop',
      note: input.type === 'fertilizer' ? `肥料 ×${count}` : `${getCrop(itemKey)?.name ?? itemKey}种子 ×${count}`,
    })
    await tx.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId: farm.id, kind: input.type, itemKey } },
      create: { farmId: farm.id, kind: input.type, itemKey, count },
      update: { count: { increment: count } },
    })
  })
  return getFarmView(userId)
}

/* ============================================================
   地块操作
   ============================================================ */

async function loadPlotTx(tx: Db, userId: number, index: number) {
  const farm = await tx.farm.findUnique({ where: { userId }, include: { plots: true, items: true } })
  if (!farm) throw new AppError('还没有农场，先开一块地吧', 404)
  if (!Number.isInteger(index) || index < 0 || index >= farm.plotCount) {
    throw new AppError('地块不存在', 400)
  }
  const plot = farm.plots.find((row) => row.index === index)
  if (!plot) throw new AppError('地块不存在', 404)
  return { farm: farm as FarmWithRelations, plot }
}

export async function plantCrop(userId: number, index: number, cropKey: string): Promise<FarmView> {
  const crop = getCrop(cropKey)
  if (!crop) throw new AppError('未知的作物', 400)

  await prisma.$transaction(async (tx) => {
    const { farm, plot } = await loadPlotTx(tx, userId, index)
    if (plot.crop) throw new AppError('这块地已经有作物了', 400)

    const seed = farm.items.find((item) => item.kind === 'seed' && item.itemKey === crop.key)
    if (!seed || seed.count < 1) throw new AppError(`没有「${crop.name}」种子了，去商店买一些吧`, 400)

    if (seed.count === 1) {
      await tx.farmItem.delete({ where: { id: seed.id } })
    } else {
      await tx.farmItem.update({ where: { id: seed.id }, data: { count: { decrement: 1 } } })
    }

    const now = Date.now()
    await tx.farmPlot.update({
      where: { id: plot.id },
      data: {
        crop: crop.key,
        plantedAt: new Date(now),
        readyAt: new Date(now + crop.growMs),
        yieldUnits: crop.yieldUnits,
        stolenCount: 0,
        fertilized: 0,
      },
    })
  })
  return getFarmView(userId)
}

export async function fertilizePlot(userId: number, index: number): Promise<FarmView> {
  await prisma.$transaction(async (tx) => {
    const { farm, plot } = await loadPlotTx(tx, userId, index)
    if (!plot.crop) throw new AppError('这块地还没种东西', 400)
    if (plot.fertilized >= FERTILIZER_MAX_PER_CROP) throw new AppError('这茬作物已经施过两次肥了', 400)
    if (!plot.readyAt) throw new AppError('作物状态异常', 400)
    const now = Date.now()
    if (plot.readyAt.getTime() <= now) throw new AppError('作物已经成熟了，直接收获吧', 400)

    const fertilizer = farm.items.find((item) => item.kind === 'fertilizer')
    if (!fertilizer || fertilizer.count < 1) throw new AppError('没有肥料了，去商店买一些吧', 400)

    if (fertilizer.count === 1) {
      await tx.farmItem.delete({ where: { id: fertilizer.id } })
    } else {
      await tx.farmItem.update({ where: { id: fertilizer.id }, data: { count: { decrement: 1 } } })
    }
    await tx.farmPlot.update({
      where: { id: plot.id },
      data: {
        readyAt: fertilizeReadyAt(plot.readyAt, now),
        fertilized: { increment: 1 },
      },
    })
  })
  return getFarmView(userId)
}

export interface HarvestResult {
  view: FarmView
  crop: CropDef
  units: number
  points: number
  balance: number
}

export async function harvestPlot(userId: number, index: number): Promise<HarvestResult> {
  const now = Date.now()
  const result = await prisma.$transaction(async (tx) => {
    const { farm, plot } = await loadPlotTx(tx, userId, index)
    const crop = getCrop(plot.crop)
    if (!crop) throw new AppError('这块地还没有作物', 400)
    if (!plot.readyAt || plot.readyAt.getTime() > now) throw new AppError('作物还没成熟，再等等吧', 400)
    const units = Math.max(0, plot.yieldUnits)
    if (units <= 0) throw new AppError('这里已经没有可收获的作物了', 400)

    const points = cropUnitsValue(crop, units)
    const award = await awardPointsTx(tx, userId, {
      amount: points,
      reason: 'farm_harvest',
      game: 'farm',
      note: `${crop.name} ×${units}`,
    })
    await tx.farm.update({
      where: { id: farm.id },
      data: { harvested: { increment: 1 }, harvestPoints: { increment: points } },
    })
    await tx.farmPlot.update({
      where: { id: plot.id },
      data: {
        crop: null,
        plantedAt: null,
        readyAt: null,
        yieldUnits: 0,
        stolenCount: 0,
        fertilized: 0,
      },
    })
    return { crop, units, points, balance: award.balance }
  })
  return { view: await getFarmView(userId), ...result }
}

export async function clearPlot(userId: number, index: number): Promise<FarmView> {
  await prisma.$transaction(async (tx) => {
    const { plot } = await loadPlotTx(tx, userId, index)
    if (!plot.crop) throw new AppError('这块地本来就是空的', 400)
    await tx.farmPlot.update({
      where: { id: plot.id },
      data: {
        crop: null,
        plantedAt: null,
        readyAt: null,
        yieldUnits: 0,
        stolenCount: 0,
        fertilized: 0,
      },
    })
  })
  return getFarmView(userId)
}

/* ============================================================
   邻居与偷菜
   ============================================================ */

function publicPlotDto(plot: FarmPlot, now: number) {
  const crop = getCrop(plot.crop)
  const ready = !!crop && !!plot.readyAt && plot.readyAt.getTime() <= now
  return {
    index: plot.index,
    crop,
    readyAt: plot.readyAt ? plot.readyAt.toISOString() : null,
    yieldUnits: plot.yieldUnits,
    stolenCount: plot.stolenCount,
    ready,
    /** 至少有 2 单位才可偷，保证地主还有收成 */
    stealable: ready && plot.yieldUnits > 1,
    progress: crop && plot.plantedAt && plot.readyAt
      ? Math.min(1, Math.max(0, (now - plot.plantedAt.getTime()) / Math.max(1, plot.readyAt.getTime() - plot.plantedAt.getTime())))
      : 0,
  }
}

export interface FarmNeighborDto {
  userId: number
  username: string
  farmName: string
  plotCount: number
  readyCount: number
  stealableCount: number
  title: UserTitleDto | null
  updatedAt: string
}

export async function listNeighbors(userId: number, query?: string): Promise<FarmNeighborDto[]> {
  const now = Date.now()
  const q = query?.trim().slice(0, 30)
  const farms = await prisma.farm.findMany({
    where: {
      userId: { not: userId },
      user: {
        status: 'active',
        ...(q ? { username: { contains: q } } : {}),
      },
    },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          equippedTitle: { select: { id: true, type: true, name: true, payload: true } },
        },
      },
      plots: true,
    },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  })

  // 我已偷过的地块（按地块 + 本茬时间判断）
  const stolenByMe = await prisma.farmSteal.findMany({
    where: { thiefId: userId },
    select: { plotId: true, createdAt: true },
    orderBy: { id: 'desc' },
    take: 500,
  })

  const neighbors = farms.map((farm) => {
    let readyCount = 0
    let stealableCount = 0
    for (const plot of farm.plots) {
      if (!plot.crop || !plot.readyAt || plot.readyAt.getTime() > now) continue
      if (plot.yieldUnits <= 0) continue
      readyCount += 1
      if (plot.yieldUnits > 1 && !stolenByMe.some((row) =>
        row.plotId === plot.id && (!plot.plantedAt || row.createdAt >= plot.plantedAt))) {
        stealableCount += 1
      }
    }
    return {
      userId: farm.userId,
      username: farm.user.username,
      farmName: farm.name,
      plotCount: farm.plotCount,
      readyCount,
      stealableCount,
      title: toUserTitleDto(farm.user.equippedTitle),
      updatedAt: farm.updatedAt.toISOString(),
    }
  })

  return neighbors
    .sort((a, b) =>
      b.stealableCount - a.stealableCount
      || b.readyCount - a.readyCount
      || b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 12)
}

export interface NeighborFarmView {
  owner: {
    userId: number
    username: string
    title: UserTitleDto | null
  }
  farm: { name: string; plotCount: number; createdAt: string }
  plots: ReturnType<typeof publicPlotDto>[]
  quota: { used: number; limit: number; remaining: number }
}

export async function getNeighborFarm(userId: number, targetUserId: number): Promise<NeighborFarmView> {
  if (userId === targetUserId) throw new AppError('这是你自己的农场', 400)
  const config = await getPointsConfig()
  const now = Date.now()
  const [farm, used, stolenByMe] = await Promise.all([
    prisma.farm.findUnique({
      where: { userId: targetUserId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            equippedTitle: { select: { id: true, type: true, name: true, payload: true } },
          },
        },
        plots: true,
      },
    }),
    stealUsedToday(userId, now),
    prisma.farmSteal.findMany({
      where: { thiefId: userId },
      select: { plotId: true, createdAt: true },
      orderBy: { id: 'desc' },
      take: 500,
    }),
  ])
  if (!farm) throw new AppError('对方还没有开农场', 404)

  const plots = farm.plots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((plot) => {
      const dto = publicPlotDto(plot, now)
      const already = stolenByMe.some((row) =>
        row.plotId === plot.id && (!plot.plantedAt || row.createdAt >= plot.plantedAt))
      return {
        ...dto,
        stealable: dto.stealable && !already && used < config.farm.stealDailyLimit,
      }
    })

  return {
    owner: {
      userId: farm.user.id,
      username: farm.user.username,
      title: toUserTitleDto(farm.user.equippedTitle),
    },
    farm: { name: farm.name, plotCount: farm.plotCount, createdAt: farm.createdAt.toISOString() },
    plots,
    quota: {
      used,
      limit: config.farm.stealDailyLimit,
      remaining: Math.max(0, config.farm.stealDailyLimit - used),
    },
  }
}

export interface StealResult {
  points: number
  balance: number
  quota: { used: number; limit: number; remaining: number }
  plot: ReturnType<typeof publicPlotDto>
  crop: CropDef
}

export async function stealCrop(userId: number, targetUserId: number, index: number): Promise<StealResult> {
  if (userId === targetUserId) throw new AppError('不能偷自己的菜', 400)
  const config = await getPointsConfig()
  const now = Date.now()

  const result = await prisma.$transaction(async (tx) => {
    const farm = await tx.farm.findUnique({
      where: { userId: targetUserId },
      include: { plots: true, user: { select: { username: true } } },
    })
    if (!farm) throw new AppError('对方还没有开农场', 404)
    const plot = farm.plots.find((row) => row.index === index)
    if (!plot) throw new AppError('地块不存在', 404)
    const crop = getCrop(plot.crop)
    if (!crop) throw new AppError('这块地没有作物', 400)
    if (!plot.readyAt || plot.readyAt.getTime() > now) throw new AppError('作物还没成熟，偷不到', 400)
    if (plot.yieldUnits <= 1) throw new AppError('地主只剩最后一点收成了，手下留情吧', 400)

    const used = await tx.farmSteal.count({
      where: { thiefId: userId, createdAt: { gte: getTodayDayStart(now) } },
    })
    if (used >= config.farm.stealDailyLimit) {
      throw new AppError('今天的偷菜次数用完啦，明天再来', 429)
    }

    const already = await tx.farmSteal.findFirst({
      where: {
        thiefId: userId,
        plotId: plot.id,
        ...(plot.plantedAt ? { createdAt: { gte: plot.plantedAt } } : {}),
      },
      select: { id: true },
    })
    if (already) throw new AppError('这一茬你已经偷过了', 400)

    const points = computeStealPoints(crop, config.farm.stealRatio)
    const award = await awardPointsTx(tx, userId, {
      amount: points,
      reason: 'farm_steal',
      game: 'farm',
      note: `偷了 ${farm.user.username} 的${crop.name}`,
    })
    await tx.farmSteal.create({
      data: { thiefId: userId, victimId: targetUserId, plotId: plot.id, crop: crop.key, amount: 1, points },
    })
    await tx.farmPlot.update({
      where: { id: plot.id },
      data: { yieldUnits: { decrement: 1 }, stolenCount: { increment: 1 } },
    })
    await tx.farm.update({
      where: { id: farm.id },
      data: { stolenPoints: { increment: points } },
    })

    const updatedPlot = await tx.farmPlot.findUnique({ where: { id: plot.id } })
    return {
      points,
      balance: award.balance,
      quota: {
        used: used + 1,
        limit: config.farm.stealDailyLimit,
        remaining: Math.max(0, config.farm.stealDailyLimit - used - 1),
      },
      plot: publicPlotDto(updatedPlot ?? plot, now),
      crop,
    }
  })
  return result
}

/* ============================================================
   管理端辅助
   ============================================================ */

export function farmCatalog(): readonly CropDef[] {
  return FARM_CROPS
}

export async function farmAdminStats() {
  const [farms, totalPlanted, totalSteals] = await Promise.all([
    prisma.farm.count(),
    prisma.farmPlot.count({ where: { crop: { not: null } } }),
    prisma.farmSteal.count(),
  ])
  return { farms, totalPlanted, totalSteals }
}

/** 供管理端检查作物 key 合法（避免在 route 里重复 import） */
export function isCropKey(key: string): boolean {
  return CROP_MAP.has(key)
}
