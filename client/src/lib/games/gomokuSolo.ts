/**
 * 五子棋单机（人机）回合辅助：按落子历史重建 / 悔棋。
 *
 * 关键约束：**不能按棋盘下标截断**。棋盘一维数组的下标顺序是空间顺序，
 * 与落子先后无关；早期实现用 `stones.slice(0, keep)` 重建，会保留晚落但
 * 下标小的子、删掉早落但下标大的子，表现为「随机悔棋」。这里始终按
 * `moves`（时间顺序）回放。
 *
 * 纯函数、无 React / 网络 / 存储依赖，规则引擎仍复用 `lib/games/gomoku.ts`。
 */
import {
  GOMOKU_BLACK,
  GOMOKU_WHITE,
  createGomokuBoard,
  placeGomokuStone,
  type GomokuBoard,
  type GomokuColor,
} from './gomoku'

export interface GomokuMove {
  x: number
  y: number
  color: GomokuColor
}

export interface GomokuPosition {
  board: GomokuBoard
  lastMove: GomokuMove | null
  /** 按落子先后排列的历史（唯一真相源） */
  moves: GomokuMove[]
}

/** 从落子历史回放出一个空棋盘 + 最后一手 */
export function rebuildGomokuPosition(moves: GomokuMove[]): GomokuPosition {
  const board = createGomokuBoard()
  for (const move of moves) placeGomokuStone(board, move.x, move.y, move.color)
  return {
    board,
    lastMove: moves.length > 0 ? moves[moves.length - 1] : null,
    moves,
  }
}

/**
 * 撤销「自己最近一手 + 其后的 AI 应手」，回到自己落子前的回合。
 * - 自己刚赢：撤掉制胜一手；
 * - AI 刚赢：撤掉 AI 的制胜手与自己上一步；
 * - AI 思考中 / 自己还没落子：返回 null（调用方禁用按钮）。
 */
export function undoGomokuRound(
  position: GomokuPosition,
  playerColor: GomokuColor,
): GomokuPosition | null {
  const aiColor: GomokuColor = playerColor === GOMOKU_BLACK ? GOMOKU_WHITE : GOMOKU_BLACK
  const moves = [...position.moves]
  let removedPlayerMove = false

  while (moves.length > 0) {
    const last = moves[moves.length - 1]
    if (last.color === aiColor && !removedPlayerMove) {
      moves.pop()
      continue
    }
    if (last.color === playerColor) {
      moves.pop()
      removedPlayerMove = true
      continue
    }
    break
  }

  if (!removedPlayerMove) return null
  return rebuildGomokuPosition(moves)
}
