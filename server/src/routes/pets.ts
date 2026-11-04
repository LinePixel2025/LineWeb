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
import { startRaid, startSquadRaid } from '../services/raidRunService.js'
import {
  cancelInvite,
  getSquadState,
  getSquadView,
  inviteToSquad,
  kickMember,
  leaveSquad,
  respondToInvite,
} from '../services/raidSquadService.js'
import {
  abandonRaid,
  claimRaidContractForUser,
  getRaidOverview,
  performRaidEvents,
} from '../services/petRaidService.js'
import {
  depositAllRaidItems,
  depositRaidItems,
  getRaidStorageView,
  recycleRaidItems,
  recycleAllRaidItems,
  upgradeRaidStorage,
  withdrawRaidItems,
} from '../services/raidStorageService.js'
import { equipRaidGear, openRaidCache, repairRaidGearForUser } from '../services/raidGearService.js'
import { buyRaidShopItem, getRaidShopView } from '../services/raidShopService.js'

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
const raidStartSchema = z.object({
  mapKey: z.string().min(1).max(20),
  insured: z.boolean().optional(),
})
const raidContainerSchema = z.enum(['backpack', 'rig', 'safe'])
const raidEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('enterRoom'), roomId: z.coerce.number().int().min(0).max(99) }),
  z.object({ type: z.literal('kill'), enemyId: z.string().min(1).max(40) }),
  z.object({ type: z.literal('clearRoom'), roomId: z.coerce.number().int().min(0).max(99) }),
  z.object({ type: z.literal('openContainer'), containerId: z.string().min(1).max(40) }),
  z.object({
    type: z.literal('takeLoot'),
    containerId: z.string().min(1).max(40),
    lootId: z.string().min(1).max(40),
    target: raidContainerSchema,
    slotIndex: z.coerce.number().int().min(0).max(200).optional(),
  }),
  z.object({
    type: z.literal('moveItem'),
    from: raidContainerSchema,
    to: raidContainerSchema,
    slotIndex: z.coerce.number().int().min(0).max(200),
    amount: z.coerce.number().int().min(1).max(9999).optional(),
  }),
  z.object({
    type: z.literal('dropItem'),
    from: raidContainerSchema,
    slotIndex: z.coerce.number().int().min(0).max(200),
    amount: z.coerce.number().int().min(1).max(9999).optional(),
    x: z.coerce.number().min(0).max(400).optional(),
    y: z.coerce.number().min(0).max(400).optional(),
    // 朝向来自 atan2，取值区间含负数
    angle: z.coerce.number().optional(),
  }),
  z.object({
    type: z.literal('takeGround'),
    groundId: z.string().min(1).max(40),
    target: raidContainerSchema,
  }),
  z.object({
    type: z.literal('useItem'),
    itemKey: z.string().min(1).max(40),
    from: raidContainerSchema,
  }),
  z.object({ type: z.literal('castSkill'), skillKey: z.string().min(1).max(40) }),
  z.object({
    type: z.literal('damage'),
    amount: z.coerce.number().int().min(0).max(100000),
    zone: z.enum(['head', 'body']).default('body'),
  }),
  z.object({ type: z.literal('extractStart') }),
  z.object({ type: z.literal('extractDone') }),
  z.object({ type: z.literal('abandon') }),
])
const raidEventsSchema = z.object({
  version: z.coerce.number().int().min(0),
  events: z.array(raidEventSchema).max(120),
  // 组队模式：本端位置（纯表现，服务端不落库）
  me: z.object({
    x: z.coerce.number().min(0).max(400).optional(),
    y: z.coerce.number().min(0).max(400).optional(),
    angle: z.coerce.number().min(-7).max(7).optional(),
    roomId: z.coerce.number().int().min(0).max(99).optional(),
  }).optional(),
})
const raidSquadInviteSchema = z.object({ userId: z.coerce.number().int().positive() })
const raidSquadRespondSchema = z.object({
  inviteId: z.coerce.number().int().positive(),
  accept: z.boolean(),
})
const raidSquadCancelSchema = z.object({ inviteId: z.coerce.number().int().positive() })
const raidSquadStartSchema = z.object({
  mapKey: z.string().min(1).max(20),
  insured: z.boolean().optional(),
})
const raidContractParamSchema = z.object({ key: z.string().min(1).max(40) })
const raidDepositSchema = z.object({
  container: raidContainerSchema,
  slotIndex: z.coerce.number().int().min(0).max(200),
  amount: z.coerce.number().int().min(1).max(9999),
})
const raidWithdrawSchema = z.object({
  container: raidContainerSchema,
  itemKey: z.string().min(1).max(40),
  amount: z.coerce.number().int().min(1).max(9999),
})
const raidRecycleSchema = z.object({
  from: z.enum(['warehouse', 'backpack', 'rig', 'safe']),
  itemKey: z.string().min(1).max(40),
  amount: z.coerce.number().int().min(1).max(9999),
  slotIndex: z.coerce.number().int().min(0).max(200).optional(),
})
const raidStorageUpgradeSchema = z.object({}).strict()
const raidGearEquipSchema = z.object({
  slot: z.enum(['helmet', 'armor', 'boots', 'backpack', 'rig']),
  gearKey: z.string().min(1).max(40).nullable().optional(),
})
const raidGearKeySchema = z.object({ gearKey: z.string().min(1).max(40) })
const raidOpenCacheSchema = z.object({ itemKey: z.string().min(1).max(40) })
const raidShopBuySchema = z.object({
  kind: z.enum(['gear', 'item']),
  key: z.string().min(1).max(40),
  amount: z.coerce.number().int().min(1).max(99).optional(),
})

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

