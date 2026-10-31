/**
 * 单机榜一传说称号的纯数据口径（无 prisma 依赖，可被多处引用）。
 */

import type { GameKey } from './gameStatsRules.js'
import { sanitizeTitleEffect, type TitleEffectStyle } from './pointsRules.js'

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
  /** 传说称号动态特效（classic/stardust/flame/aurora/thunder），缺省/非法回退 classic */
  effect: TitleEffectStyle
  awardedAt: string
}

export const LEADER_TITLE_COLOR = '#9a6700'
export const LEADER_TITLE_ICON = '👑'

export function leaderTitleName(game: string): string {
  const gameName = GAME_DISPLAY_NAMES[game as GameKey] ?? game
  return `${gameName}传说`
}

/**
 * 榜一称号 DTO。effect 只由管理员经 PATCH /api/admin/points/leader-titles/:id 设置；
 * 重算 upsert（gameLeaderTitleService）不写 effect 字段，故换人时不会覆盖特效。
 * row.effect 缺省（select 未取或历史行未初始化前的默认值兜底）/非法时回退 classic。
 */
export function leaderTitleDto(row: { id: number; game: string; awardedAt: Date; effect?: string }): LeaderTitleDto {
  return {
    id: row.id,
    game: row.game,
    gameName: GAME_DISPLAY_NAMES[row.game as GameKey] ?? row.game,
    name: leaderTitleName(row.game),
    color: LEADER_TITLE_COLOR,
    icon: LEADER_TITLE_ICON,
    rarity: 'legendary',
    effect: sanitizeTitleEffect(row.effect) ?? 'classic',
    awardedAt: row.awardedAt.toISOString(),
  }
}

/** 榜一奖励流水的说明文案（也用于当天去重匹配） */
export function leaderBonusNote(game: string): string {
  return `${GAME_DISPLAY_NAMES[game as GameKey] ?? game}单机榜首奖励`
}

/**
 * 把榜一传说称号转成通用站内称号形态（与积分商店的 UserTitleDto 结构兼容），
 * 用于聊天 / 农场 / 战绩榜等只关心「名字 + 颜色 + 图标 + 稀有度」的出口。
 */
export interface LeaderTitleAsTitleDto {
  id: number
  name: string
  color: string
  icon: string
  rarity: 'legendary'
  /** 传说称号动态特效，缺省/非法回退 classic（与 UserTitleDto.effect 口径一致） */
  effect: TitleEffectStyle
}

export function leaderTitleAsTitleDto(row: { id: number; game: string; effect?: string }): LeaderTitleAsTitleDto {
  return {
    id: row.id,
    name: leaderTitleName(row.game),
    color: LEADER_TITLE_COLOR,
    icon: LEADER_TITLE_ICON,
    rarity: 'legendary',
    effect: sanitizeTitleEffect(row.effect) ?? 'classic',
  }
}
