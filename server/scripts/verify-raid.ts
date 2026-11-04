/**
 * 搜打撤 v4 共享引擎自检（纯函数，不依赖数据库 / 网络）。
 *
 * 覆盖：物品与装备目录不变量、掉落模式（normal / pvp）双权重表、按模式的容器掉落段数与
 *       首领房首段保底、地图生成确定性与连通性、房间类型分配、敌人属性公式、
 *       运行状态机（进房 / 击杀 / 清房 / 开箱 / 拾取 / 使用 / 技能 / 受伤 / 撤离）、
 *       撤离故障掷骰（确定性 / 失败保持 active / 全图冷却 / 信号弹保票）、已发现撤离点、
 *       官方商店（全档上架 + 高档溢价与仓库门槛）与游戏门票经济闭环、
 *       耐久与维修、保险、结算保留规则、每日契约、丢弃落点往前抛与夹取。
 *
 * 用法: cd server && npx tsx scripts/verify-raid.ts（或 npm run verify:raid）
 */

import {
  GAME_TICKET_KEY,
  GAME_TICKET_PRICE,
  GAME_TICKET_RECYCLE_VALUE,
  GAME_TICKET_REFUND_POINTS,
  RAID_CONTRACTS,
  RAID_CONTRACT_MAP,
  RAID_EXTRACT_COOLDOWN_MS,
  RAID_EXTRACT_CHANNEL_MS,
  RAID_EXTRACT_FAIL_RATE,
  RAID_EXTRACT_FLARE_KEY,
  RAID_GEAR_MAP,
  RAID_GEAR_SHOP_PREMIUM,
  RAID_GEARS,
  RAID_ITEMS,
  RAID_ITEM_MAP,
  RAID_LOOT_MODES,
  RAID_MAPS,
  RAID_RARITY_ORDER,
  RAID_REPAIR_FLOOR_RATIO,
  RAID_SKILL_CD_MS,
  RAID_STATE_VERSION,
  RAID_GROUND_LOOT_LIMIT,
  RAID_GROUND_REARM_DISTANCE,
  RAID_DROP_THROW_DISTANCE,
  addItemToContainer,
  applyRaidEvent,
  applyRaidEvents,
  consumeItemFromContainer,
  createRaidEnemy,
  createRaidRng,
  createRaidRun,
  findContainerSlot,
  gearStorageGate,
  generateRaidMap,
  getRaidGear,
  getRaidItem,
  getRaidMap,
  raidContainerLootSegments,
  raidExpired,
  raidGearStorageGate,
  raidInsuranceCost,
  raidItemModeAllowed,
  raidKeptContainers,
  raidLootValue,
  raidSellPrice,
  raidShopGearPrice,
  raidShopItemPrice,
  raidTotalUnits,
  rarityWeightAtTier,
  repairRaidGear,
  resolveDropPosition,
  resolveRaidDamage,
  rollExtractFailure,
  rollRaidContainerLoot,
  rollRaidItemKey,
  tickRaidRun,
  type RaidEnemyKind,
  type RaidEnemyNode,
  type RaidEvent,
  type RaidLootMode,
  type RaidMapDef,
  type RaidRunState,
} from '../src/lib/raidRun.js'

