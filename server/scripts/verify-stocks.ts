/**
 * 模拟股市纯函数自检（不依赖数据库 / 环境变量 / 网络 / prisma）
 *
 * 2026-11 重构后的覆盖：
 * - 12 只股票定义：无正漂移（对称随机）、波动率范围、代码唯一；
 * - 日线生成器：确定性、相邻日衔接、high/low 合法；
 * - 实时 tick 引擎：基准路径确定性、tick0 = 开盘、无慢波；
 * - 外部事件：注入 / 衰减 / 合计冲击上限 / 模板兜底；
 * - 玩家冲击：每 1 万 +1%、±25% 夹紧、15 分钟半衰期、序列化容错；
 * - 成交滑点：买入加价、卖出减价、大额往返必亏；
 * - 交易报价（0.3% 手续费精确值）与部分卖出成本分摊；
 * - DTO 契约：12 只 + news/source + index + mood + 趋势。
 *
 * 用法: cd server && npx tsx scripts/verify-stocks.ts
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
  executionPriceWithImpact,
  positionMarketValue,
  positionProfit,
  positionProfitPct,
  quoteStockBuy,
  quoteStockSell,
  splitCostForShares,
  totalAssets,
} from '../src/lib/stockTrading.js'
import {
  IMPACT_STATE_SETTING_KEY,
  STOCK_EVENT_IMPACT_CAP,
  STOCK_IMPACT_HALF_LIFE_MS,
  STOCK_IMPACT_MAX,
  STOCK_IMPACT_PER_POINT,
  STOCK_NEWS_MAX_HALF_LIFE_MS,
  STOCK_NEWS_MAX_IMPACT,
  STOCK_NEWS_MIN_HALF_LIFE_MS,
  STOCK_NEWS_MIN_IMPACT,
  STOCK_TICK_MS,
  STOCK_TICKS_PER_DAY,
  applyTradeImpactDelta,
  buildFallbackNewsEvents,
  buildLiveMarket,
  buildStockTrend,
  clampImpact,
  clearExternalNews,
  decayImpact,
  eventImpactAt,
  getBasePathAt,
  getDayNews,
  getImpact,
  getLiveExecutionPrice,
  getLiveQuote,
  getLiveQuoteByCode,
  injectExternalNews,
  isImpactDirty,
  loadExternalNews,
  loadImpactStateFromJson,
  marketIndexOf,
  marketMoodOf,
  markImpactPersisted,
  resetTicksForTest,
  serializeImpactState,
  tickIndexOf,
  type StockNewsEvent,
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

const DATE = '2026-11-02'
const NEXT_DATE = '2026-11-03'

function shanghaiDayStart(dateKey: string): number {
  return dateKeyToUtc(dateKey) - 8 * 3600 * 1000
}

function tickNow(dateKey: string, tick: number): number {
  return shanghaiDayStart(dateKey) + tick * STOCK_TICK_MS
}

function makeEvent(overrides: Partial<StockNewsEvent> = {}): StockNewsEvent {
  return {
    id: 'LWST-test-0',
    code: 'LWST',
    title: '测试快讯',
    summary: '测试摘要',
    sentiment: 'good',
    startTick: 100,
    impact: 0.05,
    halfLifeMs: 60 * 60_000,
    source: 'ai',
    batchKey: `${DATE}T10:00`,
    ...overrides,
  }
}

/* ============================================================
   股票定义 / 日线
   ============================================================ */

