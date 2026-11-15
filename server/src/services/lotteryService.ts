import { randomInt } from 'node:crypto'
import type { LotteryDraw, Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  FARM_CROPS,
  INITIAL_FERTILIZER,
  INITIAL_PLOT_COUNT,
  INITIAL_SEEDS,
  pickWeighted,
  type CropDef,
} from '../lib/farmCrops.js'
import { PET_OUTFITS, type PetOutfitDef } from '../lib/petCatalog.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import {
  COLLECTIBLE_FALLBACK_POINTS,
  HIDDEN_TITLE_FALLBACK_POINTS,
  LOTTERY_COSTS,
  LOTTERY_DAILY_LIMIT,
  LOTTERY_PRIZE_LIST,
  LOTTERY_RARITY_LIST,
  PITY_LIMIT,
  TEN_DRAW_COUNT,
  canDrawWithinDaily,
  lotteryCollectiblePool,
  lotteryRaidItemPool,
  nextPityAfterDraw,
  outfitFallbackPoints,
  pickPrize,
  resolveDailyQuota,
  rollPrizeAmount,
  sanitizeDrawCount,
  shouldTriggerPity,
  type LotteryPrize,
  type LotteryPrizeGroup,
  type LotteryPrizeType,
  type LotteryRarity,
  type LotteryRarityMeta,
} from '../lib/lottery.js'
import { getRaidItem } from '../lib/raidRun.js'
import { awardPointsTx, spendPointsTx, toUserTitleDto } from './pointsService.js'
import { addCollectibleTx, collectibleCatalog } from './raidCollectionService.js'
import { grantRaidItemTx } from './raidStorageService.js'

type Db = Prisma.TransactionClient

const PRIZE_TYPES: readonly LotteryPrizeType[] = [
  'points', 'seed', 'fertilizer', 'outfit', 'raid_item', 'collectible', 'title',
]
const RARITY_VALUES: readonly LotteryRarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']

/* ============================================================
   DTO
   ============================================================ */

export interface LotteryPityDto {
  value: number
  limit: number
  /** 距保底还差几抽（最小 1） */
  remaining: number
}

export interface LotteryHistoryItemDto {
  id: number
  prizeKey: string
  prizeType: LotteryPrizeType
  prizeName: string
  rarity: LotteryRarity
  amount: number
  payload: Record<string, unknown>
  cost: number
  createdAt: string
}

export interface LotteryStatsDto {
  common: number
  rare: number
  epic: number
  legendary: number
  mythic: number
}

export interface LotteryDailyDto {
  limit: number
  used: number
  remaining: number
  dateKey: string
  /** 下一次重置（上海时区次日 0 点）的 ISO 时间 */
  resetsAt: string
}

export interface LotteryViewDto {
  balance: number
  costs: { single: number; ten: number }
  tenCount: number
  pity: LotteryPityDto
  daily: LotteryDailyDto
  dailyFreeAvailable: boolean
  lastFreeDate: string | null
  totalDraws: number
  prizes: readonly LotteryPrizeGroup[]
  rarities: readonly LotteryRarityMeta[]
  history: LotteryHistoryItemDto[]
  stats: LotteryStatsDto
}

export interface LotteryResultItemDto {
  prizeKey: string
  type: LotteryPrizeType
  name: string
  rarity: LotteryRarity
  amount: number
  payload: Record<string, unknown>
  /** 装扮折算成积分时为 true */
  converted: boolean
  convertedPoints: number
}

export interface LotteryDrawResultDto {
  balance: number
  results: LotteryResultItemDto[]
  pity: LotteryPityDto
  daily: LotteryDailyDto
  dailyFreeUsed: boolean
  cost: number
}

/* ============================================================
   工具
   ============================================================ */

/** 密码学随机数 → [0, 1)；抽奖结果不参与安全决策，但用 crypto 避免 Math.random 被预测 */
function secureRng(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(0.9999999999999999, Math.max(0, value))
}

function asPrizeType(value: string): LotteryPrizeType {
  return PRIZE_TYPES.includes(value as LotteryPrizeType) ? value as LotteryPrizeType : 'points'
}

function asRarity(value: string): LotteryRarity {
  return RARITY_VALUES.includes(value as LotteryRarity) ? value as LotteryRarity : 'common'
}

