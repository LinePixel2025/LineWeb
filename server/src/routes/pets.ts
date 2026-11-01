import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { PET_CARE_KEYS, PET_SPECIES_KEYS, PET_TRICK_KEYS } from '../lib/petCatalog.js'
import {
  addGuestbookEntry,
  buyOutfit,
  carePet,
  deleteGuestbookEntry,
  equipOutfit,
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

export default router
