/** 模拟股市行情（GET /api/stocks/market）：行情只读，交易用积分 */
export interface StockCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
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
  history: StockCandle[]
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
  profit: number
}
