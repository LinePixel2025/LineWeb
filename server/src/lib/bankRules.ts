/**
 * 银行系统规则（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 三块业务：
 * - 活期存款：年化 2%，按自然日计息、向下取整；利息在读时惰性结算（无定时器），
 *   结算水位 lastInterestDateKey 落后超过 365 天按 365 封顶（防补天量利息）；
 * - 定期存款：7d / 30d / 90d 三档，开单锁定年化利率；到期按 `floor(本金 × 年化 × 天数/365)`
 *   全额计息，提前支取按活期日利率 × 已过天数计息（利息为 0 也不亏本金）；
 * - 基金投资：3 只虚构基金，NAV 从固定纪元起逐日复利（同日恒定、跨日确定），
 *   买入 / 卖出各收 0.25% 手续费，份额允许小数。
 *
 * 确定性随机数（mulberry32 / seedFromString）与日期键工具复用股市的 stockMarket.ts。
 * 交易纯函数风格向 stockTrading.ts 看齐；dateKey 复用 pointsRules 的 getTodayDateKey。
 */

import { dateKeyToUtc, mulberry32, seedFromString, utcToDateKey } from './stockMarket.js'

/* ============================================================
   常量
   ============================================================ */

/** 活期年化利率（2%） */
export const DEMAND_ANNUAL_RATE = 0.02
/** 活期日利率（年化 ÷ 365） */
export const DEMAND_DAILY_RATE = DEMAND_ANNUAL_RATE / 365

export interface BankFixedTerm {
  key: string
  label: string
  days: number
  annualRate: number
}

/** 定期期限档（key 是 BankDeposit.termKey 与前端选择的稳定标识） */
export const FIXED_TERMS: readonly BankFixedTerm[] = [
  { key: '7d', label: '7天', days: 7, annualRate: 0.05 },
  { key: '30d', label: '30天', days: 30, annualRate: 0.1 },
  { key: '90d', label: '90天', days: 90, annualRate: 0.18 },
]

/** 买卖基金的单边手续费率（0.25%） */
export const FUND_FEE_RATE = 0.0025
/** 单笔存款 / 基金投入的最少积分 */
export const BANK_MIN_AMOUNT = 100
/** 单笔存款 / 基金投入的最多积分 */
export const BANK_MAX_AMOUNT = 100_000
/** 活期利息水位封顶天数（水位落后超过该值时按该值计息，防补天量利息） */
export const DEMAND_INTEREST_MAX_DAYS = 365

/** 基金净值纪元：从这天起逐日复利，起始 NAV = 1 */
export const FUND_EPOCH_DATE_KEY = '2026-01-01'
/** NAV 下限（极端连续下跌时兜底，避免净值归零） */
export const FUND_NAV_FLOOR = 0.01
/** 均值回归强度：日拉力 = 强度 × ln(目标线 / 当前净值)，净值不会长期偏离 drift 线 */
export const FUND_MEAN_REVERSION = 0.05
/** 单日均值回归拉力上限（防深坑后单日暴力拉回） */
export const FUND_ANCHOR_MAX_PULL = 0.02

export interface BankFundDefinition {
  code: string
  name: string
  emoji: string
  /** 年化漂移（长期趋势，正数；进入日收益率 = drift/365 + 冲击） */
  annualDrift: number
  /** 日波动率（0–1，冲击 = (rng×2−1) × 波动，再 clamp ±3×波动） */
  dailyVolatility: number
  /** 前端徽标主色（走势线颜色按涨跌红绿走，仅用于标识） */
  color: string
}

/** 基金目录（3 只虚构基金，code 是 FundHolding.fundCode 的稳定标识） */
export const BANK_FUNDS: readonly BankFundDefinition[] = [
  { code: 'fund_stable', name: '稳健货币', emoji: '🛟', annualDrift: 0.04, dailyVolatility: 0.004, color: '#1a7f37' },
  { code: 'fund_balanced', name: '均衡混合', emoji: '⚖️', annualDrift: 0.1, dailyVolatility: 0.012, color: '#1f6feb' },
  { code: 'fund_growth', name: '进取股票', emoji: '🚀', annualDrift: 0.18, dailyVolatility: 0.028, color: '#bc4c00' },
]

