import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.js'
import { authenticateScreenTimeToken } from '../middleware/screenTimeAuth.js'
import {
  createScreenTimeTokenSchema,
  pushScreenTimeSchema,
  setDailyGoalSchema,
  screenTimeRangeSchema,
} from '../config/index.js'
import {
  createScreenTimeToken,
  listScreenTimeTokens,
  deleteScreenTimeToken,
  pushScreenTime,
  getTodayScreenTime,
  setDailyGoal,
  getDailyGoal,
  getScreenTimeRange,
} from '../services/screenTimeService.js'

const router = Router()

function getTodayDate(): string {
  // Asia/Shanghai (UTC+8) — China does not observe DST
  // Use manual offset instead of Intl.DateTimeFormat to avoid ICU dependency in Alpine
  const now = Date.now()
  const shanghai = new Date(now + 8 * 60 * 60 * 1000)
  const y = shanghai.getUTCFullYear()
  const m = String(shanghai.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shanghai.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// 获取当前用户今日屏幕时间（JWT 登录态）
router.get('/screen-time', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId
  const data = await getTodayScreenTime(userId, getTodayDate())
  res.json(data)
})

// 获取日期范围内的屏幕时间历史（JWT 登录态，供首页热力图使用）
router.get('/screen-time/range', authenticate, async (req: Request, res: Response) => {
  const parsed = screenTimeRangeSchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const userId = req.user!.userId
  const { from, to } = parsed.data
  const logs = await getScreenTimeRange(userId, from, to)
  res.json({ logs })
})

// 获取屏幕时间数据（Token 认证，供第三方应用调用）
router.get('/screen-time/data', authenticateScreenTimeToken, async (req: Request, res: Response) => {
  const userId = req.screenTimeToken!.userId
  const data = await getTodayScreenTime(userId, getTodayDate())
  res.json(data)
})

// 本地脚本推送
router.post('/push', authenticateScreenTimeToken, async (req: Request, res: Response) => {
  const parsed = pushScreenTimeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const userId = req.screenTimeToken!.userId
  const { totalSeconds, date } = parsed.data
  await pushScreenTime(userId, totalSeconds, date)
  res.json({ message: '已同步' })
})

// 生成 Token
router.post('/tokens', authenticate, async (req: Request, res: Response) => {
  const parsed = createScreenTimeTokenSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const userId = req.user!.userId
  const name = parsed.data.name || 'Time Master'
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null
  const token = await createScreenTimeToken(userId, name, expiresAt)
  res.json(token)
})

// 列出 Token
router.get('/tokens', authenticate, async (req: Request, res: Response) => {
  const tokens = await listScreenTimeTokens(req.user!.userId)
  res.json({ tokens })
})

// 删除 Token
router.delete('/tokens/:id', authenticate, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10)
  if (Number.isNaN(id)) {
    res.status(400).json({ error: '无效的 ID' })
    return
  }
  await deleteScreenTimeToken(req.user!.userId, id)
  res.json({ message: '已删除' })
})

// 设置今日使用目标（JWT 登录态）
router.put('/daily-goal', authenticate, async (req: Request, res: Response) => {
  const parsed = setDailyGoalSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const { goalSeconds } = parsed.data
  await setDailyGoal(req.user!.userId, getTodayDate(), goalSeconds)
  const result = await getDailyGoal(req.user!.userId, getTodayDate())
  res.json(result)
})

// 获取今日使用目标（JWT 登录态）
router.get('/daily-goal', authenticate, async (req: Request, res: Response) => {
  const data = await getDailyGoal(req.user!.userId, getTodayDate())
  res.json(data)
})

// 获取今日使用目标（Token 认证，供 Time Master 调用）
router.get('/daily-goal/data', authenticateScreenTimeToken, async (req: Request, res: Response) => {
  const data = await getDailyGoal(req.screenTimeToken!.userId, getTodayDate())
  res.json(data)
})

export default router