function parsePayload(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return {}
  } catch {
    return {}
  }
}

function pityDto(value: number): LotteryPityDto {
  const safe = Math.max(0, Math.trunc(value))
  return {
    value: safe,
    limit: PITY_LIMIT,
    remaining: Math.max(1, PITY_LIMIT - safe),
  }
}

/** 上海时区下一个 0 点的 ISO 时间（前端用于显示重置倒计时） */
function dailyResetsAt(now: number): string {
  const today = getTodayDateKey(now)
  const dayStart = new Date(`${today}T00:00:00+08:00`).getTime()
  return new Date(dayStart + 24 * 60 * 60 * 1000).toISOString()
}

function dailyDto(
  storedDateKey: string | null | undefined,
  storedDraws: number,
  now: number,
): LotteryDailyDto {
  const quota = resolveDailyQuota(storedDateKey, getTodayDateKey(now), storedDraws)
  return {
    limit: LOTTERY_DAILY_LIMIT,
    used: quota.used,
    remaining: quota.remaining,
    dateKey: quota.dateKey,
    resetsAt: dailyResetsAt(now),
  }
}

/**
 * 事务内原子占位当日 30 抽额度：
 *   1. 跨日（含 NULL）先把日期键重置为今天、计数归零；
 *   2. 条件 updateMany 只在剩余次数足够时递增，抢不到即抛 429 回滚整笔。
 * 返回占位后的当日已抽次数。
 */
async function claimDailyQuotaTx(
  tx: Db,
  userId: number,
  today: string,
  count: number,
): Promise<number> {
  await tx.lotteryAccount.updateMany({
    where: {
      userId,
      OR: [{ dailyDateKey: null }, { dailyDateKey: { not: today } }],
    },
    data: { dailyDateKey: today, dailyDraws: 0 },
  })
  const claimed = await tx.lotteryAccount.updateMany({
    where: {
      userId,
      dailyDateKey: today,
      dailyDraws: { lte: LOTTERY_DAILY_LIMIT - count },
    },
    data: { dailyDraws: { increment: count } },
  })
  if (claimed.count === 0) {
    throw new AppError(
      `今日抽奖次数已用完（${LOTTERY_DAILY_LIMIT} 抽/天，明日 0 点刷新）`,
      429,
      'LOTTERY_DAILY_LIMIT',
    )
  }
  const fresh = await tx.lotteryAccount.findUnique({
    where: { userId },
    select: { dailyDraws: true },
  })
  return fresh?.dailyDraws ?? count
}

function historyItemDto(row: LotteryDraw): LotteryHistoryItemDto {
  return {
    id: row.id,
    prizeKey: row.prizeKey,
    prizeType: asPrizeType(row.prizeType),
    prizeName: row.prizeName,
    rarity: asRarity(row.rarity),
    amount: row.amount,
    payload: parsePayload(row.payload),
    cost: row.cost,
    createdAt: row.createdAt.toISOString(),
  }
}

async function ensureAccount(userId: number): Promise<{
  pity: number
  totalDraws: number
  lastFreeDate: string | null
  dailyDateKey: string | null
  dailyDraws: number
}> {
  const row = await prisma.lotteryAccount.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: {
      pity: true,
      totalDraws: true,
      lastFreeDate: true,
      dailyDateKey: true,
      dailyDraws: true,
    },
  })
  return row
}

/* ============================================================
   抽奖视图
   ============================================================ */

export async function getLotteryView(userId: number, now: number = Date.now()): Promise<LotteryViewDto> {
  const account = await ensureAccount(userId)
  const today = getTodayDateKey(now)

  const [user, history, rarityRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.lotteryDraw.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      take: 30,
    }),
    prisma.lotteryDraw.groupBy({
      by: ['rarity'],
      where: { userId },
      _count: { _all: true },
    }),
  ])

  if (!user) throw new AppError('用户不存在', 404)

  const stats: LotteryStatsDto = {
    common: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0,
  }
  for (const row of rarityRows) {
    const rarity = asRarity(row.rarity)
    stats[rarity] += row._count._all
  }

  return {
    balance: user.points,
    costs: { single: LOTTERY_COSTS.single, ten: LOTTERY_COSTS.ten },
    tenCount: TEN_DRAW_COUNT,
    pity: pityDto(account.pity),
    daily: dailyDto(account.dailyDateKey, account.dailyDraws, now),
    dailyFreeAvailable: account.lastFreeDate !== today,
    lastFreeDate: account.lastFreeDate,
    totalDraws: account.totalDraws,
    prizes: LOTTERY_PRIZE_LIST,
    rarities: LOTTERY_RARITY_LIST,
    history: history.map(historyItemDto),
    stats,
  }
}

