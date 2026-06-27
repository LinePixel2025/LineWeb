import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma.js'
import { parsePagination, parseId } from '../lib/utils.js'
import { commentSchema, commentUpdateSchema } from '../config/index.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = Router()

// 将扁平评论列表构建为树状结构
function buildCommentTree<T extends { id: number; parentId: number | null }>(comments: T[]) {
  const topLevel = comments.filter(c => !c.parentId)
  const childMap = new Map<number, T[]>()
  for (const c of comments) {
    if (c.parentId) {
      const children = childMap.get(c.parentId) || []
      children.push(c)
      childMap.set(c.parentId, children)
    }
  }
  return topLevel.map(c => ({
    ...c,
    replies: childMap.get(c.id) || [],
  }))
}

// 获取某篇文章的全部评论（公开）— 按树状结构返回
router.get('/post/:postId', async (req: Request, res: Response) => {
  const postId = parseId(req.params.postId)
  if (postId === null) {
    res.status(400).json({ error: '无效的文章 ID' })
    return
  }

  const allComments = await prisma.comment.findMany({
    where: { postId },
    select: {
      id: true,
      content: true,
      createdAt: true,
      parentId: true,
      author: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  res.json(buildCommentTree(allComments))
})

// 发表评论（需登录）
router.post('/', authenticate, async (req: Request, res: Response) => {
  const parsed = commentSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  // 检查文章是否存在
  const post = await prisma.post.findUnique({ where: { id: parsed.data.postId } })
  if (!post) {
    res.status(404).json({ error: '文章不存在' })
    return
  }

  // 如果指定了 parentId，检查父评论是否存在且属于同一篇文章
  if (parsed.data.parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: parsed.data.parentId } })
    if (!parent || parent.postId !== parsed.data.postId) {
      res.status(400).json({ error: '父评论不存在或不属于该文章' })
      return
    }
    // 只支持一级嵌套：回复的评论下面不能再回复
    if (parent.parentId !== null) {
      res.status(400).json({ error: '子评论下无法再回复' })
      return
    }
  }

  const comment = await prisma.comment.create({
    data: {
      content: parsed.data.content,
      postId: parsed.data.postId,
      authorId: req.user!.userId,
      parentId: parsed.data.parentId ?? null,
    },
    select: {
      id: true,
      content: true,
      createdAt: true,
      parentId: true,
      author: { select: { id: true, username: true } },
    },
  })

  res.status(201).json(comment)
})

// 管理面板：获取有评论的文章列表（按文章分组）
router.get('/admin/posts', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const comments = await prisma.comment.groupBy({
    by: ['postId'],
    _count: { id: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: 'desc' } },
  })

  // 获取文章标题信息
  const postIds = comments.map(c => c.postId)
  const posts = postIds.length > 0
    ? await prisma.post.findMany({
        where: { id: { in: postIds } },
        select: { id: true, title: true, slug: true },
      })
    : []

  const postMap = new Map(posts.map(p => [p.id, p]))

  const result = comments.map(c => ({
    postId: c.postId,
    title: postMap.get(c.postId)?.title ?? '(已删除)',
    slug: postMap.get(c.postId)?.slug ?? '',
    commentCount: c._count.id,
    latestAt: c._max.createdAt,
  }))

  res.json(result)
})

// 管理面板：获取某篇文章的全部评论（树状结构）
router.get('/admin/post/:postId', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const postId = parseId(req.params.postId)
  if (postId === null) {
    res.status(400).json({ error: '无效的文章 ID' })
    return
  }

  const [allComments, total] = await Promise.all([
    prisma.comment.findMany({
      where: { postId },
      select: {
        id: true,
        content: true,
        createdAt: true,
        updatedAt: true,
        parentId: true,
        author: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.comment.count({ where: { postId } }),
  ])

  res.json({ comments: buildCommentTree(allComments), total, postId })
})

// 编辑评论（管理员）
router.put('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  const parsed = commentUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const comment = await prisma.comment.findUnique({ where: { id } })
  if (!comment) {
    res.status(404).json({ error: '评论不存在' })
    return
  }

  const updated = await prisma.comment.update({
    where: { id },
    data: { content: parsed.data.content },
    select: {
      id: true,
      content: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, username: true } },
      post: { select: { id: true, title: true } },
    },
  })

  res.json(updated)
})

// 删除评论（管理员）
router.delete('/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效 ID' })
    return
  }

  const comment = await prisma.comment.findUnique({ where: { id } })
  if (!comment) {
    res.status(404).json({ error: '评论不存在' })
    return
  }

  await prisma.comment.delete({ where: { id } })
  res.json({ message: '评论已删除' })
})

export default router
