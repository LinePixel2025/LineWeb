/**
 * 模拟股市实时行情：行情 3 秒一跳、玩家大额交易会明显影响价格，交易用积分。
 * GET /api/stocks/market 返回全市场快照（含当日 AI 快讯 / 大盘指数 / 市场情绪；
 * 快照不含历史，历史走势走 /api/stocks/market/trend）。
 *
 * 金额一律是整数积分；价格是保留 2 位的浮点数；收益率 / 涨跌幅都是「百分比数值」
 * （1.23 表示 +1.23%），事件冲击则是「小数」（0.032 表示 3.2%）。
 */
export interface StockCandle {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/** 当日分时采样点（t = 当日 00:00 起的毫秒数，按 Asia/Shanghai 日界） */
export interface StockIntradayPoint {
  t: number
  price: number
}

/** 当日 AI 快讯（利好 / 利空，触发后按半衰期衰减） */
export interface StockNewsItem {
  /** 稳定 id：`${code}-${batchKey}-${index}` */
  id: string
  title: string
  summary: string
  /** 未触发事件不返回方向 */
  sentiment?: 'good' | 'bad'
  /** 触发 tick（1..28799）：t = startTick × tickMs 即分时图的横坐标 */
  startTick: number
  /** 触发时刻（ISO） */
  startAt: string
  /** 初始冲击幅度（带符号小数，0.032 = 3.2%）；未触发时为 0 */
  impact: number
  /** 半衰期毫秒（30–180 分钟） */
  halfLifeMs: number
  /** 当前冲击幅度（未触发为 0） */
  currentImpact: number
  /** 是否已触发 */
  active: boolean
  /** 事件来源：AI 生成 / 模板兜底 */
  source?: 'ai' | 'template'
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
  /** 当日 AI 快讯（实时行情必带；日线构建器不产生，故可选） */
  news?: StockNewsItem[]
}

export type StockMarketMood = 'bull' | 'flat' | 'bear'

/** 个股走势（GET /api/stocks/market/trend?code=）：daily 近 30 根（含今日实时 candle）+ 当日分时采样 + 新闻 */
export interface StockTrend {
  code: string
  name: string
  dateKey: string
  /** 行情 tick 间隔毫秒（3000） */
  tickMs: number
  daily: StockCandle[]
  intraday: StockIntradayPoint[]
  /** 当日新闻（前端在分时图上按 startTick × tickMs 画事件标记） */
  news: StockNewsItem[]
}

export interface StockTradeRule {
  /** 单边手续费率（0.003 = 0.3%） */
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
  /** 全部股票今日涨跌幅的算术平均（百分比数值） */
  marketChangePct: number
  /** 大盘指数点位（1000 基准，保留 2 位；实时行情必带） */
  index?: number
  /** 市场情绪：牛 / 震荡 / 熊（按平均涨跌 ±0.6% 划分） */
  marketMood?: StockMarketMood
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

/** 股市账户摘要（已实现盈亏 / 总资产） */
export interface StockAccountSummary {
  realizedPoints: number
  totalAssets: number
}

export interface StockPortfolio {
  dateKey: string
  balance: number
  account: StockAccountSummary
  summary: {
    costPoints: number
    marketValue: number
    profit: number
    profitPct: number
    positions: number
    /** 已实现盈亏（卖出结算的累计值，可正可负） */
    realizedProfit: number
  }
  holdings: StockHolding[]
}

export interface StockBuyResult {
  balance: number
  holding: StockHolding
  trade: {
    code: string
    name: string
    /** 含本笔冲击的成交价 */
    price: number
    /** 本笔成交冲击（百分比，买入为正） */
    impactPct: number
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
  /** 本笔成交冲击（百分比，卖出为负） */
  impactPct: number
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

/** 成交记录（GET /api/stocks/trades?limit=） */
export interface StockTrade {
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
  /** 仅卖出行有值（已实现盈亏） */
  profit: number | null
  createdAt: string
}

export interface StockTradeList {
  trades: StockTrade[]
}

/** 总资产排行榜条目（积分余额 + 持仓实时市值） */
export interface StockLeaderEntry {
  rank: number
  userId: number
  username: string
  avatarVersion: number
  totalAssets: number
  marketValue: number
  /** 持仓浮动盈亏（市值 − 成本） */
  profit: number
  isMe: boolean
}

export interface StockLeaderboard {
  dateKey: string
  entries: StockLeaderEntry[]
  /** 我自己（可能不在前 20） */
  me: StockLeaderEntry | null
}

/** 本地自选股（localStorage `lineweb_stock_watchlist_v1`） */
export type StockWatchlist = string[]

/** 本地价格提醒（localStorage `lineweb_stock_alerts_v1`） */
export interface StockAlert {
  id: string
  code: string
  /** 目标价（保留 2 位） */
  target: number
  /** above = 价格涨到目标价以上提醒；below = 跌到目标价以下提醒 */
  direction: 'above' | 'below'
}

/** 已触发的提醒记录（本地 `lineweb_stock_alert_log_v1`，最多保留 30 条，刷新后仍可回看） */
export interface StockAlertHit {
  id: string
  code: string
  target: number
  direction: 'above' | 'below'
  /** 触发时的现价 */
  price: number
  /** 触发时间（毫秒时间戳） */
  at: number
}

/** 限价委托（GET /api/stocks/orders） */
export interface StockOrder {
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
  /** 卖出冻结成本 */
  costPoints: number
  status: 'open' | 'filled' | 'cancelled'
  filledPrice: number | null
  filledAt: string | null
  createdAt: string
  currentPrice: number | null
  changePct: number | null
  /** 现价是否已满足限价（下一次撮合成交） */
  triggered: boolean
  /** 距离触发还差多少（百分比） */
  distancePct: number
}

export interface StockOrdersView {
  orders: StockOrder[]
  openCount: number
  rules: {
    minInvest: number
    maxInvest: number
    minShares: number
    feeRate: number
  }
}

export interface StockOrderCreateResult {
  order: StockOrder
  balance: number
}

export interface StockOrderCancelResult {
  order: StockOrder
  balance: number
}
