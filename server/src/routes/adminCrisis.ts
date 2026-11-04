import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import {
  forceDueForAll,
  forceDueForUser,
  getCrisisAdminOverview,
  getCrisisState,
  invalidateCrisisCache,
  saveCrisisRules,
} from '../services/crisisService.js'

/**
 * 危机管理端（管理员）。
 *
 * 复用 `points:manage` 能力而不新增 crisis:manage：危机本质是积分回收，
 * 而且新增能力要同时改前后端两份 CAPABILITIES 清单（有跨端一致性测试守着），收益不大。
 */
const adminCrisisRouter = Router()
adminCrisisRouter.use(authenticate, requireCapability('points:manage'))

function currentAdminId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 总览：参数、公共银行总额、欠费与已封锁人数、欠费榜 */
adminCrisisRouter.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getCrisisAdminOverview())
}))

/** 调参数（深合并 + 钳制；已开轮的账单不受影响，只有强制到期才重算） */
adminCrisisRouter.put('/config', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z
    .object({
      enabled: z.boolean().optional(),
      ratio: z.coerce.number().min(0).max(1).optional(),
      intervalMs: z.coerce.number().int().positive().optional(),
      graceMs: z.coerce.number().int().positive().optional(),
      minLevy: z.coerce.number().int().min(0).optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) throw new AppError('参数无效：比例须在 0–1 之间，时长与门槛须为非负整数', 400)
  const rules = await saveCrisisRules(parsed.data, currentAdminId(req))
  res.json({ rules })
}))

/**
 * 手动触发危机：`{ userId }` 针对单人，`{ all: true }` 全员立刻到期。
 * 全员是重操作（逐人评估总资产），按 20 人一批分页跑。
 */
const forceSchema = z
  .object({ userId: z.coerce.number().int().positive().optional(), all: z.boolean().optional() })
  .refine((value) => value.all === true || value.userId !== undefined, {
    message: '需要 userId 或 all=true',
  })

adminCrisisRouter.post('/force-due', asyncHandler(async (req: Request, res: Response) => {
  const parsed = forceSchema.safeParse(req.body)
  if (!parsed.success) throw new AppError('输入数据无效', 400)
  const adminId = currentAdminId(req)
  if (parsed.data.all) {
    const result = await forceDueForAll(Date.now(), 20)
    invalidateCrisisCache()
    console.log(`[crisis] 管理员 ${adminId} 触发全员危机到期：开轮 ${result.opened} 人，免征 ${result.skipped} 人`)
    res.json({ scope: 'all', ...result })
    return
  }
  const userId = parsed.data.userId as number
  const state = await forceDueForUser(userId)
  console.log(`[crisis] 管理员 ${adminId} 触发用户 ${userId} 危机到期：应缴 ${state.required}`)
  res.json({ scope: 'user', userId, state })
}))

/** 查看某个用户的账单明细（管理端核对用） */
adminCrisisRouter.get('/users/:userId', asyncHandler(async (req: Request, res: Response) => {
  const userId = Number.parseInt(req.params.userId ?? '', 10)
  if (!Number.isFinite(userId) || userId <= 0) throw new AppError('用户不存在', 404)
  res.json(await getCrisisState(userId))
}))

export default adminCrisisRouter
