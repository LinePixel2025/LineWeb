import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import {
  AVATAR_FRAME_STYLES,
  EMOJI_PACK_KEYS,
  getTodayDayStart,
  parseShopPayload,
  sanitizeAvatarFrame,
  sanitizeTitleColor,
  sanitizeTitleEffect,
  sanitizeTitleIcon,
  TITLE_EFFECT_STYLES,
} from '../lib/pointsRules.js'
import { leaderTitleDto } from '../lib/gameLeaderTitles.js'
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

const raritySchema = z.enum(['common', 'rare', 'epic', 'legendary', 'mythic'])

const payloadSchema = z.object({
  icon: z.string().max(8).optional(),
  color: z.string().max(20).optional(),
  pack: z.string().max(30).optional(),
  frame: z.string().max(20).optional(),
  effect: z.string().max(20).optional(),
}).optional()

const shopCreateSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{3,40}$/, 'key 只能是小写字母、数字、下划线（3–40 位）'),
  type: z.enum(['title', 'emoji', 'avatar_frame']),
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

/** 榜一传说称号特效只收白名单（classic/stardust/flame/aurora/thunder） */
const leaderTitlePatchSchema = z.object({
  effect: z.enum(TITLE_EFFECT_STYLES),
})

/** 把管理员提交的 payload 规范成存库 JSON（称号颜色/图标/特效消毒，表情包与头像框只收白名单） */
function normalizePayload(
  type: string,
  payload: { icon?: string; color?: string; pack?: string; frame?: string; effect?: string } | undefined,
): string | null {
  if (!payload) {
    if (type === 'title') return JSON.stringify({ icon: '', color: '#57606a', effect: 'classic' })
    if (type === 'avatar_frame') throw new AppError(`头像框样式必须是：${AVATAR_FRAME_STYLES.join(' / ')}`, 400)
    return null
  }
  if (type === 'emoji') {
    const pack = payload.pack?.trim()
    if (!pack || !(EMOJI_PACK_KEYS as readonly string[]).includes(pack)) {
      throw new AppError(`表情包必须是：${EMOJI_PACK_KEYS.join(' / ')}`, 400)
    }
    return JSON.stringify({ pack })
  }
  if (type === 'avatar_frame') {
    const frame = sanitizeAvatarFrame(payload.frame)
    if (!frame) throw new AppError(`头像框样式必须是：${AVATAR_FRAME_STYLES.join(' / ')}`, 400)
    return JSON.stringify({ frame, color: sanitizeTitleColor(payload.color, '#57606a') })
  }
  return JSON.stringify({
    icon: sanitizeTitleIcon(payload.icon),
    color: sanitizeTitleColor(payload.color),
    effect: sanitizeTitleEffect(payload.effect) ?? 'classic',
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

// GET /api/admin/points — 规则 + 商品 + 榜一称号 + 统计
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  const dayStart = getTodayDayStart()
  const [config, items, stats, farmStats, totals, todayAward, leaderTitleRows] = await Promise.all([
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
    prisma.gameLeaderTitle.findMany({
      include: { user: { select: { username: true } } },
      orderBy: { game: 'asc' },
    }),
  ])

  res.json({
    config,
    items: items.map(serializeItem),
    // 榜一传说称号（每游戏一行，重算自动换主；effect 可经 PATCH /leader-titles/:id 调整）
    leaderTitles: leaderTitleRows.map((row) => ({ ...leaderTitleDto(row), holderName: row.user.username })),
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

// DELETE /api/admin/points/shop/:id — 彻底删除商品；已拥有/佩戴中的用户一并清除
//（外键本会级联/SetNull，这里在事务内显式执行以便返回受影响人数）
router.delete('/shop/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = itemId(req.params.id)
  const current = await prisma.pointsShopItem.findUnique({ where: { id } })
  if (!current) throw new AppError('商品不存在', 404)
  const result = await prisma.$transaction(async (tx) => {
    const removedOwners = await tx.userPointsItem.deleteMany({ where: { itemId: id } })
    // 称号与头像框分开清：OR + 双字段置空会误清另一类仍佩戴的商品
    const clearedTitle = await tx.user.updateMany({
      where: { equippedTitleId: id },
      data: { equippedTitleId: null },
    })
    const clearedFrame = await tx.user.updateMany({
      where: { equippedAvatarFrameId: id },
      data: { equippedAvatarFrameId: null },
    })
    await tx.pointsShopItem.delete({ where: { id } })
    return { removedOwners: removedOwners.count, clearedEquipped: clearedTitle.count + clearedFrame.count }
  })
  res.json({ ok: true, deleted: true, removedOwners: result.removedOwners, clearedEquipped: result.clearedEquipped })
}))

// PATCH /api/admin/points/leader-titles/:id — 设置榜一传说称号特效
//（重算 upsert 不写 effect，换主后特效保留；缺省/非法值在出口处回退 classic）
router.patch('/leader-titles/:id', asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('无效的传说称号 ID', 400)
  const input = parseInput(leaderTitlePatchSchema, req.body)
  const current = await prisma.gameLeaderTitle.findUnique({ where: { id } })
  if (!current) throw new AppError('传说称号不存在', 404)
  const updated = await prisma.gameLeaderTitle.update({ where: { id }, data: { effect: input.effect } })
  res.json({ ok: true, leaderTitle: leaderTitleDto(updated) })
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
