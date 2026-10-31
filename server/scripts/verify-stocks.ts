/**
 * 模拟股市纯函数自检（不依赖数据库 / 环境变量 / 网络 / prisma）
 *
 * 覆盖：日线生成器（未动）、实时 tick 引擎（basePath / 噪声 / 冲击 / DTO 契约）、
 * 交易报价与部分卖出成本分摊。
 *
 * 用法: cd server && npx tsx scripts/verify-stocks.ts
 *      （或 npm run verify:stocks）
 */

import {
  STOCK_DEFINITIONS,
  STOCK_EPOCH,
  STOCK_HISTORY_DAYS,
  STOCK_MARKET_DISCLAIMER,
  buildStockMarket,
  dateKeyToUtc,
  dayIndexSinceEpoch,
  getStockDailySeries,
  mulberry32,
  seedFromString,
} from '../src/lib/stockMarket.js'
import {
  STOCK_FEE_RATE,
  STOCK_MAX_INVEST,
  STOCK_MIN_INVEST,
  positionMarketValue,
  positionProfit,
  positionProfitPct,
  quoteStockBuy,
  quoteStockSell,
  splitCostForShares,
} from '../src/lib/stockTrading.js'
import {
  IMPACT_STATE_SETTING_KEY,
  STOCK_IMPACT_HALF_LIFE_MS,
  STOCK_IMPACT_MAX,
  STOCK_IMPACT_PER_POINT,
  STOCK_TICK_MS,
  STOCK_TICKS_PER_DAY,
  applyBuyImpact,
  applySellImpact,
  applyTradeImpactDelta,
  buildLiveMarket,
  buildStockTrend,
  clampImpact,
  decayImpact,
  getImpact,
  getLiveQuote,
  getLiveQuoteByCode,
  isImpactDirty,
  loadImpactStateFromJson,
  markImpactPersisted,
  resetTicksForTest,
  serializeImpactState,
  tickIndexOf,
} from '../src/lib/stockTicks.js'

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

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new Error(`断言失败：${label}\n  实际: ${actual}\n  期望: ${expected}（±${tolerance}）`)
  }
  passed += 1
}

// === 固定测试日期与工具 ===
const DATE = '2026-10-29'
const NEXT_DATE = '2026-10-30'

/** 上海 0 点 = UTC 0 点 − 8 小时 */
function shanghaiDayStart(dateKey: string): number {
  return dateKeyToUtc(dateKey) - 8 * 3600 * 1000
}

/** 某日第 tick 个 tick 对应的 nowMs */
function tickNow(dateKey: string, tick: number): number {
  return shanghaiDayStart(dateKey) + tick * STOCK_TICK_MS
}

// === 随机数基座 ===
const rngA = mulberry32(42)
const seqA = Array.from({ length: 5 }, () => rngA())
const rngB = mulberry32(42)
const seqB = Array.from({ length: 5 }, () => rngB())
assertEqual(seqA, seqB, '同种子 PRNG 序列一致')
assert(seqA.every((value) => value >= 0 && value < 1), 'PRNG 取值在 [0,1)')
assertEqual(seedFromString('LWST'), seedFromString('LWST'), '字符串种子稳定')
assert(seedFromString('LWST') !== seedFromString('SPRU'), '不同代码种子不同')

// === 日期 ===
assertEqual(dayIndexSinceEpoch(STOCK_EPOCH), 0, '纪元当日索引为 0')
assertEqual(dayIndexSinceEpoch('2024-01-31'), 30, '跨月天数正确')
assertEqual(dayIndexSinceEpoch('2023-01-01'), 0, '早于纪元按 0 处理')

