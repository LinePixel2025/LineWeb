/**
 * 银行系统纯函数自检（不依赖数据库 / 环境变量 / 网络 / prisma）
 *
 * 覆盖：
 * - 常量与目录不变量：活期利率 / 定期三档（天数与利率递增）/ 基金三只（代码唯一、参数有界）；
 * - 日期键：diffDateKeys（跨月 / 闰年 / 跨年 / 非法输入 NaN）、shiftDateKey、与 getTodayDateKey 同格式；
 * - 金额钳制：clampBankAmount（范围 / 取整 / 非法输入 NaN）；
 * - 活期利息：向下取整、0 余额、非法水位、365 天封顶（calcDemandSettlement）；
 * - 定期利息：到期全额 vs 提前支取（提前 < 到期）、利率单调、非法输入；
 * - 基金 NAV：同日恒定（两次调用相等）、跨日确定（逐日手算一致）、日收益有界（≤ 3×波动 + 漂移）、
 *   序列窗口（14 天 / 30 天封顶 / 纪元前收紧 / 空序列）、未知代码抛错；
 * - 申赎费用数学：买入手续费 / 份额折算、卖出 proceeds 向下取整、往返必亏手续费、成本分摊。
 *
 * 用法: cd server && npm run verify:bank
 */

import {
  BANK_FUNDS,
  BANK_MAX_AMOUNT,
  BANK_MIN_AMOUNT,
  DEMAND_ANNUAL_RATE,
  DEMAND_DAILY_RATE,
  DEMAND_INTEREST_MAX_DAYS,
  FIXED_TERMS,
  FUND_ANCHOR_MAX_PULL,
  FUND_EPOCH_DATE_KEY,
  FUND_FEE_RATE,
  FUND_MEAN_REVERSION,
  FUND_NAV_FLOOR,
  bankFixedTermOf,
  bankFundOf,
  calcDemandInterest,
  calcDemandSettlement,
  calcEarlyWithdrawInterest,
  calcFixedInterest,
  clampBankAmount,
  diffDateKeys,
  fundDailyReturn,
  fundNavOn,
  fundNavSeries,
  quoteFundBuy,
  quoteFundSell,
  roundNav,
  shiftDateKey,
  splitFundCost,
} from '../src/lib/bankRules.js'
import { mulberry32, seedFromString } from '../src/lib/stockMarket.js'
import { getTodayDateKey } from '../src/lib/pointsRules.js'

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

/** 活期利息的参照公式（与规则同一定义：floor(余额 × 日利率 × 天数)） */
function manualDemandInterest(balance: number, days: number): number {
  return Math.floor(balance * DEMAND_DAILY_RATE * days)
}

/* ============================================================
   1. 常量与目录不变量
   ============================================================ */

assertEqual(DEMAND_ANNUAL_RATE, 0.02, '活期年化利率为 2%')
assertEqual(DEMAND_DAILY_RATE, DEMAND_ANNUAL_RATE / 365, '活期日利率 = 年化 / 365')
assertEqual(FUND_FEE_RATE, 0.0025, '基金单边手续费率 0.25%')
assertEqual(BANK_MIN_AMOUNT, 100, '单笔最少 100 积分')
assertEqual(BANK_MAX_AMOUNT, 100_000, '单笔最多 100000 积分')
assertEqual(DEMAND_INTEREST_MAX_DAYS, 365, '活期利息水位封顶 365 天')
assertEqual(FUND_EPOCH_DATE_KEY, '2026-01-01', '基金净值纪元 2026-01-01')
assert(FUND_NAV_FLOOR > 0, 'NAV 下限为正')

