import type { RequestHandler } from 'express'
import { getActiveChatBan } from '../services/chatBanService.js'

/**
 * 聊天封禁守卫：被禁止使用聊天的账号访问 /api/chat* 与聊天图片/头像时返回
 * 403 `CHAT_BANNED`（含封禁原因），前端据此展示明确提示。
 *
 * 必须挂在 authenticate 之后（需要 req.user）；管理员永不拦截。
 */
export function requireChatNotBanned(): RequestHandler {
  return async (req, res, next) => {
    try {
      const userId = req.user?.userId
      if (!userId || req.user?.role === 'admin') {
        next()
        return
      }
      const ban = await getActiveChatBan(userId)
      if (ban) {
        res.status(403).json({
          error: ban.reason ? `聊天已被封禁：${ban.reason}` : '聊天已被封禁',
          code: 'CHAT_BANNED',
          reason: ban.reason,
          bannedAt: ban.createdAt,
        })
        return
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}
