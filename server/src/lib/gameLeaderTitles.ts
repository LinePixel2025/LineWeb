/**
 * 单机榜一传说称号的纯数据口径（无 prisma 依赖，可被多处引用）。
 */

import type { GameKey } from './gameStatsRules.js'

/** 游戏展示名（与客户端游戏大厅保持一致） */
export const GAME_DISPLAY_NAMES: Record<GameKey, string> = {
  '2048': '2048',
  doudizhu: '斗地主',
  snake: '贪吃蛇',
  minesweeper: '扫雷',
  jump: '跳一跳',
  gomoku: '五子棋',
  liar: '骗子酒馆',
  uno: 'UNO',
  xiangqi: '中国象棋',
  parkour: '霓虹跑酷',
}

export interface LeaderTitleDto {
  id: number
  game: string
  gameName: string
  name: string
  color: string
  icon: string
  rarity: 'legendary'
  awardedAt: string
}

export const LEADER_TITLE_COLOR = '#9a6700'
export const LEADER_TITLE_ICON = '👑'

export function leaderTitleName(game: string): string {
  const gameName = GAME_DISPLAY_NAMES[game as GameKey] ?? game
  return `${gameName}传说`
}

export function leaderTitleDto(row: { id: number; game: string; awardedAt: Date }): LeaderTitleDto {
  return {
    id: row.id,
    game: row.game,
    gameName: GAME_DISPLAY_NAMES[row.game as GameKey] ?? row.game,
    name: leaderTitleName(row.game),
    color: LEADER_TITLE_COLOR,
    icon: LEADER_TITLE_ICON,
    rarity: 'legendary',
    awardedAt: row.awardedAt.toISOString(),
  }
}

/** 榜一奖励流水的说明文案（也用于当天去重匹配） */
export function leaderBonusNote(game: string): string {
  return `${GAME_DISPLAY_NAMES[game as GameKey] ?? game}单机榜首奖励`
}
