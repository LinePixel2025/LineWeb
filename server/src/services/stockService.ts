/**
 * 模拟股市交易服务：用统一积分按实时价买入 / 卖出虚构股票。
 *
 * 2026-11 重构后的口径：
 * - 行情每 3 秒推进一个 tick（stockTicks.ts），玩家交易会明显影响价格
 *   （买入推高 / 卖出压低，15 分钟半衰期，上限 ±25%），冲击状态经 SiteSetting 持久化；
 * - 成交价包含「本笔交易自身冲击」的滑点：大额买入越买越贵、大额卖出越卖越便宜，
 *   因此买入拉高后立刻卖出无法套利；
 * - 不再有每日分红 / 隔夜持仓（已删除），持仓只按实时价计算浮盈；
 * - 成交记录：买卖各写一行 StockTrade（append-only），已实现盈亏从卖出行汇总；
 * - 所有积分变动写 PointsLedger（reason = stock_buy / stock_sell），可审计。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { STOCK_DEFINITIONS } from '../lib/stockMarket.js'
import {
  IMPACT_STATE_SETTING_KEY,
  STOCK_IMPACT_PER_POINT,
  applyTradeImpactDelta,
  clampImpact,
  getImpact,
  getLiveExecutionPrice,
  getLiveQuote,
  getLiveQuoteByCode,
  loadImpactStateFromJson,
  markImpactPersisted,
  serializeImpactState,
} from '../lib/stockTicks.js'
import {
  STOCK_MAX_INVEST,
  STOCK_MIN_INVEST,
  executionPriceWithImpact,
  positionMarketValue,
  positionProfit,
  positionProfitPct,
  quoteStockBuy,
  quoteStockSell,
  splitCostForShares,
  totalAssets,
} from '../lib/stockTrading.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'

export interface StockHoldingDto {
  code: string
  name: string
  sector: string
  color: string
  price: number
  prevClose: number
  changePct: number
  /** 持有份额 */
  shares: number
  /** 累计投入积分（含买入手续费） */
  costPoints: number
  /** 按现价计算的市值（整数积分） */
  marketValue: number
  /** 浮动盈亏（积分） */
  profit: number
  profitPct: number
}

export interface StockAccountSummaryDto {
  /** 累计已实现盈亏（卖出行 profit 汇总，可正可负） */
  realizedPoints: number
  /** 总资产 = 积分余额 + 持仓市值 */
  totalAssets: number
}

export interface StockPortfolioDto {
  dateKey: string
  balance: number
  account: StockAccountSummaryDto
  summary: {
    costPoints: number
    marketValue: number
    profit: number
    profitPct: number
    positions: number
    /** 已实现盈亏（卖出结算的累计值） */
    realizedProfit: number
  }
  holdings: StockHoldingDto[]
}

/* ============================================================
   冲击状态恢复（进程内一次性）
   ============================================================ */

let impactLoadPromise: Promise<void> | null = null

/**
 * 重启后从 SiteSetting 恢复股价冲击状态（进程内一次性；失败不阻塞行情，重置为 0 不重试）。
 * 用 in-flight Promise 保证并发首请求共享同一次加载，避免加载完成前以 impact=0 成交、
 * 随后又被恢复逻辑 clear() 抹掉交易冲击。
 */
export function ensureImpactLoaded(): Promise<void> {
  if (!impactLoadPromise) {
    impactLoadPromise = (async () => {
      try {
        const row = await prisma.siteSetting.findUnique({ where: { key: IMPACT_STATE_SETTING_KEY } })
        loadImpactStateFromJson(row?.value ?? null, Date.now())
      } catch (error) {
        loadImpactStateFromJson(null, Date.now())
        console.warn('[stockService] 读取股价冲击状态失败，已重置为 0：', error)
      }
    })()
  }
  return impactLoadPromise
}

/** 把当前冲击状态写进 SiteSetting（必须在交易事务内调用） */
async function persistImpactTx(tx: Prisma.TransactionClient, nowMs: number): Promise<void> {
  const value = serializeImpactState(nowMs)
  await tx.siteSetting.upsert({
    where: { key: IMPACT_STATE_SETTING_KEY },
    update: { value },
    create: { key: IMPACT_STATE_SETTING_KEY, value },
  })
  markImpactPersisted()
}

