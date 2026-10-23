/**
 * 游戏在线状态（presence）—— 纯 TTL 内存映射
 *
 * 用途：WebSocket 不可用（被阻断 / 企业网络 / 强制轮询降级）时，客户端每 20 秒
 * 调用 `POST /api/games/2048/presence` 上报心跳，服务端记录最后一次心跳时间，
 * 90 秒内视为「游戏在线」。游戏的在线判定统一为：
 *
 *   isGameUserAvailable(userId) = chatHub.isUserOnline(userId) || isGamePresent(userId)
 *
 * 本模块只负责 TTL 判定，不依赖 HTTP / WebSocket / 数据库，可被脚本直接单测。
 * 所有函数都接受显式 `now`（毫秒时间戳）参数，便于验证 TTL 边界。
 */

/** presence 有效期：90 秒（客户端心跳间隔 20 秒，容忍后台标签页节流） */
export const GAME_PRESENCE_TTL_MS = 90_000

/** userId → 最后一次收到 presence 心跳的时间（毫秒时间戳） */
const presenceTimes = new Map<number, number>()

/**
 * 记录一次 presence 心跳。
 * @returns 本次记录的时间戳
 */
export function markGamePresence(userId: number, now: number = Date.now()): number {
  presenceTimes.set(userId, now)
  return now
}

/** 该用户是否处于 presence 有效期内（含恰好到达 TTL 边界时已过期） */
export function isGamePresent(userId: number, now: number = Date.now()): boolean {
  const lastSeen = presenceTimes.get(userId)
  if (lastSeen === undefined) return false
  return now - lastSeen < GAME_PRESENCE_TTL_MS
}

/** 距离上一次 presence 心跳的毫秒数；从未上报过返回 null */
export function getGamePresenceAge(userId: number, now: number = Date.now()): number | null {
  const lastSeen = presenceTimes.get(userId)
  if (lastSeen === undefined) return null
  return now - lastSeen
}

/** 清除某用户的 presence（登出 / 主动离开游戏时可选调用） */
export function clearGamePresence(userId: number): void {
  presenceTimes.delete(userId)
}

/** 清理所有已过期的 presence 记录，返回清理条数（由游戏 sweeper 定期调用） */
export function pruneGamePresence(now: number = Date.now()): number {
  let removed = 0
  for (const [userId, lastSeen] of presenceTimes) {
    if (now - lastSeen >= GAME_PRESENCE_TTL_MS) {
      presenceTimes.delete(userId)
      removed += 1
    }
  }
  return removed
}

/** 当前所有 presence 有效的用户 id（便于调试 / 冒烟验证） */
export function getGamePresentUserIds(now: number = Date.now()): number[] {
  const result: number[] = []
  for (const [userId, lastSeen] of presenceTimes) {
    if (now - lastSeen < GAME_PRESENCE_TTL_MS) result.push(userId)
  }
  return result
}
