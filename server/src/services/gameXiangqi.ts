/**
 * 中国象棋纯规则 / 搜索引擎（无状态、无数据库、无网络依赖）
 *
 * 规则口径（标准象棋，无禁手特例外的简化）：
 *   - 9 列 × 10 行，红方在下（y=7–9 为九宫），黑方在上（y=0–2 为九宫），红先；
 *   - 帅/将：九宫内一步直行；将帅同列且中间无子时视为照面，属非法局面
 *     （引擎允许将/将沿空列直接吃对方将，作为照面判定的等价实现）；
 *   - 仕/士：九宫内一步斜行；相/象：田字且象眼不能有子，不可过河；
 *   - 马：日字且马腿不能有子；车：直线任意格；炮：直线移动，吃子必须隔一个炮架；
 *   - 兵/卒：只能向前，过河后可左右，不能后退；
 *   - 走子后不得使己方将帅被将军（含将帅照面），被将军且无合法着法 = 绝杀；
 *   - 无合法着法但未被将军 = 困毙（象棋规则判负）。
 *
 * ⚠️ 前后端唯一真相源：本文件与 client/src/lib/games/xiangqi.ts 必须逐字一致（除头注释），
 *    任何改动必须同步另一端；client 侧的 xiangqi.test.ts 会对齐两份源码，漂移会让测试失败。
 *    联机回合超时托管与单机 AI 共用 suggestXiangqiMove。
 */

// === 常量（前后端逐字一致，勿改） ===

export const XIANGQI_COLS = 9
export const XIANGQI_ROWS = 10
export const XIANGQI_CELLS = XIANGQI_COLS * XIANGQI_ROWS

/** 红方（下方，先手）；棋盘上用 1 表示 */
export const XIANGQI_RED = 1
/** 黑方（上方）；棋盘上用 -1 表示 */
export const XIANGQI_BLACK = -1

export type XiangqiSide = typeof XIANGQI_RED | typeof XIANGQI_BLACK

/** 棋子类型（用正负号区分红黑：红 = 正数，黑 = 负数） */
export const XIANGQI_GENERAL = 1
export const XIANGQI_ADVISOR = 2
export const XIANGQI_ELEPHANT = 3
export const XIANGQI_HORSE = 4
export const XIANGQI_CHARIOT = 5
export const XIANGQI_CANNON = 6
export const XIANGQI_SOLDIER = 7

/** 空位 */
export const XIANGQI_EMPTY = 0

/** 一步棋（from / to 为一维下标 = y * 9 + x） */
export interface XiangqiMove {
  from: number
  to: number
}

/** 局面判定结果 */
export interface XiangqiStatus {
  /** 当前行棋方是否被将军 */
  checked: boolean
  /** 当前行棋方是否还有合法着法 */
  hasLegalMove: boolean
  /** 是否已分出胜负（绝杀 / 困毙） */
  finished: boolean
  /** 胜方（未结束为 null） */
  winner: XiangqiSide | null
  reason: 'checkmate' | 'stalemate' | null
}

/** 棋子中文名（红 / 黑两套） */
export const XIANGQI_PIECE_NAMES: Record<number, { red: string; black: string }> = {
  [XIANGQI_GENERAL]: { red: '帅', black: '将' },
  [XIANGQI_ADVISOR]: { red: '仕', black: '士' },
  [XIANGQI_ELEPHANT]: { red: '相', black: '象' },
  [XIANGQI_HORSE]: { red: '马', black: '马' },
  [XIANGQI_CHARIOT]: { red: '车', black: '车' },
  [XIANGQI_CANNON]: { red: '炮', black: '炮' },
  [XIANGQI_SOLDIER]: { red: '兵', black: '卒' },
}

/** 坐标换算 */
export function xiangqiIndex(x: number, y: number): number {
  return y * XIANGQI_COLS + x
}

/** 一维下标 → 坐标 */
export function xiangqiPoint(index: number): { x: number; y: number } {
  return { x: index % XIANGQI_COLS, y: Math.floor(index / XIANGQI_COLS) }
}

