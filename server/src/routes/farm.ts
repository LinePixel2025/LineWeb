import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import {
  buyFarmItem,
  buyFarmProtection,
  buyMerchantOffer,
  clearPlot,
  createFarm,
  expandFarm,
  fertilizeAllPlots,
  fertilizePlot,
  getFarmView,
  getNeighborFarm,
  harvestAllPlots,
  harvestPlot,
  listNeighbors,
  markTutorialDone,
  plantAllCrops,
  plantCrop,
  renameFarm,
  stealCrop,
} from '../services/farmService.js'
import {
  buySeedListing,
  cancelSeedListing,
  createSeedListing,
  getSeedMarketView,
} from '../services/farmSeedMarketService.js'

const router = Router()
router.use(authenticate)

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

const actionLimiter = limitFor(180, '操作过于频繁，请稍后再试')
const stealLimiter = limitFor(40, '偷菜太频繁了，休息一下吧')

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

function plotIndex(raw: string): number {
  const index = Number(raw)
  if (!Number.isInteger(index) || index < 0 || index > 99) throw new AppError('无效的地块编号', 400)
  return index
}

const createSchema = z.object({ name: z.string().max(20).optional() })
const renameSchema = z.object({ name: z.string().trim().min(1).max(20) })
const buySchema = z.object({
  type: z.enum(['seed', 'fertilizer']),
  key: z.string().min(1).max(30),
  count: z.number().int().min(1).max(99),
})
const plantSchema = z.object({ crop: z.string().min(1).max(30) })
const plantAllSchema = z.object({ crop: z.string().min(1).max(30).optional() })
const protectSchema = z.object({ hours: z.coerce.number().int().min(1).max(48) })
const seedListSchema = z.object({
  cropKey: z.string().min(1).max(30),
  count: z.coerce.number().int().min(1).max(99),
  price: z.coerce.number().int().min(1).max(1_000_000),
})
const seedIdSchema = z.object({ id: z.coerce.number().int().positive() })
const neighborsSchema = z.object({ q: z.string().max(30).optional() })

// GET /api/farm — 我的农场（未创建时 farm 为 null，仍返回目录 / 经济参数 / 积分）
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getFarmView(currentUserId(req)))
}))

// POST /api/farm/create — 开荒（送新手种子、肥料与开荒积分）
router.post('/create', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(createSchema, req.body ?? {})
  res.status(201).json(await createFarm(currentUserId(req), input.name))
}))

// POST /api/farm/rename
router.post('/rename', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(renameSchema, req.body)
  res.json(await renameFarm(currentUserId(req), input.name))
}))

// POST /api/farm/expand — 花积分扩建
router.post('/expand', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await expandFarm(currentUserId(req)))
}))

// POST /api/farm/protect — 花积分购买偷菜保护 { hours }
router.post('/protect', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(protectSchema, req.body ?? {})
  res.json(await buyFarmProtection(currentUserId(req), input.hours))
}))

// POST /api/farm/shop — 购买种子 / 肥料
router.post('/shop', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(buySchema, req.body)
  res.json(await buyFarmItem(currentUserId(req), input))
}))

// POST /api/farm/merchant/:offerId/buy — 购买随机商人特价商品（仅当天、限购一次）
router.post('/merchant/:offerId/buy', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const offerId = Number(req.params.offerId)
  if (!Number.isInteger(offerId) || offerId <= 0) throw new AppError('无效的商品编号', 400)
  res.json(await buyMerchantOffer(currentUserId(req), offerId))
}))

// POST /api/farm/tutorial-done
router.post('/tutorial-done', asyncHandler(async (req: Request, res: Response) => {
  await markTutorialDone(currentUserId(req))
  res.json({ ok: true })
}))

// POST /api/farm/plots/:index/plant
router.post('/plots/:index/plant', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(plantSchema, req.body)
  res.json(await plantCrop(currentUserId(req), plotIndex(req.params.index), input.crop))
}))

// POST /api/farm/plant-all — 一键种满所有空地（crop 缺省 = 自动选种子最多的作物）
router.post('/plant-all', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(plantAllSchema, req.body ?? {})
  res.json(await plantAllCrops(currentUserId(req), input.crop))
}))

// POST /api/farm/harvest-all — 一键收获所有成熟作物
router.post('/harvest-all', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await harvestAllPlots(currentUserId(req)))
}))

// POST /api/farm/fertilize-all — 一键施肥所有可施肥地块（肥料不足时尽力而为）
router.post('/fertilize-all', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await fertilizeAllPlots(currentUserId(req)))
}))

// POST /api/farm/plots/:index/fertilize
router.post('/plots/:index/fertilize', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await fertilizePlot(currentUserId(req), plotIndex(req.params.index)))
}))

// POST /api/farm/plots/:index/harvest
router.post('/plots/:index/harvest', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await harvestPlot(currentUserId(req), plotIndex(req.params.index)))
}))

// POST /api/farm/plots/:index/clear — 铲除未收获的作物（不返还种子）
router.post('/plots/:index/clear', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await clearPlot(currentUserId(req), plotIndex(req.params.index)))
}))

/* ---------- 玩家间种子交易 ---------- */

// GET /api/farm/seed-market — 在售挂单 + 我的挂单 + 最近成交 + 仓库种子
router.get('/seed-market', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getSeedMarketView(currentUserId(req)))
}))

// POST /api/farm/seed-market/list — { cropKey, count, price } 挂单（种子托管）
router.post('/seed-market/list', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(seedListSchema, req.body ?? {})
  res.status(201).json(await createSeedListing(currentUserId(req), input.cropKey, input.count, input.price))
}))

// POST /api/farm/seed-market/:id/buy — 买下挂单
router.post('/seed-market/:id/buy', stealLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(seedIdSchema, req.params)
  res.json(await buySeedListing(currentUserId(req), id))
}))

// DELETE /api/farm/seed-market/:id — 下架自己的挂单（种子返还）
router.delete('/seed-market/:id', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(seedIdSchema, req.params)
  res.json(await cancelSeedListing(currentUserId(req), id))
}))

// GET /api/farm/neighbors?q= — 可访问的邻居农场（有可偷作物优先）
router.get('/neighbors', asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(neighborsSchema, req.query)
  res.json({ neighbors: await listNeighbors(currentUserId(req), input.q) })
}))

// GET /api/farm/users/:id — 访问他人农场
router.get('/users/:id', asyncHandler(async (req: Request, res: Response) => {
  const targetId = Number(req.params.id)
  if (!Number.isInteger(targetId) || targetId <= 0) throw new AppError('无效的用户 ID', 400)
  res.json(await getNeighborFarm(currentUserId(req), targetId))
}))

// POST /api/farm/users/:id/steal/:index — 偷菜（概率成功 + 每日次数 + 每茬每人一次 + 地主被偷上限）
// 概率失败返回 200 { success: false }，不扣次数、不写偷菜记录
router.post('/users/:id/steal/:index', stealLimiter, asyncHandler(async (req: Request, res: Response) => {
  const targetId = Number(req.params.id)
  if (!Number.isInteger(targetId) || targetId <= 0) throw new AppError('无效的用户 ID', 400)
  res.json(await stealCrop(currentUserId(req), targetId, plotIndex(req.params.index)))
}))

export default router
