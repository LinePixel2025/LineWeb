/**
 * 积分规则 / 农场规则纯函数自检（不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-points.ts
 *      （或 npm run verify:points）
 */

import { GAME_KEYS } from '../src/lib/gameStatsRules.js'
import {
  AVATAR_FRAME_STYLES,
  DEFAULT_CHECKIN_RULE,
  DEFAULT_FARM_RULE,
  DEFAULT_GAME_RULES,
  DEFAULT_POINTS_CONFIG,
  EMOJI_PACK_KEYS,
  applyDailyCap,
  applyDailyLossCap,
  checkinReward,
  computeGamePoints,
  getTodayDateKey,
  getTodayDayStart,
  getYesterdayDateKey,
  normalizePointsConfig,
  parseShopPayload,
  sanitizeAvatarFrame,
  sanitizeTitleColor,
  sanitizeTitleIcon,
} from '../src/lib/pointsRules.js'
import {
  CROP_MAP,
  FARM_CROPS,
  FERTILIZER_COST,
  FERTILIZER_MAX_PER_CROP,
  FERTILIZER_MIN_REMAINING_MS,
  INITIAL_FERTILIZER,
  INITIAL_PLOT_COUNT,
  INITIAL_SEEDS,
  MAX_PLOT_COUNT,
  PLOT_EXPANSION_COSTS,
  computeStealPoints,
  cropUnitsValue,
  fertilizeReadyAt,
  getCrop,
  growthProgress,
  nextExpansion,
  pickDailySeed,
  pickMerchantOffers,
  pickWeighted,
  rollStealSuccess,
  seedDropWeight,
} from '../src/lib/farmCrops.js'

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
   积分规则
   ============================================================ */

assertEqual(GAME_KEYS.length, 10, '10 款游戏共用一套积分')
for (const key of GAME_KEYS) {
  const rule = DEFAULT_GAME_RULES[key]
  assert(!!rule, `${key} 有默认规则`)
  assert(rule.win >= 0, `${key} 胜利不扣分`)
  assert(rule.loss <= 0, `${key} 失败不加分`)
  assert(rule.dailyCap >= 0, `${key} 每日上限非负`)
}

const rule2048 = DEFAULT_GAME_RULES['2048']
assertEqual(computeGamePoints('2048', rule2048, { outcome: 'win' }), 25, '2048 胜利 +25')
assertEqual(computeGamePoints('2048', rule2048, { outcome: 'loss' }), -6, '2048 失败 -6')
assertEqual(computeGamePoints('2048', rule2048, { outcome: 'draw' }), 0, '2048 平局 0')
assertEqual(computeGamePoints('2048', rule2048, { outcome: 'win', score: 5000 }), 30, '2048 表现加成封顶 20')

const snakeRule = DEFAULT_GAME_RULES.snake
assertEqual(computeGamePoints('snake', snakeRule, { score: 120 }), 24, '贪吃蛇参与 4 + 表现封顶 20')
assertEqual(computeGamePoints('snake', snakeRule, { score: 0 }), -2, '贪吃蛇 0 分按失败扣分')
assertEqual(computeGamePoints('snake', snakeRule, {}), -2, '贪吃蛇未上报分数按失败扣分')

const parkourRule = DEFAULT_GAME_RULES.parkour
assertEqual(computeGamePoints('parkour', parkourRule, { score: 5000 }), 36, '跑酷参与 6 + 表现封顶 30')

assertEqual(applyDailyCap(25, 0, 120), 25, '每日上限内全额发放')
assertEqual(applyDailyCap(25, 110, 120), 10, '每日上限截断正收益')
assertEqual(applyDailyCap(25, 120, 120), 0, '达到上限后不再加分')
assertEqual(applyDailyCap(-6, 120, 120), -6, '扣分不受每日上限影响')
assertEqual(applyDailyCap(25, 0, 0), 25, '上限 0 表示不限')

// 双向日限：输分上限按今日已扣绝对值截断，0 表示不限
assertEqual(applyDailyLossCap(-6, 0, 20), -6, '输分上限内全额扣除')
assertEqual(applyDailyLossCap(-6, 16, 20), -4, '输分上限截断扣分')
assertEqual(applyDailyLossCap(-6, 20, 20), 0, '达到输分上限后不再扣分')
assertEqual(applyDailyLossCap(-6, 25, 20), 0, '已超额时不再扣分')
assertEqual(applyDailyLossCap(-6, 0, 0), -6, '输分上限 0 表示不限')
assertEqual(applyDailyLossCap(25, 20, 20), 25, '正收益不受输分上限影响')
assertEqual(DEFAULT_GAME_RULES['2048'].dailyLossCap, 20, '2048 默认输分上限 20')
assertEqual(DEFAULT_GAME_RULES.doudizhu.dailyLossCap, 40, '斗地主默认输分上限 40')
assertEqual(DEFAULT_GAME_RULES.minesweeper.dailyLossCap, 30, '扫雷默认输分上限 30')
assert(
  GAME_KEYS.every((key) => DEFAULT_GAME_RULES[key].dailyLossCap >= 0),
  '所有游戏都有非负的输分上限',
)

