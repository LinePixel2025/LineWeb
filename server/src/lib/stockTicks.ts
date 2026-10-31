/**
 * 股市实时 tick 行情引擎（纯计算层，禁止 import prisma / 网络依赖）。
 *
 * 三层价格模型：
 * 1. 日线锚点（不动）：stockMarket.ts 的确定性日生成器照旧给出每日 open/close，
 *   历史 K 线零变化；秒级基准路径在「今日 open → 今日 close」之间线性插值作为锚点；
 * 2. 秒级基准路径 basePath(tick) = anchor(tick) × (1 + noise(tick))：noise 为
 *   OU 式均值回归随机游走（按 (code, dateKey) 播种，噪声起始为 0），同参数重算
 *   完全一致 —— 重启后从 tick 0 重算（毫秒级），重启价格零跳变；
 * 3. 玩家冲击 impact：买入推高 / 卖出压低价格，读时按 10 分钟半衰期指数衰减
 *   （无定时器）。状态通过 SiteSetting('stock.marketImpact') 持久化，
 *   prisma 读写放在 stockService.ts，本文件只提供序列化 / 恢复纯函数。
 *
 * 实时价 = basePath(当前 tick) × (1 + impact)，每次报价实时计算（不走物化缓存），
 * 因此成交后下一次报价立即反映冲击。内存只保留当前日的 tick 缓存
 * （每股 2 × Float64Array(28800) ≈ 460KB），跨日整包重建。
 */

import {
  STOCK_DEFINITIONS,
  STOCK_MARKET_DISCLAIMER,
  getStockDailySeries,
  mulberry32,
  seedFromString,
  dateKeyToUtc,
  type StockCandle,
  type StockDefinition,
  type StockMarketDto,
  type StockQuoteDto,
} from './stockMarket.js'
import { STOCK_FEE_RATE, STOCK_MAX_INVEST, STOCK_MIN_INVEST } from './stockTrading.js'
import { getTodayDateKey } from './pointsRules.js'

/** 行情 tick 间隔（毫秒）：每 3 秒推进一个报价 */
export const STOCK_TICK_MS = 3000
/** 每日 tick 数 = 86_400_000 / STOCK_TICK_MS = 28800 */
export const STOCK_TICKS_PER_DAY = 86_400_000 / STOCK_TICK_MS

/* ============================================================
   玩家冲击参数
   ============================================================ */

/** 冲击系数：每 1 万积分买入 ≈ +0.2%（卖出按毛收入等量反向） */
export const STOCK_IMPACT_PER_POINT = 2e-7
/** 冲击幅度上下限（±5%） */
export const STOCK_IMPACT_MAX = 0.05
/** 冲击半衰期：10 分钟（读时惰性衰减，无定时器） */
export const STOCK_IMPACT_HALF_LIFE_MS = 600_000
/** 冲击状态在 SiteSetting 表中的持久化键 */
export const IMPACT_STATE_SETTING_KEY = 'stock.marketImpact'

/* ============================================================
   噪声参数（OU 式均值回归）
   ============================================================ */

/** 噪声每步衰减系数（0.993 → 相关时间约 143 tick ≈ 7 分钟） */
const STOCK_NOISE_DECAY = 0.993
/** 价格下限（与日线生成器一致） */
const STOCK_PRICE_FLOOR = 0.5
/** 分时采样间隔：每 20 tick（60 秒）一点 */
export const STOCK_INTRADAY_SAMPLE_TICKS = 20

/* ============================================================
   纯函数（供自检直接测试）
   ============================================================ */

/** 冲击读时衰减：value × 0.5^(elapsedMs / 半衰期)，elapsed 取 0 下限（防时钟回拨） */
export function decayImpact(value: number, elapsedMs: number): number {
  const elapsed = Math.max(0, elapsedMs)
  return value * Math.pow(0.5, elapsed / STOCK_IMPACT_HALF_LIFE_MS)
}

/** 冲击幅度夹紧到 ±STOCK_IMPACT_MAX */
export function clampImpact(value: number): number {
  return Math.max(-STOCK_IMPACT_MAX, Math.min(STOCK_IMPACT_MAX, value))
}

/** 买入冲击：现值 + points × 系数后夹紧（points ≤ 0 视为无冲击） */
export function applyBuyImpact(value: number, points: number): number {
  if (!(points > 0)) return clampImpact(value)
  return clampImpact(value + points * STOCK_IMPACT_PER_POINT)
}

