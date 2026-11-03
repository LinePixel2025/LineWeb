/**
 * 搜打撤 v2 共享引擎（服务端唯一真相源，客户端保存逐字副本）。
 *
 * 设计口径（2026-11-03 重构）：
 *   - 玩法从「格子回合制 + 自动战斗」改为「元气骑士式实时房间制」：
 *     房间网格 + 生成树走廊 + 环路，进房锁门，清怪后开门，撤离房间读条撤离；
 *   - 敌人是会移动的实时单位（巡逻 / 追击 / 远程射击 / Boss 范围技），
 *     服务端只按 seed 重算地图与校验事件，不做逐帧物理；
 *   - 装备改为搜打撤专属：6 级头盔 / 护甲 / 战靴 + 背包 / 胸挂，
 *     头盔护甲有耐久（对齐三角洲行动），耐久归零即失去防护；
 *   - 容器三类：backpack（背包，任意物品）/ rig（胸挂，仅消耗品）/ safe（安全箱，阵亡保留）；
 *     撤离后物品留在容器里，必须手动存入仓库，仓库满不自动出售；
 *   - 本文件不 import 任何模块，保证 server 与 client 两份副本逐字一致。
 */

/* ============================================================
   基础类型
   ============================================================ */

export const RAID_STATE_VERSION = 3

export type RaidStatus = 'active' | 'extracted' | 'died' | 'mia' | 'abandoned'

export type RaidRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'

export type RaidItemKind = 'material' | 'consumable' | 'treasure' | 'gear_cache' | 'skill_cache'

export type RaidContainerKind = 'backpack' | 'rig' | 'safe'

export type RaidGearSlot = 'helmet' | 'armor' | 'boots' | 'backpack' | 'rig'

export type RaidEnemyKind = 'scout' | 'soldier' | 'elite' | 'boss'

export type RaidRoomKind = 'start' | 'combat' | 'elite' | 'boss' | 'loot' | 'hazard' | 'extract'

export type RaidDifficulty = 'normal' | 'hard' | 'extreme'

export const RAID_RARITY_LABELS: Readonly<Record<RaidRarity, string>> = {
  common: '普通',
  uncommon: '优良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  mythic: '神话',
}

export const RAID_RARITY_ORDER: readonly RaidRarity[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
]

export const RAID_CONTAINER_LABELS: Readonly<Record<RaidContainerKind, string>> = {
  backpack: '背包',
  rig: '胸挂',
  safe: '安全箱',
}

/* ============================================================
   物品目录（约 50 种，6 档品质）
   ============================================================ */

export interface RaidItemDef {
  key: string
  name: string
  emoji: string
  rarity: RaidRarity
  kind: RaidItemKind
  /** 单件目录价值（积分）：卖给官方商店的基准 */
  value: number
  /** 掉落权重 */
  weight: number
  /** 单格堆叠上限 */
  stackMax: number
  description: string
  /** 消耗品：回复最大 HP 百分比 */
  healPct?: number
  /** 消耗品：回复 MP */
  mpGain?: number
  /** 消耗品：维修量 */
  repairAmount?: number
  /** 消耗品：可维修的装备槽（helmet / armor） */
  repairSlot?: 'helmet' | 'armor'
  /** 装备箱：可开出的装备等级区间 */
  cacheTierMin?: number
  cacheTierMax?: number
}

export const RAID_ITEMS: readonly RaidItemDef[] = [
  // ---------- 普通（白） ----------
  { key: 'scrap_metal', name: '废金属块', emoji: '⚙️', rarity: 'common', kind: 'material', value: 35, weight: 16, stackMax: 5, description: '从废弃机械上拆下来的金属块，回收站永远收。' },
  { key: 'copper_wire', name: '铜线束', emoji: '🔌', rarity: 'common', kind: 'material', value: 50, weight: 18, stackMax: 5, description: '成捆的裸铜线，是电子垃圾里最实在的部分。' },
  { key: 'duct_tape', name: '军用胶带', emoji: '🧵', rarity: 'common', kind: 'material', value: 55, weight: 14, stackMax: 5, description: '灰色强力胶带，能粘住这世上大部分东西。' },
  { key: 'canned_food', name: '军用罐头', emoji: '🥫', rarity: 'common', kind: 'material', value: 60, weight: 18, stackMax: 3, description: '过期了也能吃，搜打撤人的蛋白质来源。' },
  { key: 'rag', name: '沾污纱布', emoji: '🧻', rarity: 'common', kind: 'material', value: 28, weight: 12, stackMax: 5, description: '还算干净的纱布，值不了几个钱。' },
  { key: 'old_watch', name: '旧怀表', emoji: '⌚', rarity: 'common', kind: 'material', value: 90, weight: 14, stackMax: 1, description: '表盘裂了，但机芯还在走。' },
  { key: 'ammo_box', name: '散装弹药', emoji: '📦', rarity: 'common', kind: 'material', value: 40, weight: 12, stackMax: 5, description: '来路不明的子弹，按斤卖。' },
  { key: 'fuel_can', name: '燃料桶', emoji: '⛽', rarity: 'common', kind: 'material', value: 70, weight: 10, stackMax: 2, description: '半桶柴油，味道刺鼻。' },
  { key: 'bandage', name: '绷带', emoji: '🩹', rarity: 'common', kind: 'consumable', value: 50, weight: 12, stackMax: 3, description: '简单包扎，回复 20% 最大生命。', healPct: 20 },
  { key: 'water_bottle', name: '净水壶', emoji: '💧', rarity: 'common', kind: 'consumable', value: 45, weight: 8, stackMax: 3, description: '干净的水，回复 25 点能量。', mpGain: 25 },
  { key: 'broken_scope', name: '破损瞄具', emoji: '🔭', rarity: 'common', kind: 'material', value: 65, weight: 12, stackMax: 2, description: '镜片裂了，但金属镜身还能卖钱。' },

  // ---------- 优良（绿） ----------
  { key: 'circuit_board', name: '军用电路板', emoji: '🧩', rarity: 'uncommon', kind: 'material', value: 190, weight: 14, stackMax: 3, description: '加密军用规格的电路板，拆解价值不低。' },
  { key: 'titanium_alloy', name: '钛合金部件', emoji: '🔩', rarity: 'uncommon', kind: 'material', value: 240, weight: 12, stackMax: 3, description: '轻得像塑料，硬得像石头。' },
  { key: 'laser_module', name: '激光模组', emoji: '🔦', rarity: 'uncommon', kind: 'material', value: 310, weight: 10, stackMax: 3, description: '从瞄准器里拆出来的核心模组。' },
  { key: 'medkit', name: '急救包', emoji: '🩹', rarity: 'uncommon', kind: 'consumable', value: 120, weight: 12, stackMax: 2, description: '标准急救包，回复 35% 最大生命。', healPct: 35 },
  { key: 'energy_drink', name: '能量饮料', emoji: '🥤', rarity: 'uncommon', kind: 'consumable', value: 90, weight: 9, stackMax: 3, description: '一口下去精神百倍，回复 40 点能量。', mpGain: 40 },
  { key: 'adrenaline', name: '肾上腺素', emoji: '💉', rarity: 'uncommon', kind: 'consumable', value: 150, weight: 7, stackMax: 2, description: '战地急救针，回复 15% 生命与 30 点能量。', healPct: 15, mpGain: 30 },
  { key: 'toolbox', name: '精密工具箱', emoji: '🧰', rarity: 'uncommon', kind: 'material', value: 180, weight: 10, stackMax: 2, description: '一整套校准工具，少了两把螺丝刀。' },
  { key: 'field_radio', name: '野战电台', emoji: '📻', rarity: 'uncommon', kind: 'material', value: 220, weight: 8, stackMax: 2, description: '还能收到加密频道，杂音很大。' },
  { key: 'night_lens', name: '夜视镜片', emoji: '🕶️', rarity: 'uncommon', kind: 'material', value: 280, weight: 8, stackMax: 3, description: '从损坏的夜视仪上拆下来的镜片。' },
  { key: 'gold_coin', name: '金币袋', emoji: '🪙', rarity: 'uncommon', kind: 'treasure', value: 300, weight: 8, stackMax: 3, description: '不知道谁藏起来的旧金币，商人照收。' },
  { key: 'gold_tooth', name: '金牙', emoji: '🦷', rarity: 'rare', kind: 'treasure', value: 380, weight: 8, stackMax: 3, description: '从某个倒霉蛋嘴里掉出来的，成色不错。' },
  { key: 'gear_cache', name: '装备箱', emoji: '🧰', rarity: 'uncommon', kind: 'gear_cache', value: 260, weight: 7, stackMax: 1, description: '可能开出一件 2–3 级装备。', cacheTierMin: 2, cacheTierMax: 3 },

  // ---------- 稀有（蓝） ----------
  { key: 'encrypted_drive', name: '加密硬盘', emoji: '💾', rarity: 'rare', kind: 'material', value: 420, weight: 11, stackMax: 2, description: '里面的数据没人敢读，但有人愿意买。' },
  { key: 'precision_gear', name: '精密齿轮', emoji: '⚙️', rarity: 'rare', kind: 'material', value: 380, weight: 10, stackMax: 3, description: '公差极小的传动齿轮，工业线抢着要。' },
  { key: 'experimental_reagent', name: '实验试剂', emoji: '🧪', rarity: 'rare', kind: 'material', value: 460, weight: 9, stackMax: 2, description: '贴着生化危险标签的玻璃瓶。' },
  { key: 'armor_plate', name: '复合装甲板', emoji: '🛡️', rarity: 'rare', kind: 'material', value: 500, weight: 8, stackMax: 2, description: '能挡住步枪弹的陶瓷复合板。' },
  { key: 'medkit_plus', name: '强效医疗箱', emoji: '🧰', rarity: 'rare', kind: 'consumable', value: 320, weight: 7, stackMax: 1, description: '战地手术级医疗箱，回复 60% 最大生命。', healPct: 60 },
  { key: 'helmet_repair', name: '头修包', emoji: '🪖', rarity: 'rare', kind: 'consumable', value: 240, weight: 8, stackMax: 2, description: '修复头盔耐久 60 点，但会永久降低耐久上限。', repairAmount: 60, repairSlot: 'helmet' },
  { key: 'armor_repair', name: '甲修包', emoji: '🦺', rarity: 'rare', kind: 'consumable', value: 280, weight: 8, stackMax: 2, description: '修复护甲耐久 80 点，但会永久降低耐久上限。', repairAmount: 80, repairSlot: 'armor' },
  { key: 'intel_folder', name: '情报档案', emoji: '📁', rarity: 'rare', kind: 'material', value: 440, weight: 8, stackMax: 2, description: '盖着红章的纸质档案，比硬盘更值钱。' },
  { key: 'skill_scroll', name: '技能卷轴', emoji: '📜', rarity: 'rare', kind: 'skill_cache', value: 360, weight: 6, stackMax: 1, description: '开启后随机获得一个宠物技能（低阶）。', cacheTierMin: 1, cacheTierMax: 3 },
  { key: 'gear_cache_rare', name: '精良装备箱', emoji: '🗃️', rarity: 'rare', kind: 'gear_cache', value: 520, weight: 6, stackMax: 1, description: '可能开出一件 3–4 级装备。', cacheTierMin: 3, cacheTierMax: 4 },

  // ---------- 史诗（紫） ----------
  { key: 'gold_compass', name: '黄金罗盘', emoji: '🧭', rarity: 'epic', kind: 'material', value: 650, weight: 6, stackMax: 1, description: '指针早就失灵了，但金子是真的。' },
  { key: 'experiment_data', name: '实验数据', emoji: '📊', rarity: 'epic', kind: 'material', value: 820, weight: 5, stackMax: 1, description: '一整柜的原始实验记录。' },
  { key: 'plasma_core', name: '等离子核心', emoji: '🔮', rarity: 'epic', kind: 'material', value: 760, weight: 5, stackMax: 2, description: '拆自重型武器的能量核心，仍有余温。' },
  { key: 'ai_chip', name: '智能芯片', emoji: '🧠', rarity: 'epic', kind: 'material', value: 920, weight: 4, stackMax: 1, description: '算力惊人的军用 AI 芯片。' },
  { key: 'relic_drive', name: '古代存储核心', emoji: '💽', rarity: 'epic', kind: 'material', value: 1100, weight: 3, stackMax: 1, description: '接口不属于任何已知标准。' },
  { key: 'armor_plate_heavy', name: '重型装甲板', emoji: '🧱', rarity: 'epic', kind: 'material', value: 900, weight: 4, stackMax: 1, description: '外骨骼用的整块装甲。' },
  { key: 'gear_cache_epic', name: '史诗装备箱', emoji: '🎁', rarity: 'epic', kind: 'gear_cache', value: 1200, weight: 4, stackMax: 1, description: '可能开出一件 4–5 级装备。', cacheTierMin: 4, cacheTierMax: 5 },
  { key: 'skill_scroll_epic', name: '高阶技能卷轴', emoji: '📖', rarity: 'epic', kind: 'skill_cache', value: 980, weight: 3, stackMax: 1, description: '开启后随机获得一个中高阶宠物技能。', cacheTierMin: 4, cacheTierMax: 6 },
  { key: 'seed_pack_rare', name: '珍稀种子包', emoji: '🌿', rarity: 'epic', kind: 'treasure', value: 700, weight: 3, stackMax: 2, description: '密封的种子袋，农场主愿意出高价。' },
  { key: 'modern_art', name: '现代画作', emoji: '🖼️', rarity: 'epic', kind: 'treasure', value: 780, weight: 3, stackMax: 1, description: '看不懂，但收藏家抢着要。' },

  // ---------- 传说（橙） ----------
  { key: 'black_box', name: '黑匣子', emoji: '📦', rarity: 'legendary', kind: 'material', value: 1800, weight: 2, stackMax: 1, description: '坠毁飞行器的最后记录仪。' },
  { key: 'dragon_shard', name: '龙鳞碎片', emoji: '🐲', rarity: 'legendary', kind: 'material', value: 2400, weight: 1, stackMax: 1, description: '硬得不像自然界的东西。' },
  { key: 'quantum_battery', name: '量子电池', emoji: '🔋', rarity: 'legendary', kind: 'material', value: 2000, weight: 2, stackMax: 1, description: '体积很小，能量密度高得离谱。' },
  { key: 'gold_statue', name: '纯金神像', emoji: '🗿', rarity: 'legendary', kind: 'material', value: 2300, weight: 1, stackMax: 1, description: '沉甸甸的一座小金像。' },
  { key: 'relic_cache', name: '遗物箱', emoji: '🗃️', rarity: 'legendary', kind: 'gear_cache', value: 2600, weight: 2, stackMax: 1, description: '可能开出一件 5–6 级装备。', cacheTierMin: 5, cacheTierMax: 6 },
  { key: 'ancient_scroll', name: '远古卷轴', emoji: '📜', rarity: 'legendary', kind: 'skill_cache', value: 2200, weight: 1, stackMax: 1, description: '开启后随机获得一个高阶宠物技能。', cacheTierMin: 7, cacheTierMax: 10 },

  // ---------- 神话（红） ----------
  { key: 'gear_cache_mythic', name: '深渊装备箱', emoji: '🧿', rarity: 'mythic', kind: 'gear_cache', value: 5600, weight: 1, stackMax: 1, description: '可能开出一件 6–8 级装备，巨型背包只在最深处出现。', cacheTierMin: 6, cacheTierMax: 8 },
  { key: 'heart_of_africa', name: '非洲之心', emoji: '💎', rarity: 'mythic', kind: 'material', value: 9999, weight: 1, stackMax: 1, description: '传说中的巨钻，只在最深处出现。' },
  { key: 'abyss_core', name: '深渊核心', emoji: '🌌', rarity: 'mythic', kind: 'material', value: 6800, weight: 1, stackMax: 1, description: '不断吞噬光线的黑色球体。' },
]