/* ---------- 搜打撤 v2（实时房间制） ---------- */

// GET /api/pets/raid — 地图 / 当前对局 / 战绩 / 每日契约 / 出击装配
router.get('/raid', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getRaidOverview(currentUserId(req)))
}))

// POST /api/pets/raid/start — { mapKey, insured? } 进入地图（扣门票 / 可选保险）
router.post('/raid/start', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidStartSchema, req.body ?? {})
  res.status(201).json(await startRaid(currentUserId(req), input.mapKey, { insured: input.insured }))
}))

// POST /api/pets/raid/events — { version, events[] } 批量上报（移动/击杀/开箱/拾取/技能/受伤/撤离）
router.post('/raid/events', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidEventsSchema, req.body ?? {})
  res.json(await performRaidEvents(currentUserId(req), input))
}))

// POST /api/pets/raid/abandon — 主动放弃行动
router.post('/raid/abandon', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await abandonRaid(currentUserId(req)))
}))

// POST /api/pets/raid/contracts/:key/claim — 领取每日契约奖励
router.post('/raid/contracts/:key/claim', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { key } = parseInput(raidContractParamSchema, req.params)
  res.json(await claimRaidContractForUser(currentUserId(req), key))
}))

/* ---------- 搜打撤好友组队（复用站内好友关系与 /ws/chat 推送） ---------- */

// GET /api/pets/raid/squad — 队伍 + 可邀请好友 + 收发邀请
router.get('/raid/squad', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getSquadView(currentUserId(req)))
}))

// GET /api/pets/raid/squad/state — 战斗中队友状态（无 WebSocket 时轮询）
router.get('/raid/squad/state', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getSquadState(currentUserId(req)))
}))

// POST /api/pets/raid/squad/invite — { userId } 邀请好友（无队伍时自动建队并成为房主）
router.post('/raid/squad/invite', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidSquadInviteSchema, req.body ?? {})
  res.status(201).json({ squad: await inviteToSquad(currentUserId(req), input.userId) })
}))

// POST /api/pets/raid/squad/respond — { inviteId, accept } 接受 / 拒绝邀请
// 统一返回 { squad }：拒绝为 { squad: null }（此前裸 null 会让前端读 result.squad 抛错）
router.post('/raid/squad/respond', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidSquadRespondSchema, req.body ?? {})
  res.json({ squad: await respondToInvite(currentUserId(req), input.inviteId, input.accept) })
}))

// POST /api/pets/raid/squad/cancel — { inviteId } 撤回自己发出的邀请
router.post('/raid/squad/cancel', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidSquadCancelSchema, req.body ?? {})
  cancelInvite(currentUserId(req), input.inviteId)
  res.json({ ok: true })
}))