assertEqual(FIXED_TERMS.length, 3, '定期共 3 档')
assert(new Set(FIXED_TERMS.map((term) => term.key)).size === 3, '定期档 key 唯一')
for (let index = 1; index < FIXED_TERMS.length; index += 1) {
  assert(FIXED_TERMS[index].days > FIXED_TERMS[index - 1].days, `期限天数递增（${FIXED_TERMS[index].key}）`)
  assert(FIXED_TERMS[index].annualRate > FIXED_TERMS[index - 1].annualRate, `利率随期限递增（${FIXED_TERMS[index].key}）`)
}
for (const term of FIXED_TERMS) {
  assert(term.days > 0, `期限为正（${term.key}）`)
  assert(term.annualRate > DEMAND_ANNUAL_RATE, `定期利率高于活期（${term.key}）`)
  assert(term.label.length > 0, `期限有展示名（${term.key}）`)
  assert(bankFixedTermOf(term.key) === term, `bankFixedTermOf 命中（${term.key}）`)
  assert(bankFixedTermOf(`${term.key}x`) === undefined, `bankFixedTermOf 拒绝未知 key（${term.key}x）`)
}
assertEqual(FIXED_TERMS[0].key, '7d', '第一档为 7d')
assertEqual(FIXED_TERMS[1].days, 30, '第二档 30 天')
assertEqual(FIXED_TERMS[2].annualRate, 0.18, '第三档年化 18%')

assertEqual(BANK_FUNDS.length, 3, '基金共 3 只')
assertEqual(BANK_FUNDS.map((fund) => fund.code).join(','), 'fund_stable,fund_balanced,fund_growth', '基金代码与顺序')
assert(new Set(BANK_FUNDS.map((fund) => fund.code)).size === 3, '基金代码唯一')
for (const fund of BANK_FUNDS) {
  assert(fund.name.length > 0, `基金有名称（${fund.code}）`)
  assert([...fund.emoji].length >= 1, `基金有 emoji（${fund.code}）`)
  assert(fund.dailyVolatility > 0 && fund.dailyVolatility <= 0.03, `日波动率有界（${fund.code}）`)
  assert(fund.annualDrift > 0 && fund.annualDrift < 0.5, `年化漂移为正且有界（${fund.code}）`)
  assert(bankFundOf(fund.code) === fund, `bankFundOf 命中（${fund.code}）`)
}
assert(bankFundOf('fund_x') === undefined, 'bankFundOf 拒绝未知代码')
// 风险递增：波动率与漂移同向递增
assert(BANK_FUNDS[0].dailyVolatility < BANK_FUNDS[1].dailyVolatility, '基金波动率递增 1→2')
assert(BANK_FUNDS[1].dailyVolatility < BANK_FUNDS[2].dailyVolatility, '基金波动率递增 2→3')
assert(BANK_FUNDS[0].annualDrift < BANK_FUNDS[1].annualDrift, '基金漂移递增 1→2')
assert(BANK_FUNDS[1].annualDrift < BANK_FUNDS[2].annualDrift, '基金漂移递增 2→3')

/* ============================================================
   2. 日期键工具
   ============================================================ */

const TODAY = getTodayDateKey()
assert(/^\d{4}-\d{2}-\d{2}$/.test(TODAY), 'getTodayDateKey 输出 YYYY-MM-DD 格式')

assertEqual(diffDateKeys('2026-11-03', '2026-11-03'), 0, '同日差为 0')
assertEqual(diffDateKeys('2026-11-03', '2026-11-04'), 1, '相邻日差为 1')
assertEqual(diffDateKeys('2026-11-04', '2026-11-03'), -1, '反向差为负')
assertEqual(diffDateKeys('2026-01-31', '2026-02-01'), 1, '跨月日差')
assertEqual(diffDateKeys('2028-02-28', '2028-03-01'), 2, '闰年 2 月 29 天')
assertEqual(diffDateKeys('2026-02-28', '2026-03-01'), 1, '平年 2 月 28 天')
assertEqual(diffDateKeys('2026-12-31', '2027-01-01'), 1, '跨年日差')
assertEqual(diffDateKeys('2026-01-01', '2027-01-01'), 365, '整年 365 天')
assert(Number.isNaN(diffDateKeys('', TODAY)), '空水位差为 NaN')
assert(Number.isNaN(diffDateKeys('2026-11-3', TODAY)), '格式不完整差为 NaN')
assert(Number.isNaN(diffDateKeys('abc', TODAY)), '非法水位差为 NaN')
assert(Number.isNaN(diffDateKeys(TODAY, undefined as unknown as string)), '非字符串入参差为 NaN')

