/**
 * 搜打撤 v2 客户端 DTO 类型（与服务端 raidRunService / raidStorageService / raidShopService 对齐）。
 */

import type {
  RaidGearInstance,
  RaidGroundStack,
  RaidItemStack,
  RaidLogEntry,
  RaidMapNode,
  RaidSkillRule,
} from '../lib/raid/raidRun'
import type { RaidSquadMember } from './raidSquad'

export type RaidContainerKind = 'backpack' | 'rig' | 'safe'
export type RaidGearSlot = 'helmet' | 'armor' | 'boots' | 'backpack' | 'rig'
export type RaidStatus = 'active' | 'extracted' | 'died' | 'mia' | 'abandoned'

/* ---------- 大厅 ---------- */

export interface RaidMapListItem {
  key: string
  name: string
  emoji: string
  description: string
  difficulty: string
  cols: number
  rows: number
  entryCost: number
  recommendLevel: number
  lootTier: number
  color: string
  durationMs: number
  enemyBudget: number
}

export interface RaidHistoryLoot {
  itemKey: string
  name: string
  emoji: string
  amount: number
  value: number
}

export interface RaidHistoryEntry {
  id: number
  mapKey: string
  mapName: string
  mapEmoji: string
  difficulty: string
  result: string
  kills: number
  moves: number
  durationMs: number
  lootValue: number
  loot: RaidHistoryLoot[]
  createdAt: string
}

