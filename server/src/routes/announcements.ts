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
})

const selectFields = {
  id: true,
  title: true,
  content: true,
  level: true,
  isActive: true,
  isPinned: true,
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

/** 登录用户读取：只返回已发布（isActive）的公告 */
export const announcementsRouter = Router()
announcementsRouter.use(authenticate)
announcementsRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const announcements = await prisma.siteAnnouncement.findMany({
      where: { isActive: true },
      orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
      select: selectFields,
    })
    res.json({ announcements })
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
    const parsed = announcementSchema.partial().safeParse(req.body || {})
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
