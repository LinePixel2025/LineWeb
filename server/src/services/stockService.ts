/**
 * 模拟股市交易服务：用统一积分按实时价买入 / 卖出虚构股票。
 *
 * - 买入：扣积分（含 1% 手续费）后按成交时实时价折算份额，可分批加仓（成本累加）；
 * - 卖出：支持部分卖出（shares 缺省 = 整仓，向后兼容），成本按份额等比分摊，
 *   整仓清仓删除持仓行；到账积分 = 毛收入 − 1% 手续费；
 * - 行情每 3 秒推进一个 tick（stockTicks.ts），玩家交易会小幅影响价格
 *   （买入推高 / 卖出压低，10 分钟半衰期衰减），冲击状态经 SiteSetting 持久化，
 *   重启后恢复；内存中的冲击状态是真相源，DB 只用于重启恢复；
 * - 所有积分变动写 PointsLedger（reason = stock_buy / stock_sell），可审计。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import {
  IMPACT_STATE_SETTING_KEY,
  applyTradeImpactDelta,
  getLiveQuoteByCode,
  loadImpactStateFromJson,
  markImpactPersisted,
  serializeImpactState,
} from '../lib/stockTicks.js'
import {
  STOCK_MAX_INVEST,
  STOCK_MIN_INVEST,
  positionMarketValue,
  positionProfit,
  positionProfitPct,
  quoteStockBuy,
  quoteStockSell,
  splitCostForShares,
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

export interface StockPortfolioDto {
  dateKey: string
  balance: number
  summary: {
    costPoints: number
    marketValue: number
    profit: number
    profitPct: number
    positions: number
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
function ensureImpactLoaded(): Promise<void> {
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

/** 当前用户持仓 + 市值 / 盈亏汇总（按市值倒序，报价用实时价） */
export async function getStockPortfolio(userId: number): Promise<StockPortfolioDto> {
  const dateKey = getTodayDateKey()
  await ensureImpactLoaded()
  const now = Date.now()
  const [user, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.stockHolding.findMany({ where: { userId } }),
  ])

  const holdings: StockHoldingDto[] = []
  for (const row of rows) {
    const quote = getLiveQuoteByCode(row.code, now)
    if (!quote) continue
    const marketValue = positionMarketValue(row.shares, quote.price)
    holdings.push({
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
    })
  }
  holdings.sort((a, b) => b.marketValue - a.marketValue)

  const totalCost = holdings.reduce((sum, row) => sum + row.costPoints, 0)
  const totalValue = holdings.reduce((sum, row) => sum + row.marketValue, 0)

  return {
    dateKey,
    balance: user?.points ?? 0,
    summary: {
      costPoints: totalCost,
      marketValue: totalValue,
      profit: totalValue - totalCost,
      profitPct: positionProfitPct(totalValue, totalCost),
      positions: holdings.length,
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
    points: number
    fee: number
    shares: number
  }
}

/**
 * 买入（可分批加仓）：积分不足 / 金额越界由 spendPointsTx 与参数校验拦截。
 * 锁序：User（spend）→ Holding（upsert）→ SiteSetting（冲击落盘），与 sell 一致。
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

  const quoted = quoteStockBuy(budget, quote.price)
  if (quoted.shares <= 0) throw new AppError('投入积分不足以买入任何份额', 400)

  // 事务前快照内存冲击：事务回滚时恢复，避免「幽灵冲击」被下次成功交易持久化
  // （并发窗口内其它交易的冲击可能被一并回滚，量级 ≤ clamp 上限且 10 分钟半衰期自愈，可接受）
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
      // 买入推高价格并把冲击状态落盘（与积分变动同事务，保证台账与行情冲击一致）
      applyTradeImpactDelta(quote.code, budget, now)
      await persistImpactTx(tx, now)
      const marketValue = positionMarketValue(row.shares, quote.price)
      return {
        balance: spend.balance,
        holding: {
          code: quote.code,
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
        },
        trade: {
          code: quote.code,
          name: quote.name,
          price: quote.price,
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
 * 到账积分写入台账，卖出按毛收入压低价格并把冲击状态落盘。
 * 锁序与 buy 一致（User → Holding → SiteSetting）；持仓扣减用条件更新防并发超卖。
 */
export async function sellStock(userId: number, code: string, shares?: number): Promise<StockSellResult> {
  const normalized = code.trim().toUpperCase()
  await ensureImpactLoaded()
  const now = Date.now()
  const quote = getLiveQuoteByCode(normalized, now)
  if (!quote) throw new AppError('没有这只股票', 404)

  // 事务前快照内存冲击：事务回滚时恢复，避免「幽灵冲击」被下次成功交易持久化
  // （并发窗口内其它交易的冲击可能被一并回滚，量级 ≤ clamp 上限且 10 分钟半衰期自愈，可接受）
  const impactSnapshot = serializeImpactState(now)
  try {
    return await prisma.$transaction(async (tx) => {
      const holding = await tx.stockHolding.findUnique({
        where: { userId_code: { userId, code: quote.code } },
      })
      if (!holding) throw new AppError('你没有这只股票的持仓', 400)

      // 卖出份额：缺省 = 整仓；指定时必须为正且不超过持仓（1e-9 容差吸收浮点累计误差）
      let sellShares = holding.shares
      if (shares !== undefined) {
        if (!(shares > 0)) throw new AppError('卖出份额必须大于 0', 400)
        if (shares > holding.shares * (1 + 1e-9)) throw new AppError('卖出份额超过持仓', 400)
        sellShares = Math.min(shares, holding.shares)
      }

      const quoted = quoteStockSell(sellShares, quote.price)
      const costPortion = splitCostForShares(holding.costPoints, sellShares, holding.shares)

      // 锁序统一为 User → Holding → SiteSetting（与 buy 相同，避免 User↔SiteSetting 成环死锁）：
      // 先记到账积分，随后的持仓条件更新失败会抛 409 整体回滚，award 随之回滚
      const award = quoted.proceeds > 0
        ? await awardPointsTx(tx, userId, {
          amount: quoted.proceeds,
          reason: 'stock_sell',
          note: `${quote.name}（${quote.code}）卖出 ${sellShares.toFixed(2)} 份`,
        })
        : { delta: 0, balance: (await tx.user.findUnique({ where: { id: userId }, select: { points: true } }))?.points ?? 0 }

      // 条件更新防并发超卖（仿 spendPointsTx）：where shares >= sellShares 由行锁 + 谓词重评
      // 保证原子性，两笔并发卖出只有一笔能成功，失败方 409（整体回滚，含上面的到账积分）
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
        // 回读取更新后的权威剩余份额（并发买入可能已在读取与更新之间加仓）
        const refreshed = await tx.stockHolding.findUnique({ where: { id: holding.id }, select: { shares: true } })
        remainingShares = Math.max(0, refreshed?.shares ?? 0)
        closed = remainingShares <= 1e-9
      }

      applyTradeImpactDelta(quote.code, -quoted.gross, now)
      await persistImpactTx(tx, now)

      return {
        balance: award.balance,
        code: quote.code,
        name: quote.name,
        shares: Math.round(sellShares * 10_000) / 10_000,
        price: quote.price,
        gross: quoted.gross,
        fee: quoted.fee,
        proceeds: quoted.proceeds,
        costPoints: costPortion,
        profit: quoted.proceeds - costPortion,
        remainingShares: Math.round(remainingShares * 10_000) / 10_000,
        closed,
      }
    })
  } catch (error) {
    loadImpactStateFromJson(impactSnapshot, Date.now())
    throw error
  }
}
