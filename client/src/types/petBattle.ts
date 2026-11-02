/**
 * 宠物战斗 / 装备 / 交易行类型（与服务端 `/api/pets/*` 契约一致）。
 */

import type {
  PetCombatStats,
  PetDto,
  PetEquipmentInfo,
  PetCatalog,
  PetSkillInfo,
} from './pet'

/* ============================================================
   装备页
   ============================================================ */

export interface PetGearStatDelta {
  maxHp: number
  maxMp: number
  atk: number
  def: number
  spd: number
  crit: number
}

export interface PetGearView {
  pet: PetDto
  catalog: PetCatalog
  points: number
  stats: {
    current: PetCombatStats
    equipment: Array<{
      key: string
      stats: PetCombatStats
      delta: PetGearStatDelta
    }>
  }
}

export interface PetGearEquipInput {
  itemType: 'equipment' | 'skill'
  key: string
  equip: boolean
}

/* ============================================================
   PvP 对战
   ============================================================ */

export interface BattleParticipant {
  userId: number
  username: string
  avatarVersion: number | null
  petName: string
  species: string
  speciesName: string
  level: number
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  atk: number
  def: number
  spd: number
  crit: number
  shield: number
}

export interface BattleDrop {
  itemType: 'equipment'
  itemKey: string
  name: string
}

export interface PetBattleSummary {
  id: number
  status: 'pending' | 'active' | 'finished' | 'declined' | 'expired' | 'cancelled' | 'settling'
  challenger: BattleParticipant
  opponent: BattleParticipant
  turnUserId: number | null
  turnDeadline: string | null
  round: number
  version: number
  createdAt: string
  expiresAt: string | null
  finished: boolean
  winnerId: number | null
  loserId: number | null
  result: 'win' | 'draw' | null
  rewardPoints: number
  drop: BattleDrop | null
}

export interface PetBattleSkillOption {
  key: string
  name: string
  emoji: string
  mpCost: number
  cooldown: number
  usable: boolean
  reason: string | null
}

export interface PetBattleBuff {
  type: 'atk_up' | 'def_up' | 'crit_up'
  value: number
  turns: number
}

export interface PetBattleStatus {
  type: 'burn' | 'poison' | 'stun' | 'weaken' | 'vulnerable' | 'regen'
  value: number
  turns: number
}

export interface PetBattleEvent {
  seq: number
  round: number
  actorId: number
  targetId: number
  skillKey: string
  skillName: string
  animation: string
  kind: string
  damage: number
  absorbed: number
  heal: number
  crit: boolean
  hpAfter: number
  mpAfter: number
  text: string
}

export interface PetBattleView extends PetBattleSummary {
  me: BattleParticipant & {
    skills: PetBattleSkillOption[]
    buffs: PetBattleBuff[]
    statuses: PetBattleStatus[]
    consecutiveTimeouts: number
  }
  log: PetBattleEvent[]
  opponentSkills: Array<{
    key: string
    name: string
    emoji: string
    mpCost: number
    cooldown: number
  }>
}

export interface PetBattleOpponent {
  userId: number
  username: string
  avatarVersion: number | null
  species: string
  speciesName: string
  petName: string
  level: number
  remainingToday: number
}

export interface PetBattleOverview {
  active: PetBattleSummary | null
  incoming: PetBattleSummary[]
  outgoing: PetBattleSummary[]
  history: PetBattleSummary[]
  record: { wins: number; losses: number; draws: number; total: number }
  opponents: PetBattleOpponent[]
  stakeRule: { rate: number; min: number; max: number }
}

/* ============================================================
   玩家交易行
   ============================================================ */

export interface PetMarketItem {
  itemType: 'equipment' | 'skill'
  key: string
  name: string
  emoji: string
  description: string
  slot: string | null
  rarity: string
  basePrice: number
  refPrice: number
  changePct: number
  trades: number
  activeListings: number
  shopable: boolean
  power: number
}

export interface PetMarketListing {
  id: number
  sellerId: number
  sellerName: string
  sellerAvatarVersion: number | null
  itemType: 'equipment' | 'skill'
  itemKey: string
  name: string
  emoji: string
  slot: string | null
  rarity: string
  price: number
  refPrice: number
  changePct: number
  power: number
  createdAt: string
  isMine: boolean
}

export interface PetMarketTrade {
  id: number
  itemType: 'equipment' | 'skill'
  itemKey: string
  name: string
  emoji: string
  price: number
  fee: number
  buyerName: string
  sellerName: string
  createdAt: string
}

export interface PetMarketView {
  balance: number
  feeRate: number
  items: PetMarketItem[]
  listings: PetMarketListing[]
  myListings: PetMarketListing[]
  trades: PetMarketTrade[]
}

export type { PetEquipmentInfo, PetSkillInfo }
