import express, { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import sharp from 'sharp'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { requireFeature } from '../middleware/featureGuard.js'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import {
  CHAT_ANNOUNCEMENT_MAX,
  CHAT_GROUP_MEMBER_LIMIT,
  linewebIdOf,
  newUploadId,
  uploadPathOf,
} from '../lib/chatIdentity.js'
import { ChatImageLimitError, chatImageLimitBody, CHAT_IMAGE_MAX_PROCESSED_BYTES } from '../services/chatImageService.js'
import { getDriveQuota, getDriveUsage } from '../services/driveQuota.js'
import { isNodeConnected, streamWriteBinary, sendCommand } from '../services/storageTunnel.js'
import { issueChatTicket, sendToUserSessions } from '../services/chatSessions.js'
import { recallMessageRest, emitRoomUpdate, roomHeadlineXml } from '../services/chatMessaging.js'
import {
  createPollingSession,
  closePollingSession,
  feedStanza,
  pollStanza,
} from '../services/chatPolling.js'
import {
  buildChatView,
  resolveUsers,
  searchDirectory,
  type ChatBootstrapView,
} from '../services/chatView.js'
import { getBigGroupConversationId } from '../services/bigGroup.js'
import { getTitleMapForLineWebIds } from '../services/pointsService.js'
import {
  claimRedPacket,
  createRedPacket,
  getRedPacketView,
} from '../services/redPacketService.js'

/**
 * 自建聊天 REST 网关（聊天双后端的「自建」侧；由 routes/chatXmpp.ts 分发器按用户选择挂载）
 *
 * 2026-10 起聊天完全自建（Prisma/PostgreSQL，无外部 XMPP 依赖）：
 *   - bootstrap / ticket / state：本地生成一次性票据与状态视图（chatView.ts）
 *   - 群管理 / 表情 / 置顶 / 撤回 / 公告：Prisma 直写 + headline 事件广播
 *   - uploads：本地 sharp 处理后写存储节点 _chat/uploads/（配额按上传计费）
 *   - http-*：长轮询会话（chatPolling.ts，与 /ws/xmpp 同一状态机）
 * 消息收发本体走 /ws/xmpp（chatWsGateway.ts）或 http-*，不经过本路由的状态接口。
 */
const router = Router()

/** 聊天写操作限流：每用户 5 分钟 120 次（长轮询/上传单独豁免） */
const chatWriteLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 图片上限与前端一致（8MB，按魔数判定类型） */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024
const STANZA_MAX_BYTES = 256 * 1024

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

async function currentUser(req: Request): Promise<{ id: number; username: string }> {
  const user = await prisma.user.findUnique({
    where: { id: currentUserId(req) },
    select: { id: true, username: true, status: true },
  })
  if (!user || user.status !== 'active') throw new AppError('用户不存在或已停用', 401)
  return { id: user.id, username: user.username }
}

/** 图片魔数（不信任请求头） */
function sniffImageMime(buf: Buffer): string {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return ''
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg'
  const head = buf.toString('ascii', 0, 6)
  if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif'
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return ''
}

// === 状态与票据 ===

// GET /api/chat/xmpp/bootstrap — 一次性票据 + 初始状态
router.get(
  '/bootstrap',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await currentUser(req)
    const [ticket, view] = await Promise.all([issueChatTicket(user.id), buildChatView(user)])
    const payload: ChatBootstrapView & { ticket: string; wsPath: string; backend: 'self'; xmppAvailable: boolean } = {
      ...view,
      ticket,
      wsPath: '/xmpp-websocket',
      backend: 'self',
      xmppAvailable: config.nekoChatEnabled,
    }
    res.json(payload)
  }),
)

// GET /api/chat/xmpp/ticket — 重连前换新票据（一次性）
router.get(
  '/ticket',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await currentUser(req)
    res.json({ ticket: issueChatTicket(user.id) })
  }),
)

// GET /api/chat/xmpp/state — 轮询降级 / 重连后刷新状态
router.get(
  '/state',
  asyncHandler(async (req: Request, res: Response) => {
    const view = await buildChatView(await currentUser(req))
    res.json({ ...view, backend: 'self', xmppAvailable: config.nekoChatEnabled })
  }),
)

