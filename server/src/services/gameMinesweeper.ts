/**
 * 扫雷纯规则引擎（服务端权威；单机与联机共用同一套规则）
 *
 * 纯函数、无 IO、无隐式随机源：随机数由 mulberry32 显式推进（种子由调用方传入），
 * 因此「相同 seed + 相同尺寸 + 相同雷数」必然得到完全相同的盘面，
 * 便于自检脚本复现，也便于联机服务按种子生成权威盘面。
 *
 * 规则口径：
 * - 盘面是 width×height 的扁平数组（index = y * width + x），长度 = width * height；
 * - 翻开数字为 0 的格子时递归洪水展开 8 邻域，已翻开的格子不重复计入；
 * - 洪水展开不会自动揭开雷：雷只有被直接点到才算踩中（联机里踩雷者被淘汰）；
 * - revealCells / chordCells 都不修改传入的 opened 集合，只返回「本次新增的格子」，
 *   由调用方（服务层）写回自己的状态，保证引擎侧无副作用；
 * - 和弦（chord）只服务单机模式：联机是「一人只许下一次」，不做和弦；
 * - minePositions 只用于单机结算展示：联机 DTO 绝不发布未翻开的雷位。
 */

// === 尺寸常量（联机固定盘面） ===

/** 联机扫雷棋盘宽度（格） */
export const MS_ONLINE_WIDTH = 12
/** 联机扫雷棋盘高度（格） */
export const MS_ONLINE_HEIGHT = 12
/** 联机扫雷雷数 */
export const MS_ONLINE_MINES = 22

/** 权威盘面（bombs 为长度 width*height 的扁平数组） */
export interface MinesweeperBoard {
  width: number
  height: number
  /** 实际布置的雷数（等于 bombs 中 true 的个数） */
  mines: number
  bombs: boolean[]
}

// === 随机源 ===

/**
 * mulberry32 单步推进（纯函数）：返回下一状态与 [0,1) 随机值。
 * 与 game2048 / gameSnake 完全同一算法，便于跨游戏对齐确定性行为。
 */
export function nextMinesweeperRandom(state: number): { state: number; value: number } {
  const next = (state + 0x6d2b79f5) | 0
  let t = Math.imul(next ^ (next >>> 15), 1 | next)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return { state: next >>> 0, value: ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

// === 坐标工具 ===

/** 格子下标是否合法（所有查询都以它为准做越界保护） */
export function isMinesweeperIndex(board: MinesweeperBoard, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < board.bombs.length
}

/** 8 邻域下标（越界的自动丢弃） */
export function adjacentIndexes(board: MinesweeperBoard, index: number): number[] {
  if (!isMinesweeperIndex(board, index)) return []
  const x = index % board.width
  const y = Math.floor(index / board.width)
  const result: number[] = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || nx >= board.width || ny < 0 || ny >= board.height) continue
      result.push(ny * board.width + nx)
    }
  }
  return result
}

// === 开局 ===

/**
 * 按 seed 生成盘面（相同 seed + 尺寸 + 雷数 → 完全相同盘面）。
 * 布雷方式为「从未占用格子里抽一个并移除」，因此雷不会重复占格。
 * 雷数超过格子总数时按总格子数截断（退化盘面仍然自洽）。
 */
export function createMinesweeperBoard(
  seed: number,
  width: number,
  height: number,
  mines: number,
): MinesweeperBoard {
  const boardWidth = Math.max(1, Math.floor(width))
  const boardHeight = Math.max(1, Math.floor(height))
  const total = boardWidth * boardHeight
  const count = Math.min(Math.max(0, Math.floor(mines)), total)
  const board: MinesweeperBoard = {
    width: boardWidth,
    height: boardHeight,
    mines: count,
    bombs: new Array<boolean>(total).fill(false),
  }

  const free: number[] = []
  for (let index = 0; index < total; index += 1) free.push(index)

  let state = seed >>> 0
  for (let placed = 0; placed < count; placed += 1) {
    const draw = nextMinesweeperRandom(state)
    state = draw.state
    const pick = Math.min(free.length - 1, Math.floor(draw.value * free.length))
    const index = free[pick]
    free.splice(pick, 1)
    board.bombs[index] = true
  }
  return board
}

// === 查询 ===

