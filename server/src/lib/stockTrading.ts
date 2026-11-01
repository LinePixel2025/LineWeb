/**
 * 模拟股市交易规则（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 玩家用统一积分按实时价买卖虚构股票：行情每 3 秒推进一个 tick（见 stockTicks.ts），
 * 价格随行情实时变动，玩家交易本身还会小幅影响价格（10 分钟半衰期衰减）。
 * 买卖双向各收 0.3% 手续费（单笔最少 1 积分）—— 2026-11 从 1% 下调：
 * 旧费率下「涨 1% 才勉强保本」，配合旧版几乎为零的长期漂移，玩家整体必亏；
 * 0.3% 让「持有一天 + 吃到一次正常波动」就能覆盖摩擦成本，同时保留短线频繁交易的惩罚。
 * 长期持有的第二条收益来源是每日分红（见 stockService.settleDividends）。
 */

/** 单边手续费率（0.3%） */
export const STOCK_FEE_RATE = 0.003
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
   每日分红 / 总资产
   ============================================================ */

/**
 * 单只持仓的当日分红（整数积分，四舍五入，永不为负）。
 * 口径：市值 × 日分红收益率。市值本身已经是整数积分（positionMarketValue），
 * 因此 1000 积分 × 0.8% 恰好是 8 分，不会因为浮点误差多给或少给。
 */
export function stockDailyDividend(marketValue: number, dividendYield: number): number {
  if (!(marketValue > 0) || !(dividendYield > 0)) return 0
  return Math.max(0, Math.round(marketValue * dividendYield))
}

/**
 * 是否隔夜持仓（可结算当日分红）。
 * 规则：持仓最后变动时间必须早于「当日 0 点」（Asia/Shanghai）——
 * 当天买入 / 加仓 / 卖出的持仓会被 @updatedAt 刷新到当天，当天不参与分红，
 * 防止「早上买入晚上就领分红」的无限套利。
 */
export function isOvernightHolding(updatedAt: Date, dayStartMs: number): boolean {
  return updatedAt.getTime() < dayStartMs
}

/** 总资产 = 积分余额 + 持仓市值（排行榜与账户条的统一口径） */
export function totalAssets(balance: number, marketValue: number): number {
  return Math.max(0, Math.round(balance)) + Math.max(0, Math.round(marketValue))
}
