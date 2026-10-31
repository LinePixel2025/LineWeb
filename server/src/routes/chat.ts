import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import { chatUserTargetSchema, chatSearchSchema, chatContactRemarkSchema } from '../config/index.js'
import prisma from '../lib/prisma.js'
import { linewebIdOf } from '../lib/chatIdentity.js'
import {
  getSummary,
  searchUsers,
  listFriends,
  removeFriend,
  listFriendRequests,
  sendFriendRequest,
  respondFriendRequest,
} from '../services/chatService.js'
import { sendToUser } from '../services/chatHub.js'
import { emitFriendHeadline } from '../services/chatMessaging.js'
import { isNodeConnected, streamRead } from '../services/storageTunnel.js'

/**
 * 好友关系 REST 路由（挂载于 /api/chat）
 *
 * 聊天（会话 / 消息 / 群聊）自建于 /api/chat/xmpp/* + /ws/xmpp（见 routes/chatXmpp.ts）：
 *   - 本文件保留好友申请、好友列表、用户搜索、备注（ChatContactSetting）与摘要
 *     （好友关系是 Prisma 唯一真相源）
 *   - 旧会话/消息端点维持 410 CHAT_MIGRATED，仅 GET /messages/:id/image 复活
 *     （旧自建时期存档图片的直链，前端历史消息渲染用）
 */
const router = Router()
router.use(authenticate)

/**
 * 聊天写操作限流：每用户（未认证回退 IP）5 分钟 120 次，只挂在 POST/PUT/DELETE
 *
 * 注意：express-rate-limit v8 要求自定义 keyGenerator 在回退到请求 IP 时
 * 必须调用 ipKeyGenerator（IPv6 归一化），否则创建 limiter 时直接抛校验错误。
 */
const chatWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 当前登录用户 id（authenticate 已保证存在；这里集中处理类型与兜底） */
function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 校验请求体，失败时抛 400（错误文案取 Zod 的第一条 issue） */
function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

/** 解析正整数路径参数 */
function parseIdParam(raw: string | undefined, name: string): number {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isInteger(value) || value <= 0) throw new AppError(`无效的${name}`, 400)
  return value
}

// === 摘要与用户搜索 ===

// GET /api/chat/summary — 待处理好友申请数（未读消息由客户端水位统计）
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  const summary = await getSummary(currentUserId(req))
  res.json({ unreadTotal: 0, pendingFriendRequests: summary.pendingFriendRequests })
}))

// GET /api/chat/users/search?q= — 搜索用户（含好友关系，不含邮箱）
router.get('/users/search', asyncHandler(async (req: Request, res: Response) => {
  const { q } = parseInput(chatSearchSchema, req.query)
  res.json(await searchUsers(currentUserId(req), q))
}))

// === 好友 ===

// GET /api/chat/friends — 好友列表
router.get('/friends', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listFriends(currentUserId(req)))
}))

// DELETE /api/chat/friends/:userId — 删除好友（双向，不动已有会话）
router.delete('/friends/:userId', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const friendId = parseIdParam(req.params.userId, '用户 ID')
  await removeFriend(userId, friendId)
  // 双方各自收到「对方已把你删除好友」事件（/ws/chat 角标 + 聊天面板刷新）
  sendToUser(friendId, { type: 'friend:removed', userId })
  sendToUser(userId, { type: 'friend:removed', userId: friendId })
  emitFriendHeadline([userId, friendId], 'friend-update', userId)
  res.json({ ok: true })
}))

/**
 * PUT /api/chat/friends/remark — 设置联系人备注（仅自己可见，≤30 字，空串清除）
 *
 * 自建聊天（2026-10 起）：备注存在 ChatContactSetting，不再写外部服务。
 */
router.put('/friends/remark', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const { nekoId, remark } = parseInput(chatContactRemarkSchema, req.body)
  const linewebId = linewebIdOf(nekoId)
  if (!linewebId || linewebId === userId) throw new AppError('不能给自己设置备注', 400)
  const target = await prisma.user.findUnique({
    where: { id: linewebId },
    select: { id: true, status: true },
  })
  if (!target || target.status !== 'active') throw new AppError('用户不存在', 404)

  await prisma.chatContactSetting.upsert({
    where: { ownerId_targetUserId: { ownerId: userId, targetUserId: linewebId } },
    create: { ownerId: userId, targetUserId: linewebId, remark },
    update: { remark },
  })
  res.json({ ok: true, nekoId, remark })
}))

