import type { RequestHandler } from 'express'
import { isFeatureEnabled } from '../services/featureService.js'
import type { FeatureKey } from '../lib/features.js'

/**
 * 功能开关守卫。
 *
 * 必须挂在认证之后（需要 req.user 才能判断管理员）；非 /api 路由
 * （聊天图片、代理等）要在各自鉴权/会话解析之后单独挂。
 */
export function requireFeature(key: FeatureKey): RequestHandler {
  return async (req, res, next) => {
    try {
      if (req.user?.role === 'admin') {
        next()
        return
      }
      const enabled = await isFeatureEnabled(key, req.user?.role)
      if (!enabled) {
        res.status(403).json({ error: '该功能已关闭', code: 'FEATURE_DISABLED', feature: key })
        return
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