assertEqual(shiftDateKey('2026-11-03', -1), '2026-11-02', '前移一天')
assertEqual(shiftDateKey('2026-11-01', -1), '2026-10-31', '前移跨月')
assertEqual(shiftDateKey('2026-11-03', 30), '2026-12-03', '后移 30 天跨月')
assertEqual(shiftDateKey('2026-12-20', 20), '2027-01-09', '后移跨年')
assertEqual(shiftDateKey('not-a-date', 1), 'not-a-date', '非法 key 原样返回')
for (const span of [1, 7, 13, 29, 30, 365, 400]) {
  assertEqual(diffDateKeys(shiftDateKey(TODAY, -span), TODAY), span, `shift + diff 往返一致（${span} 天）`)
}

/* ============================================================
   3. 金额钳制
   ============================================================ */

assertEqual(clampBankAmount(100), 100, '下限合法')
assertEqual(clampBankAmount(100_000), 100_000, '上限合法')
assertEqual(clampBankAmount(5_000), 5_000, '普通金额')
assertEqual(clampBankAmount('5000'), 5_000, '数字字符串可解析')
assertEqual(clampBankAmount(100.9), 100, '小数向下取整后合法')
assert(Number.isNaN(clampBankAmount(99.9)), '取整后低于下限为 NaN')
assert(Number.isNaN(clampBankAmount(99)), '低于下限为 NaN')
assert(Number.isNaN(clampBankAmount(100_001)), '高于上限为 NaN')
assert(Number.isNaN(clampBankAmount(-500)), '负数为 NaN')
assert(Number.isNaN(clampBankAmount(Number.NaN)), 'NaN 为 NaN')
assert(Number.isNaN(clampBankAmount(Number.POSITIVE_INFINITY)), 'Infinity 为 NaN')
assert(Number.isNaN(clampBankAmount('abc')), '非数字字符串为 NaN')
assert(Number.isNaN(clampBankAmount(null)), 'null 为 NaN')
assert(Number.isNaN(clampBankAmount(undefined)), 'undefined 为 NaN')
assert(Number.isNaN(clampBankAmount('')), '空串为 NaN')
assert(Number.isNaN(clampBankAmount(true)), '布尔为 NaN')
assert(Number.isNaN(clampBankAmount({})), '对象为 NaN')

/* ============================================================
   4. 活期利息
   ============================================================ */

assertEqual(calcDemandInterest(0, '2026-11-01', '2026-11-10'), 0, '0 余额利息为 0')
assertEqual(calcDemandInterest(-100, '2026-11-01', '2026-11-10'), 0, '负余额利息为 0')
assertEqual(calcDemandInterest(10_000, '2026-11-01', '2026-11-01'), 0, '同日无利息')
assertEqual(calcDemandInterest(10_000, '2026-11-02', '2026-11-01'), 0, '反向区间无利息')
assertEqual(calcDemandInterest(10_000, '2026-11-01', 'x'), 0, '非法 key 利息为 0')
// 10000 × 0.02/365 = 0.5479…，单日向下取整为 0
assertEqual(calcDemandInterest(10_000, '2026-11-01', '2026-11-02'), 0, '单日利息不足 1 积分为 0')
assertEqual(calcDemandInterest(10_000, '2026-11-01', '2026-11-03'), 1, '两日利息 1 积分（floor 1.09）')
assertEqual(calcDemandInterest(10_000, '2026-11-01', '2026-12-01'), manualDemandInterest(10_000, 30), '30 天利息符合公式')
assertEqual(calcDemandInterest(100_000, '2026-01-01', '2027-01-01'), 2_000, '满 365 天年利息 = 2% 本金')
for (const balance of [100, 1234, 50_000, 100_000]) {
  for (const days of [1, 2, 7, 30, 90, 200, 365]) {
    const from = '2026-01-01'
    const to = shiftDateKey(from, days)
    assertEqual(
      calcDemandInterest(balance, from, to),
      manualDemandInterest(balance, days),
      `活期利息符合公式（${balance} × ${days} 天）`,
    )
    assert(Number.isInteger(calcDemandInterest(balance, from, to)), `活期利息为整数（${balance} × ${days} 天）`)
  }
}

/* ============================================================
   5. 活期惰性结算（365 天封顶）
   ============================================================ */

