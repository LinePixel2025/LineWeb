/**
 * 模拟股市纯函数自检（不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-stocks.ts
 *      （或 npm run verify:stocks）
 */

import {
  STOCK_DEFINITIONS,
  STOCK_EPOCH,
  STOCK_HISTORY_DAYS,
  buildStockMarket,
  dayIndexSinceEpoch,
  findStockQuote,
  getStockMarket,
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
} from '../src/lib/stockTrading.js'

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

// === 行情结构 ===
const day1 = buildStockMarket('2026-10-29')
assertEqual(day1.stocks.length, STOCK_DEFINITIONS.length, '股票数量等于定义数量')
assertEqual(day1.stocks.length, 8, '默认 8 只虚构股票')
assert(day1.disclaimer.includes('模拟行情'), '免责声明标注模拟行情')
assertEqual(day1.trade, { feeRate: STOCK_FEE_RATE, minInvest: STOCK_MIN_INVEST, maxInvest: STOCK_MAX_INVEST }, '交易规则下发')
assertEqual(findStockQuote(day1, 'LWST')?.code, 'LWST', '按代码取报价')
assertEqual(findStockQuote(day1, 'NOPE'), null, '未知代码返回 null')
assertEqual(day1.currency, '模拟币', '计价单位')
for (const stock of day1.stocks) {
  assertEqual(stock.history.length, STOCK_HISTORY_DAYS, `${stock.code} 有 30 日走势`)
  assertEqual(stock.history[stock.history.length - 1].date, '2026-10-29', `${stock.code} 最后一根是请求日`)
  assert(stock.price > 0, `${stock.code} 价格为正`)
  assert(stock.high >= Math.max(stock.open, stock.price) - 0.001, `${stock.code} 最高价不低于开/收`)
  assert(stock.low <= Math.min(stock.open, stock.price) + 0.001, `${stock.code} 最低价不高于开/收`)
  assert(stock.volume > 0, `${stock.code} 成交量为正`)
  assertEqual(stock.prevClose, stock.history[stock.history.length - 2].close, `${stock.code} 昨收上一根收盘`)
  assert(Math.abs(stock.change - (stock.price - stock.prevClose)) < 0.011, `${stock.code} 涨跌额 = 现价 - 昨收`)
  assert(Math.abs(stock.changePct - (stock.change / stock.prevClose) * 100) < 0.02, `${stock.code} 涨跌幅一致`)
  for (const candle of stock.history) {
    assert(candle.high >= candle.close && candle.high >= candle.open, `${stock.code} ${candle.date} 上影线合法`)
    assert(candle.low <= candle.close && candle.low <= candle.open, `${stock.code} ${candle.date} 下影线合法`)
  }
}

// === 确定性与连续性 ===
assertEqual(buildStockMarket('2026-10-29'), day1, '同一天重复生成完全一致')
const day2 = buildStockMarket('2026-10-30')
const yesterdayOverlap = day1.stocks[0].history.slice(1).map((candle) => candle.close)
const todayOverlap = day2.stocks[0].history.slice(0, -1).map((candle) => candle.close)
assertEqual(todayOverlap, yesterdayOverlap, '相邻两天的走势首尾衔接（随机游走连续）')
assert(day1.marketChangePct !== 0, '大盘涨跌幅有数值')
const cached = getStockMarket('2026-10-29')
assertEqual(cached, day1, 'getStockMarket 同一天走缓存且结果一致')
const cachedNext = getStockMarket('2026-10-30')
assertEqual(cachedNext.dateKey, '2026-10-30', '缓存跨日自动失效')

// === 不改外部状态 ===
const again = getStockMarket('2026-10-29')
assertEqual(again, day1, '回到旧日期时重新生成仍与原始结果一致')


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

// 同日买卖必然亏手续费（行情不变）
const roundTrip = quoteStockSell(quoteStockBuy(500, day1.stocks[0].price).shares, day1.stocks[0].price)
assert(roundTrip.proceeds < 500, '同日一买一卖净亏手续费')

console.log(`✅ 模拟股市自检通过：${passed} 个断言`)
