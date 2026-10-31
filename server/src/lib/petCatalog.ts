/**
 * 宠物静态配置与纯函数（服务端唯一真相源，客户端只消费 /api/pets 下发的 DTO）。
 *
 * 玩法模型：
 *   - 花积分召唤一只宠物（每用户一只，userId 唯一）
 *   - 三项状态（饥饿 hunger / 清洁 cleanliness / 心情 mood）随时间线性衰减、读取时惰性结算
 *   - 任意一项归零后开始计时（criticalSince），持续 PET_GRACE_HOURS 小时无人照料即离家出走（status='gone'）
 *   - 出走后可花积分重新召唤：重置数值与等级，已购装扮保留
 */

export interface PetSpeciesDef {
  key: string
  name: string
  /** 召唤时未填名字使用的默认名 */
  defaultName: string
  emoji: string
  description: string
}

export const PET_SPECIES: readonly PetSpeciesDef[] = [
  { key: 'cat', name: '小猫', defaultName: '咪咪', emoji: '🐱', description: '软乎乎的猫主子，最爱晒太阳' },
  { key: 'dog', name: '小狗', defaultName: '旺旺', emoji: '🐶', description: '热情的小狗，见到你就摇尾巴' },
  { key: 'bird', name: '小鸟', defaultName: '啾啾', emoji: '🐦', description: '叽叽喳喳的小家伙，歌声清脆' },
]

export const PET_SPECIES_MAP: ReadonlyMap<string, PetSpeciesDef> = new Map(
  PET_SPECIES.map((species) => [species.key, species]),
)

/** Zod enum 用的物种 key 元组 */
export const PET_SPECIES_KEYS = PET_SPECIES.map((species) => species.key) as [string, ...string[]]

export function getPetSpecies(key: string | null | undefined): PetSpeciesDef | null {
  if (!key) return null
  return PET_SPECIES_MAP.get(key) ?? null
}

/** 积分价格表（召唤 / 照顾动作） */
export const PET_COSTS = {
  summon: 300,
  feed: 10,
  bathe: 15,
  play: 20,
} as const

export type PetCareKind = 'feed' | 'bathe' | 'play'

export interface PetCareActionDef {
  key: PetCareKind
  name: string
  emoji: string
  description: string
  minLevel: number
  cost: number
}

export const PET_CARE_ACTIONS: readonly PetCareActionDef[] = [
  { key: 'feed', name: '喂食', emoji: '🍖', description: '一顿美餐，饱食度回满，心情 +5', minLevel: 1, cost: PET_COSTS.feed },
  { key: 'bathe', name: '洗澡', emoji: '🛁', description: '搓搓泡泡，清洁度回满，心情 +5', minLevel: 2, cost: PET_COSTS.bathe },
  { key: 'play', name: '玩耍', emoji: '🎾', description: '一起玩球，心情 +30', minLevel: 3, cost: PET_COSTS.play },
]

export const PET_CARE_MAP: ReadonlyMap<string, PetCareActionDef> = new Map(
  PET_CARE_ACTIONS.map((action) => [action.key, action]),
)

/** Zod enum 用的照顾动作 key 元组 */
export const PET_CARE_KEYS = PET_CARE_ACTIONS.map((action) => action.key) as [PetCareKind, ...PetCareKind[]]

export interface PetTrickDef {
  key: string
  name: string
  emoji: string
  description: string
  minLevel: number
}

/** 特技动作：免费、不改数值，纯展示 */
export const PET_TRICKS: readonly PetTrickDef[] = [
  { key: 'dance', name: '跳舞', emoji: '🎵', minLevel: 4, description: '跟着节奏扭一扭' },
  { key: 'roll', name: '翻滚', emoji: '🌀', minLevel: 5, description: '咕噜咕噜滚一圈' },
  { key: 'sing', name: '唱歌', emoji: '🎤', minLevel: 6, description: '清清嗓子来一段' },
  { key: 'flip', name: '后空翻', emoji: '🤸', minLevel: 7, description: '空中转体一周' },
  { key: 'spin', name: '转圈圈', emoji: '🌪️', minLevel: 8, description: '原地小旋风' },
  { key: 'magic', name: '魔法秀', emoji: '✨', minLevel: 9, description: '凭空变出小花' },
  { key: 'firework', name: '烟花庆祝', emoji: '🎆', minLevel: 10, description: '满级专属庆祝仪式' },
]

export const PET_TRICK_MAP: ReadonlyMap<string, PetTrickDef> = new Map(
  PET_TRICKS.map((trick) => [trick.key, trick]),
)