export function isInXiangqiBoard(x: number, y: number): boolean {
  return x >= 0 && x < XIANGQI_COLS && y >= 0 && y < XIANGQI_ROWS
}

/** 棋子归属方（空位为 0） */
export function xiangqiSideOf(piece: number): XiangqiSide | 0 {
  if (piece > 0) return XIANGQI_RED
  if (piece < 0) return XIANGQI_BLACK
  return 0
}

/** 棋子类型（空位为 0） */
export function xiangqiTypeOf(piece: number): number {
  return Math.abs(piece)
}

export function xiangqiOpponent(side: XiangqiSide): XiangqiSide {
  return side === XIANGQI_RED ? XIANGQI_BLACK : XIANGQI_RED
}

/** 初始棋盘（红方在下） */
export function createXiangqiBoard(): number[] {
  const board = new Array<number>(XIANGQI_CELLS).fill(XIANGQI_EMPTY)
  const backRank = [
    XIANGQI_CHARIOT,
    XIANGQI_HORSE,
    XIANGQI_ELEPHANT,
    XIANGQI_ADVISOR,
    XIANGQI_GENERAL,
    XIANGQI_ADVISOR,
    XIANGQI_ELEPHANT,
    XIANGQI_HORSE,
    XIANGQI_CHARIOT,
  ]
  backRank.forEach((type, x) => {
    board[xiangqiIndex(x, 0)] = -type
    board[xiangqiIndex(x, 9)] = type
  })
  for (const x of [1, 7]) {
    board[xiangqiIndex(x, 2)] = -XIANGQI_CANNON
    board[xiangqiIndex(x, 7)] = XIANGQI_CANNON
  }
  for (const x of [0, 2, 4, 6, 8]) {
    board[xiangqiIndex(x, 3)] = -XIANGQI_SOLDIER
    board[xiangqiIndex(x, 6)] = XIANGQI_SOLDIER
  }
  return board
}

/** 九宫范围：x 3–5，红 y 7–9 / 黑 y 0–2 */
export function isInXiangqiPalace(x: number, y: number, side: XiangqiSide): boolean {
  if (x < 3 || x > 5) return false
  return side === XIANGQI_RED ? y >= 7 && y <= 9 : y >= 0 && y <= 2
}

/** 是否已过河（红过河 y ≤ 4，黑过河 y ≥ 5） */
export function hasCrossedRiver(y: number, side: XiangqiSide): boolean {
  return side === XIANGQI_RED ? y <= 4 : y >= 5
}

/** 找到将/帅的位置（不存在返回 -1） */
export function findXiangqiGeneral(board: number[], side: XiangqiSide): number {
  const target = side === XIANGQI_RED ? XIANGQI_GENERAL : -XIANGQI_GENERAL
  return board.indexOf(target)
}

const ORTHOGONAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
]

const DIAGONAL_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
]

const HORSE_STEPS: ReadonlyArray<readonly [number, number]> = [
  [1, 2],
  [-1, 2],
  [1, -2],
  [-1, -2],
  [2, 1],
  [2, -1],
  [-2, 1],
  [-2, -1],
]

/**
 * 生成某个棋子的伪合法着法（不检查走后是否被将军，也不检查送将）。
 * 返回目标一维下标数组；空位 / 越界返回 []。
 */
