/**
 * 宠物系统纯函数自检（不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-pet.ts
 *      （或 npm run verify:pet）
 */

import {
  PET_CARE_ACTIONS,
  PET_COSTS,
  PET_DECAY_PER_HOUR,
  PET_GRACE_HOURS,
  PET_MAX_LEVEL,
  PET_OUTFITS,
  PET_OUTFIT_SLOTS,
  PET_SPECIES,
  PET_TOUCH_COOLDOWN_MS,
  PET_TRICKS,
  cleanEquipped,
  emptyPetEquipped,
  petUnlockedActions,
  petUpgradeCost,
  recomputeCriticalSince,
  roundStat,
  serializeEquipped,
  settlePetStats,
  type PetStatsInput,
} from '../src/lib/petCatalog.js'

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

const HOUR_MS = 3_600_000
const BASE = 1_700_000_000_000

function aliveInput(overrides: Partial<PetStatsInput> = {}): PetStatsInput {
  return {
    hunger: 100,
    cleanliness: 100,
    mood: 100,
    decayedAt: BASE,
    criticalSince: null,
    status: 'alive',
    ...overrides,
  }
}

/* ============================================================
   settlePetStats：衰减结算
   ============================================================ */

// 无衰减（now == decayedAt）
{
  const s = settlePetStats(aliveInput(), BASE)
  assertEqual(s.hunger, 100, '无衰减 hunger 不变')
  assertEqual(s.cleanliness, 100, '无衰减 cleanliness 不变')
  assertEqual(s.mood, 100, '无衰减 mood 不变')
  assertEqual(s.decayedAt, BASE, '无衰减基准推进到 now')
  assertEqual(s.criticalSince, null, '无衰减无危机')
  assertEqual(s.gone, false, '无衰减不出走')
}

// 部分衰减（10 小时：hunger -40、cleanliness -20、mood -30）
{
  const s = settlePetStats(aliveInput(), BASE + 10 * HOUR_MS)
  assertEqual(s.hunger, 60, '10 小时 hunger 100→60（4/h）')
  assertEqual(s.cleanliness, 80, '10 小时 cleanliness 100→80（2/h）')
  assertEqual(s.mood, 70, '10 小时 mood 100→70（3/h）')
  assertEqual(s.criticalSince, null, '未归零无危机')
  assertEqual(s.gone, false, '未归零不出走')
}

// clamp 0（不出现负数）
{
  const s = settlePetStats(aliveInput({ hunger: 1, cleanliness: 0.5, mood: 2 }), BASE + 100 * HOUR_MS)
  assertEqual(s.hunger, 0, '衰减最低 clamp 到 0（hunger）')
  assertEqual(s.cleanliness, 0, '衰减最低 clamp 到 0（cleanliness）')
  assertEqual(s.mood, 0, '衰减最低 clamp 到 0（mood）')
}

// 窗口内归零时刻计算：hunger 80 / 4 = 20h 后归零
{
  const s = settlePetStats(aliveInput({ hunger: 80 }), BASE + 25 * HOUR_MS)
  assertEqual(s.hunger, 0, 'hunger 25 小时后归零')
  assertEqual(s.criticalSince, BASE + 20 * HOUR_MS, '归零时刻 = decayedAt + 80/4h')
}

// 多项归零取最早：hunger 80（20h 归零）与 mood 30（10h 归零）
{
  const s = settlePetStats(aliveInput({ hunger: 80, mood: 30 }), BASE + 25 * HOUR_MS)
  assertEqual(s.criticalSince, BASE + 10 * HOUR_MS, '多项归零取最早时刻')
}

// criticalSince 保留最早（已有记录不被更晚的归零覆盖）
{
  const existing = BASE + 5 * HOUR_MS
  const s = settlePetStats(aliveInput({ hunger: 0, criticalSince: existing }), BASE + 25 * HOUR_MS)
  assertEqual(s.criticalSince, existing, '已有 criticalSince 保留')
}