// === 日线结构（日生成器未动，报价不再内嵌 history） ===
resetTicksForTest()
const dailyByCode = new Map(STOCK_DEFINITIONS.map((definition) => [definition.code, getStockDailySeries(definition, DATE)]))
const day1 = buildStockMarket(DATE)
assertEqual(day1.stocks.length, STOCK_DEFINITIONS.length, '股票数量等于定义数量')
assertEqual(day1.stocks.length, 8, '默认 8 只虚构股票')
assert(day1.disclaimer.includes('模拟行情'), '免责声明标注模拟行情')
assertEqual(day1.disclaimer, STOCK_MARKET_DISCLAIMER, '免责声明为契约文案')
assertEqual(day1.currency, '模拟币', '计价单位')
assertEqual(day1.trade, { feeRate: STOCK_FEE_RATE, minInvest: STOCK_MIN_INVEST, maxInvest: STOCK_MAX_INVEST }, '交易规则下发')
assert(!('tickMs' in day1), '日线构建器不产生实时 tick 字段')
for (const [index, stock] of day1.stocks.entries()) {
  const definition = STOCK_DEFINITIONS[index]
  const series = dailyByCode.get(definition.code)!
  assertEqual(stock.code, definition.code, '行情按定义顺序输出')
  assertEqual(series.length, STOCK_HISTORY_DAYS, `${stock.code} 有 30 根日线`)
  assertEqual(series[series.length - 1].date, DATE, `${stock.code} 最后一根是请求日`)
  assert(stock.price > 0, `${stock.code} 价格为正`)
  assertEqual(stock.price, series[series.length - 1].close, `${stock.code} 现价 = 今日收盘（日线构建器）`)
  assertEqual(stock.open, series[series.length - 1].open, `${stock.code} 开盘 = 今日开盘`)
  assertEqual(stock.high, series[series.length - 1].high, `${stock.code} 最高 = 今日最高`)
  assertEqual(stock.low, series[series.length - 1].low, `${stock.code} 最低 = 今日最低`)
  assert(stock.volume > 0, `${stock.code} 成交量为正`)
  assertEqual(stock.prevClose, series[series.length - 2].close, `${stock.code} 昨收 = 上一根收盘`)
  assert(Math.abs(stock.change - (stock.price - stock.prevClose)) < 0.011, `${stock.code} 涨跌额 = 现价 - 昨收`)
  assert(Math.abs(stock.changePct - (stock.change / stock.prevClose) * 100) < 0.02, `${stock.code} 涨跌幅一致`)
  assert(!('history' in stock), `${stock.code} 报价不再内嵌 history`)
  for (const candle of series) {
    assert(candle.high >= candle.close && candle.high >= candle.open, `${stock.code} ${candle.date} 上影线合法`)
    assert(candle.low <= candle.close && candle.low <= candle.open, `${stock.code} ${candle.date} 下影线合法`)
  }
}

// === 确定性与连续性 ===
assertEqual(buildStockMarket(DATE), day1, '同一天重复生成完全一致')
assertEqual(getStockDailySeries(STOCK_DEFINITIONS[0], DATE), dailyByCode.get('LWST'), 'getStockDailySeries 同日一致')
for (const definition of STOCK_DEFINITIONS) {
  const today = getStockDailySeries(definition, DATE)
  const next = getStockDailySeries(definition, NEXT_DATE)
  assertEqual(
    next.slice(0, -1).map((candle) => candle.close),
    today.slice(1).map((candle) => candle.close),
    `${definition.code} 相邻两天的走势首尾衔接（随机游走连续）`,
  )
}
assert(day1.marketChangePct !== 0, '大盘涨跌幅有数值')

// === 交易纯函数 ===
const buyQuote = quoteStockBuy(500, 50)
assertEqual(buyQuote.points, 500, '买入预算按整数积分')
assertEqual(buyQuote.fee, 5, '买入手续费 = 1% 向上取整')
assertEqual(buyQuote.netPoints, 495, '买入净投入扣手续费')
assertEqual(buyQuote.shares, 9.9, '买入份额 = 净投入 / 现价')
assertEqual(quoteStockBuy(100, 18.6).fee, 1, '最低手续费 1 积分')
assertEqual(quoteStockBuy(0, 10).shares, 0, '零预算不能买入')
assertEqual(quoteStockBuy(-100, 10).fee, 0, '负预算归零')
assertEqual(quoteStockBuy(10_000, 0).shares, 0, '零价格不产生份额')

// 固定价格 123.45 的精确值
const buy123 = quoteStockBuy(1000, 123.45)
assertEqual(buy123.fee, 10, '123.45 价位买入手续费 = 10')
assertEqual(buy123.netPoints, 990, '123.45 价位净投入 = 990')
assertClose(buy123.shares, 990 / 123.45, 1e-12, '123.45 价位份额 = 净投入 / 现价')
const sell123 = quoteStockSell(8.02, 123.45)
assertEqual(sell123.gross, 990.07, '123.45 价位毛收入 round2')
assertEqual(sell123.fee, 10, '123.45 价位卖出手续费')
assertEqual(sell123.proceeds, 980, '123.45 价位到账取整')

