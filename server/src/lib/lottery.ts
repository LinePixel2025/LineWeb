/**
 * 积分抽奖静态目录与纯函数（服务端唯一真相源，客户端通过 `/api/lottery` 获取奖池摘要）。
 *
 * 2026-11 调息口径：
 *   - 稀有度总权重：普通 78% / 稀有 18% / 史诗 3.5% / 传说 0.5%（原 62/25/10/3）
 *   - 种子与装扮折算大幅下调；保底从 10 抽提高到 30 抽
 *   - 目标：全奖池期望（种子按满收价值、肥料按 30/个、装扮按折算分）≈ 51 分/抽，
 *     低于十连每抽 54 分；自检脚本会显式断言「完整 EV < 十连成本」。
 *   - 奖品用「模板」描述，具体作物与装扮由 service 层按真实目录解析；
 *     本文件不 import farmCrops / petCatalog，保持纯函数、可被自检脚本直接引用。
 *   - 随机数函数一律可注入，自检脚本用固定 rng 复现边界结果。
 */

export type LotteryRarity = 'common' | 'rare' | 'epic' | 'legendary'

export type LotteryPrizeType = 'points' | 'seed' | 'fertilizer' | 'outfit'

export interface LotteryPrize {
  /** 稳定 key（写入 LotteryDraw.prizeKey，永久不可变） */
  key: string
  type: LotteryPrizeType
  name: string
  rarity: LotteryRarity
  /** 相对权重（总和 100） */
  weight: number
  /** 基础数量；固定奖励即实际数量 */
  amount: number
  /** 随机数量区间（含两端），缺省时等于 amount */
  amountMin?: number
  amountMax?: number
  /** 结构化线索：种子按 tier 区间解析，装扮按运行时目录解析 */
  payload?: Record<string, unknown>
}

/** 单抽 / 十连价格（十连 9 折，省 60 积分） */
export const LOTTERY_COSTS = {
  single: 60,
  ten: 540,
} as const

export const TEN_DRAW_COUNT = 10

/** 连续多少抽未出史诗及以上触发保底（第 30 抽） */
export const PITY_LIMIT = 30

/** 装扮无宠物 / 已集齐时的积分折算（与稀有度绑定，避免把数值散落在 service 里） */
export const OUTFIT_FALLBACK_POINTS = {
  epic: 100,
  legendary: 200,
} as const

export const RARITY_ORDER: readonly LotteryRarity[] = ['common', 'rare', 'epic', 'legendary']

const RARITY_RANK: Readonly<Record<LotteryRarity, number>> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
}

/* ============================================================
   奖品目录
   ============================================================ */

/**
 * 完整权重表：每个稀有度内部权重之和即该稀有度的概率。
 *
 * 2026-11 调息后：
 *   普通 78%（种子 8 / 肥料 10 / 积分 10·20·30 共 60）
 *   稀有 18%（种子 1.5 / 肥料 2 / 积分 50·100·150 共 14.5）
 *   史诗 3.5%（种子 0.35 / 积分 200·300 共 1.65 / 宠物装扮 1.5）
 *   传说 0.5%（传说种子 0.08 / 积分 500 0.17 / 积分 1000 0.1 / 传说装扮 0.15）
 *
 * 种子数量与权重都大幅下调（原普通 28 / 稀有 10 / 史诗 4 / 传说 1.5），
 * 因为种子按满收价值折算后的期望远高于积分；只降积分权重无法把总 EV 压到成本以下。
 */