/** 按代码取期限档（不存在返回 undefined，service 层报 400） */
export function bankFixedTermOf(key: string): BankFixedTerm | undefined {
  return FIXED_TERMS.find((term) => term.key === key)
}

/** 按代码取基金（不存在返回 undefined，service 层报 404） */
export function bankFundOf(code: string): BankFundDefinition | undefined {
  return BANK_FUNDS.find((fund) => fund.code === code)
}

/* ============================================================
   日期键工具（Asia/Shanghai YYYY-MM-DD）
   ============================================================ */

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * 两个日期键的自然日差（to − from）。
 * 两者都应是 Asia/Shanghai 的 YYYY-MM-DD；直接按 UTC 0 点解析相减，
 * 不涉及时区偏移。任一 key 非法（空串 / 坏数据）返回 NaN，调用方必须判 NaN。
 */
export function diffDateKeys(fromKey: string, toKey: string): number {
  if (typeof fromKey !== 'string' || typeof toKey !== 'string') return Number.NaN
  if (!DATE_KEY_RE.test(fromKey) || !DATE_KEY_RE.test(toKey)) return Number.NaN
  const from = dateKeyToUtc(fromKey)
  const to = dateKeyToUtc(toKey)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.NaN
  return Math.round((to - from) / 86_400_000)
}

/** 日期键平移 n 天（n 可为负）；key 非法时原样返回 */
export function shiftDateKey(dateKey: string, days: number): string {
  if (typeof dateKey !== 'string' || !DATE_KEY_RE.test(dateKey)) return dateKey
  return utcToDateKey(dateKeyToUtc(dateKey) + days * 86_400_000)
}

/* ============================================================
   金额钳制
   ============================================================ */

/**
 * 把任意输入钳制成合法的存款 / 投资金额（整数积分，BANK_MIN_AMOUNT–BANK_MAX_AMOUNT）。
 * 非法（非数字 / NaN / 越界 / 过小）一律返回 NaN，由 service 层统一报
 * 400 BANK_AMOUNT_INVALID；小数会被向下取整（100.9 → 100）。
 */
export function clampBankAmount(input: unknown): number {
  const n = typeof input === 'number' ? input : Number(input)
  if (!Number.isFinite(n)) return Number.NaN
  const amount = Math.trunc(n)
  if (amount < BANK_MIN_AMOUNT || amount > BANK_MAX_AMOUNT) return Number.NaN
  return amount
}

/* ============================================================
   利息计算
   ============================================================ */

/**
 * 活期利息：自然日差 × 余额 × 日利率，向下取整。
 * 天数非法 / ≤ 0 或余额 ≤ 0 时利息为 0。
 */
export function calcDemandInterest(balance: number, fromKey: string, toKey: string): number {
  const days = diffDateKeys(fromKey, toKey)
  if (!Number.isFinite(days) || days <= 0) return 0
  if (!Number.isFinite(balance) || balance <= 0) return 0
  return Math.floor(Math.trunc(balance) * DEMAND_DAILY_RATE * days)
}

/**
 * 定期到期利息：floor(本金 × 年化利率 × 天数 / 365)。
 * days 用期限档的全额天数；利率为开单时锁定的 annualRate。
 */
export function calcFixedInterest(principal: number, annualRate: number, days: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0
  if (!Number.isFinite(annualRate) || annualRate <= 0) return 0
  if (!Number.isFinite(days) || days <= 0) return 0
  return Math.floor(Math.trunc(principal) * annualRate * Math.trunc(days) / 365)
}

/**
 * 定期提前支取利息：floor(本金 × 活期日利率 × 已过天数)。
 * elapsedDays 小于等于 0 按 0 处理（当天开单当天取 = 无利息，本金不受影响）。
 */
export function calcEarlyWithdrawInterest(principal: number, elapsedDays: number): number {
  if (!Number.isFinite(principal) || principal <= 0) return 0
  if (!Number.isFinite(elapsedDays) || elapsedDays <= 0) return 0
  return Math.floor(Math.trunc(principal) * DEMAND_DAILY_RATE * Math.trunc(elapsedDays))
}

export interface DemandSettlement {
  /** 实际计息天数（水位落后超过 365 天时封顶为 365） */
  days: number
  /** 本次应发利息（向下取整，可能为 0） */
  interest: number
  /** 参与计息的起始水位（封顶时已前移到 today − 365 天） */
  fromKey: string
}