/** 本笔买入会写入的冲击增量（已按上限夹紧） */
function buyImpactDelta(code: string, points: number, now: number): number {
  const current = getImpact(code, now)
  const projected = clampImpact(current + points * STOCK_IMPACT_PER_POINT)
  return projected - current
}

/** 本笔卖出会写入的冲击增量（已按上限夹紧，符号为负） */
function sellImpactDelta(code: string, grossEstimate: number, now: number): number {
  const current = getImpact(code, now)
  const projected = clampImpact(current - grossEstimate * STOCK_IMPACT_PER_POINT)
  return projected - current
}

/* ============================================================
   持仓 / 账户
   ============================================================ */

function holdingDtoOf(
  row: { code: string; shares: number; costPoints: number },
  now: number,
): StockHoldingDto | null {
  const quote = getLiveQuoteByCode(row.code, now)
  if (!quote) return null
  const marketValue = positionMarketValue(row.shares, quote.price)
  return {
    code: row.code,
    name: quote.name,
    sector: quote.sector,
    color: quote.color,
    price: quote.price,
    prevClose: quote.prevClose,
    changePct: quote.changePct,
    shares: Math.round(row.shares * 10_000) / 10_000,
    costPoints: row.costPoints,
    marketValue,
    profit: positionProfit(marketValue, row.costPoints),
    profitPct: positionProfitPct(marketValue, row.costPoints),
  }
}

/** 当前用户持仓 + 账户汇总（按市值倒序，报价用实时价） */
export async function getStockPortfolio(userId: number): Promise<StockPortfolioDto> {
  const dateKey = getTodayDateKey()
  await ensureImpactLoaded()
  const now = Date.now()

  const [user, rows, realized] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.stockHolding.findMany({ where: { userId } }),
    prisma.stockTrade.aggregate({
      where: { userId, side: 'sell' },
      _sum: { profit: true },
    }),
  ])

  const holdings: StockHoldingDto[] = []
  for (const row of rows) {
    const dto = holdingDtoOf(row, now)
    if (dto) holdings.push(dto)
  }
  holdings.sort((a, b) => b.marketValue - a.marketValue)

  const totalCost = holdings.reduce((sum, row) => sum + row.costPoints, 0)
  const totalValue = holdings.reduce((sum, row) => sum + row.marketValue, 0)
  const balance = user?.points ?? 0
  const realizedPoints = realized._sum.profit ?? 0

  return {
    dateKey,
    balance,
    account: {
      realizedPoints,
      totalAssets: totalAssets(balance, totalValue),
    },
    summary: {
      costPoints: totalCost,
      marketValue: totalValue,
      profit: totalValue - totalCost,
      profitPct: positionProfitPct(totalValue, totalCost),
      positions: holdings.length,
      realizedProfit: realizedPoints,
    },
    holdings,
  }
}

export interface StockBuyResult {
  balance: number
  holding: StockHoldingDto
  trade: {
    code: string
    name: string
    price: number
    /** 本笔成交冲击（带符号，买入为正；0.01 = +1%） */
    impactPct: number
    points: number
    fee: number
    shares: number
  }
}

/**
 * 买入（可分批加仓）：积分不足 / 金额越界由 spendPointsTx 与参数校验拦截。
 * 成交价 = 含本笔冲击的执行价（滑点）；随后把冲击写入内存并落盘。
 * 锁序：User（spend）→ Holding（upsert）→ SiteSetting（冲击落盘）→ StockTrade（append）。
 */
