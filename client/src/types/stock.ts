/**
 * 模拟股市实时行情：行情 3 秒一跳、玩家交易会小幅影响价格，交易用积分。
 * GET /api/stocks/market 返回全市场快照（快照不含历史，历史走势走 /api/stocks/market/trend）。
 */
export interface StockCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** 当日分时采样点（t = 当日 00:00 起的毫秒数） */
export interface StockIntradayPoint {
  t: number
  price: number
}

export interface StockQuote {
  code: string
  name: string
  sector: string
  color: string
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  change: number
  changePct: number
  volume: number
}

/** 个股走势（GET /api/stocks/market/trend?code=）：daily 近 30 根（含今日实时 candle）+ 当日分时采样 */
export interface StockTrend {
  code: string
  name: string
  dateKey: string
  /** 行情 tick 间隔毫秒（3000） */
  tickMs: number
  daily: StockCandle[]
  intraday: StockIntradayPoint[]
}

export interface StockTradeRule {
  /** 单边手续费率（0.01 = 1%） */
  feeRate: number
  /** 单笔最少投入积分 */
  minInvest: number
  /** 单笔最多投入积分 */
  maxInvest: number
}

export interface StockMarket {
  dateKey: string
  /** 行情 tick 间隔毫秒（3000） */
  tickMs: number
  /** 当前 tick 序号（0..28799，乘以 tickMs 即当日毫秒偏移） */
  tickIndex: number
  /** 快照生成时间（ISO） */
  updatedAt: string
  currency: string
  disclaimer: string
  trade: StockTradeRule
  marketChangePct: number
  stocks: StockQuote[]
}

/** 我的持仓（GET /api/stocks/portfolio） */
export interface StockHolding {
  code: string
  name: string
  sector: string
  color: string
  price: number
  prevClose: number
  changePct: number
  shares: number
  costPoints: number
  marketValue: number
  profit: number
  profitPct: number
}

export interface StockPortfolio {
  dateKey: string
  balance: number
  summary: {
    costPoints: number
    marketValue: number
    profit: number
    profitPct: number
    positions: number
  }
  holdings: StockHolding[]
}

export interface StockBuyResult {
  balance: number
  holding: StockHolding
  trade: {
    code: string
    name: string
    price: number
    points: number
    fee: number
    shares: number
  }
}

/** 卖出（POST /api/stocks/sell { code, shares? }）：shares 缺省 = 整仓 */
export interface StockSellResult {
  balance: number
  code: string
  name: string
  shares: number
  price: number
  gross: number
  fee: number
  proceeds: number
  /** 本次卖出部分分摊的成本 */
  costPoints: number
  profit: number
  /** 剩余份额（整仓为 0） */
  remainingShares: number
  /** 是否已清仓 */
  closed: boolean
}
