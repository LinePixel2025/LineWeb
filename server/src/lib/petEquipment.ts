/**
 * 宠物战斗装备目录与纯函数（服务端唯一真相源，客户端通过 /api/pets/gear 下发）。
 *
 * 设计口径：
 *   - 三槽位：weapon（武器）/ armor（护甲）/ accessory（饰品），同槽位只能穿一件
 *   - 新手装（bound=true）免费发放、不可掉落、不可交易；商店只卖 shopable 的普通/稀有装备
 *   - 史诗/传说装备只能通过战斗掉落或玩家交易行获得，价格字段同时作为交易行参考价基础
 *   - 所有数值是「加到派生属性上的绝对值」，不是百分比（crit 例外，单位是百分点）
 */

export type PetEquipmentSlot = 'weapon' | 'armor' | 'accessory'
export type PetEquipmentRarity = 'common' | 'rare' | 'epic' | 'legendary'

export const PET_EQUIPMENT_SLOTS: readonly PetEquipmentSlot[] = ['weapon', 'armor', 'accessory']

export interface PetEquipmentDef {
  key: string
  name: string
  emoji: string
  description: string
  slot: PetEquipmentSlot
  rarity: PetEquipmentRarity
  /** 商店价 / 交易行参考价基础（绑定新手装为 0） */
  price: number
  atk: number
  def: number
  hp: number
  spd: number
  /** 暴击率加成（百分点） */
  crit: number
  minLevel: number
  /** 绑定装备：不可掉落、不可交易 */
  bound: boolean
  /** 是否在系统装备商店直接出售 */
  shopable: boolean
}

export const PET_EQUIPMENTS: readonly PetEquipmentDef[] = [
  // ---------- 武器 ----------
  {
    key: 'starter_claw',
    name: '新手爪套',
    emoji: '🐾',
    description: '召唤时赠送的旧爪套，虽然破旧但很合手',
    slot: 'weapon',
    rarity: 'common',
    price: 0,
    atk: 3,
    def: 0,
    hp: 0,
    spd: 0,
    crit: 0,
    minLevel: 1,
    bound: true,
    shopable: false,
  },
  {
    key: 'iron_blade',
    name: '铁齿短刃',
    emoji: '🗡️',
    description: '结实的小短刃，新手冒险的第一件正经武器',
    slot: 'weapon',
    rarity: 'rare',
    price: 260,
    atk: 8,
    def: 0,
    hp: 0,
    spd: 0,
    crit: 1,
    minLevel: 1,
    bound: false,
    shopable: true,
  },
  {
    key: 'flame_sword',
    name: '烈焰长剑',
    emoji: '🔥',
    description: '剑身缠绕着不灭的火焰，挥动时带起热浪',
    slot: 'weapon',
    rarity: 'epic',
    price: 900,
    atk: 15,
    def: 0,
    hp: 0,
    spd: 0,
    crit: 3,
    minLevel: 4,
    bound: false,
    shopable: false,
  },
  {
    key: 'void_scythe',
    name: '虚空镰刀',
    emoji: '🌌',
    description: '从虚空裂缝里捞出来的镰刀，刃口看不见却割得开一切',
    slot: 'weapon',
    rarity: 'legendary',
    price: 2200,
    atk: 24,
    def: 0,
    hp: 0,
    spd: 0,
    crit: 5,
    minLevel: 7,
    bound: false,
    shopable: false,
  },
  // ---------- 护甲 ----------
  {
    key: 'starter_vest',
    name: '新手布甲',
    emoji: '🧵',
    description: '召唤时赠送的布背心，聊胜于无',
    slot: 'armor',
    rarity: 'common',
    price: 0,
    atk: 0,
    def: 1,
    hp: 10,
    spd: 0,
    crit: 0,
    minLevel: 1,
    bound: true,
    shopable: false,
  },
  {
    key: 'leather_armor',
    name: '硬皮护甲',
    emoji: '🛡️',
    description: '鞣制过的硬皮，能挡下大多数抓挠',
    slot: 'armor',
    rarity: 'rare',
    price: 240,
    atk: 0,
    def: 5,
    hp: 20,
    spd: 0,
    crit: 0,
    minLevel: 1,
    bound: false,
    shopable: true,
  },
  {
    key: 'crystal_plate',
    name: '水晶板甲',
    emoji: '💎',
    description: '半透明的晶体护甲，又轻又硬',
    slot: 'armor',
    rarity: 'epic',
    price: 850,
    atk: 0,
    def: 12,
    hp: 50,
    spd: 0,
    crit: 0,
    minLevel: 4,
    bound: false,
    shopable: false,
  },
  {
    key: 'dragon_scale',
    name: '龙鳞战甲',
    emoji: '🐲',
    description: '用龙鳞一片片缝成的战甲，据说能扛住流星',
    slot: 'armor',
    rarity: 'legendary',
    price: 2000,
    atk: 0,
    def: 20,
    hp: 80,
    spd: 0,
    crit: 0,
    minLevel: 7,
    bound: false,
    shopable: false,
  },
  // ---------- 饰品 ----------
  {
    key: 'starter_bell',
    name: '新手铃铛',
    emoji: '🔔',
    description: '召唤时赠送的小铃铛，跑起来叮当响',
    slot: 'accessory',
    rarity: 'common',
    price: 0,
    atk: 0,
    def: 0,
    hp: 0,
    spd: 2,
    crit: 0,
    minLevel: 1,
    bound: true,
    shopable: false,
  },
  {
    key: 'swift_boots',
    name: '疾风靴',
    emoji: '👟',
    description: '轻得像没穿，跑起来只留下一道影子',
    slot: 'accessory',
    rarity: 'rare',
    price: 220,
    atk: 0,
    def: 0,
    hp: 0,
    spd: 6,
    crit: 0,
    minLevel: 1,
    bound: false,
    shopable: true,
  },
  {
    key: 'power_ring',
    name: '力量指环',
    emoji: '💍',
    description: '戴上后爪子会不自觉地想挥两下',
    slot: 'accessory',
    rarity: 'epic',
    price: 700,
    atk: 6,
    def: 0,
    hp: 0,
    spd: 0,
    crit: 2,
    minLevel: 3,
    bound: false,
    shopable: false,
  },
  {
    key: 'guardian_amulet',
    name: '守护护符',
    emoji: '🧿',
    description: '据说能在危急时刻替你挡下致命一击',
    slot: 'accessory',
    rarity: 'legendary',
    price: 1800,
    atk: 0,
    def: 8,
    hp: 30,
    spd: 3,
    crit: 0,
    minLevel: 6,
    bound: false,
    shopable: false,
  },
]

