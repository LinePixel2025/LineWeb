import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { authenticate } from '../middleware/auth.js'
import {
  chatUserTargetSchema,
  chatMessageSchema,
  chatReadSchema,
  chatGroupCreateSchema,
  chatGroupUpdateSchema,
  chatGroupMembersSchema,
  chatSearchSchema,
} from '../config/index.js'
import {
  getSummary,
  searchUsers,
  listFriends,
  removeFriend,
  listFriendRequests,
  sendFriendRequest,
  respondFriendRequest,
  listConversations,
  createDirectConversation,
  createGroupConversation,
  listMessages,
  sendMessage,
  markConversationRead,
  renameGroupConversation,
  addGroupMembers,
  removeGroupMember,
  deleteGroupConversation,
  getUserBrief,
} from '../services/chatService.js'
import { sendToUser, sendToUsers } from '../services/chatHub.js'

/**
 * 聊天 REST 路由（挂载于 /api/chat）
 *
 * 全部端点要求账号登录令牌（全局认证中间件已覆盖，router 内再兜底一次）；
 * 第三方应用令牌 / 下载票据不可用（全局认证的白名单会拒绝 /chat/*）。
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

/** 解析 limit（默认 30，最大 100） */
function parseLimit(raw: unknown): number {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(value) || value <= 0) return 30
  return Math.min(value, 100)
}

/** 解析 before 游标（消息 id，可选） */
function parseBefore(raw: unknown): number | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  const value = Number.parseInt(raw, 10)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

// === 摘要与用户搜索 ===

// GET /api/chat/summary — 未读消息总数 + 待处理好友申请数
router.get('/summary', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getSummary(currentUserId(req)))
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
  // 双方各自收到「对方已把你删除好友」事件
  sendToUser(friendId, { type: 'friend:removed', userId })
  sendToUser(userId, { type: 'friend:removed', userId: friendId })
  res.json({ ok: true })
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
  res.status(201).json({ request })
}))

// POST /api/chat/friend-requests/:id/accept — 接受好友申请
router.post('/friend-requests/:id/accept', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const requestId = parseIdParam(req.params.id, '好友申请 ID')
  const { request } = await respondFriendRequest(userId, requestId, 'accept')
  const me = await getUserBrief(userId)
  sendToUser(request.fromUserId, { type: 'friend:accepted', friend: me })
  res.json({ ok: true })
}))

// POST /api/chat/friend-requests/:id/reject — 拒绝好友申请
router.post('/friend-requests/:id/reject', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const requestId = parseIdParam(req.params.id, '好友申请 ID')
  const { request } = await respondFriendRequest(userId, requestId, 'reject')
  sendToUser(request.fromUserId, { type: 'friend:rejected', userId })
  res.json({ ok: true })
}))

// === 会话 ===

// GET /api/chat/conversations — 我的会话列表（含最后一条消息与未读数）
router.get('/conversations', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listConversations(currentUserId(req)))
}))

// POST /api/chat/conversations/direct — 创建 / 获取与好友的私聊会话
router.post('/conversations/direct', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const { userId: targetUserId } = parseInput(chatUserTargetSchema, req.body)
  const conversation = await createDirectConversation(userId, targetUserId)
  res.json({ conversation })
}))

// POST /api/chat/conversations/group — 创建群聊（仅可邀请好友）
router.post('/conversations/group', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const { name, memberIds } = parseInput(chatGroupCreateSchema, req.body)
  const { conversation } = await createGroupConversation(userId, name, memberIds)
  sendToUsers(conversation.members.map(member => member.id), {
    type: 'conversation:updated',
    conversationId: conversation.id,
  })
  res.status(201).json({ conversation })
}))

// GET /api/chat/conversations/:id/messages?before=&limit= — 历史消息（游标分页）
router.get('/conversations/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  const result = await listMessages(userId, conversationId, {
    limit: parseLimit(req.query.limit),
    before: parseBefore(req.query.before),
  })
  res.json(result)
}))

// POST /api/chat/conversations/:id/messages — 发送消息
router.post('/conversations/:id/messages', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  const { content } = parseInput(chatMessageSchema, req.body)
  const { message, memberIds } = await sendMessage(userId, conversationId, content)

  // 推给全部成员（含自己其它标签页）
  sendToUsers(memberIds, { type: 'message:new', conversationId, message })
  res.status(201).json({ message })
}))

// PUT /api/chat/conversations/:id/read — 更新已读位置（只前进不后退）
router.put('/conversations/:id/read', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  const { lastMessageId } = parseInput(chatReadSchema, req.body)
  res.json(await markConversationRead(userId, conversationId, lastMessageId))
}))

// PUT /api/chat/conversations/:id — 群主修改群名
router.put('/conversations/:id', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  const { name } = parseInput(chatGroupUpdateSchema, req.body)
  const { conversation, memberIds } = await renameGroupConversation(userId, conversationId, name)
  sendToUsers(memberIds, { type: 'conversation:updated', conversationId })
  res.json({ conversation })
}))

// POST /api/chat/conversations/:id/members — 群主添加成员
router.post('/conversations/:id/members', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  const { userIds } = parseInput(chatGroupMembersSchema, req.body)
  const { conversation, memberIds, addedIds } = await addGroupMembers(userId, conversationId, userIds)

  if (addedIds.length > 0) {
    // 全员（含新成员）刷新会话视图
    sendToUsers(memberIds, { type: 'conversation:updated', conversationId })
  }
  res.json({ conversation })
}))

// DELETE /api/chat/conversations/:id/members/:userId — 退出群聊 / 群主移除成员
router.delete('/conversations/:id/members/:userId', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  const targetUserId = parseIdParam(req.params.userId, '用户 ID')
  const { removedUserId, remainingIds } = await removeGroupMember(userId, conversationId, targetUserId)

  // 被移除 / 退出者：会话消失（含自己的其它标签页）；其余成员：会话成员变化
  sendToUser(removedUserId, { type: 'conversation:removed', conversationId })
  sendToUsers(remainingIds, { type: 'conversation:updated', conversationId })
  res.json({ ok: true })
}))

// DELETE /api/chat/conversations/:id — 群主解散群聊
router.delete('/conversations/:id', chatWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const conversationId = parseIdParam(req.params.id, '会话 ID')
  const { memberIds } = await deleteGroupConversation(userId, conversationId)
  sendToUsers(memberIds, { type: 'conversation:removed', conversationId })
  res.json({ ok: true })
}))

export default router
