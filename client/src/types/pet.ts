/**
 * 宠物系统类型（与服务端 `/api/pets` 契约保持一致）。
 * 数值（hunger/cleanliness/mood 0..100、积分扣减）全部由服务端结算，前端只做展示与乐观扣分。
 *
 * 注意：新增的可选字段（palette / personality / speciesName / pats / switchCost 等）标成 `?`
 * 是为了兼容既有测试夹具与「前端先上线、服务端后上线」的滚动发布窗口，
 * 渲染侧一律用 `?? 兜底值`，不要假设字段一定存在。
 */

/** 宠物种类（cat/dog/bird 为历史数据，key 不可变） */
export type PetSpecies = 'cat' | 'dog' | 'bird' | 'rabbit' | 'fox' | 'panda'

/** 状态：alive 在世 / gone 离家出走 */
export type PetStatus = 'alive' | 'gone'

/** 装扮槽位 */
export type PetOutfitSlot = 'hat' | 'neck' | 'face' | 'back' | 'aura'

/** 当前穿戴的装扮（按槽位） */
export interface PetEquipped {
  hat: string | null
  neck: string | null
  face: string | null
  back: string | null
  aura: string | null
}

/** 战斗装备槽位 */
export type PetEquipmentSlot = 'weapon' | 'armor' | 'accessory'

/** 完整装配：装扮 + 战斗装备 + 已装备技能 */
export interface PetLoadout extends PetEquipped {
  weapon: string | null
  armor: string | null
  accessory: string | null
  skills: string[]
}

/** 战斗属性（服务端派生） */
export interface PetCombatStats {
  maxHp: number
  maxMp: number
  atk: number
  def: number
  spd: number
  crit: number
}

/** 装备静态配置 */
export interface PetEquipmentInfo {
  key: string
  name: string
  emoji: string
  description: string
  slot: PetEquipmentSlot
  rarity: 'common' | 'rare' | 'epic' | 'legendary'
  price: number
  atk: number
  def: number
  hp: number
  spd: number
  crit: number
  minLevel: number
  bound: boolean
  shopable: boolean
}

/** 技能效果 */
export interface PetSkillEffectInfo {
  type: 'burn' | 'poison' | 'stun' | 'shield'
    | 'atk_up' | 'def_up' | 'crit_up'
    | 'weaken' | 'vulnerable' | 'regen'
  turns: number
  value: number
  chance?: number
}

/** 技能静态配置 */
export interface PetSkillInfo {
  key: string
  name: string
  emoji: string
  description: string
  kind: 'damage' | 'heal' | 'buff' | 'shield' | 'cleanse'
  power: number
  mpCost: number
  cooldown: number
  price: number
  minLevel: number
  animation: string
  ignoreDef?: number
  lifesteal?: number
  healPct?: number
  critBonus?: number
  /** 处决阈值（0–1） */
  executeBelow?: number
  /** 处决额外伤害（0–1） */
  executeBonus?: number
  effects?: PetSkillEffectInfo[]
}

/** 物种配色（主色 / 辅色 / 点缀色），用于贴图与主题卡 */
export interface PetPalette {
  primary: string
  secondary: string
  accent: string
}

/** 宠物实例（服务端已结算状态） */
export interface PetDto {
  id: number
  /** 主人 userId（用于跳转自己的宠物之家；旧数据缺失时前端隐藏入口） */
  ownerId?: number
  species: PetSpecies
  /** 物种显示名（服务端下发；缺失时前端按 species 兜底） */
  speciesName?: string
  speciesEmoji?: string
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
  /** 完整装配（装扮 + 装备 + 技能）；旧服务端可能缺失 */
  loadout?: PetLoadout
  /** 已购装扮 key */
  ownedOutfits: string[]
  /** 已拥有装备 key */
  ownedEquipment?: string[]
  /** 已学会技能 key */
  ownedSkills?: string[]
  /** 由等级 + 物种 + 已穿戴装备派生的战斗属性 */
  battleStats?: PetCombatStats
  /** 已解锁的手动动作 key（tricks 子集） */
  unlockedActions: string[]
  /** 升到下一级的花费；满级为 null */
  nextLevelCost: number | null
  /** 抚摸是否已过冷却 */
  touchReady: boolean
  /** 被别人撸的累计次数（宠物之家人气） */
  pats?: number
  /** 换物种花费（服务端下发，前端不硬编码） */
  switchCost?: number
}

