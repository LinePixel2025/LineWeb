/**
 * 积分抽奖纯函数自检（不依赖数据库 / 环境变量 / 网络）。
 *
 * 2026-11 调息后重点：完整奖池期望值（含种子满收价值、肥料、装扮折算、保底）
 * 必须低于十连每抽成本，避免抽奖成为无限刷分循环。
 *
 * 用法: cd server && npx tsx scripts/verify-lottery.ts
 */

import {
  LOTTERY_COSTS,
  LOTTERY_PRIZES,
  LOTTERY_PRIZE_LIST,
  LOTTERY_RARITY_LIST,
  LOTTERY_TOTAL_WEIGHT,
  LOTTERY_WEIGHTS_BY_RARITY,
  OUTFIT_FALLBACK_POINTS,
  PITY_LIMIT,
  TEN_DRAW_COUNT,
  isEpicOrBetter,
  isRareOrBetter,
  lotteryCost,
  nextPityAfterDraw,
  outfitFallbackPoints,
  pickPrize,
  resolvePity,
  rollPrizeAmount,
  sanitizeDrawCount,
  shouldTriggerPity,
  validateLotteryPrizes,
  type LotteryPrize,
  type LotteryRarity,
} from '../src/lib/lottery.js'
import { FARM_CROPS, FERTILIZER_COST } from '../src/lib/farmCrops.js'
import { PET_OUTFITS } from '../src/lib/petCatalog.js'

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

/** 线性同余伪随机数：分布够均匀，且不同进程跑出同一结果 */
function seededRng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const ALL_RARITIES: readonly LotteryRarity[] = ['common', 'rare', 'epic', 'legendary']

/* ============================================================
   奖品目录
   ============================================================ */

{
  const validation = validateLotteryPrizes()
  assert(
    validation.ok,
    `奖品目录校验通过${validation.errors.length > 0 ? `（${validation.errors.join('；')}）` : ''}`,
  )
  assertEqual(validation.totalWeight, 100, '奖品总权重 = 100')
  assertEqual(LOTTERY_TOTAL_WEIGHT, 100, '导出的 LOTTERY_TOTAL_WEIGHT = 100')
  assertEqual(
    LOTTERY_WEIGHTS_BY_RARITY,
    { common: 78, rare: 18, epic: 3.5, legendary: 0.5 },
    '各稀有度权重 78 / 18 / 3.5 / 0.5',
  )

  const keys = new Set(LOTTERY_PRIZES.map((prize) => prize.key))
  assertEqual(keys.size, LOTTERY_PRIZES.length, '奖品 key 唯一')
  assert(LOTTERY_PRIZES.every((prize) => prize.weight > 0), '所有奖品权重 > 0')
  assert(LOTTERY_PRIZES.every((prize) => prize.amount > 0), '所有奖品 amount > 0')
  assert(
    LOTTERY_PRIZES.every((prize) => Number.isInteger(prize.amount)),
    '所有奖品 amount 为整数',
  )

  const types = [...new Set(LOTTERY_PRIZES.map((prize) => prize.type))].sort()
  assertEqual(types, ['fertilizer', 'outfit', 'points', 'seed'], '四种奖品类型齐全')

  for (const rarity of ALL_RARITIES) {
    assert(
      LOTTERY_PRIZES.some((prize) => prize.rarity === rarity),
      `${rarity} 稀有度有奖品`,
    )
  }

  assertEqual(LOTTERY_RARITY_LIST.length, 4, '稀有度元数据 4 项')
  assert(
    LOTTERY_RARITY_LIST.every((meta) => meta.label && meta.color && meta.description),
    '稀有度元数据字段完整',
  )
}

/* ============================================================
   种子 / 装扮与真实目录对齐（键名不硬编码）
   ============================================================ */

/** 某档种子池 */
function seedPool(prize: LotteryPrize): typeof FARM_CROPS {
  const tierMin = Number(prize.payload?.tierMin)
  const tierMax = Number(prize.payload?.tierMax)
  const minValue = Number(prize.payload?.minValue ?? 0)
  return FARM_CROPS.filter(
    (crop) => crop.tier >= tierMin && crop.tier <= tierMax && crop.value >= minValue,
  )
}

