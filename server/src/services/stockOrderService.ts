/**
 * 股市限价委托（买入 / 卖出）与惰性撮合。
 *
 * 口径：
 *   - 买入挂单时立即冻结积分（写 PointsLedger，reason=stock_order_buy），
 *     成交时不再扣款；撤单原路退回（stock_order_refund）。
 *   - 卖出挂单时立即从持仓扣掉份额并记住成本（成本按份额等比分摊），
 *     成交时只发到账积分；撤单把份额与成本还回持仓。
 *   - 没有定时器：行情 / 委托 / 资产 / 排行榜请求会触发一次惰性撮合，
 *     全局撮合最多 4 秒一次，避免每 3 秒行情轮询都扫全表。
 *   - 成交价用触发时的实时价（严格满足限价方向），成交冲击照常写入股价冲击状态。
 */

import prisma from '../lib/prisma.js'
import type { Prisma, StockOrder } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  IMPACT_STATE_SETTING_KEY,
  STOCK_IMPACT_PER_POINT,
  applyTradeImpactDelta,
  getLiveQuoteByCode,
  loadImpactStateFromJson,
  markImpactPersisted,
  serializeImpactState,
} from '../lib/stockTicks.js'
import { ensureImpactLoaded } from './stockService.js'
import {
  STOCK_FEE_RATE,
  STOCK_MAX_INVEST,
  STOCK_MIN_INVEST,
  STOCK_ORDER_MIN_SHARES,
  STOCK_PRICE_FLOOR,
  limitOrderDistancePct,
  limitOrderTriggered,
  quoteStockBuy,
  quoteStockSell,
  splitCostForShares,
} from '../lib/stockTrading.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'

export interface StockOrderDto {
  id: number
  code: string
  name: string
  sector: string
  color: string
  side: 'buy' | 'sell'
  limitPrice: number
  /** 买入冻结积分 */
  amount: number
  /** 卖出冻结份额 */
  shares: number
  /** 卖出冻结成本（用于已实现盈亏） */
  costPoints: number
  status: 'open' | 'filled' | 'cancelled'
  filledPrice: number | null
  filledAt: string | null
  createdAt: string
  currentPrice: number | null
  changePct: number | null
  /** 当前价是否已满足限价（下一次撮合会成交） */
  triggered: boolean
  /** 距离触发还差多少（百分比） */
  distancePct: number
}

export interface StockOrdersView {
  orders: StockOrderDto[]
  openCount: number
  rules: {
    minInvest: number
    maxInvest: number
    minShares: number
    feeRate: number
  }
}

function orderDto(row: StockOrder, now: number): StockOrderDto {
  const quote = getLiveQuoteByCode(row.code, now)
  const side = row.side === 'sell' ? 'sell' : 'buy'
  return {
    id: row.id,
    code: row.code,
    name: quote?.name ?? row.code,
    sector: quote?.sector ?? '未知',
    color: quote?.color ?? '#57606a',
    side,
    limitPrice: Math.round(row.limitPrice * 100) / 100,
    amount: row.amount,
    shares: Math.round(row.shares * 10_000) / 10_000,
    costPoints: row.costPoints,
    status: row.status === 'filled' || row.status === 'cancelled' ? row.status : 'open',
    filledPrice: row.filledPrice !== null ? Math.round(row.filledPrice * 100) / 100 : null,
    filledAt: row.filledAt ? row.filledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    currentPrice: quote ? quote.price : null,
    changePct: quote ? quote.changePct : null,
    triggered: quote ? limitOrderTriggered(side, quote.price, row.limitPrice) : false,
    distancePct: quote ? limitOrderDistancePct(side, quote.price, row.limitPrice) : 0,
  }
}

async function persistImpactTx(tx: Prisma.TransactionClient, now: number) {
  const value = serializeImpactState(now)
  await tx.siteSetting.upsert({
    where: { key: IMPACT_STATE_SETTING_KEY },
    update: { value },
    create: { key: IMPACT_STATE_SETTING_KEY, value },
  })
  markImpactPersisted()
}

function normalizeLimitPrice(raw: number): number {
  const price = Number(raw)
  if (!Number.isFinite(price) || price < STOCK_PRICE_FLOOR) {
    throw new AppError(`限价不能低于 ${STOCK_PRICE_FLOOR}`, 400)
  }
  if (price > 100_000) throw new AppError('限价过高', 400)
  return Math.round(price * 100) / 100
}

export interface CreateStockOrderInput {
  code: string
  side: 'buy' | 'sell'
  limitPrice: number
  /** 买入：冻结积分 */
  points?: number
  /** 卖出：冻结份额 */
  shares?: number
}

export interface CreateStockOrderResult {
  order: StockOrderDto
  balance: number
}

