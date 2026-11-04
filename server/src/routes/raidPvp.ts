/**
 * 搜打撤玩家匹配 PvP 路由（/api/pets/raid/pvp）
 *
 * 单独成文件而不是塞进 routes/pets.ts：PvP 的写入口（开火 / 佣兵击杀 / 位置心跳）
 * 频率比普通仓库操作高一个量级，需要独立的按用户限流；也让 pets.ts 保持可读。
 * 必须在 index.ts 里挂在 `/api/pets` **之前**（前缀更长者先挂）。
 */

import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { requireFeature } from '../middleware/featureGuard.js'
import {
  cancelPvp,
  enqueuePvp,
  getPvpState,
  getQueueView,
  leavePvpMatch,
  recordPvpPosition,
  strikeMerc,
  strikePlayer,
  sweepPvp,
} from '../services/raidPvpService.js'

const router = Router()
router.use(authenticate, requireFeature('pet'))

function limitFor(max: number, message: string) {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
    message: { error: message },
    skip: (req) => req.user?.role === 'admin',
  })
}

/** 位置心跳 + 状态轮询都是 1.5 秒一次，额度按 5 分钟 600 次给足 */
const pollLimiter = limitFor(600, 'PvP 状态轮询太频繁')
const actionLimiter = limitFor(300, '开火 / 排队操作太频繁')
const writeLimiter = limitFor(60, 'PvP 操作太频繁')

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

const enqueueSchema = z.object({ mapKey: z.string().min(1).max(32) })
const posSchema = z.object({
  x: z.coerce.number().finite().optional(),
  y: z.coerce.number().finite().optional(),
  angle: z.coerce.number().finite().optional(),
  roomId: z.coerce.number().int().min(0).max(999).optional(),
})
const strikeSchema = z.object({
  targetUserId: z.coerce.number().int().positive(),
  zone: z.enum(['head', 'body']).optional(),
})
const mercStrikeSchema = z.object({ mercId: z.string().min(1).max(64) })

// POST /api/pets/raid/pvp/enqueue — { mapKey } 进入匹配队列
router.post('/enqueue', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(enqueueSchema, req.body ?? {})
  res.json(await enqueuePvp(currentUserId(req), input.mapKey))
}))

// POST /api/pets/raid/pvp/cancel — 退出队列
router.post('/cancel', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(cancelPvp(currentUserId(req)))
}))

// GET /api/pets/raid/pvp/queue — 排队状态（含成局后的阵营与队友）
router.get('/queue', pollLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getQueueView(currentUserId(req)))
}))

// GET /api/pets/raid/pvp/state — 对手位置（无 WS 也能玩：客户端 1.5 秒轮询）
router.get('/state', pollLimiter, asyncHandler(async (req: Request, res: Response) => {
  // 顺手清扫：队列老化 / 过期对局 / 陈旧位置，不额外挂定时器
  await sweepPvp()
  res.json({ state: await getPvpState(currentUserId(req)) })
}))

// POST /api/pets/raid/pvp/pos — { x, y, angle, roomId } 位置心跳
router.post('/pos', pollLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(posSchema, req.body ?? {})
  recordPvpPosition(currentUserId(req), input)
  res.json({ ok: true })
}))

// POST /api/pets/raid/pvp/strike — { targetUserId, zone } 对玩家开火（伤害由服务端重算）
router.post('/strike', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(strikeSchema, req.body ?? {})
  res.json(await strikePlayer(currentUserId(req), input.targetUserId, input.zone))
}))

// POST /api/pets/raid/pvp/merc-strike — { mercId } 对敌方佣兵开火
router.post('/merc-strike', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(mercStrikeSchema, req.body ?? {})
  res.json(await strikeMerc(currentUserId(req), input.mercId))
}))

// POST /api/pets/raid/pvp/leave — 主动退出 PvP（对局本身仍在，需要另行放弃/撤离）
router.post('/leave', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  leavePvpMatch(currentUserId(req))
  res.json({ ok: true })
}))

export default router
