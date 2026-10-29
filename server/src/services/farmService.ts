import prisma from '../lib/prisma.js'
import type { Farm, FarmItem, FarmMerchantOffer, FarmPlot, Prisma } from '@prisma/client'
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
  pickDailySeed,
  pickMerchantOffers,
  rollStealSuccess,
  type CropDef,
} from '../lib/farmCrops.js'
import { getTodayDateKey, getTodayDayStart, type PointsConfigDto } from '../lib/pointsRules.js'
import {
  awardPointsTx,
  getPointsConfig,
  getPointsProfile,
  spendPointsTx,
  effectiveTitleDto,
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

/** 某位地主今天已经被偷走的次数（含所有小偷） */
async function victimStealUsedToday(userId: number, now: number): Promise<number> {
  return prisma.farmSteal.count({
    where: { victimId: userId, createdAt: { gte: getTodayDayStart(now) } },
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

export interface StealQuotaDto {
  used: number
  limit: number
  remaining: number
}

function quotaDto(used: number, limit: number): StealQuotaDto {
  return { used, limit, remaining: Math.max(0, limit - used) }
}

export interface SeedDropItemDto {
  key: string
  name: string
  emoji: string
  count: number
}

export interface SeedDropDto {
  /** 本次请求是否触发了当日掉落（同一天只有第一次为 true） */
  dropped: boolean
  seeds: SeedDropItemDto[]
}

const EMPTY_SEED_DROP: SeedDropDto = { dropped: false, seeds: [] }

/**
 * 每日随机掉落种子。
 *
 * 用 `lastSeedDropDate` 做条件更新（CAS）抢占当天的掉落资格：并发或重复请求
 * 只有第一次 `count === 1`，其余直接返回未掉落，因此同一天不会重复发放。
 */
async function ensureSeedDrop(
  farm: { id: number },
  config: PointsConfigDto,
  rng: () => number = Math.random,
): Promise<SeedDropDto> {
  const max = config.farm.seedDropMax
  if (max <= 0) return EMPTY_SEED_DROP
  const today = getTodayDateKey()
  const claimed = await prisma.farm.updateMany({
    where: {
      id: farm.id,
      OR: [{ lastSeedDropDate: null }, { lastSeedDropDate: { not: today } }],
    },
    data: { lastSeedDropDate: today },
  })
  if (claimed.count !== 1) return EMPTY_SEED_DROP

  const total = 1 + Math.floor(rng() * max)
  const stacks = new Map<string, SeedDropItemDto>()
  for (let i = 0; i < total; i += 1) {
    const crop = pickDailySeed(rng)
    if (!crop) continue
    const existing = stacks.get(crop.key)
    if (existing) {
      existing.count += 1
    } else {
      stacks.set(crop.key, { key: crop.key, name: crop.name, emoji: crop.emoji, count: 1 })
    }
  }

  for (const seed of stacks.values()) {
    await prisma.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId: farm.id, kind: 'seed', itemKey: seed.key } },
      create: { farmId: farm.id, kind: 'seed', itemKey: seed.key, count: seed.count },
      update: { count: { increment: seed.count } },
    })
  }

  return { dropped: true, seeds: [...stacks.values()] }
}

/* ============================================================
   随机商人
   ============================================================ */

export interface MerchantOfferDto {
  id: number
  itemKind: 'seed' | 'fertilizer'
  itemKey: string
  name: string
  emoji: string
  count: number
  price: number
  originalPrice: number
  discountPct: number
  purchased: boolean
}

export interface MerchantBundleDto {
  dateKey: string
  offers: MerchantOfferDto[]
}

function merchantOfferDto(row: FarmMerchantOffer): MerchantOfferDto {
  const isFertilizer = row.itemKind === 'fertilizer'
  const crop = isFertilizer ? null : getCrop(row.itemKey)
  return {
    id: row.id,
    itemKind: isFertilizer ? 'fertilizer' : 'seed',
    itemKey: row.itemKey,
    name: isFertilizer ? '肥料' : crop?.name ?? row.itemKey,
    emoji: isFertilizer ? '💧' : crop?.emoji ?? '🌱',
    count: row.count,
    price: row.price,
    originalPrice: row.originalPrice,
    discountPct: row.discountPct,
    purchased: row.purchased,
  }
}

