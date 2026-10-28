import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { requireCapability } from '../middleware/auth.js'
import { getProxyQueueStats } from '../services/proxyQueue.js'
import { getProxyStatsPending, flushProxyStats, proxyStatDay } from '../services/proxyStats.js'
import {
  addProxyBlacklistEntry,
  listProxyBlacklist,
  normalizeBlacklistPattern,
  refreshProxyBlacklist,
  removeProxyBlacklistEntry,
} from '../services/proxyBlacklist.js'

/**
 * 网页反代管理（/api/proxy/admin/*）
 *
 * 只对具备 `proxy:manage` 能力的账号开放（当前即管理员），提供三块能力：
 *   1. 反代黑名单：命中后禁止新建站点与转发请求（HTTP / 媒体 / WebSocket 全覆盖）
 *   2. 访问统计与排名：按站点 / 按天聚合，站点累计访问与错误数
 *   3. 排队赦免：白名单账号不受反代并发闸门限制（管理员本身已天然豁免）
 *
 * 说明：统计是「内存累加 + 15 秒批量落库」，所以这里读到的数据最多滞后十几秒；
 * GET /stats 会先 flush 一次，保证管理端看到的是最新数字。
 */

export const proxyAdminRouter = Router()

proxyAdminRouter.use(requireCapability('proxy:manage'))

/** 管理端总览：闸门状态 + 全局累计 */
proxyAdminRouter.get('/overview', asyncHandler(async (_req, res) => {
  const [siteAgg, userCount, exemptCount, blacklistCount] = await Promise.all([
    prisma.proxySite.aggregate({ _sum: { requestCount: true, errorCount: true }, _count: { _all: true } }),
    prisma.user.count({ where: { proxySites: { some: {} } } }),
    prisma.user.count({ where: { proxyQueueExempt: true } }),
    prisma.proxyBlacklist.count(),
  ])
  res.json({
    queue: getProxyQueueStats(),
    statsPending: getProxyStatsPending(),
    totals: {
      sites: siteAgg._count._all,
      users: userCount,
      requests: siteAgg._sum.requestCount ?? 0,
      errors: siteAgg._sum.errorCount ?? 0,
      exemptUsers: exemptCount,
      blacklistEntries: blacklistCount,
    },
  })
}))

// ============================================================
// 黑名单
// ============================================================

proxyAdminRouter.get('/blacklist', asyncHandler(async (_req, res) => {
  const entries = await listProxyBlacklist()
  res.json({
    entries: entries.map((entry) => ({
      id: entry.id,
      pattern: entry.pattern,
      reason: entry.reason,
      createdById: entry.createdById,
      createdAt: entry.createdAt,
    })),
  })
}))

const blacklistCreateSchema = z.object({
  pattern: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(200).optional(),
})

proxyAdminRouter.post('/blacklist', asyncHandler(async (req, res) => {
  const parsed = blacklistCreateSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || '参数不正确' })
    return
  }
  let pattern: string
  try {
    pattern = normalizeBlacklistPattern(parsed.data.pattern)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : '域名格式不正确' })
    return
  }
  const exists = await prisma.proxyBlacklist.findUnique({ where: { pattern } })
  if (exists) {
    res.status(409).json({ error: `${pattern} 已经在黑名单里了` })
    return
  }
  const entry = await addProxyBlacklistEntry({
    pattern,
    reason: parsed.data.reason,
    createdById: req.user?.userId,
  })
  res.status(201).json({
    entry: { id: entry.id, pattern: entry.pattern, reason: entry.reason, createdById: entry.createdById, createdAt: entry.createdAt },
  })
}))

proxyAdminRouter.delete('/blacklist/:id', asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '条目不存在' })
    return
  }
  const removed = await removeProxyBlacklistEntry(id)
  if (!removed) {
    res.status(404).json({ error: '条目不存在' })
    return
  }
  res.status(204).end()
}))

/** 强制刷新缓存（改过数据库或怀疑缓存过期时用） */
proxyAdminRouter.post('/blacklist/refresh', asyncHandler(async (_req, res) => {
  await refreshProxyBlacklist()
  res.json({ ok: true })
}))

// ============================================================
// 访问统计 / 排名
// ============================================================

