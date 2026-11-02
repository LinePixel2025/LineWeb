/**
 * 宠物战斗技能目录与纯函数（服务端唯一真相源，客户端通过 /api/pets/gear 下发）。
 *
 * 设计口径：
 *   - 每个宠物最多装备 3 个技能 + 固定普攻（basic_attack，永远可用、0 MP、无冷却）
 *   - 技能按 MP 与冷却双重限制；伤害/治疗/增益/护盾/持续伤害都在服务端结算
 *   - animation 是客户端动画 key（见 client/src/components/pets/PetSprite.tsx 白名单）
 *   - 技能可在技能商店购买，也可在玩家交易行转让（同一宠物不能重复拥有同一技能）
 */

export type PetSkillKind = 'damage' | 'heal' | 'buff' | 'shield' | 'cleanse'

export type PetSkillEffectType =
  | 'burn' | 'poison' | 'stun' | 'shield'
  | 'atk_up' | 'def_up' | 'crit_up'
  | 'weaken' | 'vulnerable' | 'regen'

export interface PetSkillEffect {
  type: PetSkillEffectType
  /** 持续回合数（含当回合之后） */
  turns: number
  /** 效果数值：burn/poison 为每回合最大 HP 百分比；shield 为最大 HP 百分比；atk_up/def_up 为百分比 */
  value: number
  /** 触发概率（缺省 1；stun 常用 0.2） */
  chance?: number
}

export interface PetSkillDef {
  key: string
  name: string
  emoji: string
  description: string
  kind: PetSkillKind
  /** 伤害倍率（对 atk 的乘数；heal/buff 技能为 0） */
  power: number
  mpCost: number
  /** 冷却回合（使用后需要等待的自身回合数） */
  cooldown: number
  price: number
  minLevel: number
  /** 客户端动画 key */
  animation: string
  /** 无视目标防御的比例（0–1） */
  ignoreDef?: number
  /** 伤害转治疗比例（0–1） */
  lifesteal?: number
  /** 最大 HP 百分比治疗（heal/cleanse） */
  healPct?: number
  /** 额外暴击率（百分点） */
  critBonus?: number
  /** 处决阈值：目标 HP 比例低于该值时触发额外伤害（0–1） */
  executeBelow?: number
  /** 处决额外伤害比例（0–1，0.8 = +80%） */
  executeBonus?: number
  effects?: PetSkillEffect[]
}

export const PET_SKILL_MAX_EQUIPPED = 3

export const PET_BASIC_SKILL_KEY = 'basic_attack'