export interface RaidStats {
  total: number
  extracted: number
  died: number
  mia: number
  kills: number
  bestLootValue: number
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

export interface RaidEquippedGearSnapshot {
  helmet: RaidGearInstance | null
  armor: RaidGearInstance | null
  boots: string | null
  backpack: string | null
  rig: string | null
}

export interface RaidOverviewLoadout {
  gear: RaidEquippedGearSnapshot
  capacities: { backpack: number; rig: number; safe: number }
  skills: RaidSkillRule[]
  backpackUnits: number
  rigUnits: number
  safeUnits: number
  storageLevel: number
  insuranceCost: number
  insuranceRate: number
}

export interface RaidOverview {
  active: boolean
  run: RaidRun | null
  maps: RaidMapListItem[]
  history: RaidHistoryEntry[]
  stats: RaidStats
  contracts: RaidContract[]
  pet: { name: string; species: string; level: number } | null
  points: number
  loadout: RaidOverviewLoadout | null
  storage: { level: number; capacity: number; used: number; free: number }
}

/* ---------- 对局 ---------- */

export interface RaidRun {
  id: number
  version: number
  mapKey: string
  mapName: string
  mapEmoji: string
  difficulty: string
  status: RaidStatus
  seed: number
  /** 组队模式下的队伍 id（单人局为 null） */
  squadId: string | null
  insured: boolean
  hp: number
  mp: number
  maxHp: number
  maxMp: number
  atk: number
  kills: number
  damageTaken: number
  currentRoom: number
  clearedRooms: number[]
  killedEnemies: string[]
  openedContainers: string[]
  takenLoot: string[]
  groundLoot: RaidGroundStack[]
  groundSeq: number
  backpack: RaidItemStack[]
  rig: RaidItemStack[]
  safe: RaidItemStack[]
  capacities: { backpack: number; rig: number; safe: number }
  gear: RaidEquippedGearSnapshot
  skills: RaidSkillRule[]
  map: RaidMapNode
  log: RaidLogEntry[]
  extractionStartedAt: number | null
  startedAt: string
  expiresAt: string
  remainingMs: number
  entryCost: number
  insuranceCost: number
  insuranceRate: number
}

export interface RaidSettlementItem {
  container: RaidContainerKind
  itemKey: string
  name: string
  emoji: string
  rarity: string
  amount: number
  value: number
}

export interface RaidSettlement {
  result: RaidStatus
  points: number
  balance: number
  gearLost: string[]
  loot: RaidSettlementItem[]
  kept: {
    backpack: RaidItemStack[]
    rig: RaidItemStack[]
    safe: RaidItemStack[]
  }
  record: {
    id: number
    mapKey: string
    result: string
    kills: number
    lootValue: number
    createdAt: string
  }
}

export interface RaidEventBatchResult {
  run: RaidRun | null
  errors: string[]
  settlement: RaidSettlement | null
  /** 本人所在队伍的队友实时状态（服务端在批处理响应里带回，供无 WebSocket 降级） */
  squad?: { members: RaidSquadMember[] } | null
}

/* ---------- 仓库 / 背包 ---------- */

export interface RaidItemInfo {
  itemKey: string
  name: string
  emoji: string
  rarity: string
  kind: string
  value: number
  sellUnit: number
  stackMax: number
  description: string
}

export interface RaidStorageItem extends RaidItemInfo {
  amount: number
}

export interface RaidBagItem extends RaidItemInfo {
  slotIndex: number
  amount: number
}

export interface RaidContainerView {
  container: RaidContainerKind
  label: string
  capacity: number
  usedSlots: number
  usedUnits: number
  items: RaidBagItem[]
}

export interface RaidGearInfo {
  gearKey: string
  name: string
  emoji: string
  slot: RaidGearSlot
  tier: number
  rarity: string
  price: number
  description: string
  defense: number
  maxDurability: number
  durability: number
  speedBonus: number
  slots: number
  equipped: boolean
}

export interface RaidUpgradeItem {
  itemKey: string
  name: string
  emoji: string
  count: number
  have: number
}

export interface RaidUpgradePreview {
  level: number
  capacity: number
  safeCapacity: number
  upgradePoints: number
  pointsOk: boolean
  materialsOk: boolean
  items: RaidUpgradeItem[]
}

export interface RaidEquippedSummary {
  helmet: RaidGearInfo | null
  armor: RaidGearInfo | null
  boots: RaidGearInfo | null
  backpack: RaidGearInfo | null
  rig: RaidGearInfo | null
}

export interface RaidStorageView {
  level: number
  capacity: number
  used: number
  free: number
  safeCapacity: number
  backpackSlots: number
  rigSlots: number
  points: number
  items: RaidStorageItem[]
  containers: {
    backpack: RaidContainerView
    rig: RaidContainerView
    safe: RaidContainerView
  }
  gear: RaidGearInfo[]
  equipped: RaidEquippedSummary
  upgrade: RaidUpgradePreview | null
}

export interface RaidDepositAllResult extends RaidStorageView {
  movedUnits: number
  remainingUnits: number
}

export interface RaidRecycleResult {
  points: number
  balance: number
  view: RaidStorageView
}

/** 一键回收整个仓库（keepUpgradeItems 默认 true，跳过仓库升级材料） */
export interface RaidRecycleAllResult {
  points: number
  count: number
  balance: number
  view: RaidStorageView
}

/* ---------- 官方商店 ---------- */

export interface RaidShopGear {
  key: string
  name: string
  emoji: string
  slot: RaidGearSlot
  tier: number
  rarity: string
  price: number
  description: string
  defense: number
  maxDurability: number
  speedBonus: number
  slots: number
  owned: boolean
}

export interface RaidShopItem {
  key: string
  name: string
  emoji: string
  rarity: string
  kind: string
  price: number
  stackMax: number
  description: string
}

export interface RaidShopView {
  points: number
  gear: RaidShopGear[]
  items: RaidShopItem[]
}

export interface RaidShopBuyResult {
  kind: 'gear' | 'item'
  key: string
  name: string
  emoji: string
  amount: number
  spent: number
  balance: number
  points: number
  view: RaidShopView
}

export interface RaidOpenCacheResult {
  type: 'gear' | 'skill'
  key: string
  name: string
  emoji: string
  duplicatePoints: number
  view: RaidStorageView
}