/** 卖出冲击：现值 − gross × 系数后夹紧（gross ≤ 0 视为无冲击） */
export function applySellImpact(value: number, gross: number): number {
  if (!(gross > 0)) return clampImpact(value)
  return clampImpact(value - gross * STOCK_IMPACT_PER_POINT)
}

/* ============================================================
   冲击状态（模块级，每股票一个标量）
   ============================================================ */

interface ImpactState {
  /** 当前冲击幅度（带符号） */
  value: number
  /** 上次衰减 / 写入的时刻（毫秒），读时按差值衰减 */
  atMs: number
}

const impactStates = new Map<string, ImpactState>()
let impactDirty = false

/** 读某只股票的当前冲击（读时惰性衰减并回写，避免定时器） */
export function getImpact(code: string, nowMs: number): number {
  const state = impactStates.get(code.toUpperCase())
  if (!state || state.value === 0) return 0
  const decayed = decayImpact(state.value, nowMs - state.atMs)
  state.value = decayed
  state.atMs = nowMs
  return decayed
}

/**
 * 记一笔玩家交易冲击：买入传 +投入积分、卖出传 −毛收入。
 * 先按 nowMs 衰减旧值，再叠加 delta × 系数并夹紧，最后标记脏（待 stockService 落盘）。
 */
export function applyTradeImpactDelta(code: string, delta: number, nowMs: number): void {
  const key = code.toUpperCase()
  const current = getImpact(key, nowMs)
  impactStates.set(key, { value: clampImpact(current + delta * STOCK_IMPACT_PER_POINT), atMs: nowMs })
  impactDirty = true
}

/**
 * 序列化冲击状态（供 stockService 写入 SiteSetting）。
 * 先把全部冲击统一衰减到 nowMs 再落盘，恢复时用 savedAt 与现在的差值续算衰减。
 */
export function serializeImpactState(nowMs: number): string {
  const impacts: Record<string, number> = {}
  for (const [code, state] of impactStates) {
    const decayed = decayImpact(state.value, nowMs - state.atMs)
    state.value = decayed
    state.atMs = nowMs
    impacts[code] = decayed
  }
  return JSON.stringify({ savedAt: nowMs, impacts })
}

/**
 * 从 SiteSetting 的 value 恢复冲击状态（重启后调用一次）。
 * 容错约定：json 为 null / 解析失败 / 缺字段 / 数值非法 → 一律重置为 0；
 * savedAt 缺失或非法时视为「现在」，避免旧格式数据被瞬间大衰减。
 */
export function loadImpactStateFromJson(json: string | null, nowMs: number): void {
  impactStates.clear()
  impactDirty = false
  if (!json) return
  let savedAt = nowMs
  let entries: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(json) as { savedAt?: unknown; impacts?: unknown }
    if (typeof parsed?.savedAt === 'number' && Number.isFinite(parsed.savedAt)) {
      savedAt = parsed.savedAt
    }
    if (parsed?.impacts && typeof parsed.impacts === 'object') {
      entries = parsed.impacts as Record<string, unknown>
    }
  } catch {
    return // 解析失败：上面已 clear，全部置 0
  }
  const elapsed = nowMs - savedAt
  for (const [code, value] of Object.entries(entries)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    impactStates.set(code.toUpperCase(), { value: clampImpact(decayImpact(value, elapsed)), atMs: nowMs })
  }
}

/**
 * 是否有未落盘的冲击变动。
 * 当前每笔交易即时落盘、该标记仅供自检脚本断言使用；保留给未来的周期性批量落盘，勿删。
 */
export function isImpactDirty(): boolean {
  return impactDirty
}

/** 冲击状态已成功写入 SiteSetting 后清除脏标记 */
export function markImpactPersisted(): void {
  impactDirty = false
}

/* ============================================================
   秒级基准路径（按日缓存，惰性延展）
   ============================================================ */

interface TickStockState {
  /** 秒级基准路径（不含玩家冲击） */
  basePath: Float64Array
  /** 物化价快照：延展时逐 tick 记录 basePath × (1 + 当时 impact)，供分时图采样 */
  materialized: Float64Array
  /** 已填充的最大 tick（含）；−1 = 尚未开始 */
  filled: number
  /** OU 噪声当前值（tick 0 恒为 0） */
  noise: number
  /** 噪声与虚拟成交量共用的 rng（每 (code, dateKey) 独立播种，取数顺序固定） */
  rng: () => number
  /** 每 tick 噪声步长（由日波动率换算，ensureDay 时算好） */
  sigmaTick: number
  /** 上一 tick 基准价（成交量扰动用） */
  prevBase: number
  todayOpen: number
  todayClose: number
  prevClose: number
  baseVolume: number
  /** 盘中跟踪的最高 / 最低（物化价并入最新实时价） */
  high: number
  low: number
  /** 盘中累计虚拟成交量 */
  volumeAcc: number
}

