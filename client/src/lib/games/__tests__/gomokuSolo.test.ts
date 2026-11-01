import { describe, expect, it } from 'vitest'
import { GOMOKU_BLACK, GOMOKU_WHITE, gomokuIndex } from '../gomoku'
import {
  rebuildGomokuPosition,
  undoGomokuRound,
  type GomokuMove,
} from '../gomokuSolo'

/** 黑（玩家）落 10，白（AI）应 0；再黑落 1，白应 2。下标顺序与落子顺序故意相反。 */
function makeMoves(): GomokuMove[] {
  return [
    { x: 10, y: 10, color: GOMOKU_BLACK },
    { x: 0, y: 0, color: GOMOKU_WHITE },
    { x: 1, y: 11, color: GOMOKU_BLACK },
    { x: 2, y: 0, color: GOMOKU_WHITE },
  ]
}

describe('五子棋单机悔棋（落子历史）', () => {
  it('从历史回放棋盘：与落子顺序无关地还原所有子', () => {
    const position = rebuildGomokuPosition(makeMoves())
    expect(position.moves).toHaveLength(4)
    expect(position.board[gomokuIndex(10, 10)]).toBe(GOMOKU_BLACK)
    expect(position.board[gomokuIndex(0, 0)]).toBe(GOMOKU_WHITE)
    expect(position.board[gomokuIndex(1, 11)]).toBe(GOMOKU_BLACK)
    expect(position.board[gomokuIndex(2, 0)]).toBe(GOMOKU_WHITE)
    expect(position.lastMove).toEqual({ x: 2, y: 0, color: GOMOKU_WHITE })
  })

  it('悔棋撤销最近一轮（AI 应手 + 自己上一手），而不是按棋盘下标截断', () => {
    const position = rebuildGomokuPosition(makeMoves())
    const undone = undoGomokuRound(position, GOMOKU_BLACK)
    expect(undone).not.toBeNull()
    expect(undone!.moves).toEqual(makeMoves().slice(0, 2))
    // 早落但下标大的 (10,10) 必须保留；晚落但下标小的 (1,11)/(2,0) 必须撤销
    expect(undone!.board[gomokuIndex(10, 10)]).toBe(GOMOKU_BLACK)
    expect(undone!.board[gomokuIndex(0, 0)]).toBe(GOMOKU_WHITE)
    expect(undone!.board[gomokuIndex(1, 11)]).toBe(0)
    expect(undone!.board[gomokuIndex(2, 0)]).toBe(0)
    expect(undone!.lastMove).toEqual({ x: 0, y: 0, color: GOMOKU_WHITE })
  })

  it('玩家执白时撤销自己的白子与随后 AI 的黑子，回到白方回合', () => {
    const moves: GomokuMove[] = [
      { x: 0, y: 0, color: GOMOKU_BLACK },
      { x: 9, y: 9, color: GOMOKU_WHITE },
      { x: 1, y: 0, color: GOMOKU_BLACK },
      { x: 8, y: 9, color: GOMOKU_WHITE },
      { x: 2, y: 0, color: GOMOKU_BLACK },
    ]
    const undone = undoGomokuRound(rebuildGomokuPosition(moves), GOMOKU_WHITE)
    expect(undone).not.toBeNull()
    // 撤掉最后两步：自己（白）第 2 手 + AI（黑）第 3 手；剩 AI、白、AI 三手，轮到白方
    expect(undone!.moves).toEqual(moves.slice(0, 3))
    expect(undone!.board[gomokuIndex(8, 9)]).toBe(0)
    expect(undone!.board[gomokuIndex(2, 0)]).toBe(0)
    expect(undone!.lastMove).toEqual({ x: 1, y: 0, color: GOMOKU_BLACK })
    expect(undone!.moves).toHaveLength(3)
  })

  it('AI 先手且玩家尚未落子时不能悔棋', () => {
    const position = rebuildGomokuPosition([{ x: 7, y: 7, color: GOMOKU_BLACK }])
    expect(undoGomokuRound(position, GOMOKU_WHITE)).toBeNull()
    expect(undoGomokuRound(rebuildGomokuPosition([]), GOMOKU_BLACK)).toBeNull()
  })

  it('玩家刚赢：撤掉制胜一手后回到玩家回合', () => {
    const moves: GomokuMove[] = [
      { x: 3, y: 3, color: GOMOKU_BLACK },
      { x: 3, y: 4, color: GOMOKU_WHITE },
      { x: 4, y: 3, color: GOMOKU_BLACK },
      { x: 4, y: 4, color: GOMOKU_WHITE },
      { x: 5, y: 3, color: GOMOKU_BLACK },
      { x: 5, y: 4, color: GOMOKU_WHITE },
      { x: 6, y: 3, color: GOMOKU_BLACK },
      { x: 6, y: 4, color: GOMOKU_WHITE },
      { x: 7, y: 3, color: GOMOKU_BLACK },
    ]
    const undone = undoGomokuRound(rebuildGomokuPosition(moves), GOMOKU_BLACK)
    expect(undone).not.toBeNull()
    expect(undone!.moves).toHaveLength(8)
    expect(undone!.board[gomokuIndex(7, 3)]).toBe(0)
    expect(undone!.lastMove).toEqual({ x: 6, y: 4, color: GOMOKU_WHITE })
  })

  it('AI 刚赢：撤销 AI 制胜手与自己上一步，重新给玩家机会', () => {
    const moves: GomokuMove[] = [
      { x: 3, y: 3, color: GOMOKU_BLACK },
      { x: 0, y: 0, color: GOMOKU_WHITE },
      { x: 4, y: 3, color: GOMOKU_BLACK },
      { x: 0, y: 1, color: GOMOKU_WHITE },
      { x: 5, y: 3, color: GOMOKU_BLACK },
      { x: 0, y: 2, color: GOMOKU_WHITE },
      { x: 6, y: 3, color: GOMOKU_BLACK },
      { x: 0, y: 3, color: GOMOKU_WHITE },
      { x: 9, y: 9, color: GOMOKU_BLACK },
      { x: 0, y: 4, color: GOMOKU_WHITE },
    ]
    const undone = undoGomokuRound(rebuildGomokuPosition(moves), GOMOKU_BLACK)
    expect(undone).not.toBeNull()
    expect(undone!.moves).toHaveLength(8)
    expect(undone!.board[gomokuIndex(0, 4)]).toBe(0)
    expect(undone!.board[gomokuIndex(9, 9)]).toBe(0)
    // 剩下 4 轮交替落子，最后一手是 AI 的第 4 手（白），轮到黑方（玩家）
    expect(undone!.lastMove).toEqual({ x: 0, y: 3, color: GOMOKU_WHITE })
    expect(undone!.moves).toHaveLength(8)
  })
})