export const LOTTERY_PRIZES: readonly LotteryPrize[] = [
  // ---------- 普通 ----------
  {
    key: 'seed_common',
    type: 'seed',
    name: '普通种子',
    rarity: 'common',
    weight: 8,
    amount: 1,
    payload: { tierMin: 1, tierMax: 2 },
  },
  {
    key: 'fertilizer_common',
    type: 'fertilizer',
    name: '肥料',
    rarity: 'common',
    weight: 10,
    amount: 1,
  },
  { key: 'points_common_10', type: 'points', name: '积分', rarity: 'common', weight: 34, amount: 10 },
  { key: 'points_common_20', type: 'points', name: '积分', rarity: 'common', weight: 18, amount: 20 },
  { key: 'points_common_30', type: 'points', name: '积分', rarity: 'common', weight: 8, amount: 30 },

  // ---------- 稀有 ----------
  {
    key: 'seed_rare',
    type: 'seed',
    name: '稀有种子',
    rarity: 'rare',
    weight: 1.5,
    amount: 1,
    amountMin: 1,
    amountMax: 2,
    payload: { tierMin: 2, tierMax: 3 },
  },
  {
    key: 'fertilizer_rare',
    type: 'fertilizer',
    name: '肥料',
    rarity: 'rare',
    weight: 2,
    amount: 3,
  },
  { key: 'points_rare_50', type: 'points', name: '积分', rarity: 'rare', weight: 8.5, amount: 50 },
  { key: 'points_rare_100', type: 'points', name: '积分', rarity: 'rare', weight: 5, amount: 100 },
  { key: 'points_rare_150', type: 'points', name: '积分', rarity: 'rare', weight: 1, amount: 150 },

  // ---------- 史诗 ----------
  {
    key: 'seed_epic',
    type: 'seed',
    name: '史诗种子',
    rarity: 'epic',
    weight: 0.35,
    amount: 1,
    amountMin: 1,
    amountMax: 1,
    payload: { tierMin: 4, tierMax: 4 },
  },
  { key: 'points_epic_200', type: 'points', name: '积分', rarity: 'epic', weight: 1.15, amount: 200 },
  { key: 'points_epic_300', type: 'points', name: '积分', rarity: 'epic', weight: 0.5, amount: 300 },
  {
    key: 'outfit_epic',
    type: 'outfit',
    name: '宠物装扮',
    rarity: 'epic',
    weight: 1.5,
    amount: 1,
    payload: { fallbackPoints: OUTFIT_FALLBACK_POINTS.epic },
  },

  // ---------- 传说 ----------
  {
    key: 'seed_legendary',
    type: 'seed',
    name: '传说种子',
    rarity: 'legendary',
    weight: 0.08,
    amount: 1,
    amountMin: 1,
    amountMax: 1,
    // 星之果在农场目录里是 tier 4，金苹果是 tier 5；用「tier 4–5 且价值 ≥160」表达顶级种子，
    // 这样目录调整 tier 时奖池会跟着运行时数据走，不在抽奖侧硬编码作物 key。
    payload: { tierMin: 4, tierMax: 5, minValue: 160 },
  },
  { key: 'points_legendary_500', type: 'points', name: '积分', rarity: 'legendary', weight: 0.17, amount: 500 },
  { key: 'points_legendary_1000', type: 'points', name: '积分', rarity: 'legendary', weight: 0.1, amount: 1000 },
  {
    key: 'outfit_legendary',
    type: 'outfit',
    name: '传说宠物装扮',
    rarity: 'legendary',
    weight: 0.15,
    amount: 1,
    payload: { fallbackPoints: OUTFIT_FALLBACK_POINTS.legendary },
  },
]

function sumWeightsOf(rarity: LotteryRarity, prizes: readonly LotteryPrize[]): number {
  return prizes
    .filter((prize) => prize.rarity === rarity)
    .reduce((sum, prize) => sum + prize.weight, 0)
}

export const LOTTERY_WEIGHTS_BY_RARITY: Readonly<Record<LotteryRarity, number>> = {
  common: sumWeightsOf('common', LOTTERY_PRIZES),
  rare: sumWeightsOf('rare', LOTTERY_PRIZES),
  epic: sumWeightsOf('epic', LOTTERY_PRIZES),
  legendary: sumWeightsOf('legendary', LOTTERY_PRIZES),
}

export const LOTTERY_TOTAL_WEIGHT = RARITY_ORDER.reduce(
  (sum, rarity) => sum + LOTTERY_WEIGHTS_BY_RARITY[rarity],
  0,
)