// === 联系人搜索与反查 ===

const directorySchema = z.object({
  q: z.string().trim().min(1).max(50),
})

// GET /api/chat/xmpp/directory?q= — 搜索可发起会话的用户
router.get(
  '/directory',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = directorySchema.safeParse(req.query)
    if (!parsed.success) throw new AppError('请输入 1-50 个字符的搜索词', 400)
    const rows = await searchDirectory(currentUserId(req), parsed.data.q)
    res.json({ users: rows })
  }),
)

// GET /api/chat/xmpp/users?jids=lw_1@dom,lw_2@dom — 陌生来信反查
router.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const raw = String(req.query.jids || '')
    const usernames = raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => value.split('/')[0].split('@')[0])
      .slice(0, 20)
    if (usernames.length === 0) {
      res.json({ users: [] })
      return
    }
    const rows = await resolveUsers(currentUserId(req), usernames)
    res.json({ users: rows })
  }),
)

// === 表情收藏 ===

const stickerSchema = z.object({
  uploadId: z.string().regex(/^[0-9a-f]{24}$/, '无效的图片'),
})

// POST /api/chat/xmpp/stickers — 收藏图片为表情
router.post(
  '/stickers',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = stickerSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的图片', 400)
    const userId = currentUserId(req)
    const upload = await prisma.chatUpload.findUnique({ where: { id: parsed.data.uploadId } })
    if (!upload) throw new AppError('图片不存在或已过期', 404)
    await prisma.chatSticker.upsert({
      where: { userId_uploadId: { userId, uploadId: upload.id } },
      create: { userId, uploadId: upload.id, mime: upload.mime },
      update: { mime: upload.mime },
    })
    res.json({ ok: true })
  }),
)

const stickerRemoveSchema = z.object({ id: z.number().int().positive() })

// POST /api/chat/xmpp/stickers/remove — 移出表情包
router.post(
  '/stickers/remove',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = stickerRemoveSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的表情', 400)
    const userId = currentUserId(req)
    await prisma.chatSticker.deleteMany({ where: { id: parsed.data.id, userId } })
    res.json({ ok: true })
  }),
)

// === 群聊 ===

/** 群会话 + 自己的成员行（非成员 404，不泄露存在性） */
async function requireGroupMembership(conversationId: number, userId: number) {
  const membership = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: {
      conversation: {
        select: {
          id: true,
          type: true,
          name: true,
          ownerId: true,
          allMuted: true,
          announcementText: true,
          members: { select: { userId: true, role: true } },
        },
      },
    },
  })
  if (!membership || membership.conversation.type !== 'group') throw new AppError('会话不存在', 404)
  return membership
}

function assertGroupRole(membership: { role: string }, level: 'admin' | 'owner'): void {
  const ok = level === 'owner'
    ? membership.role === 'owner'
    : membership.role === 'owner' || membership.role === 'admin'
  if (!ok) {
    throw new AppError(level === 'owner' ? '只有群主可以执行该操作' : '需要群主或管理员权限', 403)
  }
}

/** 大群受保护：成员 / 名称 / 解散等只能由 bigGroup 服务维护 */
async function assertNotBigGroup(conversationId: number): Promise<void> {
  const bigGroupId = await getBigGroupConversationId()
  if (bigGroupId !== null && conversationId === bigGroupId) {
    throw new AppError('官方大群成员由 LineWeb 自动维护', 403)
  }
}

function parseRoomId(req: Request): number {
  const id = Number.parseInt(req.params.id ?? '', 10)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('无效的群聊', 400)
  return id
}

/** nekoId 数组 → 活跃 LineWeb 用户 id 集合（非法 / 停用剔除） */
async function resolveMemberIds(nekoIds: number[]): Promise<number[]> {
  const linewebIds = [...new Set(nekoIds)]
    .map((id) => linewebIdOf(id))
    .filter((id): id is number => id !== null && id > 0)
  if (linewebIds.length === 0) return []
  const users = await prisma.user.findMany({
    where: { id: { in: linewebIds }, status: 'active' },
    select: { id: true },
  })
  return users.map((user) => user.id)
}

const roomCreateSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(30, '群名最长 30 个字符'),
  memberIds: z.array(z.number().int().positive()).min(1, '至少选择一位联系人').max(49),
})

// POST /api/chat/xmpp/rooms — 建群
router.post(
  '/rooms',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = roomCreateSchema.safeParse(req.body || {})
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message || '输入数据无效', 400)
    }
    const user = await currentUser(req)
    const memberUserIds = await resolveMemberIds(parsed.data.memberIds)
    const uniqueMemberIds = [...new Set(memberUserIds)].filter((id) => id !== user.id)
    if (uniqueMemberIds.length === 0) throw new AppError('至少选择一位联系人', 400)
    if (uniqueMemberIds.length + 1 > CHAT_GROUP_MEMBER_LIMIT) {
      throw new AppError(`群成员不能超过 ${CHAT_GROUP_MEMBER_LIMIT} 人`, 400)
    }
    const created = await prisma.conversation.create({
      data: {
        type: 'group',
        name: parsed.data.name,
        ownerId: user.id,
        members: {
          create: [
            { userId: user.id, role: 'owner' },
            ...uniqueMemberIds.map((id) => ({ userId: id, role: 'member' })),
          ],
        },
      },
      select: { id: true },
    })
    await emitRoomUpdate(created.id)
    res.json({ ok: true, roomId: created.id })
  }),
)

// POST /api/chat/xmpp/rooms/:id/members — 加人 / 踢人（群主/管理员；大群禁改）
router.post(
  '/rooms/:id/members',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await assertNotBigGroup(roomId)
    assertGroupRole(membership, 'admin')

    const body = (req.body || {}) as { addIds?: unknown; removeIds?: unknown }
    const normalize = (value: unknown): number[] =>
      Array.isArray(value)
        ? [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n > 0))]
        : []
    const addIds = normalize(body.addIds)
    const removeIds = normalize(body.removeIds)

    if (addIds.length > 0) {
      const memberUserIds = await resolveMemberIds(addIds)
      const existing = new Set(membership.conversation.members.map((member) => member.userId))
      const toAdd = memberUserIds.filter((id) => id !== userId && !existing.has(id))
      if (existing.size + toAdd.length > CHAT_GROUP_MEMBER_LIMIT) {
        throw new AppError(`群成员不能超过 ${CHAT_GROUP_MEMBER_LIMIT} 人`, 400)
      }
      if (toAdd.length > 0) {
        await prisma.conversationMember.createMany({
          data: toAdd.map((id) => ({ conversationId: roomId, userId: id, role: 'member' })),
        })
      }
    }
    if (removeIds.length > 0) {
      const removeUserIds = await resolveMemberIds(removeIds)
      const removable = removeUserIds.filter((id) => {
        const target = membership.conversation.members.find((member) => member.userId === id)
        return !!target && target.role !== 'owner' && id !== userId
      })
      if (removable.length > 0) {
        await prisma.conversationMember.deleteMany({
          where: { conversationId: roomId, userId: { in: removable } },
        })
      }
    }
    await emitRoomUpdate(roomId)
    res.json({ ok: true })
  }),
)

const roomNameSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(30, '群名最长 30 个字符'),
})

// POST /api/chat/xmpp/rooms/:id/name — 改群名（群主）
router.post(
  '/rooms/:id/name',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = roomNameSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || '输入数据无效', 400)
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await assertNotBigGroup(roomId)
    assertGroupRole(membership, 'owner')
    await prisma.conversation.update({ where: { id: roomId }, data: { name: parsed.data.name } })
    await emitRoomUpdate(roomId)
    res.json({ ok: true })
  }),
)

// POST /api/chat/xmpp/rooms/:id/leave — 退群（群主请先解散；大群不可退）
router.post(
  '/rooms/:id/leave',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await assertNotBigGroup(roomId)
    if (membership.role === 'owner') {
      throw new AppError('群主不能退出群聊，请先解散群聊', 400)
    }
    await prisma.conversationMember.deleteMany({ where: { conversationId: roomId, userId } })
    await emitRoomUpdate(roomId)
    res.json({ ok: true })
  }),
)

const roleSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(['admin', 'member']),
})

// POST /api/chat/xmpp/rooms/:id/role — 设置/撤销管理员（群主）
router.post(
  '/rooms/:id/role',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = roleSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('输入数据无效', 400)
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await assertNotBigGroup(roomId)
    assertGroupRole(membership, 'owner')
    const targetNekoId = linewebIdOf(parsed.data.userId)
    if (!targetNekoId || targetNekoId === userId) throw new AppError('无效的成员', 400)
    const target = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: roomId, userId: targetNekoId } },
    })
    if (!target || target.role === 'owner') throw new AppError('无效的成员', 404)
    await prisma.conversationMember.update({
      where: { id: target.id },
      data: { role: parsed.data.role },
    })
    await emitRoomUpdate(roomId)
    res.json({ ok: true })
  }),
)

const transferSchema = z.object({ userId: z.number().int().positive() })

// POST /api/chat/xmpp/rooms/:id/transfer — 转让群主（群主）
router.post(
  '/rooms/:id/transfer',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = transferSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('输入数据无效', 400)
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await assertNotBigGroup(roomId)
    assertGroupRole(membership, 'owner')
    const targetNekoId = linewebIdOf(parsed.data.userId)
    if (!targetNekoId || targetNekoId === userId) throw new AppError('无效的成员', 400)
    const target = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: roomId, userId: targetNekoId } },
    })
    if (!target) throw new AppError('该用户不在群聊中', 404)
    await prisma.$transaction([
      prisma.conversation.update({ where: { id: roomId }, data: { ownerId: targetNekoId } }),
      prisma.conversationMember.update({ where: { id: target.id }, data: { role: 'owner' } }),
      prisma.conversationMember.update({
        where: { conversationId_userId: { conversationId: roomId, userId } },
        data: { role: 'member' },
      }),
    ])
    await emitRoomUpdate(roomId)
    res.json({ ok: true })
  }),
)

const muteSchema = z.object({
  userId: z.number().int().positive(),
  minutes: z.number().int().min(1).max(60 * 24 * 30).optional(),
})

// POST /api/chat/xmpp/rooms/:id/mute — 禁言成员（群主/管理员；minutes 缺省=解除）
router.post(
  '/rooms/:id/mute',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = muteSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('输入数据无效', 400)
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await assertNotBigGroup(roomId)
    assertGroupRole(membership, 'admin')
    const targetNekoId = linewebIdOf(parsed.data.userId)
    if (!targetNekoId || targetNekoId === userId) throw new AppError('无效的成员', 400)
    const target = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: roomId, userId: targetNekoId } },
    })
    if (!target || target.role === 'owner') throw new AppError('无效的成员', 404)
    await prisma.conversationMember.update({
      where: { id: target.id },
      data: { mutedUntil: parsed.data.minutes ? new Date(Date.now() + parsed.data.minutes * 60_000) : null },
    })
    await emitRoomUpdate(roomId)
    res.json({ ok: true })
  }),
)

const muteAllSchema = z.object({ muted: z.boolean().optional() })

// POST /api/chat/xmpp/rooms/:id/mute-all — 全员禁言开关（群主/管理员）
router.post(
  '/rooms/:id/mute-all',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    assertGroupRole(membership, 'admin')
    const body = muteAllSchema.safeParse(req.body || {})
    const next = body.success && typeof body.data.muted === 'boolean'
      ? body.data.muted
      : !membership.conversation.allMuted
    await prisma.conversation.update({ where: { id: roomId }, data: { allMuted: next } })
    await emitRoomUpdate(roomId)
    res.json({ ok: true, allMuted: next })
  }),
)

// POST /api/chat/xmpp/rooms/:id/mute-notify — 只提醒 @我（本人开关）
router.post(
  '/rooms/:id/mute-notify',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await prisma.conversationMember.update({
      where: { id: membership.id },
      data: { notifyMuted: !membership.notifyMuted },
    })
    res.json({ ok: true, notifyMuted: !membership.notifyMuted })
  }),
)

