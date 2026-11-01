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
  LOTTERY_COSTS,
  LOTTERY_PRIZE_LIST,
  LOTTERY_RARITY_LIST,
  PITY_LIMIT,
  TEN_DRAW_COUNT,
  nextPityAfterDraw,
  outfitFallbackPoints,
  pickPrize,
  rollPrizeAmount,
  sanitizeDrawCount,
  shouldTriggerPity,
  type LotteryPrize,
  type LotteryPrizeGroup,
  type LotteryPrizeType,
  type LotteryRarity,
  type LotteryRarityMeta,
} from '../lib/lottery.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'

type Db = Prisma.TransactionClient

const PRIZE_TYPES: readonly LotteryPrizeType[] = ['points', 'seed', 'fertilizer', 'outfit']
const RARITY_VALUES: readonly LotteryRarity[] = ['common', 'rare', 'epic', 'legendary']

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
}

export interface LotteryViewDto {
  balance: number
  costs: { single: number; ten: number }
  tenCount: number
  pity: LotteryPityDto
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
}> {
  const row = await prisma.lotteryAccount.upsert({
    where: { userId },
    create: { userId },
    update: {},
    select: { pity: true, totalDraws: true, lastFreeDate: true },
  })
  return row
}

/* ============================================================
   抽奖视图
   ============================================================ */

export async function getLotteryView(userId: number, now: number = Date.now()): Promise<LotteryViewDto> {
  const account = await ensureAccount(userId)
  const today = getTodayDateKey(now)

  const [user, history, common, rare, epic, legendary] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.lotteryDraw.findMany({
      where: { userId },
      orderBy: { id: 'desc' },
      take: 30,
    }),
    prisma.lotteryDraw.count({ where: { userId, rarity: 'common' } }),
    prisma.lotteryDraw.count({ where: { userId, rarity: 'rare' } }),
    prisma.lotteryDraw.count({ where: { userId, rarity: 'epic' } }),
    prisma.lotteryDraw.count({ where: { userId, rarity: 'legendary' } }),
  ])

  if (!user) throw new AppError('用户不存在', 404)

  return {
    balance: user.points,
    costs: { single: LOTTERY_COSTS.single, ten: LOTTERY_COSTS.ten },
    tenCount: TEN_DRAW_COUNT,
    pity: pityDto(account.pity),
    dailyFreeAvailable: account.lastFreeDate !== today,
    lastFreeDate: account.lastFreeDate,
    totalDraws: account.totalDraws,
    prizes: LOTTERY_PRIZE_LIST,
    rarities: LOTTERY_RARITY_LIST,
    history: history.map(historyItemDto),
    stats: { common, rare, epic, legendary },
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
      select: { pity: true, lastFreeDate: true },
    })

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
      dailyFreeUsed: freeEligible,
      cost,
    }
  })
}
