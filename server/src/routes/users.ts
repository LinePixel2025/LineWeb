import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import prisma from '../lib/prisma.js'
import { parsePagination, parseId } from '../lib/utils.js'
import { updateUserSchema } from '../config/index.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = Router()

// 所有路由需要管理员权限
router.use(authenticate, requireAdmin)

// 列出用户（分页）
router.get('/', async (req: Request, res: Response) => {
  const { page, limit, skip } = parsePagination(req.query)

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      skip,
      take: limit,
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count(),
  ])

  res.json({
    users,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  })
})

// 查看单个用户
router.get('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
    },
  })

  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  res.json(user)
})

// 更新用户（角色 / 密码）
router.put('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const parsed = updateUserSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  // 自保护：不能修改自己的角色
  if (req.user!.userId === id && parsed.data.role) {
    res.status(400).json({ error: '不能修改自己的角色' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  const data: { role?: string; password?: string } = {}
  if (parsed.data.role) data.role = parsed.data.role
  if (parsed.data.password) {
    data.password = await bcrypt.hash(parsed.data.password, 12)
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      createdAt: true,
    },
  })

  res.json(updated)
})

// 删除用户（级联删除其评论和文章）
router.delete('/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  // 自保护：不能删除自己
  if (req.user!.userId === id) {
    res.status(400).json({ error: '不能删除自己' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  // 使用事务：先删除评论，再删除文章，最后删除用户
  await prisma.$transaction([
    prisma.comment.deleteMany({ where: { authorId: id } }),
    prisma.post.deleteMany({ where: { authorId: id } }),
    prisma.user.delete({ where: { id } }),
  ])

  res.json({ message: '已删除' })
})

export default router
