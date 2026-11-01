import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { isThemeKey } from '../lib/themes.js'
import { buyTheme, equipTheme, getThemesView, unequipTheme } from '../services/themeService.js'

const router = Router()
router.use(authenticate)

/**
 * 写端点限流：买卖/佩戴都是「点一下」的操作，60 次 / 5 分钟足够正常使用，
 * 又能挡住脚本刷接口；管理员豁免（与项目其它模块一致）。
 */
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
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

const keyParamSchema = z.object({
  key: z.string().trim().min(1).max(40),
})

/**
 * 校验路径参数里的主题 key：
 * zod 只负责形状（长度 / 非空），存在性交给 isThemeKey 判断并抛 404，
 * 这样「未知主题」与「参数格式非法」在客户端是两种不同的错误语义。
 */
function parseThemeKey(req: Request): string {
  const parsed = keyParamSchema.safeParse(req.params)
  if (!parsed.success) throw new AppError('主题 key 无效', 400)
  const { key } = parsed.data
  if (!isThemeKey(key)) throw new AppError('没有这个主题', 404)
  return key
}

// GET /api/themes — 商店视图：目录 + 已拥有 + 当前佩戴 + 积分余额
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getThemesView(currentUserId(req)))
}))

// POST /api/themes/:key/buy — 花积分解锁（成功后自动佩戴）
router.post('/:key/buy', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const key = parseThemeKey(req)
  res.status(201).json(await buyTheme(currentUserId(req), key))
}))

// POST /api/themes/:key/equip — 佩戴已解锁的主题（default 直接清空佩戴）
router.post('/:key/equip', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const key = parseThemeKey(req)
  res.json(await equipTheme(currentUserId(req), key))
}))

// DELETE /api/themes/equipped — 卸下主题，恢复默认
router.delete('/equipped', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await unequipTheme(currentUserId(req)))
}))

export default router