// 三项全部 > 0 时清空 criticalSince
{
  const s = settlePetStats(
    aliveInput({ hunger: 50, cleanliness: 50, mood: 50, criticalSince: BASE + HOUR_MS }),
    BASE + 2 * HOUR_MS,
  )
  assertEqual(s.criticalSince, null, '全部 > 0 时危机解除')
}

// grace 边界：恰好 48 小时 → 出走
{
  const zeroAt = BASE + 20 * HOUR_MS
  const s = settlePetStats(aliveInput({ hunger: 80, criticalSince: zeroAt }), zeroAt + PET_GRACE_HOURS * HOUR_MS)
  assertEqual(s.gone, true, '恰好 48 小时判定出走')
}

// grace 边界：差 1ms 不出走
{
  const zeroAt = BASE + 20 * HOUR_MS
  const s = settlePetStats(aliveInput({ hunger: 80, criticalSince: zeroAt }), zeroAt + PET_GRACE_HOURS * HOUR_MS - 1)
  assertEqual(s.gone, false, '差 1ms 不出走')
}

// 首次归零后立即不足 grace：25 小时全衰减（criticalSince=20h 处），now 在 21h 处
{
  const s = settlePetStats(aliveInput({ hunger: 80 }), BASE + 21 * HOUR_MS)
  assertEqual(s.criticalSince, BASE + 20 * HOUR_MS, '首次归零记录时刻')
  assertEqual(s.gone, false, 'grace 未满不出走')
}

// gone 后原样（status 非 alive）
{
  const s = settlePetStats(
    aliveInput({ hunger: 37, cleanliness: 42, mood: 55, status: 'gone', criticalSince: null, decayedAt: BASE }),
    BASE + 1000 * HOUR_MS,
  )
  assertEqual(s.hunger, 37, 'gone 状态数值原样（hunger）')
  assertEqual(s.cleanliness, 42, 'gone 状态数值原样（cleanliness）')
  assertEqual(s.mood, 55, 'gone 状态数值原样（mood）')
  assertEqual(s.decayedAt, BASE, 'gone 状态基准不推进')
  assertEqual(s.gone, false, 'gone 状态不再判出走')
}

// 时钟回拨（elapsed <= 0）数值不变
{
  const zeroAt = BASE + 20 * HOUR_MS
  const s = settlePetStats(aliveInput({ hunger: 80, criticalSince: zeroAt }), BASE - 1000)
  assertEqual(s.hunger, 80, '时钟回拨数值不变')
  assertEqual(s.criticalSince, zeroAt, '时钟回拨保留危机时刻')
  assertEqual(s.gone, false, '时钟回拨仍按 grace 判定')
}

// 衰减到恰好为 0 的边界（恰好归零算 critical）
{
  const s = settlePetStats(aliveInput({ hunger: 80 }), BASE + 20 * HOUR_MS)
  assertEqual(s.hunger, 0, '恰好 20 小时 hunger 归零')
  assertEqual(s.criticalSince, BASE + 20 * HOUR_MS, '恰好归零记录危机时刻')
}

// decayedAt 为 0 值的旧项（value 已 <= 0）归零时刻回退为基准时刻
{
  const s = settlePetStats(aliveInput({ hunger: 0 }), BASE + 3 * HOUR_MS)
  assertEqual(s.criticalSince, BASE, '已为 0 的项归零时刻取基准时刻')
}

/* ============================================================
   recomputeCriticalSince：照顾回补后的危机重算
   ============================================================ */

assertEqual(recomputeCriticalSince(50, 50, 50, BASE), null, '全部 > 0 危机解除')
assertEqual(recomputeCriticalSince(0, 50, 50, BASE), BASE, '仍有归零项保留危机时刻')
assertEqual(recomputeCriticalSince(50, 0, 0, null), null, '无记录且不新增')