export function generatePseudoXiangqiMoves(board: number[], from: number): number[] {
  if (from < 0 || from >= XIANGQI_CELLS) return []
  const piece = board[from]
  const side = xiangqiSideOf(piece)
  if (side === 0) return []
  const type = xiangqiTypeOf(piece)
  const { x, y } = xiangqiPoint(from)
  const targets: number[] = []

  const canLand = (tx: number, ty: number): boolean => {
    if (!isInXiangqiBoard(tx, ty)) return false
    const target = board[xiangqiIndex(tx, ty)]
    return target === 0 || xiangqiSideOf(target) !== side
  }
  const add = (tx: number, ty: number): void => {
    if (canLand(tx, ty)) targets.push(xiangqiIndex(tx, ty))
  }

  if (type === XIANGQI_GENERAL) {
    for (const [dx, dy] of ORTHOGONAL_DIRECTIONS) {
      const tx = x + dx
      const ty = y + dy
      if (isInXiangqiPalace(tx, ty, side)) add(tx, ty)
    }
    // 将帅照面：沿同列直接吃对方将/帅（中间无子的空列）
    const generalTarget = side === XIANGQI_RED ? -XIANGQI_GENERAL : XIANGQI_GENERAL
    for (const dy of [-1, 1] as const) {
      let ty = y + dy
      while (ty >= 0 && ty < XIANGQI_ROWS) {
        const target = board[xiangqiIndex(x, ty)]
        if (target !== 0) {
          if (target === generalTarget) targets.push(xiangqiIndex(x, ty))
          break
        }
        ty += dy
      }
    }
    return targets
  }

  if (type === XIANGQI_ADVISOR) {
    for (const [dx, dy] of DIAGONAL_DIRECTIONS) {
      const tx = x + dx
      const ty = y + dy
      if (isInXiangqiPalace(tx, ty, side)) add(tx, ty)
    }
    return targets
  }

  if (type === XIANGQI_ELEPHANT) {
    for (const [dx, dy] of DIAGONAL_DIRECTIONS) {
      const tx = x + dx * 2
      const ty = y + dy * 2
      if (!isInXiangqiBoard(tx, ty)) continue
      // 象不能过河
      if (side === XIANGQI_RED ? ty < 5 : ty > 4) continue
      // 象眼必须为空
      if (board[xiangqiIndex(x + dx, y + dy)] !== 0) continue
      add(tx, ty)
    }
    return targets
  }

  if (type === XIANGQI_HORSE) {
    for (const [dx, dy] of HORSE_STEPS) {
      const tx = x + dx
      const ty = y + dy
      if (!isInXiangqiBoard(tx, ty)) continue
      // 马腿：沿较大的那个方向先走一步
      const legX = Math.abs(dx) === 2 ? x + dx / 2 : x
      const legY = Math.abs(dy) === 2 ? y + dy / 2 : y
      if (board[xiangqiIndex(legX, legY)] !== 0) continue
      add(tx, ty)
    }
    return targets
  }

  if (type === XIANGQI_CHARIOT) {
    for (const [dx, dy] of ORTHOGONAL_DIRECTIONS) {
      let tx = x + dx
      let ty = y + dy
      while (isInXiangqiBoard(tx, ty)) {
        const target = board[xiangqiIndex(tx, ty)]
        if (target === 0) {
          targets.push(xiangqiIndex(tx, ty))
        } else {
          if (xiangqiSideOf(target) !== side) targets.push(xiangqiIndex(tx, ty))
          break
        }
        tx += dx
        ty += dy
      }
    }
    return targets
  }

  if (type === XIANGQI_CANNON) {
    for (const [dx, dy] of ORTHOGONAL_DIRECTIONS) {
      let tx = x + dx
      let ty = y + dy
      let screen = false
      while (isInXiangqiBoard(tx, ty)) {
        const target = board[xiangqiIndex(tx, ty)]
        if (!screen) {
          if (target === 0) targets.push(xiangqiIndex(tx, ty))
          else screen = true
        } else if (target !== 0) {
          if (xiangqiSideOf(target) !== side) targets.push(xiangqiIndex(tx, ty))
          break
        }
        tx += dx
        ty += dy
      }
    }
    return targets
  }

  if (type === XIANGQI_SOLDIER) {
    const forward = side === XIANGQI_RED ? -1 : 1
    add(x, y + forward)
    if (hasCrossedRiver(y, side)) {
      add(x - 1, y)
      add(x + 1, y)
    }
    return targets
  }

  return targets
}

