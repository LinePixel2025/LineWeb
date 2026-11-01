/**
 * 聊天积分红包规则纯函数自检（不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-redpacket.ts
 *      （或 npm run verify:redpacket）
 */

import {
  RED_PACKET_DEFAULT_GREETING,
  RED_PACKET_EXPIRE_MS,
  RED_PACKET_MAX_COUNT,
  RED_PACKET_MAX_GREETING,
  RED_PACKET_MAX_TOTAL,
  normalizeRedPacketGreeting,
  splitLuckyAmount,
  validateRedPacketCreateInput,
} from '../src/lib/redpacket.js'

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

/* ============================================================
   常量
   ============================================================ */

assertEqual(RED_PACKET_EXPIRE_MS, 86_400_000, '过期时长为 24 小时')
assertEqual(RED_PACKET_MAX_TOTAL, 50_000, '单个红包总积分上限 50000')
assertEqual(RED_PACKET_MAX_COUNT, 100, '拼手气红包最大 100 份')
assertEqual(RED_PACKET_MAX_GREETING, 50, '祝福语上限 50 字')
assert(RED_PACKET_DEFAULT_GREETING.length > 0 && RED_PACKET_DEFAULT_GREETING.length <= RED_PACKET_MAX_GREETING, '默认祝福语非空且不超上限')

/* ============================================================
   splitLuckyAmount：二倍均值法单份拆分
   ============================================================ */

/** 确定性取上界：比 1 小的最大双精度数，floor(rng*hi) === hi-1 */
const RNG_MAX = 1 - Number.EPSILON / 2

/** 手工推导的期望上界：min(floor(2×剩余/份数), 剩余-(份数-1), 剩余)，至少 1 */
function expectUpperBound(remaining: number, count: number): number {
  return Math.max(1, Math.min(Math.floor((remaining / count) * 2), remaining - (count - 1), remaining))
}

// 兜底：输入不合法返回 0
assertEqual(splitLuckyAmount(0, 5), 0, '剩余 0 → 0')
assertEqual(splitLuckyAmount(-3, 5), 0, '剩余为负 → 0')
assertEqual(splitLuckyAmount(100, 0), 0, '份数 0 → 0')
assertEqual(splitLuckyAmount(100, -2), 0, '份数为负 → 0')
assertEqual(splitLuckyAmount(Number.NaN, 5), 0, 'NaN → 0')

// 最后一份（剩余份数 ≤ 1）拿走剩余全部
assertEqual(splitLuckyAmount(7, 1), 7, '剩余 1 份 → 剩余全部（7）')
assertEqual(splitLuckyAmount(1, 1), 1, '剩余 1 份 → 剩余全部（1）')
assertEqual(splitLuckyAmount(12345, 1), 12345, '剩余 1 份 → 剩余全部（12345）')

// 下界：rng=0 → 每份取最小 1
for (const [remaining, count] of [[100, 10], [7, 5], [10000, 100], [3, 3], [50, 2]] as const) {
  assertEqual(splitLuckyAmount(remaining, count, () => 0), 1, `rng=0 时 (${remaining},${count}) 取下界 1`)
}

// 上界：rng→1^- 取期望上界（二倍均值与预留下限的较小者）
for (const [remaining, count] of [[100, 10], [7, 5], [10000, 100], [3, 3], [50, 2]] as const) {
  assertEqual(splitLuckyAmount(remaining, count, () => RNG_MAX), expectUpperBound(remaining, count), `rng→1^- 时 (${remaining},${count}) 取上界`)
}

// 经典上界值抽查：100/10 → 20（二倍均值）、7/5 → 2、50/2 → 49（均值 50 被预留下限压到 49）
assertEqual(expectUpperBound(100, 10), 20, '(100,10) 上界 = 二倍均值 20')
assertEqual(expectUpperBound(7, 5), 2, '(7,5) 上界 = 2')
assertEqual(expectUpperBound(50, 2), 49, '(50,2) 上界 = 49（留 1 给最后一份）')

// 上界必须 ≤ 剩余 - (份数-1)：保证后续每份至少 1
assert(splitLuckyAmount(50, 2, () => RNG_MAX) <= 50 - 1, '(50,2) 首份 ≤ 49，留 1 给最后一份')

// 非整数输入按 floor 兜底，不抛错
assertEqual(splitLuckyAmount(2.9, 2.9, () => RNG_MAX), expectUpperBound(2, 2), '非整数输入按 floor 处理')

// 退化区间（剩余 < 份数，校验层不会出现）：每份仍 ≥1 且 ≤ 剩余
for (const [remaining, count] of [[2, 5], [1, 3], [5, 9]] as const) {
  for (const rng of [() => 0, () => RNG_MAX, Math.random]) {
    const share = splitLuckyAmount(remaining, count, rng)
    assert(share >= 1, `退化 (${remaining},${count}) 每份 ≥1`)
    assert(share <= remaining, `退化 (${remaining},${count}) 每份 ≤ 剩余`)
  }
}

