/**
 * 游戏战绩纯函数规则（禁止 import prisma，verify 脚本直接复用）。
 *
 * 单机结果由客户端上报，服务端只做白名单、上限与合并；
 * 联机结果由服务端结算后调用 publishGameEnd 写入。
 */

export const GAME_KEYS = [
  '2048',
  'doudizhu',
  'snake',
  'minesweeper',
  'jump',
  'gomoku',
  'liar',
  'uno',
  'xiangqi',
  'parkour',
] as const

export type GameKey = typeof GAME_KEYS[number]
export type GameOutcome = 'win' | 'loss' | 'draw'

/** 每个游戏允许的 variant；单机上报只允许 solo 变体（扫雷为难度） */
export const GAME_VARIANTS: Record<GameKey, readonly string[]> = {
  '2048': ['solo', 'online'],
  doudizhu: ['solo', 'online'],
  snake: ['solo', 'online'],
  minesweeper: ['beginner', 'intermediate', 'expert', 'online'],
  jump: ['solo', 'online'],
  gomoku: ['solo', 'online'],
  liar: ['solo', 'online'],
  uno: ['solo', 'online'],
  xiangqi: ['solo', 'online'],
  parkour: ['solo', 'online'],
}

const SOLO_VARIANTS: Record<GameKey, readonly string[]> = {
  '2048': ['solo'],
  doudizhu: ['solo'],
  snake: ['solo'],
  minesweeper: ['beginner', 'intermediate', 'expert'],
  jump: ['solo'],
  gomoku: ['solo'],
  liar: ['solo'],
  uno: ['solo'],
  xiangqi: ['solo'],
  parkour: ['solo'],
}

const OUTCOME_REQUIRED: readonly GameKey[] = [
  'doudizhu',
  'minesweeper',
  'gomoku',
  'liar',
  'uno',
  'xiangqi',
]

const SCORE_CAPS: Partial<Record<GameKey, number>> = {
  '2048': 5_000_000,
  snake: 10_000_000,
  jump: 1_000_000,
  parkour: 5_000_000,
}

const MAX_TIME_MS = 24 * 60 * 60 * 1000
const MAX_DISTANCE = 100_000
const MAX_COINS = 1_000_000
const MAX_COMBO = 100_000
const MAX_COUNT = 1_000_000
const MAX_ABS_DELTA = 1_000_000

export interface GameStatCounters {
  games: number
  wins: number
  losses: number
  draws: number
  deaths: number
  scoreTotal: number
  bestScore: number
  bestTimeMs: number | null
  bestCombo: number
  bestCoins: number
  bestDistance: number
  totalJumps: number
  offsetSum: number
  offsetCount: number
}

export type GameStatDelta = Partial<GameStatCounters>

export const EMPTY_STAT: GameStatCounters = {
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  deaths: 0,
  scoreTotal: 0,
  bestScore: 0,
  bestTimeMs: null,
  bestCombo: 0,
  bestCoins: 0,
  bestDistance: 0,
  totalJumps: 0,
  offsetSum: 0,
  offsetCount: 0,
}

export interface SoloResultInput {
  game: string
  variant: string
  outcome?: GameOutcome
  score?: number
  scoreDelta?: number
  timeMs?: number
  distanceM?: number
  coins?: number
  maxCombo?: number
  jumps?: number
  offset?: number
  deaths?: number
}

export function isGameKey(value: unknown): value is GameKey {
  return typeof value === 'string' && (GAME_KEYS as readonly string[]).includes(value)
}

export function isSoloVariant(game: GameKey, variant: string): boolean {
  return SOLO_VARIANTS[game].includes(variant)
}

export function isKnownVariant(game: GameKey, variant: string): boolean {
  return GAME_VARIANTS[game].includes(variant)
}

