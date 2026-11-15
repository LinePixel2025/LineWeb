/**
 * 统一邀请的纯函数（2026-11-15）。
 *
 * 棋盘游戏、宠物对决、搜打撤组队共用 `game:invite` 事件与 GameInviteToast；
 * 客户端用 `game:id` 组合键去重，避免不同来源的自增 id 碰撞。
 */

import { getGameCatalogEntry } from './games/catalog'
import type { GameInvite, GameKind, InviteGameKind } from '../types/game'

export function inviteKey(invite: Pick<GameInvite, 'id' | 'game'>): string {
  return `${invite.game ?? '2048'}:${invite.id}`
}

export function inviteGameLabel(invite: Pick<GameInvite, 'game'> | null | undefined): string {
  const game = invite?.game ?? '2048'
  if (game === 'petbattle') return '宠物对决'
  if (game === 'raid') return '搜打撤组队'
  return getGameCatalogEntry(game as GameKind)?.name ?? '2048'
}

/** 接受邀请 / 对局开始后应该去的路由；数据不完整时返回 null */
export function invitePath(invite: Pick<GameInvite, 'game' | 'id' | 'matchId' | 'squadId'> | null | undefined): string | null {
  if (!invite) return null
  const game = invite.game ?? '2048'
  if (game === 'petbattle') {
    const battleId = invite.matchId ?? invite.id
    return battleId > 0 ? `/pets/battle/${battleId}` : null
  }
  if (game === 'raid') return '/pets/raid'
  if (typeof invite.matchId !== 'number' || invite.matchId <= 0) return null
  return `/games/${game}/online/${invite.matchId}`
}

/** 棋盘游戏的既有路由（GameContext 的 startedMatch 仍用这个） */
export function gameMatchPath(match: { game: GameKind; id: number }): string {
  return `/games/${match.game}/online/${match.id}`
}

export function isStandaloneGame(game: InviteGameKind | undefined): game is 'petbattle' | 'raid' {
  return game === 'petbattle' || game === 'raid'
}