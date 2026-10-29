/**
 * 模拟股市交易规则（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 玩家用统一积分买入虚构股票，行情每天 0 点（Asia/Shanghai）刷新一次，
 * 卖出时按当日收盘价结算。买卖双向各收 1% 手续费（单笔最少 1 积分），
 * 因此「当天买当天卖」必然小幅亏损，收益来自跨日行情波动。
 */

/** 单边手续费率 */
export const STOCK_FEE_RATE = 0.01
/** 单笔最少投入积分 */
export const STOCK_MIN_INVEST = 100
/** 单笔最多投入积分 */
export const STOCK_MAX_INVEST = 100_000

export interface StockBuyQuote {
  /** 实际扣除的积分（= 用户输入预算） */
  points: number
  /** 手续费（积分） */
  fee: number
  /** 扣费后真正用于买入的积分 */
  netPoints: number
  price: number
  /** 买入份额（可带小数） */
  shares: number
}

export interface StockSellQuote {
  /** 卖出毛收入（份额 × 价格） */
  gross: number
  fee: number
  /** 实际到账积分（四舍五入） */
  proceeds: number
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 买入报价：预算先按整数积分扣手续费，再按现价折算份额 */
export function quoteStockBuy(points: number, price: number): StockBuyQuote {
  const budget = Math.max(0, Math.trunc(points))
  const fee = budget > 0 ? Math.max(1, Math.ceil(budget * STOCK_FEE_RATE)) : 0
  const netPoints = Math.max(0, budget - fee)
  const shares = price > 0 ? netPoints / price : 0
  return { points: budget, fee, netPoints, price, shares }
}

/** 卖出报价：毛收入扣 1% 手续费后取整到账 */
export function quoteStockSell(shares: number, price: number): StockSellQuote {
  const gross = Math.max(0, shares * price)
  const fee = gross > 0 ? Math.max(1, Math.ceil(gross * STOCK_FEE_RATE)) : 0
  const proceeds = Math.max(0, Math.round(gross - fee))
  return { gross: round2(gross), fee, proceeds }
}

/** 持仓市值（整数积分，与余额口径一致） */
export function positionMarketValue(shares: number, price: number): number {
  return Math.max(0, Math.round(shares * price))
}

/** 持仓盈亏：市值 - 累计投入（含买入手续费） */
export function positionProfit(marketValue: number, costPoints: number): number {
  return marketValue - costPoints
}

/** 盈亏百分比（两位小数；成本为 0 时按 0 处理） */
export function positionProfitPct(marketValue: number, costPoints: number): number {
  if (costPoints <= 0) return 0
  return Math.round((positionProfit(marketValue, costPoints) / costPoints) * 10_000) / 100
}
