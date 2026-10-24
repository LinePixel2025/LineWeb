/**
 * 五子棋纯规则 / 启发式引擎（无状态、无数据库、无网络依赖）
 *
 * 规则口径（无禁手 freestyle）：
 *   - 15×15 标准棋盘，黑（1）先行，双方轮流在空交叉点落子；
 *   - 任意方向连成五子及以上（含长连）即胜；
 *   - 棋盘下满且无人连五 → 平局；
 *   - 不实现禁手（黑棋长连同样获胜），与多数休闲平台口径一致。
 *
 * ⚠️ 前后端唯一真相源：本文件与 client/src/lib/games/gomoku.ts 必须逐字一致，
 *    任何改动必须同步另一端；client 侧的 gomoku.test.ts 会对齐两份源码，
 *    漂移会让测试失败。联机回合超时托管与单机 AI 共用 suggestGomokuMove。
 */

// === 常量（前后端逐字一致，勿改） ===

/** 棋盘边长（15×15） */
export const GOMOKU_BOARD_SIZE = 15
/** 交叉点总数 */
export const GOMOKU_CELL_COUNT = GOMOKU_BOARD_SIZE * GOMOKU_BOARD_SIZE
/** 黑子颜色值 */
export const GOMOKU_BLACK = 1
/** 白子颜色值 */
export const GOMOKU_WHITE = 2

export type GomokuColor = typeof GOMOKU_BLACK | typeof GOMOKU_WHITE

/** 棋盘：一维数组，下标 = y * GOMOKU_BOARD_SIZE + x，0 为空、1 黑、2 白 */
export type GomokuBoard = number[]

// === 坐标与基础操作 ===

/** (x, y) → 一维下标（本函数不做越界校验，由调用方保证） */
export function gomokuIndex(x: number, y: number): number {
  return y * GOMOKU_BOARD_SIZE + x
}

/** 空棋盘 */
export function createGomokuBoard(): GomokuBoard {
  return new Array<number>(GOMOKU_CELL_COUNT).fill(0)
}

/** (x, y) 是否在棋盘内 */
export function isInGomokuBoard(x: number, y: number): boolean {
  return x >= 0 && x < GOMOKU_BOARD_SIZE && y >= 0 && y < GOMOKU_BOARD_SIZE
}

/** 该交叉点是否为空（越界视为非空） */
export function isGomokuCellEmpty(board: GomokuBoard, x: number, y: number): boolean {
  if (!isInGomokuBoard(x, y)) return false
  return board[gomokuIndex(x, y)] === 0
}

/** 就地落子（调用方保证空格与合法颜色；返回落点下标） */
export function placeGomokuStone(board: GomokuBoard, x: number, y: number, color: GomokuColor): number {
  const index = gomokuIndex(x, y)
  board[index] = color
  return index
}

// === 胜负判定 ===

/** 4 个方向：横、竖、两条对角线（dx, dy） */
const GOMOKU_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
]

/**
 * 以刚落在 (x, y) 的子为心，检查四个方向是否连成五子及以上。
 * 返回获胜连线（按 y、x 升序排列，含中心子，至少 5 个点），未获胜返回 null。
 * 只查新落的子即可：此前局面没有五连（否则对局早已结束）。
 */
export function findGomokuWin(
  board: GomokuBoard,
  x: number,
  y: number,
): Array<{ x: number; y: number }> | null {
  const color = board[gomokuIndex(x, y)]
  if (color !== GOMOKU_BLACK && color !== GOMOKU_WHITE) return null
  for (const [dx, dy] of GOMOKU_DIRECTIONS) {
    const line: Array<{ x: number; y: number }> = [{ x, y }]
    for (const sign of [-1, 1] as const) {
      let step = 1
      for (;;) {
        const nx = x + dx * step * sign
        const ny = y + dy * step * sign
        if (!isInGomokuBoard(nx, ny) || board[gomokuIndex(nx, ny)] !== color) break
        line.push({ x: nx, y: ny })
        step += 1
      }
    }
    if (line.length >= 5) {
      return line.sort((a, b) => a.y - b.y || a.x - b.x)
    }
  }
  return null
}

/** 棋盘是否已下满（无空位 → 平局） */
export function isGomokuBoardFull(board: GomokuBoard): boolean {
  return board.every((cell) => cell !== 0)
}

// === 启发式评估（联机托管与单机 AI 共用） ===

