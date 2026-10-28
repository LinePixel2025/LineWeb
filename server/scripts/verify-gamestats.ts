/**
 * 游戏战绩纯函数 / 联机回调自检（不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-gamestats.ts
 *      （或 npm run verify:gamestats）
 */

import {
  buildSoloDelta,
  clampImportRecord,
  mergeCounters,
  validateSoloResult,
  type GameStatCounters,
} from '../src/lib/gameStatsRules.js'
import { getLeaderboardMetric, LEADERBOARD_METRICS } from '../src/lib/gameLeaderboard.js'
import {
  publishGameEnd,
  resetGameStatsDedupForTest,
  setGameResultListener,
  type GameEndResult,
} from '../src/services/gameStatsHooks.js'

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

const empty: GameStatCounters = {
  games: 0, wins: 0, losses: 0, draws: 0, deaths: 0,
  scoreTotal: 0, bestScore: 0, bestTimeMs: null, bestCombo: 0,
  bestCoins: 0, bestDistance: 0, totalJumps: 0, offsetSum: 0, offsetCount: 0,
}

// === mergeCounters ===
assertEqual(mergeCounters(empty, { games: 1, wins: 1, scoreTotal: 100, bestScore: 100 }), {
  ...empty, games: 1, wins: 1, scoreTotal: 100, bestScore: 100,
}, '单局胜利合并')

let merged = mergeCounters(
  { ...empty, games: 3, wins: 1, bestScore: 500, bestTimeMs: 9000, offsetSum: 3.5, offsetCount: 2 },
  { games: 1, losses: 1, bestScore: 300, bestTimeMs: 12000, offsetSum: 1.5, offsetCount: 1 },
)
assertEqual(merged.games, 4, 'games 累加')
assertEqual(merged.bestScore, 500, 'bestScore 取 max')
assertEqual(merged.bestTimeMs, 9000, 'bestTimeMs 取 min')
assertEqual(merged.offsetSum, 5, 'offsetSum 累加')
assertEqual(merged.offsetCount, 3, 'offsetCount 累加')

merged = mergeCounters(empty, { bestTimeMs: null, games: 1 })
assertEqual(merged.bestTimeMs, null, 'null 不覆盖 bestTimeMs')

merged = mergeCounters({ ...empty, scoreTotal: 200 }, { scoreTotal: -350 })
assertEqual(merged.scoreTotal, -150, '斗地主负积分累加')

// === validateSoloResult ===
assertEqual(validateSoloResult({ game: '2048', variant: 'solo', score: 1024 }), null, '2048 合法')
assertEqual(validateSoloResult({ game: '2048', variant: 'online', score: 1024 }), '无效的战绩模式', '联机不能走单机上报')
assertEqual(validateSoloResult({ game: 'doudizhu', variant: 'solo' }), '缺少胜负结果', '斗地主缺胜负')
assertEqual(validateSoloResult({ game: '2048', variant: 'solo', score: -1 }), '分数必须是非负整数', '负分拒绝')
assertEqual(validateSoloResult({ game: '2048', variant: 'solo', score: 5_000_001 }), '分数超出允许范围', '2048 上限')
assertEqual(validateSoloResult({ game: 'minesweeper', variant: 'expert', outcome: 'win', timeMs: 24 * 3600 * 1000 + 1 }), '用时超出允许范围', '用时上限')
assertEqual(validateSoloResult({ game: 'jump', variant: 'solo', timeMs: 100 }), '该游戏不接受用时', '非扫雷不接受用时')
assertEqual(validateSoloResult({ game: 'parkour', variant: 'solo', distanceM: 100_001 }), '距离超出允许范围', '距离上限')
assertEqual(validateSoloResult({ game: 'liar', variant: 'solo', outcome: 'win', deaths: 2 }), null, '骗子酒馆死亡数合法')