/**
 * 取当天商人商品；当天第一次访问时生成。
 *
 * 唯一键 `(farmId, dateKey, itemKind, itemKey)` + upsert 兜住并发
 * （SQLite 不支持 createMany + skipDuplicates），因此即使两个请求同时生成，
 * 也只会留下同一批商品，先写入的价格不会被覆盖。
 */
async function ensureMerchantOffers(
  farm: { id: number },
  config: PointsConfigDto,
  now: number,
): Promise<MerchantBundleDto> {
  const dateKey = getTodayDateKey(now)
  const load = () => prisma.farmMerchantOffer.findMany({
    where: { farmId: farm.id, dateKey },
    orderBy: { id: 'asc' },
  })
  let rows = await load()
  if (rows.length === 0 && config.farm.merchantCount > 0) {
    const drafts = pickMerchantOffers({
      count: config.farm.merchantCount,
      minDiscount: config.farm.merchantDiscountMin,
      maxDiscount: config.farm.merchantDiscountMax,
    })
    for (const draft of drafts) {
      try {
        await prisma.farmMerchantOffer.upsert({
          where: {
            farmId_dateKey_itemKind_itemKey: {
              farmId: farm.id,
              dateKey,
              itemKind: draft.itemKind,
              itemKey: draft.itemKey,
            },
          },
          create: { farmId: farm.id, dateKey, ...draft },
          update: {},
        })
      } catch (error) {
        // 并发下另一个请求已写入同一件商品，直接跳过
        if ((error as { code?: string }).code !== 'P2002') throw error
      }
    }
    rows = await load()
  }
  return { dateKey, offers: rows.map(merchantOfferDto) }
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
  stealQuota: StealQuotaDto
  /** 自己今天已被偷的次数（达到上限后别人偷不到） */
  victimQuota: StealQuotaDto
  /** 每日随机掉落种子（同一天只有一次 dropped=true） */
  seedDrop: SeedDropDto
  /** 今日随机商人（每日 0 点刷新） */
  merchant: MerchantBundleDto
  recentSteals: Awaited<ReturnType<typeof recentSteals>>
}

/* ============================================================
   读取
   ============================================================ */