const BALANCE = 80_000
assertEqual(calcDemandSettlement(BALANCE, TODAY, TODAY).days, 0, '水位 = 今天：无需结算')
assertEqual(calcDemandSettlement(BALANCE, TODAY, TODAY).interest, 0, '水位 = 今天：利息 0')
assertEqual(calcDemandSettlement(BALANCE, '', TODAY).interest, 0, '空水位：不补息（service 重置水位）')
assertEqual(calcDemandSettlement(BALANCE, 'bad-key', TODAY).interest, 0, '坏水位：不补息')

const settled1 = calcDemandSettlement(BALANCE, shiftDateKey(TODAY, -1), TODAY)
assertEqual(settled1.days, 1, '昨日水位：1 天')
assertEqual(settled1.interest, calcDemandInterest(BALANCE, shiftDateKey(TODAY, -1), TODAY), '昨日水位利息符合公式')
assertEqual(settled1.fromKey, shiftDateKey(TODAY, -1), '未封顶时 fromKey = 原水位')

const settled365 = calcDemandSettlement(BALANCE, shiftDateKey(TODAY, -365), TODAY)
assertEqual(settled365.days, 365, '恰好 365 天不截断')
assertEqual(settled365.interest, manualDemandInterest(BALANCE, 365), '365 天利息符合公式')

const settled366 = calcDemandSettlement(BALANCE, shiftDateKey(TODAY, -366), TODAY)
assertEqual(settled366.days, 365, '366 天封顶为 365')
assertEqual(settled366.interest, manualDemandInterest(BALANCE, 365), '封顶利息 = 365 天利息')
assertEqual(settled366.fromKey, shiftDateKey(TODAY, -365), '封顶时 fromKey 前移')

const settled400 = calcDemandSettlement(BALANCE, shiftDateKey(TODAY, -4000), TODAY)
assertEqual(settled400.days, 365, '超长欠息封顶为 365')
assertEqual(settled400.interest, settled366.interest, '封顶后利息与 366 天一致')
assert(settled400.interest < manualDemandInterest(BALANCE, 4000), '封顶避免了天量补息')

const settled100 = calcDemandSettlement(BALANCE, shiftDateKey(TODAY, -100), TODAY)
assertEqual(settled100.days, 100, '未超封顶按实际天数')
assertEqual(settled100.interest, manualDemandInterest(BALANCE, 100), '未封顶利息符合公式')
assertEqual(calcDemandSettlement(0, shiftDateKey(TODAY, -10), TODAY).interest, 0, '0 余额结算利息为 0')
assertEqual(calcDemandSettlement(0, shiftDateKey(TODAY, -10), TODAY).days, 10, '0 余额仍推进天数')

/* ============================================================
   6. 定期利息
   ============================================================ */

assertEqual(calcFixedInterest(10_000, 0.05, 7), 9, '7 天定存利息（floor 9.58）')
assertEqual(calcFixedInterest(10_000, 0.1, 30), 82, '30 天定存利息（floor 82.19）')
assertEqual(calcFixedInterest(100_000, 0.18, 90), 4_438, '90 天定存利息（floor 4438.35）')
assertEqual(calcFixedInterest(0, 0.1, 30), 0, '0 本金利息为 0')
assertEqual(calcFixedInterest(-100, 0.1, 30), 0, '负本金利息为 0')
assertEqual(calcFixedInterest(10_000, 0, 30), 0, '0 利率利息为 0')
assertEqual(calcFixedInterest(10_000, 0.1, 0), 0, '0 天利息为 0')
assertEqual(calcFixedInterest(10_000, 0.1, -5), 0, '负天数利息为 0')
assertEqual(calcFixedInterest(10_000, Number.NaN, 30), 0, 'NaN 利率利息为 0')
assert(Number.isInteger(calcFixedInterest(123_456, 0.05, 7)), '定期利息为整数')
// 利息随天数 / 利率 / 本金单调不减
for (let days = 1; days <= 90; days += 1) {
  assert(
    calcFixedInterest(10_000, 0.1, days) >= calcFixedInterest(10_000, 0.1, days - 1),
    `定期利息随天数单调不减（${days}）`,
  )
}