/**
 * 活期利息惰性结算（纯函数，service 层在事务内调用后把水位推进到今天）：
 * - 水位非法（空串 / 坏数据）→ 不补息，service 把水位重置为今天；
 * - 水位 ≥ 今天 → 天数 0，无需结算；
 * - 水位落后 > 365 天 → 按 365 天封顶，fromKey 前移到 today − 365。
 * 注意：interest 为 0 时水位同样要推进（service 负责推进）。
 */
export function calcDemandSettlement(balance: number, lastKey: string, todayKey: string): DemandSettlement {
  const days = diffDateKeys(lastKey, todayKey)
  if (!Number.isFinite(days) || days <= 0) {
    return { days: 0, interest: 0, fromKey: lastKey }
  }
  if (days <= DEMAND_INTEREST_MAX_DAYS) {
    return { days, interest: calcDemandInterest(balance, lastKey, todayKey), fromKey: lastKey }
  }
  const fromKey = shiftDateKey(todayKey, -DEMAND_INTEREST_MAX_DAYS)
  return {
    days: DEMAND_INTEREST_MAX_DAYS,
    interest: calcDemandInterest(balance, fromKey, todayKey),
    fromKey,
  }
}

/* ============================================================
   基金 NAV（同日恒定、跨日确定）
   ============================================================ */

/** NAV 统一保留 4 位小数（基金行业惯例） */
export function roundNav(nav: number): number {
  return Math.round(nav * 10_000) / 10_000
}

/** 基金净值序列点（date 为日期键，nav 已保留 4 位小数） */
export interface FundNavPoint {
  date: string
  nav: number
}

/**
 * 某只基金某天的日收益率：drift/365 + 对称随机冲击 + 均值回归拉力。
 * 种子 `lineweb-fund:<code>:<dateKey>`，同一天多次调用结果完全一致；
 * 冲击 clamp 在 ±3×日波动内（单日涨跌有界）。
 * `anchorDeviation`（可选）= ln(目标线 / 当前净值)：偏离 drift 目标线越远，
 * 向目标线拉力越强，避免纯随机游走长期复利走出 ±50% 的极端路径（玩家会当成 bug）。
 */
export function fundDailyReturn(code: string, dateKey: string, anchorDeviation = 0): number {
  const fund = bankFundOf(code)
  if (!fund) throw new Error(`未知基金代码：${code}`)
  const rng = mulberry32(seedFromString(`lineweb-fund:${code}:${dateKey}`))
  const shock = (rng() * 2 - 1) * fund.dailyVolatility
  const bound = 3 * fund.dailyVolatility
  const bounded = Math.max(-bound, Math.min(bound, shock))
  const pull = Math.max(-FUND_ANCHOR_MAX_PULL, Math.min(FUND_ANCHOR_MAX_PULL, FUND_MEAN_REVERSION * anchorDeviation))
  return fund.annualDrift / 365 + bounded + pull
}

/**
 * 某只基金截至 dateKey 的 NAV：从纪元（FUND_EPOCH_DATE_KEY，NAV = 1）逐日复利。
 * dateKey 早于纪元时返回起始净值 1；code 必须在 BANK_FUNDS 内（否则抛错）。
 */
export function fundNavOn(code: string, dateKey: string): number {
  const fund = bankFundOf(code)
  if (!fund) throw new Error(`未知基金代码：${code}`)
  const dayIndex = diffDateKeys(FUND_EPOCH_DATE_KEY, dateKey)
  if (!Number.isFinite(dayIndex) || dayIndex <= 0) return 1
  const epochMs = dateKeyToUtc(FUND_EPOCH_DATE_KEY)
  let nav = 1
  for (let index = 1; index <= dayIndex; index += 1) {
    const dayKey = utcToDateKey(epochMs + index * 86_400_000)
    // 目标线 = 纪元起按年化漂移走的理论净值；偏离越远当日拉力越强（均值回归）
    const target = Math.exp(fund.annualDrift * index / 365)
    const deviation = Math.log(target / nav)
    nav = Math.max(FUND_NAV_FLOOR, nav * (1 + fundDailyReturn(code, dayKey, deviation)))
  }
  return nav
}

/**
 * 净值序列（画迷你走势用）：[fromDateKey, toDateKey] 逐日（含两端），
 * 早于纪元的部分收到纪元，窗口超过 30 天时只保留最近 30 天。
 * 单次从纪元复利，避免逐点调用 fundNavOn 的重复开销。
 */