/** 该格是否为雷（越界安全：非法下标返回 false） */
export function isMine(board: MinesweeperBoard, index: number): boolean {
  if (!isMinesweeperIndex(board, index)) return false
  return board.bombs[index]
}

/** 该格 8 邻域内的雷数（越界安全：非法下标返回 0；不计自身） */
export function adjacentMines(board: MinesweeperBoard, index: number): number {
  if (!isMinesweeperIndex(board, index)) return 0
  let count = 0
  for (const neighbor of adjacentIndexes(board, index)) {
    if (board.bombs[neighbor]) count += 1
  }
  return count
}

/** 剩余未翻开的安全格数（opened 里的雷格不计入） */
export function remainingSafe(board: MinesweeperBoard, opened: Set<number>): number {
  let revealed = 0
  for (const index of opened) {
    if (index >= 0 && index < board.bombs.length && !board.bombs[index]) revealed += 1
  }
  return Math.max(0, board.width * board.height - board.mines - revealed)
}

/** 是否已经清盘（所有非雷格都已翻开；全雷的退化盘面直接为 false） */
export function isCleared(board: MinesweeperBoard, opened: Set<number>): boolean {
  if (board.width * board.height - board.mines <= 0) return false
  return remainingSafe(board, opened) === 0
}

/** 全部雷位（单机结算展示用；联机 DTO 不允许使用，避免泄露未翻开的雷） */
export function minePositions(board: MinesweeperBoard): number[] {
  const result: number[] = []
  for (let index = 0; index < board.bombs.length; index += 1) {
    if (board.bombs[index]) result.push(index)
  }
  return result
}

// === 翻开 ===

/**
 * 翻开该格，返回本次新增的全部格子（引擎不修改 opened 集合）。
 * - 下标非法 / 已翻开 → 空数组（幂等，不产生重复格子）；
 * - 直接点到雷 → 只返回该雷格，mine = true；
 * - 点到数字格 → 只返回该格；
 * - 点到空白（相邻雷数为 0）格 → 递归洪水展开 8 邻域，
 *   已翻开与已收录的格子不重复，洪水不会自动揭开雷。
 */
export function revealCells(
  board: MinesweeperBoard,
  opened: Set<number>,
  index: number,
): { cells: number[]; mine: boolean } {
  if (!isMinesweeperIndex(board, index)) return { cells: [], mine: false }
  if (opened.has(index)) return { cells: [], mine: false }
  if (board.bombs[index]) return { cells: [index], mine: true }

  const cells: number[] = []
  const seen = new Set<number>([index])
  const queue: number[] = [index]
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]
    cells.push(current)
    // 数字格只揭自己，不再继续扩散
    if (adjacentMines(board, current) > 0) continue
    for (const next of adjacentIndexes(board, current)) {
      if (seen.has(next) || opened.has(next) || board.bombs[next]) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return { cells, mine: false }
}

/**
 * 和弦（单机用）：对已翻开的数字格，若周围「已判定格子」数量正好等于该格数字，
 * 则一次性展开其余邻格（含洪水展开）。
 *
 * 注意：`opened` 参数在这里语义是「已判定格子 = 已翻开格 + 已插旗格」的合集，
 * 调用方（单机客户端）需要自己把旗子并进来传进来。
 *
 * 返回本次新增的格子；不满足和弦条件（未翻开、是雷、数字为 0、旗数不够/过多）返回空数组。
 * 插错旗时和弦会揭开邻里的雷（返回的格子里含雷），与经典扫雷口径一致。
 */
export function chordCells(board: MinesweeperBoard, opened: Set<number>, index: number): number[] {
  if (!isMinesweeperIndex(board, index)) return []
  if (!opened.has(index)) return []
  if (board.bombs[index]) return []

  const neighbors = adjacentIndexes(board, index)
  let settled = 0
  for (const neighbor of neighbors) {
    if (opened.has(neighbor)) settled += 1
  }
  const expected = adjacentMines(board, index)
  if (expected === 0 || settled !== expected) return []

  // 工作集合随每格展开增长，保证多格邻域展开互不重复
  const working = new Set<number>(opened)
  const added: number[] = []
  for (const neighbor of neighbors) {
    if (working.has(neighbor)) continue
    const step = revealCells(board, working, neighbor)
    for (const cell of step.cells) {
      working.add(cell)
      added.push(cell)
    }
  }
  return added
}