const sellQuote = quoteStockSell(9.9, 50)
assertEqual(sellQuote.gross, 495, '卖出毛收入 = 份额 × 现价')
assertEqual(sellQuote.fee, 5, '卖出手续费 = 1% 向上取整')
assertEqual(sellQuote.proceeds, 490, '卖出到账扣手续费取整')
assertEqual(quoteStockSell(0, 50).proceeds, 0, '零份额无到账')
assertEqual(quoteStockSell(1, 0).fee, 0, '零收入无手续费')

assertEqual(positionMarketValue(9.9, 52), 515, '持仓市值按现价取整')
assertEqual(positionMarketValue(9.9, 0), 0, '零价格市值为 0')
assertEqual(positionProfit(515, 500), 15, '浮动盈亏 = 市值 - 成本')
assertEqual(positionProfitPct(515, 500), 3, '盈亏百分比两位小数')
assertEqual(positionProfitPct(500, 0), 0, '零成本盈亏百分比为 0')

// 部分卖出成本分摊
assertEqual(splitCostForShares(100, 10, 10), 100, '整仓分摊 = 全部成本')
assertEqual(splitCostForShares(101, 5, 10), 51, '半仓分摊 = round 一半')
assertEqual(splitCostForShares(100, 3, 10), 30, '三成分摊等比')
assertEqual(splitCostForShares(100, 0, 10), 0, '零份额分摊为 0')
assertEqual(splitCostForShares(100, 20, 10), 100, '超额份额夹到全部成本')
assertEqual(splitCostForShares(100, 5, 0), 0, '总份额为 0 返回 0')
assertEqual(splitCostForShares(0, 5, 10), 0, '零成本分摊为 0')

// === tickIndexOf ===
resetTicksForTest()
assertEqual(tickIndexOf(DATE, shanghaiDayStart(DATE)), 0, '上海 0 点 = tick 0')
assertEqual(tickIndexOf(DATE, shanghaiDayStart(DATE) + 86_400_000 - 1), STOCK_TICKS_PER_DAY - 1, '23:59:59.999 → 最后一 tick')
assertEqual(tickIndexOf(DATE, shanghaiDayStart(DATE) + 86_399_000), STOCK_TICKS_PER_DAY - 1, '23:59:59 → 最后一 tick')
assertEqual(tickIndexOf(DATE, shanghaiDayStart(DATE) + STOCK_TICK_MS - 1), 0, '首个 tick 内仍为 0')
assertEqual(tickIndexOf(DATE, shanghaiDayStart(DATE) + STOCK_TICK_MS), 1, '3 秒后进入 tick 1')
assertEqual(tickIndexOf(NEXT_DATE, shanghaiDayStart(NEXT_DATE)), 0, '次日 0 点属于新日 tick 0')
assertEqual(tickIndexOf(DATE, shanghaiDayStart(NEXT_DATE)), STOCK_TICKS_PER_DAY - 1, '同一时刻在旧日键下夹到最后一 tick')
assertEqual(shanghaiDayStart('2026-10-31'), dateKeyToUtc('2026-10-31') - 8 * 3600 * 1000, 'UTC 边界：dayStart = dateKeyToUtc − 8h')
assertEqual(tickIndexOf('2026-10-31', shanghaiDayStart('2026-10-31') - 5_000), 0, '早于当日 0 点夹到 0')

// === basePath 确定性（resetTicksForTest 后重算完全一致） ===
resetTicksForTest()
const probeTicks = [0, 1, 97, 5_000, 12_345, STOCK_TICKS_PER_DAY - 1]
const beforeQuotes = STOCK_DEFINITIONS.map((definition) =>
  probeTicks.map((tick) => getLiveQuote(definition, DATE, tickNow(DATE, tick))),
)
resetTicksForTest()
for (const [index, definition] of STOCK_DEFINITIONS.entries()) {
  const after = probeTicks.map((tick) => getLiveQuote(definition, DATE, tickNow(DATE, tick)))
  assertEqual(after, beforeQuotes[index], `${definition.code} 重算后报价完全一致（同 code/dateKey/tick）`)
}

