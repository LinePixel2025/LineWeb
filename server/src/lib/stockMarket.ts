/**
 * 股市「模拟行情」—— 日线锚点层。
 *
 * 全部数据由确定性随机数生成：
 * - 每只股票用固定种子（取股票代码）从固定纪元开始做带均值回归的随机游走，
 *   因此相邻两天的 30 日走势天然衔接，同一天重复请求结果完全一致；
 * - 不使用数据库、不写任何文件，也不消耗外部接口。
 *
 * 本文件是「每日一价」的确定性日线生成器（历史 K 线唯一真相源）：
 * 12 只虚构股票，多数带正向长期漂移（牛市偏向），只有 AURS 一只高风险偏空；
 * 秒级实时行情（3 秒一 tick + 盘中慢波 + 新闻事件冲击 + 玩家交易冲击）
 * 由 `stockTicks.ts` 在日线锚点上延展，对外 API 一律走 stockTicks 的实时报价。
 * 每日分红的收益率（dividendYield）也定义在这里，结算逻辑在 stockService.ts。
 *
 * 交易（积分买入 / 卖出）的纯函数规则见 `stockTrading.ts`。
 */

import { STOCK_FEE_RATE, STOCK_MAX_INVEST, STOCK_MIN_INVEST } from './stockTrading.js'

/** 模拟行情的历史长度（自然日） */
export const STOCK_HISTORY_DAYS = 30
/** 随机游走起点（固定，保证任意日期都能算出连续走势） */
export const STOCK_EPOCH = '2024-01-01'

export interface StockDefinition {
  code: string
  name: string
  sector: string
  /** 起始价（模拟币） */
  basePrice: number
  /** 日波动率（0–1） */
  volatility: number
  /**
   * 日漂移（可正可负）。
   * 2026-11 起整体改为「牛市长趋势」：11 只正漂移（+0.16% ~ +0.45%/日），
   * 只保留 AURS 一只负漂移作为高风险标的 —— 旧版 8 只里有 5 只漂移 ≤ 0，
   * 再叠加 1% 双向手续费，玩家长期持有几乎必亏（用户反馈的核心问题）。
   */
  drift: number
  /**
   * 每日分红收益率（按持仓市值发放，0.003–0.016）。
   * 隔夜未变动的持仓每天结算一次，直接进积分 —— 这是「长期持有也能赚」的第二条腿：
   * 高股息股（GRNA / MINT / BWHL / SPRU）漂移低但分红高，成长股（CRMS / ORCA）漂移高但分红低。
   */
  dividendYield: number
  baseVolume: number
  /** 前端主色（图例 / 折线） */
  color: string
}

export const STOCK_DEFINITIONS: readonly StockDefinition[] = [
  { code: 'LWST', name: '星尘科技', sector: '科技', basePrice: 128.4, volatility: 0.028, drift: 0.0026, dividendYield: 0.004, baseVolume: 860_000, color: '#1f6feb' },
  { code: 'SPRU', name: '云杉能源', sector: '能源', basePrice: 46.7, volatility: 0.018, drift: 0.0022, dividendYield: 0.010, baseVolume: 540_000, color: '#1a7f37' },
  { code: 'BWHL', name: '蓝鲸航运', sector: '物流', basePrice: 72.1, volatility: 0.022, drift: 0.0018, dividendYield: 0.011, baseVolume: 420_000, color: '#0969da' },
  { code: 'QILN', name: '麒麟药业', sector: '医药', basePrice: 189.9, volatility: 0.024, drift: 0.0024, dividendYield: 0.007, baseVolume: 310_000, color: '#bf3989' },
  { code: 'CRMS', name: '赤霄半导体', sector: '半导体', basePrice: 264.5, volatility: 0.036, drift: 0.0031, dividendYield: 0.003, baseVolume: 275_000, color: '#8250df' },
  { code: 'GRNA', name: '青禾农业', sector: '农业', basePrice: 18.6, volatility: 0.016, drift: 0.0019, dividendYield: 0.014, baseVolume: 960_000, color: '#9a6700' },
  { code: 'AURS', name: '极光传媒', sector: '传媒', basePrice: 33.2, volatility: 0.031, drift: -0.0008, dividendYield: 0.008, baseVolume: 610_000, color: '#cf222e' },
  { code: 'IRNW', name: '玄铁重工', sector: '制造', basePrice: 57.8, volatility: 0.02, drift: 0.0020, dividendYield: 0.009, baseVolume: 380_000, color: '#57606a' },
  { code: 'NOVA', name: '新星航天', sector: '航天', basePrice: 96.5, volatility: 0.030, drift: 0.0034, dividendYield: 0.004, baseVolume: 350_000, color: '#0550ae' },
  { code: 'MINT', name: '薄荷饮料', sector: '消费', basePrice: 24.8, volatility: 0.014, drift: 0.0016, dividendYield: 0.013, baseVolume: 1_020_000, color: '#2da44e' },
  { code: 'VOLT', name: '伏特电池', sector: '新能源', basePrice: 142.3, volatility: 0.033, drift: 0.0028, dividendYield: 0.005, baseVolume: 480_000, color: '#bc4c00' },
  { code: 'ORCA', name: '虎鲸互娱', sector: '游戏', basePrice: 41.6, volatility: 0.038, drift: 0.0042, dividendYield: 0.003, baseVolume: 730_000, color: '#6e40c9' },
]

