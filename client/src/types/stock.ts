/** 模拟股市行情（GET /api/stocks/market）：只读，不可交易、无收益 */
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

export interface StockMarket {
  dateKey: string
  currency: string
  disclaimer: string
  marketChangePct: number
  stocks: StockQuote[]
}