export const PET_SKILLS: readonly PetSkillDef[] = [
  {
    key: PET_BASIC_SKILL_KEY,
    name: '扑击',
    emoji: '👊',
    description: '最基础的攻击，不消耗 MP、没有冷却',
    kind: 'damage',
    power: 1,
    mpCost: 0,
    cooldown: 0,
    price: 0,
    minLevel: 1,
    animation: 'basic',
  },
  {
    key: 'fire_claw',
    name: '烈焰爪',
    emoji: '🔥',
    description: '带着火焰的爪击，附加 3 回合燃烧',
    kind: 'damage',
    power: 1.45,
    mpCost: 25,
    cooldown: 1,
    price: 320,
    minLevel: 2,
    animation: 'fire',
    effects: [{ type: 'burn', turns: 3, value: 5 }],
  },
  {
    key: 'ice_shield',
    name: '冰晶护盾',
    emoji: '🧊',
    description: '凝聚冰晶护盾，3 回合内吸收相当于 25% 最大 HP 的伤害',
    kind: 'shield',
    power: 0,
    mpCost: 20,
    cooldown: 2,
    price: 300,
    minLevel: 1,
    animation: 'ice',
    effects: [{ type: 'shield', turns: 3, value: 25 }],
  },
  {
    key: 'thunder_bolt',
    name: '雷霆一击',
    emoji: '⚡',
    description: '高威力雷击，20% 概率让目标眩晕 1 回合',
    kind: 'damage',
    power: 1.7,
    mpCost: 30,
    cooldown: 2,
    price: 480,
    minLevel: 3,
    animation: 'thunder',
    effects: [{ type: 'stun', turns: 1, value: 0, chance: 0.2 }],
  },
  {
    key: 'healing_light',
    name: '治愈之光',
    emoji: '✨',
    description: '温和的光芒，回复 30% 最大 HP',
    kind: 'heal',
    power: 0,
    mpCost: 25,
    cooldown: 2,
    price: 360,
    minLevel: 2,
    animation: 'heal',
    healPct: 30,
  },
  {
    key: 'poison_fang',
    name: '剧毒之牙',
    emoji: '🐍',
    description: '咬住目标注入毒素，4 回合内每回合损失 4% 最大 HP',
    kind: 'damage',
    power: 0.9,
    mpCost: 20,
    cooldown: 1,
    price: 340,
    minLevel: 2,
    animation: 'poison',
    effects: [{ type: 'poison', turns: 4, value: 4 }],
  },
  {
    key: 'shadow_strike',
    name: '暗影突袭',
    emoji: '🌑',
    description: '从阴影里现身，无视目标 50% 防御',
    kind: 'damage',
    power: 1.5,
    mpCost: 25,
    cooldown: 2,
    price: 520,
    minLevel: 4,
    animation: 'shadow',
    ignoreDef: 0.5,
  },
  {
    key: 'battle_cry',
    name: '战吼',
    emoji: '📣',
    description: '3 回合内攻击力提升 30%',
    kind: 'buff',
    power: 0,
    mpCost: 15,
    cooldown: 3,
    price: 400,
    minLevel: 3,
    animation: 'roar',
    effects: [{ type: 'atk_up', turns: 3, value: 30 }],
  },
  {
    key: 'iron_wall',
    name: '铁壁',
    emoji: '🧱',
    description: '3 回合内防御力提升 50%',
    kind: 'buff',
    power: 0,
    mpCost: 15,
    cooldown: 3,
    price: 400,
    minLevel: 3,
    animation: 'shield',
    effects: [{ type: 'def_up', turns: 3, value: 50 }],
  },
  {
    key: 'lifesteal',
    name: '汲取之触',
    emoji: '🩸',
    description: '造成伤害并回复其中 60% 的 HP',
    kind: 'damage',
    power: 1.2,
    mpCost: 30,
    cooldown: 2,
    price: 600,
    minLevel: 4,
    animation: 'drain',
    lifesteal: 0.6,
  },
  {
    key: 'meteor',
    name: '流星坠',
    emoji: '☄️',
    description: '召唤流星砸向对手，威力巨大但冷却较长',
    kind: 'damage',
    power: 2.2,
    mpCost: 40,
    cooldown: 3,
    price: 1200,
    minLevel: 6,
    animation: 'meteor',
    critBonus: 10,
  },
  {
    key: 'purify',
    name: '净化',
    emoji: '🕊️',
    description: '清除自身所有负面状态，并回复 10% 最大 HP',
    kind: 'cleanse',
    power: 0,
    mpCost: 20,
    cooldown: 2,
    price: 380,
    minLevel: 2,
    animation: 'purify',
    healPct: 10,
  },
  // ---------- 2026-11 扩充：控制 / 增益 / 处决 ----------
  {
    key: 'frost_breath',
    name: '寒冰之息',
    emoji: '🌬️',
    description: '喷出刺骨寒气，25% 概率冻结目标 1 回合',
    kind: 'damage',
    power: 1.3,
    mpCost: 28,
    cooldown: 2,
    price: 460,
    minLevel: 3,
    animation: 'ice',
    effects: [{ type: 'stun', turns: 1, value: 0, chance: 0.25 }],
  },
  {
    key: 'holy_revive',
    name: '圣光复苏',
    emoji: '🌟',
    description: '圣光清除负面状态并回复 40% 最大 HP',
    kind: 'cleanse',
    power: 0,
    mpCost: 35,
    cooldown: 3,
    price: 720,
    minLevel: 5,
    animation: 'purify',
    healPct: 40,
  },
  {
    key: 'thorn_armor',
    name: '荆棘护甲',
    emoji: '🌵',
    description: '3 回合内防御 +25%，并获得 30% 最大 HP 的护盾',
    kind: 'buff',
    power: 0,
    mpCost: 24,
    cooldown: 3,
    price: 520,
    minLevel: 4,
    animation: 'shield',
    effects: [
      { type: 'def_up', turns: 3, value: 25 },
      { type: 'shield', turns: 3, value: 30 },
    ],
  },
  {
    key: 'berserk',
    name: '狂暴',
    emoji: '😤',
    description: '2 回合内攻击力提升 50%，但护盾无法叠加',
    kind: 'buff',
    power: 0,
    mpCost: 20,
    cooldown: 3,
    price: 560,
    minLevel: 4,
    animation: 'roar',
    effects: [{ type: 'atk_up', turns: 2, value: 50 }],
  },
  {
    key: 'weakening_curse',
    name: '虚弱诅咒',
    emoji: '🕸️',
    description: '造成伤害并使目标攻击力降低 20%，持续 3 回合',
    kind: 'damage',
    power: 0.85,
    mpCost: 22,
    cooldown: 2,
    price: 480,
    minLevel: 3,
    animation: 'shadow',
    effects: [{ type: 'weaken', turns: 3, value: 20 }],
  },
  {
    key: 'armor_break',
    name: '破甲击',
    emoji: '💥',
    description: '击碎护甲，使目标防御降低 25%，持续 3 回合',
    kind: 'damage',
    power: 1.4,
    mpCost: 26,
    cooldown: 2,
    price: 540,
    minLevel: 4,
    animation: 'thunder',
    effects: [{ type: 'vulnerable', turns: 3, value: 25 }],
  },
  {
    key: 'starfall',
    name: '星辰陨落',
    emoji: '🌠',
    description: '召唤星群坠落，威力巨大、无视 20% 防御',
    kind: 'damage',
    power: 2.6,
    mpCost: 50,
    cooldown: 4,
    price: 1600,
    minLevel: 7,
    animation: 'meteor',
    ignoreDef: 0.2,
    critBonus: 15,
  },
  {
    key: 'regeneration',
    name: '回春术',
    emoji: '🌱',
    description: '立刻回复 15% HP，并在 3 回合内每回合回复 6%',
    kind: 'heal',
    power: 0,
    mpCost: 24,
    cooldown: 2,
    price: 500,
    minLevel: 3,
    animation: 'heal',
    healPct: 15,
    effects: [{ type: 'regen', turns: 3, value: 6 }],
  },
  {
    key: 'execute',
    name: '处决',
    emoji: '⚔️',
    description: '对生命值低于 30% 的目标额外造成 80% 伤害',
    kind: 'damage',
    power: 1.2,
    mpCost: 30,
    cooldown: 2,
    price: 760,
    minLevel: 5,
    animation: 'shadow',
    executeBelow: 0.3,
    executeBonus: 0.8,
  },
  {
    key: 'time_warp',
    name: '时之加速',
    emoji: '⏱️',
    description: '3 回合内暴击率提升 25%',
    kind: 'buff',
    power: 0,
    mpCost: 20,
    cooldown: 3,
    price: 620,
    minLevel: 6,
    animation: 'cheer',
    effects: [{ type: 'crit_up', turns: 3, value: 25 }],
  },
  {
    key: 'life_siphon',
    name: '生命虹吸',
    emoji: '🩸',
    description: '造成伤害并回复等量 HP，吸血效率 100%',
    kind: 'damage',
    power: 1,
    mpCost: 32,
    cooldown: 3,
    price: 900,
    minLevel: 6,
    animation: 'drain',
    lifesteal: 1,
  },
  {
    key: 'purify_rain',
    name: '净化之雨',
    emoji: '🌧️',
    description: '清除负面状态，并在 3 回合内每回合回复 8% HP',
    kind: 'cleanse',
    power: 0,
    mpCost: 28,
    cooldown: 3,
    price: 640,
    minLevel: 5,
    animation: 'purify',
    healPct: 8,
    effects: [{ type: 'regen', turns: 3, value: 8 }],
  },
]