/* ============================================================
   稀有度元数据 / 奖池摘要
   ============================================================ */

export interface LotteryRarityMeta {
  key: LotteryRarity
  label: string
  /** 主色（前端描边 / 光效 / 概率文本） */
  color: string
  description: string
}

export const LOTTERY_RARITY_META: Readonly<Record<LotteryRarity, LotteryRarityMeta>> = {
  common: {
    key: 'common',
    label: '普通',
    color: '#8e8e93',
    description: '日常补给：低阶种子、肥料与小额积分。',
  },
  rare: {
    key: 'rare',
    label: '稀有',
    color: '#0a84ff',
    description: '稳健回报：中阶种子、成堆肥料与三位数积分。',
  },
  epic: {
    key: 'epic',
    label: '史诗',
    color: '#bf5af2',
    description: '高阶奖励：tier 4 种子、大额积分与宠物装扮。',
  },
  legendary: {
    key: 'legendary',
    label: '传说',
    color: '#d4a72c',
    description: '顶级奖励：金苹果 / 星之果种子、千元积分与传说装扮。',
  },
}

export const LOTTERY_RARITY_LIST: readonly LotteryRarityMeta[] = RARITY_ORDER.map(
  (rarity) => LOTTERY_RARITY_META[rarity],
)

export interface LotteryPrizeSummaryItem {
  key: string
  name: string
  type: LotteryPrizeType
  /** 展示用数量，如「×2–4」「+500 积分」 */
  amountText: string
  description: string
}

export interface LotteryPrizeGroup {
  rarity: LotteryRarity
  label: string
  color: string
  description: string
  /** 该稀有度概率（百分比，保留 1 位） */
  chancePct: number
  items: LotteryPrizeSummaryItem[]
}

function amountRangeOf(prize: LotteryPrize): { min: number; max: number } {
  const min = Math.max(1, Math.trunc(prize.amountMin ?? prize.amount))
  const max = Math.max(min, Math.trunc(prize.amountMax ?? prize.amount))
  return { min, max }
}

function amountTextOf(prize: LotteryPrize): string {
  if (prize.type === 'points') return `+${prize.amount}`
  if (prize.type === 'outfit') return '随机 1 件'
  const { min, max } = amountRangeOf(prize)
  return min === max ? `×${min}` : `×${min}–${max}`
}

function prizeDescriptionOf(prize: LotteryPrize): string {
  if (prize.type === 'points') return '积分直接到账，可用于农场、商店与抽奖。'
  if (prize.type === 'fertilizer') return '农场肥料，每茬作物最多使用 2 次。'
  if (prize.type === 'seed') {
    const tierMin = Number(prize.payload?.tierMin ?? 1)
    const tierMax = Number(prize.payload?.tierMax ?? tierMin)
    return tierMin === tierMax
      ? `随机 tier ${tierMin} 种子，直接进入农场仓库。`
      : `随机 tier ${tierMin}–${tierMax} 种子，直接进入农场仓库。`
  }
  return '有在世宠物时随机发放未拥有的装扮；无宠物或已集齐则折算积分。'
}

export function buildLotteryPrizeList(prizes: readonly LotteryPrize[] = LOTTERY_PRIZES): LotteryPrizeGroup[] {
  return RARITY_ORDER.map((rarity) => {
    const meta = LOTTERY_RARITY_META[rarity]
    const rows = prizes.filter((prize) => prize.rarity === rarity)
    const weight = rows.reduce((sum, prize) => sum + prize.weight, 0)
    return {
      rarity,
      label: meta.label,
      color: meta.color,
      description: meta.description,
      chancePct: Math.round((weight / LOTTERY_TOTAL_WEIGHT) * 1000) / 10,
      items: rows.map((prize) => ({
        key: prize.key,
        name: prize.name,
        type: prize.type,
        amountText: amountTextOf(prize),
        description: prizeDescriptionOf(prize),
      })),
    }
  }).filter((group) => group.items.length > 0)
}

