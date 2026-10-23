/**
 * 2048 纯函数引擎（客户端）
 *
 * 规则与后端 `server/src/services/game2048.ts` 保持一致：
 * - 4x4 棋盘，初始 2 个方块，新方块 90% 为 2、10% 为 4；
 * - 每次移动中每个方块最多合并一次，合并得分累加；
 * - 只有棋盘真的发生变化（moved=true）才生成新方块并增加步数；
 * - 合成 2048 即获胜；棋盘填满且相邻无相同数字则失败。
 *
 * 随机数使用可序列化的 mulberry32：把 32 位内部状态 `rngState` 放进快照，
 * 下一次移动从该状态继续。因此「固定种子 + 固定操作序列」的结果完全确定，
 * 也便于把快照（含 rngState）持久化到 localStorage 后继续对局。
 */

import type { Game2048Direction, Game2048PlayerStatus } from '../../types/game'

/** 棋盘边长（4x4） */
export const BOARD_SIZE = 4
/** 单机模式目标方块 */
export const TARGET_TILE = 2048
/** 初始方块数量 */
export const INITIAL_TILES = 2
/** 新方块出现 4 的概率（其余为 2） */
export const SPAWN_FOUR_PROBABILITY = 0.1
/** mulberry32 每次取数时状态的自增量 */
const RNG_INCREMENT = 0x6d2b79f5

/** 单机棋局状态（与对局 DTO 中的玩家状态字段一致） */
export interface Game2048State {
  /** 4x4 棋盘，0 表示空格 */
  board: number[][]
  /** 当前得分（所有合并值之和） */
  score: number
  /** 有效移动步数 */
  moves: number
  /** 玩家状态：进行中 / 已达成 2048 / 无法移动 */
  status: Game2048PlayerStatus
  /** 当前棋盘上的最大方块 */
  maxTile: number
}

/** 可持久化的棋局快照：状态 + 随机数内部状态 */
export interface Game2048Snapshot {
  state: Game2048State
  /** mulberry32 的 32 位内部状态，取下一个随机数时会先自增 */
  rngState: number
}

/** moveGame 的返回值 */
export interface Game2048MoveResult {
  /** 移动后的新快照；moved=false 时为原快照（引用不变） */
  snapshot: Game2048Snapshot
  /** 本次移动是否真的改变了棋盘（是否生成了新方块、步数是否 +1） */
  moved: boolean
}

/** 生成一个合适的随机种子（32 位无符号整数） */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}

/**
 * 把任意数字规范化为 32 位无符号整数种子。
 * 与后端 `createSeededRandom` 一致：种子 0 统一映射为 1，
 * 保证同一个 seed 在前后端得到完全相同的初始棋盘。
 */
function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    throw new Error('2048 种子必须是有限数字')
  }
  return (Math.trunc(seed) >>> 0) || 1
}

/**
 * mulberry32 单步：输入当前 32 位状态，返回 [0, 1) 的随机数与新状态。
 * 状态先自增再参与混淆，因此连续调用不会重复。
 */
function nextRandom(rngState: number): { value: number; rngState: number } {
  const state = (rngState + RNG_INCREMENT) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  const value = ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  return { value, rngState: state }
}

/** 创建空棋盘 */
function createEmptyBoard(): number[][] {
  return Array.from({ length: BOARD_SIZE }, () => Array<number>(BOARD_SIZE).fill(0))
}

/** 深拷贝棋盘 */
function cloneBoard(board: number[][]): number[][] {
  return board.map((row) => row.slice())
}

/** 收集所有空格坐标 */
function emptyPositions(board: number[][]): Array<{ row: number; col: number }> {
  const positions: Array<{ row: number; col: number }> = []
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      if (board[row][col] === 0) positions.push({ row, col })
    }
  }
  return positions
}

/**
 * 在随机空格生成一个新方块（2 或 4），不修改入参棋盘。
 *
 * 随机序：先抽空格下标，再抽方块值（< 0.1 出 4），后端实现保持同样顺序。
 * 没有空格时原样返回，rngState 不推进。
 */
function spawnRandomTile(
  board: number[][],
  rngState: number,
): { board: number[][]; rngState: number } {
  const positions = emptyPositions(board)
  if (positions.length === 0) {
    return { board, rngState }
  }
  const pick = nextRandom(rngState)
  const position = positions[Math.min(Math.floor(pick.value * positions.length), positions.length - 1)]
  const valueRoll = nextRandom(pick.rngState)
  const value = valueRoll.value < SPAWN_FOUR_PROBABILITY ? 4 : 2
  const nextBoard = cloneBoard(board)
  nextBoard[position.row][position.col] = value
  return { board: nextBoard, rngState: valueRoll.rngState }
}

/** 从棋盘某一行/列按移动方向读出一维序列（序列下标 0 为移动目标端） */
function readLine(board: number[][], direction: Game2048Direction, index: number): number[] {
  const line: number[] = []
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    switch (direction) {
      case 'left':
        line.push(board[index][i])
        break
      case 'right':
        line.push(board[index][BOARD_SIZE - 1 - i])
        break
      case 'up':
        line.push(board[i][index])
        break
      case 'down':
        line.push(board[BOARD_SIZE - 1 - i][index])
        break
    }
  }
  return line
}

