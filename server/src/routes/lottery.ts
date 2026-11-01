import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { drawLottery, getLotteryView } from '../services/lotteryService.js'

const router = Router()
router.use(authenticate)

function limitFor(max: number, message: string) {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
    message: { error: message },
    skip: (req) => req.user?.role === 'admin',
  })
}

/** 十连算一次请求；30 次/5min 足够正常游玩，也能挡住脚本刷免费抽 */
const drawLimiter = limitFor(30, '抽奖太频繁啦，先歇一会儿再来～')

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

const drawSchema = z.object({
  count: z.number().int().refine(
    (value) => value === 1 || value === 10,
    '抽奖次数只能是 1 或 10',
  ),
})

// GET /api/lottery — 余额 / 保底 / 奖池 / 最近 30 条记录 / 统计
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getLotteryView(currentUserId(req)))
}))

// POST /api/lottery/draw — 抽奖 { count: 1 | 10 }；单抽每日首抽免费
router.post('/draw', drawLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(drawSchema, req.body ?? {})
  res.status(201).json(await drawLottery(currentUserId(req), input.count))
}))

export default router