/** 日缓存：只保留当前日，换日整包重建（跨日由 GC 回收旧数组） */
let dayCache: { dateKey: string; stocks: Map<string, TickStockState> } | null = null

function ensureDay(dateKey: string): Map<string, TickStockState> {
  if (dayCache && dayCache.dateKey === dateKey) return dayCache.stocks
  const stocks = new Map<string, TickStockState>()
  for (const definition of STOCK_DEFINITIONS) {
    const series = getStockDailySeries(definition, dateKey)
    const today = series[series.length - 1]
    const yesterday = series[series.length - 2] ?? today
    stocks.set(definition.code, {
      basePath: new Float64Array(STOCK_TICKS_PER_DAY),
      materialized: new Float64Array(STOCK_TICKS_PER_DAY),
      filled: -1,
      noise: 0,
      rng: mulberry32(seedFromString(`lineweb-stock-tick:${definition.code}:${dateKey}`)),
      // σ_tick = 日波动率 × √(tick 占全日比例) × 2（经验系数，噪声日内幅度约 ±0.5%）
      sigmaTick: definition.volatility * Math.sqrt(STOCK_TICK_MS / 86_400_000) * 2,
      prevBase: today.open,
      todayOpen: today.open,
      todayClose: today.close,
      prevClose: yesterday.close,
      baseVolume: definition.baseVolume,
      high: -Infinity,
      low: Infinity,
      volumeAcc: 0,
    })
  }
  dayCache = { dateKey, stocks }
  return stocks
}

/** 锚点：今日 open 与 close 之间按 tick 线性过渡（t = TICKS_PER_DAY − 1 时恰为 close） */
function anchorAt(state: TickStockState, tick: number): number {
  return state.todayOpen + (state.todayClose - state.todayOpen) * (tick / (STOCK_TICKS_PER_DAY - 1))
}

/**
 * 惰性延展基准路径到目标 tick。rng 取数顺序固定：t > 0 时噪声 2 次，之后成交量 1 次；
 * materialized 用「延展时刻」的 impact 盖章（分时图近似：历史点的冲击不回溯重算）。
 */
function extendTo(state: TickStockState, tick: number, impact: number): void {
  if (tick <= state.filled) return
  for (let t = state.filled + 1; t <= tick; t += 1) {
    if (t > 0) {
      // OU 式均值回归：三角分布增量（rng() + rng() − 1 ∈ [−1, 1]）
      state.noise = state.noise * STOCK_NOISE_DECAY + state.sigmaTick * (state.rng() + state.rng() - 1)
    }
    const base = Math.max(STOCK_PRICE_FLOOR, round2(anchorAt(state, t) * (1 + state.noise)))
    state.basePath[t] = base
    const materialized = Math.max(STOCK_PRICE_FLOOR, round2(base * (1 + impact)))
    state.materialized[t] = materialized
    if (materialized > state.high) state.high = materialized
    if (materialized < state.low) state.low = materialized
    // 虚拟成交量（确定性）：日基础量按 tick 均摊，随机 0.5–1.5 倍，
    // 再按该 tick 基准价变动加成（|Δbase/base| 每 0.1% 放大 4%，封顶 5 倍）
    const deltaRatio = state.prevBase > 0 ? (base - state.prevBase) / state.prevBase : 0
    state.volumeAcc +=
      state.baseVolume * (STOCK_TICK_MS / 86_400_000) * (0.5 + state.rng()) * Math.min(5, 1 + Math.abs(deltaRatio) * 40)
    state.prevBase = base
  }
  state.filled = tick
}