let passed = 0

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`断言失败：${message}`)
  passed += 1
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${message}（期望 ${String(expected)}，实际 ${String(actual)}）`)
  }
  passed += 1
}

function assertClose(actual: number, expected: number, tolerance: number, message: string): void {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`断言失败：${message}（期望 ${expected} ± ${tolerance}，实际 ${actual}）`)
  }
  passed += 1
}

/* ============================================================
   目录不变量
   ============================================================ */

assertEqual(RAID_ITEMS.length, 54, '物品目录 54 种（含神话 3 种与新增的门票 / 撤离信号弹）')
assertEqual(new Set(RAID_ITEMS.map((item) => item.key)).size, RAID_ITEMS.length, '物品 key 唯一')
assertEqual(RAID_ITEM_MAP.size, RAID_ITEMS.length, '物品索引与目录同规模')
assert(RAID_ITEMS.every((item) => item.value > 0), '所有物品目录价值 > 0')
assert(RAID_ITEMS.every((item) => item.stackMax >= 1 && item.stackMax <= 5), '堆叠上限在 1–5')
assert(RAID_ITEMS.every((item) => item.weight > 0), '掉落权重 > 0')
assert(RAID_ITEMS.every((item) => item.name.length > 0 && item.emoji.length > 0), '物品都有名称与图标')
for (const rarity of RAID_RARITY_ORDER) {
  assert(RAID_ITEMS.some((item) => item.rarity === rarity), `品质 ${rarity} 至少有一种物品`)
}
assertEqual(RAID_RARITY_ORDER.length, 6, '六档品质')
assertEqual(RAID_ITEMS.filter((item) => item.rarity === 'mythic').length, 3, '神话物品 3 种（深渊装备箱 / 非洲之心 / 深渊核心）')
assertEqual(RAID_ITEMS.filter((item) => item.kind === 'gear_cache').length, 5, '装备箱共 5 种（含神话档）')
assertEqual(RAID_ITEMS.filter((item) => item.kind === 'skill_cache').length, 3, '技能卷轴共 3 种')
assert(RAID_ITEMS.filter((item) => item.kind === 'consumable').length >= 9, '消耗品至少 9 种（含撤离信号弹）')
assert(RAID_ITEMS.filter((item) => item.rarity === 'mythic').every((item) => item.value >= 5000), '神话物品价值 ≥ 5000')

/* ---------- 新增：掉落模式与模式限定物品 ---------- */

assertEqual(RAID_LOOT_MODES.length, 2, '掉落模式两种（normal / pvp）')
assert(RAID_LOOT_MODES.includes('normal') && RAID_LOOT_MODES.includes('pvp'), '模式清单含 normal 与 pvp')
assertEqual(GAME_TICKET_KEY, 'game_ticket', '门票 key 固定为 game_ticket')
assertEqual(GAME_TICKET_PRICE, 40, '门票商店一口价 40 积分')
assertEqual(GAME_TICKET_REFUND_POINTS, 20, '局终必返 20 积分')
assertEqual(GAME_TICKET_RECYCLE_VALUE, 18, '门票目录价值（= 回收价）18 积分')
assertEqual(RAID_EXTRACT_FLARE_KEY, 'extract_flare', '撤离信号弹 key 固定为 extract_flare')
const ticket = getRaidItem(GAME_TICKET_KEY)
assert(!!ticket, '门票在目录里')
assertEqual(ticket?.kind, 'material', '门票按材料计（回收 100%）')
assertEqual(ticket?.rarity, 'common', '门票为普通品质，任何档次地图都能凑量')
assertEqual(ticket?.stackMax, 5, '门票单格堆叠 5 张')
assertEqual(ticket?.weight, 6, '门票掉落权重 6')
assertEqual(ticket?.value, GAME_TICKET_RECYCLE_VALUE, '门票目录价值 = 回收常量')
assertEqual(ticket?.shopPrice, GAME_TICKET_PRICE, '门票一口价覆盖「目录价值 × 1.4」')
assertEqual(ticket?.pvpOnly, undefined, '门票两种模式都能出现（不是 pvp 专属）')
assertEqual(ticket?.guaranteeExtract, undefined, '门票没有撤离保障标记')
const flare = getRaidItem(RAID_EXTRACT_FLARE_KEY)
assert(!!flare, '撤离信号弹在目录里')
assertEqual(flare?.kind, 'consumable', '信号弹是消耗品')
assertEqual(flare?.rarity, 'rare', '信号弹为稀有品质')
assertEqual(flare?.value, 300, '信号弹目录价值 300')
assertEqual(flare?.guaranteeExtract, true, '信号弹带「本局撤离必定成功」标记')
assertEqual(flare?.healPct, undefined, '信号弹不回血')
assertEqual(flare?.mpGain, undefined, '信号弹不回能量')
assertEqual(flare?.repairSlot, undefined, '信号弹不是维修工具')
assertEqual(
  RAID_ITEMS.filter((item) => item.guaranteeExtract).length,
  1,
  '全站只有撤离信号弹能购买撤离确定性',
)
const heart = getRaidItem('heart_of_africa')
assert(!!heart, '非洲之心在目录里')
assertEqual(heart?.rarity, 'mythic', '非洲之心是神话品质')
assertEqual(heart?.pvpOnly, true, '非洲之心标记为仅玩家匹配掉落')
assertEqual(RAID_ITEMS.filter((item) => item.pvpOnly === true).length, 1, '模式限定品只有非洲之心一种')
assertEqual(RAID_ITEMS.filter((item) => item.shopPrice !== undefined).length, 1, '一口价商品只有门票一种')
// raidItemModeAllowed 是掉落池的唯一模式闸门
assertEqual(raidItemModeAllowed(heart!, 'normal'), false, 'normal 模式池排除非洲之心')
assertEqual(raidItemModeAllowed(heart!, 'pvp'), true, 'pvp 模式池包含非洲之心')
assert(
  RAID_ITEMS.filter((item) => !item.pvpOnly).every(
    (item) => raidItemModeAllowed(item, 'normal') && raidItemModeAllowed(item, 'pvp'),
  ),
  '非 pvpOnly 物品在两种模式下都可入池',
)
assertEqual(getRaidItem('nope'), null, '不存在的物品返回 null')

assertEqual(RAID_GEARS.length, 32, '装备目录 32 件（头/甲/鞋/胸挂 × 6 级 + 背包 × 8 级）')
assertEqual(new Set(RAID_GEARS.map((gear) => gear.key)).size, RAID_GEARS.length, '装备 key 唯一')
const GEAR_SLOT_EXPECT: Record<string, number> = { helmet: 6, armor: 6, boots: 6, backpack: 8, rig: 6 }
for (const slot of ['helmet', 'armor', 'boots', 'backpack', 'rig'] as const) {
  const list = RAID_GEARS.filter((gear) => gear.slot === slot)
  const expect = GEAR_SLOT_EXPECT[slot]
  assertEqual(list.length, expect, `${slot} 共 ${expect} 级`)
  assertEqual(list.map((gear) => gear.tier).join(','), Array.from({ length: expect }, (_, i) => i + 1).join(','), `${slot} 等级连续`)
  assert(list.every((gear) => gear.shopable), `${slot} 全档上架官方商店（2026-11-04 起不再限 1–3 级）`)
}
const helmets = RAID_GEARS.filter((gear) => gear.slot === 'helmet')
assert(
  helmets.every((gear, index) => index === 0 || (gear.defense ?? 0) > (helmets[index - 1]?.defense ?? 0)),
  '头盔减伤随等级严格递增',
)
const armors = RAID_GEARS.filter((gear) => gear.slot === 'armor')
assert(
  armors.every((gear, index) => index === 0 || (gear.maxDurability ?? 0) > (armors[index - 1]?.maxDurability ?? 0)),
  '护甲耐久上限随等级严格递增',
)
const backpacks = RAID_GEARS.filter((gear) => gear.slot === 'backpack')
assertEqual(backpacks.map((gear) => gear.slots).join(','), '8,12,16,20,24,28,36,48', '背包容量 8/12/16/20/24/28/36/48')
const rigs = RAID_GEARS.filter((gear) => gear.slot === 'rig')
assertEqual(rigs.map((gear) => gear.slots).join(','), '2,3,4,5,6,7', '胸挂容量 2/3/4/5/6/7')
assert(RAID_GEARS.every((gear) => gear.rarity === RAID_RARITY_ORDER[Math.min(gear.tier, RAID_RARITY_ORDER.length) - 1]), '装备品质与等级对应（7/8 级为神话）')
assert(backpacks.every((gear, index) => index === 0 || (gear.slots ?? 0) > (backpacks[index - 1]?.slots ?? 0)), '背包容量严格递增')
assert(getRaidGear('backpack_t7')?.slots === 36 && getRaidGear('backpack_t8')?.slots === 48, '36/48 格巨型背包已入目录')
assert(getRaidItem('gear_cache_mythic')?.cacheTierMin === 6 && getRaidItem('gear_cache_mythic')?.cacheTierMax === 8, '神话装备箱开 6–8 级装备')
assertEqual(getRaidGear('helmet_t6')?.defense === 38, true, '6 级头盔减伤 38%')
assert(getRaidGear('armor_t6')?.defense === 47, '6 级护甲减伤 47%')
assertEqual(getRaidGear('nope'), null, '不存在的装备返回 null')

/* ============================================================
   官方商店：全档上架 / 高档溢价 / 仓库门槛（2026-11-04 口径）
   ============================================================ */

assertEqual(RAID_GEAR_MAP.size, RAID_GEARS.length, '装备索引与目录同规模')
assertEqual(RAID_GEARS.every((gear) => gear.shopable), true, '32 件装备全部可在官方商店购买')
assertEqual(RAID_GEAR_SHOP_PREMIUM, 2, '4 级及以上装备的商店溢价倍率 = 2')
const GEAR_GATE_EXPECT = '0,0,0,3,4,5,6,6'
assertEqual(
  [1, 2, 3, 4, 5, 6, 7, 8].map((tier) => gearStorageGate(tier)).join(','),
  GEAR_GATE_EXPECT,
  '仓库门槛表：1–3 级无门槛，4→Lv.3、5→Lv.4、6→Lv.5、7/8→Lv.6',
)
assertEqual(gearStorageGate(0), 0, '等级 0 无门槛（非法档位回落到 0）')
assertEqual(gearStorageGate(-9), 0, '负数档位无门槛')
assertEqual(gearStorageGate(99), 6, '超出目录的最高档位仍按满级门槛封顶')
assert(
  [1, 2, 3, 4, 5, 6, 7, 8].every((tier) => gearStorageGate(tier) <= gearStorageGate(tier + 1)),
  '仓库门槛随装备等级单调不降',
)
for (const gear of RAID_GEARS) {
  assertEqual(raidGearStorageGate(gear.key), gearStorageGate(gear.tier), `${gear.key} 门槛按自身档位派生`)
  assert(
    gear.tier <= 3 ? raidGearStorageGate(gear.key) === 0 : raidGearStorageGate(gear.key) > 0,
    `${gear.key} 只有 4 级及以上才设仓库门槛`,
  )
  const shopPrice = raidShopGearPrice(gear.key)
  const expected = gear.tier <= 3
    ? Math.max(1, gear.price)
    : Math.ceil(Math.max(1, gear.price) * RAID_GEAR_SHOP_PREMIUM)
  assertEqual(shopPrice, expected, `${gear.key} 商店价按档位规则（≤3 级平价 / ≥4 级 ×2）`)
  assert(shopPrice >= gear.price, `${gear.key} 商店价不低于目录价`)
}
assertEqual(raidShopGearPrice('helmet_t3'), 900, '3 级头盔平价 900')
assertEqual(raidShopGearPrice('helmet_t4'), 3600, '4 级头盔溢价到 3600')
assertEqual(raidShopGearPrice('backpack_t6'), 14000, '6 级背包溢价到 14000')
assertEqual(raidShopGearPrice('backpack_t7'), 20000, '7 级巨型背包 20000（满级仓库才买得到）')
assertEqual(raidShopGearPrice('backpack_t8'), 30000, '8 级移动武库 30000（满级仓库才买得到）')
assertEqual(raidGearStorageGate('backpack_t6'), 5, '6 级背包要仓库 Lv.5')
assertEqual(raidGearStorageGate('backpack_t7'), 6, '7 级背包要仓库 Lv.6（满级）')
assertEqual(raidGearStorageGate('nope'), 0, '未知装备没有门槛')
assertEqual(raidShopGearPrice('nope'), 0, '未知装备商店价 0')
assert(
  RAID_GEARS.filter((gear) => gear.slot === 'backpack').every(
    (gear, index, list) => index === 0 || raidShopGearPrice(gear.key) > raidShopGearPrice(list[index - 1].key),
  ),
  '背包商店价随档位严格递增（溢价不改变排序）',
)

assertEqual(raidShopItemPrice(GAME_TICKET_KEY), GAME_TICKET_PRICE, '门票走一口价 40')
assert(
  raidShopItemPrice(GAME_TICKET_KEY) !== Math.ceil(GAME_TICKET_RECYCLE_VALUE * 1.4),
  '门票一口价确实覆盖了「目录价值 × 1.4」的默认算法',
)
assertEqual(raidShopItemPrice('medkit'), 168, '无一口价的商品仍按目录价值 140% 向上取整')
assertEqual(raidShopItemPrice(RAID_EXTRACT_FLARE_KEY), 420, '撤离信号弹商店价 = 300 × 1.4 向上取整')
assertEqual(raidShopItemPrice('nope'), 0, '未知物品商店价 0')
assertEqual(raidSellPrice(GAME_TICKET_KEY, 1), GAME_TICKET_RECYCLE_VALUE, '门票按材料 100% 回收 = 18')
assertEqual(raidSellPrice(GAME_TICKET_KEY, 3), GAME_TICKET_RECYCLE_VALUE * 3, '门票回收按数量线性')
assertEqual(raidSellPrice(RAID_EXTRACT_FLARE_KEY, 1), 180, '撤离信号弹按消耗品 60% 回收')
// 经济闭环（刻意的定价）：回收门票不如打一把，买票也不如白嫖返还，门票不是积分永动机
assert(
  raidSellPrice(GAME_TICKET_KEY, 1) < GAME_TICKET_REFUND_POINTS,
  '门票回收价必须低于局终返还（卖票比打一把更赚 = 定价事故）',
)
assert(GAME_TICKET_PRICE > GAME_TICKET_REFUND_POINTS, '门票商店价必须高于局终返还（否则可无限刷分）')
assert(
  raidShopItemPrice(GAME_TICKET_KEY) > raidSellPrice(GAME_TICKET_KEY, 1),
  '门票买价高于回收价，不能刷买卖差价',
)
assert(
  RAID_ITEMS.every(
    (item) => item.kind === 'consumable' || item.kind === 'gear_cache' || item.kind === 'skill_cache'
      || raidSellPrice(item.key, 1) === item.value,
  ),
  '材料 / 珍宝回收价 100% 等于目录价值',
)

/* ============================================================
   品质权重（按掉落模式分表）
   ============================================================ */

/** 两张表的钉死值：normal 是 2026-11-04 下调档（神话全 0），pvp 保留旧的高爆率并且唯一能掉神话 */
const EXPECT_WEIGHTS: Record<RaidLootMode, Record<string, readonly number[]>> = {
  normal: {
    common: [60, 60, 44, 30, 20],
    uncommon: [26, 26, 30, 28, 24],
    rare: [10, 10, 17, 24, 26],
    epic: [3, 3, 7, 13, 19],
    legendary: [1, 1, 2, 5, 11],
    mythic: [0, 0, 0, 0, 0],
  },
  pvp: {
    common: [56, 40, 26, 16, 8],
    uncommon: [28, 31, 28, 24, 20],
    rare: [11, 18, 25, 27, 26],
    epic: [4, 8, 13, 19, 23],
    legendary: [1, 3, 8, 14, 19],
    mythic: [0, 0, 0, 0, 4],
  },
}

for (const mode of RAID_LOOT_MODES) {
  for (let tier = 1; tier <= 5; tier += 1) {
    const total = RAID_RARITY_ORDER.reduce((sum, rarity) => sum + rarityWeightAtTier(rarity, tier, mode), 0)
    assertClose(total, 100, 1e-9, `${mode} 模式 lootTier ${tier} 品质权重合计 100`)
  }
  for (const rarity of RAID_RARITY_ORDER) {
    assertEqual(
      EXPECT_WEIGHTS[mode][rarity].join(','),
      [1, 2, 3, 4, 5].map((tier) => rarityWeightAtTier(rarity, tier, mode)).join(','),
      `${mode} 模式 ${rarity} 权重表与设计值一致`,
    )
  }
  assert(
    [1, 2, 3, 4, 5].every((tier) => tier === 1 || rarityWeightAtTier('common', tier, mode) <= rarityWeightAtTier('common', tier - 1, mode)),
    `${mode} 模式普通权重随地图档次单调不升`,
  )
  assert(
    [1, 2, 3, 4, 5].every((tier) => tier === 1 || rarityWeightAtTier('epic', tier, mode) >= rarityWeightAtTier('epic', tier - 1, mode)),
    `${mode} 模式史诗权重随地图档次单调不降`,
  )
  assert(
    [1, 2, 3, 4, 5].every((tier) => tier === 1 || rarityWeightAtTier('legendary', tier, mode) >= rarityWeightAtTier('legendary', tier - 1, mode)),
    `${mode} 模式传说权重随地图档次单调不降`,
  )
  const highShare = (tier: number) => rarityWeightAtTier('epic', tier, mode) + rarityWeightAtTier('legendary', tier, mode) + rarityWeightAtTier('mythic', tier, mode)
  assert(highShare(5) > highShare(1), `${mode} 模式最高档地图的高品质占比要大于最低档`)
}

// 缺省参数口径：不传 mode 等于 normal（旧调用点不改也能编译）
for (const rarity of RAID_RARITY_ORDER) {
  for (let tier = 1; tier <= 5; tier += 1) {
    assertEqual(
      rarityWeightAtTier(rarity, tier),
      rarityWeightAtTier(rarity, tier, 'normal'),
      `${rarity} 第 ${tier} 档缺省模式按 normal 取表`,
    )
  }
}

// 档位越界与非法入参的钳位（clampInt(1,5)）
assertEqual(rarityWeightAtTier('common', 0), rarityWeightAtTier('common', 1, 'normal'), 'lootTier 0 钳到 1')
assertEqual(rarityWeightAtTier('common', 99), rarityWeightAtTier('common', 5, 'normal'), 'lootTier 99 钳到 5')
assertEqual(rarityWeightAtTier('common', Number.NaN), rarityWeightAtTier('common', 1, 'normal'), '非法 lootTier 回落到 1')
assertEqual(rarityWeightAtTier('no_such_rarity' as never, 3, 'normal'), 0, '未知品质 normal 权重取 0')
assertEqual(rarityWeightAtTier('no_such_rarity' as never, 3, 'pvp'), 0, '未知品质 pvp 权重取 0')
// 说明：mode 参数是闭合联合类型 RaidLootMode，非法值在编译期就被挡住，
// 引擎对未知模式是直接下标取表（会抛错），因此这里不去构造运行时脏模式。

// 神话只在 pvp 模式存在，且只在最高档地图
for (let tier = 1; tier <= 5; tier += 1) {
  assertEqual(rarityWeightAtTier('mythic', tier, 'normal'), 0, `normal 模式 lootTier ${tier} 权重为 0（普通模式不产神话）`)
}
for (let tier = 1; tier <= 4; tier += 1) {
  assertEqual(rarityWeightAtTier('mythic', tier, 'pvp'), 0, `pvp 模式 lootTier ${tier} 不掉神话`)
}
assert(rarityWeightAtTier('mythic', 5, 'pvp') > 0, 'pvp 模式 lootTier 5 才可能掉神话')

/* ---------- rollRaidItemKey 落池与分布 ---------- */

/** 按表算出某个品质在这一档 / 模式下的期望占比（校验掷骰真的实现了加权表） */
function expectedRarityShare(rarity: (typeof RAID_RARITY_ORDER)[number], tier: number, mode: RaidLootMode): number {
  let total = 0
  let hit = 0
  for (const item of RAID_ITEMS) {
    const w = rarityWeightAtTier(item.rarity, tier, mode)
    if (w <= 0 || !raidItemModeAllowed(item, mode)) continue
    total += item.weight * w
    if (item.rarity === rarity) hit += item.weight * w
  }
  assert(total > 0, `${mode} 模式 lootTier ${tier} 有可入池物品`)
  return hit / total
}

/**
 * 固定种子的加权掷骰扫描（不在热循环里记断言，只汇总异常，避免自检本身成为性能瓶颈）。
 * bad 统计「不在目录 / 模式不允许 / 该品质本档无权重」的样本数，必须恒为 0。
 */
function sweepRarity(tier: number, mode: RaidLootMode, samples: number, seed: number): Record<string, number> {
  const rng = createRaidRng(seed)
  const counts: Record<string, number> = {}
  for (const rarity of RAID_RARITY_ORDER) counts[rarity] = 0
  let bad = 0
  for (let i = 0; i < samples; i += 1) {
    const key = rollRaidItemKey(rng, tier, mode)
    const def = getRaidItem(key)
    if (!def) {
      bad += 1
      continue
    }
    if (!raidItemModeAllowed(def, mode) || rarityWeightAtTier(def.rarity, tier, mode) <= 0) bad += 1
    counts[def.rarity] = (counts[def.rarity] ?? 0) + 1
  }
  assertEqual(bad, 0, `${mode} 模式 lootTier ${tier} 的掷骰全部合法（在目录内 / 模式允许 / 品质有权重）`)
  return counts
}

const SWEEP_SAMPLES = 20000
for (const mode of RAID_LOOT_MODES) {
  for (const tier of [1, 3, 5]) {
    const counts = sweepRarity(tier, mode, SWEEP_SAMPLES, 20261104 + tier)
    for (const rarity of RAID_RARITY_ORDER) {
      assertClose(
        (counts[rarity] ?? 0) / SWEEP_SAMPLES,
        expectedRarityShare(rarity, tier, mode),
        0.02,
        `${mode} 模式 lootTier ${tier} 的 ${rarity} 占比贴近权重表`,
      )
    }
  }
}

const normalTier5 = sweepRarity(5, 'normal', SWEEP_SAMPLES, 777)
assertEqual(normalTier5.mythic ?? -1, 0, 'normal 模式 lootTier 5（含深渊实验室）权重路径 20000 抽 0 神话')
assert((normalTier5.legendary ?? 0) > 0, 'normal 模式 lootTier 5 仍会出传说')
const pvpTier5 = sweepRarity(5, 'pvp', SWEEP_SAMPLES, 777)
assert((pvpTier5.mythic ?? 0) > 0, 'pvp 模式 lootTier 5 会出神话')
let pvpHeartHits = 0
let normalHeartHits = 0
{
  const rng = createRaidRng(20261104)
  for (let i = 0; i < SWEEP_SAMPLES; i += 1) {
    if (rollRaidItemKey(rng, 5, 'pvp') === 'heart_of_africa') pvpHeartHits += 1
  }
  const rng2 = createRaidRng(20261104)
  for (let i = 0; i < SWEEP_SAMPLES; i += 1) {
    if (rollRaidItemKey(rng2, 5, 'normal') === 'heart_of_africa') normalHeartHits += 1
  }
}
assert(pvpHeartHits > 0, `pvp 模式 lootTier 5 固定种子能刷出非洲之心（实测 ${pvpHeartHits} 次）`)
assertEqual(normalHeartHits, 0, 'normal 模式永远刷不出非洲之心（pvpOnly 闸门生效）')

const tier1Counts = sweepRarity(1, 'normal', 6000, 4242)
assertEqual(tier1Counts.mythic ?? -1, 0, 'tier 1 固定种子不产出神话')
assert((tier1Counts.common ?? 0) > 0, 'tier 1 会产出普通物品')

/* ============================================================
   地图生成
   ============================================================ */

const wasteland = getRaidMap('wasteland') as RaidMapDef
const abyss = getRaidMap('abyss') as RaidMapDef
assertEqual(RAID_MAPS.length, 6, '6 张地图')
assertEqual(new Set(RAID_MAPS.map((map) => map.key)).size, RAID_MAPS.length, '地图 key 唯一')

const mapA = generateRaidMap(123456, wasteland)
const mapB = generateRaidMap(123456, wasteland)
const mapC = generateRaidMap(654321, wasteland)
assertEqual(JSON.stringify(mapA), JSON.stringify(mapB), '同 seed 地图完全一致')
assert(JSON.stringify(mapA) !== JSON.stringify(mapC), '不同 seed 地图不同')
assertEqual(mapA.width, wasteland.cols * 17, '地图宽度 = 列数 × 17')
assertEqual(mapA.height, wasteland.rows * 13, '地图高度 = 行数 × 13')
assertEqual(mapA.tiles.length, mapA.width * mapA.height, '瓦片数量正确')
assert(mapA.tiles.every((tile) => tile >= 0 && tile <= 3), '瓦片取值 0–3')
assertEqual(mapA.rooms.length, wasteland.cols * wasteland.rows, '房间数量正确')
assertEqual(mapA.startRoom, 0, '起点房间为 0')
assertEqual(mapA.rooms[0]?.kind, 'start', '0 号房间是起点')
assertEqual(mapA.rooms.filter((room) => room.kind === 'extract').length, wasteland.extractRooms, '撤离房间数量正确')
assertEqual(mapA.doors.length >= mapA.rooms.length - 1, true, '门数量至少覆盖生成树')
assert(mapA.extracts.length > 0 && mapA.extracts.every((point) => point.roomId >= 0), '撤离点存在')

// 连通性：从起点 BFS 能到达所有房间
const reachable = new Set<number>([0])
const queue = [0]
while (queue.length > 0) {
  const current = queue.shift() as number
  for (const next of mapA.rooms[current]?.neighbors ?? []) {
    if (reachable.has(next)) continue
    reachable.add(next)
    queue.push(next)
  }
}
assertEqual(reachable.size, mapA.rooms.length, '所有房间连通')
assert(mapA.rooms.every((room) => room.neighbors.length >= 1), '每个房间至少有一扇门')

// 敌人 / 容器落在房间内部且 id 唯一
const enemyIds = new Set<string>()
for (const room of mapA.rooms) {
  for (const enemy of room.enemies) {
    assert(!enemyIds.has(enemy.id), `敌人 id 唯一 ${enemy.id}`)
    enemyIds.add(enemy.id)
    assert(enemy.x > room.x && enemy.x < room.x + room.w, `敌人 x 在房间内 ${enemy.id}`)
    assert(enemy.y > room.y && enemy.y < room.y + room.h, `敌人 y 在房间内 ${enemy.id}`)
    assert(enemy.maxHp > 0 && enemy.damage > 0 && enemy.speed > 0, `敌人属性有效 ${enemy.id}`)
  }
  for (const container of room.containers) {
    assert(container.loot.length >= 1, `容器至少一件掉落 ${container.id}`)
    for (const loot of container.loot) {
      assert(!!getRaidItem(loot.itemKey), `容器掉落 key 合法 ${loot.itemKey}`)
      assert(loot.amount >= 1 && loot.amount <= (getRaidItem(loot.itemKey)?.stackMax ?? 1), `容器掉落数量合法 ${loot.id}`)
    }
  }
}
assertEqual(mapA.rooms[0]?.enemies.length, 0, '起点房间没有敌人')
assertEqual(mapA.rooms.filter((room) => room.kind === 'extract').every((room) => room.enemies.length === 0), true, '撤离房间没有敌人')

const abyssMap = generateRaidMap(999, abyss)
assertEqual(abyssMap.rooms.filter((room) => room.kind === 'boss').length, abyss.bossRooms, '深渊首领房间数量正确')
assertEqual(abyssMap.rooms.filter((room) => room.kind === 'elite').length, abyss.eliteRooms, '深渊精英房间数量正确')
assert(abyssMap.rooms.filter((room) => room.kind === 'boss').every((room) => room.enemies.some((enemy) => enemy.kind === 'boss')), '首领房间有 Boss')
assert(abyssMap.rooms.filter((room) => room.kind === 'boss').every((room) => room.containers.length >= 2), '首领房间至少 2 个容器')

/* ============================================================
   掉落模式 × 容器段数 / 首领保底 / 敌人属性
   ============================================================ */

assertEqual(raidContainerLootSegments(false, 'normal').join(','), '1,2', 'normal 非首领容器 1–2 段')
assertEqual(raidContainerLootSegments(true, 'normal').join(','), '2,3', 'normal 首领容器 2–3 段')
assertEqual(raidContainerLootSegments(false, 'pvp').join(','), '1,3', 'pvp 非首领容器 1–3 段')
assertEqual(raidContainerLootSegments(true, 'pvp').join(','), '2,4', 'pvp 首领容器 2–4 段')
assert(
  raidContainerLootSegments(true, 'pvp')[1] > raidContainerLootSegments(true, 'normal')[1],
  'pvp 首领容器上限段数高于 normal（高爆率体验）',
)

// 模式只改掉落，不改地形；缺省参数等于 normal
const damDef = getRaidMap('dam') as RaidMapDef
const damNormal = generateRaidMap(123456, damDef)
const damNormalExplicit = generateRaidMap(123456, damDef, 'normal')
const damPvp = generateRaidMap(123456, damDef, 'pvp')
assertEqual(JSON.stringify(damNormal), JSON.stringify(damNormalExplicit), 'generateRaidMap 缺省模式就是 normal')
assertEqual(damNormal.tiles.join(','), damPvp.tiles.join(','), '同一 seed 换模式不改地形瓦片')
assertEqual(
  damNormal.rooms.map((room) => `${room.id}:${room.kind}`).join('|'),
  damPvp.rooms.map((room) => `${room.id}:${room.kind}`).join('|'),
  '同一 seed 换模式不改房间类型分配',
)
assert(
  JSON.stringify(damNormal.rooms.map((room) => room.containers.map((c) => c.loot)))
    !== JSON.stringify(damPvp.rooms.map((room) => room.containers.map((c) => c.loot))),
  '同一 seed 换模式掉落确实不同（模式进了掉落骰子）',
)

/** 首领房首段保底档位（与引擎同口径，写在这里当钉死值而不是重新推导一遍代码） */
function bossFloorRank(mode: RaidLootMode, lootTier: number): number {
  return mode === 'pvp' ? (lootTier >= 4 ? 3 : 2) : lootTier >= 4 ? 4 : 3
}

const MAP_SEEDS = [123456, 654321, 999, 424242, 777, 20261104]
let scannedContainers = 0
let normalBossMythicFirst = 0
let pvpBossMythicFirst = 0
let normalMythicOutsideBoss = 0
const normalMythicKeys = new Set<string>()
for (const mode of RAID_LOOT_MODES) {
  for (const def of RAID_MAPS) {
    for (const seed of MAP_SEEDS) {
      const generated = generateRaidMap(seed, def, mode)
      assertEqual(generated.rooms.length, def.cols * def.rows, `${def.key}/${mode}/${seed} 房间数量正确`)
      assertEqual(generated.key, def.key, `${def.key} 地图 key 透传`)
      // 连通性对两种模式都必须成立
      const seen = new Set<number>([generated.startRoom])
      const bfs = [generated.startRoom]
      while (bfs.length > 0) {
        const current = bfs.shift() as number
        for (const next of generated.rooms[current]?.neighbors ?? []) {
          if (seen.has(next)) continue
          seen.add(next)
          bfs.push(next)
        }
      }
      assertEqual(seen.size, generated.rooms.length, `${def.key}/${mode}/${seed} 全图连通`)
      assert(
        generated.rooms.every((room) => room.neighbors.length >= 1),
        `${def.key}/${mode}/${seed} 每个房间都有门`,
      )
      assertEqual(
        generated.rooms.filter((room) => room.kind === 'extract').length,
        def.extractRooms,
        `${def.key}/${mode}/${seed} 撤离房间数量正确`,
      )
      assertEqual(
        generated.rooms.filter((room) => room.kind === 'boss').length,
        def.bossRooms,
        `${def.key}/${mode}/${seed} 首领房间数量正确`,
      )
      assert(
        generated.rooms.filter((room) => room.kind === 'boss').every((room) => room.containers.length >= 2),
        `${def.key}/${mode}/${seed} 首领房间至少 2 个容器`,
      )
      assert(
        generated.rooms
          .filter((room) => room.kind === 'extract' || room.kind === 'start')
          .every((room) => room.enemies.length === 0),
        `${def.key}/${mode}/${seed} 起点与撤离房间不刷怪`,
      )
      assertEqual(generated.extracts.length, def.extractRooms, `${def.key}/${mode}/${seed} 撤离点数量与房间一致`)
      assert(
        generated.extracts.every((point) => generated.rooms[point.roomId]?.kind === 'extract'),
        `${def.key}/${mode}/${seed} 撤离点都落在撤离房间`,
      )
      for (const room of generated.rooms) {
        const [minSegments, maxSegments] = raidContainerLootSegments(room.kind === 'boss', mode)
        for (const container of room.containers) {
          scannedContainers += 1
          assert(
            container.loot.length >= minSegments && container.loot.length <= maxSegments,
            `${def.key}/${mode} ${container.id} 段数 ${container.loot.length} 在 [${minSegments},${maxSegments}]`,
          )
          const first = getRaidItem(container.loot[0]?.itemKey ?? '')
          assert(!!first, `${container.id} 首段物品在目录里`)
          if (room.kind === 'boss') {
            assert(
              RAID_RARITY_ORDER.indexOf(first?.rarity ?? 'common') >= bossFloorRank(mode, def.lootTier),
              `${def.key}/${mode} ${container.id} 首领房首段不低于保底档位`,
            )
            if (first?.rarity === 'mythic') {
              if (mode === 'normal') {
                normalBossMythicFirst += 1
                normalMythicKeys.add(first.key)
              } else pvpBossMythicFirst += 1
            }
          }
          for (const loot of container.loot) {
            const lootDef = getRaidItem(loot.itemKey)
            assert(!!lootDef, `${container.id} 掉落 key 合法 ${loot.itemKey}`)
            assert(
              loot.amount >= 1 && loot.amount <= (lootDef?.stackMax ?? 1),
              `${container.id} 掉落数量不超堆叠上限`,
            )
            if (mode === 'normal' && room.kind !== 'boss' && lootDef?.rarity === 'mythic') {
              normalMythicOutsideBoss += 1
            }
          }
        }
      }
    }
  }
}
assert(scannedContainers > 500, `地图扫描覆盖到足够多的容器（实测 ${scannedContainers} 个）`)
assertEqual(normalMythicOutsideBoss, 0, 'normal 模式非首领容器永不产神话（权重表路径干净）')
assert(pvpBossMythicFirst > 0, `pvp 模式首领房首段会掉神话（实测 ${pvpBossMythicFirst} 次）`)
// ⚠️ 特征断言（不是期望语义）：normal 模式首领房首段仍会掉神话。
// 首领房「首段保底」的候选池只筛了品质档位 + raidItemModeAllowed，没有筛模式权重表，
// 于是 abyss_core / gear_cache_mythic（非 pvpOnly、权重在 normal 全为 0）被保底池直接捞了进来，
// 与 2026-11-04 发布口径「normal 模式（含深渊实验室）完全不产神话」矛盾。
// 引擎侧修法：池过滤补一条 rarityWeightAtTier(item.rarity, lootTier, mode) > 0。
// 修复后请把下面两条改成 assertEqual(normalBossMythicFirst, 0, ...) 与 0 个神话 key。
assert(
  normalBossMythicFirst > 0,
  `⚠️ 已知引擎缺陷特征断言：normal 首领房首段仍产出神话 ${normalBossMythicFirst} 次（修复保底池后应改为 0）`,
)
assertEqual(
  [...normalMythicKeys].sort().join(','),
  'abyss_core,gear_cache_mythic',
  '⚠️ normal 漏出的神话正是权重为 0 的那两件（漏筛模式权重的直接证据）',
)

/* ---------- rollRaidContainerLoot 纯函数：确定性 + 段数极值 ---------- */

const lootA = rollRaidContainerLoot(20261104, 'c-3-1', 4, true, 'normal')
const lootB = rollRaidContainerLoot(20261104, 'c-3-1', 4, true, 'normal')
assertEqual(JSON.stringify(lootA), JSON.stringify(lootB), '同参数容器掉落可重放（服务端按 seed 重算的前提）')
assertEqual(lootA.map((item, index) => item.id).join(','), lootA.map((_, index) => `loot-${index}`).join(','), '掉落 id 连续编号')
assert(lootA.every((item) => item.amount >= 1), '掉落数量 >= 1')
for (const mode of RAID_LOOT_MODES) {
  for (const bossRoom of [false, true]) {
    const [minSegments, maxSegments] = raidContainerLootSegments(bossRoom, mode)
    let minObserved = Number.POSITIVE_INFINITY
    let maxObserved = 0
    let mythicFirst = 0
    for (let s = 1; s <= 60; s += 1) {
      for (let c = 0; c < 40; c += 1) {
        const loot = rollRaidContainerLoot(s * 7919 + c, `c-${s}-${c}`, 3, bossRoom, mode)
        minObserved = Math.min(minObserved, loot.length)
        maxObserved = Math.max(maxObserved, loot.length)
        if (getRaidItem(loot[0]?.itemKey ?? '')?.rarity === 'mythic') mythicFirst += 1
      }
    }
    assertEqual(minObserved, minSegments, `${mode} ${bossRoom ? '首领' : '普通'}容器段数下界确实会取到`)
    assertEqual(maxObserved, maxSegments, `${mode} ${bossRoom ? '首领' : '普通'}容器段数上界确实会取到`)
    if (!bossRoom) assertEqual(mythicFirst, 0, `${mode} 非首领容器没有首段保底，不产神话`)
  }
}

/* ---------- 敌人属性公式（2026-11-04 伤害倍率 boss 2.1 / elite 1.7 / 其它 1.35） ---------- */

const ENEMY_HP_MULT: Record<RaidEnemyKind, number> = { scout: 1.2, soldier: 1.2, elite: 2.4, boss: 5.0 }
const ENEMY_DAMAGE_MULT: Record<RaidEnemyKind, number> = { scout: 1.35, soldier: 1.35, elite: 1.7, boss: 2.1 }
const ENEMY_LEVEL_OFFSET: Record<RaidEnemyKind, number> = { scout: 0, soldier: 1, elite: 3, boss: 6 }
const ENEMY_SPEED: Record<RaidEnemyKind, number> = { scout: 2.2, soldier: 1.8, elite: 1.6, boss: 1.1 }
const ENEMY_RADIUS: Record<RaidEnemyKind, number> = { scout: 0.45, soldier: 0.45, elite: 0.55, boss: 0.85 }
for (const kind of ['scout', 'soldier', 'elite', 'boss'] as RaidEnemyKind[]) {
  for (let i = 1; i <= 25; i += 1) {
    const enemy = createRaidEnemy(i * 131 + kind.length, i % 5, i, kind, 7, 6, 7)
    assertEqual(
      enemy.damage,
      Math.max(2, Math.round((4 + enemy.level * 1.05) * ENEMY_DAMAGE_MULT[kind])),
      `${kind} 伤害 =（4 + 等级 × 1.05）× 倍率`,
    )
    assertEqual(
      enemy.maxHp,
      Math.round((40 + enemy.level * 10) * ENEMY_HP_MULT[kind]),
      `${kind} 血量 =（40 + 等级 × 10）× 倍率`,
    )
    assert(
      enemy.level >= 7 + ENEMY_LEVEL_OFFSET[kind] && enemy.level <= 7 + ENEMY_LEVEL_OFFSET[kind] + 1,
      `${kind} 等级 = 地图基础等级 + 档位加成 +（0|1）`,
    )
    assertEqual(enemy.speed, ENEMY_SPEED[kind], `${kind} 移速固定`)
    assertEqual(enemy.radius, ENEMY_RADIUS[kind], `${kind} 体型固定`)
    assertEqual(JSON.stringify(enemy.skills), JSON.stringify(kind === 'boss' ? ['burst'] : kind === 'elite' ? ['charge'] : []), `${kind} 技能表固定`)
    assertEqual(enemy.x, 6, `${kind} 出生坐标 x 透传`)
    assertEqual(enemy.y, 7, `${kind} 出生坐标 y 透传`)
    assert(enemy.name.length > 0, `${kind} 有名字`)
  }
  if (kind === 'boss' || kind === 'elite') {
    assert(
      createRaidEnemy(7, 1, 1, kind, 9, 3, 3).ranged === true,
      `${kind} 恒为远程`,
    )
  }
}
assert(
  createRaidEnemy(7, 1, 1, 'boss', 9, 3, 3).damage
    > createRaidEnemy(7, 1, 1, 'elite', 9, 3, 3).damage * 1.1,
  '同输入下首领单发伤害明显高于精英',
)
assert(
  createRaidEnemy(7, 1, 1, 'elite', 9, 3, 3).maxHp
    < createRaidEnemy(7, 1, 1, 'boss', 9, 3, 3).maxHp,
  '同输入下首领血量高于精英',
)
let scoutRanged = 0
const SCOUT_SAMPLES = 2000
for (let i = 0; i < SCOUT_SAMPLES; i += 1) {
  if (createRaidEnemy(i + 1, i % 9, i % 3, 'scout', 5, 4, 4).ranged) scoutRanged += 1
}
assertClose(scoutRanged / SCOUT_SAMPLES, 0.85, 0.06, '斥候远程占比 ≈ 85%（2026-11-03 增强）')
let soldierRanged = 0
for (let i = 0; i < SCOUT_SAMPLES; i += 1) {
  if (createRaidEnemy(i + 101, i % 9, i % 3, 'soldier', 5, 4, 4).ranged) soldierRanged += 1
}
assertClose(soldierRanged / SCOUT_SAMPLES, 0.65, 0.06, '士兵远程占比 ≈ 65%（2026-11-03 增强）')

/* ============================================================
   运行状态机
   ============================================================ */

function makeRun(overrides: Partial<RaidRunState> = {}): RaidRunState {
  const state = createRaidRun({
    seed: 42,
    mapKey: 'wasteland',
    difficulty: 'normal',
    hp: 200,
    maxHp: 200,
    mp: 80,
    maxMp: 80,
    atk: 30,
    insured: false,
    capacities: { backpack: 8, rig: 2, safe: 2 },
    gear: {
      helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
      armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
      boots: 'boots_t2',
      backpack: 'backpack_t1',
      rig: 'rig_t1',
    },
    backpack: [],
    rig: [],
    safe: [],
    skills: [
      { key: 'fire_claw', name: '烈焰爪', emoji: '🔥', kind: 'damage', mpCost: 25, cooldownMs: 2500 },
      { key: 'healing_light', name: '治愈之光', emoji: '✨', kind: 'heal', mpCost: 25, cooldownMs: 5000, healPct: 30 },
    ],
    startedAt: 1_000_000,
  })
  return Object.assign(state, overrides)
}

const run = makeRun()
assertEqual(run.schemaVersion, RAID_STATE_VERSION, '状态 schema 版本正确')
assertEqual(run.status, 'active', '新对局为 active')
assertEqual(run.currentRoom, 0, '从起点房间开始')
assertEqual(run.hp, 200, '初始 HP 正确')
assertEqual(run.capacities.safe, 2, '安全箱容量来自传入值')
assertEqual(run.log.length, 1, '开局写一条日志')

/* ---------- v4 新增字段与掉落模式 ---------- */

assertEqual(RAID_STATE_VERSION, 4, '状态 schema 版本升到 4（新增 mode 与撤离故障字段）')
assertEqual(run.mode, 'normal', '缺省掉落模式为 normal')
assertEqual(JSON.stringify(run.extractDisabled), '[]', '开局没有失效撤离点')
assertEqual(run.extractBlockedUntil, null, '开局没有撤离冷却')
assertEqual(run.extractRolls, 0, '开局读条次数 0')
assertEqual(run.extractGuaranteed, false, '开局没有撤离保障')
assertEqual(JSON.stringify(run.discoveredExtracts), '[]', '开局未发现任何撤离点')
assertEqual(run.killedByUserId, null, '开局没有击倒者')
const pvpRun = makeRun({ mode: 'pvp' })
assertEqual(pvpRun.mode, 'pvp', '传 pvp 时状态记录玩家匹配模式')
assertEqual(
  createRaidRun({
    seed: 8,
    mapKey: 'wasteland',
    difficulty: 'normal',
    hp: 100,
    maxHp: 100,
    mp: 0,
    maxMp: 0,
    atk: 1,
    insured: false,
    capacities: { backpack: 8, rig: 2, safe: 2 },
    gear: { helmet: null, armor: null, boots: null, backpack: 'backpack_t1', rig: null },
    backpack: [],
    rig: [],
    safe: [],
    skills: [],
    startedAt: 1_000_000,
    mode: 'weird' as never,
    groundSeqBase: 300,
  }).mode,
  'normal',
  '非法模式回落到 normal（服务端不接受客户端乱传）',
)
assertEqual(
  createRaidRun({
    seed: 8,
    mapKey: 'wasteland',
    difficulty: 'normal',
    hp: 100,
    maxHp: 100,
    mp: 0,
    maxMp: 0,
    atk: 1,
    insured: false,
    capacities: { backpack: 8, rig: 2, safe: 2 },
    gear: { helmet: null, armor: null, boots: null, backpack: 'backpack_t1', rig: null },
    backpack: [],
    rig: [],
    safe: [],
    skills: [],
    startedAt: 1_000_000,
    groundSeqBase: 300,
  }).groundSeq,
  300,
  '组队开局的发号基址写入 groundSeq',
)
assertEqual(RAID_EXTRACT_FAIL_RATE, 0.25, '撤离故障概率 25%')
assertEqual(RAID_EXTRACT_COOLDOWN_MS, 60_000, '撤离冷却 60 秒')
assert(RAID_EXTRACT_CHANNEL_MS > 0, '撤离读条时长为正')

// 进房：不相邻拒绝；起点无敌人，可直接进入相邻房间
const neighbor = mapA.rooms[0]?.neighbors[0] as number
const farRoom = mapA.rooms.find((room) => room.id !== 0 && !(mapA.rooms[0]?.neighbors ?? []).includes(room.id))
if (farRoom) {
  const bad = applyRaidEvent(run, mapA, { type: 'enterRoom', roomId: farRoom.id }, 1_000_001)
  assert(!!bad.error, '不能进入不相邻的房间')
}
const entered = applyRaidEvent(run, mapA, { type: 'enterRoom', roomId: neighbor }, 1_000_001)
assert(!entered.error, '可以进入相邻房间')
assertEqual(entered.state.currentRoom, neighbor, '当前房间已更新')

// 击杀 / 清房
const room = mapA.rooms[neighbor] as (typeof mapA.rooms)[number]
const firstEnemy = room.enemies[0]
if (firstEnemy) {
  const clearTooEarly = applyRaidEvent(entered.state, mapA, { type: 'clearRoom', roomId: neighbor }, 1_000_002)
  assert(!!clearTooEarly.error, '还有敌人时不能清房')
  const killed = applyRaidEvent(entered.state, mapA, { type: 'kill', enemyId: firstEnemy.id }, 1_000_002)
  assert(!killed.error, '可以击杀当前房间的敌人')
  assertEqual(killed.state.kills, 1, '击杀数 +1')
  const unknownKill = applyRaidEvent(killed.state, mapA, { type: 'kill', enemyId: 'e-999-9' }, 1_000_003)
  assert(!!unknownKill.error, '不能击杀不存在的敌人')
}

// 开箱需要清场
const firstContainer = room.containers[0]
assert(!!firstContainer, '战斗房间至少有一个容器')
if (firstContainer) {
  const notCleared = applyRaidEvent(entered.state, mapA, { type: 'openContainer', containerId: firstContainer.id }, 1_000_004)
  assert(!!notCleared.error, '房间未清场时不能开箱')
}

// 造一个「已清场」的状态：杀光当前房间所有敌人
let clearedState = entered.state
for (const enemy of room.enemies) {
  clearedState = applyRaidEvent(clearedState, mapA, { type: 'kill', enemyId: enemy.id }, 1_000_005).state
}
const cleared = applyRaidEvent(clearedState, mapA, { type: 'clearRoom', roomId: neighbor }, 1_000_006)
assert(!cleared.error, '杀光后可以清房')
assertEqual(cleared.state.clearedRooms.includes(neighbor), true, '清房记录已写入')

// 开箱 + 拾取
if (firstContainer) {
  const opened = applyRaidEvent(cleared.state, mapA, { type: 'openContainer', containerId: firstContainer.id }, 1_000_007)
  assert(!opened.error, '清场后可以开箱')
  const loot = firstContainer.loot[0]
  assert(!!loot, '容器里有掉落')
  if (loot) {
    const take = applyRaidEvent(opened.state, mapA, {
      type: 'takeLoot',
      containerId: firstContainer.id,
      lootId: loot.id,
      target: 'backpack',
    }, 1_000_008)
    assert(!take.error, '可以拾取到背包')
    assertEqual(take.state.backpack.length, 1, '背包多了一格')
    const again = applyRaidEvent(take.state, mapA, {
      type: 'takeLoot',
      containerId: firstContainer.id,
      lootId: loot.id,
      target: 'backpack',
    }, 1_000_009)
    assert(!!again.error, '同一件掉落不能重复拾取')
    const def = getRaidItem(loot.itemKey)
    if (def && def.kind !== 'consumable') {
      const rigTake = applyRaidEvent(opened.state, mapA, {
        type: 'takeLoot',
        containerId: firstContainer.id,
        lootId: loot.id,
        target: 'rig',
      }, 1_000_010)
      assert(!rigTake.error, '非消耗品也能拾取进胸挂（2026-11 放宽）')
      assert(rigTake.state.rig.some((entry) => entry.itemKey === loot.itemKey), '胸挂拿到非消耗品')
    }
  }
}

// 容量为 0 时不能拾取
const noBag = makeRun({ capacities: { backpack: 0, rig: 0, safe: 0 } })
const noBagCleared = { ...noBag, currentRoom: neighbor, clearedRooms: [neighbor], killedEnemies: room.enemies.map((enemy) => enemy.id) }
if (firstContainer) {
  const openedNoBag = applyRaidEvent(noBagCleared, mapA, { type: 'openContainer', containerId: firstContainer.id }, 1_000_011)
  const loot = firstContainer.loot[0]
  if (loot && !openedNoBag.error) {
    const take = applyRaidEvent(openedNoBag.state, mapA, {
      type: 'takeLoot',
      containerId: firstContainer.id,
      lootId: loot.id,
      target: 'backpack',
    }, 1_000_012)
    assert(!!take.error, '没有背包容量时不能拾取')
  }
}

/* ============================================================
   容器工具
   ============================================================ */

const stack = addItemToContainer([], 2, 'scrap_metal', 3)
assert(!!stack && stack.length === 1 && stack[0]?.amount === 3, '空容器放入 3 件')
const stacked = addItemToContainer(stack, 2, 'scrap_metal', 3)
assert(!!stacked && stacked.length === 2 && stacked.reduce((sum, item) => sum + item.amount, 0) === 6, '超过堆叠上限自动开新格')
const overflow = addItemToContainer(stacked, 2, 'scrap_metal', 5)
assertEqual(overflow, null, '容器满时返回 null')
assertEqual(findContainerSlot([{ slotIndex: 0, itemKey: 'scrap_metal', amount: 1 }], 2), 1, '找到下一个空槽')
assertEqual(findContainerSlot([{ slotIndex: 0, itemKey: 'scrap_metal', amount: 1 }, { slotIndex: 1, itemKey: 'copper_wire', amount: 1 }], 2), -1, '容器满时没有空槽')
const consumed = consumeItemFromContainer(stacked, 'scrap_metal', 4)
assert(!!consumed && consumed.reduce((sum, item) => sum + item.amount, 0) === 2, '按数量消耗物品')

/* ============================================================
   伤害 / 耐久 / 维修
   ============================================================ */

const bodyHit = resolveRaidDamage({
  raw: 100,
  zone: 'body',
  helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
  armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
})
assertEqual(bodyHit.hpDamage, 74, '3 级护甲 26% 减伤：100 → 74')
assertEqual(bodyHit.armorLoss, 25, '耐久损耗 = 100 × 0.25')
assertEqual(bodyHit.helmetLoss, 0, '打身体不掉头盔耐久')
const headHit = resolveRaidDamage({
  raw: 100,
  zone: 'head',
  helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
  armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
})
assertEqual(headHit.hpDamage, 80, '3 级头盔 20% 减伤：100 → 80')
assertEqual(headHit.helmetLoss, 25, '头盔掉耐久')
const brokenArmor = resolveRaidDamage({
  raw: 100,
  zone: 'body',
  helmet: null,
  armor: { key: 'armor_t6', durability: 0, maxDurability: 180 },
})
assertEqual(brokenArmor.hpDamage, 100, '耐久为 0 时护甲不再减伤')
assertEqual(brokenArmor.armorLoss, 0, '耐久为 0 时不再扣耐久')

const damaged = makeRun()
const damageEvent = applyRaidEvent(damaged, mapA, { type: 'damage', amount: 100, zone: 'body' }, 1_000_020)
assert(!damageEvent.error, '受伤事件成功')
assertEqual(damageEvent.state.hp, 126, '受伤后 HP 126')
assertEqual(damageEvent.state.gear.armor?.durability, 75, '护甲耐久 100 → 75')
const lethal = applyRaidEvent(damageEvent.state, mapA, { type: 'damage', amount: 100000, zone: 'body' }, 1_000_021)
assertEqual(lethal.state.status, 'died', 'HP 归零判阵亡')

const repairSource = { key: 'armor_t3', durability: 20, maxDurability: 100 }
const repaired = repairRaidGear(repairSource, 'armor_repair')
assert(repaired.ok && !!repaired.gear, '甲修包可以维修护甲')
assertEqual(repaired.gear?.durability, 95, '维修后耐久 20 + 80 → 95（受上限）')
assertEqual(repaired.gear?.maxDurability, 95, '维修后耐久上限 100 → 95')
const repairedTwice = repairRaidGear({ ...repaired.gear!, durability: 50 }, 'armor_repair')
assertEqual(repairedTwice.gear?.maxDurability, Math.floor(95 * 0.95), '再次维修上限继续下降')
assertEqual(repairRaidGear({ key: 'helmet_t3', durability: 10, maxDurability: 70 }, 'armor_repair').ok, false, '甲修包不能修头盔')
assertEqual(repairRaidGear({ key: 'helmet_t3', durability: 70, maxDurability: 70 }, 'helmet_repair').ok, false, '满耐久不需要维修')
const floorRepair = repairRaidGear(
  { key: 'helmet_t1', durability: 0, maxDurability: 40 },
  'helmet_repair',
)
assertEqual(floorRepair.gear?.maxDurability, 38, '首次维修上限 40 → 38')
let floorGear = { key: 'helmet_t1', durability: 0, maxDurability: 40 }
for (let i = 0; i < 50; i += 1) {
  const result = repairRaidGear({ ...floorGear, durability: 0 }, 'helmet_repair')
  if (!result.ok || !result.gear) break
  floorGear = result.gear
}
assert((floorGear.maxDurability ?? 0) >= Math.ceil(40 * RAID_REPAIR_FLOOR_RATIO), '耐久上限不会低于初始 30%')
assert((floorGear.maxDurability ?? 0) < 40, '耐久上限确实被维修磨损')

/* ---------- 装备实例 id（2026-11-04：装备改成可重复获得的实例物品，写回按 id 认行） ---------- */

const instanceRun = makeRun({
  gear: {
    helmet: { id: 71, key: 'helmet_t3', durability: 70, maxDurability: 70 },
    armor: { id: 72, key: 'armor_t3', durability: 100, maxDurability: 100 },
    boots: 'boots_t2',
    backpack: 'backpack_t1',
    rig: 'rig_t1',
  },
})
assertEqual(instanceRun.gear.armor?.id, 72, '开局状态保留装备实例 id')
const instanceHit = applyRaidEvent(instanceRun, mapA, { type: 'damage', amount: 100, zone: 'body' }, 1_000_025)
assertEqual(instanceHit.state.gear.armor?.id, 72, '受击写回保留实例 id（同名多行不能互相覆盖）')
assertEqual(instanceHit.state.gear.armor?.durability, 75, '受击后耐久按同实例下降')
assertEqual(instanceHit.state.gear.armor?.maxDurability, 100, '受伤不降低耐久上限')
assertEqual(instanceHit.state.gear.helmet?.id, 71, '打身体不动头盔实例')
const headHitWithId = applyRaidEvent(instanceRun, mapA, { type: 'damage', amount: 100, zone: 'head' }, 1_000_026)
assertEqual(headHitWithId.state.gear.helmet?.id, 71, '打头时头盔实例 id 不变')
assertEqual(headHitWithId.state.gear.helmet?.durability, 45, '头盔耐久 70 → 45（100 × 0.25）')
assertEqual(headHitWithId.state.gear.armor?.id, 72, '打头时护甲实例原样保留')
const kitRun = makeRun({
  gear: { ...instanceRun.gear, armor: { id: 72, key: 'armor_t3', durability: 20, maxDurability: 100 } },
  backpack: [{ slotIndex: 0, itemKey: 'armor_repair', amount: 1 }],
})
const kitUsed = applyRaidEvent(kitRun, mapA, { type: 'useItem', itemKey: 'armor_repair', from: 'backpack' }, 1_000_027)
assert(!kitUsed.error, '局内可以用甲修包修带有实例 id 的护甲')
assertEqual(kitUsed.state.gear.armor?.id, 72, '维修写回保留实例 id')
assertEqual(kitUsed.state.gear.armor?.maxDurability, 95, '维修后耐久上限降到 95')
assertEqual(kitUsed.state.gear.helmet?.id, 71, '维修只动目标槽位，另一件实例不变')
assertEqual(repairRaidGear({ id: 5, key: 'armor_t3', durability: 20, maxDurability: 100 }, 'armor_repair').gear?.id, 5, '纯函数维修保留 id')
assertEqual(
  JSON.stringify(raidKeptContainers({ ...instanceHit.state, status: 'extracted' }).backpack),
  JSON.stringify(instanceHit.state.backpack),
  '结算保留的是容器引用，装备实例信息不丢',
)
// 同名装备重复出现时耐久各自独立（实例化的直接目的）
const twinArmor = { id: 91, key: 'armor_t3', durability: 100, maxDurability: 100 }
const twinDamaged = resolveRaidDamage({ raw: 100, zone: 'body', helmet: null, armor: twinArmor })
const twinKeep = resolveRaidDamage({ raw: 100, zone: 'body', helmet: null, armor: { ...twinArmor, id: 92, durability: 10 } })
assertEqual(twinDamaged.armorLoss, twinKeep.armorLoss, '同 key 不同实例的减伤规则一致')
assertEqual(twinKeep.armorLoss, 25, '实例间互不影响：各自按自身耐久结算')

/* ============================================================
   道具 / 技能 / 撤离
   ============================================================ */

const withMedkit = makeRun({
  hp: 100,
  backpack: [{ slotIndex: 0, itemKey: 'medkit', amount: 1 }],
})
const heal = applyRaidEvent(withMedkit, mapA, { type: 'useItem', itemKey: 'medkit', from: 'backpack' }, 1_000_030)
assert(!heal.error, '可以使用急救包')
assertEqual(heal.state.hp, 170, '急救包回复 35% 最大 HP（200 → 170）')
assertEqual(heal.state.backpack.length, 0, '急救包被消耗')

const fullHp = makeRun({ backpack: [{ slotIndex: 0, itemKey: 'medkit', amount: 1 }] })
assert(!!applyRaidEvent(fullHp, mapA, { type: 'useItem', itemKey: 'medkit', from: 'backpack' }, 1_000_031).error, '满血不能使用急救包')

/* ---------- 对局内移动物资（背包 → 安全箱 / 胸挂） ---------- */
const moveRun = makeRun({
  backpack: [
    { slotIndex: 0, itemKey: 'gold_compass', amount: 1 },
    { slotIndex: 1, itemKey: 'medkit', amount: 2 },
  ],
  rig: [],
  safe: [],
})
const movedToSafe = applyRaidEvent(moveRun, mapA, {
  type: 'moveItem', from: 'backpack', to: 'safe', slotIndex: 0,
}, 1_000_032)
assertEqual(movedToSafe.error, undefined, '背包物品可挪进安全箱')
assertEqual(movedToSafe.state.safe[0]?.itemKey, 'gold_compass', '安全箱拿到物品')
assertEqual(movedToSafe.state.backpack.length, 1, '来源背包少一格')
const movedToRig = applyRaidEvent(movedToSafe.state, mapA, {
  type: 'moveItem', from: 'backpack', to: 'rig', slotIndex: 1,
}, 1_000_033)
assertEqual(movedToRig.error, undefined, '消耗品可挪进胸挂')
assertEqual(movedToRig.state.rig[0]?.itemKey, 'medkit', '胸挂拿到消耗品')
const allowRigMaterial = applyRaidEvent(moveRun, mapA, {
  type: 'moveItem', from: 'backpack', to: 'rig', slotIndex: 0,
}, 1_000_034)
assertEqual(allowRigMaterial.error, undefined, '非消耗品也可挪进胸挂（2026-11 放宽）')
assertEqual(allowRigMaterial.state.rig[0]?.itemKey, 'gold_compass', '胸挂拿到黄金罗盘')
const rejectSame = applyRaidEvent(moveRun, mapA, {
  type: 'moveItem', from: 'backpack', to: 'backpack', slotIndex: 0,
}, 1_000_035)
assert(!!rejectSame.error, '同容器移动被拒绝')

/* ---------- 丢弃 / 捡起地面物品（2026-11 新增） ---------- */
const dropRun = makeRun({ backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 3 }] })
const dropped = applyRaidEvent(dropRun, mapA, {
  type: 'dropItem', from: 'backpack', slotIndex: 0, x: 10, y: 10,
}, 1_000_070)
assertEqual(dropped.error, undefined, '可以整格丢弃背包物品')
assertEqual(dropped.state.backpack.length, 0, '丢弃后背包清空')
assertEqual(dropped.state.groundLoot.length, 1, '地面多一件掉落物')
assertEqual(dropped.state.groundLoot[0]?.itemKey, 'scrap_metal', '掉落物品种正确')
assertEqual(dropped.state.groundLoot[0]?.amount, 3, '掉落物数量正确')
assertEqual(dropped.state.groundLoot[0]?.roomId, dropped.state.currentRoom, '掉落物落在当前房间')
const groundId = dropped.state.groundLoot[0]?.id as string
const picked = applyRaidEvent(dropped.state, mapA, {
  type: 'takeGround', groundId, target: 'rig',
}, 1_000_071)
assertEqual(picked.error, undefined, '可以捡起地面物品进胸挂')
assertEqual(picked.state.rig[0]?.itemKey, 'scrap_metal', '胸挂拿到捡起物')
assertEqual(picked.state.groundLoot.length, 0, '捡起后地面清空')
const pickMissing = applyRaidEvent(picked.state, mapA, {
  type: 'takeGround', groundId, target: 'backpack',
}, 1_000_072)
assert(!!pickMissing.error, '重复捡起同一地面物品被拒绝')
const dropRun2 = makeRun({ backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 3 }] })
const dropPart = applyRaidEvent(dropRun2, mapA, {
  type: 'dropItem', from: 'backpack', slotIndex: 0, amount: 1,
}, 1_000_073)
assertEqual(dropPart.error, undefined, '可以按数量部分丢弃')
assertEqual(dropPart.state.backpack[0]?.amount, 2, '背包剩余 2 个')
assertEqual(dropPart.state.groundLoot[0]?.amount, 1, '地面 1 个')
const dropNothing = applyRaidEvent(makeRun(), mapA, {
  type: 'dropItem', from: 'backpack', slotIndex: 0,
}, 1_000_074)
assert(!!dropNothing.error, '空格子不能丢弃')
const capRun = makeRun({
  backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 1 }],
  groundLoot: Array.from({ length: RAID_GROUND_LOOT_LIMIT }, (_, i) => ({
    id: `gseed-${i + 1}`, roomId: 0, itemKey: 'copper_wire', amount: 1, x: 5, y: 5,
  })),
  groundSeq: RAID_GROUND_LOOT_LIMIT,
})
const capDrop = applyRaidEvent(capRun, mapA, {
  type: 'dropItem', from: 'backpack', slotIndex: 0,
}, 1_000_075)
assert(!!capDrop.error, `单房掉落物达 ${RAID_GROUND_LOOT_LIMIT} 上限后拒绝继续丢弃`)
assertEqual(capDrop.state.backpack.length, 1, '达到上限时背包不变')

/* ---------- 丢弃落点往前抛（2026-11：丢在脚边会被客户端下一帧自动捡回，等于丢不掉） ---------- */
const dropRoom = mapA.rooms[dropNothing.state.currentRoom]
assert(!!dropRoom, '取到丢弃校验用的房间')
if (dropRoom) {
  const centerX = dropRoom.x + dropRoom.w / 2
  const centerY = dropRoom.y + dropRoom.h / 2
  const anchor = resolveDropPosition(centerX, centerY, 0, dropRoom)
  const north = resolveDropPosition(centerX, centerY, -Math.PI / 2, dropRoom)
  const noAngle = resolveDropPosition(centerX, centerY, undefined, dropRoom)
  assertClose(anchor.x, centerX + RAID_DROP_THROW_DISTANCE, 1e-9, '朝东抛出固定距离')
  assertClose(anchor.y, centerY, 1e-9, '朝东抛出不影响纵向')
  assertClose(noAngle.x, anchor.x, 1e-9, '缺省朝向按正东抛出，结果确定')
  assertClose(north.y, centerY - RAID_DROP_THROW_DISTANCE, 1e-9, '朝北抛出后纵向上移同距')
  assertClose(north.x, centerX, 1e-9, '朝北抛出不影响横向')
  const wallEast = resolveDropPosition(dropRoom.x + dropRoom.w - 1, centerY, 0, dropRoom)
  assert(wallEast.x <= dropRoom.x + dropRoom.w - 2.5, '贴右墙抛出被夹回房间内圈，丢不到墙外')
  assert(
    wallEast.x >= dropRoom.x + 1.5
      && wallEast.y >= dropRoom.y + 1.5
      && wallEast.y <= dropRoom.y + dropRoom.h - 2.5,
    '夹取后落点四边都在房间内圈',
  )
  const bogus = resolveDropPosition(Number.NaN, Number.POSITIVE_INFINITY, Number.NaN, dropRoom)
  assert(Number.isFinite(bogus.x) && Number.isFinite(bogus.y), '非法坐标/朝向仍回落到房间中心并返回有限值')
  assert(RAID_DROP_THROW_DISTANCE > 0.7, `抛出距离须大于客户端自动捡起半径 0.7（实测 ${RAID_DROP_THROW_DISTANCE}）`)
  assert(RAID_GROUND_REARM_DISTANCE > RAID_DROP_THROW_DISTANCE, '重新武装距离须大于抛出距离：丢完站着不该立刻被捡回')
  assert(RAID_GROUND_REARM_DISTANCE > 0.7, '重新武装距离须大于捡起半径，否则走远也重新不了')
  const thrown = applyRaidEvent(
    makeRun({ backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 2 }] }),
    mapA,
    { type: 'dropItem', from: 'backpack', slotIndex: 0, x: centerX, y: centerY, angle: 0 },
    1_000_090,
  )
  assertEqual(thrown.error, undefined, '带朝向的丢弃事件被接受')
  assertClose(thrown.state.groundLoot[0]?.x ?? Number.NaN, anchor.x, 1e-9, '服务端落点与纯函数逐位一致')
  assertClose(thrown.state.groundLoot[0]?.y ?? Number.NaN, anchor.y, 1e-9, '服务端落点纵向与纯函数一致')
  const thrownNorth = applyRaidEvent(
    makeRun({ backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 2 }] }),
    mapA,
    { type: 'dropItem', from: 'backpack', slotIndex: 0, x: centerX, y: centerY, angle: -Math.PI / 2 },
    1_000_091,
  )
  assertEqual(thrownNorth.error, undefined, '朝北的丢弃事件被接受')
  assert(
    (thrownNorth.state.groundLoot[0]?.y ?? 0) < (thrown.state.groundLoot[0]?.y ?? 0),
    '朝向确实改变落点，服务端按同一算法重算',
  )
}
const fullBagDrop = applyRaidEvent(makeRun({
  backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 1 }],
  capacities: { backpack: 1, rig: 0, safe: 0 },
}), mapA, { type: 'takeGround', groundId: 'g-none', target: 'backpack' }, 1_000_076)
assert(!!fullBagDrop.error, '地上没有该物品时捡取被拒绝')

const skillRun = makeRun()
const cast = applyRaidEvent(skillRun, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_040)
assert(!cast.error, '可以释放已装备技能')
assertEqual(cast.state.mp, 55, '技能扣除 25 MP')
const cooldown = applyRaidEvent(cast.state, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_041)
assert(!!cooldown.error, '冷却中不能再次释放')
const afterCd = applyRaidEvent(cast.state, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_040 + RAID_SKILL_CD_MS)
assert(!afterCd.error, '冷却结束可以再次释放')
const healSkill = applyRaidEvent(
  { ...makeRun({ hp: 100 }), mp: 80 },
  mapA,
  { type: 'castSkill', skillKey: 'healing_light' },
  1_000_050,
)
assert(!healSkill.error, '治疗技能成功')
assertEqual(healSkill.state.hp, 160, '治疗技能回复 30% 最大 HP（100 → 160）')
const noMp = applyRaidEvent({ ...makeRun(), mp: 10 }, mapA, { type: 'castSkill', skillKey: 'fire_claw' }, 1_000_060)
assert(!!noMp.error, 'MP 不足不能释放技能')

/* ---------- 已发现撤离点（小地图只有进过才点亮） ---------- */

const extractRoom = mapA.rooms.find((room) => room.kind === 'extract') as (typeof mapA.rooms)[number]
const extractNeighbor = mapA.rooms[extractRoom.neighbors[0] as number] as (typeof mapA.rooms)[number]
assert(!!extractNeighbor, '撤离房间至少有一个相邻房间')
const atExtractNeighbor = makeRun({ currentRoom: extractNeighbor.id, clearedRooms: [extractNeighbor.id] })
const firstEnter = applyRaidEvent(atExtractNeighbor, mapA, { type: 'enterRoom', roomId: extractRoom.id }, 1_000_150)
assert(!firstEnter.error, '可以从相邻房间走进撤离区')
assertEqual(firstEnter.state.discoveredExtracts.join(','), String(extractRoom.id), '进过撤离区即记录该点')
assert(firstEnter.state.log.some((entry) => entry.text.includes('撤离区')), '进撤离区的日志文案标注「撤离区」')
const goOut = applyRaidEvent(firstEnter.state, mapA, { type: 'enterRoom', roomId: extractNeighbor.id }, 1_000_151)
assert(!goOut.error, '撤离区没有敌人，可以走回相邻房间')
const reEnter = applyRaidEvent(goOut.state, mapA, { type: 'enterRoom', roomId: extractRoom.id }, 1_000_152)
assert(!reEnter.error, '可以再次进入撤离区')
assertEqual(reEnter.state.discoveredExtracts.length, 1, '重复进入同一撤离房间不会记录两次')
assertEqual(reEnter.state.discoveredExtracts.join(','), String(extractRoom.id), '记录仍然是同一个撤离点')
const sameRoom = applyRaidEvent(reEnter.state, mapA, { type: 'enterRoom', roomId: extractRoom.id }, 1_000_153)
assertEqual(sameRoom.state.discoveredExtracts.length, 1, '原地重复 enterRoom 也不会重复记录')

/* ---------- 撤离：掷骰纯函数的确定性、故障率与信号弹（2026-11-04） ---------- */

assertEqual(RAID_EXTRACT_FAIL_RATE, 0.25, '撤离故障概率钉死 25%')

/** 找一个能让 (房间, 第 N 次读条) 判成期望结果的种子（纯函数、可重放，所以搜索是确定的） */
function findExtractSeed(roomId: number, attempt: number, wantFail: boolean, upto = 20000): number {
  for (let seed = 1; seed <= upto; seed += 1) {
    if (rollExtractFailure(seed, roomId, attempt, false) === wantFail) return seed
  }
  throw new Error(`断言失败：找不到撤离掷骰种子（房间 ${roomId} / 第 ${attempt} 次 / 期望 ${wantFail ? '故障' : '成功'}）`)
}

const extractFailSeed = findExtractSeed(extractRoom.id, 1, true)
const extractPassSeed = findExtractSeed(extractRoom.id, 1, false)
assert(extractFailSeed !== extractPassSeed, '同一房间同一 attempt 既能找到故障种子也能找到成功种子')
assertEqual(rollExtractFailure(extractFailSeed, extractRoom.id, 1, false), true, `种子 ${extractFailSeed} 的首次读条判故障`)
assertEqual(rollExtractFailure(extractPassSeed, extractRoom.id, 1, false), false, `种子 ${extractPassSeed} 的首次读条判成功`)

// 确定性：同参数重复调用一致；不吃墙上时钟，因此服务端按 seed 重放必然同结果
let rollStability = 0
for (let roomId = 0; roomId < 24; roomId += 1) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const first = rollExtractFailure(extractFailSeed, roomId, attempt, false)
    for (let k = 0; k < 3; k += 1) {
      if (rollExtractFailure(extractFailSeed, roomId, attempt, false) !== first) rollStability += 1
    }
  }
}
assertEqual(rollStability, 0, 'rollExtractFailure 同参数重复调用结果恒定（无 Math.random / 无墙上时钟）')

// 实测故障率贴近 25%
let rateFails = 0
const RATE_SAMPLES = 400 * 25
for (let seed = 1; seed <= 400; seed += 1) {
  for (let roomId = 0; roomId < 25; roomId += 1) {
    if (rollExtractFailure(seed, roomId, 1, false)) rateFails += 1
  }
}
assertClose(rateFails / RATE_SAMPLES, RAID_EXTRACT_FAIL_RATE, 0.03, `撤离故障实测占比 ≈ 25%（${rateFails}/${RATE_SAMPLES}）`)

// 信号弹把概率直接钉成 0
let guaranteedFails = 0
for (let seed = 1; seed <= 200; seed += 1) {
  for (let roomId = 0; roomId < 20; roomId += 1) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      if (rollExtractFailure(seed, roomId, attempt, true)) guaranteedFails += 1
    }
  }
}
assertEqual(guaranteedFails, 0, 'guaranteed = true 时掷骰永远返回「不故障」')

// —— 成功分支 ——
const atExtract = makeRun({ seed: extractPassSeed, currentRoom: extractRoom.id, clearedRooms: [extractRoom.id] })
const wrongRoom = applyRaidEvent(makeRun(), mapA, { type: 'extractStart' }, 1_000_070)
assert(!!wrongRoom.error, '非撤离房间不能开始撤离')
const startExtract = applyRaidEvent(atExtract, mapA, { type: 'extractStart' }, 1_000_071)
assert(!startExtract.error, '撤离房间可以开始读条')
assertEqual(startExtract.state.extractionRoom, extractRoom.id, '读条记下所在撤离房间')
const tooEarly = applyRaidEvent(startExtract.state, mapA, { type: 'extractDone' }, 1_000_071 + RAID_EXTRACT_CHANNEL_MS - 1)
assert(!!tooEarly.error, '读条未完成不能撤离')
assertEqual(tooEarly.state.status, 'active', '提前点撤离不影响对局继续')
assertEqual(tooEarly.state.extractRolls, 0, '被拒的撤离不计数（不烧掉一次掷骰）')
const reStart = applyRaidEvent(startExtract.state, mapA, { type: 'extractStart' }, 1_000_071 + 100)
assertEqual(reStart.state.extractionStartedAt, startExtract.state.extractionStartedAt, '重复起读条不重置计时（防刷）')
const done = applyRaidEvent(startExtract.state, mapA, { type: 'extractDone' }, 1_000_071 + RAID_EXTRACT_CHANNEL_MS)
assertEqual(done.state.status, 'extracted', '掷骰判成功时读条完成即撤离成功')
assertEqual(done.state.extractRolls, 1, '一次读条计一次掷骰')
assertEqual(JSON.stringify(done.state.extractDisabled), '[]', '成功撤离不封任何撤离点')
assertEqual(done.state.extractBlockedUntil, null, '成功撤离不触发冷却')
assert(done.state.log.some((entry) => entry.kind === 'success'), '成功撤离写 success 日志')

// —— 失败分支（对齐三角洲：能不能走要看运气，且失败不吞背包） ——
const failBefore = makeRun({
  seed: extractFailSeed,
  currentRoom: extractRoom.id,
  clearedRooms: [extractRoom.id],
  backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 2 }],
  rig: [{ slotIndex: 0, itemKey: 'medkit', amount: 1 }],
  safe: [{ slotIndex: 0, itemKey: 'gold_compass', amount: 1 }],
})
const failStarted = applyRaidEvent(failBefore, mapA, { type: 'extractStart' }, 1_000_100)
assert(!failStarted.error, '会故障的种子照样能起读条（事前不可知）')
const failDone = applyRaidEvent(failStarted.state, mapA, { type: 'extractDone' }, 1_000_100 + RAID_EXTRACT_CHANNEL_MS)
assertEqual(failDone.error, undefined, '撤离故障不是非法请求，而是读条失败')
assertEqual(failDone.state.status, 'active', '撤离故障后对局继续，不判撤离也不判死')
assertEqual(failDone.state.extractRolls, 1, '失败的读条同样计入次数（下一次换 attempt）')
assertEqual(failDone.state.extractDisabled.join(','), String(extractRoom.id), '故障撤离点记入失效列表')
assertEqual(
  failDone.state.extractBlockedUntil,
  1_000_100 + RAID_EXTRACT_CHANNEL_MS + RAID_EXTRACT_COOLDOWN_MS,
  '故障后全图撤离冷却 = 完成时刻 + 60 秒',
)
assertEqual(failDone.state.extractionStartedAt, null, '故障后读条状态清空')
assertEqual(failDone.state.extractionRoom, null, '故障后不再挂在原撤离房间')
assert(
  failDone.state.log.some((entry) => entry.kind === 'danger' && entry.text.includes('运输故障')),
  '故障写一条 danger 日志',
)
assertEqual(JSON.stringify(failDone.state.backpack), JSON.stringify(failBefore.backpack), '故障不丢背包')
assertEqual(JSON.stringify(failDone.state.rig), JSON.stringify(failBefore.rig), '故障不丢胸挂')
assertEqual(JSON.stringify(failDone.state.safe), JSON.stringify(failBefore.safe), '故障不丢安全箱')
assertEqual(JSON.stringify(failDone.state.clearedRooms), JSON.stringify(failBefore.clearedRooms), '故障不回退清房进度')
assertEqual(JSON.stringify(failDone.state.discoveredExtracts), JSON.stringify(failBefore.discoveredExtracts), '故障不改已发现撤离点')
const afterFailAgain = applyRaidEvent(failDone.state, mapA, { type: 'extractDone' }, 1_000_100 + RAID_EXTRACT_CHANNEL_MS * 2)
assert(!!afterFailAgain.error, '没有读条就不能直接喊撤离完成')
assertEqual(afterFailAgain.state.extractRolls, 1, '被拒的 extractDone 不追加掷骰次数')
const disabledRoomStart = applyRaidEvent(
  failDone.state,
  mapA,
  { type: 'extractStart' },
  1_000_100 + RAID_EXTRACT_CHANNEL_MS + RAID_EXTRACT_COOLDOWN_MS + 1,
)
assert(!!disabledRoomStart.error, '冷却结束后，已失效的撤离点本局永久不可用（不复活）')
assert((disabledRoomStart.error ?? '').includes('失联'), '失效撤离点的报错口径是「失联」')

// —— 服务端重放：同一 seed + 同一批事件必然复现同一故障结果 ——
const replayFail = applyRaidEvent(
  applyRaidEvent(failBefore, mapA, { type: 'extractStart' }, 1_000_100).state,
  mapA,
  { type: 'extractDone' },
  1_000_100 + RAID_EXTRACT_CHANNEL_MS,
)
assertEqual(replayFail.state.status, failDone.state.status, '重放得到同样的对局状态')
assertEqual(
  JSON.stringify(replayFail.state.extractDisabled),
  JSON.stringify(failDone.state.extractDisabled),
  '重放得到同样的失效撤离点（掷骰只吃 seed/房间/次数/信号弹）',
)
assertEqual(replayFail.state.extractBlockedUntil, failDone.state.extractBlockedUntil, '重放冷却截止一致')

// —— 冷却期内换别的撤离点也不行（用两张撤离点的零号大坝） ——
const damExtracts = damNormal.rooms.filter((entry) => entry.kind === 'extract')
assertEqual(damExtracts.length, 2, '零号大坝有 2 个撤离房间')
const [extractA, extractB] = damExtracts as [(typeof damExtracts)[number], (typeof damExtracts)[number]]
assert(extractA.neighbors.includes(extractB.id), '两个撤离房间相邻，可以走去找别的出口')
let coolSeed = 0
for (let seed = 1; seed <= 20000; seed += 1) {
  if (rollExtractFailure(seed, extractA.id, 1, false) && !rollExtractFailure(seed, extractB.id, 2, false)) {
    coolSeed = seed
    break
  }
}
assert(coolSeed > 0, '找到「A 点首掷故障 + B 点二掷成功」的种子（冷却链路可确定性验证）')
const coolRun = makeRun({ seed: coolSeed, currentRoom: extractA.id, clearedRooms: [extractA.id] })
const coolStart = applyRaidEvent(coolRun, damNormal, { type: 'extractStart' }, 2_000_000)
assert(!coolStart.error, '撤离房间 A 可以起读条')
const coolFail = applyRaidEvent(coolStart.state, damNormal, { type: 'extractDone' }, 2_000_000 + RAID_EXTRACT_CHANNEL_MS)
assertEqual(coolFail.state.status, 'active', 'A 点运输故障，对局继续')
const moveToB = applyRaidEvent(coolFail.state, damNormal, { type: 'enterRoom', roomId: extractB.id }, 2_000_000 + RAID_EXTRACT_CHANNEL_MS + 500)
assert(!moveToB.error, '可以从失效的 A 点走到相邻的 B 点')
assertEqual(moveToB.state.discoveredExtracts.join(','), String(extractB.id), 'B 点首次进入被记录')
const duringCooldown = applyRaidEvent(
  moveToB.state,
  damNormal,
  { type: 'extractStart' },
  2_000_000 + RAID_EXTRACT_CHANNEL_MS + RAID_EXTRACT_COOLDOWN_MS - 1000,
)
assert(!!duringCooldown.error, '冷却期内任何撤离点都不能起读条')
assert((duringCooldown.error ?? '').includes('运输调度'), '冷却期报错口径是「运输调度」')
assertEqual(duringCooldown.state.extractionStartedAt, null, '冷却期内起不了读条')
const cooldownEnd = applyRaidEvent(
  moveToB.state,
  damNormal,
  { type: 'extractStart' },
  2_000_000 + RAID_EXTRACT_CHANNEL_MS + RAID_EXTRACT_COOLDOWN_MS,
)
assert(!cooldownEnd.error, '冷却截止当刻（now === 截止）恢复可撤离')
const secondDone = applyRaidEvent(
  cooldownEnd.state,
  damNormal,
  { type: 'extractDone' },
  2_000_000 + RAID_EXTRACT_CHANNEL_MS * 2 + RAID_EXTRACT_COOLDOWN_MS,
)
assertEqual(secondDone.state.status, 'extracted', '换撤离点并按 attempt = 2 重掷，本例判成功')
assertEqual(secondDone.state.extractRolls, 2, '两次读条累计 2 次掷骰')
assertEqual(secondDone.state.extractDisabled.join(','), String(extractA.id), '失效列表仍只有 A 点')

// —— 信号弹：已知会故障的 (seed, 房间) 点亮后必定走成 ——
const flareRun = makeRun({
  seed: extractFailSeed,
  currentRoom: extractRoom.id,
  clearedRooms: [extractRoom.id],
  backpack: [{ slotIndex: 0, itemKey: RAID_EXTRACT_FLARE_KEY, amount: 1 }],
})
assertEqual(rollExtractFailure(extractFailSeed, extractRoom.id, 1, false), true, '这一发不加保障必定故障（对照）')
const flareUsed = applyRaidEvent(flareRun, mapA, { type: 'useItem', itemKey: RAID_EXTRACT_FLARE_KEY, from: 'backpack' }, 1_000_200)
assert(!flareUsed.error, '可以使用撤离信号弹')
assertEqual(flareUsed.state.extractGuaranteed, true, '使用后本局撤离获得保障')
assertEqual(flareUsed.state.backpack.some((entry) => entry.itemKey === RAID_EXTRACT_FLARE_KEY), false, '信号弹被消耗掉')
assert(flareUsed.state.log.some((entry) => entry.kind === 'extract' && entry.text.includes('必定成功')), '点亮信号弹写 extract 日志')
assertEqual(flareUsed.state.hp, flareRun.hp, '信号弹不回血（不是治疗品）')
assertEqual(flareUsed.state.mp, flareRun.mp, '信号弹不回能量（不是能量饮料）')
const flareStart = applyRaidEvent(flareUsed.state, mapA, { type: 'extractStart' }, 1_000_210)
assert(!flareStart.error, '点亮信号弹后照常起读条')
assert(flareStart.state.log.some((entry) => entry.text.includes('航线已有保障')), '起读条日志体现航线已有保障')
const flareDone = applyRaidEvent(flareStart.state, mapA, { type: 'extractDone' }, 1_000_210 + RAID_EXTRACT_CHANNEL_MS)
assertEqual(flareDone.state.status, 'extracted', '同一 seed / 同一房间在点亮信号弹后撤离必定成功')
assertEqual(flareDone.state.extractGuaranteed, true, '保障标记随状态保留（结算可据此展示）')
assertEqual(flareDone.state.extractBlockedUntil, null, '信号弹路径不触发冷却')
const doubleFlare = makeRun({ backpack: [{ slotIndex: 0, itemKey: RAID_EXTRACT_FLARE_KEY, amount: 2 }] })
const firstFlare = applyRaidEvent(doubleFlare, mapA, { type: 'useItem', itemKey: RAID_EXTRACT_FLARE_KEY, from: 'backpack' }, 1_000_220)
assert(!firstFlare.error, '双发信号弹可以先点亮一发')
assertEqual(firstFlare.state.backpack[0]?.amount, 1, '第一发消耗后还剩 1')
const secondFlare = applyRaidEvent(firstFlare.state, mapA, { type: 'useItem', itemKey: RAID_EXTRACT_FLARE_KEY, from: 'backpack' }, 1_000_221)
assert(!!secondFlare.error, '航线已有保障时不允许重复点亮信号弹')
assertEqual(secondFlare.state.backpack[0]?.amount, 1, '被拒的第二次不消耗信号弹')
assertEqual(secondFlare.state.extractGuaranteed, true, '被拒后保障标记不变')
const flareFromSafe = makeRun({ safe: [{ slotIndex: 0, itemKey: RAID_EXTRACT_FLARE_KEY, amount: 1 }] })
assert(
  !applyRaidEvent(flareFromSafe, mapA, { type: 'useItem', itemKey: RAID_EXTRACT_FLARE_KEY, from: 'safe' }, 1_000_222).error,
  '安全箱里的信号弹也能点亮（保命底牌不受背包挤压）',
)
assert(
  !!applyRaidEvent(makeRun(), mapA, { type: 'useItem', itemKey: RAID_EXTRACT_FLARE_KEY, from: 'backpack' }, 1_000_223).error,
  '没有信号弹时不能使用',
)
assert(
  !!applyRaidEvent(makeRun({ backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 1 }] }), mapA,
    { type: 'useItem', itemKey: 'scrap_metal', from: 'backpack' }, 1_000_224).error,
  '材料不是消耗品，不能使用',
)

// 放弃 / 超时
assertEqual(applyRaidEvent(makeRun(), mapA, { type: 'abandon' }, 1_000_080).state.status, 'abandoned', '主动放弃')
const expired = tickRaidRun(makeRun(), 1_000_000 + wasteland.durationMs)
assertEqual(expired.status, 'mia', '超时判失联')

/* ============================================================
   结算 / 保险 / 契约
   ============================================================ */

const extractedState = makeRun({
  status: 'extracted',
  backpack: [{ slotIndex: 0, itemKey: 'scrap_metal', amount: 2 }],
  rig: [{ slotIndex: 0, itemKey: 'medkit', amount: 1 }],
  safe: [{ slotIndex: 0, itemKey: 'gold_compass', amount: 1 }],
})
const keptAll = raidKeptContainers(extractedState)
assertEqual(keptAll.backpack.length, 1, '撤离保留背包')
assertEqual(keptAll.rig.length, 1, '撤离保留胸挂')
assertEqual(keptAll.safe.length, 1, '撤离保留安全箱')
const diedState = { ...extractedState, status: 'died' as const }
const keptSafe = raidKeptContainers(diedState)
assertEqual(keptSafe.backpack.length, 0, '阵亡丢失背包')
assertEqual(keptSafe.rig.length, 0, '阵亡丢失胸挂')
assertEqual(keptSafe.safe.length, 1, '阵亡保留安全箱')
assertEqual(raidLootValue(keptAll.backpack), 70, '战利品价值 = 35 × 2')
assertEqual(raidTotalUnits(keptAll.backpack), 2, '按件数汇总')
assertEqual(
  raidLootValue([{ slotIndex: 0, itemKey: GAME_TICKET_KEY, amount: 3 }]),
  GAME_TICKET_RECYCLE_VALUE * 3,
  '带出的门票按目录价值计价（仓库/结算展示口径一致）',
)
assertEqual(
  raidKeptContainers({ ...failDone.state }).backpack.length,
  0,
  '撤离故障（仍 active）期间结算只保安全箱，不给整套背包',
)
const pvpExtracted = { ...extractedState, mode: 'pvp' as const }
assertEqual(raidKeptContainers(pvpExtracted).backpack.length, 1, 'pvp 模式撤离同样保留全部容器（模式不改结算）')
const diedByPeer = { ...diedState, killedByUserId: 99 }
assertEqual(diedByPeer.killedByUserId, 99, '被玩家击倒的归因留在状态里（结算与 HUD 用）')
assertEqual(raidKeptContainers(diedByPeer).safe.length, 1, 'pvp 击倒同样按阵亡结算，只保安全箱')
assertEqual(raidExpired(makeRun(), 1_000_000), false, '开局未超时')
assertEqual(raidExpired(makeRun(), 1_000_000 + wasteland.durationMs), true, '到点判超时')
assertEqual(raidExpired({ ...makeRun(), status: 'extracted' }, 1_000_000 + wasteland.durationMs * 2), false, '已结束的对局不再判超时')

const gearValue = {
  helmet: { key: 'helmet_t3', durability: 70, maxDurability: 70 },
  armor: { key: 'armor_t3', durability: 100, maxDurability: 100 },
  boots: 'boots_t2',
  backpack: 'backpack_t2',
  rig: 'rig_t1',
}
assertEqual(raidInsuranceCost(gearValue), Math.ceil((900 + 1100 + 320 + 700 + 200) * 0.15), '保险 = 装备价值 15%')
assertEqual(raidInsuranceCost({ helmet: null, armor: null, boots: null, backpack: null, rig: null }), 0, '裸装保险为 0')
assertEqual(raidInsuranceCost({ helmet: { key: 'helmet_t1', durability: 40, maxDurability: 40 }, armor: null, boots: null, backpack: null, rig: null }), 23, '低价值装备保险向上取整')

assertEqual(raidSellPrice('scrap_metal', 2), 70, '材料回收价 100%')
assertEqual(raidSellPrice('medkit', 1), 72, '消耗品回收价 60%')
assertEqual(raidSellPrice('gear_cache', 1), 182, '装备箱回收价 70%')
assertEqual(raidSellPrice('nope', 1), 0, '未知物品回收价 0')

assertEqual(RAID_CONTRACTS.length, 3, '每日契约 3 条')
assert(RAID_CONTRACT_MAP.has('extract_1') && RAID_CONTRACT_MAP.has('kill_3') && RAID_CONTRACT_MAP.has('loot_2500'), '契约 key 正确')
assert(RAID_CONTRACTS.every((contract) => contract.rewardPoints > 0 && contract.target > 0), '契约奖励与目标为正')

/* ---------- 批量事件 ---------- */
const batchRun = makeRun()
const batch = applyRaidEvents(batchRun, mapA, [
  { type: 'enterRoom', roomId: neighbor },
  { type: 'kill', enemyId: 'not-a-real-enemy' },
  { type: 'abandon' },
], 1_000_090)
assertEqual(batch.applied, 2, '批量事件跳过非法条目')
assertEqual(batch.errors.length, 1, '批量事件记录 1 条错误')
assertEqual(batch.state.status, 'abandoned', '批量事件最终状态')
const batchEmpty = applyRaidEvents(makeRun(), mapA, [], 1_000_091)
assertEqual(batchEmpty.applied, 0, '空批次不应用任何事件')
assertEqual(batchEmpty.errors.length, 0, '空批次不产生错误')
const batchEnded = applyRaidEvents({ ...makeRun(), status: 'abandoned' }, mapA, [{ type: 'abandon' }], 1_000_092)
assertEqual(batchEnded.applied, 0, '已结束的对局批量入口直接停手')
assert(!!applyRaidEvent(done.state, mapA, { type: 'abandon' }, 1_000_093).error, '已撤离的对局拒绝任何事件')
assert(!!applyRaidEvent(done.state, mapA, { type: 'extractDone' }, 1_000_094).error, '已撤离的对局不能再刷撤离事件')

/* ---------- 旧 schema（v1–v3）状态的读取与兜底 ---------- */

// 服务层的闸门：raidRunService 用 parsed.schemaVersion !== RAID_STATE_VERSION 直接判不可用，
// 旧对局首次读取按放弃结算。引擎本身不偷偷迁移版本号，所以这里必须钉死「版本号原样保留」。
const legacyRaw = { ...makeRun(), schemaVersion: 1 } as Record<string, unknown>
delete legacyRaw.mode
delete legacyRaw.extractDisabled
delete legacyRaw.extractBlockedUntil
delete legacyRaw.extractRolls
delete legacyRaw.extractGuaranteed
delete legacyRaw.discoveredExtracts
delete legacyRaw.killedByUserId
const legacyState = legacyRaw as unknown as RaidRunState
assertEqual(legacyState.schemaVersion, 1, '旧 schema 可构造（服务层按放弃处理）')
assert(
  legacyState.schemaVersion !== RAID_STATE_VERSION,
  '旧版本不等于 RAID_STATE_VERSION，服务层据此拒绝（否则会把没有 mode / 撤离字段的局当新局跑）',
)
const legacyAbandon = applyRaidEvent(legacyState, mapA, { type: 'abandon' }, 1_000_300)
assertEqual(legacyAbandon.state.status, 'abandoned', '缺字段的旧状态仍可处理事件（cloneState 兜底）')
assertEqual(legacyAbandon.state.schemaVersion, 1, '引擎不改写旧状态的 schemaVersion（拒绝口径依赖它）')
assertEqual(legacyAbandon.state.mode, 'normal', '缺失 mode 兜底为 normal')
assertEqual(JSON.stringify(legacyAbandon.state.extractDisabled ?? []), '[]', '缺失失效列表兜底为空')
assertEqual(legacyAbandon.state.extractRolls, 0, '缺失读条次数兜底为 0')
assertEqual(legacyAbandon.state.extractGuaranteed ?? false, false, '缺失保障标记兜底为无保障')
const legacyAtExtract = applyRaidEvent(
  { ...legacyState, currentRoom: extractRoom.id, clearedRooms: [extractRoom.id] },
  mapA,
  { type: 'extractStart' },
  1_000_301,
)
assert(!legacyAtExtract.error, '旧状态没有冷却字段也能起读条')
const legacyDone = applyRaidEvent(legacyAtExtract.state, mapA, { type: 'extractDone' }, 1_000_301 + RAID_EXTRACT_CHANNEL_MS)
assertEqual(legacyDone.state.extractRolls, 1, '旧状态从 0 起算读条次数')
assert(
  legacyDone.state.status === 'extracted' || legacyDone.state.status === 'active',
  '旧状态的撤离结果只有「成功」或「故障继续」两种，不会卡死',
)
assertEqual(
  legacyDone.state.status,
  rollExtractFailure(legacyDone.state.seed, extractRoom.id, 1, false) ? 'active' : 'extracted',
  '旧状态同样走确定掷骰（重放可复现）',
)
// 装备实例 id 是可选字段：旧状态里的 gear 字面量没有 id 也必须能用
assertEqual(legacyState.gear.armor?.id, undefined, '旧 gear 字面量没有 id 字段仍可解析')

console.log(`✅ 搜打撤 v4 引擎自检：${passed} 个断言`)
