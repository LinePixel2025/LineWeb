/**
 * 游戏门票纯函数自检（不依赖数据库 / 网络）。
 *
 * 覆盖：11 款收票游戏清单、门票经济（40 / 返 20 / 回收 18 的不等式）、
 *       幂等键（c/s 单机、c/o/r o 联机、f 返还）唯一性与确定性、
 *       入参归一化（会话 id / 用户集合 / 对局 id / 备注 / 张数）、
 *       悬空会话判定边界，以及「免票自动放弃」与「管理员免票」两条口径。
 *
 * 用法: cd server && npx tsx scripts/verify-ticket.ts（或 npm run verify:ticket）
 */

import {
  MAX_MATCH_SEATS,
  MAX_TICKET_NOTE_LENGTH,
  NON_TICKETED_GAMES,
  SOLO_TICKET_VARIANT,
  STALE_SOLO_SESSION_MS,
  TICKET_ACTIONS,
  TICKET_ERROR_CODE,
  TICKET_GAME_KEYS,
  TICKET_ITEM_KEY,
  TICKET_NET_COST_PER_MATCH,
  TICKET_PRICE,
  TICKET_RECYCLE_VALUE,
  TICKET_REFUND_POINTS,
  consumeOnlineDedupKey,
  consumeSoloDedupKey,
  isStaleSoloSession,
  isTicketExemptMode,
  isTicketExemptRole,
  isTicketGame,
  normalizeMatchId,
  normalizeSessionId,
  normalizeTicketAmount,
  normalizeTicketGame,
  normalizeTicketNote,
  normalizeUserIds,
  refundOnlineDedupKey,
  refundSoloDedupKey,
  returnOnlineDedupKey,
  soloResultNeedsSession,
  ticketDeltaForAction,
  ticketEconomicsSane,
  ticketVariantOf,
} from '../src/lib/gameTicketRules.js'
import { GAME_KEYS } from '../src/lib/gameStatsRules.js'
import {
  GAME_TICKET_KEY,
  RAID_ITEMS,
  RAID_ITEM_MAP,
  raidSellPrice,
  raidShopItemPrice,
} from '../src/lib/raidRun.js'

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
   1. 收票游戏清单
   ============================================================ */

const EXPECTED_GAMES = [
  '2048',
  'doudizhu',
  'snake',
  'minesweeper',
  'jump',
  'minecraft',
  'gomoku',
  'liar',
  'uno',
  'xiangqi',
  'parkour',
] as const

assertEqual(TICKET_GAME_KEYS.length, 11, '恰好 11 款游戏需要门票')
for (const game of EXPECTED_GAMES) {
  assert(isTicketGame(game), `${game} 需要门票`)
}
// 我的世界不报战绩（不在 GAME_KEYS 里），但同样要收票 —— 两张清单必须解耦
assert(!(GAME_KEYS as readonly string[]).includes('minecraft'), '我的世界不在战绩清单里（历史口径）')
assert(isTicketGame('minecraft'), '我的世界仍要收票')
for (const game of GAME_KEYS) {
  assert(isTicketGame(game), `战绩游戏 ${game} 必须在门票清单里（不能有免费的刷分口）`)
}

assert(!isTicketGame('farm'), '农场不收门票')
assert(!isTicketGame('raid'), '搜打撤不收门票（保留地图入场费）')
assert(!isTicketGame('redis'), '未知 key 不是收票游戏')
assert(!isTicketGame(''), '空 key 不是收票游戏')
assert(normalizeTicketGame(' 2048 ') === '2048', '归一化去空白')
assertEqual(normalizeTicketGame('2048X'), null, '未知 key 归一化为 null')
assertEqual(normalizeTicketGame(2048), null, '非字符串归一化为 null')

assertEqual(NON_TICKETED_GAMES.length, 3, '免票玩法共 3 类')
for (const mode of NON_TICKETED_GAMES) {
  assert(isTicketExemptMode(mode), `${mode} 判定为免票玩法`)
  assert(isTicketExemptMode(mode.toUpperCase()), `${mode} 大小写不敏感`)
}
assert(!isTicketExemptMode('2048'), '收票游戏不是免票玩法')
assert(!isTicketExemptMode(null), 'null 不是免票玩法')