/* ============================================================
   发奖
   ============================================================ */

interface AwardedPrize {
  type: LotteryPrizeType
  name: string
  amount: number
  payload: Record<string, unknown>
  converted: boolean
  convertedPoints: number
}

/**
 * 确保用户有农场：没有时在同一事务内创建 Farm + 6 块地 + 新手种子 / 肥料。
 *
 * 刻意不调用 farmService.createFarm()：那条路径会发开荒积分（welcomePoints），
 * 抽奖附赠农场时发开荒积分等于白送，因此这里只建最小可用农场。
 */
async function ensureFarmTx(tx: Db, userId: number): Promise<number> {
  const farm = await tx.farm.upsert({
    where: { userId },
    create: {
      userId,
      plotCount: INITIAL_PLOT_COUNT,
      plots: {
        create: Array.from({ length: INITIAL_PLOT_COUNT }, (_, index) => ({ index })),
      },
      items: {
        create: [
          ...Object.entries(INITIAL_SEEDS).map(([itemKey, count]) => ({
            kind: 'seed',
            itemKey,
            count,
          })),
          { kind: 'fertilizer', itemKey: 'fertilizer', count: INITIAL_FERTILIZER },
        ],
      },
    },
    update: {},
    select: { id: true },
  })
  return farm.id
}

/** 种子按 tier / 最低价值过滤后，按「价值反比」加权：越便宜的种子越常见 */
function pickSeedCrop(prize: LotteryPrize, rng: () => number): CropDef {
  const tierMin = Number(prize.payload?.tierMin ?? 1)
  const tierMax = Number(prize.payload?.tierMax ?? tierMin)
  const minValue = Number(prize.payload?.minValue ?? 0)
  const pool = FARM_CROPS.filter((crop) => (
    crop.tier >= tierMin
    && crop.tier <= tierMax
    && crop.value >= minValue
  ))
  const picked = pickWeighted(pool, (crop) => 1 / Math.max(1, crop.value), rng)
  if (!picked) throw new AppError('抽奖奖池配置异常：没有可用的种子', 500)
  return picked
}

function pickOutfit(pool: readonly PetOutfitDef[], rng: () => number): PetOutfitDef {
  const index = Math.min(pool.length - 1, Math.floor(clampUnit(rng()) * pool.length))
  return pool[index]
}

