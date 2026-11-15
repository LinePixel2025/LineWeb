/**
 * 站内统一邀请信封（2026-11-15）。
 *
 * 宠物对决 / 搜打撤组队复用棋盘游戏的 `game:invite` / `game:invite:removed`
 * 事件名，由载荷里的 `game` 判别来源，客户端只维护一个全局邀请列表。
 * 这里只负责「发事件」，不持有任何状态，也不反向 import 两个业务服务。
 */

import { sendToUser } from './chatHub.js'

export type StandaloneInviteGame = 'petbattle' | 'raid'
export type InviteRemovalReason = 'accepted' | 'declined' | 'cancelled' | 'expired'

export interface StandaloneInviteEnvelope {
  id: number
  game: StandaloneInviteGame
  kind: 'match' | 'squad'
  /** 宠物对决的 battle id */
  matchId?: number
  /** 搜打撤队伍 id（字符串） */
  squadId?: string
  from: { id: number; username: string }
  to: { id: number; username: string }
  createdAt: string
  expiresAt: string
}

export function sendStandaloneInvite(targetUserId: number, invite: StandaloneInviteEnvelope): void {
  sendToUser(targetUserId, { type: 'game:invite', invite })
}

export function sendStandaloneInviteRemoved(
  userIds: readonly number[],
  inviteId: number,
  game: StandaloneInviteGame,
  reason: InviteRemovalReason,
): void {
  const unique = [...new Set(userIds)]
  for (const userId of unique) {
    sendToUser(userId, {
      type: 'game:invite:removed',
      inviteId,
      game,
      reason,
    })
  }
}