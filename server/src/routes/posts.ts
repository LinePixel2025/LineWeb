import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma.js'
import { parsePagination, parseId } from '../lib/utils.js'
import { postSchema, postUpdateSchema } from '../config/index.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = Router()

// 获取公开文章列表
router.get('/', async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      where: { published: true },
      select: { id: true, title: true, summary: true, slug: true, createdAt: true, updatedAt: true, author: { select: { username: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.post.count({ where: { published: true } }),
  ])

  res.json({ posts, total, page, limit, totalPages: Math.ceil(total / limit) })
})

// 获取单篇文章（公开）
router.get('/:slug', async (req: Request, res: Response) => {
  const post = await prisma.post.findUnique({
    where: { slug: req.params.slug, published: true },
    select: { id: true, title: true, content: true, summary: true, slug: true, createdAt: true, updatedAt: true, author: { select: { username: true } } },
  })
  if (!post) {
    res.status(404).json({ error: '文章不存在' })
    return
  }
  res.json(post)
})

// 管理面板：获取所有文章（含未发布）
router.get('/admin/all', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)

  const [posts, total] = await Promise.all([
    prisma.post.findMany({
      select: { id: true, title: true, summary: true, slug: true, published: true, createdAt: true, updatedAt: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.post.count(),
  ])

  res.json({ posts, total, page, limit, totalPages: Math.ceil(total / limit) })
})

// 管理面板：获取单篇文章
router.get('/admin/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  const post = await prisma.post.findUnique({
    where: { id },
    select: { id: true, title: true, content: true, summary: true, slug: true, published: true, createdAt: true, updatedAt: true },
  })

  if (!post) {
    res.status(404).json({ error: '文章不存在' })
    return
  }

  res.json(post)
})

// 创建文章
router.post('/', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const parsed = postSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const slugExists = await prisma.post.findUnique({ where: { slug: parsed.data.slug } })
  if (slugExists) {
    res.status(409).json({ error: '该 slug 已被使用' })
    return
  }

  const post = await prisma.post.create({
    data: { ...parsed.data, authorId: req.user!.userId },
  })
  res.status(201).json(post)
})

// 更新文章
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  const parsed = postUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  if (parsed.data.slug) {
    const existing = await prisma.post.findFirst({
      where: { slug: parsed.data.slug, NOT: { id } },
    })
    if (existing) {
      res.status(409).json({ error: '该 slug 已被使用' })
      return
    }
  }

  const post = await prisma.post.update({
    where: { id },
    data: parsed.data,
  })
  res.json(post)
})

// 删除文章
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  await prisma.post.delete({ where: { id } })
  res.json({ message: '已删除' })
})

export default router