const msWin = buildSoloDelta({ game: 'minesweeper', variant: 'expert', outcome: 'win', timeMs: 8500 })
assertEqual(msWin.bestTimeMs, 8500, '扫雷胜利记录最佳用时')
assertEqual(msWin.wins, 1, '扫雷胜利计胜场')
const msLoss = buildSoloDelta({ game: 'minesweeper', variant: 'expert', outcome: 'loss', timeMs: 5000 })
assertEqual(msLoss.bestTimeMs, undefined, '扫雷失败不更新最佳用时')
const jumpDelta = buildSoloDelta({ game: 'jump', variant: 'solo', score: 320, jumps: 12, maxCombo: 5, offset: -0.3 })
assertEqual(jumpDelta.scoreTotal, 320, '跳一跳总分')
assertEqual(jumpDelta.bestScore, 320, '跳一跳最高分')
assertEqual(jumpDelta.bestCombo, 5, '跳一跳连击')
assertEqual(jumpDelta.totalJumps, 12, '跳一跳跳跃数')
assertEqual(jumpDelta.offsetSum, 0.3, '落点偏差取绝对值')
assertEqual(jumpDelta.offsetCount, 1, '落点偏差计数')

// === 导入 ===
const imported = clampImportRecord({
  game: 'jump', variant: 'solo', games: 30, wins: 0, losses: 0,
  scoreTotal: 45000, bestScore: 3200, bestCombo: 18,
  totalJumps: 600, offsetSum: 42.5, offsetCount: 30,
})
assert(imported !== null, '导入记录合法')
assertEqual(imported?.delta.games, 30, '导入局数')
assertEqual(imported?.delta.bestScore, 3200, '导入最高分')
assertEqual(imported?.delta.offsetSum, 42.5, '导入偏差和')
assertEqual(clampImportRecord({ game: 'minecraft', variant: 'solo', games: 1 }), null, '我的世界不导入')
assertEqual(clampImportRecord({ game: 'jump', variant: 'online', games: 1 }), null, '导入未知变体')
assertEqual(clampImportRecord({ game: 'jump', variant: 'solo', games: -1 }), null, '导入负局数')
assertEqual(clampImportRecord({ game: 'jump', variant: 'solo', bestTimeMs: 0 })?.delta.bestTimeMs, undefined, '0 用时不写入最佳')

// === 排行榜指标 ===
assertEqual(getLeaderboardMetric('2048', 'solo')?.metric, 'bestScore', '2048 榜指标')
assertEqual(getLeaderboardMetric('2048', 'solo')?.order, 'desc', '2048 降序')
assertEqual(getLeaderboardMetric('minesweeper', 'expert')?.metric, 'bestTimeMs', '扫雷榜指标')
assertEqual(getLeaderboardMetric('minesweeper', 'expert')?.order, 'asc', '扫雷升序')
assertEqual(getLeaderboardMetric('minesweeper', 'online')?.metric, 'wins', '扫雷联机按胜场')
assertEqual(getLeaderboardMetric('doudizhu', 'solo')?.metric, 'scoreTotal', '斗地主积分榜')
assertEqual(getLeaderboardMetric('gomoku', 'online')?.metric, 'wins', '五子棋胜场榜')
assertEqual(getLeaderboardMetric('parkour', 'solo')?.metric, 'bestDistance', '跑酷最远距离')
assertEqual(getLeaderboardMetric('minecraft', 'solo'), null, '我的世界无榜')
assertEqual(getLeaderboardMetric('2048', 'nope'), null, '未知变体无榜')
assert(LEADERBOARD_METRICS.length >= 10, '排行榜指标覆盖多款游戏')

// === 联机回调 ===
const received: GameEndResult[] = []
setGameResultListener((result) => { received.push(result) })
resetGameStatsDedupForTest()

publishGameEnd({
  game: '2048', matchId: 1, reason: 'timeout',
  results: [{ userId: 1, outcome: 'win', score: 100 }, { userId: 2, outcome: 'loss', score: 50 }],
})
assertEqual(received.length, 1, '联机结算回调一次')
publishGameEnd({
  game: '2048', matchId: 1, reason: 'timeout',
  results: [{ userId: 1, outcome: 'win', score: 100 }],
})
assertEqual(received.length, 1, '同一 matchId 不重复记录')

publishGameEnd({ game: '2048', matchId: 2, reason: 'cancelled', results: [{ userId: 1, outcome: 'win' }] })
assertEqual(received.length, 1, 'cancelled 不记录')
publishGameEnd({ game: 'snake', matchId: 2, reason: 'abandoned', results: [{ userId: 1, outcome: 'loss' }] })
assertEqual(received.length, 1, 'abandoned 不记录')

setGameResultListener(null)
publishGameEnd({ game: 'snake', matchId: 3, reason: 'timeout', results: [{ userId: 1, outcome: 'win' }] })
assert(true, '无 listener 不抛错')

console.log(`✅ 游戏战绩自检通过：${passed} 个断言`)
