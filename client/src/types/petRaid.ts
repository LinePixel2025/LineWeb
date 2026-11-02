/** 宠物搜打撤（GET /api/pets/raid 等）类型，字段与服务端 petRaidService DTO 对齐。 */

import type { PetCombatStats, PetEquipmentInfo, PetLoadout, PetSkillInfo } from './pet'

export type RaidMapKey = 'wasteland' | 'dam' | 'valley' | 'space' | 'fungal' | 'abyss'
export type RaidDifficulty = 'normal' | 'hard' | 'extreme'
export type RaidStatus = 'active' | 'extracted' | 'died' | 'mia' | 'abandoned'
export type RaidLootRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'
export type RaidLootKind = 'points' | 'material' | 'seed' | 'equipment' | 'skill' | 'medkit'
export type RaidCellKind = 'empty' | 'spawn' | 'loot' | 'enemy' | 'boss' | 'extract' | 'hazard' | 'unknown'
export type RaidDirection = 'up' | 'down' | 'left' | 'right'

export interface RaidMapInfo {
  key: RaidMapKey
  name: string
  emoji: string
  description: string
  difficulty: RaidDifficulty
  size: number
  enemyCount: number
  bossCount: number
  lootCount: number
  extractCount: number
  hazardCount: number
  entryCost: number
  maxTurns: number
  recommendLevel: number
  lootTier: number
  color: string
  enemyLevel: number
  durationMs: number
}

export interface RaidLootItem {
  id: string
  key: string
  name: string
  emoji: string
  rarity: RaidLootRarity
  kind: RaidLootKind
  value: number
  amount: number
  payload: string | null
}

export interface RaidCell {
  index: number
  x: number
  y: number
  kind: RaidCellKind
  revealed: boolean
  visited: boolean
  searched: boolean
  enemy: null | {
    name: string
    emoji: string
    level: number
    kind: 'scout' | 'soldier' | 'elite' | 'boss'
    hp: number
    maxHp: number
  }
  current: boolean
}

export interface RaidLogEntry {
  id: number
  turn: number
  kind: 'move' | 'search' | 'combat' | 'loot' | 'extract' | 'info' | 'danger' | 'death' | 'success'
  text: string
  detail?: string[]
}

export interface RaidState {
  id: number
  version: number
  mapKey: string
  mapName: string
  mapEmoji: string
  difficulty: RaidDifficulty
  status: RaidStatus
  turn: number
  maxTurns: number
  hp: number
  mp: number
  maxHp: number
  maxMp: number
  stats: PetCombatStats
  player: { x: number; y: number }
  width: number
  height: number
  cells: RaidCell[]
  loot: RaidLootItem[]
  safe: RaidLootItem[]
  safeCapacity: number
  log: RaidLogEntry[]
  kills: number
  insured: boolean
  extracting: number
  extractionCell: number | null
  totalLootValue: number
  startedAt: string
  expiresAt: string
  remainingMs: number
  loadout: {
    petId: number
    userId: number
    name: string
    species: string
    level: number
    equipmentKeys: string[]
    skillKeys: string[]
  }
}

export interface RaidHistoryEntry {
  id: number
  mapKey: string
  mapName: string
  difficulty: string
  result: RaidStatus
  points: number
  kills: number
  moves: number
  durationMs: number
  loot: RaidLootItem[]
  createdAt: string
}

export interface RaidContract {
  key: string
  name: string
  description: string
  metric: 'extracts' | 'kills' | 'lootValue'
  target: number
  progress: number
  claimed: boolean
  rewardPoints: number
}

export interface RaidOverview {
  active: boolean
  raid: RaidState | null
  maps: RaidMapInfo[]
  history: RaidHistoryEntry[]
  stats: {
    totalRaids: number
    extracted: number
    died: number
    mia: number
    kills: number
    bestValue: number
  }
  contracts: RaidContract[]
  pet: null | {
    species: string
    name: string
    level: number
    equipped: PetLoadout
    stats: PetCombatStats
    hp: number
    mp: number
    maxHp: number
    maxMp: number
    equipmentKeys: string[]
    skillKeys: string[]
  }
  points: number
  insuranceRate: number
  /** 单局保险箱格数（随仓库等级提升；旧后端响应可能缺省） */
  safeCapacity?: number
  /** 搜打撤仓库概要（旧后端响应可能缺省） */
  storage?: {
    level: number
    capacity: number
    used: number
    safeCapacity: number
  }
}