proxyAdminRouter.get('/stats', asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(1, Number.parseInt(String(req.query.days ?? '7'), 10) || 7))
  // 先把内存里的计数落库，避免管理端看到滞后的数字
  await flushProxyStats()

  const from = proxyStatDay(new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000))

  const [siteGroups, userGroups, dailyGroups] = await Promise.all([
    prisma.proxyDailyStat.groupBy({
      by: ['siteId'],
      where: { day: { gte: from } },
      _sum: { requests: true, errors: true },
      orderBy: { _sum: { requests: 'desc' } },
      take: 50,
    }),
    prisma.proxyDailyStat.groupBy({
      by: ['userId'],
      where: { day: { gte: from } },
      _sum: { requests: true, errors: true },
      orderBy: { _sum: { requests: 'desc' } },
      take: 50,
    }),
    prisma.proxyDailyStat.groupBy({
      by: ['day'],
      where: { day: { gte: from } },
      _sum: { requests: true, errors: true },
      orderBy: { day: 'asc' },
    }),
  ])

  const siteIds = siteGroups.map((group) => group.siteId)

  const sites = siteIds.length
    ? await prisma.proxySite.findMany({
      where: { id: { in: siteIds } },
      select: {
        id: true,
        name: true,
        origin: true,
        userId: true,
        requestCount: true,
        errorCount: true,
        lastVisitedAt: true,
        lastStatusCode: true,
        lastErrorAt: true,
      },
    })
    : []

  const userIds = [...new Set([
    ...userGroups.map((group) => group.userId),
    ...sites.map((site) => site.userId),
  ])]
  const users = userIds.length
    ? await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, role: true, proxyQueueExempt: true },
    })
    : []

  const userMap = new Map(users.map((user) => [user.id, user]))
  const siteMap = new Map(sites.map((site) => [site.id, site]))

  const siteRanking = siteGroups.map((group) => {
    const site = siteMap.get(group.siteId)
    const owner = site ? userMap.get(site.userId) : undefined
    return {
      siteId: group.siteId,
      name: site?.name ?? '已删除站点',
      origin: site?.origin ?? '',
      ownerId: site?.userId ?? null,
      ownerName: owner?.username ?? '未知',
      requests: group._sum.requests ?? 0,
      errors: group._sum.errors ?? 0,
      totalRequests: site?.requestCount ?? 0,
      totalErrors: site?.errorCount ?? 0,
      lastVisitedAt: site?.lastVisitedAt ?? null,
      lastStatusCode: site?.lastStatusCode ?? null,
      lastErrorAt: site?.lastErrorAt ?? null,
    }
  })

  const userRanking = userGroups.map((group) => {
    const user = userMap.get(group.userId)
    return {
      userId: group.userId,
      username: user?.username ?? '未知用户',
      role: user?.role ?? 'user',
      exempt: user?.proxyQueueExempt ?? false,
      requests: group._sum.requests ?? 0,
      errors: group._sum.errors ?? 0,
    }
  })

  res.json({
    days,
    from,
    to: proxyStatDay(),
    sites: siteRanking,
    users: userRanking,
    daily: dailyGroups.map((group) => ({
      day: group.day,
      requests: group._sum.requests ?? 0,
      errors: group._sum.errors ?? 0,
    })),
  })
}))

// ============================================================
// 排队赦免
// ============================================================

/** 用户检索（用于排队赦免管理）：按用户名 / 邮箱模糊搜索 */
proxyAdminRouter.get('/users', asyncHandler(async (req, res) => {
  const q = String(req.query.q ?? '').trim()
  const users = await prisma.user.findMany({
    where: q
      ? { OR: [{ username: { contains: q } }, { email: { contains: q } }] }
      : undefined,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      proxyQueueExempt: true,
      _count: { select: { proxySites: true } },
    },
    orderBy: [{ proxyQueueExempt: 'desc' }, { id: 'asc' }],
    take: 100,
  })
  res.json({
    users: users.map((user) => ({
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      exempt: user.proxyQueueExempt,
      siteCount: user._count.proxySites,
    })),
  })
}))

const exemptionSchema = z.object({ exempt: z.boolean() })

proxyAdminRouter.put('/users/:id/exemption', asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: '用户不存在' })
    return
  }
  const parsed = exemptionSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: '参数不正确' })
    return
  }
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, role: true } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }
  const updated = await prisma.user.update({
    where: { id },
    data: { proxyQueueExempt: parsed.data.exempt },
    select: { id: true, username: true, role: true, proxyQueueExempt: true },
  })
  res.json({
    user: {
      id: updated.id,
      username: updated.username,
      role: updated.role,
      exempt: updated.proxyQueueExempt,
    },
  })
}))