export const PET_SKILL_MAP: ReadonlyMap<string, PetSkillDef> = new Map(
  PET_SKILLS.map((skill) => [skill.key, skill]),
)

/** Zod enum 用的技能 key 元组 */
export const PET_SKILL_KEYS = PET_SKILLS.map((skill) => skill.key) as [string, ...string[]]

export function getPetSkill(key: string | null | undefined): PetSkillDef | null {
  if (!key) return null
  return PET_SKILL_MAP.get(key) ?? null
}

/** 技能商店可售项（普攻不卖） */
export const PET_SHOP_SKILLS: readonly PetSkillDef[] = PET_SKILLS.filter(
  (skill) => skill.key !== PET_BASIC_SKILL_KEY,
)

export const PET_SKILL_RARITY_LABELS: Readonly<Record<string, string>> = {
  damage: '攻击',
  heal: '治疗',
  buff: '增益',
  shield: '护盾',
  cleanse: '净化',
}

/** 技能战力粗估（排序用） */
export function skillPower(skill: PetSkillDef): number {
  return Math.round(
    skill.power * 100 +
      skill.mpCost * 1.5 +
      (skill.healPct ?? 0) * 2 +
      (skill.effects ?? []).reduce((sum, effect) => sum + effect.value * Math.max(1, effect.turns), 0),
  )
}
