/**
 * 五子棋纯函数引擎测试
 *
 * 覆盖：棋盘构造与坐标换算、四方向五连判定（含长连 / 不足五连 / 断连 / 空点）、
 * 满盘判定、评估分档（活四 > 冲四 > 活三、成五档）、启发式选点
 * （空盘天元 / 成五直落 / 必堵 / 固定 rand 可复现 / 候选点贴近已有棋子）、
 * AI 自对弈完整性（双方用同一引擎互下，必然终止且每步合法）、
 * 双端引擎源码对齐（服务端是权威判定，两边漂移会让本测试失败），
 * 以及游戏大厅目录的五子棋条目。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  GOMOKU_BLACK,
  GOMOKU_BOARD_SIZE,
  GOMOKU_CELL_COUNT,
  GOMOKU_WHITE,
  createGomokuBoard,
  evaluateGomokuPoint,
  findGomokuWin,
  gomokuIndex,
  isGomokuBoardFull,
  isGomokuCellEmpty,
  isInGomokuBoard,
  placeGomokuStone,
  suggestGomokuMove,
  type GomokuBoard,
} from '../gomoku'
import { GAME_CATALOG, getGameCatalogEntry, isGamePlayable } from '../catalog'

/** 空棋盘（全部为 0） */
function emptyBoard(): GomokuBoard {
  return new Array<number>(GOMOKU_CELL_COUNT).fill(0)
}

/** 在一维棋盘上落子（y 行 x 列） */
function put(board: GomokuBoard, x: number, y: number, color: number): void {
  board[y * GOMOKU_BOARD_SIZE + x] = color
}

describe('五子棋棋盘基础', () => {
  it('常量与棋盘构造', () => {
    expect(GOMOKU_BOARD_SIZE).toBe(15)
    expect(GOMOKU_CELL_COUNT).toBe(225)
    expect(GOMOKU_BLACK).toBe(1)
    expect(GOMOKU_WHITE).toBe(2)
    const board = createGomokuBoard()
    expect(board).toHaveLength(225)
    expect(board.every((cell) => cell === 0)).toBe(true)
  })

  it('坐标换算与越界判定', () => {
    expect(gomokuIndex(0, 0)).toBe(0)
    expect(gomokuIndex(7, 7)).toBe(7 * 15 + 7)
    expect(isInGomokuBoard(0, 0)).toBe(true)
    expect(isInGomokuBoard(14, 14)).toBe(true)
    expect(isInGomokuBoard(15, 0)).toBe(false)
    expect(isInGomokuBoard(0, -1)).toBe(false)
  })

  it('空点判定与落子', () => {
    const board = emptyBoard()
    expect(isGomokuCellEmpty(board, 7, 7)).toBe(true)
    expect(isGomokuCellEmpty(board, 15, 0)).toBe(false)
    const index = placeGomokuStone(board, 3, 5, GOMOKU_WHITE)
    expect(index).toBe(5 * 15 + 3)
    expect(board[5 * 15 + 3]).toBe(2)
    expect(isGomokuCellEmpty(board, 3, 5)).toBe(false)
  })

  it('满盘判定', () => {
    expect(isGomokuBoardFull(emptyBoard())).toBe(false)
    const full = emptyBoard().map((_, index) => (index % 2 === 0 ? 1 : 2))
    expect(isGomokuBoardFull(full)).toBe(true)
  })
})

describe('五子棋胜负判定', () => {
  it('横向 / 纵向 / 主对角 / 反对角五连均判胜', () => {
    const horizontal = emptyBoard()
    for (let x = 4; x <= 8; x += 1) put(horizontal, x, 3, 1)
    const line = findGomokuWin(horizontal, 6, 3)
    expect(line).not.toBeNull()
    expect(line?.map((point) => [point.x, point.y])).toEqual([[4, 3], [5, 3], [6, 3], [7, 3], [8, 3]])

    const vertical = emptyBoard()
    for (let y = 2; y <= 6; y += 1) put(vertical, 10, y, 2)
    expect(findGomokuWin(vertical, 10, 4)).not.toBeNull()

    const mainDiagonal = emptyBoard()
    for (let i = 0; i < 5; i += 1) put(mainDiagonal, 3 + i, 5 + i, 1)
    expect(findGomokuWin(mainDiagonal, 5, 7)).not.toBeNull()

    const antiDiagonal = emptyBoard()
    for (let i = 0; i < 5; i += 1) put(antiDiagonal, 3 + i, 9 - i, 2)
    expect(findGomokuWin(antiDiagonal, 5, 7)).not.toBeNull()
  })

  it('6 连长连判胜（无禁手）且连线包含全部 6 子', () => {
    const board = emptyBoard()
    for (let x = 2; x <= 7; x += 1) put(board, x, 0, 1)
    const line = findGomokuWin(board, 4, 0)
    expect(line).not.toBeNull()
    expect(line).toHaveLength(6)
  })

  it('4 连、断连与空点不判胜', () => {
    const four = emptyBoard()
    for (let x = 0; x <= 3; x += 1) put(four, x, 1, 1)
    expect(findGomokuWin(four, 1, 1)).toBeNull()

    const broken = emptyBoard()
    for (const x of [0, 1, 2, 4, 5]) put(broken, x, 2, 1)
    expect(findGomokuWin(broken, 2, 2)).toBeNull()

    expect(findGomokuWin(emptyBoard(), 7, 7)).toBeNull()
  })
})

