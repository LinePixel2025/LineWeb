import { Router, type Request } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import {
  banChatUser,
  liftChatBan,
  listChatBans,
} from '../services/chatBanService.js'
import { closeUserChatSockets } from '../services/nekoWsProxy.js'

/**
 * 聊天治理（需 chat:manage）：封禁 / 解封账号的聊天入口。
 *
 * 封禁只影响 LineWeb 的聊天入口（/api/chat*、/ws/xmpp 握手），
 * 不修改 neko 账号本身；解封立即恢复。
 */
const router = Router()
router.use(authenticate, requireCapability('chat:manage'))

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

function parseUserId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('无效的用户 ID', 400)
  return id
}

const banSchema = z.object({
  userId: z.number().int().positive(),
  reason: z.string().trim().max(200).optional().default(''),
})

/** 封禁列表（默认仅生效中；?includeLifted=1 含历史） */
router.get('/bans', asyncHandler(async (req: Request, res) => {
  const includeLifted = req.query.includeLifted === '1' || req.query.includeLifted === 'true'
  res.json({ bans: await listChatBans({ includeLifted }) })
}))

/** 用户搜索（按用户名 / 邮箱模糊匹配），附带当前封禁状态 */
router.get('/users', asyncHandler(async (req: Request, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) {
    res.json({ users: [] })
    return
  }
  const rows = await prisma.user.findMany({
    where: {
      OR: [
        { username: { contains: q } },
        { email: { contains: q } },
      ],
    },
    orderBy: { username: 'asc' },
    take: 20,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      status: true,
      chatBan: { select: { reason: true, active: true } },
    },
  })
  res.json({
    users: rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      chatBanned: row.chatBan?.active === true,
      chatBanReason: row.chatBan?.active ? row.chatBan.reason : '',
    })),
  })
}))

/** 封禁聊天入口：立即生效，并断开该账号已建立的聊天 WS */
router.post('/bans', asyncHandler(async (req: Request, res) => {
  const input = parseInput(banSchema, req.body)
  const adminId = req.user?.userId
  if (!adminId) throw new AppError('未登录', 401)
  const { created, ban } = await banChatUser({
    userId: input.userId,
    reason: input.reason,
    bannedBy: adminId,
  })
  const kicked = closeUserChatSockets(input.userId)
  res.json({ ok: true, created, ban, kicked })
}))

/** 解封（幂等） */
router.delete('/bans/:userId', asyncHandler(async (req: Request, res) => {
  const userId = parseUserId(req.params.userId)
  const { lifted } = await liftChatBan(userId)
  res.json({ ok: true, lifted })
}))

export default router