// === 噪声有界（|basePath/anchor − 1| ≤ 3%） ===
// 推导：单步增量 ∈ [−σ_tick, +σ_tick]（三角分布，标准差 σ_tick/√6 ≈ 0.41σ_tick）；
// OU 平稳标准差 = σ_tick × (1/√6) / √(1 − 0.993²) ≈ 3.46σ_tick，波动率最高的 CRMS
// （σ_tick = 0.036 × √(3000/86400000) × 2 ≈ 4.24e-4）平稳标准差 ≈ 1.5e-3；日内约
// 28800/143 ≈ 200 个独立样本，经验极值 ≈ 3σ ≈ 0.5%。取 3%（≈ 20 倍平稳标准差）为
// 安全上界，并对全部 8 只股票做全天抽样扫描验证实际序列。
resetTicksForTest()
const NOISE_BOUND = 0.03
for (const definition of STOCK_DEFINITIONS) {
  const series = dailyByCode.get(definition.code)!
  const open = series[series.length - 1].open
  const close = series[series.length - 1].close
  let scanned = 0
  for (let tick = 0; tick < STOCK_TICKS_PER_DAY; tick += tick < 300 ? 1 : 257) {
    const quote = getLiveQuote(definition, DATE, tickNow(DATE, tick))
    const anchor = open + (close - open) * (tick / (STOCK_TICKS_PER_DAY - 1))
    assert(quote.price > 0, `${definition.code} tick${tick} 价格为正`)
    assert(Math.abs(quote.price / anchor - 1) <= NOISE_BOUND, `${definition.code} tick${tick} 噪声在界内`)
    scanned += 1
  }
  assert(scanned > 400, `${definition.code} 噪声扫描覆盖足够样本`)
}

// === 日界衔接 ===
resetTicksForTest()
for (const definition of STOCK_DEFINITIONS) {
  const endQuote = getLiveQuote(definition, DATE, tickNow(DATE, STOCK_TICKS_PER_DAY - 1))
  const close = dailyByCode.get(definition.code)![STOCK_HISTORY_DAYS - 1].close
  assert(
    Math.abs(endQuote.price - close) <= close * NOISE_BOUND + 0.01,
    `${definition.code} 日末基准价贴合收盘价（差 ≤ 噪声上界）`,
  )
  const nextOpen = getStockDailySeries(definition, NEXT_DATE)[STOCK_HISTORY_DAYS - 1].open
  const firstQuote = getLiveQuote(definition, NEXT_DATE, shanghaiDayStart(NEXT_DATE))
  assertEqual(firstQuote.price, nextOpen, `${definition.code} 次日 tick0 = 次日开盘价（噪声起始为 0）`)
}

// === 冲击纯函数 ===
resetTicksForTest()
assertEqual(decayImpact(0.02, 0), 0.02, '零时长衰减不变')
assertClose(decayImpact(0.02, STOCK_IMPACT_HALF_LIFE_MS), 0.01, 1e-12, '半衰期后恰为一半')
assertClose(decayImpact(0.02, STOCK_IMPACT_HALF_LIFE_MS * 2), 0.005, 1e-12, '两个半衰期为四分之一')
assertEqual(decayImpact(0.02, -5), 0.02, '负时长按 0 处理')
assertEqual(clampImpact(0.1), STOCK_IMPACT_MAX, '正向夹紧到 +5%')
assertEqual(clampImpact(-0.1), -STOCK_IMPACT_MAX, '负向夹紧到 −5%')
assertEqual(clampImpact(0.01), 0.01, '界内不变')
assertClose(applyBuyImpact(0, 10_000), 10_000 * STOCK_IMPACT_PER_POINT, 1e-12, '每 1 万积分买入 +0.2%')
assertEqual(applyBuyImpact(0.0499, 10_000), STOCK_IMPACT_MAX, '买入冲击封顶')
assertEqual(applyBuyImpact(0, 0), 0, '零买入无冲击')
assertClose(applySellImpact(0, 5_000), -5_000 * STOCK_IMPACT_PER_POINT, 1e-12, '卖出按毛收入压低')
assertEqual(applySellImpact(-STOCK_IMPACT_MAX, 1_000_000), -STOCK_IMPACT_MAX, '卖出冲击封底')
assertEqual(applySellImpact(0, 0), 0, '零卖出无冲击')