export const RAID_ITEM_MAP: ReadonlyMap<string, RaidItemDef> = new Map(
  RAID_ITEMS.map((item) => [item.key, item]),
)

export function getRaidItem(key: string | null | undefined): RaidItemDef | null {
  if (!key) return null
  return RAID_ITEM_MAP.get(key) ?? null
}

/** 单件目录价值（未知物品按 0 计） */
export function raidItemValue(itemKey: string): number {
  return RAID_ITEM_MAP.get(itemKey)?.value ?? 0
}

/** 官方商店回收价：材料/珍宝 100%，装备箱/技能卷轴 70%，消耗品 60% */
export function raidSellPrice(itemKey: string, amount: number): number {
  const def = RAID_ITEM_MAP.get(itemKey)
  if (!def) return 0
  const clean = Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : 0
  const rate = def.kind === 'material' || def.kind === 'treasure'
    ? 1
    : def.kind === 'consumable'
      ? 0.6
      : 0.7
  return Math.max(0, Math.floor(def.value * rate)) * clean
}

/** 官方商店售价（物品）：消耗品 / 箱子按目录价值 140% 向上取整 */
export function raidShopItemPrice(itemKey: string): number {
  const def = RAID_ITEM_MAP.get(itemKey)
  if (!def) return 0
  return Math.max(1, Math.ceil(def.value * 1.4))
}

/** 官方商店售价（装备）：目录价 */
export function raidShopGearPrice(gearKey: string): number {
  const def = RAID_GEAR_MAP.get(gearKey)
  if (!def) return 0
  return Math.max(1, def.price)
}

/* ============================================================
   装备目录（6 级头 / 甲 / 鞋 + 背包 + 胸挂）
   ============================================================ */

export interface RaidGearDef {
  key: string
  name: string
  emoji: string
  slot: RaidGearSlot
  /** 1–6 级（背包 / 胸挂按容量分 6 档） */
  tier: number
  rarity: RarityGearTier
  price: number
  description: string
  /** 头盔 / 护甲：减伤百分比 */
  defense?: number
  /** 头盔 / 护甲：初始耐久上限 */
  maxDurability?: number
  /** 战靴：移动速度加成百分比 */
  speedBonus?: number
  /** 背包 / 胸挂：格数 */
  slots?: number
  /** 官方商店是否出售（1–3 级） */
  shopable: boolean
}

/** 装备品级与物品品质一一对应（1 普通 … 6 神话） */
export type RarityGearTier = RaidRarity

const GEAR_RARITY_BY_TIER: readonly RarityGearTier[] = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
  'mythic',
]

export const RAID_GEAR_TIER_LABEL = (tier: number): string => `${tier} 级`