/** 单颗种子的期望满收价值（与 lotteryService 的 1/value 加权选作物一致） */
function expectedSeedHarvest(prize: LotteryPrize): number {
  const pool = seedPool(prize)
  if (pool.length === 0) return 0
  const weights = pool.map((crop) => 1 / Math.max(1, crop.value))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  return pool.reduce(
    (sum, crop, index) =>
      sum + (weights[index] / totalWeight) * crop.yieldUnits * crop.value,
    0,
  )
}

{
  const seedPrizes = LOTTERY_PRIZES.filter((prize) => prize.type === 'seed')
  assertEqual(seedPrizes.length, 4, '普通 / 稀有 / 史诗 / 传说各一档种子')

  for (const prize of seedPrizes) {
    assert(seedPool(prize).length > 0, `${prize.key} 能在运行时农场目录中匹配到作物`)
  }

  const legendarySeed = LOTTERY_PRIZES.find((prize) => prize.key === 'seed_legendary')
  assert(!!legendarySeed, '存在传说种子奖品')
  if (legendarySeed) {
    const pool = seedPool(legendarySeed)
    assert(pool.some((crop) => crop.key === 'goldenapple'), '传说种子池包含金苹果')
    assert(pool.some((crop) => crop.key === 'starfruit'), '传说种子池包含星之果')
    assert(pool.every((crop) => crop.value >= 160), '传说种子池只含顶级作物')
  }

  const outfitPrizes = LOTTERY_PRIZES.filter((prize) => prize.type === 'outfit')
  assertEqual(outfitPrizes.length, 2, '史诗 / 传说各一档宠物装扮')
  assert(
    outfitPrizes.every((prize) => isEpicOrBetter(prize.rarity)),
    '装扮奖品只出现在史诗及以上',
  )
  assert(PET_OUTFITS.length > 0, '运行时宠物装扮目录非空')
  const outfitPayloadText = JSON.stringify(outfitPrizes)
  assert(
    !PET_OUTFITS.some((outfit) => outfitPayloadText.includes(outfit.key)),
    '装扮奖品不硬编码具体 outfit key（运行时读 PET_OUTFITS）',
  )
  for (const prize of outfitPrizes) {
    assertEqual(
      prize.payload?.fallbackPoints,
      outfitFallbackPoints(prize.rarity),
      `${prize.key} 的折算积分与稀有度一致`,
    )
  }
  assertEqual(outfitFallbackPoints('epic'), 100, '史诗装扮无宠物折算 100 积分')
  assertEqual(outfitFallbackPoints('legendary'), 200, '传说装扮无宠物折算 200 积分')
  assertEqual(
    OUTFIT_FALLBACK_POINTS,
    { epic: 100, legendary: 200 },
    '装扮折算常量与函数一致',
  )
}

/* ============================================================
   pickPrize：确定性 / 权重边界 / 保底池
   ============================================================ */

{
  assertEqual(pickPrize(() => 0).key, 'seed_common', 'rng=0 命中权重表第一项')
  assertEqual(pickPrize(() => 0.999999).key, 'outfit_legendary', 'rng→1 命中权重表最后一项')

  assertEqual(
    pickPrize(() => 0.7799).key,
    'points_common_30',
    '0.7799 仍落在普通最后一项',
  )
  assertEqual(
    pickPrize(() => 0.78).key,
    'seed_rare',
    '0.78 是普通 / 稀有边界，落在稀有第一项',
  )
  assertEqual(
    pickPrize(() => 0.96).key,
    'seed_epic',
    '0.96 是稀有 / 史诗边界，落在史诗第一项',
  )
  assertEqual(
    pickPrize(() => 0.995).key,
    'seed_legendary',
    '0.995 是史诗 / 传说边界，落在传说第一项',
  )

  assertEqual(
    pickPrize(() => 0, { minRarity: 'epic' }).key,
    'seed_epic',
    '保底池从史诗第一项开始',
  )

  const rng = seededRng(20261102)
  for (let index = 0; index < 200; index += 1) {
    const prize = pickPrize(rng, { minRarity: 'epic' })
    assert(isEpicOrBetter(prize.rarity), `第 ${index + 1} 次保底抽取为史诗及以上`)
  }

  // 大样本分布：各稀有度比例与权重的偏差 < 1.5 个百分点
  const distributionRng = seededRng(42)
  const rounds = 120_000
  const counts: Record<LotteryRarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
  for (let index = 0; index < rounds; index += 1) {
    counts[pickPrize(distributionRng).rarity] += 1
  }
  assertEqual(
    counts.common + counts.rare + counts.epic + counts.legendary,
    rounds,
    '分布统计总数为 120000',
  )
  for (const rarity of ALL_RARITIES) {
    const actualPct = (counts[rarity] / rounds) * 100
    const expectedPct = LOTTERY_WEIGHTS_BY_RARITY[rarity]
    assert(
      Math.abs(actualPct - expectedPct) < 1.5,
      `${rarity} 大样本概率 ${actualPct.toFixed(2)}% 接近权重 ${expectedPct}%`,
    )
  }
}