// === 冲击状态：生效 / 脏标记 / 持久化往返 / 容错 ===
resetTicksForTest()
assertEqual(isImpactDirty(), false, '初始无脏标记')
assertEqual(getImpact('LWST', 0), 0, '未交易股票冲击为 0')
const t0 = 1_700_000_000_000
applyTradeImpactDelta('LWST', 20_000, t0)
assert(isImpactDirty(), '交易后标记为脏')
assertClose(getImpact('LWST', t0), 0.004, 1e-12, '冲击即时生效')
markImpactPersisted()
assertEqual(isImpactDirty(), false, 'markImpactPersisted 清除脏标记')
const impactJson = serializeImpactState(t0)
assert(impactJson.includes('LWST'), '序列化包含股票代码')
assert(impactJson.includes('"savedAt"'), '序列化携带 savedAt')
resetTicksForTest()
loadImpactStateFromJson(impactJson, t0)
assertClose(getImpact('LWST', t0), 0.004, 1e-12, '序列化 → 恢复往返一致')
assertEqual(isImpactDirty(), false, '恢复后无脏标记')
resetTicksForTest()
loadImpactStateFromJson(impactJson, t0 + STOCK_IMPACT_HALF_LIFE_MS)
assertClose(getImpact('LWST', t0 + STOCK_IMPACT_HALF_LIFE_MS), 0.002, 1e-9, '恢复时按 savedAt 差值衰减')
resetTicksForTest()
loadImpactStateFromJson('不是 JSON', t0)
assertEqual(getImpact('LWST', t0), 0, '损坏 JSON 重置为 0')
loadImpactStateFromJson('{"savedAt":123}', t0)
assertEqual(getImpact('LWST', t0), 0, '缺 impacts 字段重置为 0')
loadImpactStateFromJson('{"savedAt":1,"impacts":{"LWST":"abc"}}', t0)
assertEqual(getImpact('LWST', t0), 0, '非法数值忽略')
loadImpactStateFromJson('{"impacts":{"LWST":0.01}}', t0)
assertClose(getImpact('LWST', t0), 0.01, 1e-12, '缺 savedAt 视为现在（不衰减）')
loadImpactStateFromJson(null, t0)
assertEqual(getImpact('LWST', t0), 0, 'null 重置为 0')
assertEqual(IMPACT_STATE_SETTING_KEY, 'stock.marketImpact', '持久化键名固定')

// === 实时报价与冲击生效 ===
resetTicksForTest()
const lwst = STOCK_DEFINITIONS[0]
const probeNow = tickNow(DATE, 1_200)
const baseQuote = getLiveQuote(lwst, DATE, probeNow)
assertEqual(baseQuote.open, dailyByCode.get('LWST')![STOCK_HISTORY_DAYS - 1].open, '开盘价取日线锚点（不含冲击）')
assertEqual(baseQuote.prevClose, dailyByCode.get('LWST')![STOCK_HISTORY_DAYS - 2].close, '昨收取日线倒数第二根收盘')
applyTradeImpactDelta('LWST', 50_000, probeNow)
const bumped = getLiveQuote(lwst, DATE, probeNow)
assert(bumped.price > baseQuote.price, '买入冲击立即抬升价格')
assertClose(bumped.price, baseQuote.price * 1.01, 0.02, '价格抬升幅度 ≈ +1%')
assertClose(getImpact('LWST', probeNow), 0.01, 1e-12, 'getImpact 读数一致')
applyTradeImpactDelta('LWST', -1_000_000, probeNow)
const sunk = getLiveQuote(lwst, DATE, probeNow)
assert(sunk.price < baseQuote.price, '大额卖出压低价格')
assertEqual(getImpact('LWST', probeNow), -STOCK_IMPACT_MAX, '冲击夹到下限')
assertClose(getImpact('LWST', probeNow + STOCK_IMPACT_HALF_LIFE_MS), -STOCK_IMPACT_MAX / 2, 1e-12, '冲击按半衰期衰减')
assert(isImpactDirty(), '冲击未落盘前保持脏标记')
resetTicksForTest()
const byCode = getLiveQuoteByCode('lwst', probeNow)
assert(byCode !== null && byCode.code === 'LWST', 'getLiveQuoteByCode 大小写归一')
assertEqual(getLiveQuoteByCode('NOPE', probeNow), null, '未知代码返回 null')