/* ============================================================
   petUnlockedActions：解锁清单
   ============================================================ */

assertEqual(petUnlockedActions(1), ['feed'], 'L1 只解锁喂食')
assertEqual(petUnlockedActions(3), ['feed', 'bathe', 'play'], 'L3 解锁全部照顾动作')
assertEqual(petUnlockedActions(4), ['feed', 'bathe', 'play', 'dance'], 'L4 解锁跳舞')
assertEqual(petUnlockedActions(10), ['feed', 'bathe', 'play', 'dance', 'roll', 'sing', 'flip', 'spin', 'magic', 'firework'], 'L10 全解锁')
assertEqual(petUnlockedActions(0), [], 'L0 无解锁')

/* ============================================================
   petUpgradeCost 与等级上限
   ============================================================ */

assertEqual(petUpgradeCost(1), 100, 'L1→L2 花 100')
assertEqual(petUpgradeCost(9), 900, 'L9→L10 花 900')
assertEqual(petUpgradeCost(10), 1000, '函数本身不设上限（由 service 判满级）')
{
  // 1→10 级总花费 = 100+200+...+900 = 4500
  let total = 0
  for (let level = 1; level < PET_MAX_LEVEL; level += 1) total += petUpgradeCost(level)
  assertEqual(total, 4500, '1→10 级总花费 4500')
}
assertEqual(PET_MAX_LEVEL, 10, '满级为 10')

/* ============================================================
   cleanEquipped / serializeEquipped
   ============================================================ */

{
  const equipped = { hat: 'hat_red', neck: 'scarf_blue', face: 'sunglasses' }
  assertEqual(cleanEquipped(serializeEquipped(equipped)), equipped, '合法 JSON 往返一致')
}
assertEqual(cleanEquipped('{"hat":"hat_red","neck":null,"face":null}'), { hat: 'hat_red', neck: null, face: null }, '部分佩戴合法')
assertEqual(cleanEquipped('not json'), emptyPetEquipped(), '非法 JSON 回全空')
assertEqual(cleanEquipped('[]'), emptyPetEquipped(), '数组输入回全空')
assertEqual(cleanEquipped('null'), emptyPetEquipped(), 'null 输入回全空')
assertEqual(cleanEquipped(''), emptyPetEquipped(), '空串回全空')
assertEqual(cleanEquipped(undefined), emptyPetEquipped(), 'undefined 回全空')
assertEqual(cleanEquipped('{"hat":"crown_gold"}'), { hat: 'crown_gold', neck: null, face: null }, '未知 key 被过滤')
assertEqual(cleanEquipped('{"hat":"scarf_blue"}'), emptyPetEquipped(), 'slot 与目录不符被过滤')
assertEqual(cleanEquipped('{"hat":"hat_red","extra":"x","neck":123}'), { hat: 'hat_red', neck: null, face: null }, '多余字段与非法值被忽略')
assertEqual(cleanEquipped('{"hat":"HAT_RED"}'), emptyPetEquipped(), 'key 大小写敏感')
assertEqual(cleanEquipped('{"face":"glasses_round","neck":"bowtie"}'), { hat: null, neck: 'bowtie', face: 'glasses_round' }, '多 slot 组合合法')

/* ============================================================
   目录不变量
   ============================================================ */

// species
{
  const keys = PET_SPECIES.map((species) => species.key)
  assertEqual(new Set(keys).size, keys.length, '物种 key 唯一')
  assertEqual(keys.length, 3, '共 3 个物种')
  for (const species of PET_SPECIES) {
    assert(species.name.length > 0, `物种 ${species.key} 有名字`)
    assert(species.defaultName.length > 0, `物种 ${species.key} 有默认名`)
    assert(species.emoji.length > 0, `物种 ${species.key} 有 emoji`)
    assert(species.description.length > 0, `物种 ${species.key} 有描述`)
  }
}

