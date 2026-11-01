import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { STOCK_DEFINITIONS } from '../lib/stockMarket.js'
import { buildLiveMarket, buildStockTrend } from '../lib/stockTicks.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import {
  buyStock,
  getStockLeaderboard,
  getStockPortfolio,
  getStockTrades,
  sellStock,
} from '../services/stockService.js'

/**
 * 模拟股市：行情只读（3 秒一 tick 实时刷新），交易用统一积分按实时价成交；
 * 另有每日分红结算、新闻快讯（随行情下发）、成交记录与总资产排行榜。
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

/** 行情轮询按用户限流（前端约 3 秒/次；管理员豁免） */
const marketLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '行情请求过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 走势查询按用户限流（分时 + 30 日线，开销略高；管理员豁免） */
const trendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '走势请求过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 成交记录查询按用户限流（切 Tab 才拉一次；管理员豁免） */
const tradesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '成交记录请求过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 排行榜查询按用户限流（要读候选池的持仓，比行情略重；管理员豁免） */
const leaderboardLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '排行榜请求过于频繁，请稍后再试' },
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
  /** 部分卖出份额；缺省 = 整仓 */
  shares: z.coerce.number().min(0.0001).max(1e12).optional(),
})

const trendSchema = z.object({
  code: z.string().trim().min(1).max(12),
})

const tradesSchema = z.object({
  /** 返回条数（默认 50，最多 100） */
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const leaderboardSchema = z.object({
  /** 榜单条数（默认 20，最多 50 —— 与候选池一致） */
  limit: z.coerce.number().int().min(1).max(50).optional(),
})

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

// GET /api/stocks/market — 全市场实时报价（每 3 秒推进一个 tick，价格实时计算）
router.get('/market', marketLimiter, asyncHandler(async (_req: Request, res: Response) => {
  res.json(buildLiveMarket(getTodayDateKey()))
}))

// GET /api/stocks/market/trend?code= — 单只股票近 30 根日线 + 当日分时（60 秒一点 + 最新实时价）
router.get('/market/trend', trendLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(trendSchema, req.query)
  const normalized = input.code.toUpperCase()
  const definition = STOCK_DEFINITIONS.find((item) => item.code === normalized)
  if (!definition) throw new AppError('没有这只股票', 404)
  res.json(buildStockTrend(definition, getTodayDateKey()))
}))

// GET /api/stocks/portfolio — 我的持仓与汇总收益
router.get('/portfolio', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getStockPortfolio(currentUserId(req)))
}))

// POST /api/stocks/buy — { code, points } 用积分按实时价买入
router.post('/buy', tradeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(buySchema, req.body)
  res.json(await buyStock(currentUserId(req), input.code, input.points))
}))

// POST /api/stocks/sell — { code, shares? } 按实时价卖出（缺省整仓，支持部分卖出）
router.post('/sell', tradeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(sellSchema, req.body)
  res.json(await sellStock(currentUserId(req), input.code, input.shares))
}))

// GET /api/stocks/trades?limit= — 我的最近成交记录（按时间倒序，含已实现盈亏）
router.get('/trades', tradesLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(tradesSchema, req.query)
  res.json({ trades: await getStockTrades(currentUserId(req), input.limit ?? 50) })
}))

// GET /api/stocks/leaderboard?limit= — 总资产榜（积分 + 持仓实时市值），含我自己的排名
router.get('/leaderboard', leaderboardLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(leaderboardSchema, req.query)
  res.json(await getStockLeaderboard(currentUserId(req), input.limit ?? 20))
}))

export default router
