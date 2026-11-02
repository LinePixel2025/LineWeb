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

/** 随机商人的当日报价 */
export interface MerchantOffer {
  id: number
  itemKind: 'seed' | 'fertilizer'
  itemKey: string
  name: string
  emoji: string
  count: number
  price: number
  originalPrice: number
  discountPct: number
  purchased: boolean
}

export interface MerchantBundle {
  dateKey: string
  offers: MerchantOffer[]
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

export interface FarmProtectionPackage {
  hours: number
  cost: number
  label: string
}

export interface FarmProtection {
  active: boolean
  until: string | null
  remainingMs: number
  maxHours: number
  packages: FarmProtectionPackage[]
}

/* ============================================================
   玩家间种子交易
   ============================================================ */

export interface SeedListing {
  id: number
  crop: FarmCrop
  count: number
  price: number
  unitPrice: number
  status: string
  seller: { id: number; username: string; title: UserTitleDto | null }
  buyer: { id: number; username: string } | null
  isMine: boolean
  soldAt: string | null
  createdAt: string
}

export interface SeedMarketView {
  listings: SeedListing[]
  myListings: SeedListing[]
  recentSold: SeedListing[]
  mySeeds: Array<{ key: string; name: string; emoji: string; count: number; tier: number }>
  catalog: FarmCrop[]
  feeRate: number
  maxListings: number
  maxCount: number
  maxPrice: number
}

export interface SeedListingResult {
  view: SeedMarketView
  listing: SeedListing
}

export interface SeedBuyResult {
  view: SeedMarketView
  listing: SeedListing
  balance: number
  fee: number
  sellerProceeds: number
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
    protectedUntil: string | null
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
  /** 偷菜保护状态 */
  protection: FarmProtection
  /** 每日随机掉落种子（同一天只有一次 dropped=true） */
  seedDrop: SeedDrop
  /** 今日随机商人（每日 0 点刷新） */
  merchant: MerchantBundle
  recentSteals: { made: FarmStealRecord[]; received: FarmStealRecord[] }
}

/** POST /api/farm/merchant/:offerId/buy */
export interface MerchantPurchaseResult {
  view: FarmView
  offer: MerchantOffer
  balance: number
}

/** POST /api/farm/plots/:index/harvest */
export interface HarvestResult {
  view: FarmView
  crop: FarmCrop
  units: number
  points: number
  balance: number
}

/** POST /api/farm/plant-all */
export interface PlantAllResult {
  view: FarmView
  planted: number
  crop: FarmCrop
  remainingSeeds: number
}

/** POST /api/farm/harvest-all */
export interface HarvestAllResult {
  view: FarmView
  harvested: number
  units: number
  points: number
  balance: number
  crops: Array<{ key: string; name: string; emoji: string; units: number; points: number }>
}

/** POST /api/farm/fertilize-all */
export interface FertilizeAllResult {
  view: FarmView
  /** 实际施肥的地块数 */
  fertilizedCount: number
  /** 施肥后剩余的肥料份数 */
  fertilizerLeft: number
  /** 可施肥但因肥料耗尽而跳过的地块数（规则不满足的地块不计数） */
  skippedCount: number
}

/** POST /api/farm/protect */
export interface ProtectionPurchaseResult {
  view: FarmView
  balance: number
  until: string
  package: FarmProtectionPackage
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
  /** 该邻居的农场保护状态 */
  protection: FarmProtection
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
  /** 地主是否开启了偷菜保护 */
  protection: FarmProtection
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
