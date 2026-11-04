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
import {
  closeSoloSession,
  getTicketStatus,
  startSoloSession,
} from '../services/gameTicketService.js'

const router = Router()
router.use(authenticate)

/**
 * 单机结果 / 开局 / 导入写入限流：每用户 240 次/5min（管理员豁免）。
 * 门票上线后每一局要发两次写请求（session/start + result），额度从 120 抬到 240。
 */
const gameStatsWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 240,
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
  /** 开局时拿到的会话 id：门票生效时必填，否则结果一律按「没买票」拒绝 */
  sessionId: z.coerce.number().int().positive().optional(),
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

const sessionStartSchema = z.object({
  game: z.string().min(1).max(32),
  variant: z.string().min(1).max(16).optional(),
})

const sessionCloseSchema = z.object({ sessionId: z.unknown().optional() })

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

// GET /api/game-stats/ticket — 门票状态（余票 / 一口价 / 返还额 / 系统是否生效）
router.get('/ticket', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getTicketStatus(currentUserId(req), req.user?.role))
}))

// POST /api/game-stats/session/start — 单机开局：扣 1 张门票并建立会话，返回 sessionId
router.post(
  '/session/start',
  gameStatsWriteLimiter,
  requireFeature('gamesSingle'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = parseInput(sessionStartSchema, req.body ?? {})
    res.status(201).json(await startSoloSession(currentUserId(req), input.game, input.variant))
  }),
)

// POST /api/game-stats/session/close — 关闭未结算会话（我的世界这类不报战绩的玩法用它返还 20）
router.post(
  '/session/close',
  gameStatsWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const input = parseInput(sessionCloseSchema, req.body ?? {})
    res.json(await closeSoloSession(currentUserId(req), input.sessionId))
  }),
)

// POST /api/game-stats/result — 单机一局结束上报
router.post(
  '/result',
  gameStatsWriteLimiter,
  requireFeature('gamesSingle'),
  asyncHandler(async (req: Request, res: Response) => {
    const input = parseInput(soloResultSchema, req.body)
    // 返回 { stat, points, ticket }，前端据此刷新积分与战绩
    res.json(await recordSoloResult(currentUserId(req), input, input.sessionId ?? null))
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
