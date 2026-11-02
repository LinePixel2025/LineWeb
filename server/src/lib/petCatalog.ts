/**
 * 宠物静态配置与纯函数（服务端唯一真相源，客户端只消费 /api/pets 下发的 DTO）。
 *
 * 玩法模型：
 *   - 花积分召唤一只宠物（每用户一只，userId 唯一）
 *   - 三项状态（饥饿 hunger / 清洁 cleanliness / 心情 mood）随时间线性衰减、读取时惰性结算
 *   - 任意一项归零后开始计时（criticalSince），持续 PET_GRACE_HOURS 小时无人照料即离家出走（status='gone'）
 *   - 出走后可花积分重新召唤：重置数值与等级，已购装扮保留
 *   - 2026-11 起 equipped JSON 同时承载战斗装备（weapon/armor/accessory）与技能（skills），
 *     旧版仅含 hat/neck/face 的数据可无损读取
 */

import { PET_EQUIPMENT_MAP, PET_EQUIPMENT_SLOTS, type PetEquipmentSlot } from './petEquipment.js'
import { PET_SKILL_MAP, PET_SKILL_MAX_EQUIPPED } from './petSkills.js'

/** 物种配色（主色 / 辅色 / 点缀色），前端据此画贴图与主题卡 */
export interface PetSpeciesPalette {
  primary: string
  secondary: string
  accent: string
}

export interface PetSpeciesDef {
  key: string
  name: string
  /** 召唤时未填名字使用的默认名 */
  defaultName: string
  emoji: string
  description: string
  /** 一句性格描述（换宠物卡片上展示，帮助玩家做选择） */
  personality: string
  palette: PetSpeciesPalette
}

/**
 * 物种目录。
 * 前三个（cat/dog/bird）是历史数据兼容项，key 永久不可变；
 * 新增物种只能追加，否则库里已有的宠物会变成未知物种。
 */
