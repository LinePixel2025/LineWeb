import type { LegacyStatRecord } from '../../types/gameStats'

/**
 * 旧版单机战绩的只读迁移器。
 * 只读取历史 localStorage 键，不再写入；迁移成功后由调用方清除这些键。
 * 保留 lineweb-mc-sp-v1（世界存档）与 lineweb.snake.versus（同屏双人本机战绩）。
 */

export const LEGACY_STAT_KEYS = [
  'lineweb_2048_best',
  'lineweb_ddz_record',
  'lineweb.snake.best',
  'lineweb.minesweeper.best.beginner',
  'lineweb.minesweeper.best.intermediate',
  'lineweb.minesweeper.best.expert',
  'lineweb.minesweeper.stats',
  'lineweb.jump.best',
  'lineweb.jump.stats',
  'lineweb.gomoku.stats',
  'lineweb.liar.stats',
  'lineweb.uno.stats',
  'lineweb.xiangqi.stats',
  'lineweb.parkour.best',
] as const

const MS_LEVELS = ['beginner', 'intermediate', 'expert'] as const
type MsLevel = typeof MS_LEVELS[number]

function readRaw(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function readNumber(key: string): number | null {
  const raw = readRaw(key)
  if (!raw) return null
  const value = Number.parseInt(raw, 10)
  return Number.isFinite(value) && value >= 0 ? value : null
}

function readJson<T>(key: string): T | null {
  const raw = readRaw(key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as T : null
  } catch {
    return null
  }
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export interface LegacyStatsBundle {
  records: LegacyStatRecord[]
  keys: string[]
}

export function collectLegacyStats(): LegacyStatsBundle {
  const records: LegacyStatRecord[] = []
  const keys: string[] = []

  for (const key of LEGACY_STAT_KEYS) {
    if (readRaw(key) !== null) keys.push(key)
  }

  const best2048 = readNumber('lineweb_2048_best')
  if (best2048 && best2048 > 0) {
    records.push({ game: '2048', variant: 'solo', bestScore: best2048 })
  }

  const ddz = readJson<{ games?: unknown; wins?: unknown; score?: unknown }>('lineweb_ddz_record')
  if (ddz) {
    records.push({
      game: 'doudizhu',
      variant: 'solo',
      games: num(ddz.games),
      wins: num(ddz.wins),
      scoreTotal: num(ddz.score),
    })
  }

  const snakeBest = readNumber('lineweb.snake.best')
  if (snakeBest && snakeBest > 0) {
    records.push({ game: 'snake', variant: 'solo', bestScore: snakeBest })
  }

  const msStats = readJson<{
    wins?: Partial<Record<MsLevel, unknown>>
    losses?: Partial<Record<MsLevel, unknown>>
  }>('lineweb.minesweeper.stats')
  for (const level of MS_LEVELS) {
    const best = readNumber(`lineweb.minesweeper.best.${level}`)
    const wins = num(msStats?.wins?.[level]) ?? 0
    const losses = num(msStats?.losses?.[level]) ?? 0
    if ((best && best > 0) || wins > 0 || losses > 0) {
      records.push({
        game: 'minesweeper',
        variant: level,
        games: wins + losses,
        wins,
        losses,
        bestTimeMs: best && best > 0 ? best : undefined,
      })
    }
  }

  const jumpBest = readNumber('lineweb.jump.best')
  const jumpStats = readJson<{
    runs?: unknown; totalScore?: unknown; totalJumps?: unknown; bestCombo?: unknown
    offsetSum?: unknown; offsetCount?: unknown
  }>('lineweb.jump.stats')
  if ((jumpBest && jumpBest > 0) || jumpStats) {
    records.push({
      game: 'jump',
      variant: 'solo',
      games: num(jumpStats?.runs),
      scoreTotal: num(jumpStats?.totalScore),
      bestScore: jumpBest && jumpBest > 0 ? jumpBest : undefined,
      totalJumps: num(jumpStats?.totalJumps),
      bestCombo: num(jumpStats?.bestCombo),
      offsetSum: num(jumpStats?.offsetSum),
      offsetCount: num(jumpStats?.offsetCount),
    })
  }

  const gomoku = readJson<{ wins?: unknown; losses?: unknown; draws?: unknown }>('lineweb.gomoku.stats')
  if (gomoku) {
    const wins = num(gomoku.wins) ?? 0
    const losses = num(gomoku.losses) ?? 0
    const draws = num(gomoku.draws) ?? 0
    records.push({ game: 'gomoku', variant: 'solo', games: wins + losses + draws, wins, losses, draws })
  }

  const liar = readJson<{ games?: unknown; wins?: unknown; deaths?: unknown }>('lineweb.liar.stats')
  if (liar) {
    records.push({
      game: 'liar',
      variant: 'solo',
      games: num(liar.games),
      wins: num(liar.wins),
      deaths: num(liar.deaths),
    })
  }

  const uno = readJson<{ games?: unknown; wins?: unknown }>('lineweb.uno.stats')
  if (uno) {
    records.push({ game: 'uno', variant: 'solo', games: num(uno.games), wins: num(uno.wins) })
  }

  const xiangqi = readJson<{ games?: unknown; wins?: unknown; losses?: unknown; draws?: unknown }>('lineweb.xiangqi.stats')
  if (xiangqi) {
    records.push({
      game: 'xiangqi',
      variant: 'solo',
      games: num(xiangqi.games),
      wins: num(xiangqi.wins),
      losses: num(xiangqi.losses),
      draws: num(xiangqi.draws),
    })
  }

  const parkour = readJson<{
    distanceM?: unknown; coins?: unknown; score?: unknown; maxCombo?: unknown; runs?: unknown
  }>('lineweb.parkour.best')
  if (parkour) {
    records.push({
      game: 'parkour',
      variant: 'solo',
      games: num(parkour.runs),
      bestDistance: num(parkour.distanceM),
      bestCoins: num(parkour.coins),
      bestScore: num(parkour.score),
      bestCombo: num(parkour.maxCombo),
    })
  }

  return { records: records.filter((record) => Object.keys(record).length > 2), keys }
}

export function clearLegacyStats(keys: string[]): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(key)
    } catch {
      // 隐私模式下清理失败不影响已上云的记录
    }
  }
}
