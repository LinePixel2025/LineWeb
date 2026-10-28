/**
 * 游戏「退出房间 / 强制清除联机状态」的共享实现
 *
 * 各游戏服务都是内存态（matches: Map<id, state>），「我还在不在房间里」的判定
 * 统一为：对局未结束，且我在对局里的玩家状态仍是 waiting / playing。
 * 因此认输、出局、掉线判负之后，玩家会自动从 active 查询里消失，不会再把
 * 大厅/邀请卡死在「你正在对局中」。
 *
 * 强制清除联机状态（`POST /api/games/force-reset`）按下面的口径逐房间处理：
 *   - 等待房间：走各服务的 leave（房主 = 解散，普通玩家 = 移出）；
 *   - 进行中且我仍在场：走各服务的 resign（认输/DNF/淘汰，由各游戏自己结算）；
 *   - 其余（已结束 / 我已出局）：无需处理，active 查询本就不会再返回它。
 * 任何一步失败都不影响其它房间（返回本次清理的房间数）。
 */

/** 各游戏服务对局状态的最小形状（players 的 status 为 'waiting'|'playing'|'won'|'lost' 等） */
export interface ExitableMatch {
  id: number
  status: string
  players: Array<{ userId: number; status?: string }>
}

export interface ResetMatchActions {
  /** 离开等待房间（房主 = 解散房间） */
  leave: (userId: number, matchId: number) => unknown
  /** 认输 / 中途退出（各游戏的结算口径不同） */
  resign: (userId: number, matchId: number) => unknown
}

/**
 * 清除某用户在指定游戏里的房间 / 对局状态。
 *
 * @returns 实际处理过的房间数（便于前端提示「已清理 N 个房间」）
 */
export function resetUserInMatches<S extends ExitableMatch>(
  matches: Iterable<S>,
  userId: number,
  actions: ResetMatchActions,
): number {
  let cleared = 0
  for (const match of Array.from(matches)) {
    const me = match.players.find((player) => player.userId === userId)
    if (!me) continue

    if (match.status === 'waiting') {
      try {
        actions.leave(userId, match.id)
        cleared += 1
      } catch {
        // 已被 sweeper 结算 / 并发离开：忽略
      }
      continue
    }

    if (match.status === 'playing' && me.status === 'playing') {
      try {
        actions.resign(userId, match.id)
        cleared += 1
      } catch {
        // 结算竞态（时间到 / 已出局）：忽略
      }
      continue
    }

    // 对局已结束或本人已出局：active 查询不会再返回该房间，无需改写对局
    cleared += 1
  }
  return cleared
}