// POST /api/pets/raid/squad/leave — 退出队伍（房主退出即解散）
router.post('/raid/squad/leave', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json({ ok: true, squad: await leaveSquad(currentUserId(req)) })
}))

// POST /api/pets/raid/squad/kick — { userId } 房主在出击前移出成员
router.post('/raid/squad/kick', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidSquadInviteSchema, req.body ?? {})
  res.json({ ok: true, squad: await kickMember(currentUserId(req), input.userId) })
}))

// POST /api/pets/raid/squad/start — { mapKey, insured } 房主为全队同一 seed 开局
router.post('/raid/squad/start', battleInviteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidSquadStartSchema, req.body ?? {})
  res.status(201).json(await startSquadRaid(currentUserId(req), input.mapKey, Boolean(input.insured)))
}))

/* ---------- 搜打撤仓库 / 背包 / 胸挂 / 安全箱 ---------- */

// GET /api/pets/raid/storage — 仓库 + 三类容器 + 装备 + 升级预览
router.get('/raid/storage', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getRaidStorageView(currentUserId(req)))
}))

// POST /api/pets/raid/storage/deposit — { container, slotIndex, amount } 单格存入仓库（整笔）
router.post('/raid/storage/deposit', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidDepositSchema, req.body ?? {})
  res.json(await depositRaidItems(currentUserId(req), input))
}))

// POST /api/pets/raid/storage/deposit-all — 一键存入（装不下的留在容器）
router.post('/raid/storage/deposit-all', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  parseInput(raidStorageUpgradeSchema, req.body ?? {})
  res.json(await depositAllRaidItems(currentUserId(req)))
}))

// POST /api/pets/raid/storage/withdraw — { container, itemKey, amount } 仓库取到容器
router.post('/raid/storage/withdraw', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidWithdrawSchema, req.body ?? {})
  res.json(await withdrawRaidItems(currentUserId(req), input))
}))

// POST /api/pets/raid/storage/recycle — { from, itemKey, amount, slotIndex? } 卖给官方商店
router.post('/raid/storage/recycle', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidRecycleSchema, req.body ?? {})
  res.json(await recycleRaidItems(currentUserId(req), input))
}))

// POST /api/pets/raid/storage/recycle-all — { keepUpgradeItems? } 一键回收整个仓库
router.post('/raid/storage/recycle-all', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { keepUpgradeItems?: unknown }
  res.json(await recycleAllRaidItems(currentUserId(req), {
    keepUpgradeItems: body.keepUpgradeItems === undefined ? undefined : body.keepUpgradeItems === true,
  }))
}))

// POST /api/pets/raid/storage/upgrade — {} 花积分 + 消耗材料升级仓库
router.post('/raid/storage/upgrade', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  parseInput(raidStorageUpgradeSchema, req.body ?? {})
  res.json(await upgradeRaidStorage(currentUserId(req)))
}))

/* ---------- 搜打撤官方商店 / 装备 ---------- */

// GET /api/pets/raid/shop — 官方商店（1–3 级装备 + 消耗品 + 箱子）
router.get('/raid/shop', battlePollLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getRaidShopView(currentUserId(req)))
}))

// POST /api/pets/raid/shop/buy — { kind, key, amount? }
router.post('/raid/shop/buy', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidShopBuySchema, req.body ?? {})
  res.json(await buyRaidShopItem(currentUserId(req), input))
}))

// POST /api/pets/raid/gear/equip — { slot, gearKey|null }
router.post('/raid/gear/equip', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidGearEquipSchema, req.body ?? {})
  res.json(await equipRaidGear(currentUserId(req), input.slot, input.gearKey ?? null))
}))

// POST /api/pets/raid/gear/repair — { gearKey } 消耗头修包 / 甲修包
router.post('/raid/gear/repair', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidGearKeySchema, req.body ?? {})
  res.json(await repairRaidGearForUser(currentUserId(req), input.gearKey))
}))

// POST /api/pets/raid/gear/open-cache — { itemKey } 开启装备箱 / 技能卷轴
router.post('/raid/gear/open-cache', marketWriteLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(raidOpenCacheSchema, req.body ?? {})
  res.json(await openRaidCache(currentUserId(req), input.itemKey))
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
