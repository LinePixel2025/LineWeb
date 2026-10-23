/**
 * 2048 纯规则引擎（服务端权威）
 *
 * 纯函数、无 IO、无隐式随机源：随机数由显式传入的 `random()` 或固定种子产生，
 * 因此「固定种子 + 固定操作序列」的结果完全可复现（联机对局双方初始棋盘一致）。
 *
 * 规则（与前端单机引擎 `client/src/lib/games/game2048.ts` 保持一致）：
 * - 4x4 棋盘，初始 2 个方块，新方块 90% 为 2、10% 为 4；
 * - 每次移动中每个方块最多合并一次，得分 = 本次所有合并值之和；
 * - 只有棋盘真的发生变化（moved=true）才生成新方块；
 * - 合成 2048 即达成目标；棋盘填满且相邻无相同数字则无法移动。
 *
 * 注意：服务端只存权威棋盘与得分，客户端只提交方向（direction）。
 */

/** 棋盘（4x4，0 表示空格） */
export type Game2048Board = number[][]

/** 移动方向 */
export type Game2048Direction = 'up' | 'down' | 'left' | 'right'

/** 棋盘边长 */
export const GAME2048_SIZE = 4
/** 目标方块：先合成该方块的玩家获胜 */
export const GAME2048_TARGET = 2048
/** 初始方块数量 */
export const GAME2048_INITIAL_TILES = 2
/** 新方块出现 4 的概率（其余为 2） */
export const GAME2048_SPAWN_FOUR_PROBABILITY = 0.1
/** mulberry32 每次取数时的状态自增量 */
const RNG_INCREMENT = 0x6d2b79f5

/** 随机数发生器 —— 返回 [0, 1) */
export type Game2048Random = () => number

/** 新生成的方块位置与数值 */
export interface Game2048SpawnedTile {
  row: number
  col: number
  value: number
}

/** 纯滑动（压缩 + 合并）结果，不包含新方块生成 */
export interface Game2048SlideResult {
  board: Game2048Board
  moved: boolean
  scoreGained: number
}

/** 一次完整移动的结果（moved=true 时含新生成的方块） */
export interface Game2048MoveResult extends Game2048SlideResult {
  spawned: Game2048SpawnedTile | null
}

/** 创建空棋盘 */
export function createEmptyBoard(): Game2048Board {
  return Array.from({ length: GAME2048_SIZE }, () => new Array<number>(GAME2048_SIZE).fill(0))
}

/** 深拷贝棋盘（对外返回 DTO / 引擎内部写回都用拷贝，避免共享引用被意外修改） */
export function cloneBoard(board: Game2048Board): Game2048Board {
  return board.map((row) => row.slice())
}

/** 两个棋盘是否完全一致 */
export function boardsEqual(a: Game2048Board, b: Game2048Board): boolean {
  for (let row = 0; row < GAME2048_SIZE; row += 1) {
    for (let col = 0; col < GAME2048_SIZE; col += 1) {
      if (a[row][col] !== b[row][col]) return false
    }
  }
  return true
}

/**
 * 创建 mulberry32 随机数发生器（32 位种子）。
 *
 * 同一个种子产生同一串随机数，因此联机对局可以用同一 seed 生成完全一致的初始棋盘；
 * 每个玩家随后各自推进自己的随机序列（双方移动次数不同，后续新方块自然不同）。
 */