const announcementSchema = z.object({
  text: z.string().max(CHAT_ANNOUNCEMENT_MAX, `公告最长 ${CHAT_ANNOUNCEMENT_MAX} 个字符`),
  ackRequired: z.boolean().optional(),
})

// POST /api/chat/xmpp/rooms/:id/announcement — 保存/清除群公告（群主/管理员）
router.post(
  '/rooms/:id/announcement',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = announcementSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || '输入数据无效', 400)
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    assertGroupRole(membership, 'admin')
    const text = parsed.data.text.trim()
    await prisma.conversation.update({
      where: { id: roomId },
      data: {
        announcementText: text || null,
        announcementUpdatedAt: new Date(),
        announcementAckRequired: text ? !!parsed.data.ackRequired : false,
      },
    })
    await emitRoomUpdate(roomId)
    res.json({ ok: true })
  }),
)

// POST /api/chat/xmpp/rooms/:id/announcement-ack — 确认当前公告（只写自己的成员行）
router.post(
  '/rooms/:id/announcement-ack',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    const now = new Date()
    await prisma.conversationMember.update({
      where: { id: membership.id },
      data: { announcementConfirmedAt: now },
    })
    res.json({ ok: true, announcementConfirmedAt: now.getTime() })
  }),
)

// POST /api/chat/xmpp/rooms/:id/disband — 解散（群主；大群不可解散）
router.post(
  '/rooms/:id/disband',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const roomId = parseRoomId(req)
    const userId = currentUserId(req)
    const membership = await requireGroupMembership(roomId, userId)
    await assertNotBigGroup(roomId)
    assertGroupRole(membership, 'owner')
    const memberIds = membership.conversation.members.map((member) => member.userId)

    // best-effort 清理该会话图片文件（旧存档 imagePath + 新 ChatUpload 引用）
    await cleanupConversationUploads(roomId).catch(() => {})

    await prisma.conversation.delete({ where: { id: roomId } })
    // 会话已删除：逐个成员会话广播刷新事件（不能再用 emitRoomUpdate 按会话查人）
    for (const memberId of memberIds) {
      sendToUserSessions(memberId, roomHeadlineXml(roomId))
    }
    res.json({ ok: true })
  }),
)

/** 解散时清理会话图片：ChatUpload 引用计数 + 旧 imagePath 直删（best-effort） */
async function cleanupConversationUploads(conversationId: number): Promise<void> {
  if (!isNodeConnected()) return
  const messages = await prisma.message.findMany({
    where: { conversationId },
    select: { uploadId: true, imagePath: true, recalledAt: true },
  })
  const paths = new Set<string>()
  const uploadIds = new Set<string>()
  for (const message of messages) {
    if (message.imagePath) paths.add(message.imagePath)
    if (message.uploadId && !message.recalledAt) uploadIds.add(message.uploadId)
  }
  // 被其它会话引用的上传不删文件
  for (const uploadId of uploadIds) {
    const otherRefs = await prisma.message.count({
      where: { uploadId, conversationId: { not: conversationId }, recalledAt: null },
    })
    if (otherRefs > 0) continue
    const upload = await prisma.chatUpload.findUnique({ where: { id: uploadId }, select: { path: true } })
    if (upload?.path) paths.add(upload.path)
    await prisma.chatUpload.deleteMany({ where: { id: uploadId } }).catch(() => {})
  }
  for (const path of paths) {
    await sendCommand({ type: 'delete_file', path }).catch(() => {})
  }
}

// === 置顶 / 撤回 ===

const pinSchema = z.object({
  kind: z.enum(['friend', 'room']),
  id: z.number().int().positive(),
  pinned: z.boolean(),
})

// POST /api/chat/xmpp/pins — 置顶会话（kind: friend=nekoId / room=会话 id）
router.post(
  '/pins',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = pinSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的会话', 400)
    const userId = currentUserId(req)
    if (parsed.data.kind === 'friend') {
      const linewebId = linewebIdOf(parsed.data.id)
      if (!linewebId || linewebId === userId) throw new AppError('无效的联系人', 400)
      const conversation = await prisma.conversation.findUnique({
        where: { directKey: `${Math.min(userId, linewebId)}:${Math.max(userId, linewebId)}` },
        select: { id: true },
      })
      if (!conversation) throw new AppError('会话不存在', 404)
      await prisma.conversationMember.updateMany({
        where: { conversationId: conversation.id, userId },
        data: { pinned: parsed.data.pinned },
      })
    } else {
      const membership = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId: parsed.data.id, userId } },
      })
      if (!membership) throw new AppError('会话不存在', 404)
      await prisma.conversationMember.update({
        where: { id: membership.id },
        data: { pinned: parsed.data.pinned },
      })
    }
    res.json({ ok: true })
  }),
)