/** 种类静态配置 */
export interface PetSpeciesInfo {
  key: PetSpecies
  name: string
  defaultName: string
  emoji: string
  description: string
  /** 一句性格描述（换宠物卡片展示） */
  personality?: string
  palette?: PetPalette
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
  /** 战斗装备目录 */
  equipment?: PetEquipmentInfo[]
  /** 技能目录 */
  skills?: PetSkillInfo[]
  /** 系统装备商店可售项 */
  shopEquipment?: PetEquipmentInfo[]
  /** 技能商店可售项 */
  shopSkills?: PetSkillInfo[]
  /** 最多同时装备几个技能 */
  maxEquippedSkills?: number
  costs: { summon: number; feed: number; bathe: number; play: number; switch?: number }
  careActions: PetCareActionInfo[]
  tricks: PetTrickInfo[]
  maxLevel: number
  levelCostBase: number
  decayPerHour: { hunger: number; cleanliness: number; mood: number }
  graceHours: number
  /** 换物种花费（与 costs.switch 同值） */
  switchCost?: number
  /** 串门每日撸宠上限 */
  patDailyLimit?: number
  /** 留言每日条数上限 */
  guestbookDailyLimit?: number
  /** 留言长度上限 */
  guestbookMaxLength?: number
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

/** POST /api/pets/feed | bathe | play | upgrade | switch */
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

/* ============================================================
   宠物之家（公共串门）
   ============================================================ */

/** 列表卡片里的宠物摘要（服务端只暴露 mood） */
export interface PetHomePetSummary {
  species: PetSpecies
  speciesName: string
  name: string
  level: number
  mood: number
  pats: number
  equipped: PetEquipped
}

/** GET /api/pets/homes 的单条 */
export interface PetHomeSummary {
  userId: number
  username: string
  avatarVersion: number | null
  pet: PetHomePetSummary
  isSelf: boolean
}

/** GET /api/pets/homes?query= */
export interface PetHomesResult {
  homes: PetHomeSummary[]
  query: string
}

/** 留言作者 */
export interface PetGuestbookAuthor {
  userId: number
  username: string
}

/** 一条留言 */
export interface PetGuestbookEntry {
  id: number
  content: string
  author: PetGuestbookAuthor
  /** ISO 字符串 */
  createdAt: string
  isMine: boolean
}

/** 宠物之家主人 */
export interface PetHomeOwner {
  userId: number
  username: string
  avatarVersion: number | null
}

/** GET /api/pets/homes/:userId */
export interface PetHomeDetail {
  owner: PetHomeOwner
  publicPet: {
    species: PetSpecies
    speciesName: string
    name: string
    level: number
    mood: number
    equipped: PetEquipped
    pats: number
    status: PetStatus
  }
  guestbook: PetGuestbookEntry[]
  viewer: {
    patsToday: number
    patsRemaining: number
    canGuestbook: boolean
  }
  /** 人气排名（按 pats 降序，1 = 人气最高） */
  rank: number
  isSelf: boolean
}

/** POST /api/pets/homes/:userId/pat */
export interface PetPatResult {
  /** 今天我在它家已撸次数 */
  pats: number
  /** 宠物累计人气 */
  popularity: number
  mood: number
  /** 今天还剩几次 */
  remaining: number
  animation: 'pat'
}

/** POST /api/pets/homes/:userId/guestbook */
export interface PetGuestbookAddResult {
  entry: PetGuestbookEntry
  guestbook: PetGuestbookEntry[]
}

/** DELETE /api/pets/guestbook/:id */
export interface PetGuestbookDeleteResult {
  id: number
}
