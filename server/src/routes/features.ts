import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import { FEATURE_DEFINITIONS, isFeatureKey } from '../lib/features.js'
import { getFeatureMap, setAllFeatures, setFeature } from '../services/featureService.js'

/** 公开只读：登录页需要判断注册是否开放；开关本身不是敏感信息 */
export const featuresRouter = Router()
featuresRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ features: await getFeatureMap() })
}))

export const adminFeaturesRouter = Router()
adminFeaturesRouter.use(authenticate, requireCapability('feature:manage'))

adminFeaturesRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ features: await getFeatureMap(), definitions: FEATURE_DEFINITIONS })
}))

// 批量开关全部功能；必须注册在 PUT /:key 之前，否则 'all' 会被当作未知 key 吃掉
adminFeaturesRouter.put('/all', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body)
  if (!parsed.success) throw new AppError('输入数据无效', 400)
  const enabled = parsed.data.enabled
  const features = await setAllFeatures(enabled, req.user!.userId)
  res.json({ enabled, features })
}))

adminFeaturesRouter.put('/:key', asyncHandler(async (req: Request, res: Response) => {
  const key = req.params.key
  if (!isFeatureKey(key)) throw new AppError('未知的功能开关', 400)
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body)
  if (!parsed.success) throw new AppError('输入数据无效', 400)
  const map = await setFeature(key, parsed.data.enabled, req.user!.userId)
  res.json({ key, enabled: map[key], features: map })
}))