const recallSchema = z.object({ id: z.number().int().positive() })

// POST /api/chat/xmpp/messages/recall — 撤回（5 分钟内、仅本人）
router.post(
  '/messages/recall',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = recallSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的消息', 400)
    await recallMessageRest(currentUserId(req), parsed.data.id, false)
    res.json({ ok: true })
  }),
)

// POST /api/chat/xmpp/messages/admin-recall — 群主/管理员撤回群内任意消息
router.post(
  '/messages/admin-recall',
  chatWriteLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = recallSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('无效的消息', 400)
    await recallMessageRest(currentUserId(req), parsed.data.id, true)
    res.json({ ok: true })
  }),
)

// === 图片上传 ===

/**
 * 客户端直接 POST 图片字节（raw body），Content-Type 只用于让 express.raw 收下整块
 * 请求体，真实类型按魔数判定。PNG/JPEG → sharp 归一化为 WebP；GIF/WebP 原样保留
 * （动图不丢帧）。配额按「上传」计费（ChatUpload.size，见 driveQuota），写后复核。
 */
const rawChatImage = express.raw({
  type: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  limit: UPLOAD_MAX_BYTES,
})

function receiveRawChatImage(req: Request, res: Response, next: () => void): void {
  rawChatImage(req, res, (err?: unknown) => {
    if (!err) {
      next()
      return
    }
    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode
    const tooLarge = status === 413
    res
      .status(tooLarge ? 413 : 400)
      .json({ error: tooLarge ? '图片不能超过 8MB' : '图片上传失败' })
  })
}

router.post(
  '/uploads',
  receiveRawChatImage,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = currentUserId(req)
    const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
    if (buffer.length === 0) throw new AppError('图片上传失败', 400)
    const sourceMime = sniffImageMime(buffer)
    if (!sourceMime) throw new AppError('仅支持 PNG/JPEG/GIF/WebP 图片', 415)
    if (!isNodeConnected()) throw new AppError('存储节点未接入，暂时无法上传图片', 503)

    let data = buffer
    let mime = sourceMime
    if (sourceMime === 'image/png' || sourceMime === 'image/jpeg') {
      const processed = await sharp(buffer)
        .rotate()
        .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true })
        .catch((err: unknown) => {
          console.warn('[chatXmpp] 图片处理失败:', err)
          throw new AppError('图片处理失败，请换一张图片重试', 400)
        })
      if (processed.data.length > CHAT_IMAGE_MAX_PROCESSED_BYTES) {
        throw new AppError('图片处理失败，请换一张图片重试', 400)
      }
      data = processed.data
      mime = 'image/webp'
    }

    const uploadId = newUploadId()
    const path = uploadPathOf(uploadId, mime)
    try {
      const chunks = (async function* () { yield data })()
      await streamWriteBinary(path, chunks, data.length)
    } catch (err) {
      console.error('[chatXmpp] 写入存储节点失败:', err)
      throw new AppError('图片保存失败，请稍后重试', 502)
    }

    const upload = await prisma.chatUpload.create({
      data: { id: uploadId, ownerId: userId, path, mime, size: data.length },
    })

    // 写后复核配额（先落库保证复核能看到本张图；超限回滚 + 删节点文件）
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, storageQuota: true },
    })
    if (!user) throw new AppError('用户不存在', 401)
    const quota = await getDriveQuota({
      userId: user.id,
      role: user.role,
      storageQuota: user.storageQuota,
    })
    if (!quota.unlimited && quota.quota !== null) {
      const usedAfter = await getDriveUsage(userId)
      if (usedAfter > quota.quota) {
        await prisma.chatUpload.delete({ where: { id: upload.id } }).catch(() => {})
        await sendCommand({ type: 'delete_file', path }).catch(() => {})
        throw new ChatImageLimitError('网盘空间不足', 'QUOTA_EXCEEDED', {
          quota: quota.quota,
          used: usedAfter,
          remaining: 0n,
        })
      }
    }

    res.json({ ok: true, url: `/chat/uploads/${uploadId}`, id: uploadId, mime })
  }),
)