// Asia/Shanghai 日界线：UTC 15:59 仍是当天，UTC 16:00 进入次日
assertEqual(getTodayDateKey(Date.parse('2026-10-28T15:59:59Z')), '2026-10-28', 'UTC 15:59 → 上海 23:59')
assertEqual(getTodayDateKey(Date.parse('2026-10-28T16:00:00Z')), '2026-10-29', 'UTC 16:00 → 上海次日 00:00')
assertEqual(
  getTodayDayStart(Date.parse('2026-10-29T03:00:00Z')).toISOString(),
  '2026-10-28T16:00:00.000Z',
  '上海 0 点 = UTC 前一日 16 点',
)

// 配置归一化：缺字段回退默认、越界夹紧
const normalized = normalizePointsConfig({
  games: { '2048': { win: 9999, loss: 500, draw: 'x', dailyCap: -5 } },
  farm: { stealRatio: 5, stealDailyLimit: -3, welcomePoints: 'abc' },
})
assertEqual(normalized.games['2048'].win, 1000, 'win 夹到上限 1000')
assertEqual(normalized.games['2048'].loss, 0, 'loss 夹到 0')
assertEqual(normalized.games['2048'].draw, 0, '非法 draw 回退默认值')
assertEqual(normalized.games['2048'].dailyCap, 0, 'dailyCap 夹到 0')
assertEqual(normalized.games.snake.win, DEFAULT_GAME_RULES.snake.win, '缺失游戏回退默认规则')
assertEqual(normalized.farm.stealRatio, 1, 'stealRatio 夹到 1')
assertEqual(normalized.farm.stealDailyLimit, 0, '负数 stealDailyLimit 夹到 0')
assertEqual(normalized.farm.welcomePoints, DEFAULT_FARM_RULE.welcomePoints, '非法 welcomePoints 回退默认')
assertEqual(normalized.farm.stealSuccessRate, DEFAULT_FARM_RULE.stealSuccessRate, '非法 stealSuccessRate 回退默认')
assertEqual(normalized.farm.victimDailyStealLimit, DEFAULT_FARM_RULE.victimDailyStealLimit, '缺失 victimDailyStealLimit 回退默认')
assertEqual(normalized.farm.seedDropMax, DEFAULT_FARM_RULE.seedDropMax, '缺失 seedDropMax 回退默认')
assertEqual(normalized.farm.merchantCount, DEFAULT_FARM_RULE.merchantCount, '缺失 merchantCount 回退默认')

// 0 是合法值，不能被默认值吞掉
const zeroed = normalizePointsConfig({
  games: { '2048': { dailyLossCap: 0 } },
  farm: { stealSuccessRate: 0, victimDailyStealLimit: 0, seedDropMax: 0, merchantCount: 0 },
  checkin: { basePoints: 0, streakStep: 0, streakMaxBonus: 0 },
})
assertEqual(zeroed.games['2048'].dailyLossCap, 0, 'dailyLossCap 0 表示不限，保留 0')
assertEqual(zeroed.farm.stealSuccessRate, 0, 'stealSuccessRate 0 保留（必失败）')
assertEqual(zeroed.farm.victimDailyStealLimit, 0, 'victimDailyStealLimit 0 保留（不可被偷）')
assertEqual(zeroed.farm.seedDropMax, 0, 'seedDropMax 0 保留（关闭掉落）')
assertEqual(zeroed.farm.merchantCount, 0, 'merchantCount 0 保留（无商人）')
assertEqual(zeroed.checkin, { basePoints: 0, streakStep: 0, streakMaxBonus: 0 }, '签到规则 0 全部保留')
assertEqual(normalized.checkin, DEFAULT_CHECKIN_RULE, '缺失 checkin 回退默认规则')
assertEqual(normalized.leaderTitle.rewardPoints, 50, '缺失 leaderTitle 回退默认奖励')

/* ============================================================
   每日签到
   ============================================================ */