/* ============================================================
   保底
   ============================================================ */

{
  assertEqual(PITY_LIMIT, 30, '保底上限 = 30 抽')
  assertEqual(resolvePity(0, 'common'), 'common', 'pity=0 的普通结果不被保底')
  assertEqual(resolvePity(28, 'common'), 'common', 'pity=28 的普通结果不被保底')
  assertEqual(resolvePity(29, 'common'), 'epic', 'pity=29 的普通结果强制提升为史诗')
  assertEqual(resolvePity(29, 'rare'), 'epic', 'pity=29 的稀有结果强制提升为史诗')
  assertEqual(resolvePity(29, 'epic'), 'epic', 'pity=29 的史诗结果保持史诗')
  assertEqual(resolvePity(29, 'legendary'), 'legendary', 'pity=29 的传说结果保持传说')

  assert(shouldTriggerPity(29), 'pity=29 触发保底')
  assert(!shouldTriggerPity(28), 'pity=28 不触发保底')

  assertEqual(nextPityAfterDraw(0, { rarity: 'common' }), 1, '普通抽后 pity 0→1')
  assertEqual(nextPityAfterDraw(28, { rarity: 'common' }), 29, '普通抽后 pity 28→29')
  assertEqual(nextPityAfterDraw(0, { rarity: 'rare' }), 1, '稀有抽不清空保底')
  assertEqual(nextPityAfterDraw(29, { rarity: 'epic' }), 0, '史诗抽后 pity 归零')
  assertEqual(nextPityAfterDraw(29, { rarity: 'legendary' }), 0, '传说抽后 pity 归零')
}

/** 模拟 service 的逐抽结算（rng 固定可复现） */
function simulateDraws(
  count: number,
  startPity: number,
  rng: () => number,
): { rarities: LotteryRarity[]; pity: number } {
  let pity = startPity
  const rarities: LotteryRarity[] = []
  for (let index = 0; index < count; index += 1) {
    const prize = shouldTriggerPity(pity)
      ? pickPrize(rng, { minRarity: 'epic' })
      : pickPrize(rng)
    rarities.push(prize.rarity)
    pity = nextPityAfterDraw(pity, prize)
  }
  return { rarities, pity }
}

{
  const thirty = simulateDraws(30, 0, () => 0)
  assertEqual(thirty.rarities.slice(0, 29), Array(29).fill('common'), '前 29 抽为普通')
  assertEqual(thirty.rarities[29], 'epic', '第 30 抽强制史诗')
  assertEqual(thirty.pity, 0, '保底命中后 pity 归零')

  const cross = simulateDraws(2, 28, () => 0)
  assertEqual(cross.rarities, ['common', 'epic'], '保底跨抽累计：第 29 抽普通后下一抽保底')
  assertEqual(cross.pity, 0, '跨抽保底命中后归零')

  const after = simulateDraws(3, 28, () => 0)
  assertEqual(after.rarities, ['common', 'epic', 'common'], '保底后重新累计')
  assertEqual(after.pity, 1, '保底后普通抽 pity=1')
}

/* ============================================================
   入参清洗 / 成本
   ============================================================ */