/** 下发给前端的奖池摘要（不暴露单项权重，只给稀有度概率） */
export const LOTTERY_PRIZE_LIST: readonly LotteryPrizeGroup[] = buildLotteryPrizeList()

/* ============================================================
   权重随机
   ============================================================ */

/** 把 rng 夹到 [0, 1) —— 外部注入的 rng 可能返回 1 或负数 */
function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(0.9999999999999999, Math.max(0, value))
}

function pickWeighted<T>(
  items: readonly T[],
  weightOf: (item: T) => number,
  rng: () => number,
): T | null {
  const weights = items.map((item) => Math.max(0, weightOf(item)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!(total > 0)) return null
  let roll = clampUnit(rng()) * total
  for (let index = 0; index < items.length; index += 1) {
    roll -= weights[index]
    if (roll < 0) return items[index]
  }
  // 浮点误差兜底：返回最后一个有权重的项
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (weights[index] > 0) return items[index]
  }
  return null
}

export interface PickPrizeOptions {
  /** 只从该稀有度及以上的奖池里抽（保底用） */
  minRarity?: LotteryRarity
  /** 便于自检注入自定义奖池 */
  prizes?: readonly LotteryPrize[]
}

/**
 * 按权重抽一个奖品模板。
 * 保底时传 `minRarity: 'epic'`，奖池会自动过滤到史诗 + 传说。
 */
export function pickPrize(
  rng: () => number = Math.random,
  options: PickPrizeOptions = {},
): LotteryPrize {
  const prizes = options.prizes ?? LOTTERY_PRIZES
  const floor = options.minRarity ? RARITY_RANK[options.minRarity] : 0
  const candidates = prizes.filter(
    (prize) => prize.weight > 0 && RARITY_RANK[prize.rarity] >= floor,
  )
  const picked = pickWeighted(candidates, (prize) => prize.weight, rng)
  if (!picked) throw new Error('抽奖奖池为空，请检查 LOTTERY_PRIZES 配置')
  return picked
}

/** 按奖品模板的 amountMin / amountMax 掷出实际数量（含两端） */
export function rollPrizeAmount(prize: LotteryPrize, rng: () => number = Math.random): number {
  const { min, max } = amountRangeOf(prize)
  if (min === max) return min
  return min + Math.floor(clampUnit(rng()) * (max - min + 1))
}

/* ============================================================
   保底
   ============================================================ */

export function isRareOrBetter(rarity: LotteryRarity): boolean {
  return RARITY_RANK[rarity] >= RARITY_RANK.rare
}

export function isEpicOrBetter(rarity: LotteryRarity): boolean {
  return RARITY_RANK[rarity] >= RARITY_RANK.epic
}

/** pity 达到 PITY_LIMIT - 1（已连续 29 抽未出史诗）时，本抽必须保底 */
export function shouldTriggerPity(pity: number): boolean {
  return Math.max(0, Math.trunc(pity)) >= PITY_LIMIT - 1
}

/**
 * 按当前保底计数修正本次稀有度：
 * 第 30 抽若自然结果低于史诗，则提升为史诗（service 会据此从史诗池重新抽取）。
 */
export function resolvePity(pity: number, rarity: LotteryRarity): LotteryRarity {
  if (shouldTriggerPity(pity) && !isEpicOrBetter(rarity)) return 'epic'
  return rarity
}

/** 抽完一次后的新保底计数：出史诗及以上归零，否则 +1 */
export function nextPityAfterDraw(pity: number, prize: Pick<LotteryPrize, 'rarity'>): number {
  if (isEpicOrBetter(prize.rarity)) return 0
  return Math.max(0, Math.trunc(pity)) + 1
}

export function outfitFallbackPoints(rarity: LotteryRarity): number {
  return rarity === 'legendary' ? OUTFIT_FALLBACK_POINTS.legendary : OUTFIT_FALLBACK_POINTS.epic
}