export function fundNavSeries(code: string, fromDateKey: string, toDateKey: string): FundNavPoint[] {
  bankFundOf(code)
  const lastIndex = diffDateKeys(FUND_EPOCH_DATE_KEY, toDateKey)
  if (!Number.isFinite(lastIndex) || lastIndex < 0) return []
  let firstIndex = diffDateKeys(FUND_EPOCH_DATE_KEY, fromDateKey)
  if (!Number.isFinite(firstIndex) || firstIndex < 0) firstIndex = 0
  if (lastIndex - firstIndex > 29) firstIndex = lastIndex - 29

  const epochMs = dateKeyToUtc(FUND_EPOCH_DATE_KEY)
  const points: FundNavPoint[] = []
  let nav = 1
  const fund = bankFundOf(code)
  if (!fund) throw new Error(`未知基金代码：${code}`)
  for (let index = 0; index <= lastIndex; index += 1) {
    if (index > 0) {
      const dayKey = utcToDateKey(epochMs + index * 86_400_000)
      const target = Math.exp(fund.annualDrift * index / 365)
      const deviation = Math.log(target / nav)
      nav = Math.max(FUND_NAV_FLOOR, nav * (1 + fundDailyReturn(code, dayKey, deviation)))
    }
    if (index >= firstIndex) {
      points.push({ date: utcToDateKey(epochMs + index * 86_400_000), nav: roundNav(nav) })
    }
  }
  return points
}

/* ============================================================
   基金申赎报价
   ============================================================ */

export interface FundBuyQuote {
  /** 实际扣除的积分（= 用户输入预算） */
  points: number
  /** 手续费（积分，最少 1） */
  fee: number
  /** 扣费后真正折算份额的积分 */
  netPoints: number
  /** 成交净值 */
  nav: number
  /** 买入份额（可带小数） */
  shares: number
}

/** 买入报价：预算先按 0.25% 收手续费（最少 1 积分），再按当日净值折算份额 */
export function quoteFundBuy(points: number, nav: number): FundBuyQuote {
  const budget = Number.isFinite(points) && points > 0 ? Math.trunc(points) : 0
  const price = Number.isFinite(nav) && nav > 0 ? nav : 0
  const fee = budget > 0 ? Math.max(1, Math.ceil(budget * FUND_FEE_RATE)) : 0
  const netPoints = Math.max(0, budget - fee)
  const shares = price > 0 ? netPoints / price : 0
  return { points: budget, fee, netPoints, nav: price, shares }
}

export interface FundSellQuote {
  /** 卖出毛收入（份额 × 净值） */
  gross: number
  /** 手续费（积分，最少 1） */
  fee: number
  /** 实际到账积分（向下取整） */
  proceeds: number
  /** 成交净值 */
  nav: number
}

/** 卖出报价：毛收入扣 0.25% 手续费后向下取整到账（毛收入不足 1 积分时到账 0） */
export function quoteFundSell(shares: number, nav: number): FundSellQuote {
  const price = Number.isFinite(nav) && nav > 0 ? nav : 0
  const safeShares = Number.isFinite(shares) && shares > 0 ? shares : 0
  const gross = safeShares * price
  const fee = gross > 0 ? Math.max(1, Math.ceil(gross * FUND_FEE_RATE)) : 0
  const proceeds = Math.max(0, Math.floor(gross - fee))
  return { gross: Math.round(gross * 10_000) / 10_000, fee, proceeds, nav: price }
}

/**
 * 部分卖出的成本分摊：按卖出份额占总份额比例等比分摊（四舍五入），
 * 夹在 [0, costPoints]；整仓时恰好返回全部成本。与股市 splitCostForShares 同口径。
 */
export function splitFundCost(costPoints: number, shares: number, totalShares: number): number {
  if (!Number.isFinite(totalShares) || totalShares <= 0) return 0
  if (!Number.isFinite(shares) || shares <= 0) return 0
  const safeCost = Number.isFinite(costPoints) && costPoints > 0 ? Math.trunc(costPoints) : 0
  if (safeCost === 0) return 0
  const portion = Math.round((safeCost * shares) / totalShares)
  return Math.max(0, Math.min(safeCost, portion))
}
