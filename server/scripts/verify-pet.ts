/**
 * 宠物系统纯函数自检（不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-pet.ts
 *      （或 npm run verify:pet）
 */

import {
  GUESTBOOK_DAILY_LIMIT,
  GUESTBOOK_MAX_LENGTH,
  PAT_DAILY_LIMIT,
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
  canPatToday,
  cleanEquipped,
  cleanLoadout,
  emptyPetEquipped,
  emptyPetLoadout,
  getPetSpecies,
  loadoutEquipmentKeys,
  nextNameAfterSwitch,
  normalizePetName,
  petUnlockedActions,
  petUpgradeCost,
  recomputeCriticalSince,
  roundStat,
  sanitizeGuestbookContent,
  serializeEquipped,
  serializeLoadout,
  settlePetStats,
  type PetStatsInput,
} from '../src/lib/petCatalog.js'
import {
  PET_EQUIPMENTS,
  PET_EQUIPMENT_MAP,
  PET_EQUIPMENT_SLOTS,
  PET_EQUIPMENT_KEYS,
  PET_SHOP_EQUIPMENTS,
  PET_STARTER_EQUIPMENT_KEYS,
  equipmentPower,
} from '../src/lib/petEquipment.js'
import {
  PET_BASIC_SKILL_KEY,
  PET_SHOP_SKILLS,
  PET_SKILLS,
  PET_SKILL_MAP,
  PET_SKILL_MAX_EQUIPPED,
  skillPower,
} from '../src/lib/petSkills.js'
import {
  applyBattleAction,
  applyBattleForfeit,
  applyBattleTimeout,
  availableSkills,
  battleStakeFor,
  createBattleRng,
  createBattleState,
  deriveCombatStats,
  normalizeEquipmentKeys,
  normalizeSkillKeys,
  PET_BATTLE_MAX_TIMEOUTS,
  PET_BATTLE_MAX_ROUNDS,
  type PetCombatInput,
} from '../src/lib/petBattle.js'
import {
  decayRefPrice,
  nextRefPrice,
  petMarketFee,
  petMarketSellerProceeds,
  refPriceChangePct,
  validateListingPrice,
} from '../src/lib/petMarket.js'

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

/** 五个装扮槽的完整期望（back/aura 为 2026-11 新增槽位） */
function equippedWith(partial: Record<string, string | null>): Record<string, string | null> {
  return { ...emptyPetEquipped(), ...partial }
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
assertEqual(
  petUnlockedActions(3),
  ['feed', 'bathe', 'play', 'stretch', 'beg', 'wave'],
  'L3 解锁全部照顾动作 + 伸懒腰/作揖/招手',
)
assertEqual(
  petUnlockedActions(4),
  ['feed', 'bathe', 'play', 'stretch', 'beg', 'dance', 'wave'],
  'L4 追加跳舞',
)
assertEqual(
  petUnlockedActions(10),
  [
    'feed', 'bathe', 'play',
    'stretch', 'beg', 'dance', 'roll', 'highfive', 'sing', 'flip',
    'moonwalk', 'spin', 'playdead', 'wave', 'sneeze', 'yawn', 'magic', 'cheer', 'firework',
  ],
  'L10 全解锁',
)
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
  const equipped = equippedWith({ hat: 'hat_red', neck: 'scarf_blue', face: 'sunglasses', back: 'wings_angel', aura: 'halo_gold' })
  assertEqual(cleanEquipped(serializeEquipped(equipped as never)), equipped, '合法 JSON 往返一致')
}
assertEqual(cleanEquipped('{"hat":"hat_red","neck":null,"face":null}'), equippedWith({ hat: 'hat_red' }), '部分佩戴合法')
assertEqual(cleanEquipped('not json'), emptyPetEquipped(), '非法 JSON 回全空')
assertEqual(cleanEquipped('[]'), emptyPetEquipped(), '数组输入回全空')
assertEqual(cleanEquipped('null'), emptyPetEquipped(), 'null 输入回全空')
assertEqual(cleanEquipped(''), emptyPetEquipped(), '空串回全空')
assertEqual(cleanEquipped(undefined), emptyPetEquipped(), 'undefined 回全空')
assertEqual(cleanEquipped('{"hat":"crown_gold"}'), equippedWith({ hat: 'crown_gold' }), '未知 key 被过滤')
assertEqual(cleanEquipped('{"hat":"scarf_blue"}'), emptyPetEquipped(), 'slot 与目录不符被过滤')
assertEqual(cleanEquipped('{"hat":"hat_red","extra":"x","neck":123}'), equippedWith({ hat: 'hat_red' }), '多余字段与非法值被忽略')
assertEqual(cleanEquipped('{"hat":"HAT_RED"}'), emptyPetEquipped(), 'key 大小写敏感')
assertEqual(cleanEquipped('{"face":"glasses_round","neck":"bowtie"}'), equippedWith({ neck: 'bowtie', face: 'glasses_round' }), '多 slot 组合合法')
assertEqual(cleanEquipped('{"back":"wings_bat","aura":"aura_flame"}'), equippedWith({ back: 'wings_bat', aura: 'aura_flame' }), '背部 / 光环槽位合法')
assertEqual(cleanEquipped('{"back":"hat_red"}'), emptyPetEquipped(), '背部槽拒绝头部装扮')