// ChatImageLimitError 由 errorHandler 按 body 输出（与 drive.ts 413 结构一致）
router.use(((err: unknown, _req: Request, res: Response, next: (arg?: unknown) => void) => {
  if (err instanceof ChatImageLimitError) {
    res.status(413).json(chatImageLimitBody(err))
    return
  }
  next(err)
}) as express.ErrorRequestHandler)

// === HTTP 长轮询降级（无 WebSocket 时使用；与 /ws/xmpp 同一状态机） ===

router.post(
  '/http-session',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = currentUserId(req)
    const sessionId = createPollingSession(userId)
    res.json({ sessionId })
  }),
)

router.post(
  '/http-stanza',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body || {}) as { sessionId?: unknown; stanza?: unknown }
    if (typeof body.stanza !== 'string' || Buffer.byteLength(body.stanza) > STANZA_MAX_BYTES) {
      throw new AppError('stanza 无效', 400)
    }
    if (typeof body.sessionId !== 'string' || !body.sessionId) throw new AppError('缺少 sessionId', 400)
    const userId = currentUserId(req)
    const ok = await feedStanza(body.sessionId, userId, body.stanza)
    if (!ok) throw new AppError('长轮询会话已失效，请重连', 403)
    res.status(204).end()
  }),
)

router.post(
  '/http-close',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body || {}) as { sessionId?: unknown }
    if (typeof body.sessionId === 'string' && body.sessionId) {
      closePollingSession(body.sessionId, currentUserId(req))
    }
    res.status(204).end()
  }),
)

// 长轮询挂 25 秒；压缩必须排除（见 index.ts）
router.get(
  '/http-poll',
  asyncHandler(async (req: Request, res: Response) => {
    const sessionId = String(req.query.sessionId || '')
    if (!sessionId) throw new AppError('缺少 sessionId', 400)
    const stanza = await pollStanza(sessionId, currentUserId(req))
    res.json(stanza ? { stanza } : {})
  }),
)

// === 积分红包（单聊专属 / 群聊拼手气；金额走统一积分，账本落 red_packets） ===

function parseRedPacketId(req: Request): number {
  const id = Number.parseInt(req.params.id ?? '', 10)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('无效的红包', 400)
  return id
}

const redPacketCreateSchema = z.object({
  peer: z.number().int().positive().optional(),
  roomId: z.number().int().positive().optional(),
  totalPoints: z.number().int(),
  count: z.number().int().optional(),
  type: z.enum(['single', 'lucky']),
  greeting: z.string().max(200).optional(),
})

// POST /api/chat/xmpp/redpackets — 发红包（专属/拼手气）
// { peer?: 联系人 id(nekoId), roomId?: 群会话 id, totalPoints, count?, type, greeting? }
router.post(
  '/redpackets',
  chatWriteLimiter,
  requireFeature('redpacket'),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = redPacketCreateSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError('红包参数无效', 400)
    const created = await createRedPacket(currentUserId(req), parsed.data)
    res.json(created)
  }),
)

// GET /api/chat/xmpp/redpackets/:id — 详情（含过期惰性结算与领取名单）
router.get(
  '/redpackets/:id',
  chatWriteLimiter,
  requireFeature('redpacket'),
  asyncHandler(async (req: Request, res: Response) => {
    const view = await getRedPacketView(currentUserId(req), parseRedPacketId(req))
    res.json(view)
  }),
)

// POST /api/chat/xmpp/redpackets/:id/claim — 领取
router.post(
  '/redpackets/:id/claim',
  chatWriteLimiter,
  requireFeature('redpacket'),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await claimRedPacket(currentUserId(req), parseRedPacketId(req))
    res.json(result)
  }),
)

export default router
