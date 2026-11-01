/**
 * 积分抽奖类型（与服务端 `/api/lottery` 契约保持一致）。
 *
 * 概率、成本、保底上限全部由服务端下发，前端不硬编码数值；
 * 这里只保留与服务端 DTO 对齐的结构定义。
 */

export type LotteryRarity = 'common' | 'rare' | 'epic' | 'legendary'

export type LotteryPrizeType = 'points' | 'seed' | 'fertilizer' | 'outfit'

/** 稀有度元数据（名称 / 主色 / 说明，服务端 LOTTERY_RARITY_META 下发） */
export interface LotteryRarityMeta {
  key: LotteryRarity
  label: string
  color: string
  description: string
}

/** 奖池里的一个奖品摘要（不暴露单项权重） */
export interface LotteryPrizeSummaryItem {
  key: string
  name: string
  type: LotteryPrizeType
  amountText: string
  description: string
}

/** 按稀有度聚合的奖池分组 */
export interface LotteryPrizeGroup {
  rarity: LotteryRarity
  label: string
  color: string
  description: string
  /** 该稀有度的概率（百分比） */
  chancePct: number
  items: LotteryPrizeSummaryItem[]
}

/** 保底进度 */
export interface LotteryPity {
  /** 已连续多少抽没出史诗及以上 */
  value: number
  limit: number
  /** 距保底还差几抽（最小 1） */
  remaining: number
}

/** 一条抽奖记录（append-only） */
export interface LotteryHistoryItem {
  id: number
  prizeKey: string
  prizeType: LotteryPrizeType
  prizeName: string
  rarity: LotteryRarity
  amount: number
  payload: Record<string, unknown>
  /** 本抽消耗积分；0 = 每日免费抽 */
  cost: number
  /** ISO 字符串 */
  createdAt: string
}

/** 各稀有度累计抽中次数 */
export interface LotteryStats {
  common: number
  rare: number
  epic: number
  legendary: number
}

/** GET /api/lottery */
export interface LotteryView {
  balance: number
  costs: { single: number; ten: number }
  tenCount: number
  pity: LotteryPity
  dailyFreeAvailable: boolean
  lastFreeDate: string | null
  totalDraws: number
  prizes: LotteryPrizeGroup[]
  rarities: LotteryRarityMeta[]
  /** 最近 30 条 */
  history: LotteryHistoryItem[]
  stats: LotteryStats
}

/** 单抽结果（装扮折算时 type = points、converted = true） */
export interface LotteryResultItem {
  prizeKey: string
  type: LotteryPrizeType
  name: string
  rarity: LotteryRarity
  amount: number
  payload: Record<string, unknown>
  converted: boolean
  convertedPoints: number
}

/** POST /api/lottery/draw */
export interface LotteryDrawResponse {
  balance: number
  results: LotteryResultItem[]
  pity: LotteryPity
  dailyFreeUsed: boolean
  cost: number
}
