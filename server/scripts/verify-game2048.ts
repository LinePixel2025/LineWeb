/**
 * 2048 服务端引擎 + presence TTL 自检脚本（不依赖数据库 / 环境变量 / 网络）
 *
 * 用法: cd server && npx tsx scripts/verify-game2048.ts
 *      （或 npm run verify:game）
 *
 * 覆盖：
 *   - 固定种子初始棋盘确定性、初始 2 个方块与 90% 2 / 10% 4 分布；
 *   - 移动/合并规则（每个方块每次移动最多合并一次）、得分累加；
 *   - 四个方向的滑动正确性；
 *   - 无效移动不生成方块、不消耗随机数；
 *   - 合成 2048（won）与无路可走（lost）判定；
 *   - presence TTL 边界（显式 now 参数）。
 */

import {
  GAME2048_TARGET,
  applyMove,
  boardsEqual,
  createInitialBoard,
  createSeededGame,
  createSeededRandom,
  hasAvailableMoves,
  maxTileValue,
  slideBoard,
  type Game2048Board,
} from '../src/services/game2048.js'
import {
  GAME_PRESENCE_TTL_MS,
  clearGamePresence,
  getGamePresenceAge,
  getGamePresentUserIds,
  isGamePresent,
  markGamePresence,
  pruneGamePresence,
} from '../src/services/gamePresence.js'

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

/** 统计棋盘上的非零方块 */
function countTiles(board: Game2048Board): number {
  let count = 0
  for (const row of board) {
    for (const value of row) {
      if (value !== 0) count += 1
    }
  }
  return count
}

/** 构造棋盘：未给出的行补全为 0 */
function boardOf(rows: number[][]): Game2048Board {
  const board: Game2048Board = []
  for (let row = 0; row < 4; row += 1) {
    const source = rows[row] ?? []
    board.push([0, 1, 2, 3].map((col) => source[col] ?? 0))
  }
  return board
}

/** 可统计调用次数的随机源（用于验证「只有发生移动才生成新方块」） */
function countingRandom(): { random: () => number; calls: () => number } {
  const rng = createSeededRandom(20261023)
  let calls = 0
  return {
    random: () => {
      calls += 1
      return rng()
    },
    calls: () => calls,
  }
}

function verifyEngine(): void {
  // === 初始棋盘：固定种子确定 + 2 个方块 + 数值只有 2/4 ===
  const boardA = createInitialBoard(20261023)
  const boardB = createInitialBoard(20261023)
  assert(boardsEqual(boardA, boardB), '同一 seed 的初始棋盘必须完全一致')
  assert(countTiles(boardA) === 2, '初始棋盘必须有 2 个方块')
  assert(
    boardA.flat().every((value) => value === 0 || value === 2 || value === 4),
    '初始方块数值只能是 2 或 4',
  )

  // createSeededGame 的棋盘与 createInitialBoard 一致，且随机序列可继续使用
  const seeded = createSeededGame(20261023)
  assert(boardsEqual(seeded.board, createInitialBoard(20261023)), 'createSeededGame 与 createInitialBoard 初始棋盘一致')
  const seededAgain = createSeededGame(20261023)
  assertEqual(seeded.random(), seededAgain.random(), '同一 seed 的随机序列必须一致')

  // === 新方块分布：90% 为 2、10% 为 4（统计容差）===
  let fourCount = 0
  let totalCount = 0
  for (let seed = 1; seed <= 2000; seed += 1) {
    for (const value of createInitialBoard(seed).flat()) {
      if (value === 0) continue
      totalCount += 1
      if (value === 4) fourCount += 1
    }
  }
  const fourRatio = fourCount / totalCount
  assert(totalCount === 4000, '2000 个种子应生成 4000 个初始方块')
  assert(fourRatio > 0.05 && fourRatio < 0.16, `4 的比例应接近 10%（实际 ${(fourRatio * 100).toFixed(2)}%）`)

  // === 合并规则：每个方块每次移动最多合并一次，得分 = 合并值之和 ===
  const onceMerge = slideBoard(boardOf([[2, 2, 2, 2]]), 'left')
  assertEqual(onceMerge.board[0], [4, 4, 0, 0], '[2,2,2,2] 向左应合并为 [4,4,0,0]（不能连锁成 8）')
  assertEqual(onceMerge.scoreGained, 8, '合并得分应为 8')
  assert(onceMerge.moved, '[2,2,2,2] 向左应发生移动')

  const noChain = slideBoard(boardOf([[4, 4, 8, 0]]), 'left')
  assertEqual(noChain.board[0], [8, 8, 0, 0], '[4,4,8,0] 向左应合并为 [8,8,0,0]')
  assertEqual(noChain.scoreGained, 8, '[4,4,8,0] 合并得分应为 8')

  const doubleMerge = slideBoard(boardOf([[2, 2, 4, 4]]), 'left')
  assertEqual(doubleMerge.board[0], [4, 8, 0, 0], '[2,2,4,4] 向左应合并为 [4,8,0,0]')
  assertEqual(doubleMerge.scoreGained, 12, '[2,2,4,4] 合并得分应为 12')

  // === 四个方向 ===
  const right = slideBoard(boardOf([[2, 0, 0, 2]]), 'right')
  assertEqual(right.board[0], [0, 0, 0, 4], '向右滑动合并应贴右边')
  assertEqual(right.scoreGained, 4, '向右合并得分应为 4')

  const up = slideBoard(boardOf([[2], [2]]), 'up')
  assertEqual(up.board, [[4, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], '向上滑动合并应贴顶部')

  const down = slideBoard(boardOf([[2], [2]]), 'down')
  assertEqual(down.board, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [4, 0, 0, 0]], '向下滑动合并应贴底部')

  // === 无效移动：不生成方块、不消耗随机数 ===
  const fullRow = boardOf([[2, 4, 8, 16]])
  const noopSlide = slideBoard(fullRow, 'left')
  assert(!noopSlide.moved, '[2,4,8,16] 向左应为无效移动')
  assertEqual(noopSlide.scoreGained, 0, '无效移动不得得分')

  const noopRandom = countingRandom()
  const noopMove = applyMove(fullRow, 'left', noopRandom.random)
  assert(!noopMove.moved, 'applyMove 无效移动 moved=false')
  assertEqual(noopMove.spawned, null, '无效移动不得生成新方块')
  assertEqual(noopRandom.calls(), 0, '无效移动不得消耗随机数')

  // === 有效移动：生成一个新方块（消耗 2 次随机数）===
  const movedRandom = countingRandom()
  const movedMove = applyMove(boardOf([[2, 2, 0, 0]]), 'left', movedRandom.random)
  assert(movedMove.moved, '[2,2,0,0] 向左应发生移动')
  assertEqual(movedMove.scoreGained, 4, '合并 2+2 得分应为 4')
  assert(movedMove.spawned !== null, '有效移动必须生成一个新方块')
  assertEqual(movedRandom.calls(), 2, '生成新方块应消耗 2 次随机数（位置 + 数值）')
  assertEqual(countTiles(movedMove.board), 2, '合并后生成新方块，方块数应保持 2')

  // 同一起点 + 同一 seed → 完全一致的结果（可复现）
  const replayA = applyMove(boardOf([[2, 2, 0, 0]]), 'left', createSeededRandom(77))
  const replayB = applyMove(boardOf([[2, 2, 0, 0]]), 'left', createSeededRandom(77))
  assert(boardsEqual(replayA.board, replayB.board), '同一起点 + 同一 seed 的移动结果必须一致')

  // === 达成目标（won）：合成 2048 ===
  const winMove = applyMove(boardOf([[1024, 1024, 0, 0]]), 'left', createSeededRandom(7))
  assertEqual(winMove.scoreGained, 2048, '1024+1024 合并得分应为 2048')
  assertEqual(maxTileValue(winMove.board), GAME2048_TARGET, '合成后最大方块应为目标 2048')
  assert(maxTileValue(winMove.board) >= GAME2048_TARGET, '最大方块达到目标即可判定获胜')

  // === 无路可走（lost）：满盘且相邻无相同数字 ===
  const deadBoard = boardOf([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ])
  assert(!hasAvailableMoves(deadBoard), '满盘且相邻无相同数字应无可用移动（lost）')
  assert(hasAvailableMoves(boardOf([[2, 2, 4, 8], [4, 8, 16, 32], [2, 4, 8, 16], [4, 8, 16, 32]])), '存在相邻相同数字时仍有移动')
  assert(hasAvailableMoves(boardOf([[2, 4, 8, 16], [4, 8, 16, 32], [2, 4, 8, 16], [4, 8, 16, 0]])), '存在空格时仍有移动')
}

