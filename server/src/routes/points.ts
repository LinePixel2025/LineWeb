import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import {
  buyShopItem,
  checkin,
  getPointsLeaderboard,
  getPointsProfile,
  listPointsLedger,
  listShop,
  setEquippedAvatarFrame,
  setEquippedLeaderTitle,
  setEquippedTitle,
} from '../services/pointsService.js'

const router = Router()
router.use(authenticate)

const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 签到一天只有一次，单独收紧限流（管理员同样不豁免，避免脚本空转） */
const checkinLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '签到过于频繁，请稍后再试' },
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

const ledgerSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
})

const leaderboardSchema = z.object({
  metric: z.enum(['balance', 'earned']).optional().default('balance'),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
})

const buySchema = z.object({}).passthrough().optional()

// GET /api/points/me — 余额 / 排名 / 佩戴称号 / 已购商品 key
router.get('/me', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getPointsProfile(currentUserId(req)))
}))

// POST /api/points/checkin — 每日签到（重复签到 409 CHECKIN_DONE）
router.post('/checkin', checkinLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await checkin(currentUserId(req)))
}))

// GET /api/points/ledger?limit=&page=
router.get('/ledger', asyncHandler(async (req: Request, res: Response) => {
  const params = parseInput(ledgerSchema, req.query)
  res.json(await listPointsLedger(currentUserId(req), params.limit, params.page))
}))

// GET /api/points/leaderboard?metric=balance|earned
router.get('/leaderboard', asyncHandler(async (req: Request, res: Response) => {
  const params = parseInput(leaderboardSchema, req.query)
  res.json(await getPointsLeaderboard({ userId: currentUserId(req), ...params }))
}))

// GET /api/points/shop — 商品 + 已购 + 余额
router.get('/shop', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listShop(currentUserId(req)))
}))

// POST /api/points/shop/:id/buy — 购买称号 / 表情包
router.post('/shop/:id/buy', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  parseInput(buySchema, req.body ?? {})
  const itemId = Number(req.params.id)
  if (!Number.isInteger(itemId) || itemId <= 0) throw new AppError('无效的商品 ID', 400)
  res.json(await buyShopItem(currentUserId(req), itemId))
}))

// POST /api/points/shop/:id/equip — 佩戴称号
router.post('/shop/:id/equip', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const itemId = Number(req.params.id)
  if (!Number.isInteger(itemId) || itemId <= 0) throw new AppError('无效的商品 ID', 400)
  res.json(await setEquippedTitle(currentUserId(req), itemId))
}))

// DELETE /api/points/equipped-title — 取消佩戴（商店称号 + 榜一传说称号一起清空）
router.delete('/equipped-title', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const result = await setEquippedTitle(currentUserId(req), null)
  await setEquippedLeaderTitle(currentUserId(req), null)
  res.json(result)
}))

// POST /api/points/leader-titles/:id/equip — 佩戴当前持有的单机榜一传说称号
router.post('/leader-titles/:id/equip', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const leaderTitleId = Number(req.params.id)
  if (!Number.isInteger(leaderTitleId) || leaderTitleId <= 0) throw new AppError('无效的称号 ID', 400)
  res.json(await setEquippedLeaderTitle(currentUserId(req), leaderTitleId))
}))

// POST /api/points/shop/:id/equip-frame — 佩戴头像框
router.post('/shop/:id/equip-frame', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const itemId = Number(req.params.id)
  if (!Number.isInteger(itemId) || itemId <= 0) throw new AppError('无效的商品 ID', 400)
  res.json(await setEquippedAvatarFrame(currentUserId(req), itemId))
}))

// DELETE /api/points/equipped-frame — 卸下头像框
router.delete('/equipped-frame', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await setEquippedAvatarFrame(currentUserId(req), null))
}))

export default router