/* ============================================================
   模拟完整领取：逐份拆分直到发完，校验总额与上下界不变量
   ============================================================ */

/** 逐份模拟领取并就地断言不变量；返回份额数组 */
function simulateLucky(total: number, count: number, rng: () => number, label: string): number[] {
  const shares: number[] = []
  let remainingPoints = total
  let remainingCount = count
  while (remainingCount > 0) {
    const share = splitLuckyAmount(remainingPoints, remainingCount, rng)
    assert(share >= 1, `${label} 每份 ≥1（remaining=${remainingPoints}, count=${remainingCount}）`)
    assert(share <= remainingPoints, `${label} 每份 ≤ 当轮剩余（remaining=${remainingPoints}, count=${remainingCount}）`)
    if (remainingCount > 1) {
      // 最后一份走「拿走剩余」路径，不受二倍均值约束
      assert(
        share <= Math.floor((remainingPoints / remainingCount) * 2),
        `${label} 非最后一份 ≤ 二倍均值（remaining=${remainingPoints}, count=${remainingCount}）`,
      )
      assert(
        share <= remainingPoints - (remainingCount - 1),
        `${label} 非最后一份给后面每份留 1（remaining=${remainingPoints}, count=${remainingCount}）`,
      )
    }
    shares.push(share)
    remainingPoints -= share
    remainingCount -= 1
  }
  assertEqual(remainingPoints, 0, `${label} 恰好发完`)
  const sum = shares.reduce((acc, value) => acc + value, 0)
  assertEqual(sum, total, `${label} Σ份额 === 总积分`)
  const headSum = shares.slice(0, -1).reduce((acc, value) => acc + value, 0)
  assertEqual(shares[shares.length - 1], total - headSum, `${label} 最后一份 === 剩余`)
  return shares
}

const COMBOS: ReadonlyArray<readonly [number, number]> = [
  [100, 10],
  [7, 5],
  [10000, 100],
  [3, 3],
  [1, 1],
]

for (const [total, count] of COMBOS) {
  // 同一组合用固定 rng 与随机 rng 各模拟若干轮
  for (let round = 0; round < 5; round += 1) {
    simulateLucky(total, count, Math.random, `Math.random 模拟 (${total},${count}) 第 ${round + 1} 轮`)
  }
  simulateLucky(total, count, () => 0, `rng=0 模拟 (${total},${count})`)
  simulateLucky(total, count, () => RNG_MAX, `rng→1^- 模拟 (${total},${count})`)
}

// 极端组合：最大规格与最小规格
simulateLucky(RED_PACKET_MAX_TOTAL, 2, Math.random, `Math.random 模拟 (${RED_PACKET_MAX_TOTAL},2)`)
simulateLucky(RED_PACKET_MAX_TOTAL, RED_PACKET_MAX_COUNT, Math.random, `Math.random 模拟 (${RED_PACKET_MAX_TOTAL},${RED_PACKET_MAX_COUNT})`)

// 确定性：同 rng 序列两次模拟结果一致（纯函数无隐藏状态）
function sequenceOf(total: number, count: number, seed: number): number[] {
  // mulberry32 简易种子随机，保证两次调用序列一致
  let state = seed
  return simulateLuckyReturn(total, count, () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  })
}

/** 与 simulateLucky 相同但不就地断言（返回份额数组） */
function simulateLuckyReturn(total: number, count: number, rng: () => number): number[] {
  const shares: number[] = []
  let remainingPoints = total
  let remainingCount = count
  while (remainingCount > 0) {
    const share = splitLuckyAmount(remainingPoints, remainingCount, rng)
    shares.push(share)
    remainingPoints -= share
    remainingCount -= 1
  }
  return shares
}

assertEqual(sequenceOf(100, 10, 42), sequenceOf(100, 10, 42), '同种子两次模拟序列一致')

/* ============================================================
   normalizeRedPacketGreeting
   ============================================================ */

assertEqual(normalizeRedPacketGreeting(''), RED_PACKET_DEFAULT_GREETING, '空串 → 默认祝福语')
assertEqual(normalizeRedPacketGreeting('   '), RED_PACKET_DEFAULT_GREETING, '空白 → 默认祝福语')
assertEqual(normalizeRedPacketGreeting(undefined), RED_PACKET_DEFAULT_GREETING, 'undefined → 默认祝福语')
assertEqual(normalizeRedPacketGreeting(null), RED_PACKET_DEFAULT_GREETING, 'null → 默认祝福语')
assertEqual(normalizeRedPacketGreeting(123), RED_PACKET_DEFAULT_GREETING, '非字符串 → 默认祝福语')
assertEqual(normalizeRedPacketGreeting('  恭喜发财  '), '恭喜发财', 'trim 前后空白')
assertEqual(normalizeRedPacketGreeting('大吉大利').length, 4, '正常祝福语原样保留')
assertEqual(normalizeRedPacketGreeting('红'.repeat(80)).length, RED_PACKET_MAX_GREETING, '超长截断到 50')
assertEqual(normalizeRedPacketGreeting('a'.repeat(49) + 'b'.repeat(20)), 'a'.repeat(49) + 'b', '截断保留前 50 字符')
assert(normalizeRedPacketGreeting('　 surrounding 　').trim().length > 0, '全角空白包裹仍有内容')