function verifyPresence(): void {
  const userId = 9001
  const otherUserId = 9002
  clearGamePresence(userId)
  clearGamePresence(otherUserId)

  assertEqual(GAME_PRESENCE_TTL_MS, 90_000, 'presence TTL 应为 90 秒')
  assert(!isGamePresent(userId, 1_000_000), '从未上报 presence 的用户不在线')

  markGamePresence(userId, 1_000_000)
  assert(isGamePresent(userId, 1_000_000), '刚上报 presence 应在线')
  assert(isGamePresent(userId, 1_000_000 + GAME_PRESENCE_TTL_MS - 1), 'presence 到期前 1ms 仍应在线')
  assert(!isGamePresent(userId, 1_000_000 + GAME_PRESENCE_TTL_MS), 'presence 恰好到期时应判定过期')
  assert(!isGamePresent(otherUserId, 1_000_000), '不同用户的 presence 互不影响')
  assertEqual(getGamePresenceAge(userId, 1_000_000 + 30_000), 30_000, 'presence age 应等于 now - 最后心跳时间')

  // 心跳续期：TTL 内再次上报应延长在线时间
  markGamePresence(userId, 1_000_000 + 60_000)
  assert(isGamePresent(userId, 1_000_000 + 60_000 + GAME_PRESENCE_TTL_MS - 1), '心跳续期后应重新计算 TTL')
  assertEqual(getGamePresentUserIds(1_000_000 + 60_000), [userId], '有效的 presence 用户应出现在列表中')

  // 清理过期记录
  markGamePresence(otherUserId, 1_000_000)
  const removed = pruneGamePresence(1_000_000 + 60_000 + GAME_PRESENCE_TTL_MS)
  assertEqual(removed, 2, '过期 presence 应被清理（两条）')
  assert(!isGamePresent(userId, 1_000_000 + 60_000 + GAME_PRESENCE_TTL_MS), '清理后不再在线')
  assertEqual(getGamePresentUserIds(1_000_000 + 60_000 + GAME_PRESENCE_TTL_MS), [], '清理后在线列表为空')

  clearGamePresence(userId)
  clearGamePresence(otherUserId)
}

try {
  verifyEngine()
  verifyPresence()
  console.log(`✓ verify-game2048 全部通过（${passed} 条断言）`)
} catch (error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error('✗ verify-game2048 验证失败：')
  console.error(message)
  process.exitCode = 1
}
