import type { GameOutcome } from '../lib/gameStatsRules.js'

/**
 * 联机结算回调（纯内存，禁止 import prisma）。
 *
 * 游戏服务在 finish* 里只调用 publishGameEnd；真正的 Prisma 写入由
 * routes/games.ts 在启动时注册 listener 完成。这样 verify:* 脚本直接
 * import 游戏服务时不会把数据库带进纯内存测试。
 */

export interface GameEndPlayerResult {
  userId: number
  outcome: GameOutcome
  score?: number
  scoreDelta?: number
  timeMs?: number
  distanceM?: number
  coins?: number
  maxCombo?: number
}

export interface GameEndResult {
  game: string
  matchId: number
  reason: string
  results: GameEndPlayerResult[]
}

type Listener = (result: GameEndResult) => void

let listener: Listener | null = null
const handled = new Set<string>()

/** 无胜负意义的早退结算不记战绩 */
const SKIP_REASONS = new Set(['cancelled', 'abandoned', 'disbanded', 'dissolved'])

export function setGameResultListener(fn: Listener | null): void {
  listener = fn
}

export function publishGameEnd(result: GameEndResult): void {
  if (SKIP_REASONS.has(result.reason)) return
  if (result.results.length === 0) return
  const key = `${result.game}:${result.matchId}`
  if (handled.has(key)) return
  handled.add(key)
  // 防止极端长跑进程无限增长；纯内存去重只服务于一次进程生命周期
  if (handled.size > 5000) handled.clear()
  try {
    listener?.(result)
  } catch (err) {
    console.warn('[gameStats] 联机战绩回调失败：', err instanceof Error ? err.message : err)
  }
}

/** 仅测试用：重置去重表 */
export function resetGameStatsDedupForTest(): void {
  handled.clear()
}