/* ============================================================
   2. 门票经济
   ============================================================ */

assertEqual(TICKET_ITEM_KEY, 'game_ticket', '门票物品 key')
assertEqual(TICKET_ITEM_KEY, GAME_TICKET_KEY, '规则层与引擎层用的是同一个 key')
assertEqual(TICKET_PRICE, 40, '官方售价 40 积分')
assertEqual(TICKET_REFUND_POINTS, 20, '局终必返 20 积分')
assertEqual(TICKET_NET_COST_PER_MATCH, 20, '每局净成本 20 积分')
assertEqual(TICKET_RECYCLE_VALUE, 18, '门票目录价值 18（回收价同额，material 100%）')
assert(TICKET_RECYCLE_VALUE < TICKET_REFUND_POINTS, '回收价必须低于返还额：卖票不能比打一把更赚')
assert(TICKET_PRICE > TICKET_REFUND_POINTS, '售价必须高于返还额：不允许零成本刷分')
assert(ticketEconomicsSane(), '门票经济整体自洽')

const ticketDef = RAID_ITEM_MAP.get(GAME_TICKET_KEY)
assert(!!ticketDef, '门票在 RAID_ITEMS 目录里（所以能被摸出来、能进仓库）')
assertEqual(ticketDef?.kind, 'material', '门票是普通材料（不是消耗品，回收按 100%）')
assertEqual(ticketDef?.stackMax, 5, '门票单格堆叠上限 5')
assertEqual(raidShopItemPrice(GAME_TICKET_KEY), TICKET_PRICE, '商店一口价必须是 40（走 shopPrice 覆盖）')
assertEqual(raidSellPrice(GAME_TICKET_KEY, 1), TICKET_RECYCLE_VALUE, '回收价与目录价值一致')
assert(
  RAID_ITEMS.filter((item) => item.key === GAME_TICKET_KEY).length === 1,
  '目录里只能有一张门票定义',
)

/* ============================================================
   3. 幂等键
   ============================================================ */

assertEqual(consumeSoloDedupKey(7), 'c:s:7', '单机扣票键格式')
assertEqual(refundSoloDedupKey(7), 'f:s:7', '单机返分键格式')
assertEqual(consumeOnlineDedupKey('2048', 'm-1', 3), 'c:o:2048:m-1:3', '联机扣票键格式')
assertEqual(returnOnlineDedupKey('2048', 'm-1', 3), 'r:o:2048:m-1:3', '联机退票键格式')
assertEqual(refundOnlineDedupKey('2048', 'm-1', 3), 'f:o:2048:m-1:3', '联机返分键格式')

assert(consumeSoloDedupKey(7) !== refundSoloDedupKey(7), '扣票与返分不能撞键')
assert(
  consumeOnlineDedupKey('uno', 'm-1', 3) !== consumeOnlineDedupKey('uno', 'm-1', 4),
  '同一局不同玩家的扣票键互不相同（否则会互相幂等吞掉）',
)
assert(
  consumeOnlineDedupKey('uno', 'm-1', 3) !== consumeOnlineDedupKey('liar', 'm-1', 3),
  '不同游戏的同名对局 id 不能撞键',
)
assert(
  consumeOnlineDedupKey('uno', 'm-1', 3) === consumeOnlineDedupKey('uno', 'm-1', 3),
  '同一入参必须得到同一个键（重启后靠它幂等）',
)

/* ============================================================
   4. 入参归一化
   ============================================================ */

assertEqual(normalizeSessionId(12), 12, '正整数会话 id 有效')
assertEqual(normalizeSessionId(0), null, '0 不是有效会话')
assertEqual(normalizeSessionId(-3), null, '负数不是有效会话')
assertEqual(normalizeSessionId(1.5), null, '小数不是有效会话')
assertEqual(normalizeSessionId('12'), null, '字符串数字不接受（避免字符串与数字双开同一会话）')
assertEqual(normalizeSessionId(Number.NaN), null, 'NaN 不是有效会话')

