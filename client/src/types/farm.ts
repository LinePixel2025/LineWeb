import type { UserTitleDto } from './points'

/** 作物静态配置（服务端 /api/farm 下发） */
export interface FarmCrop {
  key: string
  name: string
  emoji: string
  seedCost: number
  growMinutes: number
  growMs: number
  yieldUnits: number
  value: number
  tier: number
  description: string
}

export interface FarmPlot {
  index: number
  crop: FarmCrop | null
  plantedAt: string | null
  readyAt: string | null
  yieldUnits: number
  stolenCount: number
  fertilized: number
  progress: number
  ready: boolean
  remainingMs: number
}

export interface FarmSeedStack {
  key: string
  name: string
  emoji: string
  count: number
}

export interface StealQuota {
  used: number
  limit: number
  remaining: number
}

/** 每日随机掉落的种子 */
export interface SeedDropItem {
  key: string
  name: string
  emoji: string
  count: number
}

export interface SeedDrop {
  /** 本次拉取是否触发了当日掉落（同日只有一次） */
  dropped: boolean
  seeds: SeedDropItem[]
}

export interface FarmStealRecord {
  id: number
  crop: FarmCrop | null
  points: number
  createdAt: string
  user: { id: number; username: string }
}

export interface FarmExpansion {
  plotCount: number
  cost: number
}

/** GET /api/farm */
export interface FarmView {
  farm: {
    id: number
    name: string
    plotCount: number
    tutorialDone: boolean
    createdAt: string
    harvested: number
    harvestPoints: number
    stolenPoints: number
  } | null
  plots: FarmPlot[]
  inventory: { seeds: FarmSeedStack[]; fertilizer: number }
  catalog: FarmCrop[]
  economy: {
    initialPlotCount: number
    maxPlotCount: number
    fertilizerCost: number
    fertilizerMaxPerCrop: number
    expansions: FarmExpansion[]
  }
  points: number
  stealQuota: StealQuota
  /** 自己今天已被偷的次数（达到上限后别人偷不到） */
  victimQuota: StealQuota
  /** 每日随机掉落种子（同一天只有一次 dropped=true） */
  seedDrop: SeedDrop
  recentSteals: { made: FarmStealRecord[]; received: FarmStealRecord[] }
}

/** POST /api/farm/plots/:index/harvest */
export interface HarvestResult {
  view: FarmView
  crop: FarmCrop
  units: number
  points: number
  balance: number
}

/** GET /api/farm/neighbors */
export interface FarmNeighbor {
  userId: number
  username: string
  farmName: string
  plotCount: number
  readyCount: number
  stealableCount: number
  /** 该邻居今天已被偷的次数 */
  victimQuota: StealQuota
  title: UserTitleDto | null
  updatedAt: string
}

export interface PublicFarmPlot {
  index: number
  crop: FarmCrop | null
  readyAt: string | null
  yieldUnits: number
  stolenCount: number
  ready: boolean
  stealable: boolean
  progress: number
}

/** GET /api/farm/users/:id */
export interface NeighborFarmView {
  owner: { userId: number; username: string; title: UserTitleDto | null }
  farm: { name: string; plotCount: number; createdAt: string }
  plots: PublicFarmPlot[]
  /** 我的偷菜额度 */
  quota: StealQuota
  /** 地主今天已被偷的次数（达到上限后不可再偷） */
  victimQuota: StealQuota
}

/** POST /api/farm/users/:id/steal/:index */
export interface StealSuccess {
  success: true
  points: number
  balance: number
  quota: StealQuota
  victimQuota: StealQuota
  plot: PublicFarmPlot
  crop: FarmCrop
}

/** 偷菜失败：不消耗额度、不减少产量 */
export interface StealFailure {
  success: false
  message: string
  quota: StealQuota
  victimQuota: StealQuota
  plot: PublicFarmPlot
  crop: FarmCrop
}

export type StealResult = StealSuccess | StealFailure
