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
/**
 * 「无胜负意义的早退」监听（门票退票通道）。
 * 与 result 监听一样是纯内存回调，具体做什么由 routes/games.ts 注册；
 * verify:* 脚本不注册，保持纯内存。
 */
let abortListener: Listener | null = null
const handled = new Set<string>()
const handledAborts = new Set<string>()

/** 无胜负意义的早退结算不记战绩 */
const SKIP_REASONS = new Set(['cancelled', 'abandoned', 'disbanded', 'dissolved'])

export function setGameResultListener(fn: Listener | null): void {
  listener = fn
}

/** 注册早退监听；传 null 注销（重复注册直接覆盖，回调本身必须写成幂等） */
export function setGameAbortListener(fn: Listener | null): void {
  abortListener = fn
}

/**
 * 早退通知：门票侧需要知道「这场根本没开局」，好把扣掉的票退回。
 * 语义与战绩完全隔离 —— 不写战绩、不发胜负积分，纯内存去重只服务于一次进程生命周期，
 * 跨重启的幂等由 GameTicketLog.dedupKey 兜住，所以重复调用是安全的。
 */
function notifyGameAbort(result: GameEndResult): void {
  const key = `${result.game}:${result.matchId}`
  if (handledAborts.has(key)) return
  handledAborts.add(key)
  if (handledAborts.size > 5000) handledAborts.clear()
  try {
    abortListener?.(result)
  } catch (err) {
    console.warn('[gameStats] 联机早退回调失败：', err instanceof Error ? err.message : err)
  }
}

export function publishGameEnd(result: GameEndResult): void {
  // 注意顺序：早退要在「results 为空」判定之前通知 —— 等待房间解散时 results
  // 仍然是全部在座玩家（各 finish* 都按 players 数组发），但为空也不能漏掉退票。
  if (SKIP_REASONS.has(result.reason)) {
    notifyGameAbort(result)
    return
  }
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

/** 仅测试用：重置去重表（战绩与早退两条通道一起清） */
export function resetGameStatsDedupForTest(): void {
  handled.clear()
  handledAborts.clear()
}