export async function buyStock(userId: number, code: string, points: number): Promise<StockBuyResult> {
  const normalized = code.trim().toUpperCase()
  await ensureImpactLoaded()
  const now = Date.now()
  const quote = getLiveQuoteByCode(normalized, now)
  if (!quote) throw new AppError('没有这只股票', 404)

  const budget = Math.trunc(points)
  if (!Number.isFinite(budget) || budget <= 0) throw new AppError('投入积分必须是正整数', 400)
  if (budget < STOCK_MIN_INVEST) throw new AppError(`单笔最少投入 ${STOCK_MIN_INVEST} 积分`, 400)
  if (budget > STOCK_MAX_INVEST) throw new AppError(`单笔最多投入 ${STOCK_MAX_INVEST} 积分`, 400)

  const delta = buyImpactDelta(quote.code, budget, now)
  const executionPrice = getLiveExecutionPrice(quote.code, budget * STOCK_IMPACT_PER_POINT, now)
    ?? executionPriceWithImpact(quote.price, delta)
  const quoted = quoteStockBuy(budget, executionPrice)
  if (quoted.shares <= 0) throw new AppError('投入积分不足以买入任何份额', 400)

  // 事务前快照内存冲击：事务回滚时恢复，避免「幽灵冲击」被下次成功交易持久化
  const impactSnapshot = serializeImpactState(now)
  try {
    return await prisma.$transaction(async (tx) => {
      const spend = await spendPointsTx(tx, userId, budget, {
        reason: 'stock_buy',
        note: `${quote.name}（${quote.code}）买入 ${quoted.shares.toFixed(2)} 份`,
      })
      const row = await tx.stockHolding.upsert({
        where: { userId_code: { userId, code: quote.code } },
        create: {
          userId,
          code: quote.code,
          shares: quoted.shares,
          costPoints: budget,
        },
        update: {
          shares: { increment: quoted.shares },
          costPoints: { increment: budget },
        },
      })
      await tx.stockTrade.create({
        data: {
          userId,
          code: quote.code,
          side: 'buy',
          shares: quoted.shares,
          price: executionPrice,
          points: budget,
          fee: quoted.fee,
          profit: null,
        },
      })
      applyTradeImpactDelta(quote.code, budget, now)
      await persistImpactTx(tx, now)

      const refreshed = getLiveQuoteByCode(quote.code, now) ?? quote
      const marketValue = positionMarketValue(row.shares, refreshed.price)
      return {
        balance: spend.balance,
        holding: {
          code: quote.code,
          name: quote.name,
          sector: quote.sector,
          color: quote.color,
          price: refreshed.price,
          prevClose: refreshed.prevClose,
          changePct: refreshed.changePct,
          shares: Math.round(row.shares * 10_000) / 10_000,
          costPoints: row.costPoints,
          marketValue,
          profit: positionProfit(marketValue, row.costPoints),
          profitPct: positionProfitPct(marketValue, row.costPoints),
        },
        trade: {
          code: quote.code,
          name: quote.name,
          price: executionPrice,
          impactPct: Math.round(delta * 10_000) / 100,
          points: budget,
          fee: quoted.fee,
          shares: Math.round(quoted.shares * 10_000) / 10_000,
        },
      }
    })
  } catch (error) {
    loadImpactStateFromJson(impactSnapshot, Date.now())
    throw error
  }
}

export interface StockSellResult {
  balance: number
  code: string
  name: string
  /** 本次卖出份额 */
  shares: number
  price: number
  /** 本笔成交冲击（带符号，卖出为负） */
  impactPct: number
  gross: number
  fee: number
  proceeds: number
  /** 本次卖出部分分摊的成本（整仓 = 全部成本） */
  costPoints: number
  /** 本次已实现盈亏（到手 - 分摊成本） */
  profit: number
  /** 卖出后剩余份额（整仓为 0） */
  remainingShares: number
  /** 是否整仓清仓 */
  closed: boolean
}

/**
 * 卖出持仓（无持仓 404）：shares 缺省 = 整仓（向后兼容），支持部分卖出；
 * 成交价 = 含本笔冲击的执行价（滑点），到账积分写入台账并记录成交。
 * 锁序与 buy 一致（User → Holding → SiteSetting）；持仓扣减用条件更新防并发超卖。
 */
