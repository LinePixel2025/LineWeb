import { config } from '../config/index.js'

/**
 * 网页反代的并发闸门（排队机制）
 *
 * 背景：`/proxy/*` 会把浏览器的每个子资源（HTML / JS / CSS / 图片 / 视频分片）
 * 转发到上游站点。一个打开的页面瞬间会产生几十个并发请求，几个人同时用就可能
 * 把 Node 进程的句柄/内存打满（上游慢时尤其明显）。
 *
 * 这里用一个进程内信号量限制「同时进行中的反代请求数」：
 *   - 未达上限：直接放行；
 *   - 已达上限：进入 FIFO 队列等待（上限 PROXY_QUEUE_LIMIT）；
 *   - 队列也满 / 等待超时：返回 503（调用方渲染排队页，可重试）。
 *
 * 管理员（role === 'admin'）完全绕过闸门：既不排队，也不计入并发
 * —— 运维排障时不会被自己触发的请求堵住。
 *
 * 约束：只在单进程内有效。多实例部署时每个实例各有一份配额。
 */

export class ProxyQueueError extends Error {
  readonly reason: 'full' | 'timeout'

  constructor(reason: 'full' | 'timeout') {
    super(reason === 'full' ? '反代队列已满' : '反代排队超时')
    this.name = 'ProxyQueueError'
    this.reason = reason
  }
}

interface Waiter {
  grant: () => void
  timer: ReturnType<typeof setTimeout>
}

/** 当前进行中的反代请求数（不含管理员） */
let activeCount = 0
/** 等待中的请求（FIFO） */
const waiters: Waiter[] = []
/** 本轮排队等待的总时长（毫秒），用于日志观察 */
let lastWaitMs = 0

/** 归还释放函数（重复调用安全） */
function makeReleaser(): () => void {
  let released = false
  return () => {
    if (released) return
    released = true
    if (activeCount > 0) activeCount -= 1
    const next = waiters.shift()
    if (next) {
      clearTimeout(next.timer)
      activeCount += 1
      next.grant()
    }
  }
}

export interface AcquireProxySlotOptions {
  /** 管理员：不计入并发、不排队 */
  bypass?: boolean
}

/**
 * 申请一个反代并发槽位。
 *
 * @returns 释放函数（响应结束 / 连接关闭时必须调用）
 * @throws ProxyQueueError 队列已满（full）或等待超时（timeout）
 */
export function acquireProxySlot(options: AcquireProxySlotOptions = {}): Promise<() => void> {
  if (options.bypass) return Promise.resolve(() => {})

  if (activeCount < config.proxyMaxConcurrent) {
    activeCount += 1
    return Promise.resolve(makeReleaser())
  }

  if (waiters.length >= config.proxyQueueLimit) {
    return Promise.reject(new ProxyQueueError('full'))
  }

  const startedAt = Date.now()
  return new Promise<() => void>((resolve, reject) => {
    const waiter: Waiter = {
      grant: () => {
        lastWaitMs = Date.now() - startedAt
        resolve(makeReleaser())
      },
      timer: setTimeout(() => {
        const index = waiters.indexOf(waiter)
        if (index >= 0) waiters.splice(index, 1)
        reject(new ProxyQueueError('timeout'))
      }, config.proxyQueueTimeoutMs),
    }
    waiter.timer.unref?.()
    waiters.push(waiter)
  })
}

/** 当前闸门状态（调试 / 健康检查用） */
export function getProxyQueueStats(): {
  active: number
  queued: number
  maxConcurrent: number
  queueLimit: number
  timeoutMs: number
  lastWaitMs: number
} {
  return {
    active: activeCount,
    queued: waiters.length,
    maxConcurrent: config.proxyMaxConcurrent,
    queueLimit: config.proxyQueueLimit,
    timeoutMs: config.proxyQueueTimeoutMs,
    lastWaitMs,
  }
}

// === WebSocket 中继的并发上限（连接数，不是请求数） ===

let wsActive = 0

/** 申请一个反代 WebSocket 连接名额；管理员不占名额 */
export function acquireProxyWsSlot(options: AcquireProxySlotOptions = {}): (() => void) | null {
  if (options.bypass) return () => {}
  if (wsActive >= config.proxyWsMaxConnections) return null
  wsActive += 1
  let released = false
  return () => {
    if (released) return
    released = true
    if (wsActive > 0) wsActive -= 1
  }
}

/** 当前反代 WebSocket 连接数 */
export function getProxyWsStats(): { active: number; max: number } {
  return { active: wsActive, max: config.proxyWsMaxConnections }
}