export const PET_EQUIPMENT_MAP: ReadonlyMap<string, PetEquipmentDef> = new Map(
  PET_EQUIPMENTS.map((item) => [item.key, item]),
)

/** Zod enum 用的装备 key 元组 */
export const PET_EQUIPMENT_KEYS = PET_EQUIPMENTS.map((item) => item.key) as [string, ...string[]]

export function getPetEquipment(key: string | null | undefined): PetEquipmentDef | null {
  if (!key) return null
  return PET_EQUIPMENT_MAP.get(key) ?? null
}

/** 新手装 key（召唤/补发时使用；绑定、不可掉落/交易） */
export const PET_STARTER_EQUIPMENT_KEYS: readonly string[] = PET_EQUIPMENTS
  .filter((item) => item.bound)
  .map((item) => item.key)

/** 系统装备商店可售项（普通/稀有） */
export const PET_SHOP_EQUIPMENTS: readonly PetEquipmentDef[] = PET_EQUIPMENTS.filter((item) => item.shopable)

/** 掉落池：非绑定装备（含史诗/传说，只能从战斗或交易行获得） */
export const PET_DROPPABLE_EQUIPMENTS: readonly PetEquipmentDef[] = PET_EQUIPMENTS.filter(
  (item) => !item.bound,
)

export const PET_EQUIPMENT_RARITY_LABELS: Readonly<Record<PetEquipmentRarity, string>> = {
  common: '普通',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
}

/** 装备战力粗估（用于交易行/背包展示排序，不参与战斗结算） */
export function equipmentPower(item: PetEquipmentDef): number {
  return Math.round(item.atk * 4 + item.def * 3 + item.hp * 0.5 + item.spd * 3 + item.crit * 5)
}