export async function sellStock(userId: number, code: string, shares?: number): Promise<StockSellResult> {
  const normalized = code.trim().toUpperCase()
  await ensureImpactLoaded()
  const now = Date.now()
  const quote = getLiveQuoteByCode(normalized, now)
  if (!quote) throw new AppError('没有这只股票', 404)

  const impactSnapshot = serializeImpactState(now)
  try {
    return await prisma.$transaction(async (tx) => {
      const holding = await tx.stockHolding.findUnique({
        where: { userId_code: { userId, code: quote.code } },
      })
      if (!holding) throw new AppError('你没有这只股票的持仓', 400)

      let sellShares = holding.shares
      if (shares !== undefined) {
        if (!(shares > 0)) throw new AppError('卖出份额必须大于 0', 400)
        if (shares > holding.shares * (1 + 1e-9)) throw new AppError('卖出份额超过持仓', 400)
        sellShares = Math.min(shares, holding.shares)
      }

      const grossEstimate = sellShares * quote.price
      const delta = sellImpactDelta(quote.code, grossEstimate, now)
      const executionPrice = getLiveExecutionPrice(quote.code, -grossEstimate * STOCK_IMPACT_PER_POINT, now)
        ?? executionPriceWithImpact(quote.price, delta)
      const quoted = quoteStockSell(sellShares, executionPrice)
      const costPortion = splitCostForShares(holding.costPoints, sellShares, holding.shares)

      const award = quoted.proceeds > 0
        ? await awardPointsTx(tx, userId, {
          amount: quoted.proceeds,
          reason: 'stock_sell',
          note: `${quote.name}（${quote.code}）卖出 ${sellShares.toFixed(2)} 份`,
        })
        : { delta: 0, balance: (await tx.user.findUnique({ where: { id: userId }, select: { points: true } }))?.points ?? 0 }

      let remainingShares = 0
      let closed = true
      if (holding.shares - sellShares <= 1e-9) {
        const deleted = await tx.stockHolding.deleteMany({
          where: { id: holding.id, shares: { gte: sellShares } },
        })
        if (deleted.count === 0) throw new AppError('持仓已变化，请刷新后重试', 409)
      } else {
        const updated = await tx.stockHolding.updateMany({
          where: { id: holding.id, shares: { gte: sellShares } },
          data: {
            shares: { decrement: sellShares },
            costPoints: { decrement: costPortion },
          },
        })
        if (updated.count === 0) throw new AppError('持仓已变化，请刷新后重试', 409)
        const refreshed = await tx.stockHolding.findUnique({ where: { id: holding.id }, select: { shares: true } })
        remainingShares = Math.max(0, refreshed?.shares ?? 0)
        closed = remainingShares <= 1e-9
      }

      applyTradeImpactDelta(quote.code, -grossEstimate, now)
      await persistImpactTx(tx, now)

      const realized = quoted.proceeds - costPortion
      await tx.stockTrade.create({
        data: {
          userId,
          code: quote.code,
          side: 'sell',
          shares: sellShares,
          price: executionPrice,
          points: quoted.proceeds,
          fee: quoted.fee,
          profit: realized,
        },
      })

      return {
        balance: award.balance,
        code: quote.code,
        name: quote.name,
        shares: Math.round(sellShares * 10_000) / 10_000,
        price: executionPrice,
        impactPct: Math.round(delta * 10_000) / 100,
        gross: quoted.gross,
        fee: quoted.fee,
        proceeds: quoted.proceeds,
        costPoints: costPortion,
        profit: realized,
        remainingShares: Math.round(remainingShares * 10_000) / 10_000,
        closed,
      }
    })
  } catch (error) {
    loadImpactStateFromJson(impactSnapshot, Date.now())
    throw error
  }
}

/* ============================================================
   成交记录
   ============================================================ */

export interface StockTradeDto {
  id: number
  code: string
  name: string
  color: string
  sector: string
  side: 'buy' | 'sell'
  shares: number
  price: number
  /** 买入 = 投入积分（含手续费）；卖出 = 到账积分 */
  points: number
  fee: number
  /** 仅卖出行有值：本笔已实现盈亏 */
  profit: number | null
  createdAt: string
}

/** 最近成交记录（按时间倒序，默认 50 条，最多 100） */
export async function getStockTrades(userId: number, limit = 50): Promise<StockTradeDto[]> {
  const take = Math.min(100, Math.max(1, Math.trunc(limit) || 50))
  const rows = await prisma.stockTrade.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take,
  })
  const definitions = new Map(STOCK_DEFINITIONS.map((definition) => [definition.code, definition]))
  return rows.map((row) => {
    const definition = definitions.get(row.code)
    return {
      id: row.id,
      code: row.code,
      name: definition?.name ?? row.code,
      color: definition?.color ?? '#57606a',
      sector: definition?.sector ?? '未知',
      side: row.side === 'sell' ? 'sell' : 'buy',
      shares: Math.round(row.shares * 10_000) / 10_000,
      price: Math.round(row.price * 100) / 100,
      points: row.points,
      fee: row.fee,
      profit: row.profit,
      createdAt: row.createdAt.toISOString(),
    }
  })
}