export const RAID_GEARS: readonly RaidGearDef[] = [
  // ---------- 头盔 ----------
  { key: 'helmet_t1', name: '战术软帽', emoji: '🧢', slot: 'helmet', tier: 1, rarity: GEAR_RARITY_BY_TIER[0], price: 150, description: '聊胜于无的软质护头，能挡飞溅的碎石。', defense: 8, maxDurability: 40, shopable: true },
  { key: 'helmet_t2', name: '防弹头套', emoji: '🪖', slot: 'helmet', tier: 2, rarity: GEAR_RARITY_BY_TIER[1], price: 400, description: '带护耳的基础防弹头套。', defense: 14, maxDurability: 55, shopable: true },
  { key: 'helmet_t3', name: '钢制头盔', emoji: '⛑️', slot: 'helmet', tier: 3, rarity: GEAR_RARITY_BY_TIER[2], price: 900, description: '沉重的钢盔，挡得住手枪弹。', defense: 20, maxDurability: 70, shopable: true },
  { key: 'helmet_t4', name: '复合防弹盔', emoji: '🪖', slot: 'helmet', tier: 4, rarity: GEAR_RARITY_BY_TIER[3], price: 1800, description: '陶瓷复合盔，重量与防护兼顾。', defense: 26, maxDurability: 90, shopable: false },
  { key: 'helmet_t5', name: '陶瓷重盔', emoji: '🛡️', slot: 'helmet', tier: 5, rarity: GEAR_RARITY_BY_TIER[4], price: 3200, description: '重装部队的制式头盔，正面能扛步枪弹。', defense: 32, maxDurability: 110, shopable: false },
  { key: 'helmet_t6', name: '外骨骼头盔', emoji: '🤖', slot: 'helmet', tier: 6, rarity: GEAR_RARITY_BY_TIER[5], price: 5200, description: '带神经接口的外骨骼头盔，防护拉满。', defense: 38, maxDurability: 130, shopable: false },

  // ---------- 护甲 ----------
  { key: 'armor_t1', name: '轻型防弹衣', emoji: '🦺', slot: 'armor', tier: 1, rarity: GEAR_RARITY_BY_TIER[0], price: 200, description: '薄薄一层凯夫拉，主要防流弹。', defense: 12, maxDurability: 60, shopable: true },
  { key: 'armor_t2', name: '防弹插板衣', emoji: '🦺', slot: 'armor', tier: 2, rarity: GEAR_RARITY_BY_TIER[1], price: 500, description: '前后各一块陶瓷插板。', defense: 19, maxDurability: 80, shopable: true },
  { key: 'armor_t3', name: '战术重甲', emoji: '🥋', slot: 'armor', tier: 3, rarity: GEAR_RARITY_BY_TIER[2], price: 1100, description: '覆盖躯干的重型战术甲。', defense: 26, maxDurability: 100, shopable: true },
  { key: 'armor_t4', name: '复合装甲', emoji: '🛡️', slot: 'armor', tier: 4, rarity: GEAR_RARITY_BY_TIER[3], price: 2100, description: '多层复合装甲，兼顾灵活与防护。', defense: 33, maxDurability: 125, shopable: false },
  { key: 'armor_t5', name: '重型战术甲', emoji: '🧱', slot: 'armor', tier: 5, rarity: GEAR_RARITY_BY_TIER[4], price: 3600, description: '重装突袭队的标志性装备。', defense: 40, maxDurability: 150, shopable: false },
  { key: 'armor_t6', name: '外骨骼装甲', emoji: '🤖', slot: 'armor', tier: 6, rarity: GEAR_RARITY_BY_TIER[5], price: 5800, description: '与动力外骨骼一体的整块装甲。', defense: 47, maxDurability: 180, shopable: false },

  // ---------- 战靴 ----------
  { key: 'boots_t1', name: '轻便战靴', emoji: '🥾', slot: 'boots', tier: 1, rarity: GEAR_RARITY_BY_TIER[0], price: 120, description: '鞋底很软，跑起来不累。', speedBonus: 3, shopable: true },
  { key: 'boots_t2', name: '战术军靴', emoji: '🥾', slot: 'boots', tier: 2, rarity: GEAR_RARITY_BY_TIER[1], price: 320, description: '防滑、耐磨、绑带很紧。', speedBonus: 6, shopable: true },
  { key: 'boots_t3', name: '突击靴', emoji: '👟', slot: 'boots', tier: 3, rarity: GEAR_RARITY_BY_TIER[2], price: 700, description: '为快速突入设计的轻量靴。', speedBonus: 9, shopable: true },
  { key: 'boots_t4', name: '疾行战靴', emoji: '🥿', slot: 'boots', tier: 4, rarity: GEAR_RARITY_BY_TIER[3], price: 1400, description: '鞋底藏着弹性储能结构。', speedBonus: 12, shopable: false },
  { key: 'boots_t5', name: '磁暴战靴', emoji: '⚡', slot: 'boots', tier: 5, rarity: GEAR_RARITY_BY_TIER[4], price: 2400, description: '磁力辅助迈步，几乎感觉不到重量。', speedBonus: 15, shopable: false },
  { key: 'boots_t6', name: '相位战靴', emoji: '✨', slot: 'boots', tier: 6, rarity: GEAR_RARITY_BY_TIER[5], price: 4000, description: '每一步都像踩在空气上。', speedBonus: 18, shopable: false },

  // ---------- 背包 ----------
  { key: 'backpack_t1', name: '小型背包', emoji: '🎒', slot: 'backpack', tier: 1, rarity: GEAR_RARITY_BY_TIER[0], price: 300, description: '8 格容量，装点零碎刚好。', slots: 8, shopable: true },
  { key: 'backpack_t2', name: '战术背包', emoji: '🎒', slot: 'backpack', tier: 2, rarity: GEAR_RARITY_BY_TIER[1], price: 700, description: '12 格容量，带侧袋。', slots: 12, shopable: true },
  { key: 'backpack_t3', name: '突击背包', emoji: '🎒', slot: 'backpack', tier: 3, rarity: GEAR_RARITY_BY_TIER[2], price: 1500, description: '16 格容量，突击队标准配置。', slots: 16, shopable: true },
  { key: 'backpack_t4', name: '远征背包', emoji: '🎒', slot: 'backpack', tier: 4, rarity: GEAR_RARITY_BY_TIER[3], price: 2800, description: '20 格容量，适合长时间搜刮。', slots: 20, shopable: false },
  { key: 'backpack_t5', name: '重装载具', emoji: '🧳', slot: 'backpack', tier: 5, rarity: GEAR_RARITY_BY_TIER[4], price: 4500, description: '24 格容量，像个移动仓库。', slots: 24, shopable: false },
  { key: 'backpack_t6', name: '外骨骼载具', emoji: '🧳', slot: 'backpack', tier: 6, rarity: GEAR_RARITY_BY_TIER[5], price: 7000, description: '28 格容量，外骨骼直接承重。', slots: 28, shopable: false },
  { key: 'backpack_t7', name: '深渊驮包', emoji: '🛄', slot: 'backpack', tier: 7, rarity: GEAR_RARITY_BY_TIER[5], price: 10000, description: '36 格容量，深渊实验室的秘密制式。', slots: 36, shopable: false },
  { key: 'backpack_t8', name: '移动武库', emoji: '🧰', slot: 'backpack', tier: 8, rarity: GEAR_RARITY_BY_TIER[5], price: 15000, description: '48 格容量，一个人就是一支运输队。', slots: 48, shopable: false },

  // ---------- 胸挂 ----------
  { key: 'rig_t1', name: '简易胸挂', emoji: '🎽', slot: 'rig', tier: 1, rarity: GEAR_RARITY_BY_TIER[0], price: 200, description: '2 格快取位，取用最顺手。', slots: 2, shopable: true },
  { key: 'rig_t2', name: '战术胸挂', emoji: '🎽', slot: 'rig', tier: 2, rarity: GEAR_RARITY_BY_TIER[1], price: 450, description: '3 格快取位，取用顺手。', slots: 3, shopable: true },
  { key: 'rig_t3', name: '突击胸挂', emoji: '🦺', slot: 'rig', tier: 3, rarity: GEAR_RARITY_BY_TIER[2], price: 900, description: '4 格快取位，突击队制式。', slots: 4, shopable: true },
  { key: 'rig_t4', name: '特战胸挂', emoji: '🦺', slot: 'rig', tier: 4, rarity: GEAR_RARITY_BY_TIER[3], price: 1700, description: '5 格快取位，模块化挂载。', slots: 5, shopable: false },
  { key: 'rig_t5', name: '重装胸挂', emoji: '🧥', slot: 'rig', tier: 5, rarity: GEAR_RARITY_BY_TIER[4], price: 3000, description: '6 格快取位，重装部队专供。', slots: 6, shopable: false },
  { key: 'rig_t6', name: '外骨骼胸挂', emoji: '🤖', slot: 'rig', tier: 6, rarity: GEAR_RARITY_BY_TIER[5], price: 4800, description: '7 格快取位，与动力系统联动。', slots: 7, shopable: false },
]

export const RAID_GEAR_MAP: ReadonlyMap<string, RaidGearDef> = new Map(
  RAID_GEARS.map((gear) => [gear.key, gear]),
)

export function getRaidGear(key: string | null | undefined): RaidGearDef | null {
  if (!key) return null
  return RAID_GEAR_MAP.get(key) ?? null
}

/** 按槽位与等级筛选（客户端商店 / 装备箱展示用） */
export function raidGearsOf(slot: RaidGearSlot, tiers?: readonly number[]): readonly RaidGearDef[] {
  return RAID_GEARS.filter((gear) => gear.slot === slot && (!tiers || tiers.includes(gear.tier)))
}

/* ============================================================
   地图定义
   ============================================================ */

export interface RaidMapDef {
  key: string
  name: string
  emoji: string
  description: string
  difficulty: RaidDifficulty
  /** 房间网格列数 / 行数 */
  cols: number
  rows: number
  /** 敌人预算（实际生成会按房间类型分配） */
  enemyBudget: number
  bossRooms: number
  eliteRooms: number
  lootRooms: number
  hazardRooms: number
  extractRooms: number
  /** 进入门票（积分） */
  entryCost: number
  recommendLevel: number
  /** 战利品档次 1–5 */
  lootTier: number
  color: string
  /** 敌人基础等级 */
  enemyLevel: number
  /** 单局时间上限（毫秒） */
  durationMs: number
}

export const RAID_MAPS: readonly RaidMapDef[] = [
  {
    key: 'wasteland',
    name: '废弃农场',
    emoji: '🌾',
    description: '低风险拾荒场，房间不多，适合第一次带宠物出门。',
    difficulty: 'normal',
    cols: 3,
    rows: 3,
    enemyBudget: 12,
    bossRooms: 0,
    eliteRooms: 0,
    lootRooms: 2,
    hazardRooms: 1,
    extractRooms: 1,
    entryCost: 0,
    recommendLevel: 1,
    lootTier: 1,
    color: '#6a994e',
    enemyLevel: 2,
    durationMs: 15 * 60_000,
  },
  {
    key: 'dam',
    name: '零号大坝',
    emoji: '🌉',
    description: '废弃水利枢纽，巡逻队与拾荒者混杂，物资更值钱。',
    difficulty: 'normal',
    cols: 3,
    rows: 4,
    enemyBudget: 20,
    bossRooms: 1,
    eliteRooms: 1,
    lootRooms: 2,
    hazardRooms: 1,
    extractRooms: 2,
    entryCost: 80,
    recommendLevel: 3,
    lootTier: 2,
    color: '#3d7ea6',
    enemyLevel: 5,
    durationMs: 18 * 60_000,
  },
  {
    key: 'valley',
    name: '长弓溪谷',
    emoji: '🏞️',
    description: '狭长山谷里的军需仓库，精英守卫密度高，别贪最后一个箱子。',
    difficulty: 'hard',
    cols: 4,
    rows: 4,
    enemyBudget: 29,
    bossRooms: 1,
    eliteRooms: 2,
    lootRooms: 3,
    hazardRooms: 2,
    extractRooms: 2,
    entryCost: 200,
    recommendLevel: 5,
    lootTier: 3,
    color: '#8a5a44',
    enemyLevel: 7,
    durationMs: 20 * 60_000,
  },
  {
    key: 'space',
    name: '航天基地',
    emoji: '🚀',
    description: '高危禁区，重装守卫与首领坐镇，传说级战利品稳定出现。',
    difficulty: 'extreme',
    cols: 4,
    rows: 4,
    enemyBudget: 36,
    bossRooms: 1,
    eliteRooms: 3,
    lootRooms: 3,
    hazardRooms: 2,
    extractRooms: 2,
    entryCost: 500,
    recommendLevel: 8,
    lootTier: 4,
    color: '#5b4b8a',
    enemyLevel: 10,
    durationMs: 22 * 60_000,
  },
  {
    key: 'fungal',
    name: '孢子雨林',
    emoji: '🍄',
    description: '被孢子云笼罩的原始雨林，双首领坐镇，样本与合金散落其间。',
    difficulty: 'hard',
    cols: 4,
    rows: 5,
    enemyBudget: 34,
    bossRooms: 2,
    eliteRooms: 2,
    lootRooms: 3,
    hazardRooms: 3,
    extractRooms: 2,
    entryCost: 320,
    recommendLevel: 6,
    lootTier: 4,
    color: '#4a7c59',
    enemyLevel: 8,
    durationMs: 21 * 60_000,
  },
  {
    key: 'abyss',
    name: '深渊实验室',
    emoji: '🧪',
    description: '深埋地下的禁忌实验设施，重装守卫密布，非洲之心只在这里出现。',
    difficulty: 'extreme',
    cols: 5,
    rows: 5,
    enemyBudget: 44,
    bossRooms: 2,
    eliteRooms: 4,
    lootRooms: 4,
    hazardRooms: 3,
    extractRooms: 3,
    entryCost: 900,
    recommendLevel: 10,
    lootTier: 5,
    color: '#2b3a67',
    enemyLevel: 13,
    durationMs: 26 * 60_000,
  },
]

export const RAID_MAP_MAP: ReadonlyMap<string, RaidMapDef> = new Map(
  RAID_MAPS.map((map) => [map.key, map]),
)

export function getRaidMap(key: string | null | undefined): RaidMapDef | null {
  if (!key) return null
  return RAID_MAP_MAP.get(key) ?? null
}