/** 该方所有伪合法着法（不检查送将） */
export function generatePseudoXiangqiSideMoves(board: number[], side: XiangqiSide): XiangqiMove[] {
  const moves: XiangqiMove[] = []
  for (let from = 0; from < XIANGQI_CELLS; from += 1) {
    if (xiangqiSideOf(board[from]) !== side) continue
    for (const to of generatePseudoXiangqiMoves(board, from)) moves.push({ from, to })
  }
  return moves
}

/** 就地走子，返回被吃棋子（0 = 无），越界 / 非法返回 null（调用方保证伪合法） */
export function makeXiangqiMove(board: number[], from: number, to: number): number | null {
  if (from < 0 || to < 0 || from >= XIANGQI_CELLS || to >= XIANGQI_CELLS || from === to) return null
  const piece = board[from]
  if (piece === 0) return null
  const captured = board[to]
  board[to] = piece
  board[from] = 0
  return captured
}

/** 撤销走子 */
export function undoXiangqiMove(board: number[], from: number, to: number, captured: number): void {
  board[from] = board[to]
  board[to] = captured
}

/**
 * 某一方是否被将军（含将帅照面）。
 * 采用「从将/帅出发反向找攻击子」的直接判定（比枚举对方全部着法快一个量级，
 * 供 AI 搜索每步调用）：车/炮沿直线、马按日字反查马腿、兵/卒按过河规则反查、
 * 将帅同列无遮挡即照面。
 */
export function isXiangqiInCheck(board: number[], side: XiangqiSide): boolean {
  const general = findXiangqiGeneral(board, side)
  if (general < 0) return true
  const { x, y } = xiangqiPoint(general)
  const enemy = xiangqiOpponent(side)
  const enemyOf = (type: number): number => (enemy === XIANGQI_RED ? type : -type)

  // 车 / 炮 / 将帅照面：沿四条直线扫描
  for (const [dx, dy] of ORTHOGONAL_DIRECTIONS) {
    let tx = x + dx
    let ty = y + dy
    let screenFound = false
    while (isInXiangqiBoard(tx, ty)) {
      const piece = board[xiangqiIndex(tx, ty)]
      if (piece !== 0) {
        if (!screenFound) {
          const type = xiangqiTypeOf(piece)
          if (xiangqiSideOf(piece) === enemy && type === XIANGQI_CHARIOT) return true
          // 将帅照面：同列（dx = 0）中间无子的对方将/帅
          if (dx === 0 && piece === enemyOf(XIANGQI_GENERAL)) return true
          screenFound = true
        } else {
          // 炮架之后的第一个棋子：若是对方炮则被将军
          if (xiangqiSideOf(piece) === enemy && xiangqiTypeOf(piece) === XIANGQI_CANNON) return true
          break
        }
      }
      tx += dx
      ty += dy
    }
  }

  // 马：从将/帅位置反查 8 个可能的马位，并检查马腿
  for (const [dx, dy] of HORSE_STEPS) {
    const hx = x + dx
    const hy = y + dy
    if (!isInXiangqiBoard(hx, hy)) continue
    if (board[xiangqiIndex(hx, hy)] !== enemyOf(XIANGQI_HORSE)) continue
    // 马从 (hx,hy) 走到 (x,y)，腿在长轴方向紧邻马的一格
    const legX = Math.abs(dx) === 2 ? x + dx / 2 : x + dx
    const legY = Math.abs(dy) === 2 ? y + dy / 2 : y + dy
    if (board[xiangqiIndex(legX, legY)] === 0) return true
  }

  // 兵/卒：正面一步，以及过河后的左右一步
  const enemySoldier = enemyOf(XIANGQI_SOLDIER)
  const forward = side === XIANGQI_RED ? -1 : 1
  // 对方兵/卒的攻击方向与我方前进方向相反：它站在我方前进方向的前一格
  const attackerY = y + forward
  if (isInXiangqiBoard(x, attackerY) && board[xiangqiIndex(x, attackerY)] === enemySoldier) return true
  for (const dx of [-1, 1] as const) {
    const ax = x + dx
    if (!isInXiangqiBoard(ax, y)) continue
    if (board[xiangqiIndex(ax, y)] !== enemySoldier) continue
    // 侧向攻击要求该兵/卒已过河（按它自己的行进方向判断）
    if (hasCrossedRiver(y, enemy)) return true
  }

  return false
}

