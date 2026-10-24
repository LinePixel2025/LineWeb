/**
 * 扫雷纯规则引擎（单机三档难度）
 *
 * 设计约束：
 * - 纯 TypeScript，不依赖 React / DOM，可在 vitest 里直接断言；
 * - 判定逻辑（首点安全、洪水展开、和弦、胜负、计时、本机纪录）全部在这里，页面只做渲染与事件；
 * - 联机盘面由服务端权威生成，本文件只导出共用的盘面常量与座位配色 helper。
 *
 * 盘面为扁平数组，`index = y * width + x`（列 x 向右、行 y 向下）。
 */

// ==================== 难度与盘面 ====================

/** 难度档位：初级 / 中级 / 高级 */
export type MsLevel = 'beginner' | 'intermediate' | 'expert'

/** 单档难度参数 */
export interface MsLevelSpec {
  width: number
  height: number
  mines: number
  /** 中文档位名（tab 直接展示） */
  label: string
}

/** 三档难度：中级与联机盘面一致（12×12 / 22 雷） */
export const MS_LEVELS: Record<MsLevel, MsLevelSpec> = {
  beginner: { width: 9, height: 9, mines: 10, label: '初级' },
  intermediate: { width: 12, height: 12, mines: 22, label: '中级' },
  expert: { width: 16, height: 16, mines: 40, label: '高级' },
}

/** 档位展示顺序 */
export const MS_LEVEL_ORDER: MsLevel[] = ['beginner', 'intermediate', 'expert']

/** 联机盘面常量（与 types/game.ts 的 GameMinesweeperMatch.board 一致，渲染参考值） */
export const MS_ONLINE = { width: 12, height: 12, mines: 22 } as const

/** 雷区盘面（bombs 与格子一一对应） */
export interface MsBoard {
  width: number
  height: number
  mines: number
  bombs: boolean[]
}

/** 联机插旗座位配色（2–4 人，按 players 数组下标取色） */
export const MS_PLAYER_COLORS: string[] = [
  '#0969da', // 蓝
  '#e8590c', // 橙
  '#8250df', // 紫
  '#1a7f37', // 绿
]

/** 掉线 / 出局玩家的灰色 */
export const MS_MUTED_COLOR = '#8c959f'

/** 按座位取色（越界取模，负数也回到合法色） */
export function msColorForSeat(seat: number): string {
  const count = MS_PLAYER_COLORS.length
  const index = ((Math.floor(seat) % count) + count) % count
  return MS_PLAYER_COLORS[index]
}

// ==================== 几何 / RNG ====================

/** mulberry32 确定性伪随机数生成器（与 2048 / 贪吃蛇引擎同算法） */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 生成一个可用的随机种子 */
export function randomMsSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
}

/** 索引 → 坐标（越界返回 null） */
export function msToXY(board: MsBoard, index: number): { x: number; y: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= board.width * board.height) return null
  return { x: index % board.width, y: Math.floor(index / board.width) }
}

/** 坐标 → 索引（越界返回 -1） */
export function msToIndex(board: MsBoard, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= board.width || y >= board.height) return -1
  return y * board.width + x
}

/**
 * 邻格索引（8 邻域，越界的自动裁掉）。
 * 索引非法（越界 / 非整数）返回空数组。
 */
export function msNeighborIndices(board: MsBoard, index: number): number[] {
  const at = msToXY(board, index)
  if (!at) return []
  const result: number[] = []
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue
      const x = at.x + dx
      const y = at.y + dy
      if (x < 0 || y < 0 || x >= board.width || y >= board.height) continue
      result.push(y * board.width + x)
    }
  }
  return result
}

/**
 * 撒雷。
 *
 * 传入 `firstSafeIndex` 时，该格的 3×3 邻域（含自己）**保证无雷**，
 * 因此「首点必安全」由引擎兜住，页面不需要重试；
 * 同一 seed + 同一 firstSafeIndex 得到完全相同的盘面（确定性 mulberry32）。
 */