export async function getFarmView(userId: number): Promise<FarmView> {
  const now = Date.now()
  const [farm, profile, config, used, victimUsed] = await Promise.all([
    prisma.farm.findUnique({
      where: { userId },
      include: { plots: true, items: true },
    }),
    getPointsProfile(userId),
    getPointsConfig(),
    stealUsedToday(userId, now),
    victimStealUsedToday(userId, now),
  ])

  const base = {
    catalog: FARM_CROPS,
    economy: economyDto(),
    points: profile.balance,
    stealQuota: quotaDto(used, config.farm.stealDailyLimit),
    victimQuota: quotaDto(victimUsed, config.farm.victimDailyStealLimit),
    recentSteals: await recentSteals(userId),
  }

  if (!farm) {
    return {
      ...base,
      farm: null,
      plots: [],
      inventory: { seeds: [], fertilizer: 0 },
      seedDrop: EMPTY_SEED_DROP,
      merchant: { dateKey: getTodayDateKey(now), offers: [] },
    }
  }

  const seedDrop = await ensureSeedDrop(farm, config)
  const merchant = await ensureMerchantOffers(farm, config, now)
  // 掉落会写入新的 FarmItem，需要重新取一次仓库
  const items = seedDrop.dropped
    ? await prisma.farmItem.findMany({ where: { farmId: farm.id } })
    : farm.items

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
    inventory: { seeds: seedsOf(items), fertilizer: fertilizerOf(items) },
    seedDrop,
    merchant,
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

export interface MerchantPurchaseResult {
  view: FarmView
  offer: MerchantOfferDto
  balance: number
}

/** 购买商人特价商品：只能买当天、只能买一次 */
export async function buyMerchantOffer(userId: number, offerId: number): Promise<MerchantPurchaseResult> {
  const today = getTodayDateKey()
  const result = await prisma.$transaction(async (tx) => {
    const offer = await tx.farmMerchantOffer.findUnique({
      where: { id: offerId },
      include: { farm: { select: { id: true, userId: true } } },
    })
    if (!offer || offer.farm.userId !== userId) throw new AppError('这件商品不存在', 404)
    if (offer.dateKey !== today) {
      throw new AppError('这件商品已经过期了，明天再来看看吧', 410, 'MERCHANT_EXPIRED')
    }
    const claimed = await tx.farmMerchantOffer.updateMany({
      where: { id: offer.id, purchased: false },
      data: { purchased: true },
    })
    if (claimed.count !== 1) {
      throw new AppError('这件商品已经买过了', 409, 'MERCHANT_SOLD_OUT')
    }
    const dto = merchantOfferDto(offer)
    const spend = await spendPointsTx(tx, userId, offer.price, {
      reason: 'farm_merchant',
      game: 'farm',
      note: `商人特价：${dto.name} ×${offer.count}`,
    })
    await tx.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId: offer.farm.id, kind: offer.itemKind, itemKey: offer.itemKey } },
      create: {
        farmId: offer.farm.id,
        kind: offer.itemKind,
        itemKey: offer.itemKey,
        count: offer.count,
      },
      update: { count: { increment: offer.count } },
    })
    return { offer: { ...dto, purchased: true }, balance: spend.balance }
  })
  return { view: await getFarmView(userId), ...result }
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
  /** 该邻居今天已被偷的次数 */
  victimQuota: StealQuotaDto
  title: UserTitleDto | null
  updatedAt: string
}