/* ============================================================
   validateRedPacketCreateInput
   ============================================================ */

// single：份数强制 1
const single = validateRedPacketCreateInput({ type: 'single', totalPoints: 100, count: 8, greeting: ' 收好 ' })
assert(single.ok, 'single 合法入参通过')
if (single.ok) {
  assertEqual(single.value.count, 1, 'single 份数强制为 1')
  assertEqual(single.value.greeting, '收好', 'single greeting 归一化')
  assertEqual(single.value.totalPoints, 100, 'single 金额保留')
  assertEqual(single.value.type, 'single', 'single 类型保留')
}

// single 边界金额
assert(validateRedPacketCreateInput({ type: 'single', totalPoints: 1 }).ok, 'single 金额下界 1 通过')
assert(validateRedPacketCreateInput({ type: 'single', totalPoints: RED_PACKET_MAX_TOTAL }).ok, `single 金额上界 ${RED_PACKET_MAX_TOTAL} 通过`)
assert(!validateRedPacketCreateInput({ type: 'single', totalPoints: 0 }).ok, 'single 金额 0 拒绝')
assert(!validateRedPacketCreateInput({ type: 'single', totalPoints: -5 }).ok, 'single 负数金额拒绝')
assert(!validateRedPacketCreateInput({ type: 'single', totalPoints: RED_PACKET_MAX_TOTAL + 1 }).ok, 'single 超上限拒绝')
assert(!validateRedPacketCreateInput({ type: 'single', totalPoints: 10.5 }).ok, 'single 非整数金额拒绝')
assert(!validateRedPacketCreateInput({ type: 'single', totalPoints: '100' }).ok, 'single 字符串金额拒绝')
assert(!validateRedPacketCreateInput({ type: 'single' }).ok, 'single 缺金额拒绝')

// lucky：份数 2..100 且 total ≥ count
const lucky = validateRedPacketCreateInput({ type: 'lucky', totalPoints: 100, count: 10 })
assert(lucky.ok, 'lucky 合法入参通过')
if (lucky.ok) {
  assertEqual(lucky.value.count, 10, 'lucky 份数保留')
  assertEqual(lucky.value.greeting, RED_PACKET_DEFAULT_GREETING, 'lucky 缺省 greeting 回退默认')
}

assert(validateRedPacketCreateInput({ type: 'lucky', totalPoints: 2, count: 2 }).ok, 'lucky total === count 通过（每份 1）')
assert(!validateRedPacketCreateInput({ type: 'lucky', totalPoints: 100, count: 1 }).ok, 'lucky count=1 拒绝（拼手气至少 2 份）')
assert(!validateRedPacketCreateInput({ type: 'lucky', totalPoints: 100, count: 0 }).ok, 'lucky count=0 拒绝')
assert(!validateRedPacketCreateInput({ type: 'lucky', totalPoints: 100, count: 101 }).ok, 'lucky count 超 100 拒绝')
assert(!validateRedPacketCreateInput({ type: 'lucky', totalPoints: 100 }).ok, 'lucky 缺 count 拒绝')
assert(!validateRedPacketCreateInput({ type: 'lucky', totalPoints: 100, count: 10.5 }).ok, 'lucky 非整数 count 拒绝')
assert(!validateRedPacketCreateInput({ type: 'lucky', totalPoints: 5, count: 10 }).ok, 'lucky total < count 拒绝（每份至少 1）')

// greeting 截断与类型
const longGreeting = validateRedPacketCreateInput({ type: 'lucky', totalPoints: 100, count: 10, greeting: 'x'.repeat(80) })
assert(longGreeting.ok && longGreeting.value.greeting.length === RED_PACKET_MAX_GREETING, 'greeting 超长截断到 50')

// 非法整体输入
assert(!validateRedPacketCreateInput(null).ok, 'null 拒绝')
assert(!validateRedPacketCreateInput(undefined).ok, 'undefined 拒绝')
assert(!validateRedPacketCreateInput(42).ok, '非对象拒绝')
assert(!validateRedPacketCreateInput({}).ok, '缺 type 拒绝')
assert(!validateRedPacketCreateInput({ type: 'mega', totalPoints: 100 }).ok, '未知 type 拒绝')

// 错误信息可读（非空字符串）
const bad = validateRedPacketCreateInput({ type: 'lucky', totalPoints: 5, count: 10 })
assert(bad.ok === false && bad.error.length > 0, '校验失败带非空错误信息')

/* ============================================================
   汇总
   ============================================================ */

console.log(`✅ 红包纯函数自检通过：${passed} 个断言`)