export function createMsBoard(
  level: MsLevel,
  firstSafeIndex?: number | null,
  seed?: number
): MsBoard {
  const spec = MS_LEVELS[level]
  const width = Math.max(1, Math.floor(spec.width))
  const height = Math.max(1, Math.floor(spec.height))
  const total = width * height
  const bombs: boolean[] = new Array<boolean>(total).fill(false)
  const rng = mulberry32((seed ?? randomMsSeed()) >>> 0)

  // 首点保护圈：3×3 邻域（角 / 边自动收缩）
  const blocked = new Set<number>()
  if (typeof firstSafeIndex === 'number' && Number.isInteger(firstSafeIndex)) {
    const center = msToXY({ width, height, mines: 0, bombs: [] }, firstSafeIndex)
    if (center) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const x = center.x + dx
          const y = center.y + dy
          if (x < 0 || y < 0 || x >= width || y >= height) continue
          blocked.add(y * width + x)
        }
      }
    }
  }

  const candidates: number[] = []
  for (let i = 0; i < total; i += 1) {
    if (!blocked.has(i)) candidates.push(i)
  }

  // 雷数不能超过可用格（极端小盘 / 保护圈占满时自然减少）
  const mineCount = Math.max(0, Math.min(spec.mines, candidates.length))
  // 部分 Fisher–Yates：前 mineCount 个位置即雷位
  for (let i = 0; i < mineCount; i += 1) {
    const j = i + Math.floor(rng() * (candidates.length - i))
    const swap = candidates[i]
    candidates[i] = candidates[j]
    candidates[j] = swap
  }
  for (let i = 0; i < mineCount; i += 1) bombs[candidates[i]] = true

  return { width, height, mines: mineCount, bombs }
}

/** 该格是否为雷（索引非法按非雷处理） */
export function msIsMine(board: MsBoard, index: number): boolean {
  if (!Number.isInteger(index) || index < 0 || index >= board.bombs.length) return false
  return board.bombs[index] === true
}

/** 该格周围 8 格雷数（索引非法返回 0） */
export function msAdjacent(board: MsBoard, index: number): number {
  let count = 0
  for (const n of msNeighborIndices(board, index)) {
    if (board.bombs[n]) count += 1
  }
  return count
}

// ==================== 翻开 / 和弦 ====================

/** 一次操作的产物：新增已开格（不含重复、不含此前已开）+ 是否踩雷 */
export interface MsRevealResult {
  cells: number[]
  mine: boolean
}

/** 洪水展开：数字 0 的格子继续向邻格扩散；flags 中的格子被挡住不开 */
function floodReveal(
  board: MsBoard,
  opened: Set<number>,
  flags: Set<number> | null,
  start: number
): number[] {
  if (!Number.isInteger(start) || start < 0 || start >= board.bombs.length) return []
  if (opened.has(start)) return []
  if (flags && flags.has(start)) return []

  const out: number[] = []
  const queued = new Set<number>([start])
  const queue: number[] = [start]

  while (queue.length > 0) {
    const current = queue.shift() as number
    if (opened.has(current)) continue
    if (flags && flags.has(current)) continue
    out.push(current)
    // 只有空白格（周围无雷）才继续扩散；数字格到此为止，雷格也不扩散
    if (board.bombs[current]) continue
    if (msAdjacent(board, current) !== 0) continue
    for (const n of msNeighborIndices(board, current)) {
      if (queued.has(n) || opened.has(n)) continue
      if (flags && flags.has(n)) continue
      queued.add(n)
      queue.push(n)
    }
  }
  return out
}

/**
 * 翻开一格（不改 opened，只返回要加入的格子）。
 * 已开格 / 非法索引 → 空结果；踩雷 → 只返回该雷格本身（不扩散）。
 */
export function msReveal(board: MsBoard, opened: Set<number>, index: number): MsRevealResult {
  if (!Number.isInteger(index) || index < 0 || index >= board.bombs.length) {
    return { cells: [], mine: false }
  }
  if (opened.has(index)) return { cells: [], mine: false }
  if (board.bombs[index]) return { cells: [index], mine: true }
  return { cells: floodReveal(board, opened, null, index), mine: false }
}

/**
 * 和弦：已开的数字格，若周围旗数 == 数字，则一次性翻开其余邻格。
 * 旗数不符（多或少）时不做任何事（返回空结果），保证「猜错才炸」的经典惩罚。
 */
export function msChord(
  board: MsBoard,
  opened: Set<number>,
  flags: Set<number>,
  index: number
): MsRevealResult {
  if (!opened.has(index)) return { cells: [], mine: false }
  const count = msAdjacent(board, index)
  if (count === 0) return { cells: [], mine: false }

  const neighbors = msNeighborIndices(board, index)
  let flagged = 0
  for (const n of neighbors) {
    if (flags.has(n)) flagged += 1
  }
  if (flagged !== count) return { cells: [], mine: false }

  const cells: number[] = []
  const added = new Set<number>()
  let mine = false
  for (const n of neighbors) {
    if (opened.has(n) || flags.has(n)) continue
    for (const cell of floodReveal(board, opened, flags, n)) {
      if (added.has(cell)) continue
      added.add(cell)
      cells.push(cell)
      if (board.bombs[cell]) mine = true
    }
  }
  return { cells, mine }
}