/** 当日第几个 tick（0..28799）；nowMs 早于当日 0 点按 0 处理（Asia/Shanghai 0 点 = UTC 前一日 16:00） */
export function tickIndexOf(dateKey: string, nowMs: number): number {
  const dayStartMs = dateKeyToUtc(dateKey) - 8 * 3600 * 1000
  const tick = Math.floor((nowMs - dayStartMs) / STOCK_TICK_MS)
  return Math.max(0, Math.min(STOCK_TICKS_PER_DAY - 1, tick))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** 单只股票的实时报价（实时价 = basePath × (1 + impact)，现算，不走物化缓存） */
export function getLiveQuote(definition: StockDefinition, dateKey: string, nowMs: number = Date.now()): StockQuoteDto {
  const state = ensureDay(dateKey).get(definition.code)
  if (!state) throw new Error(`stockTicks: 未知股票 ${definition.code}`)
  const tick = tickIndexOf(dateKey, nowMs)
  const impact = getImpact(definition.code, nowMs)
  extendTo(state, tick, impact)

  const price = Math.max(STOCK_PRICE_FLOOR, round2(state.basePath[tick] * (1 + impact)))
  if (price > state.high) state.high = price
  if (price < state.low) state.low = price
  const change = round2(price - state.prevClose)
  const changePct = state.prevClose > 0 ? Math.round((change / state.prevClose) * 10_000) / 100 : 0

  return {
    code: definition.code,
    name: definition.name,
    sector: definition.sector,
    color: definition.color,
    price,
    prevClose: state.prevClose,
    // 开盘价取 tick 0 的基准路径（噪声起始为 0 → 恰为日线今日开盘，不含冲击、确定性）
    open: state.basePath[0],
    high: state.high,
    low: state.low,
    change,
    changePct,
    volume: Math.round(state.volumeAcc),
  }
}

/** 按代码取实时报价（code 大写归一，未知代码返回 null） */
export function getLiveQuoteByCode(code: string, nowMs: number = Date.now()): StockQuoteDto | null {
  const normalized = code.trim().toUpperCase()
  const definition = STOCK_DEFINITIONS.find((item) => item.code === normalized)
  if (!definition) return null
  return getLiveQuote(definition, getTodayDateKey(nowMs), nowMs)
}

/** 全市场实时行情（对外 GET /api/stocks/market 的响应体） */
export function buildLiveMarket(dateKey: string, nowMs: number = Date.now()): StockMarketDto {
  const tickIndex = tickIndexOf(dateKey, nowMs)
  const stocks = STOCK_DEFINITIONS.map((definition) => getLiveQuote(definition, dateKey, nowMs))
  const marketChangePct = stocks.length === 0
    ? 0
    : Math.round((stocks.reduce((sum, stock) => sum + stock.changePct, 0) / stocks.length) * 100) / 100

  return {
    dateKey,
    tickMs: STOCK_TICK_MS,
    tickIndex,
    updatedAt: new Date(nowMs).toISOString(),
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

export interface StockIntradayPoint {
  /** 当日 00:00（Asia/Shanghai）以来的毫秒 */
  t: number
  price: number
}

export interface StockTrendDto {
  code: string
  name: string
  dateKey: string
  tickMs: number
  /** 近 30 根日线（含今日：今日 high/low/close/volume 为实时跟踪值） */
  daily: StockCandle[]
  /** 今日分时：每 60 秒（20 tick）一点 + 最新实时点 */
  intraday: StockIntradayPoint[]
}

/** 单只股票的日线 + 当日分时（对外 GET /api/stocks/market/trend 的响应体） */
export function buildStockTrend(
  definition: StockDefinition,
  dateKey: string,
  nowMs: number = Date.now(),
): StockTrendDto {
  const quote = getLiveQuote(definition, dateKey, nowMs)
  const tick = tickIndexOf(dateKey, nowMs)
  const daily = getStockDailySeries(definition, dateKey)
  // 今日 K 线用实时值替换：open = 秒级开盘，high/low = 盘中跟踪值（已并入最新价）
  daily[daily.length - 1] = {
    date: dateKey,
    open: quote.open,
    high: quote.high,
    low: quote.low,
    close: quote.price,
    volume: quote.volume,
  }

  // 分时：物化快照每 20 tick 采样，最后补一个最新实时点（t 严格递增）
  const state = ensureDay(dateKey).get(definition.code)
  if (!state) throw new Error(`stockTicks: 未知股票 ${definition.code}`)
  const intraday: StockIntradayPoint[] = []
  for (let t = 0; t < tick; t += STOCK_INTRADAY_SAMPLE_TICKS) {
    intraday.push({ t: t * STOCK_TICK_MS, price: round2(state.materialized[t]) })
  }
  intraday.push({ t: tick * STOCK_TICK_MS, price: quote.price })

  return {
    code: definition.code,
    name: definition.name,
    dateKey,
    tickMs: STOCK_TICK_MS,
    daily,
    intraday,
  }
}

/** 清空日缓存与冲击状态（自检脚本跨用例隔离用，生产代码不得调用） */
export function resetTicksForTest(): void {
  dayCache = null
  impactStates.clear()
  impactDirty = false
}