assertEqual(
  getYesterdayDateKey(Date.parse('2026-10-29T03:00:00Z')),
  '2026-10-28',
  '上海 10-29 的昨日是 10-28',
)
assertEqual(
  getYesterdayDateKey(Date.parse('2026-10-28T16:30:00Z')),
  '2026-10-28',
  'UTC 16:30 = 上海 00:30，昨日仍是当天前一天',
)
assertEqual(checkinReward(1, DEFAULT_CHECKIN_RULE), 10, '首日签到 = 基础分')
assertEqual(checkinReward(2, DEFAULT_CHECKIN_RULE), 15, '连签第 2 天 +5')
assertEqual(checkinReward(5, DEFAULT_CHECKIN_RULE), 30, '连签第 5 天 +20')
assertEqual(checkinReward(21, DEFAULT_CHECKIN_RULE), 110, '连签加成封顶 100')
assertEqual(checkinReward(999, DEFAULT_CHECKIN_RULE), 110, '超长连签仍按封顶计算')
assertEqual(checkinReward(0, DEFAULT_CHECKIN_RULE), 10, '非法连签按第 1 天计算')
assertEqual(checkinReward(1.9, DEFAULT_CHECKIN_RULE), 10, '连签天数向下取整')
assertEqual(
  checkinReward(3, { basePoints: 10, streakStep: 5, streakMaxBonus: 0 }),
  10,
  'streakMaxBonus 0 表示没有连签加成',
)
assertEqual(
  checkinReward(4, { basePoints: 0, streakStep: 0, streakMaxBonus: 100 }),
  0,
  '全 0 签到规则不会发分',
)

const discountOrder = normalizePointsConfig({ farm: { merchantDiscountMin: 0.9, merchantDiscountMax: 0.5 } })
assert(discountOrder.farm.merchantDiscountMin <= discountOrder.farm.merchantDiscountMax, '商人折扣下限不大于上限')
assertEqual(Object.keys(normalizePointsConfig(null).games).length, GAME_KEYS.length, '空配置补全全部游戏')
assertEqual(normalizePointsConfig(DEFAULT_POINTS_CONFIG).games.uno.win, 22, '默认配置往返不变')

assertEqual(parseShopPayload('{"color":"#fff"}'), { color: '#fff' }, '合法 payload 解析')
assertEqual(parseShopPayload('not json'), {}, '坏 payload 回退空对象')
assertEqual(parseShopPayload(null), {}, '空 payload 回退空对象')

assertEqual(sanitizeTitleColor('#1a7f37'), '#1a7f37', '合法称号颜色保留')
assertEqual(sanitizeTitleColor('#abcdef'), '#abcdef', '六位颜色保留')
assertEqual(sanitizeTitleColor('red;background:url(x)'), '#57606a', '非法颜色回退默认')
assertEqual(sanitizeTitleIcon('🐣'), '🐣', '单个 emoji 称号图标保留')
assertEqual(sanitizeTitleIcon('🐣🐣🐣'), '🐣🐣', '图标最多两个字符')
assertEqual(sanitizeTitleIcon(123), '', '非字符串图标回退空')

assertEqual(AVATAR_FRAME_STYLES.length, 4, '头像框共 4 种样式')
assertEqual(sanitizeAvatarFrame('gold'), 'gold', 'gold 头像框合法')
assertEqual(sanitizeAvatarFrame('galaxy'), 'galaxy', 'galaxy 头像框合法')
assertEqual(sanitizeAvatarFrame('rainbow'), null, '未知头像框样式回退 null')
assertEqual(sanitizeAvatarFrame(''), null, '空头像框样式回退 null')
assertEqual(sanitizeAvatarFrame(123), null, '非字符串头像框回退 null')

assertEqual(EMOJI_PACK_KEYS, ['nailong', 'felyne', 'twemoji'], '付费表情包 key 与客户端商店一致')

/* ============================================================
   农场规则
   ============================================================ */

assertEqual(INITIAL_PLOT_COUNT, 6, '初始 6 块地')
assertEqual(MAX_PLOT_COUNT, 18, '最大 18 块地')
assertEqual(INITIAL_FERTILIZER, 2, '新手送 2 份肥料')
assertEqual(INITIAL_SEEDS.carrot, 3, '新手送 3 颗胡萝卜种子')
assertEqual(FERTILIZER_COST, 30, '肥料单价 30')
assertEqual(FERTILIZER_MAX_PER_CROP, 2, '每茬最多施肥 2 次')

