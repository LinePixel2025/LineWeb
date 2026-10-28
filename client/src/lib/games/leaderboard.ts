import type { LeaderboardEntry, LeaderboardResponse } from '../../types/gameStats'

export interface LeaderboardVariant {
  key: string
  label: string
  metricLabel: string
  unit: string
}

export interface LeaderboardGame {
  id: string
  name: string
  variants: LeaderboardVariant[]
}

const SCORE = (label = '最高分'): LeaderboardVariant[] => [
  { key: 'solo', label: '单机', metricLabel: label, unit: '分' },
  { key: 'online', label: '联机', metricLabel: label, unit: '分' },
]

const WINS = (): LeaderboardVariant[] => [
  { key: 'solo', label: '单机', metricLabel: '胜场', unit: '场' },
  { key: 'online', label: '联机', metricLabel: '胜场', unit: '场' },
]

export const LEADERBOARD_GAMES: LeaderboardGame[] = [
  { id: '2048', name: '2048', variants: SCORE() },
  { id: 'doudizhu', name: '斗地主', variants: [
    { key: 'solo', label: '单机', metricLabel: '累计积分', unit: '分' },
    { key: 'online', label: '联机', metricLabel: '累计积分', unit: '分' },
  ] },
  { id: 'snake', name: '贪吃蛇', variants: SCORE() },
  { id: 'minesweeper', name: '扫雷', variants: [
    { key: 'beginner', label: '简单', metricLabel: '最短用时', unit: '秒' },
    { key: 'intermediate', label: '中等', metricLabel: '最短用时', unit: '秒' },
    { key: 'expert', label: '困难', metricLabel: '最短用时', unit: '秒' },
    { key: 'online', label: '联机', metricLabel: '胜场', unit: '场' },
  ] },
  { id: 'jump', name: '跳一跳', variants: SCORE() },
  { id: 'gomoku', name: '五子棋', variants: WINS() },
  { id: 'liar', name: '骗子酒馆', variants: WINS() },
  { id: 'uno', name: 'UNO', variants: WINS() },
  { id: 'xiangqi', name: '中国象棋', variants: WINS() },
  { id: 'parkour', name: '霓虹跑酷', variants: [
    { key: 'solo', label: '单机', metricLabel: '最远距离', unit: 'm' },
    { key: 'online', label: '联机', metricLabel: '最远距离', unit: 'm' },
  ] },
]

export function leaderboardGame(game: string | null): LeaderboardGame {
  return LEADERBOARD_GAMES.find((item) => item.id === game) ?? LEADERBOARD_GAMES[0]
}

export function formatLeaderboardValue(value: number, unit: string): string {
  if (unit === '秒') {
    if (!Number.isFinite(value) || value <= 0) return '—'
    const totalSeconds = value / 1000
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds - minutes * 60
    return `${minutes}:${seconds < 10 ? '0' : ''}${seconds.toFixed(1)}`
  }
  if (unit === 'm') return `${Math.floor(value)} m`
  return `${Math.round(value).toLocaleString('zh-CN')}${unit ? ` ${unit}` : ''}`
}

export function entrySecondaryText(data: LeaderboardResponse, entry: LeaderboardEntry): string {
  if (data.metric === 'wins') {
    const rate = entry.secondary.games > 0
      ? Math.round((entry.secondary.wins / entry.secondary.games) * 100)
      : 0
    return `${entry.secondary.wins} 胜 / ${entry.secondary.games} 局 · 胜率 ${rate}%`
  }
  if (data.metric === 'bestTimeMs') {
    return `${entry.secondary.wins} 胜 / ${entry.secondary.games} 局`
  }
  if (data.metric === 'bestDistance') {
    return `最高分 ${Math.round(entry.secondary.bestScore).toLocaleString('zh-CN')} · ${entry.secondary.games} 局`
  }
  return `${entry.secondary.wins} 胜 / ${entry.secondary.games} 局`
}