/** 剩余未翻开的 safe 格数（opened 中的雷格不计入） */
export function msRemainingSafe(board: MsBoard, opened: Set<number>): number {
  let safeOpened = 0
  for (const index of opened) {
    if (!board.bombs[index]) safeOpened += 1
  }
  return Math.max(0, board.width * board.height - board.mines - safeOpened)
}

/** 是否全清（所有非雷格都已翻开） */
export function msIsCleared(board: MsBoard, opened: Set<number>): boolean {
  const safeTotal = board.width * board.height - board.mines
  if (safeTotal <= 0) return false
  return msRemainingSafe(board, opened) === 0
}

// ==================== 会话（状态 + 计时） ====================

/** 会话状态：ready = 首点未落；playing；won；lost */
export type MsStatus = 'ready' | 'playing' | 'won' | 'lost'

export interface MsSession {
  level: MsLevel
  /** 首点（翻开）之前为 null —— 雷区要等首点位置确定后才撒，才能保住 3×3 安全圈 */
  board: MsBoard | null
  opened: Set<number>
  flags: Set<number>
  /** 计时起点（毫秒时间戳，首点翻开时写入；未开始为 null） */
  startedAt: number | null
  /** 结束时间戳（未结束为 null） */
  finishedAt: number | null
  status: MsStatus
  /** 踩雷的那一格（失败遮罩高亮用） */
  boomIndex: number | null
  /** 本局种子（同种子 + 同首点 = 同盘面，便于复现） */
  seed: number
}

/** 新建一局（盘面延迟到第一次翻开时生成） */
export function createMsSession(level: MsLevel, seed?: number): MsSession {
  return {
    level,
    board: null,
    opened: new Set<number>(),
    flags: new Set<number>(),
    startedAt: null,
    finishedAt: null,
    status: 'ready',
    boomIndex: null,
    seed: (seed ?? randomMsSeed()) >>> 0,
  }
}

/** 本局用时（毫秒）：未开始 0；进行中 = now - startedAt；已结束 = finishedAt - startedAt */
export function msSessionElapsedMs(session: MsSession, now: number = Date.now()): number {
  if (session.startedAt === null) return 0
  const end = session.finishedAt ?? now
  return Math.max(0, end - session.startedAt)
}

/** 剩余雷数（雷数 - 旗数，可能为负，由 UI 决定怎么显示） */
export function msRemainingMines(session: MsSession): number {
  const mines = session.board ? session.board.mines : MS_LEVELS[session.level].mines
  return mines - session.flags.size
}

/**
 * 翻开一格（会生成盘面并推进状态）。
 * 返回本次新增的格子；已结束 / 已开 / 已插旗时返回空结果。
 */
export function msOpenCell(session: MsSession, index: number, now: number = Date.now()): MsRevealResult {
  if (session.status === 'won' || session.status === 'lost') return { cells: [], mine: false }
  if (!Number.isInteger(index) || index < 0) return { cells: [], mine: false }

  if (!session.board) session.board = createMsBoard(session.level, index, session.seed)
  const board = session.board
  if (index >= board.bombs.length) return { cells: [], mine: false }
  if (session.opened.has(index) || session.flags.has(index)) return { cells: [], mine: false }

  if (session.startedAt === null) session.startedAt = now

  const result = msReveal(board, session.opened, index)
  for (const cell of result.cells) session.opened.add(cell)

  if (result.mine) {
    session.status = 'lost'
    session.boomIndex = index
    session.finishedAt = now
  } else if (msIsCleared(board, session.opened)) {
    session.status = 'won'
    session.finishedAt = now
    // 全清后把所有剩余格标记为旗（经典行为，也让 HUD 归零）
    for (let i = 0; i < board.bombs.length; i += 1) {
      if (!session.opened.has(i)) session.flags.add(i)
    }
  } else {
    session.status = 'playing'
  }
  return result
}

/** 和弦展开（只在已开数字格上生效） */
export function msChordCell(session: MsSession, index: number, now: number = Date.now()): MsRevealResult {
  if (session.status === 'won' || session.status === 'lost') return { cells: [], mine: false }
  const board = session.board
  if (!board) return { cells: [], mine: false }
  if (!session.opened.has(index)) return { cells: [], mine: false }
  if (session.startedAt === null) session.startedAt = now

  const result = msChord(board, session.opened, session.flags, index)
  if (result.cells.length === 0 && !result.mine) return result

  for (const cell of result.cells) session.opened.add(cell)

  if (result.mine) {
    session.status = 'lost'
    session.boomIndex = result.cells.find((cell) => board.bombs[cell]) ?? index
    session.finishedAt = now
  } else if (msIsCleared(board, session.opened)) {
    session.status = 'won'
    session.finishedAt = now
    for (let i = 0; i < board.bombs.length; i += 1) {
      if (!session.opened.has(i)) session.flags.add(i)
    }
  } else {
    session.status = 'playing'
  }
  return result
}