// outfits
{
  const keys = PET_OUTFITS.map((outfit) => outfit.key)
  assertEqual(new Set(keys).size, keys.length, '装扮 key 唯一')
  for (const outfit of PET_OUTFITS) {
    assert(PET_OUTFIT_SLOTS.includes(outfit.slot), `装扮 ${outfit.key} slot 合法`)
    assert(outfit.price > 0, `装扮 ${outfit.key} 价格为正`)
    assert(Number.isInteger(outfit.minLevel) && outfit.minLevel >= 1 && outfit.minLevel <= PET_MAX_LEVEL, `装扮 ${outfit.key} minLevel 在 1–10`)
    assert(outfit.name.length > 0, `装扮 ${outfit.key} 有名字`)
  }
  // 每档 slot 至少一件、覆盖三个 slot
  for (const slot of PET_OUTFIT_SLOTS) {
    assert(PET_OUTFITS.some((outfit) => outfit.slot === slot), `slot ${slot} 有装扮`)
  }
  // 每档 slot 都有 L1 可买的入门款（避免低级玩家某 slot 永久空窗）
  for (const slot of PET_OUTFIT_SLOTS) {
    assert(PET_OUTFITS.some((outfit) => outfit.slot === slot && outfit.minLevel === 1), `slot ${slot} 有 L1 入门款`)
  }
}

// care actions
{
  const keys = PET_CARE_ACTIONS.map((action) => action.key)
  assertEqual(new Set(keys).size, keys.length, '照顾动作 key 唯一')
  assertEqual(keys.length, 3, '共 3 个照顾动作')
  for (const action of PET_CARE_ACTIONS) {
    assert(action.cost > 0, `照顾动作 ${action.key} 花费为正`)
    assert(action.minLevel >= 1 && action.minLevel <= PET_MAX_LEVEL, `照顾动作 ${action.key} minLevel 在 1–10`)
    assertEqual(action.cost, PET_COSTS[action.key], `照顾动作 ${action.key} 与 PET_COSTS 一致`)
  }
  assertEqual(PET_COSTS.summon, 300, '召唤花 300 积分')
}

// tricks
{
  const keys = PET_TRICKS.map((trick) => trick.key)
  assertEqual(new Set(keys).size, keys.length, '特技 key 唯一')
  assertEqual(keys.length, 7, '共 7 个特技')
  for (const trick of PET_TRICKS) {
    assert(trick.minLevel >= 4 && trick.minLevel <= PET_MAX_LEVEL, `特技 ${trick.key} minLevel 在 4–10`)
    assert(trick.emoji.length > 0, `特技 ${trick.key} 有 emoji`)
  }
  // minLevel 连续：L4..L10 每级一个新特技
  const levels = PET_TRICKS.map((trick) => trick.minLevel).sort((a, b) => a - b)
  assertEqual(levels, [4, 5, 6, 7, 8, 9, 10], '特技解锁等级连续 L4–L10')
}

// decay
assert(PET_DECAY_PER_HOUR.hunger > 0, 'hunger 衰减速率为正')
assert(PET_DECAY_PER_HOUR.cleanliness > 0, 'cleanliness 衰减速率为正')
assert(PET_DECAY_PER_HOUR.mood > 0, 'mood 衰减速率为正')
assert(PET_GRACE_HOURS > 0, 'grace 时长为正')
assert(PET_TOUCH_COOLDOWN_MS === 60_000, '抚摸冷却 60 秒')

/* ============================================================
   roundStat
   ============================================================ */

assertEqual(roundStat(87.333333), 87.3, 'roundStat 保留 1 位小数')
assertEqual(roundStat(0), 0, 'roundStat 0')
assertEqual(roundStat(99.96), 100, 'roundStat 进位到 100')
assertEqual(roundStat(100), 100, 'roundStat 整数不变')

console.log(`✅ 宠物系统纯函数自检：${passed} 个断言`)
