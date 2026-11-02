/**
 * 开心农场静态配置与纯函数（服务端唯一真相源，客户端通过 /api/farm 获取目录）。
 *
 * 经济模型：
 *   - 种子花积分，成熟后按「可收获单位 × 单位价值」收获积分
 *   - 被偷走 1 单位，地主少 1 单位；小偷按比例获得积分
 *   - 每块地每茬最多被同一人偷 1 次，且至少保留 1 单位给地主
 *   - 偷菜按概率成功（管理员可调），失败不消耗次数、不写偷菜记录
 * 数值刻意保持「种子成本 < 满收收益」，让玩家有正反馈但必须等待生长。
 */

export interface CropDef {
  key: string
  name: string
  emoji: string
  /** 种子价格（积分） */
  seedCost: number
  /** 生长时长（分钟，展示用） */
  growMinutes: number
  growMs: number
  /** 成熟时可收获单位数 */
  yieldUnits: number
  /** 每单位价值（积分） */
  value: number
  tier: number
  description: string
}

export const FARM_CROPS: readonly CropDef[] = [
  { key: 'carrot', name: '胡萝卜', emoji: '🥕', seedCost: 10, growMinutes: 3, growMs: 3 * 60_000, yieldUnits: 2, value: 14, tier: 1, description: '新手首选，3 分钟就能收，回本快。' },
  { key: 'cabbage', name: '白菜', emoji: '🥬', seedCost: 16, growMinutes: 6, growMs: 6 * 60_000, yieldUnits: 2, value: 20, tier: 1, description: '长得快、成本低，适合练手和补空档。' },
  { key: 'strawberry', name: '草莓', emoji: '🍓', seedCost: 18, growMinutes: 8, growMs: 8 * 60_000, yieldUnits: 2, value: 24, tier: 1, description: '甜度满分，适合睡前种一垄。' },
  { key: 'rice', name: '水稻', emoji: '🌾', seedCost: 22, growMinutes: 12, growMs: 12 * 60_000, yieldUnits: 2, value: 26, tier: 1, description: '一垄水田，收的是踏实。' },
  { key: 'sunflower', name: '向日葵', emoji: '🌻', seedCost: 28, growMinutes: 15, growMs: 15 * 60_000, yieldUnits: 3, value: 22, tier: 1, description: '向着太阳生长，收成稳稳的。' },
  { key: 'potato', name: '土豆', emoji: '🥔', seedCost: 26, growMinutes: 20, growMs: 20 * 60_000, yieldUnits: 3, value: 22, tier: 1, description: '土里土气，却是最可靠的口粮。' },
  { key: 'corn', name: '玉米', emoji: '🌽', seedCost: 40, growMinutes: 30, growMs: 30 * 60_000, yieldUnits: 3, value: 32, tier: 2, description: '产量扎实，农场主的口粮。' },
  { key: 'tomato', name: '番茄', emoji: '🍅', seedCost: 55, growMinutes: 60, growMs: 60 * 60_000, yieldUnits: 3, value: 44, tier: 2, description: '红透的时候最好看，也最容易被偷。' },
  { key: 'kiwi', name: '猕猴桃', emoji: '🥝', seedCost: 65, growMinutes: 75, growMs: 75 * 60_000, yieldUnits: 3, value: 56, tier: 2, description: '毛茸茸的外表，切开是亮晶晶的收益。' },
  { key: 'chili', name: '辣椒', emoji: '🌶️', seedCost: 90, growMinutes: 180, growMs: 180 * 60_000, yieldUnits: 4, value: 60, tier: 2, description: '又辣又赚，偷菜贼要小心。' },
  { key: 'watermelon', name: '西瓜', emoji: '🍉', seedCost: 80, growMinutes: 120, growMs: 120 * 60_000, yieldUnits: 4, value: 52, tier: 3, description: '夏日限定，单位价值高。' },
  { key: 'blueberry', name: '蓝莓', emoji: '🫐', seedCost: 95, growMinutes: 100, growMs: 100 * 60_000, yieldUnits: 4, value: 60, tier: 3, description: '一小颗一小颗，攒起来就是一笔好收成。' },
  { key: 'pumpkin', name: '南瓜', emoji: '🎃', seedCost: 120, growMinutes: 240, growMs: 240 * 60_000, yieldUnits: 4, value: 80, tier: 3, description: '慢慢长大，回报丰厚。' },
  { key: 'pineapple', name: '菠萝', emoji: '🍍', seedCost: 160, growMinutes: 300, growMs: 300 * 60_000, yieldUnits: 5, value: 84, tier: 3, description: '热带来的客人，需要一点耐心。' },
  { key: 'grape', name: '葡萄', emoji: '🍇', seedCost: 180, growMinutes: 360, growMs: 360 * 60_000, yieldUnits: 5, value: 92, tier: 4, description: '一串串挂满藤架，值得守夜。' },
  { key: 'cherry', name: '樱桃', emoji: '🍒', seedCost: 220, growMinutes: 420, growMs: 420 * 60_000, yieldUnits: 5, value: 116, tier: 4, description: '娇贵又值钱，成熟时像挂了一树红宝石。' },
  { key: 'starfruit', name: '星之果', emoji: '🌟', seedCost: 300, growMinutes: 480, growMs: 480 * 60_000, yieldUnits: 5, value: 160, tier: 4, description: '传说中的作物，成熟时会发光。' },
  { key: 'goldenapple', name: '金苹果', emoji: '🍎', seedCost: 650, growMinutes: 720, growMs: 720 * 60_000, yieldUnits: 6, value: 280, tier: 5, description: '农场里的终极作物：种下去就要等半天，收获时全服都会眼红。' },
]

