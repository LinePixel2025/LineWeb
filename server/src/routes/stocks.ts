import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { getStockMarket } from '../lib/stockMarket.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { buyStock, getStockPortfolio, sellStock } from '../services/stockService.js'

/**
 * 模拟股市：行情只读，交易用统一积分。
 * 全部需登录；开关关闭时由 /api/stocks 外层 requireFeature('stock') 拦截。
 */
const router = Router()
router.use(authenticate)

/** 交易写入按用户限流（管理员豁免，与积分接口口径一致） */
const tradeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '交易过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

const buySchema = z.object({
  code: z.string().trim().min(1).max(12),
  points: z.coerce.number().int().min(1).max(100_000),
})

const sellSchema = z.object({
  code: z.string().trim().min(1).max(12),
})

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

router.get('/market', asyncHandler(async (_req: Request, res: Response) => {
  // 自然日按 Asia/Shanghai 切换；同一天重复请求返回完全一致的数据
  res.json(getStockMarket(getTodayDateKey()))
}))

// GET /api/stocks/portfolio — 我的持仓与汇总收益
router.get('/portfolio', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getStockPortfolio(currentUserId(req)))
}))

// POST /api/stocks/buy — { code, points } 用积分买入
router.post('/buy', tradeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(buySchema, req.body)
  res.json(await buyStock(currentUserId(req), input.code, input.points))
}))

// POST /api/stocks/sell — { code } 卖出全部持仓
router.post('/sell', tradeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(sellSchema, req.body)
  res.json(await sellStock(currentUserId(req), input.code))
}))

export default router
