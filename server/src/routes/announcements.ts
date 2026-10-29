import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'

/**
 * 站点公告（LineWeb 自有）
 *
 * 与 neko XMPP 的群公告是两套东西：
 *   - 群公告的数据在聊天服务，按群维护、群主/管理员可编辑；
 *   - 这里的公告是站点级广播，管理员发布，全站顶部公告条 + 聊天页「站点公告」入口展示。
 */

const LEVELS = ['info', 'success', 'warning', 'danger'] as const

const announcementSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(80, '标题最长 80 个字符'),
  content: z.string().trim().min(1, '内容不能为空').max(5000, '内容最长 5000 个字符'),
  level: z.enum(LEVELS).default('info'),
  isActive: z.boolean().default(true),
  isPinned: z.boolean().default(false),
  // 新公告默认要求用户点「我已知晓」；存量公告保持不打扰（DB 默认 false）
  requireAck: z.boolean().default(true),
})

/**
 * 局部更新：不能复用 announcementSchema.partial()——字段上的 .default()
 * 会在部分更新（如只切 isActive）时把 level/isPinned 重置为默认值。
 */
const announcementUpdateSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(80, '标题最长 80 个字符').optional(),
  content: z.string().trim().min(1, '内容不能为空').max(5000, '内容最长 5000 个字符').optional(),
  level: z.enum(LEVELS).optional(),
  isActive: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  requireAck: z.boolean().optional(),
})

const selectFields = {
  id: true,
  title: true,
  content: true,
  level: true,
  isActive: true,
  isPinned: true,
  requireAck: true,
  authorId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, username: true } },
} as const

function parseId(value: string): number {
  const id = Number.parseInt(value, 10)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('无效的公告 ID', 400)
  return id
}

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 登录用户读取：只返回已发布（isActive）的公告，并附带本人确认时间 */
export const announcementsRouter = Router()
announcementsRouter.use(authenticate)
announcementsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = currentUserId(req)
    const rows = await prisma.siteAnnouncement.findMany({
      where: { isActive: true },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: {
        ...selectFields,
        acknowledgements: {
          where: { userId },
          select: { acknowledgedAt: true },
          take: 1,
        },
      },
    })
    const announcements = rows.map(({ acknowledgements, ...row }) => ({
      ...row,
      acknowledgedAt: acknowledgements[0]?.acknowledgedAt?.toISOString() ?? null,
    }))
    res.json({ announcements })
  }),
)

// POST /api/announcements/:id/ack — 确认已知晓（只写自己的确认记录，幂等）
announcementsRouter.post(
  '/:id/ack',
  asyncHandler(async (req: Request, res: Response) => {
    const userId = currentUserId(req)
    const id = parseId(req.params.id)
    const exists = await prisma.siteAnnouncement.findFirst({
      where: { id, isActive: true },
      select: { id: true },
    })
    if (!exists) throw new AppError('公告不存在或已下线', 404)
    const ack = await prisma.siteAnnouncementAck.upsert({
      where: { announcementId_userId: { announcementId: id, userId } },
      create: { announcementId: id, userId },
      update: {},
      select: { acknowledgedAt: true },
    })
    res.json({ acknowledgedAt: ack.acknowledgedAt.toISOString() })
  }),
)

/** 管理端：全量读写（content:manage = 管理员） */
export const adminAnnouncementsRouter = Router()
adminAnnouncementsRouter.use(authenticate, requireCapability('content:manage'))

adminAnnouncementsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const announcements = await prisma.siteAnnouncement.findMany({
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 200,
      select: selectFields,
    })
    res.json({ announcements })
  }),
)

adminAnnouncementsRouter.post(
  '/',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = announcementSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || '输入数据无效', 400)
    const announcement = await prisma.siteAnnouncement.create({
      data: { ...parsed.data, authorId: req.user?.userId ?? null },
      select: selectFields,
    })
    res.status(201).json({ announcement })
  }),
)

adminAnnouncementsRouter.put(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id)
    const parsed = announcementUpdateSchema.safeParse(req.body || {})
    if (!parsed.success) throw new AppError(parsed.error.issues[0]?.message || '输入数据无效', 400)
    const exists = await prisma.siteAnnouncement.findUnique({ where: { id }, select: { id: true } })
    if (!exists) throw new AppError('公告不存在', 404)
    const announcement = await prisma.siteAnnouncement.update({
      where: { id },
      data: parsed.data,
      select: selectFields,
    })
    res.json({ announcement })
  }),
)

adminAnnouncementsRouter.delete(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseId(req.params.id)
    const exists = await prisma.siteAnnouncement.findUnique({ where: { id }, select: { id: true } })
    if (!exists) throw new AppError('公告不存在', 404)
    await prisma.siteAnnouncement.delete({ where: { id } })
    res.status(204).end()
  }),
)
