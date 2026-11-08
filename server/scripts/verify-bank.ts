/**
 * 银行系统纯函数自检（不依赖数据库 / 环境变量 / 网络 / prisma）
 *
 * 覆盖：
 * - 常量与目录不变量：活期利率 / 40 分钟结算槽 / 定期三档（天数与利率递增）/ 基金三只（代码唯一、参数有界）；
 * - 日期键：diffDateKeys（跨月 / 闰年 / 跨年 / 非法输入 NaN）、shiftDateKey、与 getTodayDateKey 同格式；
 * - 金额钳制：clampBankAmount（范围 / 取整 / 非法输入 NaN）；
 * - 活期利息（40 分钟槽位制）：槽号边界、向下取整、0 余额、advance 语义（interest=0 不推进 /
 *   interest≥1 推进 / 封顶强制推进）、一年槽数封顶（calcDemandSettlement）；
 * - 定期利息：到期全额 vs 提前支取（提前 < 到期、毫秒连续计息精确值）、利率单调、非法输入；
 * - 基金 NAV：同日恒定（两次调用相等）、跨日确定（逐日手算一致）、日收益率恒 ≥ 0（只涨不跌）、
 *   NAV 序列单调不减、日收益有界（≤ 3×波动 + 漂移）、序列窗口（14 天 / 30 天封顶 / 纪元前收紧 /
 *   空序列）、未知代码抛错；
 * - 申赎费用数学：买入手续费 / 份额折算、卖出 proceeds 向下取整、往返必亏手续费、成本分摊。
 *
 * 用法: cd server && npm run verify:bank
 */