/* ============================================================
   全局常量
   ============================================================ */

/** 单个房间的瓦片尺寸（含四周墙体） */
export const RAID_ROOM_W = 17
export const RAID_ROOM_H = 13
/** 房间内部可走区域（去掉一圈墙） */
export const RAID_ROOM_INNER_W = RAID_ROOM_W - 2
export const RAID_ROOM_INNER_H = RAID_ROOM_H - 2

export const RAID_TILE_WALL = 0
export const RAID_TILE_FLOOR = 1
export const RAID_TILE_DOOR = 2
export const RAID_TILE_HAZARD = 3

/** 撤离读条（毫秒） */
export const RAID_EXTRACT_CHANNEL_MS = 6000
/** 技能冷却：每「回合」折算 2500ms */
export const RAID_SKILL_CD_MS = 2500
/** MP 每秒回复（实时对局节奏快，回复过低会让高费技能形同虚设） */
export const RAID_MP_REGEN_PER_SEC = 4
/** 行动日志上限 */
export const RAID_LOG_LIMIT = 40
/** 耐久损耗系数：每次受击掉 raw × 0.25 点耐久（约 4 发打空 1 级甲） */
export const RAID_DURABILITY_LOSS_RATE = 0.25
/** 维修后耐久上限衰减到 95%，且不低于初始上限的 30% */
export const RAID_REPAIR_MAX_DECAY = 0.95
export const RAID_REPAIR_FLOOR_RATIO = 0.3

/* ============================================================
   随机数（mulberry32）
   ============================================================ */

export type RaidRng = () => number