export const CROP_MAP: ReadonlyMap<string, CropDef> = new Map(
  FARM_CROPS.map((crop) => [crop.key, crop]),
)

export function getCrop(key: string | null | undefined): CropDef | null {
  if (!key) return null
  return CROP_MAP.get(key) ?? null
}

/** 农田可扩建档位（初始 6 块，最大 30 块） */
export const INITIAL_PLOT_COUNT = 6
export const MAX_PLOT_COUNT = 30
export const PLOT_EXPANSION_COSTS: Readonly<Record<number, number>> = {
  9: 500,
  12: 1500,
  15: 3000,
  18: 6000,
  21: 10_000,
  24: 16_000,
  27: 24_000,
  30: 36_000,
}

/** 下一次扩建（已到上限返回 null） */
export function nextExpansion(currentPlotCount: number): { plotCount: number; cost: number } | null {
  const targets = Object.keys(PLOT_EXPANSION_COSTS).map(Number).sort((a, b) => a - b)
  const target = targets.find((count) => count > currentPlotCount)
  if (!target) return null
  return { plotCount: target, cost: PLOT_EXPANSION_COSTS[target] }
}

/** 肥料：单价、每茬最多使用次数、缩短剩余时间的比例、最短剩余时间 */
export const FERTILIZER_COST = 30
export const FERTILIZER_MAX_PER_CROP = 2
export const FERTILIZER_TIME_RATIO = 0.5
export const FERTILIZER_MIN_REMAINING_MS = 10_000

/** 新手礼包：种子与肥料 */
export const INITIAL_SEEDS: Readonly<Record<string, number>> = {
  carrot: 3,
  strawberry: 1,
}
export const INITIAL_FERTILIZER = 2

/** 生长进度 0–1 */
export function growthProgress(plantedAt: Date | null, readyAt: Date | null, now: number = Date.now()): number {
  if (!plantedAt || !readyAt) return 0
  const total = readyAt.getTime() - plantedAt.getTime()
  if (total <= 0) return 1
  return Math.min(1, Math.max(0, (now - plantedAt.getTime()) / total))
}

/** 施肥后的成熟时间：剩余时间减半，且至少保留 10 秒 */
export function fertilizeReadyAt(readyAt: Date, now: number = Date.now()): Date {
  const remaining = Math.max(0, readyAt.getTime() - now)
  const next = Math.max(FERTILIZER_MIN_REMAINING_MS, remaining * FERTILIZER_TIME_RATIO)
  return new Date(now + next)
}

/** 一键施肥的地块筛选：有作物、未到施肥上限、且尚未成熟 */
export function fertilizablePlotIndexes(
  plots: Array<{ index: number; crop: string | null; readyAt: Date | string | null; fertilized: number }>,
  now: number = Date.now(),
): number[] {
  return plots
    .filter((plot) => {
      if (!plot.crop || !plot.readyAt) return false
      if (plot.fertilized >= FERTILIZER_MAX_PER_CROP) return false
      return new Date(plot.readyAt).getTime() > now
    })
    .map((plot) => plot.index)
    .sort((a, b) => a - b)
}

/* ============================================================
   偷菜保护（花积分买一段免偷时间）
   ============================================================ */

export interface FarmProtectionPackage {
  hours: number
  cost: number
  label: string
}

/** 可购买的时长档位（越长越便宜，24h 档单小时最划算） */
export const FARM_PROTECTION_PACKAGES: readonly FarmProtectionPackage[] = [
  { hours: 1, cost: 30, label: '1 小时' },
  { hours: 3, cost: 75, label: '3 小时' },
  { hours: 6, cost: 120, label: '6 小时' },
  { hours: 12, cost: 200, label: '12 小时' },
  { hours: 24, cost: 320, label: '24 小时' },
]

/** 单次购买后保护剩余时间上限（可叠加，但不会超过 48 小时） */
export const FARM_PROTECTION_MAX_HOURS = 48

export function findProtectionPackage(hours: number): FarmProtectionPackage | null {
  return FARM_PROTECTION_PACKAGES.find((item) => item.hours === hours) ?? null
}

/**
 * 计算购买后的保护到期时间：
 *   - 从「当前生效保护」或现在（取较晚者）往后叠加
 *   - 总剩余不超过 FARM_PROTECTION_MAX_HOURS（超出部分不收费也不延长，调用方需先拦截）
 */
