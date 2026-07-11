import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = Router()

// === 60s 内存缓存 — 避免每次打开 dashboard 触发 11 个并发查询 ===
const STATS_CACHE_TTL_MS = 60 * 1000
let statsCache: { key: string; data: unknown; expireAt: number } | null = null

async function computeStats() {
  const [
    totalPosts,
    publishedPosts,
    totalUsers,
    adminUsers,
    totalComments,
    totalPages,
    publishedPages,
    featuredPages,
    totalDriveFiles,
    totalDriveFolders,
    driveSizeResult,
  ] = await Promise.all([
    prisma.post.count(),
    prisma.post.count({ where: { published: true } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.comment.count(),
    prisma.page.count(),
    prisma.page.count({ where: { published: true } }),
    prisma.page.count({ where: { featured: true } }),
    prisma.driveFile.count({ where: { isFolder: false } }),
    prisma.driveFile.count({ where: { isFolder: true } }),
    prisma.driveFile.aggregate({ _sum: { size: true }, where: { isFolder: false } }),
  ])

  return {
    posts: { total: totalPosts, published: publishedPosts, draft: totalPosts - publishedPosts },
    users: { total: totalUsers, admins: adminUsers },
    comments: { total: totalComments },
    pages: { total: totalPages, published: publishedPages, featured: featuredPages },
    drive: {
      files: totalDriveFiles,
      folders: totalDriveFolders,
      totalSizeBytes: driveSizeResult._sum.size?.toString() || '0',
    },
  }
}

/* ---------- Dashboard 统计汇总（需要管理员权限） ---------- */
router.get('/', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'admin_stats'
    const now = Date.now()

    // 命中缓存直接返回
    if (statsCache && statsCache.key === cacheKey && now < statsCache.expireAt) {
      res.setHeader('Cache-Control', 'private, max-age=60')
      res.json(statsCache.data)
      return
    }

    const data = await computeStats()
    statsCache = { key: cacheKey, data, expireAt: now + STATS_CACHE_TTL_MS }

    res.setHeader('Cache-Control', 'private, max-age=60')
    res.json(data)
  } catch (err) {
    console.error('获取统计数据失败:', err)
    res.status(500).json({ error: '获取统计数据失败' })
  }
})

/* ---------- 公开统计端点（无需认证） ---------- */
router.get('/public', async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'public_stats'
    const now = Date.now()

    // 检查缓存
    if (statsCache && statsCache.key === cacheKey && now < statsCache.expireAt) {
      res.setHeader('Cache-Control', 'public, max-age=300')
      res.json(statsCache.data)
      return
    }

    const [totalPosts, totalUsers, totalComments, totalPages] = await Promise.all([
      prisma.post.count(),
      prisma.user.count(),
      prisma.comment.count(),
      prisma.page.count(),
    ])

    const data = {
      posts: totalPosts,
      users: totalUsers,
      comments: totalComments,
      pages: totalPages,
    }

    statsCache = { key: cacheKey, data, expireAt: now + STATS_CACHE_TTL_MS }

    res.setHeader('Cache-Control', 'public, max-age=300')
    res.json(data)
  } catch (err) {
    console.error('获取公开统计数据失败:', err)
    res.status(500).json({ error: '获取统计数据失败' })
  }
})

export default router