/** 走后是否会让己方被将军（含照面）；已知伪合法时走这条快路径，避免重复生成伪着法 */
function isXiangqiMoveSafe(board: number[], from: number, to: number, side: XiangqiSide): boolean {
  const captured = makeXiangqiMove(board, from, to)
  if (captured === null) return false
  const safe = !isXiangqiInCheck(board, side)
  undoXiangqiMove(board, from, to, captured)
  return safe
}

/** 走后是否会让己方被将军（含照面） */
export function isXiangqiMoveLegal(board: number[], from: number, to: number, side: XiangqiSide): boolean {
  if (xiangqiSideOf(board[from]) !== side) return false
  if (to < 0 || to >= XIANGQI_CELLS) return false
  if (xiangqiSideOf(board[to]) === side) return false
  if (!generatePseudoXiangqiMoves(board, from).includes(to)) return false
  return isXiangqiMoveSafe(board, from, to, side)
}

/** 某方所有合法着法（已过滤送将 / 照面） */
export function generateLegalXiangqiMoves(board: number[], side: XiangqiSide): XiangqiMove[] {
  const result: XiangqiMove[] = []
  for (let from = 0; from < XIANGQI_CELLS; from += 1) {
    if (xiangqiSideOf(board[from]) !== side) continue
    for (const to of generatePseudoXiangqiMoves(board, from)) {
      if (isXiangqiMoveSafe(board, from, to, side)) result.push({ from, to })
    }
  }
  return result
}

/** 某个棋子的合法落点（单机页高亮用） */
export function xiangqiLegalMovesFrom(board: number[], from: number): number[] {
  const side = xiangqiSideOf(board[from])
  if (side === 0) return []
  return generatePseudoXiangqiMoves(board, from).filter((to) =>
    isXiangqiMoveLegal(board, from, to, side),
  )
}

/**
 * 局面判定：绝杀 / 困毙（象棋困毙判负）。
 * 调用方在每一步走完后对「下一手行棋方」调用。
 */
export function evaluateXiangqiStatus(board: number[], sideToMove: XiangqiSide): XiangqiStatus {
  const checked = isXiangqiInCheck(board, sideToMove)
  const hasLegalMove = generateLegalXiangqiMoves(board, sideToMove).length > 0
  if (hasLegalMove) {
    return { checked, hasLegalMove, finished: false, winner: null, reason: null }
  }
  return {
    checked,
    hasLegalMove,
    finished: true,
    winner: xiangqiOpponent(sideToMove),
    reason: checked ? 'checkmate' : 'stalemate',
  }
}

// === 评估与搜索（单机 AI / 联机回合超时托管共用） ===

/** 棋子基础价值（将帅不参与交换计分，用极大值兜底） */
const XIANGQI_VALUES: Record<number, number> = {
  [XIANGQI_GENERAL]: 10_000,
  [XIANGQI_CHARIOT]: 900,
  [XIANGQI_CANNON]: 450,
  [XIANGQI_HORSE]: 400,
  [XIANGQI_ADVISOR]: 200,
  [XIANGQI_ELEPHANT]: 200,
  [XIANGQI_SOLDIER]: 100,
}

const XIANGQI_MATE_SCORE = 10_000_000

/**
 * 静态搜索（quiescence）延伸深度：只继续「吃子」着法。
 * 没有它时，搜索在边界上会直接按子力打分，AI 就会贪吃受保护的子
 * （吃完立刻被反吃也照吃），玩家看到的就是「乱吃棋子」。
 */
const XIANGQI_QUIESCE_DEPTH = 2