export function createRaidRng(seed: number): RaidRng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 由主 seed 派生独立随机流，避免不同系统互相干扰 */
export function raidSubSeed(seed: number, salt: string): number {
  let hash = (seed >>> 0) ^ 0x9e3779b9
  for (let i = 0; i < salt.length; i += 1) {
    hash ^= salt.charCodeAt(i)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash >>> 0
}

function rngInt(rng: RaidRng, min: number, max: number): number {
  if (max <= min) return min
  return min + Math.floor(rng() * (max - min + 1))
}

function rngPick<T>(rng: RaidRng, list: readonly T[]): T {
  return list[Math.min(list.length - 1, Math.floor(rng() * list.length))] as T
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

/* ============================================================
   地图生成
   ============================================================ */

export interface RaidLootStack {
  /** 容器内唯一 id（同容器内 loot-0 / loot-1 …） */
  id: string
  itemKey: string
  amount: number
}

export interface RaidContainerNode {
  id: string
  roomId: number
  x: number
  y: number
  loot: RaidLootStack[]
}

export interface RaidEnemyNode {
  id: string
  roomId: number
  kind: RaidEnemyKind
  name: string
  level: number
  maxHp: number
  damage: number
  speed: number
  radius: number
  ranged: boolean
  /** 出生点（房间内瓦片坐标） */
  x: number
  y: number
  skills: string[]
}

export interface RaidRoomNode {
  id: number
  row: number
  col: number
  kind: RaidRoomKind
  /** 房间在整张瓦片地图中的左上角（含墙） */
  x: number
  y: number
  w: number
  h: number
  neighbors: number[]
  enemies: RaidEnemyNode[]
  containers: RaidContainerNode[]
}

export interface RaidDoorNode {
  /** 门的中心瓦片坐标 */
  x: number
  y: number
  roomA: number
  roomB: number
}

export interface RaidExtractPoint {
  roomId: number
  x: number
  y: number
}

export interface RaidMapNode {
  key: string
  name: string
  emoji: string
  difficulty: RaidDifficulty
  cols: number
  rows: number
  width: number
  height: number
  tiles: number[]
  rooms: RaidRoomNode[]
  doors: RaidDoorNode[]
  extracts: RaidExtractPoint[]
  startRoom: number
}

export function raidTileIndex(width: number, x: number, y: number): number {
  return y * width + x
}

function fillRect(
  tiles: number[],
  width: number,
  x: number,
  y: number,
  w: number,
  h: number,
  value: number,
): void {
  for (let yy = y; yy < y + h; yy += 1) {
    for (let xx = x; xx < x + w; xx += 1) {
      tiles[raidTileIndex(width, xx, yy)] = value
    }
  }
}

function roomCenter(room: RaidRoomNode): { x: number; y: number } {
  return {
    x: room.x + Math.floor(room.w / 2),
    y: room.y + Math.floor(room.h / 2),
  }
}

function roomInnerTiles(room: RaidRoomNode): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = []
  for (let y = room.y + 2; y < room.y + room.h - 2; y += 1) {
    for (let x = room.x + 2; x < room.x + room.w - 2; x += 1) {
      out.push({ x, y })
    }
  }
  return out
}

/** 品质权重（按地图 lootTier 1–5） */
const RARITY_TIER_WEIGHTS: Readonly<Record<RaidRarity, readonly number[]>> = {
  common: [60, 44, 30, 20, 12],
  uncommon: [26, 30, 28, 24, 20],
  rare: [10, 17, 24, 26, 25],
  epic: [3, 7, 13, 19, 24],
  legendary: [1, 2, 5, 11, 15],
  mythic: [0, 0, 0, 0, 4],
}

export function rarityWeightAtTier(rarity: RaidRarity, tier: number): number {
  const index = clampInt(tier, 1, 5) - 1
  return RARITY_TIER_WEIGHTS[rarity][index] ?? 0
}

/** 按地图档次掷一个物品（只考虑 weight > 0 且有品质权重的条目） */
export function rollRaidItemKey(rng: RaidRng, lootTier: number): string {
  const candidates = RAID_ITEMS.filter((item) => rarityWeightAtTier(item.rarity, lootTier) > 0)
  let total = 0
  for (const item of candidates) {
    total += item.weight * rarityWeightAtTier(item.rarity, lootTier)
  }
  if (total <= 0) return 'scrap_metal'
  let roll = rng() * total
  for (const item of candidates) {
    roll -= item.weight * rarityWeightAtTier(item.rarity, lootTier)
    if (roll <= 0) return item.key
  }
  return candidates[candidates.length - 1]?.key ?? 'scrap_metal'
}

/** 开箱：随机 1–3 段掉落（Boss 房容器至少 2 段且第一段偏高阶） */
export function rollRaidContainerLoot(
  seed: number,
  containerId: string,
  lootTier: number,
  bossRoom: boolean,
): RaidLootStack[] {
  const rng = createRaidRng(raidSubSeed(seed, `loot:${containerId}`))
  const count = bossRoom ? rngInt(rng, 2, 4) : rngInt(rng, 1, 3)
  const stacks: RaidLootStack[] = []
  for (let i = 0; i < count; i += 1) {
    let itemKey = rollRaidItemKey(rng, lootTier)
    if (bossRoom && i === 0) {
      // Boss 房首段保底：优先史诗以上（tier 4/5 图更容易出传说）
      const highTier = lootTier >= 4
      const pool = RAID_ITEMS.filter((item) => {
        const rank = RAID_RARITY_ORDER.indexOf(item.rarity)
        return highTier ? rank >= 3 : rank >= 2
      })
      if (pool.length > 0) itemKey = rngPick(rng, pool).key
    }
    const def = RAID_ITEM_MAP.get(itemKey)
    const stackMax = def?.stackMax ?? 1
    const amount = stackMax > 1 ? rngInt(rng, 1, Math.min(3, stackMax)) : 1
    stacks.push({ id: `loot-${i}`, itemKey, amount })
  }
  return stacks
}

const ENEMY_NAME_POOL: Readonly<Record<RaidEnemyKind, readonly string[]>> = {
  scout: ['拾荒斥候', '流亡侦察兵', '孢子游荡者'],
  soldier: ['武装护卫', '巡逻队员', '实验体守卫'],
  elite: ['精锐队长', '重装渗透者', '变异猎手'],
  boss: ['区域指挥官', '深渊守望者', '雨林母体'],
}

const ENEMY_EMOJI_POOL: Readonly<Record<RaidEnemyKind, readonly string[]>> = {
  scout: ['🏃', '🥷', '👤'],
  soldier: ['🔫', '🪖', '🥷'],
  elite: ['🛡️', '🦾', '👹'],
  boss: ['👑', '👹', '🦖'],
}

export function createRaidEnemy(
  seed: number,
  roomId: number,
  index: number,
  kind: RaidEnemyKind,
  enemyLevel: number,
  x: number,
  y: number,
): RaidEnemyNode {
  const rng = createRaidRng(raidSubSeed(seed, `enemy:${roomId}:${index}`))
  const kindOffset = kind === 'boss' ? 6 : kind === 'elite' ? 3 : kind === 'soldier' ? 1 : 0
  const level = clampInt(enemyLevel + kindOffset + rngInt(rng, 0, 1), 1, 30)
  // 2026-11-03 增强守卫战斗力：血量 / 伤害整体上调，远程占比提高，逼玩家用走位与技能周旋
  const hpMult = kind === 'boss' ? 5.0 : kind === 'elite' ? 2.4 : 1.2
  const damageMult = kind === 'boss' ? 1.8 : kind === 'elite' ? 1.45 : 1.15
  const maxHp = Math.round((40 + level * 10) * hpMult)
  // 实时战斗节奏：单发伤害压低、靠走位与技能周旋，避免一进房就被集火秒杀
  const damage = Math.max(2, Math.round((4 + level * 1.05) * damageMult))
  const speed = kind === 'boss' ? 1.1 : kind === 'elite' ? 1.6 : kind === 'scout' ? 2.2 : 1.8
  const ranged = kind === 'boss' || kind === 'elite' ? true : rng() < (kind === 'scout' ? 0.85 : 0.65)
  const skills = kind === 'boss'
    ? ['burst']
    : kind === 'elite'
      ? ['charge']
      : []
  return {
    id: `e-${roomId}-${index}`,
    roomId,
    kind,
    name: rngPick(rng, ENEMY_NAME_POOL[kind]),
    level,
    maxHp,
    damage,
    speed,
    radius: kind === 'boss' ? 0.85 : kind === 'elite' ? 0.55 : 0.45,
    ranged,
    x,
    y,
    skills,
  }
}

/**
 * 生成整张搜打撤地图（确定性：同一 seed + 同一地图必然得到完全一致的结果）。
 *
 * 步骤：房间网格 → 生成树连通 + 环路 → 挖房间与走廊 → 分配房间类型 →
 *       放置敌人 / 容器 / 撤离点（全部由派生随机流驱动）。
 */
export function generateRaidMap(seed: number, map: RaidMapDef): RaidMapNode {
  const cols = clampInt(map.cols, 2, 6)
  const rows = clampInt(map.rows, 2, 6)
  const width = cols * RAID_ROOM_W
  const height = rows * RAID_ROOM_H
  const tiles = new Array<number>(width * height).fill(RAID_TILE_WALL)

  const rooms: RaidRoomNode[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const id = row * cols + col
      rooms.push({
        id,
        row,
        col,
        kind: 'combat',
        x: col * RAID_ROOM_W,
        y: row * RAID_ROOM_H,
        w: RAID_ROOM_W,
        h: RAID_ROOM_H,
        neighbors: [],
        enemies: [],
        containers: [],
      })
      fillRect(
        tiles,
        width,
        col * RAID_ROOM_W + 1,
        row * RAID_ROOM_H + 1,
        RAID_ROOM_W - 2,
        RAID_ROOM_H - 2,
        RAID_TILE_FLOOR,
      )
    }
  }

  const roomAt = (row: number, col: number): RaidRoomNode | null => {
    if (row < 0 || col < 0 || row >= rows || col >= cols) return null
    return rooms[row * cols + col] ?? null
  }

  // —— 生成树：随机化 DFS（保证全图连通）——
  const linkRng = createRaidRng(raidSubSeed(seed, 'rooms'))
  const visited = new Set<number>([0])
  const stack: number[] = [0]
  const edges = new Set<string>()
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}-${b}` : `${b}-${a}`)
  while (stack.length > 0) {
    const current = stack[stack.length - 1] as number
    const room = rooms[current] as RaidRoomNode
    const candidates: RaidRoomNode[] = []
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const next = roomAt(room.row + dr, room.col + dc)
      if (next && !visited.has(next.id)) candidates.push(next)
    }
    if (candidates.length === 0) {
      stack.pop()
      continue
    }
    const next = rngPick(linkRng, candidates)
    visited.add(next.id)
    stack.push(next.id)
    edges.add(edgeKey(current, next.id))
  }
  // —— 环路：额外连接 30% 的未连通相邻房间 ——
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const room = roomAt(row, col)
      if (!room) continue
      for (const [dr, dc] of [[0, 1], [1, 0]] as const) {
        const next = roomAt(row + dr, col + dc)
        if (!next) continue
        if (edges.has(edgeKey(room.id, next.id))) continue
        if (linkRng() < 0.3) edges.add(edgeKey(room.id, next.id))
      }
    }
  }

  // —— 挖走廊 + 记录门 ——
  const doors: RaidDoorNode[] = []
  for (const key of edges) {
    const [aRaw, bRaw] = key.split('-')
    const a = rooms[Number(aRaw)]
    const b = rooms[Number(bRaw)]
    if (!a || !b) continue
    a.neighbors.push(b.id)
    b.neighbors.push(a.id)
    const ca = roomCenter(a)
    const cb = roomCenter(b)
    if (a.row === b.row) {
      const left = a.col < b.col ? a : b
      const right = a.col < b.col ? b : a
      const startX = left.x + left.w - 1
      const endX = right.x
      const cy = ca.y
      fillRect(tiles, width, startX, cy - 1, endX - startX + 1, 3, RAID_TILE_FLOOR)
      fillRect(tiles, width, startX, cy, 1, 1, RAID_TILE_DOOR)
      fillRect(tiles, width, endX, cy, 1, 1, RAID_TILE_DOOR)
      doors.push({ x: startX, y: cy, roomA: left.id, roomB: right.id })
      doors.push({ x: endX, y: cy, roomA: left.id, roomB: right.id })
    } else {
      const top = a.row < b.row ? a : b
      const bottom = a.row < b.row ? b : a
      const startY = top.y + top.h - 1
      const endY = bottom.y
      const cx = ca.x
      fillRect(tiles, width, cx - 1, startY, 3, endY - startY + 1, RAID_TILE_FLOOR)
      fillRect(tiles, width, cx, startY, 1, 1, RAID_TILE_DOOR)
      fillRect(tiles, width, cx, endY, 1, 1, RAID_TILE_DOOR)
      doors.push({ x: cx, y: startY, roomA: top.id, roomB: bottom.id })
      doors.push({ x: cx, y: endY, roomA: top.id, roomB: bottom.id })
    }
  }

  // —— 房间类型分配 ——
  const typeRng = createRaidRng(raidSubSeed(seed, 'types'))
  const startRoom = 0
  ;(rooms[startRoom] as RaidRoomNode).kind = 'start'

  // BFS 距离（房门连通图）
  const distance = new Map<number, number>([[startRoom, 0]])
  const queue: number[] = [startRoom]
  while (queue.length > 0) {
    const current = queue.shift() as number
    const base = distance.get(current) ?? 0
    for (const next of rooms[current]?.neighbors ?? []) {
      if (distance.has(next)) continue
      distance.set(next, base + 1)
      queue.push(next)
    }
  }
  const remaining = rooms
    .filter((room) => room.id !== startRoom)
    .sort((a, b) => (distance.get(b.id) ?? 0) - (distance.get(a.id) ?? 0) || a.id - b.id)

  const takeRoom = (): RaidRoomNode | null => remaining.shift() ?? null

  const extractRooms: RaidRoomNode[] = []
  for (let i = 0; i < map.extractRooms; i += 1) {
    const room = takeRoom()
    if (!room) break
    room.kind = 'extract'
    extractRooms.push(room)
  }
  for (let i = 0; i < map.bossRooms; i += 1) {
    const room = takeRoom()
    if (!room) break
    room.kind = 'boss'
  }
  for (let i = 0; i < map.eliteRooms; i += 1) {
    const room = takeRoom()
    if (!room) break
    room.kind = 'elite'
  }
  for (let i = 0; i < map.lootRooms; i += 1) {
    const room = takeRoom()
    if (!room) break
    room.kind = 'loot'
  }
  for (let i = 0; i < map.hazardRooms; i += 1) {
    const room = takeRoom()
    if (!room) break
    room.kind = 'hazard'
  }
  // 剩余房间保持 combat

  // —— 危险房间铺危险瓦片（内部四角留安全区）——
  for (const room of rooms) {
    if (room.kind !== 'hazard') continue
    for (let y = room.y + 3; y < room.y + room.h - 3; y += 1) {
      for (let x = room.x + 3; x < room.x + room.w - 3; x += 1) {
        if (typeRng() < 0.55) tiles[raidTileIndex(width, x, y)] = RAID_TILE_HAZARD
      }
    }
  }

  // —— 敌人分配 ——
  let enemyBudget = Math.max(0, map.enemyBudget)
  const placeEnemies = (room: RaidRoomNode, kinds: readonly RaidEnemyKind[], forceFirst = false): void => {
    const tilesPool = roomInnerTiles(room)
    for (let i = 0; i < kinds.length; i += 1) {
      const kind = kinds[i] as RaidEnemyKind
      const mustPlace = forceFirst && i === 0
      if (enemyBudget <= 0 && !mustPlace) return
      let spot: { x: number; y: number } | null = null
      for (let attempt = 0; attempt < 24; attempt += 1) {
        const candidate = tilesPool.length > 0
          ? tilesPool[Math.floor(typeRng() * tilesPool.length)]
          : { x: room.x + 2, y: room.y + 2 }
        if (!candidate) continue
        const occupied = room.enemies.some(
          (enemy) => enemy.x === candidate.x && enemy.y === candidate.y,
        )
        if (occupied) continue
        spot = candidate
        break
      }
      if (!spot) continue
      room.enemies.push(
        createRaidEnemy(seed, room.id, room.enemies.length, kind, map.enemyLevel, spot.x, spot.y),
      )
      enemyBudget -= kind === 'boss' ? 4 : kind === 'elite' ? 2 : 1
    }
  }

  for (const room of rooms) {
    if (room.kind === 'start' || room.kind === 'extract') continue
    const kinds: RaidEnemyKind[] = []
    if (room.kind === 'boss') {
      kinds.push('boss', 'soldier', 'soldier')
    } else if (room.kind === 'elite') {
      kinds.push('elite', 'soldier', 'soldier')
    } else if (room.kind === 'combat') {
      const count = rngInt(typeRng, 2, 3)
      for (let i = 0; i < count; i += 1) kinds.push(typeRng() < 0.4 ? 'scout' : 'soldier')
    } else if (room.kind === 'loot') {
      if (typeRng() < 0.5) kinds.push('scout')
    } else if (room.kind === 'hazard') {
      const count = rngInt(typeRng, 0, 2)
      for (let i = 0; i < count; i += 1) kinds.push('scout')
    }
    placeEnemies(room, kinds, room.kind === 'boss')
  }

  // —— 容器分配 ——
  for (const room of rooms) {
    const count = room.kind === 'start'
      ? 1
      : room.kind === 'boss'
        ? 3
        : room.kind === 'loot'
          ? 4
          : room.kind === 'elite'
            ? 2
            : room.kind === 'combat'
              ? rngInt(typeRng, 1, 2)
              : 1
    const tilesPool = roomInnerTiles(room)
    for (let i = 0; i < count; i += 1) {
      const spot = tilesPool.length > 0
        ? tilesPool[Math.floor(typeRng() * tilesPool.length)]
        : { x: room.x + 2, y: room.y + 2 }
      if (!spot) continue
      if (room.containers.some((container) => container.x === spot.x && container.y === spot.y)) continue
      if (room.enemies.some((enemy) => enemy.x === spot.x && enemy.y === spot.y)) continue
      const id = `c-${room.id}-${i}`
      room.containers.push({
        id,
        roomId: room.id,
        x: spot.x,
        y: spot.y,
        loot: rollRaidContainerLoot(seed, id, map.lootTier, room.kind === 'boss'),
      })
    }
  }

  // —— 撤离点：每个撤离房间中心的信标 ——
  const extracts: RaidExtractPoint[] = []
  for (const room of extractRooms) {
    const center = roomCenter(room)
    extracts.push({ roomId: room.id, x: center.x, y: center.y })
  }

  return {
    key: map.key,
    name: map.name,
    emoji: map.emoji,
    difficulty: map.difficulty,
    cols,
    rows,
    width,
    height,
    tiles,
    rooms,
    doors,
    extracts,
    startRoom,
  }
}

/* ============================================================
   运行状态
   ============================================================ */

export interface RaidGearInstance {
  key: string
  durability: number
  /** 当前耐久上限（维修会逐步降低，但不会低于初始上限的 30%） */
  maxDurability: number
}

export interface RaidEquippedGear {
  helmet: RaidGearInstance | null
  armor: RaidGearInstance | null
  boots: string | null
  backpack: string | null
  rig: string | null
}

export interface RaidItemStack {
  slotIndex: number
  itemKey: string
  amount: number
}

export interface RaidSkillRule {
  key: string
  name: string
  emoji: string
  kind: string
  mpCost: number
  /** 冷却毫秒（由技能目录的回合冷却折算） */
  cooldownMs: number
  /** 伤害倍率（客户端实时战斗用） */
  power: number
  healPct?: number
}

export interface RaidLogEntry {
  id: number
  /** 相对开局毫秒 */
  at: number
  kind: 'info' | 'loot' | 'combat' | 'danger' | 'success' | 'extract'
  text: string
}

/** 丢弃在地面的物品（对局内临时存在，撤离 / 阵亡即消失） */
export interface RaidGroundStack {
  id: string
  roomId: number
  itemKey: string
  amount: number
  x: number
  y: number
}

/** 单个房间地面掉落物上限（防无限丢物刷屏） */
export const RAID_GROUND_LOOT_LIMIT = 24

export interface RaidRunState {
  schemaVersion: number
  seed: number
  mapKey: string
  /** 组队模式下的队伍 id（单人局没有这个字段） */
  squadId?: string
  difficulty: string
  version: number
  status: RaidStatus
  startedAt: number
  expiresAt: number
  insured: boolean
  hp: number
  mp: number
  maxHp: number
  maxMp: number
  atk: number
  currentRoom: number
  clearedRooms: number[]
  killedEnemies: string[]
  openedContainers: string[]
  takenLoot: string[]
  gear: RaidEquippedGear
  capacities: { backpack: number; rig: number; safe: number }
  backpack: RaidItemStack[]
  rig: RaidItemStack[]
  safe: RaidItemStack[]
  groundLoot: RaidGroundStack[]
  /** 地面物品发号器（丢弃时自增，保证 id 稳定） */
  groundSeq: number
  skills: RaidSkillRule[]
  skillUsedAt: Record<string, number>
  kills: number
  damageTaken: number
  extractionStartedAt: number | null
  extractionRoom: number | null
  log: RaidLogEntry[]
  lastSyncAt: number
  logSeq: number
}

export interface RaidStartInput {
  seed: number
  mapKey: string
  squadId?: string
  difficulty: string
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  atk: number
  insured: boolean
  capacities: { backpack: number; rig: number; safe: number }
  gear: RaidEquippedGear
  backpack: RaidItemStack[]
  rig: RaidItemStack[]
  safe: RaidItemStack[]
  skills: RaidSkillRule[]
  startedAt: number
  /** 组队模式：按成员序号错开的地面掉落发号基址（防各成员 g1/g2 撞 id） */
  groundSeqBase?: number
}

function makeLog(state: RaidRunState, kind: RaidLogEntry['kind'], text: string, now: number): void {
  const at = Math.max(0, now - state.startedAt)
  state.logSeq += 1
  state.log.push({ id: state.logSeq, at, kind, text })
  if (state.log.length > RAID_LOG_LIMIT) {
    state.log.splice(0, state.log.length - RAID_LOG_LIMIT)
  }
}

export function createRaidRun(input: RaidStartInput): RaidRunState {
  const map = getRaidMap(input.mapKey)
  if (!map) throw new Error('地图不存在')
  const now = input.startedAt
  const state: RaidRunState = {
    schemaVersion: RAID_STATE_VERSION,
    seed: input.seed >>> 0,
    mapKey: map.key,
    squadId: input.squadId,
    difficulty: input.difficulty,
    version: 0,
    status: 'active',
    startedAt: now,
    expiresAt: now + map.durationMs,
    insured: input.insured,
    hp: clampInt(input.hp, 1, input.maxHp),
    mp: clampInt(input.mp, 0, input.maxMp),
    maxHp: Math.max(1, Math.trunc(input.maxHp)),
    maxMp: Math.max(0, Math.trunc(input.maxMp)),
    atk: Math.max(1, Math.trunc(input.atk)),
    currentRoom: 0,
    clearedRooms: [],
    killedEnemies: [],
    openedContainers: [],
    takenLoot: [],
    gear: input.gear,
    capacities: {
      backpack: Math.max(0, Math.trunc(input.capacities.backpack)),
      rig: Math.max(0, Math.trunc(input.capacities.rig)),
      safe: Math.max(0, Math.trunc(input.capacities.safe)),
    },
    backpack: normalizeContainer(input.backpack, input.capacities.backpack),
    rig: normalizeContainer(input.rig, input.capacities.rig),
    safe: normalizeContainer(input.safe, input.capacities.safe),
    skills: input.skills.slice(0, 3),
    skillUsedAt: {},
    kills: 0,
    damageTaken: 0,
    extractionStartedAt: null,
    extractionRoom: null,
    groundLoot: [],
    groundSeq: Math.max(0, Math.trunc(input.groundSeqBase ?? 0)),
    log: [],
    lastSyncAt: now,
    logSeq: 0,
  }
  makeLog(state, 'info', `进入 ${map.name}，小心房间里的守卫。`, now)
  return state
}

/** 清洗容器：去掉越界槽位、非法物品、超过堆叠上限与容量的部分（2026-11 起胸挂不再限消耗品） */
export function normalizeContainer(
  stacks: readonly RaidItemStack[],
  capacity: number,
): RaidItemStack[] {
  const out: RaidItemStack[] = []
  const used = new Set<number>()
  const cap = Math.max(0, Math.trunc(capacity))
  for (const stack of stacks) {
    if (out.length >= cap) break
    const def = RAID_ITEM_MAP.get(stack.itemKey)
    if (!def) continue
    const amount = clampInt(stack.amount, 0, def.stackMax)
    if (amount <= 0) continue
    const slot = clampInt(stack.slotIndex, 0, Math.max(0, cap - 1))
    if (used.has(slot)) continue
    used.add(slot)
    out.push({ slotIndex: slot, itemKey: stack.itemKey, amount })
  }
  return out
}

export function containerSize(stacks: readonly RaidItemStack[]): number {
  return stacks.length
}

export function containerUnits(stacks: readonly RaidItemStack[]): number {
  return stacks.reduce((sum, stack) => sum + stack.amount, 0)
}

export function findContainerSlot(
  stacks: readonly RaidItemStack[],
  capacity: number,
): number {
  const used = new Set(stacks.map((stack) => stack.slotIndex))
  for (let i = 0; i < capacity; i += 1) {
    if (!used.has(i)) return i
  }
  return -1
}

/**
 * 往容器加物品（先尝试堆叠，再找空槽）。
 * 返回新容器；容量不足返回 null（调用方报「背包已满」）。
 */
export function addItemToContainer(
  stacks: readonly RaidItemStack[],
  capacity: number,
  itemKey: string,
  amount: number,
): RaidItemStack[] | null {
  const def = RAID_ITEM_MAP.get(itemKey)
  if (!def) return null
  let left = Math.max(0, Math.trunc(amount))
  if (left <= 0) return null
  const next = stacks.map((stack) => ({ ...stack }))
  for (const stack of next) {
    if (left <= 0) break
    if (stack.itemKey !== itemKey) continue
    const room = def.stackMax - stack.amount
    if (room <= 0) continue
    const take = Math.min(room, left)
    stack.amount += take
    left -= take
  }
  while (left > 0) {
    const slot = findContainerSlot(next, capacity)
    if (slot < 0) return null
    const take = Math.min(def.stackMax, left)
    next.push({ slotIndex: slot, itemKey, amount: take })
    left -= take
  }
  return next
}

/** 从容器扣数量（按槽位）；数量不足返回 null */
export function removeItemFromContainer(
  stacks: readonly RaidItemStack[],
  slotIndex: number,
  amount: number,
): RaidItemStack[] | null {
  const target = stacks.find((stack) => stack.slotIndex === slotIndex)
  if (!target) return null
  const take = Math.max(0, Math.trunc(amount))
  if (take <= 0 || take > target.amount) return null
  const next: RaidItemStack[] = []
  for (const stack of stacks) {
    if (stack.slotIndex !== slotIndex) {
      next.push({ ...stack })
      continue
    }
    const left = stack.amount - take
    if (left > 0) next.push({ ...stack, amount: left })
  }
  return next
}

/** 从容器按 itemKey 扣数量（消耗品使用用，优先扣数量最少的槽） */
export function consumeItemFromContainer(
  stacks: readonly RaidItemStack[],
  itemKey: string,
  amount = 1,
): RaidItemStack[] | null {
  const candidates = stacks
    .filter((stack) => stack.itemKey === itemKey)
    .sort((a, b) => a.amount - b.amount || a.slotIndex - b.slotIndex)
  let left = Math.max(0, Math.trunc(amount))
  if (left <= 0) return null
  let next = stacks.map((stack) => ({ ...stack }))
  for (const candidate of candidates) {
    if (left <= 0) break
    const current = next.find((stack) => stack.slotIndex === candidate.slotIndex)
    if (!current) continue
    const take = Math.min(current.amount, left)
    current.amount -= take
    left -= take
    if (current.amount <= 0) {
      next = next.filter((stack) => stack.slotIndex !== candidate.slotIndex)
    }
  }
  if (left > 0) return null
  return next
}

/* ============================================================
   耐久 / 伤害
   ============================================================ */

export interface RaidDamageResult {
  hpDamage: number
  helmetLoss: number
  armorLoss: number
  zone: 'head' | 'body'
}

/** 护甲减伤（耐久为 0 时不再提供防护） */
export function raidDefenseOf(instance: RaidGearInstance | null): number {
  if (!instance || instance.durability <= 0) return 0
  const def = RAID_GEAR_MAP.get(instance.key)
  return def?.defense ?? 0
}

/**
 * 受击结算（对齐三角洲）：按命中部位取头盔/护甲减伤，同时扣耐久。
 * 耐久损耗 = max(1, round(raw × 0.4))。
 */
export function resolveRaidDamage(input: {
  raw: number
  zone: 'head' | 'body'
  helmet: RaidGearInstance | null
  armor: RaidGearInstance | null
}): RaidDamageResult {
  const raw = Math.max(1, Math.min(100000, Math.round(input.raw)))
  const gear = input.zone === 'head' ? input.helmet : input.armor
  const defense = raidDefenseOf(gear)
  const hpDamage = Math.max(1, Math.round(raw * (1 - defense / 100)))
  const loss = gear && gear.durability > 0
    ? Math.max(1, Math.round(raw * RAID_DURABILITY_LOSS_RATE))
    : 0
  return {
    hpDamage,
    helmetLoss: input.zone === 'head' ? loss : 0,
    armorLoss: input.zone === 'body' ? loss : 0,
    zone: input.zone,
  }
}

/** 应用伤害到运行状态（返回新的头盔 / 护甲实例） */
export function applyRaidDamage(
  state: RaidRunState,
  result: RaidDamageResult,
): void {
  state.hp = Math.max(0, state.hp - result.hpDamage)
  state.damageTaken += result.hpDamage
  if (state.gear.helmet && result.helmetLoss > 0) {
    state.gear = {
      ...state.gear,
      helmet: { ...state.gear.helmet, durability: Math.max(0, state.gear.helmet.durability - result.helmetLoss) },
    }
  }
  if (state.gear.armor && result.armorLoss > 0) {
    state.gear = {
      ...state.gear,
      armor: { ...state.gear.armor, durability: Math.max(0, state.gear.armor.durability - result.armorLoss) },
    }
  }
  if (state.hp <= 0) {
    state.status = 'died'
  }
}

export interface RaidRepairResult {
  ok: boolean
  gear: RaidGearInstance | null
  restored: number
  error?: string
}

/**
 * 维修头盔 / 护甲：恢复 kit 指定耐久，但本次维修把耐久上限降到 95%，
 * 且永远不低于初始上限的 30%（越修越脆，对齐三角洲行动）。
 */
export function repairRaidGear(instance: RaidGearInstance, kitKey: string): RaidRepairResult {
  const kit = RAID_ITEM_MAP.get(kitKey)
  if (!kit || kit.kind !== 'consumable' || !kit.repairSlot || !kit.repairAmount) {
    return { ok: false, gear: instance, restored: 0, error: '这不是维修工具' }
  }
  const def = RAID_GEAR_MAP.get(instance.key)
  if (!def || def.slot !== kit.repairSlot) {
    return { ok: false, gear: instance, restored: 0, error: '维修工具与装备槽不匹配' }
  }
  const baseMax = def.maxDurability ?? 0
  if (baseMax <= 0) {
    return { ok: false, gear: instance, restored: 0, error: '这件装备没有耐久' }
  }
  if (instance.durability >= instance.maxDurability) {
    return { ok: false, gear: instance, restored: 0, error: '耐久已满，不需要维修' }
  }
  const floor = Math.max(1, Math.ceil(baseMax * RAID_REPAIR_FLOOR_RATIO))
  const nextMax = Math.max(floor, Math.floor(instance.maxDurability * RAID_REPAIR_MAX_DECAY))
  const nextDurability = Math.min(nextMax, instance.durability + kit.repairAmount)
  return {
    ok: true,
    gear: { ...instance, maxDurability: nextMax, durability: nextDurability },
    restored: nextDurability - instance.durability,
  }
}

/** 装备总价值（保险 / 结算展示用） */
export function raidGearValue(gear: RaidEquippedGear): number {
  let total = 0
  for (const instance of [gear.helmet, gear.armor]) {
    if (!instance) continue
    const def = RAID_GEAR_MAP.get(instance.key)
    if (def) total += def.price
  }
  for (const key of [gear.boots, gear.backpack, gear.rig]) {
    if (!key) continue
    const def = RAID_GEAR_MAP.get(key)
    if (def) total += def.price
  }
  return total
}

/** 行动保险：装备价值的 15%，最低 20 积分（无装备时为 0） */
export function raidInsuranceCost(gear: RaidEquippedGear): number {
  const value = raidGearValue(gear)
  if (value <= 0) return 0
  return Math.max(20, Math.ceil(value * 0.15))
}

/* ============================================================
   事件与状态机
   ============================================================ */

export type RaidEvent =
  | { type: 'enterRoom'; roomId: number }
  | { type: 'kill'; enemyId: string }
  | { type: 'clearRoom'; roomId: number }
  | { type: 'openContainer'; containerId: string }
  | { type: 'takeLoot'; containerId: string; lootId: string; target: RaidContainerKind; slotIndex?: number }
  | {
    type: 'moveItem'
    from: RaidContainerKind
    to: RaidContainerKind
    slotIndex: number
    /** 缺省 = 整格全部移动 */
    amount?: number
  }
  | {
    type: 'dropItem'
    from: RaidContainerKind
    slotIndex: number
    /** 缺省 = 整格全部丢弃 */
    amount?: number
    /** 丢弃落点（客户端玩家坐标，服务端夹取进当前房间内部） */
    x?: number
    y?: number
  }
  | { type: 'takeGround'; groundId: string; target: RaidContainerKind }
  | { type: 'useItem'; itemKey: string; from: RaidContainerKind }
  | { type: 'castSkill'; skillKey: string }
  | { type: 'damage'; amount: number; zone: 'head' | 'body' }
  | { type: 'extractStart' }
  | { type: 'extractDone' }
  | { type: 'abandon' }

export interface RaidEventResult {
  state: RaidRunState
  error?: string
}

function cloneState(state: RaidRunState): RaidRunState {
  return {
    ...state,
    clearedRooms: [...state.clearedRooms],
    killedEnemies: [...state.killedEnemies],
    openedContainers: [...state.openedContainers],
    takenLoot: [...state.takenLoot],
    gear: { ...state.gear },
    capacities: { ...state.capacities },
    backpack: state.backpack.map((stack) => ({ ...stack })),
    rig: state.rig.map((stack) => ({ ...stack })),
    safe: state.safe.map((stack) => ({ ...stack })),
    groundLoot: (state.groundLoot ?? []).map((item) => ({ ...item })),
    groundSeq: state.groundSeq ?? 0,
    skills: state.skills.map((skill) => ({ ...skill })),
    skillUsedAt: { ...state.skillUsedAt },
    log: state.log.map((entry) => ({ ...entry })),
  }
}

export function roomEnemies(map: RaidMapNode, roomId: number): RaidEnemyNode[] {
  return map.rooms[roomId]?.enemies ?? []
}

export function roomIsClear(state: RaidRunState, map: RaidMapNode, roomId: number): boolean {
  if (state.clearedRooms.includes(roomId)) return true
  return roomEnemies(map, roomId).every((enemy) => state.killedEnemies.includes(enemy.id))
}

export function roomContainsLivingEnemies(state: RaidRunState, map: RaidMapNode, roomId: number): boolean {
  return roomEnemies(map, roomId).some((enemy) => !state.killedEnemies.includes(enemy.id))
}

export function currentContainer(
  state: RaidRunState,
  kind: RaidContainerKind,
): RaidItemStack[] {
  if (kind === 'rig') return state.rig
  if (kind === 'safe') return state.safe
  return state.backpack
}

export function containerCapacity(state: RaidRunState, kind: RaidContainerKind): number {
  return kind === 'rig' ? state.capacities.rig : kind === 'safe' ? state.capacities.safe : state.capacities.backpack
}

/** 每批事件前推进 MP 回复与超时判定 */
export function tickRaidRun(state: RaidRunState, now: number): RaidRunState {
  if (state.status !== 'active') return state
  const next = cloneState(state)
  const elapsed = Math.max(0, now - next.lastSyncAt)
  if (elapsed > 0) {
    const regen = Math.floor(elapsed / 1000) * RAID_MP_REGEN_PER_SEC
    if (regen > 0) next.mp = Math.min(next.maxMp, next.mp + regen)
  }
  next.lastSyncAt = now
  if (now >= next.expiresAt) {
    next.status = 'mia'
    makeLog(next, 'danger', '行动超时，与小队失去联系。', now)
  }
  return next
}

/** 把丢弃落点夹取进当前房间内部（客户端坐标只作参考，不能丢到墙外或别的房间） */
function clampGroundPos(x: number | undefined, y: number | undefined, room: RaidRoomNode): { x: number; y: number } {
  const cx = Number.isFinite(x) ? Number(x) : room.x + room.w / 2
  const cy = Number.isFinite(y) ? Number(y) : room.y + room.h / 2
  return {
    x: Math.max(room.x + 1.5, Math.min(room.x + room.w - 2.5, cx)),
    y: Math.max(room.y + 1.5, Math.min(room.y + room.h - 2.5, cy)),
  }
}

/**
 * 应用单条事件。返回新状态；非法事件返回原状态 + error（由调用方记录并忽略）。
 * 所有校验都基于 seed 重算出的地图，客户端无法凭请求伪造容器或掉落。
 */
export function applyRaidEvent(
  state: RaidRunState,
  map: RaidMapNode,
  event: RaidEvent,
  now: number,
): RaidEventResult {
  if (state.status !== 'active') return { state, error: '对局已结束' }
  const next = cloneState(state)

  switch (event.type) {
    case 'enterRoom': {
      const room = map.rooms[event.roomId]
      if (!room) return { state, error: '房间不存在' }
      if (event.roomId === next.currentRoom) return { state: next }
      const current = map.rooms[next.currentRoom]
      if (!current) return { state, error: '当前房间异常' }
      if (!current.neighbors.includes(event.roomId)) return { state, error: '只能进入相邻房间' }
      if (!roomIsClear(next, map, next.currentRoom)) {
        return { state, error: '当前房间还有敌人，门锁死了' }
      }
      next.currentRoom = event.roomId
      next.extractionStartedAt = null
      next.extractionRoom = null
      makeLog(next, 'info', `进入 ${room.kind === 'extract' ? '撤离区' : room.kind === 'boss' ? '首领房间' : '新房间'}（${room.col + 1},${room.row + 1}）`, now)
      return { state: next }
    }
    case 'kill': {
      const room = map.rooms[next.currentRoom]
      if (!room) return { state, error: '当前房间异常' }
      const enemy = room.enemies.find((item) => item.id === event.enemyId)
      if (!enemy) return { state, error: '当前房间没有这个敌人' }
      if (next.killedEnemies.includes(enemy.id)) return { state: next }
      next.killedEnemies.push(enemy.id)
      next.kills += 1
      makeLog(next, 'combat', `击倒 ${enemy.name}（Lv.${enemy.level}）`, now)
      return { state: next }
    }
    case 'clearRoom': {
      if (event.roomId !== next.currentRoom) return { state, error: '只能清理当前房间' }
      if (next.clearedRooms.includes(event.roomId)) return { state: next }
      if (!roomIsClear(next, map, event.roomId)) return { state, error: '房间还有敌人' }
      next.clearedRooms.push(event.roomId)
      makeLog(next, 'success', '房间已清空，房门解锁。', now)
      return { state: next }
    }
    case 'openContainer': {
      const room = map.rooms[next.currentRoom]
      if (!room) return { state, error: '当前房间异常' }
      const container = room.containers.find((item) => item.id === event.containerId)
      if (!container) return { state, error: '当前房间没有这个容器' }
      if (next.openedContainers.includes(container.id)) return { state: next }
      if (roomContainsLivingEnemies(next, map, room.id)) {
        return { state, error: '房间还有敌人，先清场再搜' }
      }
      next.openedContainers.push(container.id)
      makeLog(next, 'loot', '打开了一个容器。', now)
      return { state: next }
    }
    case 'takeLoot': {
      const room = map.rooms[next.currentRoom]
      if (!room) return { state, error: '当前房间异常' }
      const container = room.containers.find((item) => item.id === event.containerId)
      if (!container) return { state, error: '当前房间没有这个容器' }
      if (!next.openedContainers.includes(container.id)) return { state, error: '容器还没打开' }
      const loot = container.loot.find((item) => item.id === event.lootId)
      if (!loot) return { state, error: '容器里没有这件物品' }
      const takeId = `${container.id}#${loot.id}`
      if (next.takenLoot.includes(takeId)) return { state: next, error: '这件物品已经被拿走了' }
      const def = RAID_ITEM_MAP.get(loot.itemKey)
      if (!def) return { state, error: '未知物品' }
      const capacity = containerCapacity(next, event.target)
      if (capacity <= 0) return { state, error: `${RAID_CONTAINER_LABELS[event.target]}已满，装不下了` }
      const target = currentContainer(next, event.target)
      const updated = addItemToContainer(target, capacity, loot.itemKey, loot.amount)
      if (!updated) return { state, error: `${RAID_CONTAINER_LABELS[event.target]}已满，装不下了` }
      if (event.target === 'backpack') next.backpack = updated
      else if (event.target === 'rig') next.rig = updated
      else next.safe = updated
      next.takenLoot.push(takeId)
      makeLog(next, 'loot', `拾取 ${def.name} ×${loot.amount}`, now)
      return { state: next }
    }
    case 'moveItem': {
      if (event.from === event.to) return { state, error: '目标容器与来源相同' }
      const source = currentContainer(next, event.from)
      const stack = source.find((entry) => entry.slotIndex === event.slotIndex)
      if (!stack) return { state, error: '这里没有这件物品' }
      const def = RAID_ITEM_MAP.get(stack.itemKey)
      if (!def) return { state, error: '未知物品' }
      const capacity = containerCapacity(next, event.to)
      if (capacity <= 0) return { state, error: `${RAID_CONTAINER_LABELS[event.to]}已满，装不下了` }
      const amount = clampInt(event.amount ?? stack.amount, 1, stack.amount)
      const targetStacks = currentContainer(next, event.to)
      const added = addItemToContainer(targetStacks, capacity, stack.itemKey, amount)
      if (!added) return { state, error: `${RAID_CONTAINER_LABELS[event.to]}已满，装不下了` }
      const removed = removeItemFromContainer(source, event.slotIndex, amount)
      if (!removed) return { state, error: '移动失败' }
      if (event.from === 'backpack') next.backpack = removed
      else if (event.from === 'rig') next.rig = removed
      else next.safe = removed
      if (event.to === 'backpack') next.backpack = added
      else if (event.to === 'rig') next.rig = added
      else next.safe = added
      makeLog(
        next,
        'info',
        `把 ${def.name} ×${amount} 挪到${RAID_CONTAINER_LABELS[event.to]}`,
        now,
      )
      return { state: next }
    }
    case 'dropItem': {
      const room = map.rooms[next.currentRoom]
      if (!room) return { state, error: '当前房间异常' }
      const source = currentContainer(next, event.from)
      const stack = source.find((entry) => entry.slotIndex === event.slotIndex)
      if (!stack) return { state, error: '这里没有这件物品' }
      const def = RAID_ITEM_MAP.get(stack.itemKey)
      if (!def) return { state, error: '未知物品' }
      const amount = clampInt(event.amount ?? stack.amount, 1, stack.amount)
      const roomGroundCount = next.groundLoot.filter((item) => item.roomId === next.currentRoom).length
      if (roomGroundCount >= RAID_GROUND_LOOT_LIMIT) {
        return { state, error: '地上掉落物太多了，先捡一捡再丢' }
      }
      const removed = removeItemFromContainer(source, event.slotIndex, amount)
      if (!removed) return { state, error: '丢弃失败' }
      if (event.from === 'backpack') next.backpack = removed
      else if (event.from === 'rig') next.rig = removed
      else next.safe = removed
      next.groundSeq += 1
      const pos = clampGroundPos(event.x, event.y, room)
      next.groundLoot.push({
        id: `g${next.groundSeq}`,
        roomId: next.currentRoom,
        itemKey: stack.itemKey,
        amount,
        x: pos.x,
        y: pos.y,
      })
      makeLog(next, 'info', `丢弃 ${def.name} ×${amount}`, now)
      return { state: next }
    }
    case 'takeGround': {
      const room = map.rooms[next.currentRoom]
      if (!room) return { state, error: '当前房间异常' }
      const ground = next.groundLoot.find((item) => item.id === event.groundId)
      if (!ground) return { state, error: '地上没有这件物品' }
      if (ground.roomId !== next.currentRoom) return { state, error: '物品在别的房间' }
      const def = RAID_ITEM_MAP.get(ground.itemKey)
      if (!def) return { state, error: '未知物品' }
      const capacity = containerCapacity(next, event.target)
      if (capacity <= 0) return { state, error: `${RAID_CONTAINER_LABELS[event.target]}已满，装不下了` }
      const target = currentContainer(next, event.target)
      const updated = addItemToContainer(target, capacity, ground.itemKey, ground.amount)
      if (!updated) return { state, error: `${RAID_CONTAINER_LABELS[event.target]}已满，装不下了` }
      if (event.target === 'backpack') next.backpack = updated
      else if (event.target === 'rig') next.rig = updated
      else next.safe = updated
      next.groundLoot = next.groundLoot.filter((item) => item.id !== event.groundId)
      makeLog(next, 'loot', `捡起 ${def.name} ×${ground.amount}`, now)
      return { state: next }
    }
    case 'useItem': {
      const def = RAID_ITEM_MAP.get(event.itemKey)
      if (!def || def.kind !== 'consumable') return { state, error: '这不是可用道具' }
      const container = currentContainer(next, event.from)
      if (!container.some((stack) => stack.itemKey === event.itemKey)) {
        return { state, error: '这里没有这件道具' }
      }
      if (def.healPct) {
        if (next.hp >= next.maxHp) return { state, error: '生命值已满' }
        next.hp = Math.min(next.maxHp, next.hp + Math.ceil(next.maxHp * def.healPct / 100))
      }
      if (def.mpGain) {
        if (next.mp >= next.maxMp) return { state, error: '能量已满' }
        next.mp = Math.min(next.maxMp, next.mp + def.mpGain)
      }
      if (def.repairSlot) {
        const target = def.repairSlot === 'helmet' ? next.gear.helmet : next.gear.armor
        if (!target) return { state, error: '没有可维修的装备' }
        const repaired = repairRaidGear(target, event.itemKey)
        if (!repaired.ok || !repaired.gear) return { state, error: repaired.error ?? '维修失败' }
        if (def.repairSlot === 'helmet') next.gear = { ...next.gear, helmet: repaired.gear }
        else next.gear = { ...next.gear, armor: repaired.gear }
        makeLog(next, 'info', `维修完成，恢复 ${repaired.restored} 点耐久。`, now)
      }
      const consumed = consumeItemFromContainer(container, event.itemKey, 1)
      if (!consumed) return { state, error: '使用失败' }
      if (event.from === 'backpack') next.backpack = consumed
      else if (event.from === 'rig') next.rig = consumed
      else next.safe = consumed
      makeLog(next, 'info', `使用 ${def.name}`, now)
      return { state: next }
    }
    case 'castSkill': {
      const skill = next.skills.find((item) => item.key === event.skillKey)
      if (!skill) return { state, error: '没有装备这个技能' }
      const last = next.skillUsedAt[skill.key] ?? 0
      if (last > 0 && now - last < skill.cooldownMs) {
        return { state, error: '技能冷却中' }
      }
      if (next.mp < skill.mpCost) return { state, error: '能量不足' }
      next.mp -= skill.mpCost
      next.skillUsedAt[skill.key] = now
      if ((skill.kind === 'heal' || skill.kind === 'cleanse') && skill.healPct) {
        next.hp = Math.min(next.maxHp, next.hp + Math.ceil(next.maxHp * skill.healPct / 100))
      }
      makeLog(next, 'combat', `释放 ${skill.name}`, now)
      return { state: next }
    }
    case 'damage': {
      const amount = Math.max(0, Math.min(100000, Math.trunc(event.amount || 0)))
      if (amount <= 0) return { state: next }
      const result = resolveRaidDamage({
        raw: amount,
        zone: event.zone === 'head' ? 'head' : 'body',
        helmet: next.gear.helmet,
        armor: next.gear.armor,
      })
      applyRaidDamage(next, result)
      if (next.status === 'died') {
        makeLog(next, 'danger', '你倒下了，随身物资全部丢失。', now)
      }
      return { state: next }
    }
    case 'extractStart': {
      const room = map.rooms[next.currentRoom]
      if (!room || room.kind !== 'extract') return { state, error: '这里不能撤离' }
      if (roomContainsLivingEnemies(next, map, room.id)) return { state, error: '撤离区还有敌人' }
      if (next.extractionStartedAt !== null) return { state: next }
      next.extractionStartedAt = now
      next.extractionRoom = room.id
      makeLog(next, 'extract', '开始撤离读条，站稳别动……', now)
      return { state: next }
    }
    case 'extractDone': {
      if (next.extractionStartedAt === null) return { state, error: '还没有开始撤离' }
      if (now - next.extractionStartedAt < RAID_EXTRACT_CHANNEL_MS) {
        return { state, error: '撤离读条未完成' }
      }
      next.status = 'extracted'
      makeLog(next, 'success', '撤离成功！', now)
      return { state: next }
    }
    case 'abandon': {
      next.status = 'abandoned'
      makeLog(next, 'info', '主动放弃行动。', now)
      return { state: next }
    }
    default:
      return { state, error: '未知事件' }
  }
}