{
  assertEqual(sanitizeDrawCount(1), 1, 'sanitizeDrawCount 放行 1')
  assertEqual(sanitizeDrawCount(10), 10, 'sanitizeDrawCount 放行 10')

  const badValues: unknown[] = [0, 2, 9, 11, -1, 1.5, NaN, Infinity, null, undefined, '1', '10', {}, []]
  for (const value of badValues) {
    assertEqual(sanitizeDrawCount(value), null, `sanitizeDrawCount 拒绝 ${String(value)}`)
  }

  assertEqual(lotteryCost(1), 60, '单抽 60 积分')
  assertEqual(lotteryCost(10), 540, '十连 540 积分')
  assertEqual(TEN_DRAW_COUNT, 10, '十连包含 10 抽')
  assertEqual(LOTTERY_COSTS.single * TEN_DRAW_COUNT, 600, '10 次单抽原价 600')
  assertEqual(
    LOTTERY_COSTS.single * TEN_DRAW_COUNT - LOTTERY_COSTS.ten,
    60,
    '十连省 60 积分（9 折）',
  )
  assert(LOTTERY_COSTS.ten < LOTTERY_COSTS.single * TEN_DRAW_COUNT, '十连价格低于原价')
}

/* ============================================================
   完整期望值（含种子满收 / 肥料 / 装扮折算 / 保底）
   ============================================================ */

{
  const tenPerDrawCost = LOTTERY_COSTS.ten / TEN_DRAW_COUNT

  function prizeValue(prize: LotteryPrize, amount: number): number {
    if (prize.type === 'points') return amount
    if (prize.type === 'fertilizer') return amount * FERTILIZER_COST
    if (prize.type === 'seed') return amount * expectedSeedHarvest(prize)
    if (prize.type === 'outfit') return Number(prize.payload?.fallbackPoints ?? 0)
    return 0
  }

  // 解析期望（不含保底），用于展示与断言
  const analyticEv = LOTTERY_PRIZES.reduce((sum, prize) => {
    const avgAmount = prize.amountMin !== undefined && prize.amountMax !== undefined
      ? (prize.amountMin + prize.amountMax) / 2
      : prize.amount
    return sum + (prize.weight / LOTTERY_TOTAL_WEIGHT) * prizeValue(prize, avgAmount)
  }, 0)

  // 模拟 20 万抽（含保底），得到实际平均回收
  const rounds = 200_000
  const rng = seededRng(20261102)
  let pity = 0
  let total = 0
  for (let index = 0; index < rounds; index += 1) {
    const prize = shouldTriggerPity(pity)
      ? pickPrize(rng, { minRarity: 'epic' })
      : pickPrize(rng)
    const amount = rollPrizeAmount(prize, rng)
    total += prizeValue(prize, amount)
    pity = nextPityAfterDraw(pity, prize)
  }
  const simulatedEv = total / rounds
  console.log(`  解析期望（不含保底）：${analyticEv.toFixed(2)} 分/抽`)
  console.log(`  模拟期望（含保底）：${simulatedEv.toFixed(2)} 分/抽（十连每抽成本 ${tenPerDrawCost}）`)

  assert(
    analyticEv < tenPerDrawCost * 1.05,
    `解析完整 EV ${analyticEv.toFixed(2)} 低于十连每抽成本 ${tenPerDrawCost}（含 5% 容差）`,
  )
  assert(
    simulatedEv < tenPerDrawCost,
    `模拟完整 EV ${simulatedEv.toFixed(2)} 低于十连每抽成本 ${tenPerDrawCost}`,
  )
  assert(
    simulatedEv > tenPerDrawCost * 0.75,
    `模拟完整 EV ${simulatedEv.toFixed(2)} 没有低到劝退（> ${(tenPerDrawCost * 0.75).toFixed(2)}）`,
  )

  const purePointsEv = LOTTERY_PRIZES
    .filter((prize) => prize.type === 'points')
    .reduce((sum, prize) => sum + (prize.weight / LOTTERY_TOTAL_WEIGHT) * prize.amount, 0)
  assert(
    purePointsEv < tenPerDrawCost,
    `纯积分期望 ${purePointsEv.toFixed(2)} 低于十连每抽成本 ${tenPerDrawCost}`,
  )
}