assertEqual(normalizeUserIds([3, 1, 3, 2]).join(','), '3,1,2', '用户集合去重且保持顺序')
assertEqual(normalizeUserIds([0, -1, 2.5, 'x', 4]).join(','), '4', '脏元素被丢弃')
assertEqual(normalizeUserIds(null).length, 0, '非数组得到空集合')
const manyUsers = Array.from({ length: MAX_MATCH_SEATS + 5 }, (_, i) => i + 1)
assertEqual(normalizeUserIds(manyUsers).length, MAX_MATCH_SEATS, '用户集合按房间上限截断')

assertEqual(normalizeMatchId(42), '42', '数字对局 id 转字符串')
assertEqual(normalizeMatchId('  m-42 '), 'm-42', '字符串对局 id 去空白')
assertEqual(normalizeMatchId(''), null, '空串不是有效对局 id')
assertEqual(normalizeMatchId(null), null, 'null 不是有效对局 id')

assertEqual(normalizeTicketNote('  你好\n世界  '), '你好 世界', '备注压掉换行并去首尾空白')
assertEqual(normalizeTicketNote('   '), null, '空备注归一化为 null')
assertEqual(
  normalizeTicketNote('x'.repeat(MAX_TICKET_NOTE_LENGTH + 50))?.length,
  MAX_TICKET_NOTE_LENGTH,
  '备注按上限截断',
)

assertEqual(normalizeTicketAmount(3), 3, '正常件数原样返回')
assertEqual(normalizeTicketAmount(-2), 0, '负数脏数据夹到 0')
assertEqual(normalizeTicketAmount(2.9), 2, '小数向下取整')
assertEqual(normalizeTicketAmount(Number.POSITIVE_INFINITY), 0, '无穷按 0')

/* ============================================================
   5. 会话生命周期 / 返还口径
   ============================================================ */

assertEqual(STALE_SOLO_SESSION_MS, 6 * 60 * 60 * 1000, '悬空会话阈值 6 小时')
assert(!isStaleSoloSession(1000, 1000 + STALE_SOLO_SESSION_MS - 1), '未到 6 小时不算悬空')
assert(isStaleSoloSession(1000, 1000 + STALE_SOLO_SESSION_MS), '刚到 6 小时就算悬空（>= 边界）')
assert(!isStaleSoloSession(Number.NaN, 2000), '脏时间戳不判悬空')

assert(!soloResultNeedsSession(false, undefined), '门票关闭时不要求会话（与上线前逐字一致）')
assert(soloResultNeedsSession(true, undefined), '门票开启时缺会话必须拒绝')
assert(!soloResultNeedsSession(true, 5), '门票开启时有会话即可')

assertEqual(ticketDeltaForAction('consume'), -1, '扣票记 -1 张')
assertEqual(ticketDeltaForAction('return'), 1, '退票记 +1 张')
assertEqual(ticketDeltaForAction('refund'), 0, '返还积分不动票数')
assertEqual(ticketDeltaForAction(TICKET_ACTIONS.consume), -1, '动作常量与函数口径一致')

assertEqual(isTicketExemptRole('admin'), true, '管理员免票')
assert(!isTicketExemptRole('author'), '普通作者不免票')
assert(!isTicketExemptRole('app'), '应用令牌不免票')
assertEqual(TICKET_ERROR_CODE, 'TICKET_REQUIRED', '缺票错误码固定（前端据此弹购买引导）')

/* ============================================================
   6. 玩法维度
   ============================================================ */

assertEqual(ticketVariantOf('solo'), SOLO_TICKET_VARIANT, '单机变体归一化为 single')
assertEqual(ticketVariantOf('online'), 'online', '联机变体归一化为 online')
assertEqual(ticketVariantOf('beginner'), SOLO_TICKET_VARIANT, '扫雷三档都算单机')
assertEqual(ticketVariantOf('nonsense'), null, '未知变体归一化为 null')

console.log(`✅ 游戏门票自检：${passed} 个断言`)