assertEqual(nextExpansion(6), { plotCount: 9, cost: 500 }, '6 → 9 块')
assertEqual(nextExpansion(7), { plotCount: 9, cost: 500 }, '非档位数量也能找到下一档')
assertEqual(nextExpansion(15), { plotCount: 18, cost: 6000 }, '15 → 18 块')
assertEqual(nextExpansion(18), null, '已到上限无法扩建')
assertEqual(nextExpansion(20), null, '超过上限返回 null')
assertEqual(
  Object.keys(PLOT_EXPANSION_COSTS).map(Number).sort((a, b) => a - b),
  [9, 12, 15, 18],
  '扩建档位固定为 9 / 12 / 15 / 18',
)

const keySet = new Set<string>()
for (const crop of FARM_CROPS) {
  assert(!keySet.has(crop.key), `作物 key 唯一：${crop.key}`)
  keySet.add(crop.key)
  assert(CROP_MAP.get(crop.key) === crop, `CROP_MAP 可反查 ${crop.key}`)
  assert(crop.seedCost > 0 && crop.yieldUnits > 0 && crop.value > 0, `${crop.key} 数值为正`)
  assert(crop.growMs === crop.growMinutes * 60_000, `${crop.key} growMs 与分钟一致`)
  assert(crop.yieldUnits * crop.value > crop.seedCost, `${crop.key} 满收收益高于种子成本`)
  assert(crop.description.length > 0, `${crop.key} 有描述`)
}
assertEqual(getCrop('not-exist'), null, '未知作物返回 null')
assertEqual(getCrop(null), null, '空 key 返回 null')

// 施肥：剩余时间减半，但至少保留 10 秒
const now = Date.parse('2026-10-29T12:00:00Z')
assertEqual(
  fertilizeReadyAt(new Date(now + 10 * 60_000), now).getTime() - now,
  5 * 60_000,
  '施肥把剩余 10 分钟减半',
)
assertEqual(
  fertilizeReadyAt(new Date(now + 8_000), now).getTime() - now,
  FERTILIZER_MIN_REMAINING_MS,
  '施肥后至少保留 10 秒',
)
assertEqual(
  fertilizeReadyAt(new Date(now - 1_000), now).getTime() - now,
  FERTILIZER_MIN_REMAINING_MS,
  '已过成熟时间也按最短 10 秒处理',
)

// 生长进度
const plantedAt = new Date(now)
const readyAt = new Date(now + 100_000)
assertEqual(growthProgress(plantedAt, readyAt, now), 0, '刚播种进度 0')
assertEqual(growthProgress(plantedAt, readyAt, now + 50_000), 0.5, '一半时间进度 0.5')
assertEqual(growthProgress(plantedAt, readyAt, now + 200_000), 1, '超过成熟时间进度封顶 1')
assertEqual(growthProgress(null, readyAt, now), 0, '未种植进度 0')

// 偷菜与收获（收益翻倍后：胡萝卜 14，星之果 160）
const carrot = getCrop('carrot')!
const starfruit = getCrop('starfruit')!
assertEqual(carrot.value, 14, '胡萝卜单位价值已翻倍为 14')
assertEqual(starfruit.value, 160, '星之果单位价值已翻倍为 160')
assertEqual(FARM_CROPS.every((crop) => crop.value % 2 === 0), true, '翻倍后所有作物单位价值为偶数')
assertEqual(computeStealPoints(carrot, DEFAULT_FARM_RULE.stealRatio), 8, '偷胡萝卜得 floor(14×0.6) = 8')
assertEqual(computeStealPoints(starfruit, DEFAULT_FARM_RULE.stealRatio), 96, '偷星之果得 floor(160×0.6) = 96')
assertEqual(computeStealPoints(carrot, 0), 1, '偷菜收益至少 1 分')
assertEqual(computeStealPoints(carrot, 1), 14, '比例 1 时按单位价值')
assertEqual(cropUnitsValue(carrot, 2), 28, '胡萝卜 2 单位 = 28 分')
assertEqual(cropUnitsValue(starfruit, 5), 800, '星之果 5 单位 = 800 分')
assertEqual(cropUnitsValue(carrot, -1), 0, '负数单位按 0 处理')

// 偷菜概率：0 必失败、1 必成功，中间按 rng 判定
assertEqual(rollStealSuccess(0, () => 0), false, '概率 0 必失败')
assertEqual(rollStealSuccess(0, () => 0.999), false, '概率 0 即使 rng 接近 1 也失败')
assertEqual(rollStealSuccess(1, () => 0.999), true, '概率 1 必成功')
assertEqual(rollStealSuccess(0.65, () => 0.64), true, 'rng 小于概率时成功')
assertEqual(rollStealSuccess(0.65, () => 0.65), false, 'rng 等于概率时失败（严格小于）')
assertEqual(rollStealSuccess(0.65, () => 0.99), false, 'rng 大于概率时失败')
assertEqual(rollStealSuccess(Number.NaN, () => 0), false, '非法概率按 0 处理')
assertEqual(rollStealSuccess(0.3, () => -1), true, '概率落在边界外也能正常判定')