assertEqual(calcEarlyWithdrawInterest(10_000, 0), 0, '当天支取无利息')
assertEqual(calcEarlyWithdrawInterest(10_000, -3), 0, '负天数按 0 处理')
assertEqual(calcEarlyWithdrawInterest(10_000, 1), 0, '10000 元活期单日利息 floor 0.54 = 0')
assertEqual(calcEarlyWithdrawInterest(100_000, 10), manualDemandInterest(100_000, 10), '提前支取 = 活期日利率 × 天数')
assertEqual(
  calcEarlyWithdrawInterest(10_000, 5),
  calcDemandInterest(10_000, '2026-01-01', '2026-01-06'),
  '提前支取与活期同口径',
)
// 每一档：提前支取利息（任意已过天数）都低于到期全额利息
for (const term of FIXED_TERMS) {
  for (let elapsed = 0; elapsed < term.days; elapsed += 1) {
    const early = calcEarlyWithdrawInterest(50_000, elapsed)
    const full = calcFixedInterest(50_000, term.annualRate, term.days)
    assert(early < full, `提前支取少于到期（${term.key}，第 ${elapsed} 天）`)
    assert(Number.isInteger(early), `提前支取利息为整数（${term.key}，第 ${elapsed} 天）`)
  }
}
// 定期到期利息必须优于活期同期限
for (const term of FIXED_TERMS) {
  const fixed = calcFixedInterest(10_000, term.annualRate, term.days)
  const demand = calcDemandInterest(10_000, TODAY, shiftDateKey(TODAY, term.days))
  assert(fixed > demand, `定期优于活期（${term.key}: ${fixed} > ${demand}）`)
}

/* ============================================================
   7. 基金 NAV：同日恒定、跨日确定、日收益有界
   ============================================================ */

for (const fund of BANK_FUNDS) {
  assertEqual(fundNavOn(fund.code, FUND_EPOCH_DATE_KEY), 1, `纪元日 NAV = 1（${fund.code}）`)
  assertEqual(fundNavOn(fund.code, '2025-12-31'), 1, `纪元前 NAV = 1（${fund.code}）`)
  // 同日恒定：两次调用完全一致
  assertEqual(fundNavOn(fund.code, TODAY), fundNavOn(fund.code, TODAY), `同日两次调用一致（${fund.code}）`)
  // 手动逐日复利核对前两天（与实现同口径：日收益带均值回归拉力，shock 由同种子重现）
  const day1 = FUND_EPOCH_DATE_KEY
  const day2 = shiftDateKey(day1, 1)
  const day3 = shiftDateKey(day1, 2)
  const replicate = (code: string, dayKey: string, dayIndex: number, prevNav: number): number => {
    const fund = bankFundOf(code)
    const rng = mulberry32(seedFromString(`lineweb-fund:${code}:${dayKey}`))
    const shock = (rng() * 2 - 1) * fund.dailyVolatility
    const bound = 3 * fund.dailyVolatility
    const deviation = Math.log(Math.exp(fund.annualDrift * dayIndex / 365) / prevNav)
    const pull = Math.max(-FUND_ANCHOR_MAX_PULL, Math.min(FUND_ANCHOR_MAX_PULL, FUND_MEAN_REVERSION * deviation))
    return fund.annualDrift / 365 + Math.max(-bound, Math.min(bound, shock)) + pull
  }
  const m2 = Math.max(FUND_NAV_FLOOR, 1 * (1 + replicate(fund.code, day2, 1, 1)))
  assertEqual(fundNavOn(fund.code, day2), m2, `第 1 日 NAV 与手算一致（${fund.code}）`)
  const m3 = Math.max(FUND_NAV_FLOOR, m2 * (1 + replicate(fund.code, day3, 2, m2)))
  assertEqual(fundNavOn(fund.code, day3), m3, `第 2 日 NAV 与手算一致（${fund.code}）`)
  // 跨日不同（连续两天的日收益率不可能完全相等）
  assert(fundDailyReturn(fund.code, day2) !== fundDailyReturn(fund.code, day3), `相邻两日收益不同（${fund.code}）`)
  assert(fundNavOn(fund.code, day3) !== fundNavOn(fund.code, day2), `相邻两日 NAV 不同（${fund.code}）`)
}

