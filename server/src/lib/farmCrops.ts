/**
 * 开心农场静态配置与纯函数（服务端唯一真相源，客户端通过 /api/farm 获取目录）。
 *
 * 经济模型：
 *   - 种子花积分，成熟后按「可收获单位 × 单位价值」收获积分
 *   - 被偷走 1 单位，地主少 1 单位；小偷按比例获得积分
 *   - 每块地每茬最多被同一人偷 1 次，且至少保留 1 单位给地主
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
  { key: 'carrot', name: '胡萝卜', emoji: '🥕', seedCost: 10, growMinutes: 3, growMs: 3 * 60_000, yieldUnits: 2, value: 7, tier: 1, description: '新手首选，3 分钟就能收，回本快。' },
  { key: 'cabbage', name: '白菜', emoji: '🥬', seedCost: 16, growMinutes: 6, growMs: 6 * 60_000, yieldUnits: 2, value: 10, tier: 1, description: '长得快、成本低，适合练手和补空档。' },
  { key: 'strawberry', name: '草莓', emoji: '🍓', seedCost: 18, growMinutes: 8, growMs: 8 * 60_000, yieldUnits: 2, value: 12, tier: 1, description: '甜度满分，适合睡前种一垄。' },
  { key: 'rice', name: '水稻', emoji: '🌾', seedCost: 22, growMinutes: 12, growMs: 12 * 60_000, yieldUnits: 2, value: 13, tier: 1, description: '一垄水田，收的是踏实。' },
  { key: 'sunflower', name: '向日葵', emoji: '🌻', seedCost: 28, growMinutes: 15, growMs: 15 * 60_000, yieldUnits: 3, value: 11, tier: 1, description: '向着太阳生长，收成稳稳的。' },
  { key: 'potato', name: '土豆', emoji: '🥔', seedCost: 26, growMinutes: 20, growMs: 20 * 60_000, yieldUnits: 3, value: 11, tier: 1, description: '土里土气，却是最可靠的口粮。' },
  { key: 'corn', name: '玉米', emoji: '🌽', seedCost: 40, growMinutes: 30, growMs: 30 * 60_000, yieldUnits: 3, value: 16, tier: 2, description: '产量扎实，农场主的口粮。' },
  { key: 'tomato', name: '番茄', emoji: '🍅', seedCost: 55, growMinutes: 60, growMs: 60 * 60_000, yieldUnits: 3, value: 22, tier: 2, description: '红透的时候最好看，也最容易被偷。' },
  { key: 'kiwi', name: '猕猴桃', emoji: '🥝', seedCost: 65, growMinutes: 75, growMs: 75 * 60_000, yieldUnits: 3, value: 28, tier: 2, description: '毛茸茸的外表，切开是亮晶晶的收益。' },
  { key: 'chili', name: '辣椒', emoji: '🌶️', seedCost: 90, growMinutes: 180, growMs: 180 * 60_000, yieldUnits: 4, value: 30, tier: 2, description: '又辣又赚，偷菜贼要小心。' },
  { key: 'watermelon', name: '西瓜', emoji: '🍉', seedCost: 80, growMinutes: 120, growMs: 120 * 60_000, yieldUnits: 4, value: 26, tier: 3, description: '夏日限定，单位价值高。' },
  { key: 'blueberry', name: '蓝莓', emoji: '🫐', seedCost: 95, growMinutes: 100, growMs: 100 * 60_000, yieldUnits: 4, value: 30, tier: 3, description: '一小颗一小颗，攒起来就是一笔好收成。' },
  { key: 'pumpkin', name: '南瓜', emoji: '🎃', seedCost: 120, growMinutes: 240, growMs: 240 * 60_000, yieldUnits: 4, value: 40, tier: 3, description: '慢慢长大，回报丰厚。' },
  { key: 'pineapple', name: '菠萝', emoji: '🍍', seedCost: 160, growMinutes: 300, growMs: 300 * 60_000, yieldUnits: 5, value: 42, tier: 3, description: '热带来的客人，需要一点耐心。' },
  { key: 'grape', name: '葡萄', emoji: '🍇', seedCost: 180, growMinutes: 360, growMs: 360 * 60_000, yieldUnits: 5, value: 46, tier: 4, description: '一串串挂满藤架，值得守夜。' },
  { key: 'cherry', name: '樱桃', emoji: '🍒', seedCost: 220, growMinutes: 420, growMs: 420 * 60_000, yieldUnits: 5, value: 58, tier: 4, description: '娇贵又值钱，成熟时像挂了一树红宝石。' },
  { key: 'starfruit', name: '星之果', emoji: '🌟', seedCost: 300, growMinutes: 480, growMs: 480 * 60_000, yieldUnits: 5, value: 80, tier: 4, description: '传说中的作物，成熟时会发光。' },
  { key: 'goldenapple', name: '金苹果', emoji: '🍎', seedCost: 650, growMinutes: 720, growMs: 720 * 60_000, yieldUnits: 6, value: 140, tier: 5, description: '农场里的终极作物：种下去就要等半天，收获时全服都会眼红。' },
]

export const CROP_MAP: ReadonlyMap<string, CropDef> = new Map(
  FARM_CROPS.map((crop) => [crop.key, crop]),
)

export function getCrop(key: string | null | undefined): CropDef | null {
  if (!key) return null
  return CROP_MAP.get(key) ?? null
}

/** 农田可扩建档位（初始 6 块，最大 18 块） */
export const INITIAL_PLOT_COUNT = 6
export const MAX_PLOT_COUNT = 18
export const PLOT_EXPANSION_COSTS: Readonly<Record<number, number>> = {
  9: 500,
  12: 1500,
  15: 3000,
  18: 6000,
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

/** 小偷获得的积分（至少 1 分） */
export function computeStealPoints(crop: CropDef, ratio: number): number {
  return Math.max(1, Math.floor(crop.value * ratio))
}

/** 一次收获/偷菜得到的作物单位价值总和 */
export function cropUnitsValue(crop: CropDef, units: number): number {
  return Math.max(0, units) * crop.value
}