// 权重随机（注入 rng 保证确定性）
assertEqual(pickWeighted([], () => 1, () => 0), null, '空列表返回 null')
assertEqual(pickWeighted(['a', 'b'], () => 0, () => 0), null, '全零权重返回 null')
assertEqual(pickWeighted(['a', 'b'], (item) => (item === 'a' ? 1 : 3), () => 0), 'a', '权重 1/4 时取第一项')
assertEqual(pickWeighted(['a', 'b'], (item) => (item === 'a' ? 1 : 3), () => 0.3), 'b', '权重 1/4 时 rng 0.3 落到第二项')
assertEqual(pickWeighted(['a', 'b'], (item) => (item === 'a' ? 1 : 3), () => 0.999), 'b', 'rng 接近 1 时取最后一项')
assertEqual(pickWeighted(['a', 'b'], (item) => (item === 'a' ? 1 : 0), () => 0.999), 'a', '末项权重为 0 时回退到有权限的项')

// 每日掉落种子：按 tier 加权，低阶更常见、金苹果最稀罕
assertEqual(pickDailySeed(() => 0)?.key, 'carrot', 'rng 0 时掉落最低阶作物')
assertEqual(pickDailySeed(() => 0.999999)?.key, 'goldenapple', 'rng 接近 1 时掉落金苹果')
assert(seedDropWeight(carrot) > seedDropWeight(getCrop('goldenapple')!), '低阶作物掉落权重高于金苹果')
for (const crop of FARM_CROPS) {
  assert(seedDropWeight(crop) > 0, `${crop.key} 掉落权重为正`)
}

// 随机商人：数量 / 唯一性 / 折扣区间 / 价格公式
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const merchantOptions = { count: 6, minDiscount: 0.4, maxDiscount: 0.7 }
const merchantOffers = pickMerchantOffers(merchantOptions, makeLcg(42))
assert(merchantOffers.length > 0 && merchantOffers.length <= 6, '商人商品数量在 1..6 之间')
const merchantKeys = new Set<string>()
for (const offer of merchantOffers) {
  const key = `${offer.itemKind}:${offer.itemKey}`
  assert(!merchantKeys.has(key), `商人商品不重复：${key}`)
  merchantKeys.add(key)
  assert(offer.count >= 1 && offer.count <= 3, `商人商品数量 1..3：${key}`)
  assert(offer.discountPct >= 40 && offer.discountPct <= 70, `折扣落在 40%–70%：${key}`)
  assert(offer.price >= 1 && offer.price <= offer.originalPrice, `折后价在 1..原价：${key}`)
  assertEqual(
    offer.price,
    Math.max(1, Math.floor((offer.originalPrice * offer.discountPct) / 100)),
    `折后价按折扣计算：${key}`,
  )
  if (offer.itemKind === 'seed') {
    const crop = getCrop(offer.itemKey)
    assert(!!crop, `商人种子 key 合法：${offer.itemKey}`)
    assertEqual(offer.originalPrice, (crop?.seedCost ?? 0) * offer.count, `种子原价 = 单价 × 数量：${key}`)
  } else {
    assertEqual(offer.itemKey, 'fertilizer', '商人肥料 key 固定')
    assertEqual(offer.originalPrice, FERTILIZER_COST * offer.count, '肥料原价 = 单价 × 数量')
  }
}
assertEqual(
  pickMerchantOffers({ count: 0, minDiscount: 0.4, maxDiscount: 0.7 }, () => 0).length,
  0,
  '商人数量 0 时不上架',
)
assertEqual(
  JSON.stringify(pickMerchantOffers(merchantOptions, makeLcg(7))),
  JSON.stringify(pickMerchantOffers(merchantOptions, makeLcg(7))),
  '同一随机种子生成相同商品',
)
const swappedDiscount = pickMerchantOffers({ count: 4, minDiscount: 0.7, maxDiscount: 0.4 }, makeLcg(9))
assert(
  swappedDiscount.every((offer) => offer.discountPct >= 40 && offer.discountPct <= 70),
  '折扣上下限颠倒时仍落在区间内',
)

console.log(`✅ 积分与农场规则自检通过：${passed} 个断言`)
