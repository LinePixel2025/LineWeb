import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import {
  EMOJI_PACK_KEYS,
  getTodayDayStart,
  parseShopPayload,
  sanitizeTitleColor,
  sanitizeTitleIcon,
} from '../lib/pointsRules.js'
import {
  getPointsConfig,
  savePointsConfig,
  awardPointsTx,
} from '../services/pointsService.js'
import { farmCatalog, farmAdminStats } from '../services/farmService.js'

const router = Router()
router.use(authenticate, requireCapability('points:manage'))

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

function itemId(raw: string): number {
  const id = Number(raw)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('无效的商品 ID', 400)
  return id
}

const raritySchema = z.enum(['common', 'rare', 'epic', 'legendary'])

const payloadSchema = z.object({
  icon: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
  pack: z.string().max(30).optional(),
}).optional()

const shopCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{3,40}$/, 'key 只能是小写字母、数字、下划线（3–40 位）'),
  type: z.enum(['title', 'emoji']),
  name: z.string().trim().min(1).max(30),
  description: z.string().trim().max(200).optional(),
  cost: z.number().int().min(0).max(100_000),
  rarity: raritySchema.optional().default('common'),
  payload: payloadSchema,
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).max(100_000).optional().default(100),
})

const shopPatchSchema = z.object({
  name: z.string().trim().min(1).max(30).optional(),
  description: z.string().trim().max(200).nullable().optional(),
  cost: z.number().int().min(0).max(100_000).optional(),
  rarity: raritySchema.optional(),
  payload: payloadSchema,
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100_000).optional(),
})

const adjustSchema = z.object({
  amount: z.number().int().min(-100_000).max(100_000).refine((value) => value !== 0, '变动数量不能为 0'),
  note: z.string().trim().max(100).optional(),
})

/** 把管理员提交的 payload 规范成存库 JSON（称号颜色/图标消毒，表情包只收白名单） */
function normalizePayload(type: string, payload: { icon?: string; color?: string; pack?: string } | undefined): string | null {
  if (!payload) return type === 'title' ? JSON.stringify({ icon: '', color: '#57606a' }) : null
  if (type === 'emoji') {
    const pack = payload.pack?.trim()
    if (!pack || !(EMOJI_PACK_KEYS as readonly string[]).includes(pack)) {
      throw new AppError(`表情包必须是：${EMOJI_PACK_KEYS.join(' / ')}`, 400)
    }
    return JSON.stringify({ pack })
  }
  return JSON.stringify({
    icon: sanitizeTitleIcon(payload.icon),
    color: sanitizeTitleColor(payload.color),
  })
}

function serializeItem(item: {
  id: number
  key: string
  type: string
  name: string
  description: string | null
  cost: number
  rarity: string
  payload: string | null
  isActive: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
  _count?: { owners: number }
}) {
  return {
    ...item,
    payload: parseShopPayload(item.payload),
    ownerCount: item._count?.owners ?? 0,
  }
}

// GET /api/admin/points — 规则 + 商品 + 统计
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const dayStart = getTodayDayStart()
  const [config, items, stats, farmStats, totals, todayAward] = await Promise.all([
    getPointsConfig(),
    prisma.pointsShopItem.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }],
      include: { _count: { select: { owners: true } } },
    }),
    prisma.user.count(),
    farmAdminStats(),
    prisma.user.aggregate({ _sum: { points: true, pointsEarned: true } }),
    prisma.pointsLedger.aggregate({
      where: { reason: 'game_result', amount: { gt: 0 }, createdAt: { gte: dayStart } },
      _sum: { amount: true },
      _count: true,
    }),
  ])

  res.json({
    config,
    items: items.map(serializeItem),
    catalog: farmCatalog(),
    emojiPacks: EMOJI_PACK_KEYS,
    stats: {
      users: stats,
      farms: farmStats.farms,
      totalPlanted: farmStats.totalPlanted,
      totalSteals: farmStats.totalSteals,
      totalPoints: totals._sum.points ?? 0,
      totalEarned: totals._sum.pointsEarned ?? 0,
      todayGamePoints: todayAward._sum.amount ?? 0,
      todayGameResults: todayAward._count ?? 0,
    },
  })
}))

