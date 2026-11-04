import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import { getCrisisHistory, getCrisisState, getPoolTotal, payCrisis } from '../services/crisisService.js'

/**
 * Lineweb 危机（每人滚动 48 小时上缴约 50% 总资产；公共银行只进不出）。
 *
 * 全部端点都在守卫的豁免名单里（/api/crisis/**）：被封锁的用户必须始终能查账单、
 * 缴积分，否则就是把自己锁死在站外。
 */

/** 缴纳按用户限流：一笔账单本来只需点几次，防刷单与防误触（管理员豁免） */
const payLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

const crisisRouter = Router()
crisisRouter.use(authenticate)

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 账单 + 资产明细 + 参数 + 公共银行总额 */
crisisRouter.get('/me', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getCrisisState(currentUserId(req), Date.now(), { exempt: req.user?.role === 'admin' }))
}))

/** 公共银行只读总额（BigInt 一律字符串出口） */
crisisRouter.get('/pool', asyncHandler(async (_req: Request, res: Response) => {
  const total = await getPoolTotal()
  res.json({ total: total.toString() })
}))

/** 本人的上缴流水（读统一台账，不另建表） */
crisisRouter.get('/history', asyncHandler(async (req: Request, res: Response) => {
  const limit = Math.min(100, Math.max(1, Number.parseInt(String(req.query.limit ?? '30'), 10) || 30))
  res.json({ items: await getCrisisHistory(currentUserId(req), limit) })
}))

crisisRouter.post('/pay', payLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({ amount: z.coerce.number().int().min(1).max(10_000_000) }).safeParse(req.body)
  if (!parsed.success) throw new AppError('缴纳积分必须是 1–10000000 的整数', 400)
  const result = await payCrisis(currentUserId(req), parsed.data.amount)
  res.json(result)
}))

/**
 * 积分税款开关（用户自选，见 lib/crisisRules.ts 的 spendTaxPct 口径）。
 * 路径在 /api/crisis/** 豁免名单内：被封锁的用户也能开关——这是设计使然
 * （主动还税通道：税款是用户自愿的捐赠，开关本身不产生积分也不解锁任何功能）。
 */
crisisRouter.put('/tax', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body)
  if (!parsed.success) throw new AppError('enabled 必须为布尔值', 400)
  await prisma.user.update({
    where: { id: currentUserId(req) },
    data: { crisisTaxEnabled: parsed.data.enabled },
  })
  res.json({ enabled: parsed.data.enabled })
}))

export default crisisRouter