/* ============================================================
   奖池摘要 / 概率
   ============================================================ */

{
  assertEqual(LOTTERY_PRIZE_LIST.length, 4, '奖池按 4 个稀有度分组')
  assertEqual(
    LOTTERY_PRIZE_LIST.map((group) => group.rarity),
    ['common', 'rare', 'epic', 'legendary'],
    '奖池分组顺序与稀有度一致',
  )
  assertEqual(
    LOTTERY_PRIZE_LIST.map((group) => group.chancePct),
    [78, 18, 3.5, 0.5],
    '奖池概率与权重一致（78 / 18 / 3.5 / 0.5）',
  )
  assertEqual(
    LOTTERY_PRIZE_LIST.reduce((sum, group) => sum + group.chancePct, 0),
    100,
    '奖池概率之和 = 100%',
  )

  for (const group of LOTTERY_PRIZE_LIST) {
    const expectedItems = LOTTERY_PRIZES.filter((prize) => prize.rarity === group.rarity)
    assertEqual(group.items.length, expectedItems.length, `${group.rarity} 分组奖品数量一致`)
    assert(group.items.every((item) => item.name && item.amountText && item.description), `${group.rarity} 分组展示字段完整`)
  }

  const totalItems = LOTTERY_PRIZE_LIST.reduce((sum, group) => sum + group.items.length, 0)
  assertEqual(totalItems, LOTTERY_PRIZES.length, '奖池摘要覆盖全部奖品')
}

/* ============================================================
   数量随机区间
   ============================================================ */

{
  const fixed = LOTTERY_PRIZES.find((prize) => prize.key === 'points_common_20')
  assert(!!fixed, '存在固定数量奖品')
  if (fixed) {
    assertEqual(rollPrizeAmount(fixed, () => 0), 20, '固定数量在下界 rng 下仍为 20')
    assertEqual(rollPrizeAmount(fixed, () => 0.999999), 20, '固定数量在上界 rng 下仍为 20')
  }

  const rareSeed = LOTTERY_PRIZES.find((prize) => prize.key === 'seed_rare')
  assert(!!rareSeed, '存在随机数量奖品')
  if (rareSeed) {
    assertEqual(rollPrizeAmount(rareSeed, () => 0), 1, '稀有种子下界 = 1')
    assertEqual(rollPrizeAmount(rareSeed, () => 0.5), 2, '稀有种子中段 = 2')
    assertEqual(rollPrizeAmount(rareSeed, () => 0.999999), 2, '稀有种子上界 = 2')
  }

  const legendarySeed = LOTTERY_PRIZES.find((prize) => prize.key === 'seed_legendary')
  assert(!!legendarySeed, '存在传说种子')
  if (legendarySeed) {
    assertEqual(rollPrizeAmount(legendarySeed, () => 0), 1, '传说种子下界 = 1')
    assertEqual(rollPrizeAmount(legendarySeed, () => 0.999999), 1, '传说种子上界 = 1')
  }

  for (const prize of LOTTERY_PRIZES) {
    const amount = rollPrizeAmount(prize, () => 0.37)
    assert(Number.isInteger(amount) && amount > 0, `${prize.key} 掷出的数量为正整数`)
  }
}

/* ============================================================
   稀有度判定
   ============================================================ */

{
  assert(isRareOrBetter('rare'), '稀有及以上：rare')
  assert(isRareOrBetter('epic'), '稀有及以上：epic')
  assert(isRareOrBetter('legendary'), '稀有及以上：legendary')
  assert(!isRareOrBetter('common'), '稀有及以上：common 不算')
  assert(isEpicOrBetter('epic'), '史诗及以上：epic')
  assert(isEpicOrBetter('legendary'), '史诗及以上：legendary')
  assert(!isEpicOrBetter('rare'), '史诗及以上：rare 不算')
  assert(!isEpicOrBetter('common'), '史诗及以上：common 不算')
}

console.log(`\n积分抽奖自检通过：${passed} 项断言`)