/* ============================================================
   目录不变量
   ============================================================ */

// species
{
  const keys = PET_SPECIES.map((species) => species.key)
  assertEqual(new Set(keys).size, keys.length, '物种 key 唯一')
  assertEqual(keys.length, 6, '共 6 个物种')
  // 前三个历史 key 必须保留，否则库里已有宠物的 species 会失效
  assertEqual(keys.slice(0, 3), ['cat', 'dog', 'bird'], '历史物种 key 保持兼容（cat/dog/bird）')
  assertEqual(keys, ['cat', 'dog', 'bird', 'rabbit', 'fox', 'panda'], '物种 key 顺序与目录一致')
  const HEX = /^#[0-9a-fA-F]{6}$/
  for (const species of PET_SPECIES) {
    assert(species.name.length > 0, `物种 ${species.key} 有名字`)
    assert(species.defaultName.length > 0, `物种 ${species.key} 有默认名`)
    assert(species.defaultName.length <= 12, `物种 ${species.key} 默认名不超过 12 字`)
    assert(species.emoji.length > 0, `物种 ${species.key} 有 emoji`)
    assert(species.description.length > 0, `物种 ${species.key} 有描述`)
    assert(species.personality.length > 0, `物种 ${species.key} 有性格描述`)
    assert(HEX.test(species.palette.primary), `物种 ${species.key} 主色为 6 位十六进制`)
    assert(HEX.test(species.palette.secondary), `物种 ${species.key} 辅色为 6 位十六进制`)
    assert(HEX.test(species.palette.accent), `物种 ${species.key} 点缀色为 6 位十六进制`)
    const colors = new Set(Object.values(species.palette))
    assertEqual(colors.size, 3, `物种 ${species.key} 三色互不相同`)
    assert(species.personality !== species.description, `物种 ${species.key} 性格描述不与简介重复`)
  }
  // 默认名不重复（换物种时按默认名同步名字，重名会让玩家困惑）
  const defaultNames = PET_SPECIES.map((species) => species.defaultName)
  assertEqual(new Set(defaultNames).size, defaultNames.length, '物种默认名互不重复')
  assert(getPetSpecies('fox')?.name === '小狐狸', 'getPetSpecies 能取到新增物种')
  assertEqual(getPetSpecies('unicorn'), null, '未知物种返回 null')
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
  assertEqual(keys.length, 16, '共 16 个特技（13 个既有 + 招手/打喷嚏/打哈欠）')
  for (const trick of PET_TRICKS) {
    assert(trick.minLevel >= 2 && trick.minLevel <= PET_MAX_LEVEL, `特技 ${trick.key} minLevel 在 2–10`)
    assert(trick.emoji.length > 0, `特技 ${trick.key} 有 emoji`)
  }
  // minLevel 覆盖 L2–L10；L3/L6/L9 各有新增动作（招手/打喷嚏/打哈欠）
  const levels = PET_TRICKS.map((trick) => trick.minLevel).sort((a, b) => a - b)
  assertEqual(levels, [2, 3, 3, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9, 10], '特技解锁等级覆盖 L2–L10')
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

/* ============================================================
   换物种：价格与默认名同步规则
   ============================================================ */

assertEqual(PET_COSTS.switch, 100, '换物种花 100 积分')
assertEqual(PET_COSTS.summon, 300, '召唤花 300 积分')
assertEqual(PET_COSTS.feed, 10, '喂食花 10 积分')
assertEqual(PET_COSTS.bathe, 15, '洗澡花 15 积分')
assertEqual(PET_COSTS.play, 20, '玩耍花 20 积分')

{
  const nextSpecies = getPetSpecies('fox')
  assert(nextSpecies !== null, '狐狸物种存在')
  if (nextSpecies) {
    // 名字仍是旧物种默认名 → 同步换成新物种默认名
    assertEqual(
      nextNameAfterSwitch('咪咪', 'cat', nextSpecies),
      '阿狸',
      '旧默认名同步为新物种默认名',
    )
    // 玩家自定义名保留
    assertEqual(
      nextNameAfterSwitch('小橘', 'cat', nextSpecies),
      '小橘',
      '玩家自定义名保留',
    )
    // 默认名带首尾空格也算默认名（trim 后比较）
    assertEqual(
      nextNameAfterSwitch('  咪咪 ', 'cat', nextSpecies),
      '阿狸',
      '默认名比较忽略首尾空格',
    )
    // 未知旧物种 → 无法判断是否默认名，保守保留原名
    assertEqual(
      nextNameAfterSwitch('咪咪', 'unicorn', nextSpecies),
      '咪咪',
      '未知旧物种时保留原名',
    )
    // 旧物种 key 为空 → 保留原名
    assertEqual(nextNameAfterSwitch('咪咪', null, nextSpecies), '咪咪', '空物种 key 保留原名')
  }
}

/* ============================================================
   normalizePetName：名字清洗
   ============================================================ */

assertEqual(normalizePetName(null, '咪咪'), '咪咪', '空值回退默认名')
assertEqual(normalizePetName(undefined, '咪咪'), '咪咪', 'undefined 回退默认名')
assertEqual(normalizePetName('   ', '咪咪'), '咪咪', '全空白回退默认名')
assertEqual(normalizePetName('  小橘  ', '咪咪'), '小橘', 'trim 首尾空格')
assertEqual(normalizePetName('这是一个特别特别长的宠物名字', '咪咪'), '这是一个特别特别长的宠物', '超长名字截断到 12 字')
assertEqual(normalizePetName('这是一个特别特别长的宠物名字', '咪咪').length, 12, '截断后长度为 12')
assertEqual(normalizePetName('🐱🐱🐱', '咪咪'), '🐱🐱🐱', 'emoji 名字可用')

/* ============================================================
   canPatToday / PAT_DAILY_LIMIT：每日撸宠上限
   ============================================================ */

assertEqual(PAT_DAILY_LIMIT, 3, '每天最多撸 3 次')
assertEqual(canPatToday(0), true, '今天还没撸过 → 可以撸')
assertEqual(canPatToday(1), true, '撸过 1 次 → 还可以')
assertEqual(canPatToday(2), true, '撸过 2 次 → 还剩最后一次')
assertEqual(canPatToday(3), false, '撸满 3 次 → 不能再撸')
assertEqual(canPatToday(4), false, '超过上限 → 不能再撸')
assertEqual(canPatToday(0, 0), false, '上限为 0 时永远不能撸')
assertEqual(canPatToday(2, 5), true, '可覆盖上限（2 < 5）')
assertEqual(canPatToday(-1), true, '脏数据（负数）按 0 次处理')
assertEqual(canPatToday(Number.NaN), true, 'NaN 按 0 次处理')

/* ============================================================
   sanitizeGuestbookContent：留言清洗
   ============================================================ */

assertEqual(GUESTBOOK_DAILY_LIMIT, 5, '每天最多留言 5 条')
assertEqual(GUESTBOOK_MAX_LENGTH, 60, '留言上限 60 字')

assertEqual(sanitizeGuestbookContent(null), null, 'null 回 null')
assertEqual(sanitizeGuestbookContent(undefined), null, 'undefined 回 null')
assertEqual(sanitizeGuestbookContent(''), null, '空串回 null')
assertEqual(sanitizeGuestbookContent('   \n\t  '), null, '全空白回 null')
assertEqual(sanitizeGuestbookContent('  你好呀  '), '你好呀', 'trim 首尾空白')
assertEqual(sanitizeGuestbookContent('第一行\n第二行'), '第一行 第二行', '换行压成空格（单行展示）')
assertEqual(sanitizeGuestbookContent('多个    空格'), '多个 空格', '连续空白压成一个空格')
assertEqual(sanitizeGuestbookContent('坏\u0000字符\u0007'), '坏字符', '去掉控制字符')
assertEqual(sanitizeGuestbookContent('\u0000\u0001\u0002'), null, '只有控制字符回 null')
assertEqual(
  sanitizeGuestbookContent('a'.repeat(80)),
  'a'.repeat(60),
  '超长留言截断到 60 字',
)
assertEqual(
  sanitizeGuestbookContent('a'.repeat(80))?.length,
  GUESTBOOK_MAX_LENGTH,
  '截断后长度等于上限',
)
// 注意 JS 字符串 length 是 UTF-16 码元数，emoji 占 2，这里按 code point 复核
assertEqual(Array.from(sanitizeGuestbookContent('🐱'.repeat(70)) ?? '').length, 60, 'emoji 按字符计（不截断半个代理对）')
assertEqual(sanitizeGuestbookContent('  超长留言  '.concat('长'.repeat(80)))?.length, 60, 'trim 后再截断')
assertEqual(sanitizeGuestbookContent('你好，来串门啦～'), '你好，来串门啦～', '正常留言原样保留')

/* ============================================================
   战斗装备目录
   ============================================================ */

assertEqual(PET_EQUIPMENTS.length, 26, '26 件战斗装备')
assertEqual(new Set(PET_EQUIPMENT_KEYS).size, 26, '装备 key 唯一')
assertEqual(PET_EQUIPMENT_SLOTS, ['weapon', 'armor', 'accessory'], '三个装备槽位')
assertEqual(PET_STARTER_EQUIPMENT_KEYS.length, 3, '3 件绑定新手装')
assertEqual(new Set(PET_SHOP_EQUIPMENTS.map((item) => item.key)).size, 9, '商店出售 9 件基础/稀有装备')

const EQUIPMENT_PER_SLOT: Record<string, number> = { weapon: 9, armor: 8, accessory: 9 }
for (const slot of PET_EQUIPMENT_SLOTS) {
  assertEqual(
    PET_EQUIPMENTS.filter((item) => item.slot === slot).length,
    EQUIPMENT_PER_SLOT[slot],
    `${slot} 槽位装备数量与目录一致`,
  )
}
for (const item of PET_EQUIPMENTS) {
  assert(item.key === item.key.toLowerCase(), `${item.key} key 为小写`)
  assert(item.price >= 0 && Number.isInteger(item.price), `${item.key} 价格为非负整数`)
  assert(item.atk >= 0 && item.def >= 0 && item.hp >= 0 && item.spd >= 0 && item.crit >= 0, `${item.key} 属性非负`)
  assert(item.minLevel >= 1 && item.minLevel <= PET_MAX_LEVEL, `${item.key} 等级门槛合法`)
  assert(item.bound === (item.key.startsWith('starter_')), `${item.key} 绑定标记与新手装一致`)
  assert(!item.shopable || !item.bound, `${item.key} 绑定装备不在商店出售`)
  assert(equipmentPower(item) > 0, `${item.key} 战力粗估为正`)
}
assert(PET_EQUIPMENT_MAP.get('iron_blade')?.atk === 8, '铁齿短刃攻击 +8')
assert(PET_EQUIPMENT_MAP.get('dragon_scale')?.def === 20, '龙鳞战甲防御 +20')
assert(PET_EQUIPMENT_MAP.get('starter_bell')?.bound === true, '新手铃铛绑定')
assert(PET_EQUIPMENT_MAP.get('nope') === undefined, '未知装备取不到')

/* ============================================================
   技能目录
   ============================================================ */

assertEqual(PET_SKILLS.length, 24, '24 个技能（含普攻）')
assertEqual(new Set(PET_SKILLS.map((skill) => skill.key)).size, 24, '技能 key 唯一')
assertEqual(PET_SKILL_MAX_EQUIPPED, 3, '最多装备 3 个技能')
assert(PET_SKILL_MAP.has(PET_BASIC_SKILL_KEY), '普攻存在')
assertEqual(PET_SHOP_SKILLS.length, 23, '技能商店出售 23 个技能（不含普攻）')
assert(!PET_SHOP_SKILLS.some((skill) => skill.key === PET_BASIC_SKILL_KEY), '技能商店不卖普攻')

for (const skill of PET_SKILLS) {
  assert(/^[a-z][a-z0-9_-]*$/.test(skill.animation), `${skill.key} animation 合法`)
  assert(skill.mpCost >= 0 && skill.cooldown >= 0, `${skill.key} MP / 冷却非负`)
  assert(skill.price >= 0 && Number.isInteger(skill.price), `${skill.key} 价格非负整数`)
  assert(skill.minLevel >= 1 && skill.minLevel <= PET_MAX_LEVEL, `${skill.key} 等级门槛合法`)
  if (skill.key === PET_BASIC_SKILL_KEY) {
    assertEqual(skill.mpCost, 0, '普攻不耗 MP')
    assertEqual(skill.cooldown, 0, '普攻无冷却')
  } else {
    assert(skill.price > 0, `${skill.key} 商店技能有价格`)
  }
}
assert(skillPower(PET_SKILL_MAP.get('meteor')!) > skillPower(PET_SKILL_MAP.get('basic_attack')!), '流星坠威力高于普攻')

/* ============================================================
   属性派生 / 装配清洗
   ============================================================ */

const baseCat = deriveCombatStats({ species: 'cat', level: 1, equipmentKeys: [] })
assertEqual(baseCat.maxHp, 98, '1 级小猫生命 = 98')
assertEqual(baseCat.maxMp, 62, '1 级小猫魔力 = 62')
assertEqual(baseCat.atk, 15, '1 级小猫攻击 = 15')
assertEqual(baseCat.def, 6, '1 级小猫防御 = 6')
assertEqual(baseCat.spd, 12, '1 级小猫速度 = 12')
assertEqual(baseCat.crit, 8, '1 级小猫暴击 = 8')

const armored = deriveCombatStats({
  species: 'cat',
  level: 1,
  equipmentKeys: ['iron_blade', 'leather_armor', 'swift_boots'],
})
assertEqual(armored.atk, baseCat.atk + 8, '铁齿短刃 +8 攻击')
assertEqual(armored.def, baseCat.def + 5, '硬皮护甲 +5 防御')
assertEqual(armored.maxHp, baseCat.maxHp + 20, '硬皮护甲 +20 生命')
assertEqual(armored.spd, baseCat.spd + 6, '疾风靴 +6 速度')
assertEqual(armored.crit, baseCat.crit + 1, '铁齿短刃 +1 暴击')

const dedup = deriveCombatStats({
  species: 'cat',
  level: 1,
  equipmentKeys: ['iron_blade', 'flame_sword'],
})
assertEqual(dedup.atk, baseCat.atk + 8, '同槽位只取第一件武器')

assertEqual(normalizeEquipmentKeys(['iron_blade', 'nope', 'iron_blade']), ['iron_blade'], '装备去重且过滤未知')
assertEqual(normalizeSkillKeys(['fire_claw', 'basic_attack', 'fire_claw', 'meteor', 'healing_light']), ['fire_claw', 'meteor', 'healing_light'], '技能去重、过滤普攻、最多 3 个')

const rawLoadout = JSON.stringify({
  hat: 'hat_red',
  neck: 'scarf_blue',
  weapon: 'iron_blade',
  armor: 'leather_armor',
  accessory: 'starter_bell',
  skills: ['fire_claw', 'meteor', 'healing_light', 'thunder_bolt'],
})
const loadout = cleanLoadout(
  rawLoadout,
  ['iron_blade', 'leather_armor', 'starter_bell'],
  ['fire_claw', 'meteor', 'healing_light', 'thunder_bolt'],
)
assertEqual(loadout.hat, 'hat_red', '装配清洗保留装扮')
assertEqual(loadout.weapon, 'iron_blade', '装配清洗保留武器')
assertEqual(loadout.armor, 'leather_armor', '装配清洗保留护甲')
assertEqual(loadout.accessory, 'starter_bell', '装配清洗保留饰品')
assertEqual(loadout.skills, ['fire_claw', 'meteor', 'healing_light'], '装配清洗最多 3 个技能')
assertEqual(loadoutEquipmentKeys(loadout), ['iron_blade', 'leather_armor', 'starter_bell'], '导出已穿戴装备 key')

const dirtyLoadout = cleanLoadout(
  JSON.stringify({ weapon: 'void_scythe', skills: ['nope'] }),
  ['iron_blade'],
  [],
)
assertEqual(dirtyLoadout.weapon, null, '未拥有装备被清洗')
assertEqual(dirtyLoadout.skills, [], '未拥有技能被清洗')

const serialized = serializeLoadout(loadout)
assertEqual(serializeLoadout(cleanLoadout(serialized, ['iron_blade', 'leather_armor', 'starter_bell'], ['fire_claw', 'meteor', 'healing_light'])), serialized, '装配序列化往返一致')
assertEqual(emptyPetLoadout().skills, [], '空装配技能为空')

/* ============================================================
   战斗引擎
   ============================================================ */

function battleInput(overrides: Partial<PetCombatInput> = {}): PetCombatInput {
  return {
    petId: 1,
    userId: 1,
    name: '咪咪',
    species: 'cat',
    level: 5,
    equipmentKeys: ['iron_blade', 'leather_armor', 'swift_boots'],
    skillKeys: ['fire_claw', 'ice_shield', 'healing_light'],
    ...overrides,
  }
}

const p1 = battleInput()
const p2 = battleInput({
  petId: 2,
  userId: 2,
  name: '旺旺',
  species: 'dog',
  level: 4,
  equipmentKeys: ['starter_claw', 'starter_vest', 'starter_bell'],
  skillKeys: ['thunder_bolt', 'battle_cry'],
})
const battle = createBattleState([p1, p2], 1_700_000_000_000)
assertEqual(Object.keys(battle.sides).sort(), ['1', '2'], '战斗双方快照')
assertEqual(battle.round, 1, '初始第 1 回合')
assertEqual(battle.finished, false, '初始未结束')
assertEqual(battle.maxRounds, PET_BATTLE_MAX_ROUNDS, '最大回合数 40')
assert(battle.turnUserId === 1 || battle.turnUserId === 2, '先手是其中一方')
const side1 = battle.sides['1']
const side2 = battle.sides['2']
assertEqual(side1.hp, side1.maxHp, '初始满血')
assertEqual(side1.mp, side1.maxMp, '初始满蓝')
assertEqual(side1.skills, ['fire_claw', 'ice_shield', 'healing_light'], '技能快照正确')
assertEqual(side1.equipmentKeys, ['iron_blade', 'leather_armor', 'swift_boots'], '装备快照正确')

// 非当前回合行动被拒绝
const wrongUser = battle.turnUserId === 1 ? 2 : 1
assertEqual(applyBattleAction(battle, wrongUser, 'basic_attack', () => 0.5).error, '还没轮到你行动', '非当前回合行动被拒绝')
// 未装备技能被拒绝
const actorId = battle.turnUserId!
const actor = battle.sides[String(actorId)]
const missingSkill = actor.skills.includes('meteor') ? 'thunder_bolt' : 'meteor'
assertEqual(applyBattleAction(battle, actorId, missingSkill, () => 0.5).error, '没有装备这个技能', '未装备技能被拒绝')

// 普攻造成伤害并切换回合
const attackerBefore = battle.sides[String(actorId)].hp
const defenderBefore = battle.sides[String(actorId === 1 ? 2 : 1)].hp
const basicResult = applyBattleAction(battle, actorId, 'basic_attack', () => 0.5)
assertEqual(basicResult.error, null, '普攻执行成功')
const afterBasic = basicResult.state
assert(afterBasic.sides[String(actorId === 1 ? 2 : 1)].hp < defenderBefore, '普攻减少目标 HP')
assertEqual(afterBasic.sides[String(actorId)].hp, attackerBefore, '普攻不伤自己')
assert(afterBasic.turnUserId !== actorId, '行动后切换回合')
assert(afterBasic.log.length >= 1, '战斗日志有记录')
assertEqual(afterBasic.log.at(-1)!.skillKey, 'basic_attack', '日志记录普攻')
assert(afterBasic.log.at(-1)!.seq > 0, '日志 seq 为正')

// 技能消耗 MP / 设置冷却
const fireState = createBattleState([
  battleInput({ userId: 1, skillKeys: ['fire_claw'] }),
  battleInput({ userId: 2, species: 'panda', level: 1, equipmentKeys: [], skillKeys: [] }),
], 1_700_000_000_000)
fireState.turnUserId = 1
fireState.order = [1, 2]
fireState.orderIndex = 0
const fireResult = applyBattleAction(fireState, 1, 'fire_claw', createBattleRng(7))
assertEqual(fireResult.error, null, '烈焰爪执行成功')
const fireSide = fireResult.state.sides['1']
assert(fireSide.mp < fireSide.maxMp, '技能消耗 MP')
assert((fireSide.cooldowns.fire_claw ?? 0) > 0, '技能进入冷却')
assert(fireResult.state.log.at(-1)!.damage > 0, '技能造成伤害')

// 护盾 / 治疗
const shieldState = createBattleState([
  battleInput({ userId: 1, skillKeys: ['ice_shield'] }),
  battleInput({ userId: 2, species: 'panda', level: 1, equipmentKeys: [], skillKeys: [] }),
])
shieldState.turnUserId = 1
shieldState.order = [1, 2]
shieldState.orderIndex = 0
const shieldResult = applyBattleAction(shieldState, 1, 'ice_shield', createBattleRng(3))
assert(shieldResult.state.sides['1'].shield > 0, '冰晶护盾产生护盾值')
assert(shieldResult.state.sides['1'].shieldTurns > 0, '护盾有持续回合')

const healState = createBattleState([
  battleInput({ userId: 1, skillKeys: ['healing_light'] }),
  battleInput({ userId: 2, species: 'panda', level: 1, equipmentKeys: [], skillKeys: [] }),
])
healState.turnUserId = 1
healState.order = [1, 2]
healState.orderIndex = 0
healState.sides['1'].hp = 20
const healResult = applyBattleAction(healState, 1, 'healing_light', createBattleRng(5))
assert(healResult.state.sides['1'].hp > 20, '治愈之光回复 HP')
assert(healResult.state.log.at(-1)!.heal > 0, '治疗日志记录回复量')

// 认输
const forfeitState = createBattleState([battleInput({ userId: 1 }), battleInput({ userId: 2 })])
const forfeited = applyBattleForfeit(forfeitState, 1, '认输')
assert(forfeited.finished, '认输后战斗结束')
assertEqual(forfeited.winnerId, 2, '认输方判负')
assertEqual(forfeited.loserId, 1, '认输方是败者')
assertEqual(forfeited.result, 'win', '认输结果为 win')

// 连续超时：轮流超时 6 次后累计 3 次的一方判负
let timeoutState = createBattleState([
  battleInput({ userId: 1, level: 10, species: 'panda', equipmentKeys: [], skillKeys: [] }),
  battleInput({ userId: 2, level: 10, species: 'panda', equipmentKeys: [], skillKeys: [] }),
])
for (let index = 0; index < PET_BATTLE_MAX_TIMEOUTS * 2; index += 1) {
  timeoutState = applyBattleTimeout(timeoutState, createBattleRng(index + 1))
  if (timeoutState.finished) break
}
assert(timeoutState.finished, '连续超时触发判负')
assert(timeoutState.winnerId === 1 || timeoutState.winnerId === 2, '超时判负产生胜者')

// 低血量目标会被击杀
let killState = createBattleState([
  battleInput({ userId: 1, level: 10, equipmentKeys: ['iron_blade'], skillKeys: [] }),
  battleInput({ userId: 2, level: 1, species: 'bird', equipmentKeys: [], skillKeys: [] }),
])
killState.turnUserId = 1
killState.order = [1, 2]
killState.orderIndex = 0
killState.sides['2'].hp = 1
const killResult = applyBattleAction(killState, 1, 'basic_attack', createRngAlways(0.5))
assert(killResult.state.finished, 'HP 归零后战斗结束')
assertEqual(killResult.state.winnerId, 1, '击杀者获胜')

function createRngAlways(value: number): () => number {
  return () => value
}

// 可用技能列表（含普攻）
const options = availableSkills(battle.sides['1'])
assertEqual(options[0].key, PET_BASIC_SKILL_KEY, '技能列表第一项是普攻')
assert(options.every((option) => option.name && option.emoji), '技能选项字段完整')
assert(options.some((option) => option.key === 'fire_claw' && option.usable), '烈焰爪初始可用')

/* ============================================================
   交易行纯函数
   ============================================================ */

assertEqual(battleStakeFor(0), 0, '败者 0 分不扣分')
assertEqual(battleStakeFor(5), 5, '败者 5 分只扣 5（不能超过余额）')
assertEqual(battleStakeFor(100), 10, '败者 100 分按最低 10 扣')
assertEqual(battleStakeFor(1000), 80, '败者 1000 分按 8% 扣')
assertEqual(battleStakeFor(10_000), 300, '赌注上限 300')

assertEqual(petMarketFee(100), 5, '100 积分手续费 5%')
assertEqual(petMarketFee(1), 1, '最低手续费 1')
assertEqual(petMarketFee(0), 0, '零价无手续费')
assertEqual(petMarketSellerProceeds(100), 95, '卖家到账 95')
assertEqual(petMarketSellerProceeds(1), 0, '1 积分成交卖家到账 0')

assertEqual(validateListingPrice(500, 1000), null, '参考价 50% 可以挂单')
assertEqual(validateListingPrice(1500, 1000), null, '参考价 150% 可以挂单')
assert(validateListingPrice(499, 1000) !== null, '低于 50% 被拒绝')
assert(validateListingPrice(1501, 1000) !== null, '高于 150% 被拒绝')
assert(validateListingPrice(0, 1000) !== null, '0 价被拒绝')
assert(validateListingPrice(10.5, 1000) !== null, '非整数被拒绝')

const refAfter = nextRefPrice(1000, 1000, 1200, 0)
assert(refAfter > 1000 && refAfter <= 1200, '成交价高于参考价时参考价上移')
assert(refAfter <= 2000, '参考价不超过基础价 2 倍（本次上浮 2%）')
assert(nextRefPrice(1000, 1000, 100, 20) < 1000, '大量在售 + 低价成交时参考价下压')

const decayed = decayRefPrice(2000, 1000, 0, 7 * 86_400_000)
assertCloseNumber(decayed, 1500, 1e-6, '7 天后参考价回归一半')
assertEqual(refPriceChangePct(1100, 1000), 10, '参考价涨幅 10%')

function assertCloseNumber(actual: number, expected: number, tolerance: number, label: string): void {
  assert(Math.abs(actual - expected) <= tolerance, `${label}（实际 ${actual}，期望 ${expected}±${tolerance}）`)
}

console.log(`✅ 宠物系统纯函数自检：${passed} 个断言`)
