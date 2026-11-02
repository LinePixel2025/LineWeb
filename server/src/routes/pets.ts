import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { PET_CARE_KEYS, PET_SPECIES_KEYS, PET_TRICK_KEYS } from '../lib/petCatalog.js'
import {
  addGuestbookEntry,
  buyEquipment,
  buyOutfit,
  buySkill,
  carePet,
  deleteGuestbookEntry,
  equipGear,
  equipOutfit,
  getPetGearView,
  getPetHome,
  getPetView,
  listPetHomes,
  patPet,
  renamePet,
  summonPet,
  switchPetSpecies,
  touchPet,
  trickPet,
  upgradePet,
} from '../services/petService.js'
import {
  cancelBattle,
  forfeitBattleByUser,
  getBattle,
  getBattleOverview,
  heartbeatBattle,
  inviteBattle,
  performBattleAction,
  respondBattle,
} from '../services/petBattleService.js'
import {
  buyListing,
  cancelListing,
  createListing,
  getPetMarketView,
} from '../services/petMarketService.js'

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

const actionLimiter = limitFor(120, '操作太频繁啦，和宠物玩慢一点～')

/** 串门类操作（撸宠 / 留言）比照顾自己的宠物更「公共」，限流更紧一些 */
const socialLimiter = limitFor(60, '在宠物之家里待太久啦，先歇一会儿再来～')

/** 对战轮询 / 心跳：前端 1.5 秒轮询一次对局，额度需要比普通操作高 */
const battlePollLimiter = limitFor(600, '对战请求过于频繁，请稍后再试')

/** 邀请 / 挂单等写操作 */
const battleInviteLimiter = limitFor(30, '邀请太频繁啦，先等对方回应吧')
const marketWriteLimiter = limitFor(60, '交易行操作太频繁，请稍后再试')

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

const summonSchema = z.object({
  species: z.enum(PET_SPECIES_KEYS),
  name: z.string().max(12).optional(),
})
const careSchema = z.object({ kind: z.enum(PET_CARE_KEYS) })
const actionSchema = z.object({ action: z.enum(PET_TRICK_KEYS) })
const outfitBuySchema = z.object({ outfitKey: z.string().min(1).max(30) })
const outfitEquipSchema = z.object({
  outfitKey: z.string().min(1).max(30),
  equip: z.boolean(),
})
const renameSchema = z.object({ name: z.string().trim().min(1).max(12) })
const switchSchema = z.object({ species: z.enum(PET_SPECIES_KEYS) })
const homesQuerySchema = z.object({ query: z.string().max(30).optional() })
const userIdParamSchema = z.object({ userId: z.coerce.number().int().positive() })
const guestbookIdParamSchema = z.object({ id: z.coerce.number().int().positive() })
const guestbookSchema = z.object({ content: z.string().max(200) })
const gearEquipSchema = z.object({
  itemType: z.enum(['equipment', 'skill']),
  key: z.string().min(1).max(40),
  equip: z.boolean(),
})
const shopBuySchema = z.object({ key: z.string().min(1).max(40) })
const battleInviteSchema = z.object({ targetUserId: z.coerce.number().int().positive() })
const battleIdParamSchema = z.object({ id: z.coerce.number().int().positive() })
const battleRespondSchema = z.object({ accept: z.boolean() })
const battleActionSchema = z.object({
  skillKey: z.string().min(1).max(40),
  version: z.coerce.number().int().min(0),
})
const marketListSchema = z.object({
  itemType: z.enum(['equipment', 'skill']),
  key: z.string().min(1).max(40),
  price: z.coerce.number().int().min(1).max(1_000_000),
})
const marketIdParamSchema = z.object({ id: z.coerce.number().int().positive() })

// GET /api/pets — 我的宠物（未召唤时 pet 为 null，仍返回目录与积分）
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  res.json(await getPetView(currentUserId(req)))
}))

/* ---------- 宠物之家（公共串门） ----------
   路由顺序：/homes 与 /homes/:userId 放在任何 /:id 风格路由之前，
   避免未来新增动态段路由时把 homes 吞掉。 */

// GET /api/pets/homes?query= — 所有在世宠物（列表卡片）
router.get('/homes', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(homesQuerySchema, req.query ?? {})
  res.json(await listPetHomes(currentUserId(req), input.query))
}))

// GET /api/pets/homes/:userId — 某人的宠物之家详情（含留言与今日剩余撸宠次数）
router.get('/homes/:userId', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { userId } = parseInput(userIdParamSchema, req.params)
  res.json(await getPetHome(currentUserId(req), userId))
}))

// POST /api/pets/homes/:userId/pat — 撸一撸（每天 3 次）
router.post('/homes/:userId/pat', socialLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { userId } = parseInput(userIdParamSchema, req.params)
  res.json(await patPet(currentUserId(req), userId))
}))

// POST /api/pets/homes/:userId/guestbook — 留言 { content }（≤60 字，每天 5 条）
router.post('/homes/:userId/guestbook', socialLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { userId } = parseInput(userIdParamSchema, req.params)
  const input = parseInput(guestbookSchema, req.body ?? {})
  res.status(201).json(await addGuestbookEntry(currentUserId(req), userId, input.content))
}))

// DELETE /api/pets/guestbook/:id — 删除自己的留言
router.delete('/guestbook/:id', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(guestbookIdParamSchema, req.params)
  res.json(await deleteGuestbookEntry(currentUserId(req), id))
}))

// POST /api/pets/switch — 换物种 { species }（保留等级 / 数值 / 已购装扮，花 100 积分）
router.post('/switch', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(switchSchema, req.body ?? {})
  res.json(await switchPetSpecies(currentUserId(req), input.species))
}))