export interface RaidSettlement {
  result: RaidStatus
  points: number
  balance: number
  gearLost: string[]
  loot: RaidSettlementLoot[]
  record: RaidHistoryEntry
  contracts: RaidContract[]
}

export interface RaidActionResponse {
  raid: RaidState | null
  gained: RaidLootItem[]
  combat: null | {
    enemyName: string
    won: boolean
    events: string[]
  }
  settlement: RaidSettlement | null
}

/** 结算条目的去向：material 入仓 / 折积分，seed 入农场，装备技能入栏或重复折价 */
export type RaidLootOutcome = 'warehouse' | 'points' | 'farm' | 'equipment' | 'skill' | 'dupe'

/** 结算弹层用的战利品条目（在基础条目上追加去向字段；旧后端响应缺省时按折积分兜底渲染） */
export interface RaidSettlementLoot extends RaidLootItem {
  outcome?: RaidLootOutcome
  /** outcome = 'warehouse' 时：本条已入仓的数量 */
  storedAmount?: number
  /** 本条折算成积分的部分（仓库溢出 / 急救包 / 重复装备等折价） */
  overflowPoints?: number
}

/* ============================================================
   搜打撤仓库（GET /api/pets/raid/storage 等）
   ============================================================ */

export interface RaidStorageItem {
  itemKey: string
  name: string
  emoji: string
  rarity: RaidLootRarity
  /** 单件目录价值 */
  value: number
  amount: number
  /** 交易行在售预留数量 */
  listedAmount: number
  /** amount - listedAmount（可回收 / 可上架的数量） */
  freeAmount: number
}

export interface RaidStorageUpgradeItem {
  itemKey: string
  name: string
  emoji: string
  count: number
  have: number
}

export interface RaidStorageUpgradePreview {
  level: number
  capacity: number
  safeCapacity: number
  upgradePoints: number
  /** 积分是否足够 */
  pointsOk: boolean
  /** 材料是否足够 */
  materialsOk: boolean
  items: RaidStorageUpgradeItem[]
}

export interface RaidStorageView {
  level: number
  capacity: number
  used: number
  free: number
  safeCapacity: number
  items: RaidStorageItem[]
  nextUpgrade: RaidStorageUpgradePreview | null
  feeRate: number
  balance: number
}

export interface RaidRecycleResult {
  itemKey: string
  recycled: number
  remaining: number
  points: number
  balance: number
}

/* ============================================================
   搜打撤交易行（GET /api/pets/raid/market 等）
   ============================================================ */

export interface RaidMarketListing {
  id: number
  sellerId: number
  sellerName: string
  itemKey: string
  itemName: string
  emoji: string
  rarity: RaidLootRarity
  /** 单件目录价值快照 */
  value: number
  amount: number
  /** 整单总价（积分） */
  price: number
  /** 单件均价 */
  unitPrice: number
  createdAt: string
  isMine: boolean
}

export interface RaidMarketTrade {
  id: number
  itemKey: string
  itemName: string
  emoji: string
  amount: number
  price: number
  fee: number
  sellerName: string
  buyerName: string
  createdAt: string
}

export interface RaidMarketView {
  balance: number
  feeRate: number
  listings: RaidMarketListing[]
  myListings: RaidMarketListing[]
  trades: RaidMarketTrade[]
}

export interface RaidMarketBuyResult {
  balance: number
  fee: number
  proceeds: number
  item: {
    itemKey: string
    itemName: string
    amount: number
    price: number
  }
}

/** 装备 / 技能目录（复用宠物 gear 页的类型，避免重复定义） */
export type RaidEquipmentInfo = PetEquipmentInfo
export type RaidSkillInfo = PetSkillInfo
