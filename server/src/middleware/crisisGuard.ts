import type { RequestHandler } from 'express'
import { isCrisisExempt, remainingOf, resolveCrisisStatus } from '../lib/crisisRules.js'
import {
  crisisBlockMessage,
  getCrisisGuardSnapshot,
  getCrisisRules,
  isUserCrisisBlocked,
} from '../services/crisisService.js'

/**
 * Lineweb 危机封锁守卫。
 *
 * 挂在 authenticate 与按用户限流之后、所有路由挂载之前（server/src/index.ts），
 * 因此它对每个 /api/** 请求生效，且早于各路由的 requireFeature。
 *
 * 放行顺序：无 req.user（公开白名单）→ 管理员 → 豁免端点 → 税单判定。
 * 管理员永不封锁（与功能开关 / 聊天封禁同一口径），危机总开关关闭时一律放行。
 *
 * 判定与文案都取自 lib/crisisRules.ts 的唯一口径，避免这里再写一套布尔式。
 */
export function requireCrisisSettled(): RequestHandler {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId
      if (!userId || req.user?.role === 'admin') {
        next()
        return
      }
      const fullPath = `${req.baseUrl ?? ''}${req.path ?? ''}`
      if (isCrisisExempt(fullPath)) {
        next()
        return
      }
      const rules = await getCrisisRules()
      if (!rules.enabled) {
        next()
        return
      }
      if (!(await isUserCrisisBlocked(userId))) {
        next()
        return
      }
      const { levy, hasLiveRaid } = await getCrisisGuardSnapshot(userId)
      res.status(403).json({
        error: crisisBlockMessage(levy),
        code: 'CRISIS_BLOCKED',
        required: levy.required,
        paid: levy.paid,
        remaining: remainingOf(levy),
        graceUntil: levy.graceUntil ? new Date(levy.graceUntil).toISOString() : null,
        nextDueAt: levy.nextDueAt ? new Date(levy.nextDueAt).toISOString() : null,
        hasLiveRaid,
        status: resolveCrisisStatus(levy, rules, Date.now(), hasLiveRaid),
      })
    } catch (err) {
      // 危机读数失败绝不影响正常请求：宁可漏封一次，也不要让全站 500
      console.warn('[crisis] 守卫判定异常，按放行处理：', err instanceof Error ? err.message : err)
      next()
    }
  }
}
