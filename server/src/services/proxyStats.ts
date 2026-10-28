import prisma from '../lib/prisma.js'

/**
 * 网页反代的访问统计
 *
 * 反代的一个页面会打出几十个子资源请求，如果每个请求都写库，SQLite/PostgreSQL
 * 会被打爆。因此这里做「内存累加 + 定时批量落库」：
 *   - 请求结束时只往内存 Map 里加 1（O(1)，无 IO）
 *   - 每 15 秒 flush 一次：按 (day, siteId) upsert 到 proxy_daily_stats，
 *     同时把站点累计计数 request_count / error_count 一起累加
 *   - 进程退出前再 flush 一次，尽量不丢数据
 *
 * day 以 Asia/Shanghai 计算，和 AI 对话每日额度的口径保持一致。
 */

const FLUSH_INTERVAL_MS = 15 * 1000
const MAX_PENDING_BUCKETS = 20_000

interface Bucket {
  day: string
  siteId: number
  userId: number
  requests: number
  errors: number
  lastStatusCode: number
  lastErrorAt: Date | null
}

const pending = new Map<string, Bucket>()
let timer: ReturnType<typeof setInterval> | null = null

/** Asia/Shanghai 的日期字符串 YYYY-MM-DD */
export function proxyStatDay(date: Date = new Date()): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return shifted.toISOString().slice(0, 10)
}

export interface ProxyRequestStat {
  siteId: number
  userId: number
  statusCode: number
}

/** 记录一次反代请求（同步、无 IO） */
export function recordProxyRequest(stat: ProxyRequestStat): void {
  const day = proxyStatDay()
  const key = `${day}:${stat.siteId}`
  const isError = stat.statusCode >= 400
  const bucket = pending.get(key)
  if (bucket) {
    bucket.requests += 1
    bucket.lastStatusCode = stat.statusCode
    if (isError) {
      bucket.errors += 1
      bucket.lastErrorAt = new Date()
    }
  } else {
    pending.set(key, {
      day,
      siteId: stat.siteId,
      userId: stat.userId,
      requests: 1,
      errors: isError ? 1 : 0,
      lastStatusCode: stat.statusCode,
      lastErrorAt: isError ? new Date() : null,
    })
  }
  if (pending.size >= MAX_PENDING_BUCKETS) void flushProxyStats()
}

/** 把内存计数写入数据库（幂等、可重入；失败只告警不抛出） */
export async function flushProxyStats(): Promise<void> {
  if (pending.size === 0) return
  const snapshot = [...pending.values()]
  pending.clear()
  for (const bucket of snapshot) {
    try {
      await prisma.proxyDailyStat.upsert({
        where: { day_siteId: { day: bucket.day, siteId: bucket.siteId } },
        create: {
          day: bucket.day,
          siteId: bucket.siteId,
          userId: bucket.userId,
          requests: bucket.requests,
          errors: bucket.errors,
        },
        update: {
          userId: bucket.userId,
          requests: { increment: bucket.requests },
          errors: { increment: bucket.errors },
        },
      })
      await prisma.proxySite.updateMany({
        where: { id: bucket.siteId },
        data: {
          requestCount: { increment: bucket.requests },
          errorCount: { increment: bucket.errors },
          lastStatusCode: bucket.lastStatusCode,
          ...(bucket.lastErrorAt ? { lastErrorAt: bucket.lastErrorAt } : {}),
        },
      })
    } catch (err) {
      // 站点在请求进行中被删除时会撞外键（P2003）：统计对该站点已无意义，直接丢弃，
      // 不重复刷日志（浏览器上一个页面会并行几十个请求，全部都会走到这里）。
      const code = (err as { code?: string }).code
      if (code === 'P2003') continue
      console.warn('[proxy] 统计落库失败：', err instanceof Error ? err.message : err)
    }
  }
}

/** 启动定时 flush（幂等；定时器 unref，不阻止进程退出） */
export function startProxyStatsFlusher(): void {
  if (timer) return
  timer = setInterval(() => void flushProxyStats(), FLUSH_INTERVAL_MS)
  timer.unref?.()
  process.once('SIGTERM', () => void flushProxyStats())
  process.once('SIGINT', () => void flushProxyStats())
}

/** 待落库的统计条数（健康检查 / 调试用） */
export function getProxyStatsPending(): number {
  return pending.size
}