// GET /api/chat/friend-requests — 收到 / 发出的好友申请
router.get('/friend-requests', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listFriendRequests(currentUserId(req)))
}))

// POST /api/chat/friend-requests — 发送好友申请
router.post('/friend-requests', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const { userId: targetUserId } = parseInput(chatUserTargetSchema, req.body)
  const { request, from } = await sendFriendRequest(userId, targetUserId)

  sendToUser(targetUserId, {
    type: 'friend:request',
    request: { id: request.id, from, createdAt: request.createdAt },
  })
  // 聊天面板的申请列表（requestsIn）靠 headline 驱动刷新
  emitFriendHeadline([targetUserId], 'friend-request', userId)
  res.status(201).json({ request })
}))

// POST /api/chat/friend-requests/:id/accept — 接受好友申请
router.post('/friend-requests/:id/accept', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const requestId = parseIdParam(req.params.id, '好友申请 ID')
  const { request } = await respondFriendRequest(userId, requestId, 'accept')
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, username: true },
  })
  sendToUser(request.fromUserId, {
    type: 'friend:accepted',
    friend: me ?? { id: userId, username: '' },
  })
  emitFriendHeadline([request.fromUserId, userId], 'friend-update', request.fromUserId)
  res.json({ ok: true })
}))

// POST /api/chat/friend-requests/:id/reject — 拒绝好友申请
router.post('/friend-requests/:id/reject', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const requestId = parseIdParam(req.params.id, '好友申请 ID')
  const { request } = await respondFriendRequest(userId, requestId, 'reject')
  sendToUser(request.fromUserId, { type: 'friend:rejected', userId })
  emitFriendHeadline([request.fromUserId], 'friend-update', request.fromUserId)
  res.json({ ok: true })
}))

// === 旧自建存档：图片直链 ===

/**
 * GET /api/chat/messages/:id/image — 旧存档图片消息直链（?token= 兼容）
 *
 * 旧自建聊天（2026-10-23~27）的图片存 _chat/<conversationId>/<uuid>.webp；
 * 历史消息渲染与转发快照都经本端点取字节（前端会追加 ?token= 登录令牌）。
 * 非成员 / 已撤回 / 无图片一律 404（不泄露存在性）。
 */
router.get('/messages/:id/image', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const messageId = parseIdParam(req.params.id, '消息 ID')
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: {
      type: true,
      imagePath: true,
      imageSize: true,
      recalledAt: true,
      conversation: { select: { members: { select: { userId: true } } } },
    },
  })
  const isMember = message?.conversation.members.some((member) => member.userId === userId)
  if (!message || !isMember || message.type !== 'image' || message.recalledAt || !message.imagePath) {
    throw new AppError('图片不存在', 404)
  }
  if (!isNodeConnected()) throw new AppError('存储节点未接入', 503)

  const chunks: Buffer[] = []
  try {
    for await (const chunk of streamRead(message.imagePath)) chunks.push(chunk)
  } catch {
    throw new AppError('图片不存在', 404)
  }
  const data = Buffer.concat(chunks)
  res.setHeader('Content-Type', 'image/webp')
  res.setHeader('Content-Length', String(data.length))
  if (message.imageSize !== null) res.setHeader('X-Image-Size', message.imageSize.toString())
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.send(data)
}))

// === 已迁移：旧会话 / 消息端点统一 410 ===

/**
 * 旧聊天端点（会话、消息写入、已读、群管理）已由自建聊天取代（/api/chat/xmpp/*）。
 * 返回 410 Gone + code CHAT_MIGRATED，让旧客户端明确失败而不是写入存档。
 */
const migratedHandler = (_req: Request, res: Response) => {
  res.status(410).json({
    error: '聊天已迁移到自建服务，请刷新页面',
    code: 'CHAT_MIGRATED',
  })
}

router.get('/conversations', migratedHandler)
router.post('/conversations/direct', migratedHandler)
router.post('/conversations/group', migratedHandler)
router.get('/conversations/:id/messages', migratedHandler)
router.post('/conversations/:id/messages', migratedHandler)
router.post('/conversations/:id/images', migratedHandler)
router.post('/messages/:id/recall', migratedHandler)
router.put('/conversations/:id/read', migratedHandler)
router.put('/conversations/:id', migratedHandler)
router.post('/conversations/:id/members', migratedHandler)
router.delete('/conversations/:id/members/:userId', migratedHandler)
router.delete('/conversations/:id', migratedHandler)

export default router
