import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { requireFeature } from '../middleware/featureGuard.js'
import prisma from '../lib/prisma.js'
import {
  importStats,
  listStats,
  recordSoloResult,
  getLeaderboard,
} from '../services/gameStatsService.js'

const router = Router()
router.use(authenticate)

/** 单机结果/导入写入限流：每用户 120 次/5min（管理员豁免） */
const gameStatsWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

const soloResultSchema = z.object({
  game: z.string(),
  variant: z.string(),
  outcome: z.enum(['win', 'loss', 'draw']).optional(),
  score: z.number().optional(),
  scoreDelta: z.number().optional(),
  timeMs: z.number().optional(),
  distanceM: z.number().optional(),
  coins: z.number().optional(),
  maxCombo: z.number().optional(),
  jumps: z.number().optional(),
  offset: z.number().optional(),
  deaths: z.number().optional(),
})

const importSchema = z.object({
  records: z.array(z.unknown()).max(100),
})

const leaderboardSchema = z.object({
  game: z.string(),
  variant: z.string(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
})

// GET /api/game-stats — 当前用户全部聚合战绩
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const [user, stats] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { gameStatsImportedAt: true } }),
    listStats(userId),
  ])
  res.json({ imported: !!user?.gameStatsImportedAt, stats })
}))

// GET /api/game-stats/leaderboard?game=&variant=&limit=&page=
router.get('/leaderboard', asyncHandler(async (req: Request, res: Response) => {
  const params = parseInput(leaderboardSchema, req.query)
  res.json(await getLeaderboard({ userId: currentUserId(req), ...params }))
}))

// POST /api/game-stats/result — 单机一局结束上报
router.post(
  '/result',
  gameStatsWriteLimiter,
  requireFeature('gamesSingle'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = parseInput(soloResultSchema, req.body)
    const stat = await recordSoloResult(currentUserId(req), input)
    res.json({ stat })
  }),
)

// POST /api/game-stats/import — 旧 localStorage 一次性合并
router.post(
  '/import',
  gameStatsWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { records } = parseInput(importSchema, req.body)
    res.json(await importStats(currentUserId(req), records))
  }),
)

export default router