describe('五子棋启发式评估与选点', () => {
  it('评估分档：活四 > 冲四 > 活三，成五点达到 FIVE 档', () => {
    // 评估分 = 4 个方向求和（横竖两斜，孤子方向各贡献 5），按量级断言
    const openFour = emptyBoard()
    for (const x of [2, 3, 4]) put(openFour, x, 7, 1)
    const openFourScore = evaluateGomokuPoint(openFour, 1, 7, 1)

    const closedFour = emptyBoard()
    for (const x of [2, 3, 4]) put(closedFour, x, 7, 1)
    put(closedFour, 6, 7, 2) // 右侧被堵：落 (5,7) 成四连，只有左端开放
    const closedFourScore = evaluateGomokuPoint(closedFour, 5, 7, 1)

    const openThree = emptyBoard()
    for (const x of [2, 3]) put(openThree, x, 7, 1)
    const openThreeScore = evaluateGomokuPoint(openThree, 1, 7, 1)

    const fivePoint = emptyBoard()
    for (const x of [1, 2, 3, 4]) put(fivePoint, x, 7, 1)
    const fiveScore = evaluateGomokuPoint(fivePoint, 0, 7, 1)

    expect(openFourScore).toBeGreaterThanOrEqual(100_000)
    expect(closedFourScore).toBeGreaterThanOrEqual(10_000)
    expect(closedFourScore).toBeLessThan(100_000)
    expect(openThreeScore).toBeGreaterThanOrEqual(5_000)
    expect(openThreeScore).toBeLessThan(10_000)
    expect(fiveScore).toBeGreaterThanOrEqual(1_000_000)
    expect(openFourScore).toBeGreaterThan(closedFourScore)
    expect(closedFourScore).toBeGreaterThan(openThreeScore)
  })

  it('空盘首着落天元 (7,7)', () => {
    expect(suggestGomokuMove(emptyBoard(), 1)).toEqual({ x: 7, y: 7 })
  })

  it('己方成五点直接落，对方成五点必堵', () => {
    const ownFour = emptyBoard()
    for (const x of [3, 4, 5, 6]) put(ownFour, x, 7, 1)
    const own = suggestGomokuMove(ownFour, 1)
    expect(own !== null && ((own.x === 2 && own.y === 7) || (own.x === 7 && own.y === 7))).toBe(true)

    const opponentFour = emptyBoard()
    for (const x of [3, 4, 5, 6]) put(opponentFour, x, 7, 2)
    const block = suggestGomokuMove(opponentFour, 1)
    expect(block !== null && ((block.x === 2 && block.y === 7) || (block.x === 7 && block.y === 7))).toBe(true)
  })

  it('固定 rand 序列下选点可复现', () => {
    const board = emptyBoard()
    put(board, 7, 7, 1)
    put(board, 8, 8, 2)
    const fixed = () => 0.42
    expect(suggestGomokuMove(board, 1, fixed)).toEqual(suggestGomokuMove(board, 1, fixed))
  })

  it('候选点限制在已有棋子 2 格邻域内', () => {
    const board = emptyBoard()
    put(board, 0, 0, 1)
    const move = suggestGomokuMove(board, 2, () => 0.5)
    expect(move !== null && Math.max(Math.abs(move.x), Math.abs(move.y)) <= 2).toBe(true)
  })
})

describe('五子棋 AI 自对弈完整性', () => {
  it('双方用同一引擎互下：必然终止、每步合法、总手数不超 225', () => {
    const board = createGomokuBoard()
    let color: 1 | 2 = 1
    let moves = 0
    let ended = false
    while (moves < 225) {
      const move = suggestGomokuMove(board, color)
      if (move === null) break
      expect(isGomokuCellEmpty(board, move.x, move.y)).toBe(true)
      placeGomokuStone(board, move.x, move.y, color)
      moves += 1
      if (findGomokuWin(board, move.x, move.y) !== null || isGomokuBoardFull(board)) {
        ended = true
        break
      }
      color = color === 1 ? 2 : 1
    }
    expect(ended).toBe(true)
    expect(moves).toBeLessThanOrEqual(225)
    expect(moves).toBeGreaterThanOrEqual(10)
  })
})

// === 双端引擎对齐 ===

describe('五子棋双端引擎对齐', () => {
  it('服务端引擎与前端单机引擎源码一致（除头注释外）', () => {
    const clientFile = resolve(process.cwd(), 'src/lib/games/gomoku.ts')
    const serverFile = resolve(process.cwd(), '../server/src/services/gameGomoku.ts')
    const stripHeader = (source: string): string => {
      const end = source.indexOf('*/')
      return end === -1 ? source : source.slice(end + 2)
    }
    const clientSource = stripHeader(readFileSync(clientFile, 'utf8'))
    const serverSource = stripHeader(readFileSync(serverFile, 'utf8'))
    expect(clientSource).toBe(serverSource)
  })
})

// === 大厅目录 ===

describe('游戏大厅目录（五子棋）', () => {
  it('五子棋已上线且双模式路由正确', () => {
    expect(isGamePlayable('gomoku')).toBe(true)
    const entry = getGameCatalogEntry('gomoku')
    expect(entry?.modes).toEqual(['single', 'online'])
    expect(entry?.route).toBe('/games/gomoku')
    expect(entry?.onlineRoute).toBe('/games/gomoku/online')
    expect(GAME_CATALOG.filter((game) => game.playable).map((game) => game.id)).toContain('gomoku')
  })
})