// PUT /api/admin/points/config — 保存全部游戏规则 + 农场参数
router.put('/config', asyncHandler(async (req: Request, res: Response) => {
  const adminId = req.user?.userId
  if (!adminId) throw new AppError('未登录', 401)
  res.json({ config: await savePointsConfig(req.body, adminId) })
}))

// POST /api/admin/points/shop — 新建商品
router.post('/shop', asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(shopCreateSchema, req.body)
  if (input.type === 'emoji' && !input.payload?.pack) throw new AppError('表情包商品必须选择表情包', 400)
  const existing = await prisma.pointsShopItem.findUnique({ where: { key: input.key } })
  if (existing) throw new AppError('该 key 已存在', 409)
  const item = await prisma.pointsShopItem.create({
    data: {
      key: input.key,
      type: input.type,
      name: input.name,
      description: input.description || null,
      cost: input.cost,
      rarity: input.rarity,
      payload: normalizePayload(input.type, input.payload),
      isActive: input.isActive,
      sortOrder: input.sortOrder,
    },
    include: { _count: { select: { owners: true } } },
  })
  res.status(201).json(serializeItem(item))
}))

// PATCH /api/admin/points/shop/:id — 编辑商品（key / type 不可改）
router.patch('/shop/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = itemId(req.params.id)
  const input = parseInput(shopPatchSchema, req.body)
  const current = await prisma.pointsShopItem.findUnique({ where: { id } })
  if (!current) throw new AppError('商品不存在', 404)

  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description || null
  if (input.cost !== undefined) data.cost = input.cost
  if (input.rarity !== undefined) data.rarity = input.rarity
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder
  if (input.payload !== undefined) {
    // 表情包商品允许只改 icon/color 之外的字段；pack 必须合法
    data.payload = normalizePayload(current.type, {
      ...parseShopPayload(current.payload),
      ...input.payload,
    })
  }

  const item = await prisma.pointsShopItem.update({
    where: { id },
    data,
    include: { _count: { select: { owners: true } } },
  })
  res.json(serializeItem(item))
}))

// DELETE /api/admin/points/shop/:id — 有人拥有时改为下架，避免吞掉已购内容
router.delete('/shop/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = itemId(req.params.id)
  const current = await prisma.pointsShopItem.findUnique({
    where: { id },
    include: { _count: { select: { owners: true } } },
  })
  if (!current) throw new AppError('商品不存在', 404)
  if (current._count.owners > 0) {
    await prisma.pointsShopItem.update({ where: { id }, data: { isActive: false } })
    res.json({ ok: true, deleted: false, note: '已有用户拥有，已改为下架' })
    return
  }
  await prisma.pointsShopItem.delete({ where: { id } })
  res.json({ ok: true, deleted: true })
}))

// GET /api/admin/points/users?q= — 用户积分查询
router.get('/users', asyncHandler(async (req: Request, res: Response) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 30) : ''
  const users = await prisma.user.findMany({
    where: q ? { username: { contains: q } } : {},
    orderBy: [{ points: 'desc' }, { createdAt: 'asc' }],
    take: 20,
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      points: true,
      pointsEarned: true,
      equippedTitle: { select: { name: true, payload: true } },
      createdAt: true,
    },
  })
  res.json({ users })
}))

// POST /api/admin/points/users/:id/adjust — 管理员手动加/扣积分
router.post('/users/:id/adjust', asyncHandler(async (req: Request, res: Response) => {
  const targetId = Number(req.params.id)
  if (!Number.isInteger(targetId) || targetId <= 0) throw new AppError('无效的用户 ID', 400)
  const input = parseInput(adjustSchema, req.body)
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: targetId }, select: { id: true } })
    if (!user) throw new AppError('用户不存在', 404)
    return awardPointsTx(tx, targetId, {
      amount: input.amount,
      reason: 'admin_adjust',
      note: input.note || '管理员调整',
    })
  })
  res.json(result)
}))

export default router
