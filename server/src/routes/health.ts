import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth.js'
import {
  pushScreenTimeSchema,
  setDailyGoalSchema,
  screenTimeRangeSchema,
} from '../config/index.js'
import {
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

// 以下所有端点均使用账号登录令牌（Authorization: Bearer <jwt>），且只能读写本人数据

// 获取当前用户今日屏幕时间
router.get('/screen-time', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId
  const data = await getTodayScreenTime(userId, getTodayDate())
  res.json(data)
})

// 获取日期范围内的屏幕时间历史（供首页热力图使用）
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

// 推送屏幕时间（第三方设备登录后使用同一账号令牌调用）
router.post('/push', authenticate, async (req: Request, res: Response) => {
  const parsed = pushScreenTimeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const userId = req.user!.userId
  const { totalSeconds, date } = parsed.data
  await pushScreenTime(userId, totalSeconds, date)
  res.json({ message: '已同步' })
})

// 设置今日使用目标
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

// 获取今日使用目标
router.get('/daily-goal', authenticate, async (req: Request, res: Response) => {
  const data = await getDailyGoal(req.user!.userId, getTodayDate())
  res.json(data)
})

export default router