/** 位置分：兵过河、马炮占中路、车活跃度（从 side 视角返回正分） */
function xiangqiPositionalValue(board: number[], side: XiangqiSide): number {
  let score = 0
  for (let index = 0; index < XIANGQI_CELLS; index += 1) {
    const piece = board[index]
    const owner = xiangqiSideOf(piece)
    if (owner === 0) continue
    const type = xiangqiTypeOf(piece)
    const { x, y } = xiangqiPoint(index)
    const sign = owner === side ? 1 : -1
    let bonus = 0
    if (type === XIANGQI_SOLDIER) {
      if (hasCrossedRiver(y, owner)) bonus += 50
      // 越靠近对方底线价值越高
      bonus += owner === XIANGQI_RED ? (9 - y) * 6 : y * 6
    } else if (type === XIANGQI_HORSE || type === XIANGQI_CANNON) {
      bonus += (4 - Math.abs(x - 4)) * 6
      bonus += owner === XIANGQI_RED ? (9 - y) * 2 : y * 2
    } else if (type === XIANGQI_CHARIOT) {
      bonus += (4 - Math.abs(x - 4)) * 3
    }
    score += sign * bonus
  }
  return score
}

/** 静态评估：正值表示 side 占优 */
export function evaluateXiangqiBoard(board: number[], side: XiangqiSide): number {
  let material = 0
  for (const piece of board) {
    const owner = xiangqiSideOf(piece)
    if (owner === 0) continue
    const value = XIANGQI_VALUES[xiangqiTypeOf(piece)] ?? 0
    material += owner === side ? value : -value
  }
  return material + xiangqiPositionalValue(board, side)
}

/** 着法排序：先吃大子，便于 alpha-beta 剪枝 */
function orderXiangqiMoves(board: number[], moves: XiangqiMove[]): XiangqiMove[] {
  return [...moves].sort((a, b) => {
    const captureA = Math.abs(board[a.to])
    const captureB = Math.abs(board[b.to])
    return captureB - captureA
  })
}

/** 某方所有合法吃子着法（静态搜索专用：先筛吃子，省掉大量空着的合法性判定） */
function generateLegalXiangqiCaptures(board: number[], side: XiangqiSide): XiangqiMove[] {
  const result: XiangqiMove[] = []
  for (let from = 0; from < XIANGQI_CELLS; from += 1) {
    if (xiangqiSideOf(board[from]) !== side) continue
    for (const to of generatePseudoXiangqiMoves(board, from)) {
      if (board[to] === 0) continue
      if (isXiangqiMoveSafe(board, from, to, side)) result.push({ from, to })
    }
  }
  return result
}

/**
 * negamax + alpha-beta。
 * 返回值始终从 aiSide 视角计算（score > 0 对 AI 有利）。
 */
function searchXiangqi(
  board: number[],
  sideToMove: XiangqiSide,
  aiSide: XiangqiSide,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const moves = generateLegalXiangqiMoves(board, sideToMove)
  if (moves.length === 0) {
    // 无着可走的一方输（绝杀 / 困毙）
    return sideToMove === aiSide ? -XIANGQI_MATE_SCORE - depth : XIANGQI_MATE_SCORE + depth
  }
  if (depth <= 0) {
    return searchXiangqiCaptures(board, sideToMove, aiSide, alpha, beta, XIANGQI_QUIESCE_DEPTH)
  }

  const ordered = orderXiangqiMoves(board, moves)
  if (sideToMove === aiSide) {
    let best = -Infinity
    for (const move of ordered) {
      const captured = makeXiangqiMove(board, move.from, move.to)
      if (captured === null) continue
      const score = searchXiangqi(board, xiangqiOpponent(sideToMove), aiSide, depth - 1, alpha, beta)
      undoXiangqiMove(board, move.from, move.to, captured)
      if (score > best) best = score
      if (best > alpha) alpha = best
      if (alpha >= beta) break
    }
    return best === -Infinity ? evaluateXiangqiBoard(board, aiSide) : best
  }

  let best = Infinity
  for (const move of ordered) {
    const captured = makeXiangqiMove(board, move.from, move.to)
    if (captured === null) continue
    const score = searchXiangqi(board, xiangqiOpponent(sideToMove), aiSide, depth - 1, alpha, beta)
    undoXiangqiMove(board, move.from, move.to, captured)
    if (score < best) best = score
    if (best < beta) beta = best
    if (alpha >= beta) break
  }
  return best === Infinity ? evaluateXiangqiBoard(board, aiSide) : best
}

