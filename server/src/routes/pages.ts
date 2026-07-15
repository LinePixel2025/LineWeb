import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma.js'
import { parsePagination, parseId } from '../lib/utils.js'
import { pageSchema, pageUpdateSchema } from '../config/index.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'

const router = Router()

/* 路由注册顺序：
   1. GET  /featured     — 公开接口：获取所有在功能界面展示的页面
   2. GET  /slug/:slug   — 公开接口：按 slug 获取已发布页面
   3. GET  /             — 管理面板：获取页面列表（分页）
   4. POST /             — 创建页面
   5. GET  /:id          — 管理面板：按 ID 获取页面完整内容
   6. PUT  /:id          — 更新页面
   7. DELETE /:id        — 删除页面
*/

// 1. 公开接口：获取所有在功能界面展示的已发布页面
router.get('/featured', asyncHandler(async (req: Request, res: Response) => {
  const pages = await prisma.page.findMany({
    where: { published: true, featured: true },
    select: {
      id: true, title: true, slug: true,
      featureEmoji: true, featureDesc: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  res.json({ pages })
}))

// 2. 公开接口：按 slug 获取已发布页面
router.get('/slug/:slug', asyncHandler(async (req: Request, res: Response) => {
  const page = await prisma.page.findUnique({
    where: { slug: req.params.slug, published: true },
    select: { id: true, title: true, slug: true, schema: true, createdAt: true, updatedAt: true },
  })
  if (!page) {
    res.status(404).json({ error: '页面不存在' })
    return
  }
  res.json(page)
}))

// 3. 管理面板：获取页面列表（分页）
router.get('/', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)

  const [pages, total] = await Promise.all([
    prisma.page.findMany({
      select: {
        id: true, title: true, slug: true,
        published: true, featured: true,
        featureEmoji: true, featureDesc: true,
        createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.page.count(),
  ])

  res.json({ pages, total, page, limit, totalPages: Math.ceil(total / limit) })
}))

// 4. 创建页面
router.post('/', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const parsed = pageSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const slugExists = await prisma.page.findUnique({ where: { slug: parsed.data.slug } })
  if (slugExists) {
    res.status(409).json({ error: '该 slug 已被使用' })
    return
  }

  const page = await prisma.page.create({
    data: parsed.data,
  })
  res.status(201).json(page)
}))

// 5. 管理面板：按 ID 获取页面完整内容
router.get('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  const page = await prisma.page.findUnique({ where: { id } })

  if (!page) {
    res.status(404).json({ error: '页面不存在' })
    return
  }

  res.json(page)
}))

// 6. 更新页面
router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  const parsed = pageUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  if (parsed.data.slug) {
    const existing = await prisma.page.findFirst({
      where: { slug: parsed.data.slug, NOT: { id } },
    })
    if (existing) {
      res.status(409).json({ error: '该 slug 已被使用' })
      return
    }
  }

  const page = await prisma.page.update({
    where: { id },
    data: parsed.data,
  })
  res.json(page)
}))

// 7. 删除页面
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  await prisma.page.delete({ where: { id } })
  res.json({ message: '已删除' })
}))

export default router