/** 批量应用事件（服务端入口）；任何非法事件只跳过并记录，不影响其余事件 */
export function applyRaidEvents(
  state: RaidRunState,
  map: RaidMapNode,
  events: readonly RaidEvent[],
  now: number,
): { state: RaidRunState; errors: string[]; applied: number } {
  let current = state
  const errors: string[] = []
  let applied = 0
  for (const event of events) {
    if (current.status !== 'active') break
    const result = applyRaidEvent(current, map, event, now)
    if (result.error) {
      errors.push(result.error)
      continue
    }
    current = result.state
    applied += 1
  }
  return { state: current, errors, applied }
}

/* ============================================================
   结算辅助
   ============================================================ */

/** 撤离保留全部容器；阵亡 / 失联 / 放弃只保留安全箱 */
export function raidKeptContainers(state: RaidRunState): {
  backpack: RaidItemStack[]
  rig: RaidItemStack[]
  safe: RaidItemStack[]
} {
  if (state.status === 'extracted') {
    return {
      backpack: state.backpack.map((stack) => ({ ...stack })),
      rig: state.rig.map((stack) => ({ ...stack })),
      safe: state.safe.map((stack) => ({ ...stack })),
    }
  }
  return {
    backpack: [],
    rig: [],
    safe: state.safe.map((stack) => ({ ...stack })),
  }
}

