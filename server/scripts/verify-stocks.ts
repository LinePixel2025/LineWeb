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
  getStockMarket,
  mulberry32,
  seedFromString,
} from '../src/lib/stockMarket.js'

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
assert(day1.disclaimer.includes('不可交易'), '免责声明包含不可交易')
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

console.log(`✅ 模拟股市自检通过：${passed} 个断言`)