/**
 * 插旗 / 撤旗（已开格不可插旗）。
 * 首点之前也允许插旗，此时盘面仍未生成。
 * 返回是否发生了变化。
 */
export function msToggleFlag(session: MsSession, index: number): boolean {
  if (session.status === 'won' || session.status === 'lost') return false
  if (!Number.isInteger(index) || index < 0) return false
  if (session.board && index >= session.board.bombs.length) return false
  if (session.opened.has(index)) return false
  if (session.flags.has(index)) {
    session.flags.delete(index)
    return true
  }
  session.flags.add(index)
  return true
}

// ==================== 本机纪录（localStorage，全部容错） ====================

/** 单档最佳时间存储键前缀（完整键 `lineweb.minesweeper.best.beginner`） */
export const MS_BEST_STORAGE_PREFIX = 'lineweb.minesweeper.best.'
/** 胜败场统计存储键 */
export const MS_STATS_STORAGE_KEY = 'lineweb.minesweeper.stats'

/** 各档胜败场 */
export interface MsStats {
  wins: Record<MsLevel, number>
  losses: Record<MsLevel, number>
}

/** 最小可用的存储接口（jsdom / 隐私模式 / SSR 都可能是 null 或抛异常） */
interface KvStore {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function getStore(): KvStore | null {
  try {
    const storage = (globalThis as { localStorage?: KvStore }).localStorage
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
      return null
    }
    return storage
  } catch {
    return null
  }
}

function safeGet(key: string): string | null {
  const store = getStore()
  if (!store) return null
  try {
    return store.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  const store = getStore()
  if (!store) return
  try {
    store.setItem(key, value)
  } catch {
    // 配额超限 / 隐私模式：仅影响本机记录持久化
  }
}

/** 某档最佳时间的存储键 */
export function msBestKey(level: MsLevel): string {
  return `${MS_BEST_STORAGE_PREFIX}${level}`
}

/** 读取某档最佳时间（毫秒，无纪录或脏数据返回 0） */
export function loadMsBest(level: MsLevel): number {
  const raw = safeGet(msBestKey(level))
  if (!raw) return 0
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/**
 * 写入某档用时，**只存更快的那一个**。
 * 返回落库后的最佳时间（存储不可用时返回本次应展示的合理值，保证 UI 一致）。
 */
export function saveMsBest(level: MsLevel, ms: number): number {
  const current = loadMsBest(level)
  const safeMs = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0
  if (safeMs === 0) return current
  if (current > 0 && safeMs >= current) return current
  safeSet(msBestKey(level), String(safeMs))
  return safeMs
}

/** 全 0 战绩 */
export function emptyMsStats(): MsStats {
  return {
    wins: { beginner: 0, intermediate: 0, expert: 0 },
    losses: { beginner: 0, intermediate: 0, expert: 0 },
  }
}

function toCount(value: unknown): number {
  const num = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

/** 读取胜败场（脏数据回退为全 0） */
export function loadMsStats(): MsStats {
  const raw = safeGet(MS_STATS_STORAGE_KEY)
  if (!raw) return emptyMsStats()
  try {
    const parsed = JSON.parse(raw) as Partial<MsStats>
    const next = emptyMsStats()
    const wins = (parsed.wins ?? {}) as Partial<Record<MsLevel, number>>
    const losses = (parsed.losses ?? {}) as Partial<Record<MsLevel, number>>
    for (const level of MS_LEVEL_ORDER) {
      next.wins[level] = toCount(wins[level])
      next.losses[level] = toCount(losses[level])
    }
    return next
  } catch {
    return emptyMsStats()
  }
}

/** 累计一局胜败并返回落库后的战绩 */
export function saveMsResult(level: MsLevel, win: boolean): MsStats {
  const current = loadMsStats()
  if (win) current.wins[level] += 1
  else current.losses[level] += 1
  safeSet(MS_STATS_STORAGE_KEY, JSON.stringify(current))
  return current
}

// ==================== 展示 helper ====================

/** 毫秒 → `mm:ss`（超过 99 分钟也照常进位，不截断） */
export function formatMsTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** 毫秒 → 十分之一秒位（`mm:ss` 后面的小数位，体现毫秒精度） */
export function formatMsTenths(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100) % 10)
  return String(tenths)
}
