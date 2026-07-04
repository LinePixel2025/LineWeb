import { Router, Request, Response } from 'express'
import crypto from 'crypto'
import prisma from '../lib/prisma.js'
import { parseId } from '../lib/utils.js'
import { config, createApiKeySchema, updateApiKeySchema } from '../config/index.js'
import { authenticate, requireAdmin } from '../middleware/auth.js'

const router = Router()

router.use(authenticate, requireAdmin)

function generateApiKey(): { fullKey: string; prefix: string } {
  const randomBytes = crypto.randomBytes(config.apiKeyLength)
  const raw = randomBytes
    .toString('base64url')
    .slice(0, config.apiKeyLength)
  const fullKey = `${config.apiKeyPrefix}${raw}`
  const prefix = fullKey.slice(0, 8) + '...'
  return { fullKey, prefix }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createApiKeySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors })
      return
    }

    const { name, expiresAt } = parsed.data
    const { fullKey, prefix } = generateApiKey()

    const keyRecord = await prisma.apiKey.create({
      data: {
        name,
        key: fullKey,
        prefix,
        userId: req.user!.userId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
      select: {
        id: true,
        name: true,
        key: true,
        prefix: true,
        active: true,
        expiresAt: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
    })

    res.status(201).json(keyRecord)
  } catch (err) {
    console.error('创建 API Key 失败:', err)
    res.status(500).json({ error: '创建 API Key 失败' })
  }
})

router.get('/', async (_req: Request, res: Response) => {
  try {
    const keys = await prisma.apiKey.findMany({
      select: {
        id: true,
        name: true,
        prefix: true,
        active: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        user: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    res.json(keys)
  } catch (err) {
    console.error('获取 API Key 列表失败:', err)
    res.status(500).json({ error: '获取 API Key 列表失败' })
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的 ID' })
      return
    }

    const keyRecord = await prisma.apiKey.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        prefix: true,
        active: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true } },
      },
    })

    if (!keyRecord) {
      res.status(404).json({ error: 'API Key 不存在' })
      return
    }

    res.json(keyRecord)
  } catch (err) {
    console.error('获取 API Key 失败:', err)
    res.status(500).json({ error: '获取 API Key 失败' })
  }
})

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的 ID' })
      return
    }

    const existing = await prisma.apiKey.findUnique({ where: { id } })
    if (!existing) {
      res.status(404).json({ error: 'API Key 不存在' })
      return
    }

    const parsed = updateApiKeySchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten().fieldErrors })
      return
    }

    const { name, active, expiresAt } = parsed.data
    const data: Record<string, unknown> = {}
    if (name !== undefined) data.name = name
    if (active !== undefined) data.active = active
    if (expiresAt !== undefined) {
      data.expiresAt = expiresAt === null ? null : new Date(expiresAt)
    }

    const updated = await prisma.apiKey.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        prefix: true,
        active: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, username: true } },
      },
    })

    res.json(updated)
  } catch (err) {
    console.error('更新 API Key 失败:', err)
    res.status(500).json({ error: '更新 API Key 失败' })
  }
})

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的 ID' })
      return
    }

    const existing = await prisma.apiKey.findUnique({ where: { id } })
    if (!existing) {
      res.status(404).json({ error: 'API Key 不存在' })
      return
    }

    await prisma.apiKey.delete({ where: { id } })
    res.json({ message: '已删除' })
  } catch (err) {
    console.error('删除 API Key 失败:', err)
    res.status(500).json({ error: '删除 API Key 失败' })
  }
})

export default router