// 日收益率有界：|收益 − 漂移项| ≤ 3 × 日波动（逐日，覆盖 90 天 × 3 只）
const BOUND_DAYS = 90
for (const fund of BANK_FUNDS) {
  const bound = 3 * fund.dailyVolatility + 1e-12
  const driftPerDay = fund.annualDrift / 365
  for (let index = 1; index <= BOUND_DAYS; index += 1) {
    const dayKey = shiftDateKey(FUND_EPOCH_DATE_KEY, index)
    const daily = fundDailyReturn(fund.code, dayKey)
    assert(
      Math.abs(daily - driftPerDay) <= bound,
      `日收益有界（${fund.code} 第 ${index} 天）`,
    )
  }
}

// NAV 为正、且长期高于下限（漂移为正，400 天不应触及地板）
for (const fund of BANK_FUNDS) {
  const far = shiftDateKey(FUND_EPOCH_DATE_KEY, 400)
  const nav = fundNavOn(fund.code, far)
  assert(Number.isFinite(nav), `NAV 有限（${fund.code}）`)
  assert(nav >= FUND_NAV_FLOOR, `NAV 不低于地板（${fund.code}）`)
  assert(nav > 0, `NAV 为正（${fund.code}）`)
}

// 序列：近 14 天窗口
const TODAY_SERIES = shiftDateKey(FUND_EPOCH_DATE_KEY, 200)
for (const fund of BANK_FUNDS) {
  const series = fundNavSeries(fund.code, shiftDateKey(TODAY_SERIES, -13), TODAY_SERIES)
  assertEqual(series.length, 14, `14 天序列长度（${fund.code}）`)
  assertEqual(series[series.length - 1].nav, roundNav(fundNavOn(fund.code, TODAY_SERIES)), `序列末点 = 当日 NAV（${fund.code}）`)
  for (let index = 1; index < series.length; index += 1) {
    assertEqual(diffDateKeys(series[index - 1].date, series[index].date), 1, `序列日期连续（${fund.code} #${index}）`)
    assert(series[index].nav > 0, `序列 NAV 为正（${fund.code} #${index}）`)
  }
  // 序列每天与 fundNavOn 一致（同日恒定）
  for (const point of series) {
    assertEqual(point.nav, roundNav(fundNavOn(fund.code, point.date)), `序列点与 NAV 一致（${fund.code} ${point.date}）`)
  }
}

// 序列窗口收紧：30 天封顶 / 纪元前收紧 / 空序列
const long = fundNavSeries('fund_stable', shiftDateKey(TODAY_SERIES, -200), TODAY_SERIES)
assertEqual(long.length, 30, '窗口超过 30 天收紧为 30')
assertEqual(long[0].date, shiftDateKey(TODAY_SERIES, -29), '收紧后从 today−29 开始')
const nearEpoch = fundNavSeries('fund_stable', shiftDateKey(FUND_EPOCH_DATE_KEY, -50), shiftDateKey(FUND_EPOCH_DATE_KEY, 5))
assertEqual(nearEpoch.length, 6, '纪元前请求收紧到纪元起（0–5 共 6 天）')
assertEqual(nearEpoch[0].nav, 1, '序列首点为起始净值')
assertEqual(fundNavSeries('fund_stable', '2026-01-01', '2025-12-31').length, 0, '目标早于纪元返回空序列')
assertEqual(fundNavSeries('fund_stable', '', TODAY).length, 30, '非法起始收紧到最近 30 天')

// 未知代码抛错（service 层前置校验，lib 层硬失败兜底）
assertThrows(() => fundNavOn('fund_x', TODAY), '未知代码 fundNavOn 抛错')
assertThrows(() => fundNavSeries('fund_x', TODAY, TODAY), '未知代码 fundNavSeries 抛错')
assertThrows(() => fundDailyReturn('fund_x', TODAY), '未知代码 fundDailyReturn 抛错')

function assertThrows(fn: () => unknown, label: string): void {
  let threw = false
  try {
    fn()
  } catch {
    threw = true
  }
  assert(threw, label)
}

// roundNav 保留 4 位小数
assertEqual(roundNav(1.234567), 1.2346, 'roundNav 四舍五入 4 位')
assertEqual(roundNav(1), 1, 'roundNav 整数不变')

