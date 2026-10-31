import { Router, type Request, type Response, type NextFunction } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import selfRouter from './chatXmppSelf.js'
import nekoRouter from './chatXmppNeko.js'

/**
 * 聊天 REST 分发器（挂载于 /api/chat/xmpp）
 *
 * 聊天双后端（2026-10-31 起）：用户可在聊天设置里选择
 *   - `self`（默认）：自建聊天，消息/会话落 Prisma（chatXmppSelf.ts）
 *   - `xmpp`：透传到 neko XMPP 服务（chatXmppNeko.ts，需配置 NEKO_CHAT_*）
 * 两侧线上协议完全一致，前端无感知；选择存 `User.chatBackend`，
 * `/ws/xmpp`（chatWsGateway.ts）按同一字段分派实时通道。
 *
 * 鉴权 / `chat` 功能开关 / 聊天封禁由 index.ts 在本路由之前统一把关。
 */
const router = Router()
router.use(authenticate)

export type ChatBackend = 'self' | 'xmpp'

/** 读取用户的聊天后端（未配置 neko 时恒为 self；读库失败回退 self） */
export async function chatBackendOf(userId: number | undefined | null): Promise<ChatBackend> {
  if (!userId || !config.nekoChatEnabled) return 'self'
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { chatBackend: true },
    })
    return user?.chatBackend === 'xmpp' ? 'xmpp' : 'self'
  } catch {
    return 'self'
  }
}

const backendSchema = z.object({
  backend: z.enum(['self', 'xmpp']),
})

// PUT /api/chat/xmpp/backend — 切换聊天后端（选择 xmpp 需要 neko 已配置）
router.put(
  '/backend',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = backendSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的聊天后端', 400)
    const userId = req.user?.userId
    if (!userId) throw new AppError('未登录', 401)
    const backend = parsed.data.backend
    if (backend === 'xmpp' && !config.nekoChatEnabled) {
      throw new AppError('XMPP 聊天服务未配置，请联系管理员', 400)
    }
    await prisma.user.update({ where: { id: userId }, data: { chatBackend: backend } })
    res.json({ ok: true, backend, xmppAvailable: config.nekoChatEnabled })
  }),
)

// GET /api/chat/xmpp/backend — 当前后端与 XMPP 可用性（前端设置项显隐用）
router.get(
  '/backend',
  asyncHandler(async (req: Request, res: Response) => {
    const backend = await chatBackendOf(req.user?.userId)
    res.json({ backend, xmppAvailable: config.nekoChatEnabled })
  }),
)

// 其余端点按用户后端分发（子路由不再重复 authenticate）
router.use((req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const backend = await chatBackendOf(req.user?.userId)
    if (backend === 'xmpp') return nekoRouter(req, res, next)
    return selfRouter(req, res, next)
  })().catch(next)
})

export default router