async function awardPrizeTx(
  tx: Db,
  userId: number,
  prize: LotteryPrize,
  amount: number,
  rng: () => number,
): Promise<AwardedPrize> {
  if (prize.type === 'points') {
    await awardPointsTx(tx, userId, {
      amount,
      reason: 'lottery_prize',
      note: `抽奖·${prize.name}`,
    })
    return {
      type: 'points',
      name: prize.name,
      amount,
      payload: {},
      converted: false,
      convertedPoints: 0,
    }
  }

  if (prize.type === 'seed') {
    const crop = pickSeedCrop(prize, rng)
    const farmId = await ensureFarmTx(tx, userId)
    await tx.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId, kind: 'seed', itemKey: crop.key } },
      create: { farmId, kind: 'seed', itemKey: crop.key, count: amount },
      update: { count: { increment: amount } },
    })
    return {
      type: 'seed',
      name: `${crop.name}种子`,
      amount,
      payload: { cropKey: crop.key, cropName: crop.name, cropEmoji: crop.emoji },
      converted: false,
      convertedPoints: 0,
    }
  }

  if (prize.type === 'fertilizer') {
    const farmId = await ensureFarmTx(tx, userId)
    await tx.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId, kind: 'fertilizer', itemKey: 'fertilizer' } },
      create: { farmId, kind: 'fertilizer', itemKey: 'fertilizer', count: amount },
      update: { count: { increment: amount } },
    })
    return {
      type: 'fertilizer',
      name: prize.name,
      amount,
      payload: { itemKey: 'fertilizer' },
      converted: false,
      convertedPoints: 0,
    }
  }

  /* ---------- 搜打撤物资 ---------- */
  if (prize.type === 'raid_item') {
    const pool = lotteryRaidItemPool(prize)
    const picked = pickWeighted(pool, (item) => item.weight, rng)
    if (!picked) throw new AppError('抽奖奖池配置异常：没有可用的搜打撤物资', 500)
    const def = getRaidItem(picked.key)
    if (!def) throw new AppError('抽奖奖池配置异常：搜打撤物品不存在', 500)
    const granted = await grantRaidItemTx(tx, userId, def.key, amount)
    if (granted.stored) {
      return {
        type: 'raid_item',
        name: `${def.name} ×${amount}`,
        amount,
        payload: {
          itemKey: def.key,
          itemName: def.name,
          itemEmoji: def.emoji,
          raidRarity: def.rarity,
          stored: true,
        },
        converted: false,
        convertedPoints: 0,
      }
    }
    const fallback = Math.max(1, granted.convertedPoints)
    await awardPointsTx(tx, userId, {
      amount: fallback,
      reason: 'lottery_prize',
      note: `抽奖·${def.name}（仓库已满折算）`,
    })
    return {
      type: 'points',
      name: `${def.name}折算`,
      amount: fallback,
      payload: {
        originalPrizeKey: prize.key,
        originalType: 'raid_item',
        itemKey: def.key,
        itemName: def.name,
        itemEmoji: def.emoji,
        raidRarity: def.rarity,
        reason: 'warehouse-full',
      },
      converted: true,
      convertedPoints: fallback,
    }
  }

  /* ---------- 搜打撤藏品 ---------- */
  if (prize.type === 'collectible') {
    const room = await tx.raidCollectionRoom.findUnique({
      where: { userId },
      select: { collectibles: { select: { itemKey: true } } },
    })
    const ownedKeys = new Set((room?.collectibles ?? []).map((row) => row.itemKey))
    const pool = collectibleCatalog().filter((entry) => !ownedKeys.has(entry.key))
    const fallback = Number(prize.payload?.fallbackPoints) || COLLECTIBLE_FALLBACK_POINTS
    if (pool.length === 0 || lotteryCollectiblePool().length === 0) {
      await awardPointsTx(tx, userId, {
        amount: fallback,
        reason: 'lottery_prize',
        note: `抽奖·${prize.name}（已集齐折算）`,
      })
      return {
        type: 'points',
        name: `${prize.name}折算`,
        amount: fallback,
        payload: {
          originalPrizeKey: prize.key,
          originalType: 'collectible',
          reason: 'all-owned',
        },
        converted: true,
        convertedPoints: fallback,
      }
    }
    const picked = pickWeighted(pool, (entry) => entry.weight, rng) ?? pool[0]
    const result = await addCollectibleTx(tx, userId, picked.key, 'lottery')
    if (!result.created) {
      const duplicate = Math.max(1, result.duplicatePoints)
      await awardPointsTx(tx, userId, {
        amount: duplicate,
        reason: 'lottery_prize',
        note: `抽奖·重复藏品 ${result.def.name}`,
      })
      return {
        type: 'collectible',
        name: `${result.def.name}（重复）`,
        amount: 1,
        payload: {
          collectibleKey: result.def.key,
          collectibleName: result.def.name,
          collectibleEmoji: result.def.emoji,
          raidRarity: result.def.rarity,
          duplicate: true,
          duplicatePoints: duplicate,
        },
        converted: true,
        convertedPoints: duplicate,
      }
    }
    return {
      type: 'collectible',
      name: result.def.name,
      amount: 1,
      payload: {
        collectibleKey: result.def.key,
        collectibleName: result.def.name,
        collectibleEmoji: result.def.emoji,
        raidRarity: result.def.rarity,
        duplicate: false,
      },
      converted: false,
      convertedPoints: 0,
    }
  }

  /* ---------- 隐藏称号（不在商店出售） ---------- */
  if (prize.type === 'title') {
    const fallback = Number(prize.payload?.fallbackPoints) || HIDDEN_TITLE_FALLBACK_POINTS
    const candidates = await tx.pointsShopItem.findMany({
      where: {
        type: 'title',
        hidden: true,
        owners: { none: { userId } },
      },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })
    if (candidates.length === 0) {
      await awardPointsTx(tx, userId, {
        amount: fallback,
        reason: 'lottery_prize',
        note: `抽奖·${prize.name}（已集齐折算）`,
      })
      return {
        type: 'points',
        name: `${prize.name}折算`,
        amount: fallback,
        payload: {
          originalPrizeKey: prize.key,
          originalType: 'title',
          reason: 'all-owned',
        },
        converted: true,
        convertedPoints: fallback,
      }
    }
    const index = Math.min(candidates.length - 1, Math.floor(clampUnit(rng()) * candidates.length))
    const item = candidates[index]
    const title = toUserTitleDto(item)
    await tx.userPointsItem.create({ data: { userId, itemId: item.id } })
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { equippedTitleId: true },
    })
    if (!user?.equippedTitleId) {
      await tx.user.update({
        where: { id: userId },
        data: { equippedTitleId: item.id, equippedLeaderTitleId: null },
      })
    }
    return {
      type: 'title',
      name: `隐藏称号·${item.name}`,
      amount: 1,
      payload: {
        titleKey: item.key,
        titleId: item.id,
        titleName: item.name,
        titleIcon: title?.icon ?? '',
        titleColor: title?.color ?? '#57606a',
        titleRarity: item.rarity,
        titleEffect: title?.effect ?? 'classic',
        hidden: true,
      },
      converted: false,
      convertedPoints: 0,
    }
  }

  /* ---------- 宠物装扮 ---------- */
  const configuredFallback = Number(prize.payload?.fallbackPoints)
  const fallback = Number.isFinite(configuredFallback) && configuredFallback > 0
    ? Math.trunc(configuredFallback)
    : outfitFallbackPoints(prize.rarity)

  const convertToPoints = async (reason: 'no-pet' | 'all-owned'): Promise<AwardedPrize> => {
    const note = reason === 'no-pet'
      ? `抽奖·${prize.name}（无宠物折算）`
      : `抽奖·${prize.name}（已集齐折算）`
    await awardPointsTx(tx, userId, { amount: fallback, reason: 'lottery_prize', note })
    return {
      type: 'points',
      name: `${prize.name}折算`,
      amount: fallback,
      payload: {
        originalPrizeKey: prize.key,
        originalType: 'outfit',
        reason,
      },
      converted: true,
      convertedPoints: fallback,
    }
  }

  const pet = await tx.pet.findUnique({
    where: { userId },
    select: { id: true, status: true },
  })
  if (!pet || pet.status !== 'alive') return convertToPoints('no-pet')

  const owned = await tx.petOutfit.findMany({
    where: { petId: pet.id },
    select: { outfitKey: true },
  })
  const ownedKeys = new Set(owned.map((row) => row.outfitKey))
  // 史诗与传说都优先发「未拥有」的装扮：重复发同一件在 UI 上等于空奖。
  const pool = PET_OUTFITS.filter((outfit) => !ownedKeys.has(outfit.key))
  if (pool.length === 0) return convertToPoints('all-owned')

  const outfit = pickOutfit(pool, rng)
  await tx.petOutfit.create({ data: { petId: pet.id, outfitKey: outfit.key } })
  return {
    type: 'outfit',
    name: outfit.name,
    amount: 1,
    payload: {
      outfitKey: outfit.key,
      outfitName: outfit.name,
      outfitSlot: outfit.slot,
      outfitEmoji: outfit.emoji,
    },
    converted: false,
    convertedPoints: 0,
  }
}