export function createSeededRandom(seed: number): Game2048Random {
  // 0 作为种子会退化为固定序列，统一映射到 1（其余种子按 32 位无符号处理）
  let state = (Math.trunc(seed) >>> 0) || 1
  return () => {
    state = (state + RNG_INCREMENT) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 收集棋盘上的空格坐标（按行优先顺序，保证同一种子结果确定） */
function emptyPositions(board: Game2048Board): Array<{ row: number; col: number }> {
  const positions: Array<{ row: number; col: number }> = []
  for (let row = 0; row < GAME2048_SIZE; row += 1) {
    for (let col = 0; col < GAME2048_SIZE; col += 1) {
      if (board[row][col] === 0) positions.push({ row, col })
    }
  }
  return positions
}

/**
 * 在随机空格生成一个新方块（2 或 4），返回新棋盘，不修改入参。
 *
 * 随机序：先抽空格下标，再抽方块值（< 0.1 出 4）——与前端单机引擎保持一致。
 * 没有空格时原样返回（spawned=null），且不消耗随机数。
 */
export function spawnRandomTile(
  board: Game2048Board,
  random: Game2048Random,
): { board: Game2048Board; spawned: Game2048SpawnedTile | null } {
  const positions = emptyPositions(board)
  if (positions.length === 0) {
    return { board: cloneBoard(board), spawned: null }
  }
  const index = Math.min(Math.floor(random() * positions.length), positions.length - 1)
  const position = positions[index]
  const value = random() < GAME2048_SPAWN_FOUR_PROBABILITY ? 4 : 2
  const nextBoard = cloneBoard(board)
  nextBoard[position.row][position.col] = value
  return { board: nextBoard, spawned: { row: position.row, col: position.col, value } }
}

/** 压缩 + 合并一条线（下标 0 为移动目标端）；合并后的方块不再参与本轮合并 */
function slideLine(line: number[]): { line: number[]; scoreGained: number } {
  const tiles = line.filter((value) => value !== 0)
  const merged: number[] = []
  let scoreGained = 0
  for (let i = 0; i < tiles.length; i += 1) {
    const current = tiles[i]
    const next = tiles[i + 1]
    if (next !== undefined && next === current) {
      const value = current * 2
      merged.push(value)
      scoreGained += value
      i += 1
    } else {
      merged.push(current)
    }
  }
  while (merged.length < GAME2048_SIZE) merged.push(0)
  return { line: merged, scoreGained }
}

/** 按方向把棋盘转成「一律向左移动」的行序列 */
function toMovementRows(board: Game2048Board, direction: Game2048Direction): number[][] {
  switch (direction) {
    case 'left':
      return cloneBoard(board)
    case 'right':
      return board.map((row) => row.slice().reverse())
    case 'up':
      return transposeBoard(board)
    case 'down':
      return transposeBoard(board).map((row) => row.slice().reverse())
  }
}

/** 把「向左移动」后的行序列还原回原方向对应的棋盘 */
function fromMovementRows(rows: number[][], direction: Game2048Direction): number[][] {
  switch (direction) {
    case 'left':
      return rows.map((row) => row.slice())
    case 'right':
      return rows.map((row) => row.slice().reverse())
    case 'up':
      return transposeBoard(rows)
    case 'down':
      return transposeBoard(rows.map((row) => row.slice().reverse()))
  }
}

/** 转置棋盘（行列互换） */
function transposeBoard(board: Game2048Board): Game2048Board {
  return Array.from({ length: GAME2048_SIZE }, (_, row) =>
    Array.from({ length: GAME2048_SIZE }, (_, col) => board[col][row]),
  )
}

/** 是否还存在可移动的空间：有空格，或上下/左右存在相同数字 */
export function hasAvailableMoves(board: Game2048Board): boolean {
  for (let row = 0; row < GAME2048_SIZE; row += 1) {
    for (let col = 0; col < GAME2048_SIZE; col += 1) {
      const value = board[row][col]
      if (value === 0) return true
      if (col + 1 < GAME2048_SIZE && board[row][col + 1] === value) return true
      if (row + 1 < GAME2048_SIZE && board[row + 1][col] === value) return true
    }
  }
  return false
}

/** 棋盘上的最大方块（空棋盘为 0） */
export function maxTileValue(board: Game2048Board): number {
  let max = 0
  for (const row of board) {
    for (const value of row) {
      if (value > max) max = value
    }
  }
  return max
}

/**
 * 纯滑动：按方向压缩 + 合并，返回新棋盘与本次得分。
 * 不生成新方块（生成由 applyMove / spawnRandomTile 负责）。
 */
export function slideBoard(
  board: Game2048Board,
  direction: Game2048Direction,
): Game2048SlideResult {
  const rows = toMovementRows(board, direction)
  let moved = false
  let scoreGained = 0
  const nextRows = rows.map((row) => {
    const slid = slideLine(row)
    scoreGained += slid.scoreGained
    if (!row.every((value, index) => value === slid.line[index])) moved = true
    return slid.line
  })
  return {
    board: fromMovementRows(nextRows, direction),
    moved,
    scoreGained,
  }
}

/**
 * 执行一次完整移动：先滑动，只有 moved=true 时才生成一个新方块。
 *
 * moved=false 时不消耗随机数、不生成方块，返回的 board 与入参棋盘内容一致。
 */
export function applyMove(
  board: Game2048Board,
  direction: Game2048Direction,
  random: Game2048Random,
): Game2048MoveResult {
  const slid = slideBoard(board, direction)
  if (!slid.moved) {
    return { board: slid.board, moved: false, scoreGained: 0, spawned: null }
  }
  const spawn = spawnRandomTile(slid.board, random)
  return {
    board: spawn.board,
    moved: true,
    scoreGained: slid.scoreGained,
    spawned: spawn.spawned,
  }
}

/** 由种子生成的初始棋局：棋盘 + 已经推进到「初始方块之后」的随机数发生器 */
export interface Game2048InitialState {
  board: Game2048Board
  /** 与棋盘共享同一条随机序列（已消耗完初始方块的随机数），后续移动直接继续使用 */
  random: Game2048Random
}

/**
 * 由固定种子创建初始棋局（棋盘 + 后续随机数发生器）。
 *
 * 同一个 seed 必然得到完全相同的初始棋盘与随机序列——联机对局双方用同一 seed
 * 起步，初始棋盘完全一致；之后双方各自推进随机序列（移动次数不同，新方块自然不同）。
 */
export function createSeededGame(seed: number): Game2048InitialState {
  const random = createSeededRandom(seed)
  let board = createEmptyBoard()
  for (let i = 0; i < GAME2048_INITIAL_TILES; i += 1) {
    board = spawnRandomTile(board, random).board
  }
  return { board, random }
}

/**
 * 创建初始棋盘：2 个随机方块，由固定种子决定。
 * 同一个 seed 必然得到完全相同的初始棋盘（联机对局双方公平起步）。
 */
export function createInitialBoard(seed: number): Game2048Board {
  return createSeededGame(seed).board
}
