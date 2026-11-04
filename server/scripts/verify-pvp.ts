/**
 * 搜打撤 PvP 纯函数自检（不依赖数据库 / 网络）。
 *
 * 覆盖：3v3 分队均衡、佣兵补位数量、成局时机（满 6 人 / 等满 45 秒）、
 *       开火前置校验（队友 / 不同房 / 冷却）、pvp 掉落模式，以及「伤害只认服务端」的口径常量。
 *
 * 用法: cd server && npx tsx scripts/verify-pvp.ts（或 npm run verify:pvp）
 */

import {
  RAID_PVP_FILL_MS,
  RAID_PVP_SHOT_MULT,
  RAID_PVP_STRIKE_COOLDOWN_MS,
  RAID_PVP_TEAM_SIZE,
  canStrike,
  mercFillCounts,
  pvpLootMode,
  shouldFormMatch,
  splitIntoFactions,
} from '../src/services/raidPvpService.js'
import { rarityWeightAtTier, raidItemModeAllowed, RAID_ITEM_MAP } from '../src/lib/raidRun.js'

let passed = 0

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`断言失败：${message}`)
  passed += 1
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${message}\n  实际: ${String(actual)}\n  期望: ${String(expected)}`)
  }
  passed += 1
}

/* ============================================================
   1. 分队
   ============================================================ */

assertEqual(RAID_PVP_TEAM_SIZE, 3, '固定 3v3')
const six = splitIntoFactions([1, 2, 3, 4, 5, 6])
assertEqual(six.A.length, 3, '6 人时 A 队 3 人')
assertEqual(six.B.length, 3, '6 人时 B 队 3 人')
assertEqual(six.A.join(','), '1,3,5', '按加入顺序交替分到 A')
assertEqual(six.B.join(','), '2,4,6', '按加入顺序交替分到 B')

const five = splitIntoFactions([11, 12, 13, 14, 15])
assert(Math.abs(five.A.length - five.B.length) <= 1, '奇数人数时两队差 ≤ 1（均衡）')

const single = splitIntoFactions([99])
assertEqual(single.A.length, 1, '单人排队也能成局（其余靠佣兵）')
assertEqual(single.B.length, 0, '单人时 B 队没有真人')

const dup = splitIntoFactions([7, 7])
assert(dup !== null, '脏输入不崩（重复 id 由上层 normalizeQueue 负责）')

/* ============================================================
   2. 佣兵补位
   ============================================================ */

assertEqual(mercFillCounts(3, 3).A + mercFillCounts(3, 3).B, 0, '两队都满 3 人时不需要佣兵')
const fill2 = mercFillCounts(2, 0)
assertEqual(fill2.A, 1, 'A 队 2 人时补 1 个佣兵')
assertEqual(fill2.B, 3, 'B 队 0 人时补 3 个佣兵')
assertEqual(fill2.A + fill2.B, 4, '2 真人局共 4 个佣兵')
const fill1 = mercFillCounts(1, 0)
assertEqual(fill1.A + fill1.B, 5, '1 真人局共 5 个佣兵')
assertEqual(mercFillCounts(5, 5).A, 0, '超过上限时不补（也不为负）')
assertEqual(mercFillCounts(-2, -1).A, 3, '脏负数按 0 处理')

/* ============================================================
   3. 成局时机
   ============================================================ */

const now = 1_000_000
assert(!shouldFormMatch([], now), '空队列不成局')
assert(!shouldFormMatch([{ at: now - 1000 }], now), '只有 1 个人且没等满时不成局')
assertEqual(RAID_PVP_FILL_MS, 45_000, '补位等待窗口 45 秒')
assert(
  shouldFormMatch([{ at: now - RAID_PVP_FILL_MS }, { at: now - 1000 }], now),
  '两人等满 45 秒后成局（缺位由佣兵补）',
)
assert(
  !shouldFormMatch([{ at: now - RAID_PVP_FILL_MS }, { at: now - 1000 }], now - 1000),
  '窗口未到时不成局',
)
const sixQueued = Array.from({ length: 6 }, (_, i) => ({ at: now - i }))
assert(shouldFormMatch(sixQueued, now), '满 6 人立即成局，不用等')
assert(!shouldFormMatch(Array.from({ length: 5 }, (_, i) => ({ at: now - i })), now - 10_000), '5 人未满窗口时继续等')

/* ============================================================
   4. 开火校验
   ============================================================ */

assertEqual(RAID_PVP_STRIKE_COOLDOWN_MS, 700, '开火冷却 700ms')
const base = {
  attackerFaction: 'A' as const,
  targetFaction: 'B' as const,
  attackerRoom: 3,
  targetRoom: 3,
  lastStrikeAt: 0,
  nowMs: 10_000,
}
assert(canStrike(base).ok, '同房 + 敌对 + 无冷却 → 可以开火')
assert(!canStrike({ ...base, targetFaction: 'A' }).ok, '队友不能打（没有友军伤害）')
assertEqual(canStrike({ ...base, targetFaction: 'A' }).reason, '不能攻击队友', '队友拦截原因')
assert(!canStrike({ ...base, targetRoom: 4 }).ok, '不同房间打不到')
assert(!canStrike({ ...base, lastStrikeAt: 10_000 - RAID_PVP_STRIKE_COOLDOWN_MS + 1 }).ok, '冷却未结束不能开火')
assert(canStrike({ ...base, lastStrikeAt: 10_000 - RAID_PVP_STRIKE_COOLDOWN_MS }).ok, '冷却刚好走完可以开火')

/* ============================================================
   5. 掉落模式 / 伤害口径
   ============================================================ */

assertEqual(pvpLootMode(), 'pvp', 'PvP 用 pvp 掉落表')
assert(RAID_PVP_SHOT_MULT > 1, '玩家一枪倍率高于 1（但仍受目标护甲减伤）')
assert(rarityWeightAtTier('mythic', 5, 'pvp') > 0, 'pvp 模式 5 档会出神话')
assertEqual(rarityWeightAtTier('mythic', 5, 'normal'), 0, '普通模式 5 档也不出神话')
assertEqual(rarityWeightAtTier('mythic', 4, 'pvp'), 0, 'pvp 4 档仍不出神话')

const heart = RAID_ITEM_MAP.get('heart_of_africa')
assert(!!heart, '非洲之心在目录里')
assert(heart?.pvpOnly === true, '非洲之心标了 pvpOnly')
assert(!raidItemModeAllowed(heart!, 'normal'), '普通模式永远不掉非洲之心')
assert(raidItemModeAllowed(heart!, 'pvp'), 'pvp 模式允许掉非洲之心')

const abyssCore = RAID_ITEM_MAP.get('abyss_core')
assert(!!abyssCore, '深渊核心在目录里')
assert(raidItemModeAllowed(abyssCore!, 'normal'), '深渊核心本身没被 pvpOnly 限制（只是权重为 0）')

console.log(`✅ 搜打撤 PvP 自检：${passed} 个断言`)