export async function listNeighbors(userId: number, query?: string): Promise<FarmNeighborDto[]> {
  const now = Date.now()
  const dayStart = getTodayDayStart(now)
  const config = await getPointsConfig()
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
          equippedTitle: { select: { id: true, type: true, name: true, payload: true, rarity: true } },
          equippedLeaderTitle: { select: { id: true, game: true, userId: true } },
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

  // 各邻居今天的被偷次数（一次聚合，避免逐个 count）
  const victimIdList = farms.map((farm) => farm.userId)
  const victimCounts = victimIdList.length > 0
    ? await prisma.farmSteal.groupBy({
        by: ['victimId'],
        where: { victimId: { in: victimIdList }, createdAt: { gte: dayStart } },
        _count: { _all: true },
      })
    : []
  const victimUsedMap = new Map(victimCounts.map((row) => [row.victimId, row._count._all]))

  const neighbors = farms.map((farm) => {
    const victimUsed = victimUsedMap.get(farm.userId) ?? 0
    const victimQuota = quotaDto(victimUsed, config.farm.victimDailyStealLimit)
    const victimCapped = victimUsed >= config.farm.victimDailyStealLimit
    let readyCount = 0
    let stealableCount = 0
    for (const plot of farm.plots) {
      if (!plot.crop || !plot.readyAt || plot.readyAt.getTime() > now) continue
      if (plot.yieldUnits <= 0) continue
      readyCount += 1
      if (!victimCapped && plot.yieldUnits > 1 && !stolenByMe.some((row) =>
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
      victimQuota,
      title: effectiveTitleDto(farm.user),
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
  /** 我的偷菜额度 */
  quota: StealQuotaDto
  /** 地主今天已被偷的次数（达到上限后不可再偷） */
  victimQuota: StealQuotaDto
}

export async function getNeighborFarm(userId: number, targetUserId: number): Promise<NeighborFarmView> {
  if (userId === targetUserId) throw new AppError('这是你自己的农场', 400)
  const config = await getPointsConfig()
  const now = Date.now()
  const [farm, used, victimUsed, stolenByMe] = await Promise.all([
    prisma.farm.findUnique({
      where: { userId: targetUserId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            equippedTitle: { select: { id: true, type: true, name: true, payload: true, rarity: true } },
            equippedLeaderTitle: { select: { id: true, game: true, userId: true } },
          },
        },
        plots: true,
      },
    }),
    stealUsedToday(userId, now),
    victimStealUsedToday(targetUserId, now),
    prisma.farmSteal.findMany({
      where: { thiefId: userId },
      select: { plotId: true, createdAt: true },
      orderBy: { id: 'desc' },
      take: 500,
    }),
  ])
  if (!farm) throw new AppError('对方还没有开农场', 404)

  const quota = quotaDto(used, config.farm.stealDailyLimit)
  const victimQuota = quotaDto(victimUsed, config.farm.victimDailyStealLimit)
  const victimCapped = victimUsed >= config.farm.victimDailyStealLimit

  const plots = farm.plots
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((plot) => {
      const dto = publicPlotDto(plot, now)
      const already = stolenByMe.some((row) =>
        row.plotId === plot.id && (!plot.plantedAt || row.createdAt >= plot.plantedAt))
      return {
        ...dto,
        stealable: dto.stealable && !already && used < config.farm.stealDailyLimit && !victimCapped,
      }
    })

  return {
    owner: {
      userId: farm.user.id,
      username: farm.user.username,
      title: effectiveTitleDto(farm.user),
    },
    farm: { name: farm.name, plotCount: farm.plotCount, createdAt: farm.createdAt.toISOString() },
    plots,
    quota,
    victimQuota,
  }
}

export interface StealSuccess {
  success: true
  points: number
  balance: number
  quota: StealQuotaDto
  victimQuota: StealQuotaDto
  plot: ReturnType<typeof publicPlotDto>
  crop: CropDef
}

/** 偷菜失败：HTTP 200 返回，不消耗额度、不写偷菜记录 */
export interface StealFailure {
  success: false
  message: string
  quota: StealQuotaDto
  victimQuota: StealQuotaDto
  plot: ReturnType<typeof publicPlotDto>
  crop: CropDef
}

export type StealResult = StealSuccess | StealFailure

export async function stealCrop(userId: number, targetUserId: number, index: number): Promise<StealResult> {
  if (userId === targetUserId) throw new AppError('不能偷自己的菜', 400)
  const config = await getPointsConfig()
  const now = Date.now()
  const dayStart = getTodayDayStart(now)

  const result = await prisma.$transaction(async (tx): Promise<StealResult> => {
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

    const [used, victimUsed] = await Promise.all([
      tx.farmSteal.count({ where: { thiefId: userId, createdAt: { gte: dayStart } } }),
      tx.farmSteal.count({ where: { victimId: targetUserId, createdAt: { gte: dayStart } } }),
    ])
    if (used >= config.farm.stealDailyLimit) {
      throw new AppError('今天的偷菜次数用完啦，明天再来', 429, 'STEAL_LIMIT')
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

    const quota = quotaDto(used, config.farm.stealDailyLimit)
    const victimQuota = quotaDto(victimUsed, config.farm.victimDailyStealLimit)

    // 概率判定：失败直接返回（不写库、不扣额度、不减少产量）
    if (!rollStealSuccess(config.farm.stealSuccessRate)) {
      return {
        success: false,
        message: '被地主家的狗发现了，这次没偷到',
        quota,
        victimQuota,
        plot: publicPlotDto(plot, now),
        crop,
      }
    }

    // 地主今日被偷次数上限（0 = 全天不可被偷）
    if (victimUsed >= config.farm.victimDailyStealLimit) {
      throw new AppError('对方今天的菜已经被偷够啦，明天早点来', 429, 'VICTIM_STEAL_LIMIT')
    }

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
      success: true,
      points,
      balance: award.balance,
      quota: quotaDto(used + 1, config.farm.stealDailyLimit),
      victimQuota: quotaDto(victimUsed + 1, config.farm.victimDailyStealLimit),
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