// POST /api/pets/summon — 花积分召唤（出走后可重新召唤）
router.post('/summon', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(summonSchema, req.body ?? {})
  res.status(201).json(await summonPet(currentUserId(req), input))
}))

// POST /api/pets/feed | bathe | play — 照顾动作（统一走 carePet）
router.post('/feed', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await carePet(currentUserId(req), 'feed'))
}))

router.post('/bathe', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await carePet(currentUserId(req), 'bathe'))
}))

router.post('/play', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await carePet(currentUserId(req), 'play'))
}))

// POST /api/pets/touch — 抚摸（免费，60 秒冷却；冷却中返回 gained:false）
router.post('/touch', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await touchPet(currentUserId(req)))
}))

// POST /api/pets/action — 特技动作（免费，{ action: 'dance' | ... }）
router.post('/action', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(actionSchema, req.body ?? {})
  res.json(await trickPet(currentUserId(req), input.action))
}))

// POST /api/pets/upgrade — 花积分升级
router.post('/upgrade', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await upgradePet(currentUserId(req)))
}))

// POST /api/pets/outfits/buy — 购买装扮 { outfitKey }
router.post('/outfits/buy', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(outfitBuySchema, req.body ?? {})
  res.json(await buyOutfit(currentUserId(req), input.outfitKey))
}))

// POST /api/pets/outfits/equip — 佩戴/取下装扮 { outfitKey, equip }
router.post('/outfits/equip', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(outfitEquipSchema, req.body ?? {})
  res.json(await equipOutfit(currentUserId(req), input.outfitKey, input.equip))
}))

// POST /api/pets/rename — 改名 { name }
router.post('/rename', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(renameSchema, req.body ?? {})
  res.json(await renamePet(currentUserId(req), input.name))
}))

/* ---------- 战斗装备 / 技能 ---------- */

// GET /api/pets/gear — 装备与技能目录 + 我的拥有 / 穿戴 + 属性对比
router.get('/gear', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getPetGearView(currentUserId(req)))
}))

// POST /api/pets/gear/equip — { itemType, key, equip }
router.post('/gear/equip', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(gearEquipSchema, req.body ?? {})
  res.json(await equipGear(currentUserId(req), input))
}))

// POST /api/pets/shop/equipment/:key/buy — 系统装备商店购买
router.post('/shop/equipment/:key/buy', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { key } = parseInput(shopBuySchema, req.params)
  res.json(await buyEquipment(currentUserId(req), key))
}))

// POST /api/pets/shop/skills/:key/buy — 技能商店购买
router.post('/shop/skills/:key/buy', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { key } = parseInput(shopBuySchema, req.params)
  res.json(await buySkill(currentUserId(req), key))
}))

/* ---------- PvP 对战 ---------- */

// GET /api/pets/battle/overview — 进行中 / 邀请 / 历史 / 战绩 / 可挑战对手
router.get('/battle/overview', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getBattleOverview(currentUserId(req)))
}))

// POST /api/pets/battle/invite — { targetUserId }
router.post('/battle/invite', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(battleInviteSchema, req.body ?? {})
  res.status(201).json(await inviteBattle(currentUserId(req), input.targetUserId))
}))

// GET /api/pets/battle/:id — 对战详情（1.5 秒轮询）
router.get('/battle/:id', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(battleIdParamSchema, req.params)
  res.json(await getBattle(currentUserId(req), id))
}))

// POST /api/pets/battle/:id/respond — { accept }
router.post('/battle/:id/respond', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(battleIdParamSchema, req.params)
  const input = parseInput(battleRespondSchema, req.body ?? {})
  res.json(await respondBattle(currentUserId(req), id, input.accept))
}))

// POST /api/pets/battle/:id/cancel — 取消自己发出的邀请
router.post('/battle/:id/cancel', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(battleIdParamSchema, req.params)
  await cancelBattle(currentUserId(req), id)
  res.json({ ok: true })
}))

// POST /api/pets/battle/:id/action — { skillKey, version }
router.post('/battle/:id/action', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(battleIdParamSchema, req.params)
  const input = parseInput(battleActionSchema, req.body ?? {})
  res.json(await performBattleAction(currentUserId(req), id, input.skillKey, input.version))
}))

// POST /api/pets/battle/:id/presence — 心跳（10 秒一次）
router.post('/battle/:id/presence', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(battleIdParamSchema, req.params)
  await heartbeatBattle(currentUserId(req), id)
  res.json({ ok: true })
}))

// POST /api/pets/battle/:id/forfeit — 认输
router.post('/battle/:id/forfeit', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(battleIdParamSchema, req.params)
  res.json(await forfeitBattleByUser(currentUserId(req), id))
}))

/* ---------- 玩家交易行 ---------- */

// GET /api/pets/market — 在售挂单 + 我的挂单 + 最近成交 + 参考价
router.get('/market', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getPetMarketView(currentUserId(req)))
}))

// POST /api/pets/market/list — { itemType, key, price }
router.post('/market/list', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(marketListSchema, req.body ?? {})
  res.status(201).json(await createListing(currentUserId(req), input.itemType, input.key, input.price))
}))

// POST /api/pets/market/:id/buy — 购买挂单
router.post('/market/:id/buy', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(marketIdParamSchema, req.params)
  res.json(await buyListing(currentUserId(req), id))
}))

// DELETE /api/pets/market/:id — 下架自己的挂单
router.delete('/market/:id', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(marketIdParamSchema, req.params)
  await cancelListing(currentUserId(req), id)
  res.json({ ok: true })
}))

export default router