export interface StockCandle {
  /** 日期键（Asia/Shanghai，YYYY-MM-DD） */
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface StockQuoteDto {
  code: string
  name: string
  sector: string
  color: string
  /** 最新价 */
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  /** 涨跌额 */
  change: number
  /** 涨跌幅（百分比数值，如 1.23 表示 +1.23%） */
  changePct: number
  volume: number
  /** 每日分红收益率（0.008 = 0.8%/日，隔夜持仓按市值发放） */
  dividendYield: number
  /**
   * 当日新闻事件（仅实时行情 getLiveQuote / buildLiveMarket 填写；
   * 日线构建器 buildStockMarket 没有「当前时刻」概念，因此不产生该字段）
   */
  news?: StockNewsItemDto[]
}

/** 新闻事件对外的展示形态（未触发的未来事件同样下发，但不透露冲击幅度） */
export interface StockNewsItemDto {
  /** 稳定 id：`${code}-${dateKey}-${index}` */
  id: string
  title: string
  summary: string
  sentiment: 'good' | 'bad'
  /** 触发 tick（1..28799），前端画分时标记用 startTick × tickMs */
  startTick: number
  /** 触发时刻 ISO（真实时间轴上的一刻） */
  startAt: string
  /** 初始冲击幅度（带符号，good 正 bad 负；未触发时前端不用它渲染幅度） */
  impact: number
  /** 冲击半衰期（毫秒），前端算「剩余强度」进度条 */
  halfLifeMs: number
  /** 当前冲击幅度（带符号小数；未触发或已衰减 ≈ 0 时为 0） */
  currentImpact: number
  /** 是否已触发 */
  active: boolean
}

export interface StockMarketDto {
  dateKey: string
  /**
   * 实时 tick 引擎信息（由 stockTicks.buildLiveMarket 填写）：
   * tickMs = 行情刷新间隔毫秒、tickIndex = 当日第几个 tick、updatedAt = 报价时间 ISO。
   * 日线构建器 buildStockMarket 不产生这三个字段（历史走势本身不含实时状态）。
   */
  tickMs?: number
  tickIndex?: number
  updatedAt?: string
  /** 交易日固定为请求日 */
  currency: string
  disclaimer: string
  /** 交易规则（手续费率 / 单笔投入上下限） */
  trade: {
    feeRate: number
    minInvest: number
    maxInvest: number
  }
  /** 全部股票今日涨跌幅的算术平均 */
  marketChangePct: number
  /**
   * 大盘指数点位（仅实时行情填写）：基准 1000 × (1 + marketChangePct/100)。
   * 用「平均涨跌幅」而不是市值加权，是为了让 12 只虚构股票的权重一致、口径可解释。
   */
  index?: number
  /** 市场情绪（仅实时行情填写）：平均涨跌 > +0.6% 牛、< −0.6% 熊，其余震荡 */
  marketMood?: StockMarketMood
  stocks: StockQuoteDto[]
}

export type StockMarketMood = 'bull' | 'flat' | 'bear'

/** mulberry32：小而稳的确定性 PRNG，返回 [0, 1) */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32 位哈希：把字符串种子转成数字 */
export function seedFromString(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 日期键（YYYY-MM-DD）→ 当日 UTC 0 点毫秒（Asia/Shanghai 0 点 = 该值 − 8 小时） */
export function dateKeyToUtc(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map((part) => Number(part))
  return Date.UTC(year, (month || 1) - 1, day || 1)
}

/** UTC 毫秒 → 日期键（YYYY-MM-DD） */
export function utcToDateKey(ms: number): string {
  const date = new Date(ms)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 与纪元相差的自然日数（请求早于纪元时按 0 处理） */
export function dayIndexSinceEpoch(dateKey: string): number {
  const days = Math.round((dateKeyToUtc(dateKey) - dateKeyToUtc(STOCK_EPOCH)) / 86_400_000)
  return Math.max(0, days)
}

interface SimulatedDay {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

/**
 * 从纪元开始把某只股票走到 targetIndex，返回最后 `days` 天的 K 线。
 * 每日随机数顺序固定（开盘扰动 → 收益 → 上下影线 → 成交量），
 * 因此加字段会改变历史，需同步调整自检基线。
 *
 * 2026-11 调整：均值回归系数 0.02 → 0.004。旧值把价格死死拉回 basePrice，
 * 正向漂移被抵消（30 日收益 ≈ 0），叠加手续费后玩家长期持有必亏；
 * 降到 0.004 后单日漂移能累积成可见的长期趋势，同时价格仍然不会无限偏离起点
 * （回归项仍提供软天花板，-4%/日的极端偏离一天就能拉回约 16% 的反向修正）。
 */
function simulateStock(definition: StockDefinition, targetIndex: number, days: number): SimulatedDay[] {
  const rng = mulberry32(seedFromString(`lineweb-stock:${definition.code}`))
  const series: SimulatedDay[] = []
  let price = definition.basePrice
  const startIndex = Math.max(0, targetIndex - days + 1)
  const epochMs = dateKeyToUtc(STOCK_EPOCH)

  for (let index = 0; index <= targetIndex; index += 1) {
    const openNoise = (rng() - 0.5) * definition.volatility * 0.8
    const open = Math.max(0.5, price * (1 + openNoise))
    const shock = rng() + rng() - 1
    const meanReversion = Math.log(definition.basePrice / Math.max(0.5, open)) * 0.004
    const returnRate = definition.drift + definition.volatility * shock + meanReversion
    const close = Math.max(0.5, open * (1 + returnRate))
    const wick = definition.volatility * (0.3 + rng() * 0.9)
    const high = Math.max(open, close) * (1 + wick)
    const low = Math.min(open, close) * (1 - wick)
    const volume = Math.round(
      definition.baseVolume * (0.55 + rng() * 1.1) * (1 + Math.abs(returnRate) * 12),
    )

    if (index >= startIndex) {
      series.push({
        date: utcToDateKey(epochMs + index * 86_400_000),
        open: round2(open),
        high: round2(high),
        low: round2(low),
        close: round2(close),
        volume,
      })
    }
    price = close
  }

  return series
}

function quoteOf(definition: StockDefinition, series: SimulatedDay[]): StockQuoteDto {
  const today = series[series.length - 1]
  const yesterday = series[series.length - 2] ?? today
  const prevClose = yesterday.close
  const change = round2(today.close - prevClose)
  const changePct = prevClose > 0 ? Math.round((change / prevClose) * 10_000) / 100 : 0

  return {
    code: definition.code,
    name: definition.name,
    sector: definition.sector,
    color: definition.color,
    price: today.close,
    prevClose,
    open: today.open,
    high: today.high,
    low: today.low,
    change,
    changePct,
    volume: today.volume,
    dividendYield: definition.dividendYield,
  }
}

/** 取某只股票截至 dateKey 的近 30 根日线（含今日），供秒级 tick 引擎取锚点 / 前端画日 K */
export function getStockDailySeries(definition: StockDefinition, dateKey: string): StockCandle[] {
  return simulateStock(definition, dayIndexSinceEpoch(dateKey), STOCK_HISTORY_DAYS)
}

/** 行情免责声明（日线构建器与实时 tick 引擎共用同一文案） */
export const STOCK_MARKET_DISCLAIMER =
  '模拟行情，全部数据虚构；可用积分投资，行情每 3 秒刷新（买卖各收 0.3% 手续费）；隔夜持仓享每日分红，新闻事件会带来短时冲击；玩家交易会小幅影响价格。'

/**
 * 构建某一天的全市场「日线行情」（纯函数，同参数同结果）。
 * 仅作为日线构建器保留（自检 / 日线断言用）；对外 API 走 stockTicks.buildLiveMarket。
 */
export function buildStockMarket(dateKey: string): StockMarketDto {
  const targetIndex = dayIndexSinceEpoch(dateKey)
  const stocks = STOCK_DEFINITIONS.map((definition) =>
    quoteOf(definition, simulateStock(definition, targetIndex, STOCK_HISTORY_DAYS)),
  )
  const marketChangePct = stocks.length === 0
    ? 0
    : Math.round((stocks.reduce((sum, stock) => sum + stock.changePct, 0) / stocks.length) * 100) / 100

  return {
    dateKey,
    currency: '模拟币',
    disclaimer: STOCK_MARKET_DISCLAIMER,
    trade: {
      feeRate: STOCK_FEE_RATE,
      minInvest: STOCK_MIN_INVEST,
      maxInvest: STOCK_MAX_INVEST,
    },
    marketChangePct,
    stocks,
  }
}
