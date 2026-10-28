export type GameKey =
  | '2048'
  | 'doudizhu'
  | 'snake'
  | 'minesweeper'
  | 'jump'
  | 'gomoku'
  | 'liar'
  | 'uno'
  | 'xiangqi'
  | 'parkour'

export type GameOutcome = 'win' | 'loss' | 'draw'

export interface GameStatDto {
  id?: number
  userId?: number
  game: string
  variant: string
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
  updatedAt?: string
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

export interface LegacyStatRecord {
  game: string
  variant: string
  games?: number
  wins?: number
  losses?: number
  draws?: number
  deaths?: number
  scoreTotal?: number
  bestScore?: number
  bestTimeMs?: number
  bestCombo?: number
  bestCoins?: number
  bestDistance?: number
  totalJumps?: number
  offsetSum?: number
  offsetCount?: number
}

export interface LeaderboardEntry {
  rank: number
  userId: number
  username: string
  value: number
  secondary: {
    games: number
    wins: number
    losses: number
    draws: number
    scoreTotal: number
    bestScore: number
    bestTimeMs: number | null
    bestDistance: number
  }
  isMe: boolean
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  me: LeaderboardEntry | null
  total: number
  game: string
  variant: string
  metric: string
  label: string
  unit: string
}