export const STOCK_MAX_OPEN_ORDERS = 20

export async function createStockOrder(
  userId: number,
  input: CreateStockOrderInput,
): Promise<CreateStockOrderResult> {
  await ensureImpactLoaded()
  const now = Date.now()
  const code = input.code.trim().toUpperCase()
  const quote = getLiveQuoteByCode(code, now)
  if (!quote) throw new AppError('没有这只股票', 404)
  const limitPrice = normalizeLimitPrice(input.limitPrice)
  const openCount = await prisma.stockOrder.count({ where: { userId, status: 'open' } })
  if (openCount >= STOCK_MAX_OPEN_ORDERS) {
    throw new AppError(`最多同时挂 ${STOCK_MAX_OPEN_ORDERS} 条委托，先撤掉一些吧`, 400)
  }

  if (input.side === 'buy') {
    const amount = Math.trunc(Number(input.points))
    if (!Number.isFinite(amount) || amount < STOCK_MIN_INVEST) {
      throw new AppError(`单笔最少投入 ${STOCK_MIN_INVEST} 积分`, 400)
    }
    if (amount > STOCK_MAX_INVEST) throw new AppError(`单笔最多投入 ${STOCK_MAX_INVEST} 积分`, 400)
    const result = await prisma.$transaction(async (tx) => {
      const spend = await spendPointsTx(tx, userId, amount, {
        reason: 'stock_order_buy',
        note: `${quote.name}（${quote.code}）限价买入冻结`,
      })
      const order = await tx.stockOrder.create({
        data: { userId, code: quote.code, side: 'buy', limitPrice, amount },
      })
      return { order, balance: spend.balance }
    })
    return { order: orderDto(result.order, now), balance: result.balance }
  }

  const shares = Number(input.shares)
  if (!Number.isFinite(shares) || shares < STOCK_ORDER_MIN_SHARES) {
    throw new AppError('卖出份额必须大于 0', 400)
  }
  const result = await prisma.$transaction(async (tx) => {
    const holding = await tx.stockHolding.findUnique({
      where: { userId_code: { userId, code: quote.code } },
    })
    if (!holding) throw new AppError('你没有这只股票的持仓', 400)
    if (shares > holding.shares * (1 + 1e-9)) throw new AppError('卖出份额超过持仓', 400)
    const sellShares = Math.min(shares, holding.shares)
    const costPortion = splitCostForShares(holding.costPoints, sellShares, holding.shares)

    if (holding.shares - sellShares <= 1e-9) {
      const deleted = await tx.stockHolding.deleteMany({ where: { id: holding.id } })
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
    }

    const order = await tx.stockOrder.create({
      data: {
        userId,
        code: quote.code,
        side: 'sell',
        limitPrice,
        shares: sellShares,
        costPoints: costPortion,
      },
    })
    const user = await tx.user.findUnique({ where: { id: userId }, select: { points: true } })
    return { order, balance: user?.points ?? 0 }
  })
  return { order: orderDto(result.order, now), balance: result.balance }
}

export interface CancelStockOrderResult {
  order: StockOrderDto
  balance: number
}

export async function cancelStockOrder(
  userId: number,
  orderId: number,
): Promise<CancelStockOrderResult> {
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.stockOrder.findUnique({ where: { id: orderId } })
    if (!order) throw new AppError('委托不存在', 404)
    if (order.userId !== userId) throw new AppError('只能撤销自己的委托', 403)
    if (order.status !== 'open') throw new AppError('这条委托已经不能撤销了', 409)

    const claimed = await tx.stockOrder.updateMany({
      where: { id: order.id, status: 'open' },
      data: { status: 'cancelled' },
    })
    if (claimed.count !== 1) throw new AppError('这条委托刚刚成交或已撤销', 409)

    let balance = (await tx.user.findUnique({ where: { id: userId }, select: { points: true } }))?.points ?? 0
    if (order.side === 'buy') {
      if (order.amount > 0) {
        const award = await awardPointsTx(tx, userId, {
          amount: order.amount,
          reason: 'stock_order_refund',
          note: '限价买入撤单退回',
        })
        balance = award.balance
      }
    } else if (order.shares > 0) {
      await tx.stockHolding.upsert({
        where: { userId_code: { userId, code: order.code } },
        create: {
          userId,
          code: order.code,
          shares: order.shares,
          costPoints: order.costPoints,
        },
        update: {
          shares: { increment: order.shares },
          costPoints: { increment: order.costPoints },
        },
      })
    }
    const cancelled = await tx.stockOrder.findUnique({ where: { id: order.id } })
    return { order: cancelled ?? { ...order, status: 'cancelled' }, balance }
  })
  return { order: orderDto(result.order, Date.now()), balance: result.balance }
}