/** 模式分（数值仅在引擎内比较用，不代表任何「得分」语义） */
const GOMOKU_SCORE_FIVE = 1_000_000
const GOMOKU_SCORE_OPEN_FOUR = 100_000
const GOMOKU_SCORE_FOUR = 10_000
const GOMOKU_SCORE_OPEN_THREE = 5_000
const GOMOKU_SCORE_THREE = 500
const GOMOKU_SCORE_OPEN_TWO = 50
const GOMOKU_SCORE_TWO = 5

/**
 * 评估在 (x, y) 落 color 一子的即时价值：对 4 个方向分别数「落子后的连续同色子数」
 * 与「两端空位数」，按连子数 × 开放度查表计分后求和。
 * （不含跳三 / 跳四等间隔棋型，休闲对局口径下足够；托管与单机 AI 同一实现。）
 */
export function evaluateGomokuPoint(board: GomokuBoard, x: number, y: number, color: GomokuColor): number {
  let total = 0
  for (const [dx, dy] of GOMOKU_DIRECTIONS) {
    let count = 1
    let openEnds = 0
    for (const sign of [-1, 1] as const) {
      let step = 1
      for (;;) {
        const nx = x + dx * step * sign
        const ny = y + dy * step * sign
        if (!isInGomokuBoard(nx, ny)) break
        const cell = board[gomokuIndex(nx, ny)]
        if (cell === color) {
          count += 1
          step += 1
          continue
        }
        if (cell === 0) openEnds += 1
        break
      }
    }
    total += gomokuLineScore(count, openEnds)
  }
  return total
}

function gomokuLineScore(count: number, openEnds: number): number {
  if (count >= 5) return GOMOKU_SCORE_FIVE
  if (openEnds === 0) return 0
  if (count === 4) return openEnds >= 2 ? GOMOKU_SCORE_OPEN_FOUR : GOMOKU_SCORE_FOUR
  if (count === 3) return openEnds >= 2 ? GOMOKU_SCORE_OPEN_THREE : GOMOKU_SCORE_THREE
  if (count === 2) return openEnds >= 2 ? GOMOKU_SCORE_OPEN_TWO : GOMOKU_SCORE_TWO
  return openEnds >= 2 ? GOMOKU_SCORE_TWO : 1
}

/**
 * 启发式选点（联机回合超时托管与单机 AI 共用）：
 *   1. 自己有成五点 → 直接落（获胜）；
 *   2. 对方有成五点 → 必堵；
 *   3. 否则取「己方价值 + 对方价值 × 0.9」最高的空点（攻守兼备、进攻略优先），
 *      并列用 rand() 打散，避免托管每盘走出完全一样的棋。
 * 候选点限定在已有棋子切比雪夫距离 ≤ 2 的空点（空盘 → 天元）。
 */
export function suggestGomokuMove(
  board: GomokuBoard,
  color: GomokuColor,
  rand: () => number = Math.random,
): { x: number; y: number } | null {
  const opponent: GomokuColor = color === GOMOKU_BLACK ? GOMOKU_WHITE : GOMOKU_BLACK
  const candidates = gomokuCandidates(board)
  if (candidates.length === 0) return null

  for (const point of candidates) {
    if (evaluateGomokuPoint(board, point.x, point.y, color) >= GOMOKU_SCORE_FIVE) return point
  }
  for (const point of candidates) {
    if (evaluateGomokuPoint(board, point.x, point.y, opponent) >= GOMOKU_SCORE_FIVE) return point
  }
  let best: { x: number; y: number } | null = null
  let bestScore = -1
  for (const point of candidates) {
    const score =
      evaluateGomokuPoint(board, point.x, point.y, color)
      + evaluateGomokuPoint(board, point.x, point.y, opponent) * 0.9
      + rand() * 0.5
    if (score > bestScore) {
      bestScore = score
      best = point
    }
  }
  return best
}

/** 候选空点：已有棋子切比雪夫距离 ≤ 2 的空交叉点（空盘 → 天元） */
function gomokuCandidates(board: GomokuBoard): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = []
  const seen = new Set<number>()
  for (let y = 0; y < GOMOKU_BOARD_SIZE; y += 1) {
    for (let x = 0; x < GOMOKU_BOARD_SIZE; x += 1) {
      if (board[gomokuIndex(x, y)] === 0) continue
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const nx = x + dx
          const ny = y + dy
          if (!isInGomokuBoard(nx, ny)) continue
          const index = gomokuIndex(nx, ny)
          if (board[index] !== 0 || seen.has(index)) continue
          seen.add(index)
          result.push({ x: nx, y: ny })
        }
      }
    }
  }
  if (result.length === 0 && board.every((cell) => cell === 0)) {
    const center = Math.floor(GOMOKU_BOARD_SIZE / 2)
    return [{ x: center, y: center }]
  }
  return result
}