/* ============================================================
   总资产排行榜
   ============================================================ */

export interface StockLeaderEntryDto {
  rank: number
  userId: number
  username: string
  avatarVersion: number
  /** 总资产 = 积分余额 + 持仓实时市值 */
  totalAssets: number
  marketValue: number
  /** 持仓浮动盈亏（市值 − 成本） */
  profit: number
  isMe: boolean
}

export interface StockLeaderboardDto {
  dateKey: string
  /** 前 N 名（默认 20，最多 50） */
  entries: StockLeaderEntryDto[]
  /** 我自己（可能不在前 N） */
  me: StockLeaderEntryDto | null
}

const LEADER_CANDIDATE_POOL = 50

/**
 * 总资产排行榜：积分余额 + 持仓实时市值。
 * 先取积分前 50 的 active 用户（+ 本人）作为候选池，一次性批量读持仓、用同一时刻报价算市值。
 */
export async function getStockLeaderboard(
  currentUserId: number,
  limit = 20,
): Promise<StockLeaderboardDto> {
  const dateKey = getTodayDateKey()
  await ensureImpactLoaded()
  const now = Date.now()
  const take = Math.min(LEADER_CANDIDATE_POOL, Math.max(1, Math.trunc(limit) || 20))

  const rows = await prisma.user.findMany({
    where: { status: 'active' },
    orderBy: [{ points: 'desc' }, { id: 'asc' }],
    take: LEADER_CANDIDATE_POOL,
    select: { id: true, username: true, avatarVersion: true, points: true },
  })
  let candidates = rows
  if (!rows.some((row) => row.id === currentUserId)) {
    const me = await prisma.user.findUnique({
      where: { id: currentUserId },
      select: { id: true, username: true, avatarVersion: true, points: true },
    })
    if (me) candidates = [...rows, me]
  }

  const holdings = await prisma.stockHolding.findMany({
    where: { userId: { in: candidates.map((row) => row.id) } },
    select: { userId: true, code: true, shares: true, costPoints: true },
  })
  const prices = new Map(STOCK_DEFINITIONS.map((definition) => [
    definition.code,
    getLiveQuote(definition, dateKey, now).price,
  ]))
  const totals = new Map<number, { marketValue: number; costPoints: number }>()
  for (const row of holdings) {
    const price = prices.get(row.code)
    if (!price) continue
    const current = totals.get(row.userId) ?? { marketValue: 0, costPoints: 0 }
    current.marketValue += positionMarketValue(row.shares, price)
    current.costPoints += row.costPoints
    totals.set(row.userId, current)
  }

  const ranked = candidates
    .map((row) => {
      const total = totals.get(row.id) ?? { marketValue: 0, costPoints: 0 }
      return {
        rank: 0,
        userId: row.id,
        username: row.username,
        avatarVersion: row.avatarVersion,
        totalAssets: totalAssets(row.points, total.marketValue),
        marketValue: total.marketValue,
        profit: total.marketValue - total.costPoints,
        isMe: row.id === currentUserId,
        balance: row.points,
      }
    })
    .filter((entry) => entry.totalAssets > 0)
    .sort((a, b) => b.totalAssets - a.totalAssets || b.balance - a.balance || a.userId - b.userId)

  ranked.forEach((entry, index) => {
    entry.rank = index + 1
  })

  const toDto = (entry: (typeof ranked)[number]): StockLeaderEntryDto => ({
    rank: entry.rank,
    userId: entry.userId,
    username: entry.username,
    avatarVersion: entry.avatarVersion,
    totalAssets: entry.totalAssets,
    marketValue: entry.marketValue,
    profit: entry.profit,
    isMe: entry.isMe,
  })

  const meEntry = ranked.find((entry) => entry.isMe)
  return {
    dateKey,
    entries: ranked.slice(0, take).map(toDto),
    me: meEntry ? toDto(meEntry) : null,
  }
}
