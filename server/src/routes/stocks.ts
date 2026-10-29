import { Router } from 'express'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { getStockMarket } from '../lib/stockMarket.js'
import { getTodayDateKey } from '../lib/pointsRules.js'

/**
 * 模拟股市（初版）：只读行情，不涉及交易与积分。
 * 全部需登录；开关关闭时由 /api/stocks 外层 requireFeature('stock') 拦截。
 */
const router = Router()
router.use(authenticate)

router.get('/market', asyncHandler(async (_req, res) => {
  // 自然日按 Asia/Shanghai 切换；同一天重复请求返回完全一致的数据
  res.json(getStockMarket(getTodayDateKey()))
}))

export default router