export function protectionUntilAfter(
  currentUntil: Date | null | undefined,
  hours: number,
  now: number = Date.now(),
): Date {
  const base = Math.max(now, currentUntil ? currentUntil.getTime() : now)
  return new Date(base + hours * 3_600_000)
}

/** 剩余保护时长（毫秒，未保护为 0） */
export function protectionRemainingMs(
  until: Date | null | undefined,
  now: number = Date.now(),
): number {
  if (!until) return 0
  return Math.max(0, until.getTime() - now)
}

/** 小偷获得的积分（至少 1 分） */
export function computeStealPoints(crop: CropDef, ratio: number): number {
  return Math.max(1, Math.floor(crop.value * ratio))
}

/** 一次收获/偷菜得到的作物单位价值总和 */
export function cropUnitsValue(crop: CropDef, units: number): number {
  return Math.max(0, units) * crop.value
}

/* ============================================================
   随机（rng 可注入，便于自检脚本得到确定性结果）
   ============================================================ */

/** 按权重随机取一项；全权重为 0 或空数组时返回 null */
export function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  rng: () => number = Math.random,
): T | null {
  const weights = items.map((item) => Math.max(0, weightOf(item)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!(total > 0)) return null
  let roll = rng() * total
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i]
    if (roll < 0) return items[i]
  }
  // 浮点误差兜底：返回最后一个有权重的项
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (weights[i] > 0) return items[i]
  }
  return null
}

/** 偷菜是否成功：rate ≤ 0 必失败，rate ≥ 1 必成功，否则按概率 */
export function rollStealSuccess(rate: number, rng: () => number = Math.random): boolean {
  const value = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0
  if (value <= 0) return false
  if (value >= 1) return true
  return rng() < value
}

/** 每日掉落种子的单作物权重：低阶常见、高阶稀罕 */
const SEED_DROP_TIER_WEIGHT: Readonly<Record<number, number>> = {
  1: 40,
  2: 24,
  3: 12,
  4: 6,
  5: 2,
}

export function seedDropWeight(crop: CropDef): number {
  return SEED_DROP_TIER_WEIGHT[crop.tier] ?? 1
}

/** 每日随机掉落的作物（按 tier 加权，rng 可注入） */
export function pickDailySeed(rng: () => number = Math.random): CropDef | null {
  return pickWeighted(FARM_CROPS, seedDropWeight, rng)
}

/* ============================================================
   随机商人
   ============================================================ */

export interface MerchantOfferDraft {
  itemKind: 'seed' | 'fertilizer'
  itemKey: string
  count: number
  price: number
  originalPrice: number
  discountPct: number
}

/** 商人每天最多上架多少件（与配置 merchantCount 上限一致） */
export const MERCHANT_MAX_OFFERS = 6
/** 商品里出现肥料的概率 */
export const MERCHANT_FERTILIZER_CHANCE = 0.25
/** 单件商品数量上限 */
const MERCHANT_PACK_MAX = 3

/**
 * 生成当日商人商品：种子与肥料混合，按折扣区间随机打折。
 *
 * 同一 `(kind, key)` 只会出现一次（与数据库唯一键一致），重复抽取会重试，
 * 因此结果可能少于 `count`（作物种类抽空时）。
 */
export function pickMerchantOffers(
  options: { count: number; minDiscount: number; maxDiscount: number },
  rng: () => number = Math.random,
): MerchantOfferDraft[] {
  const count = Math.max(0, Math.min(MERCHANT_MAX_OFFERS, Math.trunc(options.count) || 0))
  if (count === 0) return []
  const lower = Math.max(0.1, Math.min(options.minDiscount, options.maxDiscount))
  const upper = Math.min(0.9, Math.max(options.minDiscount, options.maxDiscount))

  const offers: MerchantOfferDraft[] = []
  const seen = new Set<string>()

  for (let slot = 0; slot < count; slot += 1) {
    let picked: MerchantOfferDraft | null = null
    for (let attempt = 0; attempt < 8 && !picked; attempt += 1) {
      let itemKind: 'seed' | 'fertilizer'
      let itemKey: string
      let unitCost: number
      if (rng() < MERCHANT_FERTILIZER_CHANCE) {
        itemKind = 'fertilizer'
        itemKey = 'fertilizer'
        unitCost = FERTILIZER_COST
      } else {
        const crop = pickDailySeed(rng)
        if (!crop) continue
        itemKind = 'seed'
        itemKey = crop.key
        unitCost = crop.seedCost
      }
      const key = `${itemKind}:${itemKey}`
      if (seen.has(key)) continue
      seen.add(key)

      const pack = 1 + Math.floor(rng() * MERCHANT_PACK_MAX)
      const originalPrice = unitCost * pack
      const rawPct = Math.round((lower + rng() * (upper - lower)) * 100)
      const discountPct = Math.max(10, Math.min(90, rawPct))
      picked = {
        itemKind,
        itemKey,
        count: pack,
        originalPrice,
        discountPct,
        price: Math.max(1, Math.floor((originalPrice * discountPct) / 100)),
      }
    }
    if (picked) offers.push(picked)
  }

  return offers
}