/* ============================================================
   入参 / 成本
   ============================================================ */

/** 只放行 1 与 10，其余（含字符串、小数、NaN）返回 null */
export function sanitizeDrawCount(raw: unknown): 1 | 10 | null {
  if (raw === 1) return 1
  if (raw === 10) return 10
  return null
}

/** 合法次数对应的总价；调用前必须先 sanitizeDrawCount */
export function lotteryCost(count: 1 | 10): number {
  return count === 1 ? LOTTERY_COSTS.single : LOTTERY_COSTS.ten
}

/* ============================================================
   配置校验（自检 / 启动期排查）
   ============================================================ */

export interface LotteryValidation {
  ok: boolean
  totalWeight: number
  errors: string[]
}

const PRIZE_TYPES: readonly LotteryPrizeType[] = ['points', 'seed', 'fertilizer', 'outfit']

export function validateLotteryPrizes(
  prizes: readonly LotteryPrize[] = LOTTERY_PRIZES,
): LotteryValidation {
  const errors: string[] = []
  const keys = new Set<string>()

  for (const prize of prizes) {
    if (!prize.key) {
      errors.push('存在空 key 的奖品')
    } else if (keys.has(prize.key)) {
      errors.push(`奖品 key 重复：${prize.key}`)
    } else {
      keys.add(prize.key)
    }
    if (!PRIZE_TYPES.includes(prize.type)) errors.push(`${prize.key} 的 type 非法：${prize.type}`)
    if (!RARITY_ORDER.includes(prize.rarity)) errors.push(`${prize.key} 的 rarity 非法：${prize.rarity}`)
    if (!Number.isFinite(prize.weight) || prize.weight <= 0) {
      errors.push(`${prize.key} 的权重必须为正数`)
    }
    if (!Number.isInteger(prize.amount) || prize.amount <= 0) {
      errors.push(`${prize.key} 的 amount 必须为正整数`)
    }
    const rawMin = prize.amountMin ?? prize.amount
    const rawMax = prize.amountMax ?? prize.amount
    if (!Number.isInteger(rawMin) || !Number.isInteger(rawMax) || rawMin <= 0 || rawMax < rawMin) {
      errors.push(`${prize.key} 的数量区间非法：${rawMin}–${rawMax}`)
    }
    if (prize.type === 'seed') {
      const tierMin = Number(prize.payload?.tierMin)
      const tierMax = Number(prize.payload?.tierMax)
      if (!Number.isInteger(tierMin) || !Number.isInteger(tierMax) || tierMin < 1 || tierMax < tierMin) {
        errors.push(`${prize.key} 的种子 tier 区间非法`)
      }
    }
    if (prize.type === 'outfit' && !isEpicOrBetter(prize.rarity)) {
      errors.push(`${prize.key} 的装扮奖励必须为史诗及以上`)
    }
    if (prize.type === 'outfit' && prize.payload?.fallbackPoints !== undefined) {
      const fallback = Number(prize.payload.fallbackPoints)
      if (!Number.isInteger(fallback) || fallback <= 0) {
        errors.push(`${prize.key} 的 fallbackPoints 必须为正整数`)
      }
    }
  }

  const totalWeight = prizes.reduce((sum, prize) => sum + prize.weight, 0)
  if (Math.abs(totalWeight - 100) > 1e-9) {
    errors.push(`奖品总权重应为 100，实际 ${totalWeight}`)
  }

  for (const rarity of RARITY_ORDER) {
    const weight = sumWeightsOf(rarity, prizes)
    if (weight <= 0) errors.push(`${rarity} 稀有度没有奖品`)
    const expected = LOTTERY_WEIGHTS_BY_RARITY[rarity]
    if (Math.abs(weight - expected) > 1e-9) {
      errors.push(`${rarity} 权重与 LOTTERY_WEIGHTS_BY_RARITY 不一致：${weight} vs ${expected}`)
    }
  }

  return { ok: errors.length === 0, totalWeight, errors }
}
