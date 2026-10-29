/**
 * 模拟股市交易服务：用统一积分买入 / 卖出虚构股票。
 *
 * - 买入：扣积分（含 1% 手续费）后按当日现价折算份额，可分批加仓（成本累加）；
 * - 卖出：一次性卖出全部持仓，按当日现价扣手续费后到账；
 * - 行情每天 0 点（Asia/Shanghai）刷新，因此收益来自跨日涨跌；
 * - 所有积分变动写 PointsLedger（reason = stock_buy / stock_sell），可审计。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { findStockQuote, getStockMarket } from '../lib/stockMarket.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import {
  STOCK_MAX_INVEST,
  STOCK_MIN_INVEST,
  positionMarketValue,
  positionProfit,
  positionProfitPct,
  quoteStockBuy,
  quoteStockSell,
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

/** 当前用户持仓 + 市值 / 盈亏汇总（按市值倒序） */
export async function getStockPortfolio(userId: number): Promise<StockPortfolioDto> {
  const dateKey = getTodayDateKey()
  const market = getStockMarket(dateKey)
  const [user, rows] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.stockHolding.findMany({ where: { userId } }),
  ])

  const holdings: StockHoldingDto[] = []
  for (const row of rows) {
    const quote = findStockQuote(market, row.code)
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

/** 买入（可分批加仓）：积分不足 / 金额越界由 spendPointsTx 与参数校验拦截 */
export async function buyStock(userId: number, code: string, points: number): Promise<StockBuyResult> {
  const normalized = code.trim().toUpperCase()
  const dateKey = getTodayDateKey()
  const quote = findStockQuote(getStockMarket(dateKey), normalized)
  if (!quote) throw new AppError('没有这只股票', 404)

  const budget = Math.trunc(points)
  if (!Number.isFinite(budget) || budget <= 0) throw new AppError('投入积分必须是正整数', 400)
  if (budget < STOCK_MIN_INVEST) throw new AppError(`单笔最少投入 ${STOCK_MIN_INVEST} 积分`, 400)
  if (budget > STOCK_MAX_INVEST) throw new AppError(`单笔最多投入 ${STOCK_MAX_INVEST} 积分`, 400)

  const quoted = quoteStockBuy(budget, quote.price)
  if (quoted.shares <= 0) throw new AppError('投入积分不足以买入任何份额', 400)

  return prisma.$transaction(async (tx) => {
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
}

export interface StockSellResult {
  balance: number
  code: string
  name: string
  shares: number
  price: number
  gross: number
  fee: number
  proceeds: number
  costPoints: number
  /** 本次已实现盈亏（到手 - 累计投入） */
  profit: number
}

/** 卖出全部持仓（无持仓 404）；到账积分写入台账 */
export async function sellStock(userId: number, code: string): Promise<StockSellResult> {
  const normalized = code.trim().toUpperCase()
  const dateKey = getTodayDateKey()
  const quote = findStockQuote(getStockMarket(dateKey), normalized)
  if (!quote) throw new AppError('没有这只股票', 404)

  return prisma.$transaction(async (tx) => {
    const holding = await tx.stockHolding.findUnique({
      where: { userId_code: { userId, code: quote.code } },
    })
    if (!holding) throw new AppError('你没有这只股票的持仓', 400)

    const quoted = quoteStockSell(holding.shares, quote.price)
    await tx.stockHolding.delete({ where: { id: holding.id } })
    const award = quoted.proceeds > 0
      ? await awardPointsTx(tx, userId, {
        amount: quoted.proceeds,
        reason: 'stock_sell',
        note: `${quote.name}（${quote.code}）卖出 ${holding.shares.toFixed(2)} 份`,
      })
      : { delta: 0, balance: (await tx.user.findUnique({ where: { id: userId }, select: { points: true } }))?.points ?? 0 }

    return {
      balance: award.balance,
      code: quote.code,
      name: quote.name,
      shares: Math.round(holding.shares * 10_000) / 10_000,
      price: quote.price,
      gross: quoted.gross,
      fee: quoted.fee,
      proceeds: quoted.proceeds,
      costPoints: holding.costPoints,
      profit: quoted.proceeds - holding.costPoints,
    }
  })
}