/* ============================================================
   抽奖
   ============================================================ */

/**
 * 扣费 + 发奖 + 写记录在同一事务内完成：
 *   - 单抽每日首抽免费（免费抽仍写一条 cost=0 的记录）
 *   - 十连逐抽结算，保底跨抽累计，任一抽失败整体回滚
 *   - 事务内用 crypto 随机数；纯函数层（lib/lottery.ts）另可注入 rng 自检
 */
export async function drawLottery(
  userId: number,
  rawCount: unknown,
  now: number = Date.now(),
): Promise<LotteryDrawResultDto> {
  const count = sanitizeDrawCount(rawCount)
  if (!count) throw new AppError('抽奖次数只能是 1 或 10', 400, 'LOTTERY_BAD_COUNT')

  const today = getTodayDateKey(now)
  // 事务外先确保账户行存在：避免首次并发的 upsert 唯一键竞争
  await ensureAccount(userId)

  return prisma.$transaction(async (tx) => {
    // 事务内 upsert：并发首次抽奖也只建一行账户
    const account = await tx.lotteryAccount.upsert({
      where: { userId },
      create: { userId },
      update: {},
      select: {
        pity: true,
        lastFreeDate: true,
        dailyDateKey: true,
        dailyDraws: true,
      },
    })

    // 每日 30 抽：先把本笔完整占位；不足即 429 并回滚整笔（不扣费 / 不占免费）
    const dailyUsed = await claimDailyQuotaTx(tx, userId, today, count)

    // 免费只对单抽生效；十连永远付费。
    // 用条件 updateMany 原子「抢占」当日免费次数，避免两个并发请求都读到未使用状态。
    let freeEligible = false
    if (count === 1 && account.lastFreeDate !== today) {
      const claimed = await tx.lotteryAccount.updateMany({
        where: {
          userId,
          OR: [{ lastFreeDate: null }, { lastFreeDate: { not: today } }],
        },
        data: { lastFreeDate: today },
      })
      freeEligible = claimed.count > 0
    }
    const cost = freeEligible ? 0 : count === 1 ? LOTTERY_COSTS.single : LOTTERY_COSTS.ten

    if (cost > 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
      if (!user) throw new AppError('用户不存在', 404)
      if (user.points < cost) {
        throw new AppError('积分不足', 400, 'LOTTERY_INSUFFICIENT_POINTS')
      }
      await spendPointsTx(tx, userId, cost, {
        reason: 'lottery_draw',
        note: count === 10 ? '十连抽' : '单抽',
      })
    }

    let pity = Math.max(0, Math.trunc(account.pity))
    const results: LotteryResultItemDto[] = []
    const rng = secureRng
    const costPerDraw = Math.floor(cost / count)
    const costRemainder = cost - costPerDraw * count

    for (let index = 0; index < count; index += 1) {
      // 第 10 抽未出史诗时直接从「史诗 + 传说」池抽取，保证保底真实到账
      const prize = shouldTriggerPity(pity)
        ? pickPrize(rng, { minRarity: 'epic' })
        : pickPrize(rng)
      const amount = rollPrizeAmount(prize, rng)
      const awarded = await awardPrizeTx(tx, userId, prize, amount, rng)

      pity = nextPityAfterDraw(pity, prize)

      const drawCost = cost === 0 ? 0 : costPerDraw + (index === 0 ? costRemainder : 0)
      await tx.lotteryDraw.create({
        data: {
          userId,
          prizeKey: prize.key,
          prizeType: awarded.type,
          prizeName: awarded.name,
          rarity: prize.rarity,
          amount: awarded.amount,
          payload: Object.keys(awarded.payload).length > 0
            ? JSON.stringify(awarded.payload)
            : null,
          cost: drawCost,
        },
      })

      results.push({
        prizeKey: prize.key,
        type: awarded.type,
        name: awarded.name,
        rarity: prize.rarity,
        amount: awarded.amount,
        payload: awarded.payload,
        converted: awarded.converted,
        convertedPoints: awarded.convertedPoints,
      })
    }

    await tx.lotteryAccount.update({
      where: { userId },
      data: {
        pity,
        // 原子自增，避免并发的两笔抽奖互相覆盖累计次数
        totalDraws: { increment: count },
      },
    })

    const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })

    return {
      balance: user?.points ?? 0,
      results,
      pity: pityDto(pity),
      daily: {
        limit: LOTTERY_DAILY_LIMIT,
        used: dailyUsed,
        remaining: Math.max(0, LOTTERY_DAILY_LIMIT - dailyUsed),
        dateKey: today,
        resetsAt: dailyResetsAt(now),
      },
      dailyFreeUsed: freeEligible,
      cost,
    }
  })
}
