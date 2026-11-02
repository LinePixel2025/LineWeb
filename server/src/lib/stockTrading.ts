/**
 * 模拟股市交易规则（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 玩家用统一积分按实时价买卖虚构股票：行情每 3 秒推进一个 tick（见 stockTicks.ts）。
 * 2026-11 重构后：
 *   - 不再有每日分红 / 隔夜持仓（已删除）
 *   - 买卖双向各收 0.3% 手续费（单笔最少 1 积分）
 *   - 成交价叠加「本笔交易自身冲击」的滑点：大额买入越买越贵、大额卖出越卖越便宜，
 *     因此「买入拉高 → 立刻卖出」无法套利（往返必亏手续费 + 双向滑点）
 */

/** 单边手续费率（0.3%） */
export const STOCK_FEE_RATE = 0.003
/** 单笔最少投入积分 */
export const STOCK_MIN_INVEST = 100
/** 单笔最多投入积分 */
export const STOCK_MAX_INVEST = 100_000
/** 价格下限（与日线 / tick 引擎一致） */
export const STOCK_PRICE_FLOOR = 0.5

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

/** 卖出报价：毛收入扣 0.3% 手续费后取整到账 */
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

/**
 * 部分卖出的成本分摊：按卖出份额占总份额的比例等比分摊，四舍五入后夹在 [0, costPoints]。
 * 整仓（shares = totalShares）时恰好返回全部成本，保持旧的一次性清仓语义。
 */
export function splitCostForShares(costPoints: number, shares: number, totalShares: number): number {
  if (!(totalShares > 0) || !(shares > 0)) return 0
  const portion = Math.round((costPoints * shares) / totalShares)
  return Math.max(0, Math.min(costPoints, portion))
}

/** 盈亏百分比（两位小数；成本为 0 时按 0 处理） */
export function positionProfitPct(marketValue: number, costPoints: number): number {
  if (costPoints <= 0) return 0
  return Math.round((positionProfit(marketValue, costPoints) / costPoints) * 10_000) / 100
}

/* ============================================================
   成交滑点 / 总资产
   ============================================================ */

/**
 * 含本笔冲击的执行价：
 *   - 买入时 delta > 0（越买越贵）
 *   - 卖出时 delta < 0（越卖越便宜）
 * 结果不低于价格下限，并保留 2 位小数。
 */
export function executionPriceWithImpact(price: number, impactDelta: number): number {
  if (!(price > 0)) return STOCK_PRICE_FLOOR
  const delta = Number.isFinite(impactDelta) ? impactDelta : 0
  return Math.max(STOCK_PRICE_FLOOR, round2(price * (1 + delta)))
}

/** 总资产 = 积分余额 + 持仓市值（排行榜与账户条的统一口径） */
export function totalAssets(balance: number, marketValue: number): number {
  return Math.max(0, Math.round(balance)) + Math.max(0, Math.round(marketValue))
}