export function raidLootValue(stacks: readonly RaidItemStack[]): number {
  return stacks.reduce((sum, stack) => sum + raidItemValue(stack.itemKey) * stack.amount, 0)
}

export function raidTotalUnits(stacks: readonly RaidItemStack[]): number {
  return stacks.reduce((sum, stack) => sum + stack.amount, 0)
}

/** 状态是否已超时（服务端惰性结算用） */
export function raidExpired(state: RaidRunState, now: number): boolean {
  return state.status === 'active' && now >= state.expiresAt
}

/* ============================================================
   每日契约
   ============================================================ */

export interface RaidContractDef {
  key: string
  name: string
  description: string
  metric: 'extracts' | 'kills' | 'lootValue'
  target: number
  rewardPoints: number
}

export const RAID_CONTRACTS: readonly RaidContractDef[] = [
  { key: 'extract_1', name: '活着回来', description: '成功撤离 1 次', metric: 'extracts', target: 1, rewardPoints: 60 },
  { key: 'kill_3', name: '清道夫', description: '击杀 3 名敌人', metric: 'kills', target: 3, rewardPoints: 90 },
  { key: 'loot_2500', name: '满载而归', description: '单日带出价值 2500 积分的战利品', metric: 'lootValue', target: 2500, rewardPoints: 140 },
]

export const RAID_CONTRACT_MAP: ReadonlyMap<string, RaidContractDef> = new Map(
  RAID_CONTRACTS.map((contract) => [contract.key, contract]),
)
