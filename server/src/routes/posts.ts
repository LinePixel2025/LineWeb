import { Router, Request, Response, NextFunction } from 'express'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import { postSchema, postUpdateSchema } from '../config/index.js'
import { parsePagination } from '../lib/utils.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import {
  getPublishedPosts, getPublishedPostBySlug,
  getAllPosts, getPostById, getPostAuthorId,
  createPost, updatePost, deletePost,
  isSlugTaken,
} from '../services/postService.js'

const router = Router()

/* ---------- 文章所有权 ----------
 * content:write：创建文章 + 管理「自己的」文章（作者 / 管理员都有）
 * content:manage：管理全站文章（页面管理也用它，目前为管理员专属）
 */

/** 当前账号是否具备全站内容管理能力 */
function canManageAllContent(req: Request): boolean {
  return req.user?.capabilities?.includes('content:manage') ?? false
}

/**
 * 校验当前账号能否操作某篇文章。
 *
 * 文章不存在（authorId === null）、或既非作者本人也无 content:manage 时，
 * 统一抛 404 而不是 403 —— 403 会暴露「文章确实存在」，作者身份之外的人
 * 不应能通过状态码探测他人文章。
 */
function assertPostAccessible(postAuthorId: number | null, req: Request): void {
  if (postAuthorId === null) {
    throw new AppError('文章不存在', 404)
  }
  if (canManageAllContent(req)) return
  if (postAuthorId === req.user!.userId) return
  throw new AppError('文章不存在', 404)
}

// 获取公开文章列表
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)
  const sort = req.query.sort === 'asc' ? 'asc' : 'desc'
  const search = typeof req.query.search === 'string' && req.query.search.trim()
    ? req.query.search.trim()
    : undefined
  const result = await getPublishedPosts(page, limit, skip, sort, search)
  res.json(result)
}))

// 获取单篇文章（公开）
router.get('/:slug', asyncHandler(async (req: Request, res: Response) => {
  const post = await getPublishedPostBySlug(req.params.slug)
  if (!post) {
    throw new AppError('文章不存在', 404)
  }
  res.json(post)
}))

// 管理面板：获取文章列表（含未发布）
// 有 content:manage 看全站，否则只返回自己创建的文章
router.get('/admin/all', authenticate, requireCapability('content:write'), asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)
  const authorId = canManageAllContent(req) ? undefined : req.user!.userId
  const result = await getAllPosts(page, limit, skip, authorId)
  res.json(result)
}))

// 管理面板：获取单篇文章（作者本人或 content:manage，否则 404）
router.get('/admin/:id', authenticate, requireCapability('content:write'), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    throw new AppError('无效 ID', 400)
  }

  const post = await getPostById(id)
  if (!post) {
    throw new AppError('文章不存在', 404)
  }

  assertPostAccessible(post.authorId, req)

  res.json(post)
}))

// 创建文章
router.post('/', authenticate, requireCapability('content:write'), asyncHandler(async (req: Request, res: Response) => {
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
}))

// 更新文章（作者本人或 content:manage）
router.put('/:id', authenticate, requireCapability('content:write'), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    throw new AppError('无效 ID', 400)
  }

  // 先做所有权校验：不存在或无权操作统一 404（避免泄露存在性）
  assertPostAccessible(await getPostAuthorId(id), req)

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
}))

// 删除文章（作者本人或 content:manage）
router.delete('/:id', authenticate, requireCapability('content:write'), asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id)
  if (isNaN(id)) {
    throw new AppError('无效 ID', 400)
  }

  assertPostAccessible(await getPostAuthorId(id), req)

  await deletePost(id)
  res.json({ message: '已删除' })
}))

export default router
