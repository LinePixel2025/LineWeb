/**
 * 游戏排行榜指标配置（服务端与客户端各一份拷贝，测试断言一致）。
 * 全站总榜；每个游戏/变体只按一个主指标排序，胜率由前端用 wins/games 计算展示。
 */

import { GAME_KEYS, GAME_VARIANTS, type GameKey } from './gameStatsRules.js'

export type LeaderboardMetricColumn =
  | 'bestScore'
  | 'bestTimeMs'
  | 'scoreTotal'
  | 'wins'
  | 'bestDistance'

export interface LeaderboardMetric {
  game: GameKey
  variant: string
  metric: LeaderboardMetricColumn
  order: 'asc' | 'desc'
  label: string
  unit: string
  /** 主指标为 0 时不进入榜单（例如只参与但没得分） */
  positiveOnly: boolean
}

const METRICS: LeaderboardMetric[] = []

function add(
  game: GameKey,
  variants: readonly string[],
  metric: LeaderboardMetricColumn,
  order: 'asc' | 'desc',
  label: string,
  unit: string,
  positiveOnly = true,
) {
  for (const variant of variants) {
    METRICS.push({ game, variant, metric, order, label, unit, positiveOnly })
  }
}

// 分数型
add('2048', ['solo', 'online'], 'bestScore', 'desc', '最高分', '分')
add('snake', ['solo', 'online'], 'bestScore', 'desc', '最高分', '分')
add('jump', ['solo', 'online'], 'bestScore', 'desc', '最高分', '分')
add('parkour', ['solo', 'online'], 'bestDistance', 'desc', '最远距离', 'm')
// 扫雷单机按最短用时，联机按胜场
add('minesweeper', ['beginner', 'intermediate', 'expert'], 'bestTimeMs', 'asc', '最短用时', '秒')
add('minesweeper', ['online'], 'wins', 'desc', '胜场', '场')
// 斗地主按累计积分
add('doudizhu', ['solo', 'online'], 'scoreTotal', 'desc', '累计积分', '分', false)
// 胜负型按胜场
for (const game of ['gomoku', 'liar', 'uno', 'xiangqi'] as const) {
  add(game, ['solo', 'online'], 'wins', 'desc', '胜场', '场')
}

const METRIC_BY_KEY = new Map(METRICS.map((item) => [`${item.game}:${item.variant}`, item]))

export function getLeaderboardMetric(game: string, variant: string): LeaderboardMetric | null {
  if (!(GAME_KEYS as readonly string[]).includes(game)) return null
  const key = `${game}:${variant}`
  const metric = METRIC_BY_KEY.get(key)
  if (!metric) return null
  if (!GAME_VARIANTS[game as GameKey].includes(variant)) return null
  return metric
}

export const LEADERBOARD_METRICS: readonly LeaderboardMetric[] = METRICS
