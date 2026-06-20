import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { config, registerSchema, loginSchema } from '../config/index.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()

// 注册
router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }

  const { username, email, password } = parsed.data
  const exists = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  })
  if (exists) {
    res.status(409).json({ error: '用户名或邮箱已被注册' })
    return
  }

  const hashed = await bcrypt.hash(password, 12)
  const user = await prisma.user.create({
    data: { username, email, password: hashed },
  })

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )

  res.status(201).json({
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  })
})

// 登录
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效' })
    return
  }

  const { email, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    res.status(401).json({ error: '邮箱或密码错误' })
    return
  }

  const valid = await bcrypt.compare(password, user.password)
  if (!valid) {
    res.status(401).json({ error: '邮箱或密码错误' })
    return
  }

  const token = jwt.sign(
    { userId: user.id, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )

  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email, role: user.role },
  })
})

// 获取当前用户信息
router.get('/me', authenticate, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { id: true, username: true, email: true, role: true, createdAt: true },
  })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }
  res.json(user)
})

export default router