{
  assertEqual(STOCK_DEFINITIONS.length, 12, '12 只虚构股票')
  const codes = new Set(STOCK_DEFINITIONS.map((item) => item.code))
  assertEqual(codes.size, 12, '股票代码唯一')
  assert(STOCK_DEFINITIONS.every((item) => item.drift === 0), '所有股票日漂移为 0（对称随机）')
  assert(
    STOCK_DEFINITIONS.every((item) => item.volatility >= 0.02 && item.volatility <= 0.06),
    '波动率在 2%–6% 之间',
  )
  assert(
    STOCK_DEFINITIONS.every((item) => item.basePrice > 0 && item.baseVolume > 0),
    '基础价与基础成交量合法',
  )
  assert(
    STOCK_DEFINITIONS.every((item) => /^#[0-9a-f]{6}$/i.test(item.color)),
    '每只股票有合法主色',
  )
}

{
  const definition = STOCK_DEFINITIONS[0]
  const series = getStockDailySeries(definition, DATE)
  const again = getStockDailySeries(definition, DATE)
  assertEqual(series.length, STOCK_HISTORY_DAYS, '30 日历史')
  assertEqual(series, again, '日线生成确定性')
  assertEqual(series[series.length - 1].date, DATE, '最后一根是目标日')

  for (let index = 1; index < series.length; index += 1) {
    const prev = series[index - 1]
    const current = series[index]
    assertClose(current.open, prev.close, prev.close * 0.03, `第 ${index} 天开盘衔接昨收`)
    assert(current.high >= Math.max(current.open, current.close), `第 ${index} 天 high 合法`)
    assert(current.low <= Math.min(current.open, current.close), `第 ${index} 天 low 合法`)
    assert(current.low > 0 && current.volume > 0, `第 ${index} 天价格与成交量合法`)
  }

  const nextSeries = getStockDailySeries(definition, NEXT_DATE)
  const nextDay = nextSeries[nextSeries.length - 1]
  assertClose(nextDay.open, series[series.length - 1].close, nextDay.open * 0.04, '跨日日线衔接')
  assertEqual(dayIndexSinceEpoch(NEXT_DATE) - dayIndexSinceEpoch(DATE), 1, '相邻日期索引差 1')
  assertEqual(STOCK_EPOCH, '2024-01-01', '纪元日稳定')
}

{
  // 全市场 30 日收益不应再有「清一色上涨」的牛市偏向
  const returns = STOCK_DEFINITIONS.map((definition) => {
    const series = getStockDailySeries(definition, DATE)
    return (series[series.length - 1].close - series[0].close) / series[0].close
  })
  assert(
    returns.some((value) => value > 0) && returns.some((value) => value < 0),
    '30 日收益有涨有跌（不再只赚不亏）',
  )
  const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
  assertClose(average, 0, 0.3, '30 日平均收益接近 0（随机区间）')
  const spread = Math.max(...returns) - Math.min(...returns)
  assert(spread > 0.02, '12 只股票 30 日收益有分化')
}

/* ============================================================
   tick 引擎
   ============================================================ */

{
  resetTicksForTest()
  const definition = STOCK_DEFINITIONS[3]
  const todayOpen = getStockDailySeries(definition, DATE).at(-1)!.open
  const quote0 = getLiveQuote(definition, DATE, tickNow(DATE, 0))
  assertEqual(quote0.price, todayOpen, 'tick0 价格 = 今日开盘')

  const pathA = getBasePathAt(definition, DATE, 500, tickNow(DATE, 500))
  resetTicksForTest()
  const pathB = getBasePathAt(definition, DATE, 500, tickNow(DATE, 500))
  assertClose(pathA, pathB, 1e-9, '基准路径确定性（重启零跳变）')
  assert(pathA > 0, '基准路径价格为正')

  const lastQuote = getLiveQuote(definition, DATE, tickNow(DATE, STOCK_TICKS_PER_DAY - 1))
  assert(lastQuote.price > 0, '日末价格为正')

  assertEqual(tickIndexOf(DATE, tickNow(DATE, 0)), 0, 'tick 索引 0')
  assertEqual(tickIndexOf(DATE, tickNow(DATE, 123)), 123, 'tick 索引 123')
  assertEqual(tickIndexOf(DATE, tickNow(DATE, STOCK_TICKS_PER_DAY + 10)), STOCK_TICKS_PER_DAY - 1, 'tick 索引封顶')
  assertEqual(tickIndexOf(DATE, shanghaiDayStart(DATE) - 1000), 0, '日界前按 0 处理')
}

/* ============================================================
   外部事件（AI / 模板）
   ============================================================ */

{
  resetTicksForTest()
  const definition = STOCK_DEFINITIONS[0]
  loadExternalNews([makeEvent({ startTick: 100 })])
  const dayNews = getDayNews(definition, DATE)
  assertEqual(dayNews.length, 1, '外部事件加载到日缓存')
  assertEqual(dayNews[0].source, 'ai', '事件来源保留')

  assertEqual(eventImpactAt(dayNews, 99), 0, '触发前事件冲击为 0')
  assertClose(eventImpactAt(dayNews, 100), 0.05, 1e-9, '触发瞬间 = 初始冲击')
  const halfLifeLater = eventImpactAt(dayNews, 100 + Math.round((60 * 60_000) / STOCK_TICK_MS))
  assertClose(halfLifeLater, 0.025, 1e-6, '一个半衰期后剩一半')

  const event = makeEvent({ id: 'LWST-test-new', startTick: 200, impact: 0.03, batchKey: `${DATE}T12:40` })
  injectExternalNews(event)
  assertEqual(getDayNews(definition, DATE).length, 2, '注入新事件')
  injectExternalNews(event)
  assertEqual(getDayNews(definition, DATE).length, 2, '同批同股票事件去重')

  const many = [1, 2, 3, 4].map((index) =>
    makeEvent({ id: `LWST-cap-${index}`, startTick: 300, impact: 0.08, batchKey: `${DATE}T14:0${index}` }),
  )
  assertClose(eventImpactAt(many, 400), STOCK_EVENT_IMPACT_CAP, 1e-9, '多事件合计冲击夹紧 +12%')
  const negative = many.map((item) => ({ ...item, impact: -0.08 }))
  assertClose(eventImpactAt(negative, 400), -STOCK_EVENT_IMPACT_CAP, 1e-9, '多事件合计冲击夹紧 -12%')

  const rng = mulberry32(seedFromString('fallback-test'))
  const fallback = buildFallbackNewsEvents(DATE, `${DATE}T16:00`, tickNow(DATE, 1000), rng, 2)
  assertEqual(fallback.length, 2, '模板兜底生成 2 条事件')
  assertEqual(fallback.map((item) => item.sentiment), ['good', 'bad'], '模板兜底利好/利空各一条')
  assert(fallback.every((item) => item.source === 'template'), '模板事件 source=template')
  assert(
    fallback.every(
      (item) =>
        Math.abs(item.impact) >= STOCK_NEWS_MIN_IMPACT &&
        Math.abs(item.impact) <= STOCK_NEWS_MAX_IMPACT,
    ),
    '模板事件幅度在 1.5%–8%',
  )
  assert(
    fallback.every(
      (item) => item.halfLifeMs >= STOCK_NEWS_MIN_HALF_LIFE_MS && item.halfLifeMs <= STOCK_NEWS_MAX_HALF_LIFE_MS,
    ),
    '模板事件半衰期在 30–180 分钟',
  )
  assertEqual(new Set(fallback.map((item) => item.code)).size, 2, '同批模板事件股票不重复')
  clearExternalNews()
  assertEqual(getDayNews(definition, DATE).length, 0, '清空外部事件')
}

/* ============================================================
   玩家冲击
   ============================================================ */

{
  resetTicksForTest()
  assertClose(STOCK_IMPACT_PER_POINT, 1e-6, 1e-12, '每 1 积分冲击系数 1e-6')
  assertClose(STOCK_IMPACT_MAX, 0.25, 1e-9, '冲击上限 ±25%')
  assertClose(STOCK_IMPACT_HALF_LIFE_MS, 15 * 60_000, 1e-9, '冲击半衰期 15 分钟')

  assertClose(decayImpact(0.2, 0), 0.2, 1e-9, '0 秒不衰减')
  assertClose(decayImpact(0.2, STOCK_IMPACT_HALF_LIFE_MS), 0.1, 1e-9, '一个半衰期减半')
  assertClose(decayImpact(0.2, -1000), 0.2, 1e-9, '时钟回拨不放大')

  assertClose(clampImpact(0.5), 0.25, 1e-9, '正冲击夹紧 25%')
  assertClose(clampImpact(-0.5), -0.25, 1e-9, '负冲击夹紧 -25%')
  assertClose(clampImpact(0.1), 0.1, 1e-9, '区间内不变')

  const now = tickNow(DATE, 200)
  applyTradeImpactDelta('LWST', 10_000, now)
  assertClose(getImpact('LWST', now), 0.01, 1e-6, '买入 1 万积分推高 1%')
  applyTradeImpactDelta('LWST', 1_000_000, now)
  assertClose(getImpact('LWST', now), 0.25, 1e-6, '超过上限夹紧 25%')

  const snapshot = serializeImpactState(now)
  assert(snapshot.includes('LWST'), '序列化包含股票代码')
  loadImpactStateFromJson(snapshot, now + STOCK_IMPACT_HALF_LIFE_MS)
  assertClose(getImpact('LWST', now + STOCK_IMPACT_HALF_LIFE_MS), 0.125, 1e-5, '恢复后按时间差继续衰减')
  loadImpactStateFromJson('{bad json', now)
  assertEqual(getImpact('LWST', now), 0, '坏 JSON 重置为 0')
  loadImpactStateFromJson(null, now)
  assertEqual(getImpact('LWST', now), 0, 'null 重置为 0')
  markImpactPersisted()
  assertEqual(isImpactDirty(), false, '落盘标记清除')
  assertEqual(IMPACT_STATE_SETTING_KEY, 'stock.marketImpact', '冲击持久化 key 稳定')
}

/* ============================================================
   成交滑点 / 交易纯函数
   ============================================================ */

{
  assertClose(executionPriceWithImpact(100, 0.1), 110, 1e-9, '买入滑点：+10% 成交价')
  assertClose(executionPriceWithImpact(100, -0.1), 90, 1e-9, '卖出滑点：-10% 成交价')
  assertClose(executionPriceWithImpact(100, 0), 100, 1e-9, '无冲击按原价')
  assertEqual(executionPriceWithImpact(0.1, -0.9), 0.5, '成交价不低于 0.5')

  assertClose(STOCK_FEE_RATE, 0.003, 1e-9, '手续费 0.3%')
  const buy = quoteStockBuy(10_000, 100)
  assertEqual(buy.points, 10_000, '买入扣除预算')
  assertEqual(buy.fee, 30, '买入手续费 30')
  assertEqual(buy.netPoints, 9_970, '净买入 9970')
  assertClose(buy.shares, 99.7, 1e-9, '买入 99.7 份')

  const sell = quoteStockSell(99.7, 100)
  assertClose(sell.gross, 9_970, 1e-9, '卖出毛收入 9970')
  assertEqual(sell.fee, 30, '卖出手续费 30')
  assertEqual(sell.proceeds, 9_940, '到账 9940')
  assertEqual(STOCK_MIN_INVEST, 100, '单笔最少 100')
  assertEqual(STOCK_MAX_INVEST, 100_000, '单笔最多 100000')

  assertEqual(splitCostForShares(1000, 50, 100), 500, '成本等比分摊')
  assertEqual(splitCostForShares(1000, 100, 100), 1000, '整仓成本全部分摊')
  assertEqual(splitCostForShares(1000, 0, 100), 0, '0 份额成本 0')
  assertEqual(positionMarketValue(10, 12.345), 123, '市值四舍五入')
  assertEqual(positionProfit(120, 100), 20, '浮盈 20')
  assertEqual(positionProfitPct(120, 100), 20, '浮盈 20%')
  assertEqual(totalAssets(500, 700), 1200, '总资产 = 余额 + 市值')
}

{
  // 大额往返：买入立刻卖出必亏（手续费 + 双向滑点）
  resetTicksForTest()
  const definition = STOCK_DEFINITIONS[5]
  const now = tickNow(DATE, 300)
  const quote = getLiveQuote(definition, DATE, now)
  const budget = 100_000
  const buyPrice = getLiveExecutionPrice(definition.code, budget * STOCK_IMPACT_PER_POINT, now)
  assert(buyPrice !== null && buyPrice > quote.price, '大额买入成交价高于当前价')
  const buyQuote = quoteStockBuy(budget, buyPrice!)
  applyTradeImpactDelta(definition.code, budget, now)
  const afterBuy = getLiveQuote(definition, DATE, now)
  const grossEstimate = buyQuote.shares * afterBuy.price
  const sellPrice = getLiveExecutionPrice(definition.code, -grossEstimate * STOCK_IMPACT_PER_POINT, now)
  assert(sellPrice !== null && sellPrice < afterBuy.price, '大额卖出成交价低于当前价')
  const sellQuote = quoteStockSell(buyQuote.shares, sellPrice!)
  assert(sellQuote.proceeds < budget, `大额往返必亏：${sellQuote.proceeds} < ${budget}`)
}

/* ============================================================
   DTO / 行情 / 趋势
   ============================================================ */

{
  resetTicksForTest()
  loadExternalNews([makeEvent({ startTick: 50 })])
  const market = buildLiveMarket(DATE, tickNow(DATE, 60))
  assertEqual(market.stocks.length, 12, '行情 12 只股票')
  assertEqual(market.tickMs, STOCK_TICK_MS, 'tickMs = 3000')
  assertEqual(market.tickIndex, 60, 'tickIndex 正确')
  assert(market.index !== undefined && market.index > 0, '大盘指数存在')
  assert(
    market.marketMood === 'bull' || market.marketMood === 'flat' || market.marketMood === 'bear',
    '市场情绪合法',
  )
  assert(
    market.stocks.every((stock) => !('dividendYield' in stock)),
    '行情 DTO 不再包含分红字段',
  )
  const withNews = market.stocks.find((stock) => stock.code === 'LWST')!
  assertEqual(withNews.news?.length, 1, '行情携带 AI 事件')
  assertEqual(withNews.news?.[0].source, 'ai', '事件 DTO 携带 source')
  assert(withNews.news?.[0].active === true, 'tick 60 时 tick 50 事件已触发')
  assert(withNews.news![0].currentImpact > 0, '事件当前冲击为正')
  assert(market.disclaimer.includes('AI 每 40 分钟'), '免责声明包含 AI 事件说明')
  assert(market.disclaimer.includes('0.3%'), '免责声明包含手续费')

  assertClose(marketIndexOf(0), 1000, 1e-9, '大盘指数基准 1000')
  assertEqual(marketMoodOf(1), 'bull', '涨 1% 牛市')
  assertEqual(marketMoodOf(-1), 'bear', '跌 1% 熊市')
  assertEqual(marketMoodOf(0), 'flat', '0% 震荡')

  const trend = buildStockTrend(STOCK_DEFINITIONS[0], DATE, tickNow(DATE, 120))
  assertEqual(trend.daily.length, STOCK_HISTORY_DAYS, '趋势日线 30 根')
  assertEqual(trend.daily.at(-1)!.date, DATE, '趋势最后一根是今日')
  assert(trend.intraday.length > 0, '分时至少一个点')
  assert(trend.intraday.every((point, index, list) => index === 0 || point.t > list[index - 1].t), '分时时间严格递增')
  assertEqual(trend.news.length, 1, '趋势携带事件')

  const staticMarket = buildStockMarket(DATE)
  assertEqual(staticMarket.stocks.length, 12, '日线构建器 12 只')
  assertEqual(staticMarket.disclaimer, STOCK_MARKET_DISCLAIMER, '日线构建器复用免责声明')
  assert(staticMarket.stocks.every((stock) => stock.price > 0), '日线价格为正')
  assert(!('tickMs' in staticMarket), '日线构建器不产生实时 tick 字段')
}

{
  const quote = getLiveQuoteByCode('lwst', tickNow(DATE, 10))
  assert(quote !== null && quote.code === 'LWST', '按代码取报价（大小写归一）')
  assertEqual(getLiveQuoteByCode('NOPE', Date.now()), null, '未知代码返回 null')
}

resetTicksForTest()
console.log(`\n模拟股市自检通过：${passed} 项断言`)
