import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, clearTokenValidAfterCache } from '../middleware/auth.js'
import { registerUser, loginUser, getUserById, updateUserSettings, invalidateUserTokens } from '../services/authService.js'
import { registerSchema, loginSchema, updateSettingsSchema } from '../config/index.js'
import { getErrorMessage, getErrorStatus } from '../lib/utils.js'

const router = Router()

// 速率限制：登录/注册每 IP 每 15 分钟最多 20 次
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: '请求过于频繁，请 15 分钟后再试' },
  standardHeaders: true,
  legacyHeaders: false,
})

router.use(authLimiter)

// 注册
router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const { username, email, password } = parsed.data
  try {
    const data = await registerUser(username, email, password)
    res.status(201).json(data)
  } catch (err: unknown) {
    if (getErrorStatus(err) === 409) {
      res.status(409).json({ error: getErrorMessage(err) })
      return
    }
    throw err
  }
})

// 登录
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效' })
    return
  }

  const { email, password } = parsed.data
  try {
    const data = await loginUser(email, password)
    res.json(data)
  } catch (err: unknown) {
    if (getErrorStatus(err) === 401) {
      res.status(401).json({ error: getErrorMessage(err) })
      return
    }
    throw err
  }
})

// 获取当前用户信息
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const user = await getUserById(req.user!.userId)
  if (!user) {
    throw new AppError('用户不存在', 404)
  }
  res.json(user)
})

// 更新个性化设置
router.put('/settings', authenticate, async (req: Request, res: Response) => {
  const parsed = updateSettingsSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const { settings } = parsed.data

  try {
    JSON.parse(settings)
  } catch {
    res.status(400).json({ error: '设置格式无效，必须是合法的 JSON' })
    return
  }

  const user = await updateUserSettings(req.user!.userId, settings)
  res.json({ user })
})

// 登出 — 使该用户的所有 JWT 立即失效
router.post('/logout', authenticate, async (req: Request, res: Response) => {
  try {
    await invalidateUserTokens(req.user!.userId)
    // 清除内存缓存，使下次请求立即校验失败
    clearTokenValidAfterCache(req.user!.userId)
    res.json({ message: '已登出' })
  } catch (err) {
    console.error('登出失败:', err)
    res.status(500).json({ error: '登出失败' })
  }
})

export default router