// === buildLiveMarket（新 DTO 契约） ===
resetTicksForTest()
const marketNow = tickNow(DATE, 4_321)
const market = buildLiveMarket(DATE, marketNow)
assertEqual(market.dateKey, DATE, '行情日期')
assertEqual(market.tickMs, STOCK_TICK_MS, 'tickMs = 3000')
assertEqual(market.tickIndex, 4_321, 'tickIndex 与 nowMs 一致')
assertEqual(market.tickIndex, tickIndexOf(DATE, marketNow), 'tickIndex 与 tickIndexOf 一致')
assertEqual(market.updatedAt, new Date(marketNow).toISOString(), 'updatedAt 为报价时间 ISO')
assertEqual(market.stocks.length, 8, '8 只股票')
assert(!('history' in market.stocks[0]), '实时报价不再内嵌 history')
assertEqual(market.currency, '模拟币', '计价单位')
assertEqual(market.disclaimer, STOCK_MARKET_DISCLAIMER, '免责声明为契约文案')
assert(market.disclaimer.includes('玩家交易会小幅影响价格'), '免责声明说明玩家冲击')
assertEqual(market.trade, { feeRate: STOCK_FEE_RATE, minInvest: STOCK_MIN_INVEST, maxInvest: STOCK_MAX_INVEST }, '交易规则下发')
const expectedAvg = Math.round(
  (market.stocks.reduce((sum, stock) => sum + stock.changePct, 0) / market.stocks.length) * 100,
) / 100
assertEqual(market.marketChangePct, expectedAvg, '大盘涨跌幅 = 算术平均')
for (const stock of market.stocks) {
  const series = dailyByCode.get(stock.code)!
  assert(stock.price > 0, `${stock.code} 实时价为正`)
  assert(stock.high >= Math.max(stock.open, stock.price) - 0.011, `${stock.code} 最高价不低于开/现价`)
  assert(stock.low <= Math.min(stock.open, stock.price) + 0.011, `${stock.code} 最低价不高于开/现价`)
  assert(stock.volume > 0, `${stock.code} 成交量为正`)
  assertEqual(stock.prevClose, series[STOCK_HISTORY_DAYS - 2].close, `${stock.code} 昨收衔接日线`)
  assertClose(stock.change, stock.price - stock.prevClose, 0.011, `${stock.code} 涨跌额口径`)
  assert(Math.abs(stock.changePct - (stock.change / stock.prevClose) * 100) < 0.02, `${stock.code} 涨跌幅一致`)
}

// === buildStockTrend（日线 + 分时） ===
resetTicksForTest()
for (const definition of [STOCK_DEFINITIONS[0], STOCK_DEFINITIONS[4]]) {
  const trendNow = tickNow(DATE, 6_003)
  const trend = buildStockTrend(definition, DATE, trendNow)
  const quote = getLiveQuote(definition, DATE, trendNow)
  const series = getStockDailySeries(definition, DATE)
  assertEqual(trend.code, definition.code, `${definition.code} 趋势代码`)
  assertEqual(trend.name, definition.name, `${definition.code} 趋势名称`)
  assertEqual(trend.dateKey, DATE, `${definition.code} 趋势日期`)
  assertEqual(trend.tickMs, STOCK_TICK_MS, `${definition.code} 趋势 tickMs`)
  assertEqual(trend.daily.length, STOCK_HISTORY_DAYS, `${definition.code} 日线 30 根`)
  assertEqual(trend.daily.slice(0, -1), series.slice(0, -1), `${definition.code} 历史 29 根日线不变`)
  assertEqual(trend.daily[trend.daily.length - 1].date, DATE, `${definition.code} 今日 K 线日期`)
  assertEqual(trend.daily[trend.daily.length - 1].open, quote.open, `${definition.code} 今日开盘 = 秒级开盘`)
  assertEqual(trend.daily[trend.daily.length - 1].close, quote.price, `${definition.code} 今日收盘 = 实时价`)
  assertEqual(trend.daily[trend.daily.length - 1].volume, quote.volume, `${definition.code} 今日成交 = 实时累计`)
  assert(trend.daily[trend.daily.length - 1].high >= quote.price - 0.005, `${definition.code} 今日最高 ≥ 现价`)
  assert(trend.daily[trend.daily.length - 1].low <= quote.price + 0.005, `${definition.code} 今日最低 ≤ 现价`)

  const intraday = trend.intraday
  assert(intraday.length >= 2, `${definition.code} 分时至少 2 点`)
  assertEqual(intraday[0].t, 0, `${definition.code} 分时从 0 点开始`)
  for (let i = 1; i < intraday.length; i += 1) {
    assert(intraday[i].t > intraday[i - 1].t, `${definition.code} 分时 t 单调递增`)
    if (i < intraday.length - 1) {
      assertEqual(intraday[i].t - intraday[i - 1].t, 60_000, `${definition.code} 分时采样间隔 60 秒`)
      assertEqual(intraday[i].t % 60_000, 0, `${definition.code} 分时采样落在 60 秒整点`)
    }
  }
  const lastPoint = intraday[intraday.length - 1]
  assertEqual(lastPoint.t, 6_003 * STOCK_TICK_MS, `${definition.code} 最新点对齐当前 tick`)
  assertEqual(lastPoint.price, quote.price, `${definition.code} 最新点 = 实时价`)
}

console.log(`✅ 模拟股市自检通过：${passed} 个断言`)