export const PET_SPECIES: readonly PetSpeciesDef[] = [
  {
    key: 'cat',
    name: '小猫',
    defaultName: '咪咪',
    emoji: '🐱',
    description: '软乎乎的猫主子，最爱晒太阳',
    personality: '高冷又黏人，尾巴一甩就是它的心事',
    palette: { primary: '#f2a55c', secondary: '#ffe6c2', accent: '#e8837f' },
  },
  {
    key: 'dog',
    name: '小狗',
    defaultName: '旺旺',
    emoji: '🐶',
    description: '热情的小狗，见到你就摇尾巴',
    personality: '永远相信你，摇尾巴就是全部的情绪',
    palette: { primary: '#cf9a63', secondary: '#f8e6c8', accent: '#e8877a' },
  },
  {
    key: 'bird',
    name: '小鸟',
    defaultName: '啾啾',
    emoji: '🐦',
    description: '叽叽喳喳的小家伙，歌声清脆',
    personality: '话很多的小歌手，一有风就想飞',
    palette: { primary: '#5cc6e8', secondary: '#e2f8ff', accent: '#f7c948' },
  },
  {
    key: 'rabbit',
    name: '小兔',
    defaultName: '糯糯',
    emoji: '🐰',
    description: '竖着长耳朵的软糖，胆子小但很黏人',
    personality: '一惊一乍的软糖，跳一下要回头看你一眼',
    palette: { primary: '#ecd8ef', secondary: '#fff7fb', accent: '#f28fa8' },
  },
  {
    key: 'fox',
    name: '小狐狸',
    defaultName: '阿狸',
    emoji: '🦊',
    description: '机灵的小狐狸，尾巴蓬松得像围巾',
    personality: '聪明的小机灵鬼，尾巴一摇就有新点子',
    palette: { primary: '#ef8b4c', secondary: '#fff1e1', accent: '#c95c33' },
  },
  {
    key: 'panda',
    name: '小熊猫',
    defaultName: '圆圆',
    emoji: '🐼',
    description: '圆滚滚的小熊猫，抱着竹子就能睡着',
    personality: '慢半拍的抱抱熊，吃饱就开始犯困',
    palette: { primary: '#f2f0ec', secondary: '#33333c', accent: '#f0a6b5' },
  },
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

/** 积分价格表（召唤 / 换物种 / 照顾动作） */
export const PET_COSTS = {
  summon: 300,
  switch: 100,
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

/** 特技动作：免费、不改数值，纯展示（key 只允许小写字母 / 数字 / 下划线） */
export const PET_TRICKS: readonly PetTrickDef[] = [
  { key: 'stretch', name: '伸懒腰', emoji: '🙆', minLevel: 2, description: '前爪一伸，尾巴翘起来打个哈欠' },
  { key: 'beg', name: '作揖', emoji: '🥺', minLevel: 3, description: '双爪并拢，眼巴巴地讨一口吃的' },
  { key: 'dance', name: '跳舞', emoji: '🎵', minLevel: 4, description: '跟着节奏扭一扭' },
  { key: 'roll', name: '翻滚', emoji: '🌀', minLevel: 5, description: '咕噜咕噜滚一圈' },
  { key: 'highfive', name: '击掌', emoji: '✋', minLevel: 5, description: '抬起前爪和你击个掌' },
  { key: 'sing', name: '唱歌', emoji: '🎤', minLevel: 6, description: '清清嗓子来一段' },
  { key: 'flip', name: '后空翻', emoji: '🤸', minLevel: 7, description: '空中转体一周' },
  { key: 'moonwalk', name: '太空步', emoji: '🕺', minLevel: 7, description: '踩着拍子向后滑，经典太空步' },
  { key: 'spin', name: '转圈圈', emoji: '🌪️', minLevel: 8, description: '原地小旋风' },
  { key: 'playdead', name: '装死', emoji: '😵', minLevel: 8, description: '四脚一摊，装死骗你摸摸' },
  { key: 'wave', name: '招手', emoji: '👋', minLevel: 3, description: '抬起小爪子朝你挥一挥' },
  { key: 'sneeze', name: '打喷嚏', emoji: '🤧', minLevel: 6, description: '鼻头一痒，打出一个小喷嚏' },
  { key: 'yawn', name: '打哈欠', emoji: '🥱', minLevel: 9, description: '张大嘴巴，困意传染给你' },
  { key: 'magic', name: '魔法秀', emoji: '✨', minLevel: 9, description: '凭空变出小花' },
  { key: 'cheer', name: '欢呼', emoji: '🎉', minLevel: 9, description: '蹦起来为你欢呼，撒一把彩纸' },
  { key: 'firework', name: '烟花庆祝', emoji: '🎆', minLevel: 10, description: '满级专属庆祝仪式' },
]

export const PET_TRICK_MAP: ReadonlyMap<string, PetTrickDef> = new Map(
  PET_TRICKS.map((trick) => [trick.key, trick]),
)

/** Zod enum 用的特技 key 元组 */
export const PET_TRICK_KEYS = PET_TRICKS.map((trick) => trick.key) as [string, ...string[]]

export type PetOutfitSlot = 'hat' | 'neck' | 'face' | 'back' | 'aura'

export const PET_OUTFIT_SLOTS: readonly PetOutfitSlot[] = ['hat', 'neck', 'face', 'back', 'aura']

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
  { key: 'monocle', name: '单片眼镜', emoji: '🧐', description: '绅士的象征，还带一条金链子', slot: 'face', price: 420, minLevel: 3 },
  { key: 'party_hat', name: '派对尖帽', emoji: '🎉', description: '今天是什么日子？戴上它就知道了', slot: 'hat', price: 280, minLevel: 1 },
  { key: 'bandana', name: '海盗头巾', emoji: '🏴‍☠️', description: '系上它，连走路都带风', slot: 'hat', price: 360, minLevel: 2 },
  { key: 'bell_collar', name: '铃铛项圈', emoji: '🔔', description: '走一步响一下，想藏都藏不住', slot: 'neck', price: 220, minLevel: 1 },
  { key: 'star_pin', name: '星星胸针', emoji: '⭐', description: '小小一颗，别在胸前刚刚好', slot: 'neck', price: 320, minLevel: 2 },
  { key: 'backpack', name: '探险背包', emoji: '🎒', description: '装得下小鱼干，也装得下远方', slot: 'back', price: 400, minLevel: 1 },
  { key: 'wings_angel', name: '天使之翼', emoji: '👼', description: '毛茸茸的白色羽翼，会随着呼吸轻轻扇动', slot: 'back', price: 900, minLevel: 4 },
  { key: 'wings_bat', name: '暗夜蝠翼', emoji: '🦇', description: '深紫色的蝠翼，夜里看起来有点帅', slot: 'back', price: 750, minLevel: 3 },
  { key: 'aura_sparkle', name: '星尘光环', emoji: '✨', description: '身边总飘着几颗不肯落下的星尘', slot: 'aura', price: 600, minLevel: 1 },
  { key: 'halo_gold', name: '圣光环', emoji: '😇', description: '头顶一圈金色光环，自带圣洁滤镜', slot: 'aura', price: 1000, minLevel: 6 },
  { key: 'aura_flame', name: '烈焰环绕', emoji: '🔥', description: '一圈不烫手的火焰，围着你转圈', slot: 'aura', price: 850, minLevel: 5 },
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

/** 串门每天最多撸同一只宠物几次（按 Asia/Shanghai 自然日） */
export const PAT_DAILY_LIMIT = 3

/** 同一访客在同一宠物之家每天最多留言条数 */
export const GUESTBOOK_DAILY_LIMIT = 5

/** 留言内容长度上限（按字符计，emoji 算 1 个） */
export const GUESTBOOK_MAX_LENGTH = 60

/** 撸一次让目标宠物心情上涨的幅度（公共接口只回补 mood，不动主人其它数值） */
export const PET_PAT_MOOD_BONUS = 1.5

/* ============================================================
   入参清洗（纯函数，service / 路由 / 自检脚本共用）
   ============================================================ */

/**
 * 宠物名清洗：trim 后截断到 PET_NAME_MAX_LENGTH；空串回退到 fallback。
 * 名字只是展示文本，不做字符集限制（中文 / emoji 都允许）。
 */
export function normalizePetName(raw: string | null | undefined, fallback: string): string {
  const clean = (raw ?? '').trim()
  if (!clean) return fallback
  return clean.slice(0, PET_NAME_MAX_LENGTH)
}

/** 当天撸宠次数是否还没到上限（limit 允许覆盖，便于测试边界） */
export function canPatToday(count: number, limit: number = PAT_DAILY_LIMIT): boolean {
  if (!Number.isFinite(count) || count < 0) return true
  return count < Math.max(0, Math.trunc(limit))
}

/**
 * 留言清洗：
 *   - 去掉 C0/C1 控制字符（保留换行→空格，避免多行留言把列表撑开）
 *   - 连续空白压成一个空格、trim
 *   - 超过 GUESTBOOK_MAX_LENGTH 截断
 *   - 清洗后为空返回 null（调用方据此报 400）
 *
 * 用 Array.from 按 code point 遍历，保证 emoji（代理对）不会被截断成半个字符。
 */
export function sanitizeGuestbookContent(raw: string | null | undefined): string | null {
  if (!raw) return null
  const normalized = raw.replace(/\r\n?/g, '\n')
  // eslint-disable-next-line no-control-regex
  const stripped = normalized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
  const singleLine = stripped.replace(/\s+/g, ' ').trim()
  if (!singleLine) return null
  const chars = Array.from(singleLine)
  if (chars.length > GUESTBOOK_MAX_LENGTH) return chars.slice(0, GUESTBOOK_MAX_LENGTH).join('').trim()
  return singleLine || null
}

/**
 * 换物种后的名字：玩家自定义名保留；名字仍是旧物种默认名时同步换成新物种默认名。
 * 只看「是否等于默认名」，避免把玩家自己起的名字悄悄覆盖。
 */
export function nextNameAfterSwitch(
  currentName: string,
  currentSpeciesKey: string | null | undefined,
  nextSpecies: PetSpeciesDef,
): string {
  const currentSpecies = getPetSpecies(currentSpeciesKey)
  const isDefaultName = !!currentSpecies && currentName.trim() === currentSpecies.defaultName
  return isDefaultName ? nextSpecies.defaultName : currentName
}

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
  back: string | null
  aura: string | null
}

/** 空装配 */
export function emptyPetEquipped(): PetEquipped {
  return { hat: null, neck: null, face: null, back: null, aura: null }
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

/* ============================================================
   战斗装备 / 技能装配（与装扮共用 Pet.equipped JSON）
   ============================================================ */

export interface PetLoadout extends PetEquipped {
  weapon: string | null
  armor: string | null
  accessory: string | null
  skills: string[]
}

export function emptyPetLoadout(): PetLoadout {
  return { ...emptyPetEquipped(), weapon: null, armor: null, accessory: null, skills: [] }
}

/**
 * 清洗完整装配 JSON：
 *   - 装扮部分复用 cleanEquipped（未知装扮自动剔除）
 *   - 装备部分只接受目录内、槽位匹配、且 ownedEquipment 中确实拥有的 key
 *   - 技能只接受目录内、ownedSkills 中确实拥有、最多 3 个
 * 任何解析失败都回退为全空，不抛异常。
 */
export function cleanLoadout(
  raw: string | null | undefined,
  ownedEquipment: readonly string[],
  ownedSkills: readonly string[],
): PetLoadout {
  const result: PetLoadout = { ...cleanEquipped(raw), weapon: null, armor: null, accessory: null, skills: [] }
  if (!raw) return result
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return result
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return result
  const record = parsed as Record<string, unknown>
  const equipmentSet = new Set(ownedEquipment)
  for (const slot of PET_EQUIPMENT_SLOTS) {
    const value = record[slot]
    if (typeof value !== 'string' || !equipmentSet.has(value)) continue
    const item = PET_EQUIPMENT_MAP.get(value)
    if (item && item.slot === slot) result[slot] = item.key
  }
  const skillSet = new Set(ownedSkills)
  const rawSkills = record.skills
  if (Array.isArray(rawSkills)) {
    const seen = new Set<string>()
    for (const value of rawSkills) {
      if (typeof value !== 'string' || seen.has(value) || !skillSet.has(value)) continue
      if (!PET_SKILL_MAP.has(value)) continue
      seen.add(value)
      result.skills.push(value)
      if (result.skills.length >= PET_SKILL_MAX_EQUIPPED) break
    }
  }
  return result
}

export function serializeLoadout(loadout: PetLoadout): string {
  return JSON.stringify(loadout)
}

/** 装配里的战斗装备 key 列表（按槽位顺序） */
export function loadoutEquipmentKeys(loadout: PetLoadout): string[] {
  return PET_EQUIPMENT_SLOTS.map((slot) => loadout[slot]).filter(
    (key): key is string => typeof key === 'string' && key.length > 0,
  )
}

/** 判断某个装备槽当前穿了什么 */
export function equippedKeyOfSlot(
  loadout: PetLoadout,
  slot: PetEquipmentSlot,
): string | null {
  return loadout[slot]
}

/** 展示用：保留 1 位小数 */
export function roundStat(value: number): number {
  return Math.round(value * 10) / 10
}