/**
 * 静态搜索：在 alpha-beta 的叶子节点上只延伸吃子着法，避免「地平线效应」
 * 让 AI 吃掉受保护的子（吃完就被反吃，净亏一个大子）。
 * 返回值始终从 aiSide 视角计算；remaining 为还可延伸的吃子层数。
 */
function searchXiangqiCaptures(
  board: number[],
  sideToMove: XiangqiSide,
  aiSide: XiangqiSide,
  alpha: number,
  beta: number,
  remaining: number,
): number {
  const standPat = evaluateXiangqiBoard(board, aiSide)
  if (remaining <= 0) return standPat

  const captures = generateLegalXiangqiCaptures(board, sideToMove)
  if (captures.length === 0) return standPat
  const ordered = orderXiangqiMoves(board, captures)

  if (sideToMove === aiSide) {
    if (standPat >= beta) return standPat
    let best = Math.max(standPat, alpha)
    for (const move of ordered) {
      const captured = makeXiangqiMove(board, move.from, move.to)
      if (captured === null) continue
      const score = searchXiangqiCaptures(board, xiangqiOpponent(sideToMove), aiSide, best, beta, remaining - 1)
      undoXiangqiMove(board, move.from, move.to, captured)
      if (score > best) best = score
      if (best >= beta) break
    }
    return best
  }

  if (standPat <= alpha) return standPat
  let best = Math.min(standPat, beta)
  for (const move of ordered) {
    const captured = makeXiangqiMove(board, move.from, move.to)
    if (captured === null) continue
    const score = searchXiangqiCaptures(board, xiangqiOpponent(sideToMove), aiSide, alpha, best, remaining - 1)
    undoXiangqiMove(board, move.from, move.to, captured)
    if (score < best) best = score
    if (best <= alpha) break
  }
  return best
}

/** 搜索选项 */
export interface XiangqiSearchOptions {
  /** 搜索深度（默认 3；联机超时托管用 2） */
  depth?: number
  /** 并列最优时的随机源（单机 AI 走法不至于每盘完全一样） */
  rand?: () => number
}

/**
 * 选择一步棋（单机 AI 与联机回合超时托管共用）。
 * 使用 alpha-beta 搜索；所有着法等价时用 rand 打散。
 */
export function suggestXiangqiMove(
  board: number[],
  side: XiangqiSide,
  options: XiangqiSearchOptions = {},
): XiangqiMove | null {
  const depth = Math.max(1, Math.min(4, Math.floor(options.depth ?? 3)))
  const rand = options.rand ?? Math.random
  const moves = generateLegalXiangqiMoves(board, side)
  if (moves.length === 0) return null

  const ordered = orderXiangqiMoves(board, moves)
  let bestScore = -Infinity
  let bestMoves: XiangqiMove[] = []
  for (const move of ordered) {
    const captured = makeXiangqiMove(board, move.from, move.to)
    if (captured === null) continue
    const score = searchXiangqi(
      board,
      xiangqiOpponent(side),
      side,
      depth - 1,
      -Infinity,
      Infinity,
    )
    undoXiangqiMove(board, move.from, move.to, captured)
    if (score > bestScore + 0.001) {
      bestScore = score
      bestMoves = [move]
    } else if (Math.abs(score - bestScore) <= 0.001) {
      bestMoves.push(move)
    }
  }
  if (bestMoves.length === 0) return null
  if (bestMoves.length === 1) return bestMoves[0]
  return bestMoves[Math.floor(rand() * bestMoves.length)] ?? bestMoves[0]
}

/** 估值（测试用） */
export function xiangqiPieceValue(type: number): number {
  return XIANGQI_VALUES[type] ?? 0
}