export function outcomeRequired(game: GameKey): boolean {
  return OUTCOME_REQUIRED.includes(game)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeInt(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

/** 单机结果校验；返回错误文案，null 表示通过 */
export function validateSoloResult(input: SoloResultInput): string | null {
  if (!isGameKey(input.game)) return '未知的游戏'
  if (!isSoloVariant(input.game, input.variant)) return '无效的战绩模式'
  if (outcomeRequired(input.game) && !input.outcome) return '缺少胜负结果'
  if (input.outcome && !['win', 'loss', 'draw'].includes(input.outcome)) return '无效的胜负结果'

  const game = input.game
  if (input.score !== undefined) {
    if (!isNonNegativeInt(input.score)) return '分数必须是非负整数'
    const cap = SCORE_CAPS[game]
    if (cap !== undefined && input.score > cap) return '分数超出允许范围'
  }
  if (input.scoreDelta !== undefined) {
    if (game !== 'doudizhu') return '该游戏不接受积分变更'
    if (!isFiniteNumber(input.scoreDelta) || !Number.isInteger(input.scoreDelta)) return '积分必须是整数'
    if (Math.abs(input.scoreDelta) > MAX_ABS_DELTA) return '积分超出允许范围'
  }
  if (input.timeMs !== undefined) {
    if (game !== 'minesweeper') return '该游戏不接受用时'
    if (!isNonNegativeInt(input.timeMs) || input.timeMs > MAX_TIME_MS) return '用时超出允许范围'
  }
  if (input.distanceM !== undefined) {
    if (game !== 'parkour') return '该游戏不接受距离'
    if (!isNonNegativeNumber(input.distanceM) || input.distanceM > MAX_DISTANCE) return '距离超出允许范围'
  }
  if (input.coins !== undefined) {
    if (game !== 'parkour') return '该游戏不接受金币'
    if (!isNonNegativeInt(input.coins) || input.coins > MAX_COINS) return '金币超出允许范围'
  }
  if (input.maxCombo !== undefined) {
    if (game !== 'parkour' && game !== 'jump') return '该游戏不接受连击'
    if (!isNonNegativeInt(input.maxCombo) || input.maxCombo > MAX_COMBO) return '连击超出允许范围'
  }
  if (input.jumps !== undefined) {
    if (game !== 'jump') return '该游戏不接受跳跃数'
    if (!isNonNegativeInt(input.jumps) || input.jumps > MAX_COMBO) return '跳跃数超出允许范围'
  }
  if (input.offset !== undefined) {
    if (game !== 'jump') return '该游戏不接受落点偏差'
    if (!isNonNegativeNumber(input.offset) || input.offset > MAX_ABS_DELTA) return '落点偏差超出允许范围'
  }
  if (input.deaths !== undefined) {
    if (game !== 'liar') return '该游戏不接受死亡数'
    if (!isNonNegativeInt(input.deaths) || input.deaths > MAX_COUNT) return '死亡数超出允许范围'
  }
  return null
}

/** 把一次单机结果转成合并增量 */
export function buildSoloDelta(input: SoloResultInput): GameStatDelta {
  const delta: GameStatDelta = { games: 1 }
  if (input.outcome === 'win') delta.wins = 1
  else if (input.outcome === 'loss') delta.losses = 1
  else if (input.outcome === 'draw') delta.draws = 1

  if (input.score !== undefined) {
    delta.scoreTotal = input.score
    delta.bestScore = input.score
  }
  if (input.scoreDelta !== undefined) {
    delta.scoreTotal = (delta.scoreTotal ?? 0) + input.scoreDelta
  }
  if (input.timeMs !== undefined && input.outcome === 'win' && input.timeMs > 0) {
    delta.bestTimeMs = input.timeMs
  }
  if (input.distanceM !== undefined) delta.bestDistance = input.distanceM
  if (input.coins !== undefined) delta.bestCoins = input.coins
  if (input.maxCombo !== undefined) delta.bestCombo = input.maxCombo
  if (input.jumps !== undefined) delta.totalJumps = input.jumps
  if (input.offset !== undefined) {
    delta.offsetSum = Math.abs(input.offset)
    delta.offsetCount = 1
  }
  if (input.deaths !== undefined) delta.deaths = input.deaths
  return delta
}

/**
 * 合并计数器：
 * - 次数类（games/wins/losses/draws/deaths/totalJumps/offsetSum/offsetCount/scoreTotal）累加
 * - 最佳类（bestScore/bestCombo/bestCoins/bestDistance）取 max
 * - bestTimeMs 取 min（null 表示尚未产生）
 */
export function mergeCounters(
  prev: GameStatCounters | null,
  delta: GameStatDelta,
): GameStatCounters {
  const base = prev ?? EMPTY_STAT
  const merged: GameStatCounters = {
    games: base.games + (delta.games ?? 0),
    wins: base.wins + (delta.wins ?? 0),
    losses: base.losses + (delta.losses ?? 0),
    draws: base.draws + (delta.draws ?? 0),
    deaths: base.deaths + (delta.deaths ?? 0),
    scoreTotal: base.scoreTotal + (delta.scoreTotal ?? 0),
    bestScore: Math.max(base.bestScore, delta.bestScore ?? 0),
    bestTimeMs: delta.bestTimeMs == null
      ? base.bestTimeMs
      : (base.bestTimeMs == null ? delta.bestTimeMs : Math.min(base.bestTimeMs, delta.bestTimeMs)),
    bestCombo: Math.max(base.bestCombo, delta.bestCombo ?? 0),
    bestCoins: Math.max(base.bestCoins, delta.bestCoins ?? 0),
    bestDistance: Math.max(base.bestDistance, delta.bestDistance ?? 0),
    totalJumps: base.totalJumps + (delta.totalJumps ?? 0),
    offsetSum: base.offsetSum + (delta.offsetSum ?? 0),
    offsetCount: base.offsetCount + (delta.offsetCount ?? 0),
  }
  return merged
}

/** 导入记录（旧 localStorage 聚合值）校验与转换成增量；非法返回 null */
export function clampImportRecord(value: unknown): { game: GameKey; variant: string; delta: GameStatDelta } | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const game = row.game
  const variant = typeof row.variant === 'string' ? row.variant : 'solo'
  // 旧 localStorage 只有单机记录；联机战绩必须由服务端结算写入
  if (!isGameKey(game) || !isSoloVariant(game, variant)) return null

  const delta: GameStatDelta = {}
  const counters: Array<keyof Pick<GameStatCounters, 'games' | 'wins' | 'losses' | 'draws' | 'deaths' | 'totalJumps' | 'offsetCount'>> = [
    'games', 'wins', 'losses', 'draws', 'deaths', 'totalJumps', 'offsetCount',
  ]
  for (const key of counters) {
    const raw = row[key]
    if (raw === undefined || raw === null) continue
    if (!isNonNegativeInt(raw) || raw > MAX_COUNT) return null
    delta[key] = raw
  }

  if (row.scoreTotal !== undefined && row.scoreTotal !== null) {
    if (!isFiniteNumber(row.scoreTotal) || !Number.isInteger(row.scoreTotal) || Math.abs(row.scoreTotal) > 2_000_000_000) return null
    delta.scoreTotal = row.scoreTotal
  }
  if (row.bestScore !== undefined && row.bestScore !== null) {
    if (!isNonNegativeInt(row.bestScore) || row.bestScore > 10_000_000) return null
    delta.bestScore = row.bestScore
  }
  if (row.bestTimeMs !== undefined && row.bestTimeMs !== null) {
    if (!isNonNegativeInt(row.bestTimeMs) || row.bestTimeMs > MAX_TIME_MS) return null
    if (row.bestTimeMs > 0) delta.bestTimeMs = row.bestTimeMs
  }
  if (row.bestCombo !== undefined && row.bestCombo !== null) {
    if (!isNonNegativeInt(row.bestCombo) || row.bestCombo > MAX_COMBO) return null
    delta.bestCombo = row.bestCombo
  }
  if (row.bestCoins !== undefined && row.bestCoins !== null) {
    if (!isNonNegativeInt(row.bestCoins) || row.bestCoins > MAX_COINS) return null
    delta.bestCoins = row.bestCoins
  }
  if (row.bestDistance !== undefined && row.bestDistance !== null) {
    if (!isNonNegativeNumber(row.bestDistance) || row.bestDistance > MAX_DISTANCE) return null
    delta.bestDistance = row.bestDistance
  }
  if (row.offsetSum !== undefined && row.offsetSum !== null) {
    if (!isNonNegativeNumber(row.offsetSum) || row.offsetSum > MAX_ABS_DELTA * 10) return null
    delta.offsetSum = row.offsetSum
  }
  return { game, variant, delta }
}