/** 把一维序列按移动方向写回棋盘 */
function writeLine(
  board: number[][],
  direction: Game2048Direction,
  index: number,
  line: number[],
): void {
  for (let i = 0; i < BOARD_SIZE; i += 1) {
    const value = line[i]
    switch (direction) {
      case 'left':
        board[index][i] = value
        break
      case 'right':
        board[index][BOARD_SIZE - 1 - i] = value
        break
      case 'up':
        board[i][index] = value
        break
      case 'down':
        board[BOARD_SIZE - 1 - i][index] = value
        break
    }
  }
}

/**
 * 压缩 + 合并一条线（移动目标端为下标 0）。
 * 一次性遍历原始非零序列，合并后的方块不会再参与下一次合并，
 * 因此 [2,2,2,2] → [4,4,0,0] 而不是 [8,0,0,0]。
 */
function slideLine(line: number[]): { line: number[]; gained: number } {
  const tiles = line.filter((value) => value !== 0)
  const merged: number[] = []
  let gained = 0
  for (let i = 0; i < tiles.length; i += 1) {
    if (i + 1 < tiles.length && tiles[i] === tiles[i + 1]) {
      const value = tiles[i] * 2
      merged.push(value)
      gained += value
      i += 1
    } else {
      merged.push(tiles[i])
    }
  }
  while (merged.length < BOARD_SIZE) merged.push(0)
  return { line: merged, gained }
}

function isSameLine(a: number[], b: number[]): boolean {
  return a.every((value, index) => value === b[index])
}

/** 校验并复制一个 4x4 棋盘（测试 / 恢复存档用），非法输入抛错 */
export function createBoard(rows: number[][]): number[][] {
  if (!Array.isArray(rows) || rows.length !== BOARD_SIZE) {
    throw new Error(`2048 棋盘必须是 ${BOARD_SIZE}x${BOARD_SIZE}，实际为 ${Array.isArray(rows) ? rows.length : '非数组'} 行`)
  }
  return rows.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length !== BOARD_SIZE) {
      throw new Error(`2048 棋盘第 ${rowIndex} 行必须是 ${BOARD_SIZE} 个方块`)
    }
    return row.map((cell, colIndex) => {
      if (!Number.isInteger(cell) || cell < 0) {
        throw new Error(`2048 棋盘 (${rowIndex}, ${colIndex}) 的方块值必须是非负整数`)
      }
      return cell
    })
  })
}

/** 棋盘上的最大方块（空棋盘为 0） */
export function maxTile(board: number[][]): number {
  let max = 0
  for (const row of board) {
    for (const value of row) {
      if (value > max) max = value
    }
  }
  return max
}

/** 是否还存在可移动的空间：有空格，或上下/左右存在相同数字 */
export function hasMoves(board: number[][]): boolean {
  for (let row = 0; row < BOARD_SIZE; row += 1) {
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      const value = board[row][col]
      if (value === 0) return true
      if (col + 1 < BOARD_SIZE && board[row][col + 1] === value) return true
      if (row + 1 < BOARD_SIZE && board[row + 1][col] === value) return true
    }
  }
  return false
}

/**
 * 创建新棋局（固定种子可完全复现）。
 * 初始棋盘上有 2 个方块，得分 / 步数为 0，状态为 playing。
 */
export function createGame(seed?: number): Game2048Snapshot {
  let rngState = seed === undefined ? randomSeed() : normalizeSeed(seed)
  let board = createEmptyBoard()
  for (let i = 0; i < INITIAL_TILES; i += 1) {
    const spawned = spawnRandomTile(board, rngState)
    board = spawned.board
    rngState = spawned.rngState
  }
  const highest = maxTile(board)
  return {
    state: {
      board,
      score: 0,
      moves: 0,
      status: highest >= TARGET_TILE ? 'won' : 'playing',
      maxTile: highest,
    },
    rngState,
  }
}

/**
 * 执行一次移动，返回新快照与是否真的发生了移动。
 *
 * - 每行/列独立压缩合并，每个方块每步最多合并一次；
 * - 得分增加所有合并值之和；
 * - moved=true 时步数 +1、生成一个新方块、更新 maxTile 并重新判定状态；
 * - moved=false 时原样返回入参快照（不消耗随机数，不生成新方块）。
 */
export function moveGame(
  snapshot: Game2048Snapshot,
  direction: Game2048Direction,
): Game2048MoveResult {
  const board = cloneBoard(snapshot.state.board)
  let moved = false
  let gained = 0

  for (let index = 0; index < BOARD_SIZE; index += 1) {
    const original = readLine(board, direction, index)
    const slid = slideLine(original)
    if (isSameLine(original, slid.line)) continue
    moved = true
    gained += slid.gained
    writeLine(board, direction, index, slid.line)
  }

  if (!moved) {
    return { snapshot, moved: false }
  }

  const spawned = spawnRandomTile(board, snapshot.rngState)
  const highest = maxTile(spawned.board)
  // 一旦合成 2048 即保持 won（可以继续滑，但状态不再回退）
  const won = snapshot.state.status === 'won' || highest >= TARGET_TILE
  const status: Game2048PlayerStatus = won
    ? 'won'
    : hasMoves(spawned.board)
      ? 'playing'
      : 'lost'

  return {
    moved: true,
    snapshot: {
      state: {
        board: spawned.board,
        score: snapshot.state.score + gained,
        moves: snapshot.state.moves + 1,
        status,
        maxTile: highest,
      },
      rngState: spawned.rngState,
    },
  }
}
