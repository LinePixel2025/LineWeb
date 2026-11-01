/**
 * 模拟股市纯函数自检（不依赖数据库 / 环境变量 / 网络 / prisma）
 *
 * 覆盖：
 * - 12 只股票定义（代码唯一 / 分红收益率范围 / 长期正向漂移）；
 * - 日线生成器：确定性、相邻日衔接、high/low 合法、长期牛市偏向；
 * - 实时 tick 引擎：基准路径确定性、tick0 = 开盘、日末贴合收盘、盘中慢波包络；
 * - 新闻事件：确定性、条数 ≤2、id 唯一、触发前无冲击、触发后单调衰减、半衰期；
 * - 交易报价（0.3% 手续费精确值）与部分卖出成本分摊；
 * - 分红纯函数（stockDailyDividend / isOvernightHolding / totalAssets）；
 * - DTO 契约：12 只 + dividendYield + news + index + marketMood + 趋势 news。
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
  type StockDefinition,
} from '../src/lib/stockMarket.js'
import {
  STOCK_FEE_RATE,
  STOCK_MAX_INVEST,
  STOCK_MIN_INVEST,
  isOvernightHolding,
  positionMarketValue,
  positionProfit,
  positionProfitPct,
  quoteStockBuy,
  quoteStockSell,
  splitCostForShares,
  stockDailyDividend,
  totalAssets,
} from '../src/lib/stockTrading.js'
import {
  IMPACT_STATE_SETTING_KEY,
  STOCK_IMPACT_HALF_LIFE_MS,
  STOCK_IMPACT_MAX,
  STOCK_IMPACT_PER_POINT,
  STOCK_NEWS_MAX_EVENTS,
  STOCK_TICK_MS,
  STOCK_TICKS_PER_DAY,
  applyBuyImpact,
  applySellImpact,
  applyTradeImpactDelta,
  buildDayNews,
  buildLiveMarket,
  buildStockTrend,
  clampImpact,
  dayWave,
  decayImpact,
  eventImpactAt,
  getBasePathAt,
  getDayNews,
  getImpact,
  getLiveQuote,
  getLiveQuoteByCode,
  isImpactDirty,
  loadImpactStateFromJson,
  marketIndexOf,
  marketMoodOf,
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

function round2(value: number): number {
  return Math.round(value * 100) / 100
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

// === 股票定义（12 只 / 字段完整 / 分红收益率 / 正向漂移） ===
assertEqual(STOCK_DEFINITIONS.length, 12, '扩充到 12 只虚构股票')
assertEqual(new Set(STOCK_DEFINITIONS.map((item) => item.code)).size, 12, '股票代码唯一')
for (const definition of STOCK_DEFINITIONS) {
  assert(definition.code.length >= 3 && definition.code.length <= 5, `${definition.code} 代码长度合理`)
  assert(definition.name.length > 0 && definition.sector.length > 0, `${definition.code} 名称与板块非空`)
  assert(definition.basePrice > 1, `${definition.code} 起始价为正`)
  assert(definition.volatility >= 0.01 && definition.volatility <= 0.05, `${definition.code} 日波动率在 1%–5%`)
  assert(
    definition.dividendYield >= 0.003 && definition.dividendYield <= 0.016,
    `${definition.code} 每日分红收益率在 0.3%–1.6%`,
  )
  assert(definition.drift >= -0.001 && definition.drift <= 0.005, `${definition.code} 日漂移在 ±0.5% 内`)
  assert(definition.baseVolume > 0, `${definition.code} 基础成交量为正`)
  assert(/^#[0-9a-f]{6}$/i.test(definition.color), `${definition.code} 主色为 6 位十六进制`)
}

// 旧 8 只保留 code/name/sector
for (const code of ['LWST', 'SPRU', 'BWHL', 'QILN', 'CRMS', 'GRNA', 'AURS', 'IRNW']) {
  assert(STOCK_DEFINITIONS.some((item) => item.code === code), `保留原股票 ${code}`)
}
// 新增 4 只：航天 / 消费 / 新能源 / 游戏
const addedCodes = ['NOVA', 'MINT', 'VOLT', 'ORCA']
for (const code of addedCodes) {
  assert(STOCK_DEFINITIONS.some((item) => item.code === code), `新增股票 ${code}`)
}
assertEqual(
  addedCodes.map((code) => STOCK_DEFINITIONS.find((item) => item.code === code)?.sector),
  ['航天', '消费', '新能源', '游戏'],
  '新增股票覆盖航天 / 消费 / 新能源 / 游戏板块',
)
// 正向长期漂移：11 只做多，只留 AURS 一只负漂移当风险标的
const negativeDrifts = STOCK_DEFINITIONS.filter((item) => item.drift < 0).map((item) => item.code)
assertEqual(negativeDrifts, ['AURS'], '仅 AURS 保留负漂移（高风险标的）')
assertEqual(STOCK_DEFINITIONS.filter((item) => item.drift > 0).length, 11, '11 只股票正漂移')
assert(
  STOCK_DEFINITIONS.filter((item) => item.drift > 0).every((item) => item.drift >= 0.0015),
  '正漂移均 ≥ +0.15%/日（牛市偏向）',
)

// === 日线结构 ===
resetTicksForTest()
const dailyByCode = new Map(
  STOCK_DEFINITIONS.map((definition) => [definition.code, getStockDailySeries(definition, DATE)]),
)
const day1 = buildStockMarket(DATE)
assertEqual(day1.stocks.length, STOCK_DEFINITIONS.length, '股票数量等于定义数量')
assertEqual(day1.stocks.length, 12, '日线行情 12 只')
assert(day1.disclaimer.includes('模拟行情'), '免责声明标注模拟行情')
assert(day1.disclaimer.includes('每日分红'), '免责声明说明每日分红')
assert(day1.disclaimer.includes('新闻事件'), '免责声明说明新闻事件')
assert(day1.disclaimer.includes('每 3 秒刷新'), '免责声明说明 3 秒刷新')
assert(day1.disclaimer.includes('0.3% 手续费'), '免责声明说明 0.3% 手续费')
assert(day1.disclaimer.includes('玩家交易会小幅影响价格'), '免责声明说明玩家冲击')
assertEqual(day1.disclaimer, STOCK_MARKET_DISCLAIMER, '免责声明为契约文案')
assertEqual(day1.currency, '模拟币', '计价单位')
assertEqual(day1.trade, { feeRate: STOCK_FEE_RATE, minInvest: STOCK_MIN_INVEST, maxInvest: STOCK_MAX_INVEST }, '交易规则下发')
assertEqual(STOCK_FEE_RATE, 0.003, '单边手续费 0.3%')
assert(!('tickMs' in day1), '日线构建器不产生实时 tick 字段')
assert(!('index' in day1), '日线构建器不产生大盘指数')
assert(!('marketMood' in day1), '日线构建器不产生市场情绪')
for (const [index, stock] of day1.stocks.entries()) {
  const definition = STOCK_DEFINITIONS[index]
  const series = dailyByCode.get(definition.code)!
  assertEqual(stock.code, definition.code, '行情按定义顺序输出')
  assertEqual(stock.dividendYield, definition.dividendYield, `${stock.code} 日线下发分红收益率`)
  assert(!('news' in stock), `${stock.code} 日线构建器不产生新闻事件`)
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
  for (const candle of series) {
    assert(candle.open > 0 && candle.close > 0, `${stock.code} ${candle.date} 价格为正`)
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

// === 长期牛市偏向（正向漂移 + 低均值回归的可观测结果） ===
function windowReturn(definition: StockDefinition, endDateKey: string, days: number): number {
  const endSeries = getStockDailySeries(definition, endDateKey)
  const endClose = endSeries[endSeries.length - 1].close
  const startKey = new Date(dateKeyToUtc(endDateKey) - days * 86_400_000).toISOString().slice(0, 10)
  const startSeries = getStockDailySeries(definition, startKey)
  const startClose = startSeries[startSeries.length - 1].close
  return endClose / startClose - 1
}
const monthReturns = STOCK_DEFINITIONS.map((definition) => windowReturn(definition, DATE, 30))
const monthMean = monthReturns.reduce((sum, value) => sum + value, 0) / monthReturns.length
assert(monthMean > 0, `12 只 30 日平均收益为正（机会成本被漂移 + 分红覆盖），实际 ${(monthMean * 100).toFixed(2)}%`)
assert(monthReturns.filter((value) => value > 0).length >= 6, '30 日内至少一半股票上涨')
const twoYearReturns = STOCK_DEFINITIONS.map((definition) => windowReturn(definition, DATE, 730))
const twoYearMean = twoYearReturns.reduce((sum, value) => sum + value, 0) / twoYearReturns.length
assert(twoYearMean > 0.1, `两年平均收益 > 10%（长期牛市偏向），实际 ${(twoYearMean * 100).toFixed(2)}%`)
assert(twoYearReturns.filter((value) => value > 0).length === 12, '两年维度 12 只全部上涨')
// 日线不再被均值回归压成「原地踏步」：波动仍在，才有择时空间
const monthSpread = Math.max(...monthReturns) - Math.min(...monthReturns)
assert(monthSpread > 0.02, '30 日收益仍有分化（可择时）')

// === 交易纯函数（0.3% 手续费） ===
const buyQuote = quoteStockBuy(500, 50)
assertEqual(buyQuote.points, 500, '买入预算按整数积分')
assertEqual(buyQuote.fee, 2, '500 积分手续费 = ceil(1.5) = 2')
assertEqual(buyQuote.netPoints, 498, '买入净投入扣手续费')
assertEqual(buyQuote.shares, 9.96, '买入份额 = 净投入 / 现价')
assertEqual(quoteStockBuy(1000, 50).fee, 3, '1000 积分手续费 = 3（恰好 0.3%）')
assertEqual(quoteStockBuy(100, 18.6).fee, 1, '最低手续费 1 积分')
assertEqual(quoteStockBuy(334, 10).fee, 2, '334 积分手续费 = ceil(1.002) = 2')
assertEqual(quoteStockBuy(333, 10).fee, 1, '333 积分手续费 = ceil(0.999) = 1')
assertEqual(quoteStockBuy(0, 10).shares, 0, '零预算不能买入')
assertEqual(quoteStockBuy(-100, 10).fee, 0, '负预算归零')
assertEqual(quoteStockBuy(10_000, 0).shares, 0, '零价格不产生份额')

// 固定价格 123.45 的精确值：1000 → fee 3、net 997
const buy123 = quoteStockBuy(1000, 123.45)
assertEqual(buy123.fee, 3, '123.45 价位买入手续费 = 3')
assertEqual(buy123.netPoints, 997, '123.45 价位净投入 = 997')
assertClose(buy123.shares, 997 / 123.45, 1e-12, '123.45 价位份额 = 净投入 / 现价')
const sell123 = quoteStockSell(8.08, 123.45)
assertEqual(sell123.gross, 997.48, '123.45 价位毛收入 round2')
assertEqual(sell123.fee, 3, '123.45 价位卖出手续费 = ceil(2.99) = 3')
assertEqual(sell123.proceeds, 994, '123.45 价位到账取整')

const sellQuote = quoteStockSell(9.96, 50)
assertEqual(sellQuote.gross, 498, '卖出毛收入 = 份额 × 现价')
assertEqual(sellQuote.fee, 2, '卖出手续费 = ceil(1.494) = 2')
assertEqual(sellQuote.proceeds, 496, '卖出到账扣手续费取整')
assertEqual(quoteStockSell(100, 10).fee, 3, '1000 毛收入卖出手续费 = 3')
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

// === 分红纯函数 / 隔夜判定 / 总资产 ===
assertEqual(stockDailyDividend(1000, 0.008), 8, '1000 积分 × 0.8% = 8 分')
assertEqual(stockDailyDividend(1010, 0.008), 8, '8.08 四舍五入到 8')
assertEqual(stockDailyDividend(1075, 0.008), 9, '8.6 四舍五入到 9')
assertEqual(stockDailyDividend(100, 0.003), 0, '0.3 四舍五入到 0（不产生碎分）')
assertEqual(stockDailyDividend(0, 0.01), 0, '零市值无分红')
assertEqual(stockDailyDividend(-100, 0.01), 0, '负市值按 0')
assertEqual(stockDailyDividend(1000, 0), 0, '零收益率无分红')
assertEqual(stockDailyDividend(1000, -0.01), 0, '负收益率按 0')

const dayStart = shanghaiDayStart(DATE)
assertEqual(isOvernightHolding(new Date(dayStart - 1), dayStart), true, '昨日持仓算隔夜')
assertEqual(isOvernightHolding(new Date(dayStart), dayStart), false, '当日 0 点整不算隔夜')
assertEqual(isOvernightHolding(new Date(dayStart + 1), dayStart), false, '当日买入不算隔夜')
assertEqual(isOvernightHolding(new Date(dayStart - 86_400_000), dayStart), true, '更早的持仓算隔夜')

assertEqual(totalAssets(1200, 800), 2000, '总资产 = 余额 + 市值')
assertEqual(totalAssets(0, 0), 0, '空账户总资产为 0')
assertEqual(totalAssets(-50, 300), 300, '负余额按 0 处理')
assertEqual(totalAssets(100.6, 200.4), 301, '总资产按整数取整')

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

// === 基准路径确定性（resetTicksForTest 后重算完全一致） ===
resetTicksForTest()
const probeTicks = [0, 1, 97, 5_000, 12_345, STOCK_TICKS_PER_DAY - 1]
const beforeBases = STOCK_DEFINITIONS.map((definition) =>
  probeTicks.map((tick) => getBasePathAt(definition, DATE, tick, tickNow(DATE, tick))),
)
resetTicksForTest()
for (const [index, definition] of STOCK_DEFINITIONS.entries()) {
  const after = probeTicks.map((tick) => getBasePathAt(definition, DATE, tick, tickNow(DATE, tick)))
  assertEqual(after, beforeBases[index], `${definition.code} 基准路径重算完全一致（同 code/dateKey/tick）`)
}

// === 盘中慢波（确定性 + tick0 = 0 + 日末归零 + 幅度有界） ===
resetTicksForTest()
let waveDiffCount = 0
for (const [index, definition] of STOCK_DEFINITIONS.entries()) {
  const first = dayWave(definition.code, DATE, 0)
  assertEqual(first, 0, `${definition.code} 慢波 tick0 = 0（不破坏次日开盘衔接）`)
  assert(Math.abs(dayWave(definition.code, DATE, STOCK_TICKS_PER_DAY - 1)) < 1e-12, `${definition.code} 慢波日末归零`)
  const again = dayWave(definition.code, DATE, 1_234)
  assertEqual(again, dayWave(definition.code, DATE, 1_234), `${definition.code} 慢波同参数一致`)
  let maxAbs = 0
  for (let tick = 0; tick < STOCK_TICKS_PER_DAY; tick += 3) {
    maxAbs = Math.max(maxAbs, Math.abs(dayWave(definition.code, DATE, tick)))
  }
  assert(maxAbs <= 0.0125, `${definition.code} 慢波幅度 ≤ 1.25%`)
  assert(maxAbs >= 0.002, `${definition.code} 慢波确实产生日内波段（≥0.2%）`)
  if (index > 0 && dayWave(definition.code, DATE, 5_000) !== dayWave(STOCK_DEFINITIONS[0].code, DATE, 5_000)) {
    waveDiffCount += 1
  }
}
assert(waveDiffCount >= STOCK_DEFINITIONS.length - 2, '不同股票的慢波形态互不相同')

// === 基准路径不变量：tick0 = 今日开盘，日末贴合收盘 ===
resetTicksForTest()
for (const definition of STOCK_DEFINITIONS) {
  const series = dailyByCode.get(definition.code)!
  const today = series[series.length - 1]
  const openAtZero = getBasePathAt(definition, DATE, 0, tickNow(DATE, 0))
  assertEqual(openAtZero, today.open, `${definition.code} tick0 基准价 = 今日开盘价`)
  const endBase = getBasePathAt(definition, DATE, STOCK_TICKS_PER_DAY - 1, tickNow(DATE, STOCK_TICKS_PER_DAY - 1))
  // 日末：慢波包络归零、OU 噪声约 ±0.5%，允许 2% 偏差（旧版实测 ≈0.1%）
  assert(Math.abs(endBase / today.close - 1) <= 0.02, `${definition.code} 日末基准价贴合收盘价（±2%）`)
}

// === 基准路径幅度有界（噪声 ±3% + 慢波 ±1.2%） ===
resetTicksForTest()
const BASE_BOUND = 0.045
for (const definition of STOCK_DEFINITIONS) {
  const series = dailyByCode.get(definition.code)!
  const open = series[series.length - 1].open
  const close = series[series.length - 1].close
  let scanned = 0
  for (let tick = 0; tick < STOCK_TICKS_PER_DAY; tick += (tick < 300 ? 1 : 257)) {
    const base = getBasePathAt(definition, DATE, tick, tickNow(DATE, tick))
    const anchor = open + (close - open) * (tick / (STOCK_TICKS_PER_DAY - 1))
    assert(base > 0, `${definition.code} tick${tick} 基准价为正`)
    assert(Math.abs(base / anchor - 1) <= BASE_BOUND, `${definition.code} tick${tick} 噪声 + 慢波在界内`)
    scanned += 1
  }
  assert(scanned > 100, `${definition.code} 基准路径扫描覆盖足够样本`)
}

// === 新闻事件（确定性 / 条数 / id 唯一 / 触发与衰减） ===
resetTicksForTest()
const newsByCode = new Map(
  STOCK_DEFINITIONS.map((definition) => [definition.code, buildDayNews(definition, DATE)]),
)
const allEvents = STOCK_DEFINITIONS.flatMap((definition) => newsByCode.get(definition.code)!)
assert(allEvents.length >= 3, '全市场当天至少有 3 条快讯（多只股票合计）')
assertEqual(new Set(allEvents.map((event) => event.id)).size, allEvents.length, '新闻事件 id 全市场唯一')
for (const definition of STOCK_DEFINITIONS) {
  const events = newsByCode.get(definition.code)!
  assertEqual(events, buildDayNews(definition, DATE), `${definition.code} 同日新闻确定性`)
  assert(events.length <= STOCK_NEWS_MAX_EVENTS, `${definition.code} 每日事件数 ≤ 2`)
  assertEqual(events.length, events.filter((event) => event.code === definition.code).length, `${definition.code} 事件归属正确`)
  for (const event of events) {
    assertEqual(event.id.startsWith(`${definition.code}-${DATE}-`), true, `${definition.code} 事件 id 格式稳定`)
    assert(event.startTick >= 1 && event.startTick <= STOCK_TICKS_PER_DAY - 1, `${definition.code} 触发 tick 在 1..28799`)
    const magnitude = Math.abs(event.impact)
    assert(magnitude >= 0.015 && magnitude <= 0.05, `${definition.code} 冲击幅度在 1.5%–5%`)
    assertEqual(event.impact > 0 ? 'good' : 'bad', event.sentiment, `${definition.code} 冲击符号与情绪一致`)
    assert(
      event.halfLifeMs >= 45 * 60_000 && event.halfLifeMs <= 120 * 60_000,
      `${definition.code} 半衰期在 45–120 分钟`,
    )
    assert(event.title.includes(definition.name), `${definition.code} 快讯标题带股票名`)
    assert(event.title.length >= 8 && event.summary.length >= 10, `${definition.code} 文案完整`)
    assert(!event.title.includes('{{') && !event.summary.includes('{{'), `${definition.code} 文案占位符已替换`)
  }
  assertEqual(eventImpactAt(events, 0), 0, `${definition.code} tick0 无事件冲击`)
  // 同一只股票的事件不重叠：后一条触发时，前一条已衰减到 ≤ 6.25%
  for (let index = 1; index < events.length; index += 1) {
    const gap = events[index].startTick - events[index - 1].startTick
    const needed = Math.ceil((events[index - 1].halfLifeMs * 4) / STOCK_TICK_MS)
    assert(gap >= needed, `${definition.code} 事件间隔 ≥ 4 个半衰期（不重叠）`)
  }
  if (events.length > 0) {
    const first = events[0]
    assertClose(eventImpactAt([first], first.startTick), first.impact, 1e-12, `${definition.code} 触发瞬间为初始幅度`)
    const halfTick = first.startTick + Math.round(first.halfLifeMs / STOCK_TICK_MS)
    if (halfTick <= STOCK_TICKS_PER_DAY - 1) {
      assertClose(
        Math.abs(eventImpactAt([first], halfTick)),
        Math.abs(first.impact) / 2,
        Math.abs(first.impact) * 0.002 + 1e-9,
        `${definition.code} 半衰期后剩一半强度`,
      )
    }
    let previous = Math.abs(eventImpactAt([first], first.startTick))
    let monotonic = true
    for (let step = 1; step <= 20; step += 1) {
      const tick = Math.min(STOCK_TICKS_PER_DAY - 1, first.startTick + step * 60)
      const value = Math.abs(eventImpactAt([first], tick))
      if (value > previous + 1e-12) monotonic = false
      previous = value
    }
    assert(monotonic, `${definition.code} 触发后冲击单调衰减`)
  }
}
// 事件随日期变化（不是每天都一样）
assert(
  STOCK_DEFINITIONS.some(
    (definition) => JSON.stringify(buildDayNews(definition, DATE)) !== JSON.stringify(buildDayNews(definition, NEXT_DATE)),
  ),
  '不同日期的事件组合不同',
)
// 抽样 60 天：利好 / 利空都要出现，且平均每天约 0.5–1.5 条/股
let goodCount = 0
let badCount = 0
let sampledEvents = 0
for (let day = 0; day < 60; day += 1) {
  const dateKey = new Date(dateKeyToUtc('2026-09-01') + day * 86_400_000).toISOString().slice(0, 10)
  for (const definition of STOCK_DEFINITIONS) {
    for (const event of buildDayNews(definition, dateKey)) {
      sampledEvents += 1
      if (event.sentiment === 'good') goodCount += 1
      else badCount += 1
    }
  }
}
assert(sampledEvents > 300, '60 天抽样事件数量足够（约 8 条/天）')
assert(goodCount >= 100 && badCount >= 100, '利好 / 利空文案池都被使用到')

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

// === 实时报价：玩家冲击生效，且价格 = 基准价 × (1 + 冲击 + 事件冲击) ===
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

// 价格口径：实时价 = round2(基准价 × (1 + 玩家冲击 + 事件冲击))
resetTicksForTest()
const formulaTick = 9_000
const formulaNow = tickNow(DATE, formulaTick)
for (const definition of STOCK_DEFINITIONS) {
  const quote = getLiveQuote(definition, DATE, formulaNow)
  const base = getBasePathAt(definition, DATE, formulaTick, formulaNow)
  const events = getDayNews(definition, DATE)
  const impact = eventImpactAt(events, formulaTick)
  assertClose(
    quote.price,
    round2(Math.max(0.5, base * (1 + impact))),
    0.011,
    `${definition.code} 实时价 = 基准价 × (1 + 事件冲击)`,
  )
  assertEqual(quote.news?.length ?? 0, events.length, `${definition.code} 报价携带当日全部事件`)
}

// === 日界衔接 ===
resetTicksForTest()
for (const definition of STOCK_DEFINITIONS) {
  const endQuote = getLiveQuote(definition, DATE, tickNow(DATE, STOCK_TICKS_PER_DAY - 1))
  const close = dailyByCode.get(definition.code)![STOCK_HISTORY_DAYS - 1].close
  // 日末：慢波归零 + 噪声约 0.5% + 事件冲击最多 5% → 放宽到 8%
  assert(
    Math.abs(endQuote.price - close) <= close * 0.08 + 0.01,
    `${definition.code} 日末实时价贴近收盘价（含事件冲击上界）`,
  )
  const nextOpen = getStockDailySeries(definition, NEXT_DATE)[STOCK_HISTORY_DAYS - 1].open
  const firstQuote = getLiveQuote(definition, NEXT_DATE, shanghaiDayStart(NEXT_DATE))
  assertEqual(firstQuote.price, nextOpen, `${definition.code} 次日 tick0 = 次日开盘价（噪声/慢波起点为 0）`)
}

// === buildLiveMarket（新 DTO 契约） ===
resetTicksForTest()
const marketNow = tickNow(DATE, 4_321)
const market = buildLiveMarket(DATE, marketNow)
assertEqual(market.dateKey, DATE, '行情日期')
assertEqual(market.tickMs, STOCK_TICK_MS, 'tickMs = 3000')
assertEqual(market.tickIndex, 4_321, 'tickIndex 与 nowMs 一致')
assertEqual(market.tickIndex, tickIndexOf(DATE, marketNow), 'tickIndex 与 tickIndexOf 一致')
assertEqual(market.updatedAt, new Date(marketNow).toISOString(), 'updatedAt 为报价时间 ISO')
assertEqual(market.stocks.length, 12, '实时行情 12 只股票')
assertEqual(market.currency, '模拟币', '计价单位')
assertEqual(market.disclaimer, STOCK_MARKET_DISCLAIMER, '免责声明为契约文案')
assertEqual(market.trade, { feeRate: STOCK_FEE_RATE, minInvest: STOCK_MIN_INVEST, maxInvest: STOCK_MAX_INVEST }, '交易规则下发')
const expectedAvg = Math.round(
  (market.stocks.reduce((sum, stock) => sum + stock.changePct, 0) / market.stocks.length) * 100,
) / 100
assertEqual(market.marketChangePct, expectedAvg, '大盘涨跌幅 = 算术平均')
assertEqual(market.index, marketIndexOf(market.marketChangePct), '大盘指数 = 1000 ×（1 + 平均涨跌）')
assertEqual(market.index, round2(1000 * (1 + market.marketChangePct / 100)), '指数点位口径')
assertEqual(market.marketMood, marketMoodOf(market.marketChangePct), '市场情绪口径')
assert(['bull', 'flat', 'bear'].includes(market.marketMood ?? ''), '市场情绪取值合法')
assertEqual(marketMoodOf(0.61), 'bull', '+0.61% 判牛')
assertEqual(marketMoodOf(0.6), 'flat', '+0.6% 仍为震荡')
assertEqual(marketMoodOf(-0.6), 'flat', '−0.6% 仍为震荡')
assertEqual(marketMoodOf(-0.61), 'bear', '−0.61% 判熊')
assertEqual(marketIndexOf(0), 1000, '零涨跌指数 1000')
assertEqual(marketIndexOf(1.23), 1012.3, '指数保留 2 位')
assertEqual(marketIndexOf(-2.5), 975, '负涨跌指数下移')
const marketEvents = STOCK_DEFINITIONS.flatMap((definition) => getDayNews(definition, DATE))
assertEqual(
  market.stocks.reduce((sum, stock) => sum + (stock.news?.length ?? 0), 0),
  marketEvents.length,
  '行情下发的新闻总数 = 当日事件总数',
)
for (const stock of market.stocks) {
  const series = dailyByCode.get(stock.code)!
  const definition = STOCK_DEFINITIONS.find((item) => item.code === stock.code)!
  assert(stock.price > 0, `${stock.code} 实时价为正`)
  assertEqual(stock.dividendYield, definition.dividendYield, `${stock.code} 实时行情带分红收益率`)
  assert(stock.high >= Math.max(stock.open, stock.price) - 0.011, `${stock.code} 最高价不低于开/现价`)
  assert(stock.low <= Math.min(stock.open, stock.price) + 0.011, `${stock.code} 最低价不高于开/现价`)
  assert(stock.volume > 0, `${stock.code} 成交量为正`)
  assertEqual(stock.prevClose, series[STOCK_HISTORY_DAYS - 2].close, `${stock.code} 昨收衔接日线`)
  assertClose(stock.change, stock.price - stock.prevClose, 0.011, `${stock.code} 涨跌额口径`)
  assert(Math.abs(stock.changePct - (stock.change / stock.prevClose) * 100) < 0.02, `${stock.code} 涨跌幅一致`)
  const news = stock.news ?? []
  assert(news.length <= 2, `${stock.code} 快讯 ≤ 2 条`)
  for (let index = 0; index < news.length; index += 1) {
    const item = news[index]
    assertEqual(typeof item.id, 'string', `${stock.code} 快讯 id 为字符串`)
    assertEqual(item.sentiment === 'good' ? true : item.sentiment === 'bad', true, `${stock.code} 情绪合法`)
    assertEqual(Date.parse(item.startAt), shanghaiDayStart(DATE) + item.startTick * STOCK_TICK_MS, `${stock.code} startAt 与 startTick 对齐`)
    assertEqual(item.active, item.startTick <= market.tickIndex, `${stock.code} active 与触发 tick 一致`)
    if (item.active) {
      assert(Math.abs(item.currentImpact) <= Math.abs(item.impact) + 1e-9, `${stock.code} 当前冲击不超过初始幅度`)
    } else {
      assertEqual(item.currentImpact, 0, `${stock.code} 未触发事件不透露当前冲击`)
    }
    if (index > 0) {
      assert(news[index].startTick > news[index - 1].startTick, `${stock.code} 快讯按触发时间升序`)
    }
  }
}
// tick 0：全部事件都未触发、冲击为 0（开盘价不受新闻影响）
const marketAtZero = buildLiveMarket(DATE, shanghaiDayStart(DATE))
for (const stock of marketAtZero.stocks) {
  for (const item of stock.news ?? []) {
    assertEqual(item.active, false, `${stock.code} 开盘瞬间事件未触发`)
    assertEqual(item.currentImpact, 0, `${stock.code} 开盘瞬间无事件冲击`)
  }
}

// === buildStockTrend（日线 + 分时 + 新闻标记） ===
resetTicksForTest()
for (const definition of [STOCK_DEFINITIONS[0], STOCK_DEFINITIONS[9]]) {
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
  // 新闻随趋势下发，前端据此在分时图打事件标记
  assertEqual(trend.news.length, getDayNews(definition, DATE).length, `${definition.code} 趋势携带当日新闻`)
  for (const item of trend.news) {
    assert(item.startTick * trend.tickMs >= 0 && item.startTick * trend.tickMs < 86_400_000, `${definition.code} 事件标记落在当日时间轴`)
    assertEqual(item.active, item.startTick <= 6_003, `${definition.code} 事件标记 active 与当前 tick 一致`)
  }
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
  assert(intraday.every((point) => point.price > 0), `${definition.code} 分时价格均为正`)
}

// === 分时采样已并入事件冲击（新闻触发后采样点应随事件抬升 / 压低） ===
resetTicksForTest()
const eventStock = STOCK_DEFINITIONS.find((definition) => getDayNews(definition, DATE).length > 0)!
const eventQuote = buildStockTrend(eventStock, DATE, tickNow(DATE, STOCK_TICKS_PER_DAY - 1))
assert(eventQuote.intraday.length > 10, `${eventStock.code} 全天分时有足够采样`)
assertEqual(eventQuote.intraday[eventQuote.intraday.length - 1].price, getLiveQuote(eventStock, DATE, tickNow(DATE, STOCK_TICKS_PER_DAY - 1)).price, '日末采样点 = 实时价')

// === 交易日缓存可重置（自检隔离） ===
resetTicksForTest()
const fresh = getLiveQuote(STOCK_DEFINITIONS[0], DATE, tickNow(DATE, 0))
resetTicksForTest()
const restarted = getLiveQuote(STOCK_DEFINITIONS[0], DATE, tickNow(DATE, 0))
assertEqual(fresh, restarted, '进程重启（缓存清空）后同一 tick 报价一致')

console.log(`✅ 模拟股市自检通过：${passed} 个断言`)
