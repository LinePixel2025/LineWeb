/**
 * 中国象棋纯函数引擎测试 + 双端源码对齐 + 大厅目录。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  XIANGQI_BLACK,
  XIANGQI_CANNON,
  XIANGQI_CHARIOT,
  XIANGQI_GENERAL,
  XIANGQI_HORSE,
  XIANGQI_RED,
  XIANGQI_SOLDIER,
  createXiangqiBoard,
  evaluateXiangqiStatus,
  findXiangqiGeneral,
  generateLegalXiangqiMoves,
  isXiangqiInCheck,
  isXiangqiMoveLegal,
  makeXiangqiMove,
  suggestXiangqiMove,
  xiangqiLegalMovesFrom,
} from '../xiangqi'
import { GAME_CATALOG, getGameCatalogEntry, isGamePlayable } from '../catalog'

const idx = (x: number, y: number) => y * 9 + x

function emptyBoard(): number[] {
  return new Array<number>(90).fill(0)
}

function kingsOnly(): number[] {
  const board = emptyBoard()
  board[idx(4, 9)] = XIANGQI_GENERAL
  board[idx(4, 0)] = -XIANGQI_GENERAL
  board[idx(4, 5)] = XIANGQI_SOLDIER
  return board
}

describe('象棋初始局面与走子规则', () => {
  it('初始 32 子、将帅位置正确、红方合法着法充足', () => {
    const board = createXiangqiBoard()
    expect(board).toHaveLength(90)
    expect(board.filter((piece) => piece !== 0)).toHaveLength(32)
    expect(findXiangqiGeneral(board, XIANGQI_RED)).toBe(idx(4, 9))
    expect(findXiangqiGeneral(board, XIANGQI_BLACK)).toBe(idx(4, 0))
    expect(isXiangqiInCheck(board, XIANGQI_RED)).toBe(false)
    expect(generateLegalXiangqiMoves(board, XIANGQI_RED).length).toBeGreaterThanOrEqual(40)
  })

  it('车 / 马 / 相 / 仕 / 帅的初始合法点', () => {
    const board = createXiangqiBoard()
    const chariot = xiangqiLegalMovesFrom(board, idx(0, 9))
    expect(chariot).toContain(idx(0, 8))
    expect(chariot).toContain(idx(0, 7))
    expect(chariot).not.toContain(idx(0, 6))

    expect(xiangqiLegalMovesFrom(board, idx(1, 9)).sort((a, b) => a - b)).toEqual([idx(0, 7), idx(2, 7)].sort((a, b) => a - b))
    expect(xiangqiLegalMovesFrom(board, idx(2, 9))).toContain(idx(0, 7))
    expect(xiangqiLegalMovesFrom(board, idx(2, 9)).some((target) => target < idx(0, 5))).toBe(false)
    expect(xiangqiLegalMovesFrom(board, idx(3, 9))).toEqual([idx(4, 8)])
    expect(xiangqiLegalMovesFrom(board, idx(4, 9))).toEqual([idx(4, 8)])
  })

  it('兵过河前后移动范围；炮吃子必须隔炮架', () => {
    const soldierBoard = kingsOnly()
    soldierBoard[idx(0, 6)] = XIANGQI_SOLDIER
    expect(xiangqiLegalMovesFrom(soldierBoard, idx(0, 6))).toEqual([idx(0, 5)])
    soldierBoard[idx(0, 4)] = XIANGQI_SOLDIER
    const afterRiver = xiangqiLegalMovesFrom(soldierBoard, idx(0, 4))
    expect(afterRiver).toContain(idx(0, 3))
    expect(afterRiver).toContain(idx(1, 4))
    expect(afterRiver).not.toContain(idx(0, 5))

    const cannonBoard = kingsOnly()
    cannonBoard[idx(0, 4)] = XIANGQI_CANNON
    cannonBoard[idx(0, 0)] = -XIANGQI_CHARIOT
    expect(xiangqiLegalMovesFrom(cannonBoard, idx(0, 4))).not.toContain(idx(0, 0))
    cannonBoard[idx(0, 2)] = XIANGQI_SOLDIER
    expect(xiangqiLegalMovesFrom(cannonBoard, idx(0, 4))).toContain(idx(0, 0))
  })
})

describe('象棋将军 / 绝杀 / 困毙', () => {
  it('将帅照面双方被将军；车照将只影响对方', () => {
    const facing = emptyBoard()
    facing[idx(4, 9)] = XIANGQI_GENERAL
    facing[idx(4, 0)] = -XIANGQI_GENERAL
    expect(isXiangqiInCheck(facing, XIANGQI_RED)).toBe(true)
    expect(isXiangqiInCheck(facing, XIANGQI_BLACK)).toBe(true)

    const checkBoard = kingsOnly()
    checkBoard[idx(4, 5)] = XIANGQI_CHARIOT
    expect(isXiangqiInCheck(checkBoard, XIANGQI_BLACK)).toBe(true)
    expect(isXiangqiInCheck(checkBoard, XIANGQI_RED)).toBe(false)
  })

  it('绝杀判定', () => {
    const board = emptyBoard()
    board[idx(4, 9)] = XIANGQI_GENERAL
    board[idx(4, 0)] = -XIANGQI_GENERAL
    board[idx(3, 1)] = XIANGQI_CHARIOT
    board[idx(5, 1)] = XIANGQI_CHARIOT
    board[idx(4, 2)] = XIANGQI_CHARIOT
    const status = evaluateXiangqiStatus(board, XIANGQI_BLACK)
    expect(status.finished).toBe(true)
    expect(status.reason).toBe('checkmate')
    expect(status.winner).toBe(XIANGQI_RED)
  })

  it('困毙（无合法着法但未被将军）判负', () => {
    const board = emptyBoard()
    board[idx(3, 9)] = XIANGQI_GENERAL
    board[idx(4, 0)] = -XIANGQI_GENERAL
    board[idx(3, 1)] = XIANGQI_CHARIOT
    board[idx(5, 1)] = XIANGQI_CHARIOT
    board[idx(3, 3)] = XIANGQI_HORSE
    const status = evaluateXiangqiStatus(board, XIANGQI_BLACK)
    expect(status.checked).toBe(false)
    expect(status.finished).toBe(true)
    expect(status.reason).toBe('stalemate')
    expect(status.winner).toBe(XIANGQI_RED)
  })
})

describe('象棋 AI', () => {
  it('初始局面给出合法着法；能吃子时优先吃车', () => {
    const board = createXiangqiBoard()
    const move = suggestXiangqiMove(board, XIANGQI_RED, { depth: 1 })
    expect(move).not.toBeNull()
    if (move) expect(isXiangqiMoveLegal(board, move.from, move.to, XIANGQI_RED)).toBe(true)

    const captureBoard = kingsOnly()
    captureBoard[idx(0, 5)] = XIANGQI_CHARIOT
    captureBoard[idx(0, 3)] = -XIANGQI_CHARIOT
    expect(suggestXiangqiMove(captureBoard, XIANGQI_RED, { depth: 2 })).toEqual({
      from: idx(0, 5),
      to: idx(0, 3),
    })
  })

  it('深度 2 搜索耗时可控', () => {
    const board = createXiangqiBoard()
    const started = Date.now()
    suggestXiangqiMove(board, XIANGQI_RED, { depth: 2 })
    expect(Date.now() - started).toBeLessThan(3000)
  })
})

describe('象棋双端引擎对齐', () => {
  it('服务端引擎与前端引擎源码一致（除头注释外）', () => {
    const stripHeader = (source: string): string => {
      const end = source.indexOf('*/')
      return end === -1 ? source : source.slice(end + 2)
    }
    const clientSource = stripHeader(readFileSync(resolve(process.cwd(), 'src/lib/games/xiangqi.ts'), 'utf8'))
    const serverSource = stripHeader(readFileSync(resolve(process.cwd(), '../server/src/services/gameXiangqi.ts'), 'utf8'))
    expect(clientSource).toBe(serverSource)
  })
})

describe('游戏大厅目录（象棋）', () => {
  it('中国象棋已上线且双模式路由正确', () => {
    expect(isGamePlayable('xiangqi')).toBe(true)
    const entry = getGameCatalogEntry('xiangqi')
    expect(entry?.modes).toEqual(['single', 'online'])
    expect(entry?.route).toBe('/games/xiangqi')
    expect(entry?.onlineRoute).toBe('/games/xiangqi/online')
    expect(GAME_CATALOG.filter((game) => game.playable).map((game) => game.id)).toContain('xiangqi')
  })
})
