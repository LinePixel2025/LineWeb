/** 宠物搜打撤（GET /api/pets/raid 等）类型，字段与服务端 petRaidService DTO 对齐。 */

import type { PetCombatStats, PetEquipmentInfo, PetLoadout, PetSkillInfo } from './pet'

export type RaidDifficulty = 'normal' | 'hard' | 'extreme'
export type RaidStatus = 'active' | 'extracted' | 'died' | 'mia' | 'abandoned'
export type RaidLootRarity = 'common' | 'rare' | 'epic' | 'legendary'
export type RaidLootKind = 'points' | 'material' | 'seed' | 'equipment' | 'skill' | 'medkit'
export type RaidCellKind = 'empty' | 'spawn' | 'loot' | 'enemy' | 'boss' | 'extract' | 'hazard' | 'unknown'
export type RaidDirection = 'up' | 'down' | 'left' | 'right'

export interface RaidMapInfo {
  key: string
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
}

export interface RaidSettlement {
  result: RaidStatus
  points: number
  balance: number
  gearLost: string[]
  loot: RaidLootItem[]
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

/** 装备 / 技能目录（复用宠物 gear 页的类型，避免重复定义） */
export type RaidEquipmentInfo = PetEquipmentInfo
export type RaidSkillInfo = PetSkillInfo