/* ============================================================
   8. 申赎费用数学
   ============================================================ */

const buy1 = quoteFundBuy(1_000, 1.2)
assertEqual(buy1.points, 1_000, '买入扣除全额预算')
assertEqual(buy1.fee, 3, '买入手续费 = ceil(1000 × 0.25%)')
assertEqual(buy1.netPoints, 997, '扣费后净投入')
assertEqual(buy1.shares, 997 / 1.2, '份额 = 净投入 / 净值')
assertEqual(buy1.nav, 1.2, '成交净值回显')

const buyMin = quoteFundBuy(100, 1)
assertEqual(buyMin.fee, 1, '最少手续费 1 积分（ceil 0.25 = 1）')
assertEqual(buyMin.shares, 99, '最低档份额')

assertEqual(quoteFundBuy(0, 1).fee, 0, '0 预算手续费为 0')
assertEqual(quoteFundBuy(0, 1).shares, 0, '0 预算份额为 0')
assertEqual(quoteFundBuy(-5, 1).shares, 0, '负预算份额为 0')
assertEqual(quoteFundBuy(1_000, 0).shares, 0, '非法净值份额为 0')
assertEqual(quoteFundBuy(1_000.9, 1).points, 1_000, '小数预算向下取整')

const sell1 = quoteFundSell(100, 1.2)
assertEqual(sell1.gross, 120, '卖出毛收入 = 份额 × 净值')
assertEqual(sell1.fee, 1, '卖出手续费 = ceil(120 × 0.25%)')
assertEqual(sell1.proceeds, 119, '到账 = floor(毛收入 − 手续费)')

const sellExact = quoteFundSell(400, 1)
assertEqual(sellExact.fee, 1, '整毛收入手续费仍为 ceil(1) = 1')
assertEqual(sellExact.proceeds, 399, '到账 399')

const sellTiny = quoteFundSell(0.0001, 0.5)
assertEqual(sellTiny.proceeds, 0, '毛收入不足手续费时到账 0（不倒扣）')

const sellFraction = quoteFundSell(3, 1.1)
assertEqual(sellFraction.gross, 3.3, '毛收入消除浮点尾差')
assertEqual(sellFraction.proceeds, 2, '小数到账向下取整（floor 2.3 = 2）')

assertEqual(quoteFundSell(0, 1).fee, 0, '0 份额手续费为 0')
assertEqual(quoteFundSell(-1, 1).proceeds, 0, '负份额到账 0')

// 买入后立刻原价卖出必亏手续费（防套利不变量）
const roundTrip = quoteFundSell(quoteFundBuy(1_000, 1).shares, 1)
assert(roundTrip.proceeds < 1_000, `同价往返必亏手续费（${roundTrip.proceeds} < 1000）`)
// 份额与到账非负
assert(quoteFundBuy(500, 2).shares > 0, '正常买入份额为正')
assert(quoteFundSell(10, 2).proceeds > 0, '正常卖出到账为正')

/* ============================================================
   9. 成本分摊
   ============================================================ */

assertEqual(splitFundCost(500, 10, 10), 500, '整仓分摊全部成本')
assertEqual(splitFundCost(501, 5, 10), 251, '半仓分摊四舍五入（round 250.5）')
assertEqual(splitFundCost(123, 1, 3), 41, '三分之一仓')
assertEqual(splitFundCost(300, 20, 10), 300, '超卖份额夹到全部成本')
assertEqual(splitFundCost(0, 5, 10), 0, '0 成本分摊为 0')
assertEqual(splitFundCost(100, 0, 10), 0, '0 份额分摊为 0')
assertEqual(splitFundCost(100, 5, 0), 0, '总份额 0 分摊为 0')
assertEqual(splitFundCost(100, 5, Number.NaN), 0, '总份额非法分摊为 0')
for (const total of [1, 3, 7, 100]) {
  for (const shares of [0.5, 1, total / 2, total]) {
    const portion = splitFundCost(999, shares, total)
    assert(portion >= 0 && portion <= 999, `分摊夹在 [0, 成本]（${shares}/${total}）`)
  }
}

/* ============================================================
   汇总
   ============================================================ */

console.log(`银行系统自检通过：${passed} 项断言`)
