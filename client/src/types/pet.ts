/**
 * 宠物系统类型（与服务端 `/api/pets` 契约保持一致，服务端由并行代理实现）。
 * 数值（hunger/cleanliness/mood 0..100、积分扣减）全部由服务端结算，前端只做展示与乐观扣分。
 */

/** 宠物种类 */
export type PetSpecies = 'cat' | 'dog' | 'bird'

/** 状态：alive 在世 / gone 离家出走 */
export type PetStatus = 'alive' | 'gone'

/** 装扮槽位 */
export type PetOutfitSlot = 'hat' | 'neck' | 'face'

/** 当前穿戴的装扮（按槽位） */
export interface PetEquipped {
  hat: string | null
  neck: string | null
  face: string | null
}

/** 宠物实例（服务端已结算状态） */
export interface PetDto {
  id: number
  species: PetSpecies
  name: string
  level: number
  status: PetStatus
  /** 饱食度 / 清洁度 / 心情，0..100 */
  hunger: number
  cleanliness: number
  mood: number
  /** 每小时衰减速率（服务端下发，用于展示） */
  decayPerHour: { hunger: number; cleanliness: number; mood: number }
  /** 三项数值中最早一项见底的时间戳；都还充裕时为 null */
  zeroAtMs: number | null
  /** 见底后的宽限期（小时），超过即离家出走 */
  graceHours: number
  equipped: PetEquipped
  /** 已购装扮 key */
  ownedOutfits: string[]
  /** 已解锁的手动动作 key（tricks 子集） */
  unlockedActions: string[]
  /** 升到下一级的花费；满级为 null */
  nextLevelCost: number | null
  /** 抚摸是否已过冷却 */
  touchReady: boolean
}

/** 种类静态配置 */
export interface PetSpeciesInfo {
  key: PetSpecies
  name: string
  defaultName: string
  emoji: string
  description: string
}

/** 装扮静态配置 */
export interface PetOutfitInfo {
  key: string
  slot: PetOutfitSlot
  name: string
  emoji: string
  price: number
  minLevel: number
  description: string
}

/** 照顾动作静态配置（feed/bathe/play） */
export interface PetCareActionInfo {
  key: 'feed' | 'bathe' | 'play'
  name: string
  emoji: string
  minLevel: number
  cost: number
  description: string
}

/** 手动动作（tricks）静态配置 */
export interface PetTrickInfo {
  key: string
  name: string
  emoji: string
  minLevel: number
  description: string
}

/** 目录（静态配置由服务端下发） */
export interface PetCatalog {
  species: PetSpeciesInfo[]
  outfits: PetOutfitInfo[]
  costs: { summon: number; feed: number; bathe: number; play: number }
  careActions: PetCareActionInfo[]
  tricks: PetTrickInfo[]
  maxLevel: number
  levelCostBase: number
  decayPerHour: { hunger: number; cleanliness: number; mood: number }
  graceHours: number
}

/** GET /api/pets */
export interface PetsView {
  /** null = 从未养过 */
  pet: PetDto | null
  catalog: PetCatalog
  points: number
}

/** POST /api/pets/summon */
export interface PetSummonResult {
  pet: PetDto
  points: number
}

/** POST /api/pets/feed | bathe | play | upgrade */
export interface PetCareResult {
  pet: PetDto
  points: number
}

/** POST /api/pets/touch */
export interface PetTouchResult {
  pet: PetDto
  /** 冷却内为 false（不涨心情） */
  gained: boolean
}

/** POST /api/pets/action */
export interface PetActionResult {
  pet: PetDto
  animation: string
}

/** POST /api/pets/outfits/buy */
export interface PetOutfitBuyResult {
  pet: PetDto
  points: number
}

/** POST /api/pets/outfits/equip | rename */
export interface PetUpdateResult {
  pet: PetDto
}