/** Zod enum 用的特技 key 元组 */
export const PET_TRICK_KEYS = PET_TRICKS.map((trick) => trick.key) as [string, ...string[]]

export type PetOutfitSlot = 'hat' | 'neck' | 'face'

export const PET_OUTFIT_SLOTS: readonly PetOutfitSlot[] = ['hat', 'neck', 'face']

export interface PetOutfitDef {
  key: string
  name: string
  emoji: string
  description: string
  slot: PetOutfitSlot
  price: number
  minLevel: number
}

/** 装扮商店（species 无关；同一 slot 只能佩戴一件） */
export const PET_OUTFITS: readonly PetOutfitDef[] = [
  { key: 'hat_red', name: '红色小帽', emoji: '🧢', description: '一顶百搭的小红帽', slot: 'hat', price: 150, minLevel: 1 },
  { key: 'crown_gold', name: '黄金皇冠', emoji: '👑', description: '王者的排面', slot: 'hat', price: 800, minLevel: 5 },
  { key: 'scarf_blue', name: '蓝色围巾', emoji: '🧣', description: '冬天必备的暖蓝围巾', slot: 'neck', price: 200, minLevel: 1 },
  { key: 'bowtie', name: '红色蝴蝶结', emoji: '🎀', description: '绅士一点的点睛之笔', slot: 'neck', price: 250, minLevel: 2 },
  { key: 'cape_hero', name: '英雄披风', emoji: '🦸', description: '披上它就是全场最靓', slot: 'neck', price: 600, minLevel: 6 },
  { key: 'glasses_round', name: '圆框眼镜', emoji: '👓', description: '瞬间文质彬彬', slot: 'face', price: 300, minLevel: 1 },
  { key: 'sunglasses', name: '墨镜', emoji: '🕶️', description: '酷就完事了', slot: 'face', price: 350, minLevel: 3 },
]

export const PET_OUTFIT_MAP: ReadonlyMap<string, PetOutfitDef> = new Map(
  PET_OUTFITS.map((outfit) => [outfit.key, outfit]),
)

export function getPetOutfit(key: string | null | undefined): PetOutfitDef | null {
  if (!key) return null
  return PET_OUTFIT_MAP.get(key) ?? null
}

export const PET_MAX_LEVEL = 10

/** 从 level 升到 level+1 的花费 */
export function petUpgradeCost(level: number): number {
  return 100 * level
}

/** 每小时衰减速率（0–100 数值域） */
export const PET_DECAY_PER_HOUR = {
  hunger: 4,
  cleanliness: 2,
  mood: 3,
} as const

/** 最早一项归零后，再过这么多小时仍未照料即离家出走 */
export const PET_GRACE_HOURS = 48

/** 抚摸心情加成的冷却与效果 */
export const PET_TOUCH_COOLDOWN_MS = 60_000
export const PET_TOUCH_MOOD_BONUS = 2

/** 宠物名字长度上限 */
export const PET_NAME_MAX_LENGTH = 12

/* ============================================================
   衰减结算（纯函数，自检脚本直接调用）
   ============================================================ */

export interface PetStatsInput {
  hunger: number
  cleanliness: number
  mood: number
  /** 上次结算基准时刻（ms） */
  decayedAt: number
  /** 最早一项归零的时刻（ms），无则为 null */
  criticalSince: number | null
  status: string
}

export interface PetStatsSettled {
  hunger: number
  cleanliness: number
  mood: number
  /** 结算后的新基准时刻（ms） */
  decayedAt: number
  criticalSince: number | null
  /** 是否已达离家出走条件 */
  gone: boolean
}

const HOUR_MS = 3_600_000

/** 单项衰减：按速率线性下降并 clamp 到 0 */
function decayOne(value: number, ratePerHour: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return value
  return Math.max(0, value - (ratePerHour * elapsedMs) / HOUR_MS)
}

/** 某项在本次窗口内归零的时刻（ms）；value 已 <= 0 视作基准时刻本身 */
function zeroCrossingMs(value: number, ratePerHour: number, decayedAt: number): number {
  if (ratePerHour <= 0 || value <= 0) return decayedAt
  return decayedAt + (value / ratePerHour) * HOUR_MS
}

/**
 * 惰性衰减结算：
 *   - status 非 'alive' 原样返回（gone=false）
 *   - elapsed <= 0（时钟回拨）数值不变，但仍按现有 criticalSince 判定 gone
 *   - 每项线性衰减后 clamp 0；窗口内首次归零时记录归零时刻（取最早）
 *   - 衰减后三项全部 > 0 时清空 criticalSince
 *   - gone = criticalSince 距今已超过 PET_GRACE_HOURS
 */
