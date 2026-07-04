import { Router, Request, Response } from 'express'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'
import { postSchema, postUpdateSchema } from '../config/index.js'
import { parsePagination } from '../lib/utils.js'
import {
  getPublishedPosts, getPublishedPostBySlug,
  getAllPosts, getPostById,
  createPost, updatePost, deletePost,
  isSlugTaken,
} from '../services/postService.js'

const router = Router()

// 获取公开文章列表
router.get('/', async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)
  const result = await getPublishedPosts(page, limit, skip)
  res.json(result)
})

// 获取单篇文章（公开）
router.get('/:slug', async (req: Request, res: Response) => {
  const post = await getPublishedPostBySlug(req.params.slug)
  if (!post) {
    throw new AppError('文章不存在', 404)
  }
  res.json(post)
})

// 管理面板：获取所有文章（含未发布）
router.get('/admin/all', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)
  const result = await getAllPosts(page, limit, skip)
  res.json(result)
})

// 管理面板：获取单篇文章
router.get('/admin/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    throw new AppError('无效 ID', 400)
  }

  const post = await getPostById(id)
  if (!post) {
    throw new AppError('文章不存在', 404)
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

  const slugTaken = await isSlugTaken(parsed.data.slug)
  if (slugTaken) {
    throw new AppError('该 slug 已被使用', 409)
  }

  const post = await createPost(parsed.data, req.user!.userId)
  res.status(201).json(post)
})

// 更新文章
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    throw new AppError('无效 ID', 400)
  }

  const parsed = postUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  if (parsed.data.slug) {
    const slugTaken = await isSlugTaken(parsed.data.slug, id)
    if (slugTaken) {
      throw new AppError('该 slug 已被使用', 409)
    }
  }

  const post = await updatePost(id, parsed.data)
  res.json(post)
})

// 删除文章
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    throw new AppError('无效 ID', 400)
  }

  await deletePost(id)
  res.json({ message: '已删除' })
})

export default router