/** 尝试撮合一条挂单；返回是否成交 */
async function tryFillStockOrder(order: StockOrder, now: number): Promise<boolean> {
  const quote = getLiveQuoteByCode(order.code, now)
  if (!quote) return false
  const side = order.side === 'sell' ? 'sell' : 'buy'
  if (!limitOrderTriggered(side, quote.price, order.limitPrice)) return false

  const impactSnapshot = serializeImpactState(now)
  try {
    return await prisma.$transaction(async (tx) => {
      const claimed = await tx.stockOrder.updateMany({
        where: { id: order.id, status: 'open' },
        data: { status: 'filled', filledPrice: quote.price, filledAt: new Date(now) },
      })
      if (claimed.count !== 1) return false

      if (side === 'buy') {
        const quoted = quoteStockBuy(order.amount, quote.price)
        if (quoted.shares <= 0) throw new AppError('委托金额不足以买入任何份额', 400)
        await tx.stockHolding.upsert({
          where: { userId_code: { userId: order.userId, code: order.code } },
          create: {
            userId: order.userId,
            code: order.code,
            shares: quoted.shares,
            costPoints: order.amount,
          },
          update: {
            shares: { increment: quoted.shares },
            costPoints: { increment: order.amount },
          },
        })
        await tx.stockTrade.create({
          data: {
            userId: order.userId,
            code: order.code,
            side: 'buy',
            shares: quoted.shares,
            price: quote.price,
            points: order.amount,
            fee: quoted.fee,
            profit: null,
          },
        })
        applyTradeImpactDelta(order.code, order.amount, now)
        await persistImpactTx(tx, now)
        return true
      }

      const quoted = quoteStockSell(order.shares, quote.price)
      if (quoted.proceeds > 0) {
        await awardPointsTx(tx, order.userId, {
          amount: quoted.proceeds,
          reason: 'stock_order_sell',
          note: `${quote.name}（${quote.code}）限价卖出 ${order.shares.toFixed(4)} 份`,
        })
      }
      await tx.stockTrade.create({
        data: {
          userId: order.userId,
          code: order.code,
          side: 'sell',
          shares: order.shares,
          price: quote.price,
          points: quoted.proceeds,
          fee: quoted.fee,
          profit: quoted.proceeds - order.costPoints,
        },
      })
      applyTradeImpactDelta(order.code, -quoted.gross, now)
      await persistImpactTx(tx, now)
      return true
    })
  } catch (error) {
    loadImpactStateFromJson(impactSnapshot, Date.now())
    throw error
  }
}

let lastSweepAt = 0
let sweepPromise: Promise<number> | null = null

/**
 * 惰性撮合：传 userId 时只撮合该用户（委托页 / 资产页），
 * 不传时全局扫描（行情页），最多 4 秒一次。
 */
export async function processStockOrders(userId?: number): Promise<number> {
  await ensureImpactLoaded()
  if (userId === undefined) {
    if (Date.now() - lastSweepAt < 4_000) return 0
    if (sweepPromise) return sweepPromise
  }
  const run = async (): Promise<number> => {
    const rows = await prisma.stockOrder.findMany({
      where: { status: 'open', ...(userId !== undefined ? { userId } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 25,
    })
    let filled = 0
    for (const row of rows) {
      try {
        if (await tryFillStockOrder(row, Date.now())) filled += 1
      } catch (error) {
        console.warn('[stockOrder] 撮合失败，已跳过：', (error as Error).message)
      }
    }
    return filled
  }
  if (userId === undefined) {
    sweepPromise = run()
    try {
      return await sweepPromise
    } finally {
      sweepPromise = null
      lastSweepAt = Date.now()
    }
  }
  return run()
}

export async function getStockOrdersView(userId: number): Promise<StockOrdersView> {
  await processStockOrders(userId)
  const now = Date.now()
  const rows = await prisma.stockOrder.findMany({
    where: { userId },
    orderBy: [{ id: 'desc' }],
    take: 60,
  })
  const orders = rows
    .map((row) => orderDto(row, now))
    .sort((a, b) => {
      const aOpen = a.status === 'open' ? 0 : 1
      const bOpen = b.status === 'open' ? 0 : 1
      if (aOpen !== bOpen) return aOpen - bOpen
      return b.id - a.id
    })
  return {
    orders,
    openCount: orders.filter((order) => order.status === 'open').length,
    rules: {
      minInvest: STOCK_MIN_INVEST,
      maxInvest: STOCK_MAX_INVEST,
      minShares: STOCK_ORDER_MIN_SHARES,
      feeRate: STOCK_FEE_RATE,
    },
  }
}

/** 导出给自检 / 行情路由判断用 */
export const STOCK_ORDER_IMPACT_PER_POINT = STOCK_IMPACT_PER_POINT