export function settlePetStats(input: PetStatsInput, nowMs: number): PetStatsSettled {
  if (input.status !== 'alive') {
    return {
      hunger: input.hunger,
      cleanliness: input.cleanliness,
      mood: input.mood,
      decayedAt: input.decayedAt,
      criticalSince: input.criticalSince,
      gone: false,
    }
  }

  const elapsed = nowMs - input.decayedAt
  if (elapsed <= 0) {
    // 时钟回拨：数值与基准不变，保留现有危机记录，仅按 grace 判定
    const gone = input.criticalSince !== null
      && nowMs - input.criticalSince >= PET_GRACE_HOURS * HOUR_MS
    return {
      hunger: input.hunger,
      cleanliness: input.cleanliness,
      mood: input.mood,
      decayedAt: input.decayedAt,
      criticalSince: input.criticalSince,
      gone,
    }
  }
  const hunger = decayOne(input.hunger, PET_DECAY_PER_HOUR.hunger, elapsed)
  const cleanliness = decayOne(input.cleanliness, PET_DECAY_PER_HOUR.cleanliness, elapsed)
  const mood = decayOne(input.mood, PET_DECAY_PER_HOUR.mood, elapsed)

  let criticalSince = input.criticalSince
  if (hunger <= 0 || cleanliness <= 0 || mood <= 0) {
    // 取「最早归零时刻」：已有记录则保留（一定更早），否则在窗口内首次归零的三项里取最早
    const candidates: number[] = []
    if (hunger <= 0) candidates.push(zeroCrossingMs(input.hunger, PET_DECAY_PER_HOUR.hunger, input.decayedAt))
    if (cleanliness <= 0) candidates.push(zeroCrossingMs(input.cleanliness, PET_DECAY_PER_HOUR.cleanliness, input.decayedAt))
    if (mood <= 0) candidates.push(zeroCrossingMs(input.mood, PET_DECAY_PER_HOUR.mood, input.decayedAt))
    const earliest = Math.min(...candidates)
    criticalSince = criticalSince ?? earliest
  } else {
    criticalSince = null
  }

  const gone = criticalSince !== null && nowMs - criticalSince >= PET_GRACE_HOURS * HOUR_MS

  return { hunger, cleanliness, mood, decayedAt: nowMs, criticalSince, gone }
}

/**
 * 照顾动作 / 抚摸回补数值后重算 criticalSince：
 *   - 三项全部 > 0 → 危机解除（null）
 *   - 仍有归零项 → 保留原记录（原值一定不晚于剩余归零项的实际归零时刻，偏保守）
 */
export function recomputeCriticalSince(
  hunger: number,
  cleanliness: number,
  mood: number,
  criticalSince: number | null,
): number | null {
  if (hunger > 0 && cleanliness > 0 && mood > 0) return null
  return criticalSince
}

/** 当前等级解锁的动作（照顾 + 特技，按定义顺序） */
export function petUnlockedActions(level: number): string[] {
  const keys: string[] = []
  for (const action of PET_CARE_ACTIONS) {
    if (level >= action.minLevel) keys.push(action.key)
  }
  for (const trick of PET_TRICKS) {
    if (level >= trick.minLevel) keys.push(trick.key)
  }
  return keys
}

export interface PetEquipped {
  hat: string | null
  neck: string | null
  face: string | null
}

/** 空装配 */
export function emptyPetEquipped(): PetEquipped {
  return { hat: null, neck: null, face: null }
}

/**
 * 清洗 equipped JSON 字符串：
 *   - 解析失败 / 非对象 / 值类型不对 → 全空
 *   - 未知 outfitKey 或 slot 与目录不符 → 该 slot 置空（多余字段忽略）
 *   - 未拥有项由 service 层结合 PetOutfit 行再过滤
 */
export function cleanEquipped(raw: string | null | undefined): PetEquipped {
  const result = emptyPetEquipped()
  if (!raw) return result
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return result
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return result
  const record = parsed as Record<string, unknown>
  for (const slot of PET_OUTFIT_SLOTS) {
    const value = record[slot]
    if (typeof value !== 'string') continue
    const outfit = PET_OUTFIT_MAP.get(value)
    if (outfit && outfit.slot === slot) result[slot] = outfit.key
  }
  return result
}

/** 把装配序列化回 Pet.equipped 存储格式 */
export function serializeEquipped(equipped: PetEquipped): string {
  return JSON.stringify(equipped)
}

/** 展示用：保留 1 位小数 */
export function roundStat(value: number): number {
  return Math.round(value * 10) / 10
}