import {
  BANK_FUNDS,
  BANK_MAX_AMOUNT,
  BANK_MIN_AMOUNT,
  DEMAND_ANNUAL_RATE,
  DEMAND_INTEREST_MAX_SLOTS,
  DEMAND_PERIOD_RATE,
  FIXED_TERMS,
  FUND_ANCHOR_MAX_PULL,
  FUND_EPOCH_DATE_KEY,
  FUND_FEE_RATE,
  FUND_MEAN_REVERSION,
  FUND_NAV_FLOOR,
  SETTLEMENT_PERIOD_MS,
  YEAR_MS,
  bankFixedTermOf,
  bankFundOf,
  calcDemandInterest,
  calcDemandSettlement,
  calcEarlyWithdrawInterest,
  calcFixedInterest,
  clampBankAmount,
  currentSettlementSlot,
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

/** 活期利息的参照公式（与规则同一定义：floor(余额 × 每槽利率 × 槽数)） */
function manualDemandInterest(balance: number, slots: number): number {
  return Math.floor(balance * DEMAND_PERIOD_RATE * slots)
}

/* ============================================================
   1. 常量与目录不变量
   ============================================================ */

assertEqual(DEMAND_ANNUAL_RATE, 0.02, '活期年化利率为 2%')
assertEqual(SETTLEMENT_PERIOD_MS, 2_400_000, '活期结算周期 40 分钟')
assertEqual(DEMAND_PERIOD_RATE, DEMAND_ANNUAL_RATE / (365 * 36), '活期每槽利率 = 年化 / (365 × 36)')
assertEqual(DEMAND_INTEREST_MAX_SLOTS, 13_140, '活期利息水位封顶一年槽数（365 × 36）')
assertEqual(YEAR_MS, 31_536_000_000, '一年毫秒数 = 365 天')
assertEqual(FUND_FEE_RATE, 0.0025, '基金单边手续费率 0.25%')
assertEqual(BANK_MIN_AMOUNT, 100, '单笔最少 100 积分')
assertEqual(BANK_MAX_AMOUNT, 100_000, '单笔最多 100000 积分')
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
   4. 活期利息（40 分钟槽位制）
   ============================================================ */

// 槽号边界：epoch 起每 40 分钟一槽
assertEqual(currentSettlementSlot(0), 0, 'epoch 0 = 槽 0')
assertEqual(currentSettlementSlot(2_399_999), 0, '不足 40 分钟 = 槽 0')
assertEqual(currentSettlementSlot(2_400_000), 1, '恰好 40 分钟 = 槽 1')
assertEqual(currentSettlementSlot(SETTLEMENT_PERIOD_MS * 36), 36, '一天 36 槽')
assertEqual(currentSettlementSlot(SETTLEMENT_PERIOD_MS * 365 * 36), 13_140, '一年 13140 槽')
assertEqual(currentSettlementSlot(SETTLEMENT_PERIOD_MS * 365 * 36 - 1), 13_139, '一年差 1 毫秒落上一槽')
assert(currentSettlementSlot(SETTLEMENT_PERIOD_MS * 101 + 1) >= currentSettlementSlot(SETTLEMENT_PERIOD_MS * 101), '槽号随时间单调不减')

assertEqual(calcDemandInterest(0, 10), 0, '0 余额利息为 0')
assertEqual(calcDemandInterest(-100, 10), 0, '负余额利息为 0')
assertEqual(calcDemandInterest(10_000, 0), 0, '0 槽无利息')
assertEqual(calcDemandInterest(10_000, -5), 0, '负槽数利息为 0')
assertEqual(calcDemandInterest(10_000, Number.NaN), 0, 'NaN 槽数利息为 0')
// 10000 × 0.02/13140 = 0.0152…，单槽向下取整为 0
assertEqual(calcDemandInterest(10_000, 1), 0, '单槽利息不足 1 积分为 0')
// 余额 10 万约每 7 槽入账 1 分（floor 1.065）
assertEqual(calcDemandInterest(100_000, 7), 1, '10 万余额 7 槽入账 1 分')
assertEqual(calcDemandInterest(10_000, 180), 2, '5 天（180 槽）利息 2 分（floor 2.74）')
assertEqual(calcDemandInterest(100_000, DEMAND_INTEREST_MAX_SLOTS), 2_000, '满一年槽数利息 = 2% 本金')
for (const balance of [100, 1234, 50_000, 100_000]) {
  for (const slots of [1, 2, 7, 36, 1080, 6570, 13_140]) {
    assertEqual(
      calcDemandInterest(balance, slots),
      manualDemandInterest(balance, slots),
      `活期利息符合公式（${balance} × ${slots} 槽）`,
    )
    assert(Number.isInteger(calcDemandInterest(balance, slots)), `活期利息为整数（${balance} × ${slots} 槽）`)
  }
}
// 利息随槽数单调不减
let prevSlotInterest = 0
for (let slots = 1; slots <= DEMAND_INTEREST_MAX_SLOTS; slots += 1) {
  const interest = manualDemandInterest(80_000, slots)
  assert(interest >= prevSlotInterest, `活期利息随槽数单调不减（${slots} 槽）`)
  prevSlotInterest = interest
}

/* ============================================================
   5. 活期惰性结算（槽位水位 / 滚存 / 封顶）
   ============================================================ */

const BALANCE = 80_000
// 非法水位 / 无进展：不结算、不推进
assertEqual(
  calcDemandSettlement(BALANCE, 5_000, 5_000),
  { slots: 0, interest: 0, advance: false },
  '当前槽 = 水位：无需结算',
)
assertEqual(
  calcDemandSettlement(BALANCE, 5_001, 5_000),
  { slots: 0, interest: 0, advance: false },
  '当前槽落后水位：不结算不推进',
)
assertEqual(
  calcDemandSettlement(BALANCE, 0, 5_000),
  { slots: 0, interest: 0, advance: false },
  '未初始化哨兵 0：不结算（service 层先行只推进不补息）',
)
assertEqual(
  calcDemandSettlement(BALANCE, Number.NaN, 5_000),
  { slots: 0, interest: 0, advance: false },
  'NaN 水位：不结算',
)
assertEqual(
  calcDemandSettlement(BALANCE, 5_000, Number.NaN),
  { slots: 0, interest: 0, advance: false },
  'NaN 当前槽：不结算',
)

// 正常结算：利息 ≥ 1 → 入账并推进
const settled36 = calcDemandSettlement(BALANCE, 5_000, 5_036)
assertEqual(settled36.slots, 36, '一天（36 槽）槽数')
assertEqual(settled36.interest, manualDemandInterest(BALANCE, 36), '一天利息符合公式（floor 4.38 = 4）')
assertEqual(settled36.advance, true, '利息 ≥ 1 推进水位')

// 滚存：利息 = 0 → 不推进，小数利息留给下槽一并结算
const settled1 = calcDemandSettlement(BALANCE, 5_000, 5_001)
assertEqual(settled1.slots, 1, '单槽槽数为 1')
assertEqual(settled1.interest, 0, '8 万余额单槽利息 floor 0.12 = 0')
assertEqual(settled1.advance, false, '利息 = 0 不推进（滚存）')
const settled7 = calcDemandSettlement(100_000, 5_000, 5_007)
assertEqual(settled7.interest, 1, '10 万余额 7 槽累计利息 1 分')
assertEqual(settled7.advance, true, '累计利息 ≥ 1 推进水位')
assertEqual(calcDemandSettlement(0, 5_000, 5_036).interest, 0, '0 余额结算利息为 0')
assertEqual(calcDemandSettlement(0, 5_000, 5_036).slots, 36, '0 余额仍计槽数')
assertEqual(calcDemandSettlement(0, 5_000, 5_036).advance, false, '0 余额利息 = 0 不推进')

// 封顶：槽差超过一年槽数 → 按封顶计息并强制推进（防止水位永远落后）
const CURRENT_SLOT = 2_000_000
const settledCap = calcDemandSettlement(BALANCE, CURRENT_SLOT - (DEMAND_INTEREST_MAX_SLOTS + 1), CURRENT_SLOT)
assertEqual(settledCap.slots, DEMAND_INTEREST_MAX_SLOTS, '槽差超一年封顶为 13140')
assertEqual(settledCap.interest, manualDemandInterest(BALANCE, DEMAND_INTEREST_MAX_SLOTS), '封顶利息 = 一年利息（1600）')
assertEqual(settledCap.advance, true, '封顶强制推进水位')
const tinyCap = calcDemandSettlement(10, CURRENT_SLOT - (DEMAND_INTEREST_MAX_SLOTS + 5), CURRENT_SLOT)
assertEqual(tinyCap.interest, 0, '10 积分一年利息不足 1 分')
assertEqual(tinyCap.advance, true, '封顶路径即使利息为 0 也强制推进')

// 恰好一年槽数不截断
const settledMax = calcDemandSettlement(BALANCE, CURRENT_SLOT - DEMAND_INTEREST_MAX_SLOTS, CURRENT_SLOT)
assertEqual(settledMax.slots, DEMAND_INTEREST_MAX_SLOTS, '恰好一年槽数不截断')
assertEqual(settledMax.interest, manualDemandInterest(BALANCE, DEMAND_INTEREST_MAX_SLOTS), '一年利息符合公式')
assertEqual(settledMax.advance, true, '一年利息 ≥ 1 推进水位')

// 超长欠息（水位落后十年）同样封顶
const settledDecade = calcDemandSettlement(BALANCE, CURRENT_SLOT - 13_140 * 10, CURRENT_SLOT)
assertEqual(settledDecade.slots, DEMAND_INTEREST_MAX_SLOTS, '超长欠息封顶为 13140')
assertEqual(settledDecade.interest, settledCap.interest, '封顶后利息与超一年一致')
assert(settledDecade.interest < BALANCE * DEMAND_ANNUAL_RATE * 10, '封顶避免了天量补息')

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

// 提前支取：按实际经过毫秒连续计息 floor(本金 × 活期年化 × elapsedMs / 一年毫秒)
const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
assertEqual(calcEarlyWithdrawInterest(10_000, 0), 0, '当天支取无利息')
assertEqual(calcEarlyWithdrawInterest(10_000, -HOUR_MS), 0, '负毫秒按 0 处理')
assertEqual(calcEarlyWithdrawInterest(10_000, Number.NaN), 0, 'NaN 毫秒利息为 0')
assertEqual(calcEarlyWithdrawInterest(100_000, DAY_MS), 5, '10 万存 1 天利息 5 分（floor 5.48）')
assertEqual(calcEarlyWithdrawInterest(100_000, 12 * HOUR_MS), 2, '10 万存半天利息 2 分（floor 2.74）')
assertEqual(calcEarlyWithdrawInterest(100_000, 30 * DAY_MS), 164, '10 万存 30 天利息 164（floor 164.38）')
assertEqual(calcEarlyWithdrawInterest(100_000, YEAR_MS), 2_000, '存满整年按活期 = 2% 本金')
assertEqual(calcEarlyWithdrawInterest(100_000, 30 * HOUR_MS), 6, '10 万存 30 小时利息 6 分（floor 6.85）')
// 连续计息消除按日截断损失：6.9 天按毫秒算 18 分，按日截断只能算 6 天（16 分）
assertEqual(calcEarlyWithdrawInterest(50_000, 596_160_000), 18, '6.9 天按毫秒连续计息 18 分')
// 同一时间跨度下毫秒计息与槽位计息同口径（5 天 = 180 槽）
assertEqual(
  calcEarlyWithdrawInterest(10_000, 5 * DAY_MS),
  calcDemandInterest(10_000, 5 * 36),
  '毫秒连续计息与槽位计息同跨度同值（5 天）',
)
// 每一档：提前支取利息（任意已过时长，6 小时步进）都低于到期全额利息
for (const term of FIXED_TERMS) {
  for (let elapsedMs = 0; elapsedMs < term.days * DAY_MS; elapsedMs += 6 * HOUR_MS) {
    const early = calcEarlyWithdrawInterest(50_000, elapsedMs)
    const full = calcFixedInterest(50_000, term.annualRate, term.days)
    assert(early < full, `提前支取少于到期（${term.key}，第 ${elapsedMs / HOUR_MS} 小时）`)
    assert(Number.isInteger(early), `提前支取利息为整数（${term.key}，第 ${elapsedMs / HOUR_MS} 小时）`)
  }
}
// 定期到期利息必须优于活期同期限（期限天数 × 每天 36 槽）
for (const term of FIXED_TERMS) {
  const fixed = calcFixedInterest(10_000, term.annualRate, term.days)
  const demand = calcDemandInterest(10_000, term.days * 36)
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
  // 手动逐日复利核对前两天（与实现同口径：日收益带均值回归拉力，shock 由同种子重现；
  // 负收益日的 0 下限在复利处套 Math.max，replicate 返回未截断的原始收益）
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
  const m2 = Math.max(FUND_NAV_FLOOR, 1 * (1 + Math.max(0, replicate(fund.code, day2, 1, 1))))
  assertEqual(fundNavOn(fund.code, day2), m2, `第 1 日 NAV 与手算一致（${fund.code}）`)
  const m3 = Math.max(FUND_NAV_FLOOR, m2 * (1 + Math.max(0, replicate(fund.code, day3, 2, m2))))
  assertEqual(fundNavOn(fund.code, day3), m3, `第 2 日 NAV 与手算一致（${fund.code}）`)
  // NAV 单调不减（负收益日按 0 横盘，净值只涨不跌）
  assert(fundNavOn(fund.code, day3) >= fundNavOn(fund.code, day2), `相邻两日 NAV 单调不减（${fund.code}）`)
  // 跨日确定但并非恒定（30 天窗口内日收益率不可能全部相等）
  const windowReturns: number[] = []
  for (let index = 1; index <= 30; index += 1) {
    windowReturns.push(fundDailyReturn(fund.code, shiftDateKey(day1, index)))
  }
  assert(new Set(windowReturns).size > 1, `跨日收益率并非恒定（${fund.code}）`)
}

// 日收益率恒 ≥ 0（净值永不下跌）：3 只基金 × 纪元前后 430 天全遍历
for (const fund of BANK_FUNDS) {
  for (let index = -30; index <= 400; index += 1) {
    const dayKey = shiftDateKey(FUND_EPOCH_DATE_KEY, index)
    assert(fundDailyReturn(fund.code, dayKey) >= 0, `日收益率恒 ≥ 0（${fund.code} 第 ${index} 天）`)
  }
}

// NAV 单调不减：连续 400 天逐日 walk（从起始净值 1 出发只会横盘或上涨）
for (const fund of BANK_FUNDS) {
  let prevNav = fundNavOn(fund.code, FUND_EPOCH_DATE_KEY)
  for (let index = 1; index <= 400; index += 1) {
    const nav = fundNavOn(fund.code, shiftDateKey(FUND_EPOCH_DATE_KEY, index))
    assert(nav >= prevNav, `NAV 序列单调不减（${fund.code} 第 ${index} 天）`)
    prevNav = nav
  }
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

// NAV 为正、长期不低于起始净值（只涨不跌 + 漂移为正，400 天不应触及地板）
for (const fund of BANK_FUNDS) {
  const far = shiftDateKey(FUND_EPOCH_DATE_KEY, 400)
  const nav = fundNavOn(fund.code, far)
  assert(Number.isFinite(nav), `NAV 有限（${fund.code}）`)
  assert(nav >= FUND_NAV_FLOOR, `NAV 不低于地板（${fund.code}）`)
  assert(nav >= 1, `400 天 NAV 不低于起始净值（${fund.code}）`)
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
    assert(series[index].nav >= series[index - 1].nav, `序列 NAV 单调不减（${fund.code} #${index}）`)
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
