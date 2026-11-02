import prisma from '../lib/prisma.js'
import type { Pet, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  GUESTBOOK_DAILY_LIMIT,
  GUESTBOOK_MAX_LENGTH,
  PAT_DAILY_LIMIT,
  PET_CARE_ACTIONS,
  PET_COSTS,
  PET_DECAY_PER_HOUR,
  PET_GRACE_HOURS,
  PET_MAX_LEVEL,
  PET_NAME_MAX_LENGTH,
  PET_OUTFITS,
  PET_OUTFIT_SLOTS,
  PET_PAT_MOOD_BONUS,
  PET_SPECIES,
  PET_TOUCH_COOLDOWN_MS,
  PET_TOUCH_MOOD_BONUS,
  PET_TRICKS,
  cleanEquipped,
  cleanLoadout,
  emptyPetEquipped,
  emptyPetLoadout,
  getPetOutfit,
  getPetSpecies,
  loadoutEquipmentKeys,
  nextNameAfterSwitch,
  normalizePetName,
  petUnlockedActions,
  petUpgradeCost,
  recomputeCriticalSince,
  roundStat,
  sanitizeGuestbookContent,
  serializeEquipped,
  serializeLoadout,
  settlePetStats,
  type PetCareActionDef,
  type PetCareKind,
  type PetEquipped,
  type PetLoadout,
  type PetOutfitDef,
  type PetSpeciesDef,
  type PetStatsInput,
  type PetStatsSettled,
  type PetTrickDef,
} from '../lib/petCatalog.js'
import {
  PET_EQUIPMENT_MAP,
  PET_SHOP_EQUIPMENTS,
  PET_STARTER_EQUIPMENT_KEYS,
  type PetEquipmentDef,
} from '../lib/petEquipment.js'
import {
  PET_SHOP_SKILLS,
  PET_SKILLS,
  PET_SKILL_MAP,
  PET_SKILL_MAX_EQUIPPED,
  type PetSkillDef,
} from '../lib/petSkills.js'
import { deriveCombatStats, type PetCombatStats } from '../lib/petBattle.js'
import { getPointsProfile, spendPointsTx } from './pointsService.js'
import { getTodayDateKey, getTodayDayStart } from '../lib/pointsRules.js'

type Db = Prisma.TransactionClient

/** 宠物之家列表一次最多返回多少位（避免榜单接口变成全表扫描） */
const PET_HOMES_LIMIT = 60

/** 宠物之家最近留言条数 */
const GUESTBOOK_PAGE_SIZE = 30


/* ============================================================
   DTO（前端契约，字段名保持稳定）
   ============================================================ */

export interface PetDto {
  id: number
  /** 主人 userId（前端「去我的宠物之家」需要它拼路由） */
  ownerId: number
  species: string
  /** 物种显示名（catalog 里查不到时回退「宠物」） */
  speciesName: string
  speciesEmoji: string
  name: string
  level: number
  status: 'alive' | 'gone'
  /** 已结算的当前值（0–100，保留 1 位小数；gone 时为 0） */
  hunger: number
  cleanliness: number
  mood: number
  decayPerHour: { hunger: number; cleanliness: number; mood: number }
  /** 最早一项归零的时刻（criticalSince；alive 且无归零风险时为 null） */
  zeroAtMs: number | null
  graceHours: number
  equipped: PetEquipped
  ownedOutfits: string[]
  /** 战斗装备 / 技能装配（与装扮共用 Pet.equipped JSON） */
  loadout: PetLoadout
  ownedEquipment: string[]
  ownedSkills: string[]
  /** 由等级 + 物种 + 已穿戴装备派生的战斗属性 */
  battleStats: PetCombatStats
  unlockedActions: string[]
  /** 升到下一级的花费；满级为 null */
  nextLevelCost: number | null
  /** true = 现在抚摸可获得心情加成 */
  touchReady: boolean
  /** 被别人撸的累计次数（宠物之家人气） */
  pats: number
  /** 换物种花费，前端直接取用避免硬编码 */
  switchCost: number
}

export interface PetCatalogDto {
  species: readonly PetSpeciesDef[]
  outfits: readonly PetOutfitDef[]
  equipment: readonly PetEquipmentDef[]
  skills: readonly PetSkillDef[]
  shopEquipment: readonly PetEquipmentDef[]
  shopSkills: readonly PetSkillDef[]
  maxEquippedSkills: number
  costs: typeof PET_COSTS
  careActions: readonly PetCareActionDef[]
  tricks: readonly PetTrickDef[]
  maxLevel: number
  levelCostBase: number
  decayPerHour: { hunger: number; cleanliness: number; mood: number }
  graceHours: number
  /** 换物种花费（与 costs.switch 同值，单独下发便于前端独立展示） */
  switchCost: number
  patDailyLimit: number
  guestbookDailyLimit: number
  guestbookMaxLength: number
}

export interface PetView {
  pet: PetDto | null
  catalog: PetCatalogDto
  points: number
}

export interface PetMutationResult {
  pet: PetDto
  points: number
}

export interface PetTouchResult extends PetMutationResult {
  /** 本次抚摸是否获得了心情加成（冷却中为 false） */
  gained: boolean
}

export interface PetTrickResult extends PetMutationResult {
  /** 动作 key，前端据此播放动画 */
  animation: string
}

/* ---------- 宠物之家（公共 DTO 只暴露 mood，不暴露 hunger/cleanliness 精确值） ---------- */

/** 列表卡片用的宠物摘要 */
export interface PetHomePetSummary {
  species: string
  speciesName: string
  name: string
  level: number
  mood: number
  pats: number
  equipped: PetEquipped
}

export interface PetHomeSummary {
  userId: number
  username: string
  /** 头像缓存击穿版本号（null = 从未上传过头像） */
  avatarVersion: number | null
  pet: PetHomePetSummary
  isSelf: boolean
}

export interface PetHomesResult {
  homes: PetHomeSummary[]
  /** 实际生效的搜索词（trim + 截断后） */
  query: string
}

export interface PetGuestbookAuthor {
  userId: number
  username: string
}

export interface PetGuestbookEntryDto {
  id: number
  content: string
  author: PetGuestbookAuthor
  createdAt: string
  isMine: boolean
}

export interface PetHomeOwner {
  userId: number
  username: string
  avatarVersion: number | null
}

export interface PetHomeDetail {
  owner: PetHomeOwner
  publicPet: {
    species: string
    speciesName: string
    name: string
    level: number
    mood: number
    equipped: PetEquipped
    pats: number
    status: string
  }
  guestbook: PetGuestbookEntryDto[]
  viewer: {
    patsToday: number
    patsRemaining: number
    canGuestbook: boolean
  }
  /** 人气排名（按 pats 降序；1 = 人气最高） */
  rank: number
  isSelf: boolean
}

export interface PetPatResult {
  /** 当天（Asia/Shanghai）我在它家已撸的次数 */
  pats: number
  /** 宠物累计被撸次数（人气） */
  popularity: number
  mood: number
  /** 今天还剩几次 */
  remaining: number
  animation: 'pat'
}

export interface PetGuestbookResult {
  entry: PetGuestbookEntryDto
  guestbook: PetGuestbookEntryDto[]
}

export interface PetGuestbookDeleteResult {
  id: number
}

const PET_HOME_EMPTY_MESSAGE = '这个宠物之家暂时没有小宠物'

function petCatalogDto(): PetCatalogDto {
  return {
    species: PET_SPECIES,
    outfits: PET_OUTFITS,
    equipment: [...PET_EQUIPMENT_MAP.values()],
    skills: PET_SKILLS,
    shopEquipment: PET_SHOP_EQUIPMENTS,
    shopSkills: PET_SHOP_SKILLS,
    maxEquippedSkills: PET_SKILL_MAX_EQUIPPED,
    costs: PET_COSTS,
    careActions: PET_CARE_ACTIONS,
    tricks: PET_TRICKS,
    maxLevel: PET_MAX_LEVEL,
    levelCostBase: petUpgradeCost(1),
    decayPerHour: { ...PET_DECAY_PER_HOUR },
    graceHours: PET_GRACE_HOURS,
    switchCost: PET_COSTS.switch,
    patDailyLimit: PAT_DAILY_LIMIT,
    guestbookDailyLimit: GUESTBOOK_DAILY_LIMIT,
    guestbookMaxLength: GUESTBOOK_MAX_LENGTH,
  }
}

/** 按已拥有清单过滤装配（未拥有项不展示，容忍脏数据） */
function filterEquippedByOwned(raw: PetEquipped, owned: ReadonlySet<string>): PetEquipped {
  const result = emptyPetEquipped()
  for (const slot of PET_OUTFIT_SLOTS) {
    const key = raw[slot]
    if (key && owned.has(key)) result[slot] = key
  }
  return result
}

function petDto(
  row: Pet,
  ownedOutfits: string[],
  ownedEquipment: string[],
  ownedSkills: string[],
  now: number,
): PetDto {
  const alive = row.status === 'alive'
  const owned = new Set(ownedOutfits)
  const equipped = alive
    ? filterEquippedByOwned(cleanEquipped(row.equipped), owned)
    : emptyPetEquipped() // 出走的宠物展示时摘下全部装扮（库里仍保留）
  const loadout = alive
    ? cleanLoadout(row.equipped, ownedEquipment, ownedSkills)
    : emptyPetLoadout()
  const lastTouch = row.lastTouchAt ? row.lastTouchAt.getTime() : null
  const species = getPetSpecies(row.species)
  const battleStats = deriveCombatStats({
    species: row.species,
    level: row.level,
    equipmentKeys: loadoutEquipmentKeys(loadout),
  })
  return {
    id: row.id,
    ownerId: row.userId,
    species: row.species,
    speciesName: species?.name ?? '宠物',
    speciesEmoji: species?.emoji ?? '🐾',
    name: row.name,
    level: row.level,
    status: alive ? 'alive' : 'gone',
    hunger: alive ? roundStat(row.hunger) : 0,
    cleanliness: alive ? roundStat(row.cleanliness) : 0,
    mood: alive ? roundStat(row.mood) : 0,
    decayPerHour: { ...PET_DECAY_PER_HOUR },
    zeroAtMs: alive && row.criticalSince ? row.criticalSince.getTime() : null,
    graceHours: PET_GRACE_HOURS,
    equipped,
    ownedOutfits,
    loadout,
    ownedEquipment,
    ownedSkills,
    battleStats,
    unlockedActions: petUnlockedActions(row.level),
    nextLevelCost: row.level < PET_MAX_LEVEL ? petUpgradeCost(row.level) : null,
    touchReady: alive && (lastTouch === null || now - lastTouch >= PET_TOUCH_COOLDOWN_MS),
    pats: Math.max(0, row.pats ?? 0),
    switchCost: PET_COSTS.switch,
  }
}

function toMutationResult(view: PetView): PetMutationResult {
  if (!view.pet) throw new AppError('还没有宠物', 404)
  return { pet: view.pet, points: view.points }
}

/* ============================================================
   读取（惰性结算）
   ============================================================ */

function toStatsInput(row: Pet): PetStatsInput {
  return {
    hunger: row.hunger,
    cleanliness: row.cleanliness,
    mood: row.mood,
    decayedAt: row.decayedAt.getTime(),
    criticalSince: row.criticalSince ? row.criticalSince.getTime() : null,
    status: row.status,
  }
}

export async function getPetView(userId: number): Promise<PetView> {
  const now = Date.now()
  const [row, profile] = await Promise.all([
    prisma.pet.findUnique({
      where: { userId },
      include: {
        outfits: { select: { outfitKey: true } },
        equipments: { select: { itemKey: true } },
        skills: { select: { skillKey: true } },
      },
    }),
    getPointsProfile(userId),
  ])

  if (!row) {
    return { pet: null, catalog: petCatalogDto(), points: profile.balance }
  }

  const ownedOutfits = row.outfits.map((outfit) => outfit.outfitKey)
  const ownedEquipment = row.equipments.map((item) => item.itemKey)
  const ownedSkills = row.skills.map((item) => item.skillKey)
  let current: Pet = row

  if (row.status === 'alive') {
    const settled = settlePetStats(toStatsInput(row), now)
    if (settled.gone) {
      // 冷落太久：置为出走，清 criticalSince；equipped / 已购装扮保留
      current = await prisma.pet.update({
        where: { id: row.id },
        data: {
          status: 'gone',
          criticalSince: null,
          hunger: settled.hunger,
          cleanliness: settled.cleanliness,
          mood: settled.mood,
          decayedAt: new Date(settled.decayedAt),
        },
      })
    } else {
      // 结算结果落库（数值推进 / 基准时刻前移 / 危机时刻变化）
      const criticalChanged = (settled.criticalSince ?? null)
        !== (row.criticalSince ? row.criticalSince.getTime() : null)
      const statsChanged = settled.hunger !== row.hunger
        || settled.cleanliness !== row.cleanliness
        || settled.mood !== row.mood
        || settled.decayedAt !== row.decayedAt.getTime()
      if (criticalChanged || statsChanged) {
        current = await prisma.pet.update({
          where: { id: row.id },
          data: {
            hunger: settled.hunger,
            cleanliness: settled.cleanliness,
            mood: settled.mood,
            decayedAt: new Date(settled.decayedAt),
            criticalSince: settled.criticalSince === null ? null : new Date(settled.criticalSince),
          },
        })
      }
    }
  }

  return {
    pet: petDto(current, ownedOutfits, ownedEquipment, ownedSkills, now),
    catalog: petCatalogDto(),
    points: profile.balance,
  }
}

/* ============================================================
   写操作（统一模式：事务内 结算 → 业务校验 → 扣积分 → 更新）
   ============================================================ */

const PET_GONE_MESSAGE = '宠物已经离家出走了，重新召唤一只吧'

type SettledPetState =
  | { gone: true; pet: Pet }
  | { gone: false; pet: Pet; settled: PetStatsSettled }

/**
 * 事务内读取宠物并完成惰性结算（结算结果先落库再继续）。
 * 用户不存在宠物行 → 404；结算后判定出走 → gone=true（出走状态已在事务内落库）。
 */
async function loadSettledPetTx(tx: Db, userId: number, now: number): Promise<SettledPetState> {
  const pet = await tx.pet.findUnique({ where: { userId } })
  if (!pet) throw new AppError('还没有宠物', 404)
  if (pet.status !== 'alive') return { gone: true, pet }

  const settled = settlePetStats(toStatsInput(pet), now)
  if (settled.gone) {
    const updated = await tx.pet.update({
      where: { id: pet.id },
      data: {
        status: 'gone',
        criticalSince: null,
        hunger: settled.hunger,
        cleanliness: settled.cleanliness,
        mood: settled.mood,
        decayedAt: new Date(settled.decayedAt),
      },
    })
    return { gone: true, pet: updated }
  }

  await tx.pet.update({
    where: { id: pet.id },
    data: {
      hunger: settled.hunger,
      cleanliness: settled.cleanliness,
      mood: settled.mood,
      decayedAt: new Date(settled.decayedAt),
      criticalSince: settled.criticalSince === null ? null : new Date(settled.criticalSince),
    },
  })
  return { gone: false, pet, settled }
}

type PetTxOutcome = { gone: true } | { gone: false }

/** 出走判定：事务提交（出走状态已落库）后再抛 409，保证扣费等副作用为零 */
function throwIfGone(outcome: PetTxOutcome): void {
  if (outcome.gone) throw new AppError(PET_GONE_MESSAGE, 409, 'PET_GONE')
}

/* ============================================================
   战斗装备 / 技能（与装扮共用 Pet.equipped JSON）
   ============================================================ */

/** 确保三件绑定新手装存在（召唤 / 首次进入装备页时调用） */
async function grantStarterEquipmentTx(tx: Db, petId: number): Promise<void> {
  for (const key of PET_STARTER_EQUIPMENT_KEYS) {
    await tx.petEquipment.upsert({
      where: { petId_itemKey: { petId, itemKey: key } },
      update: {},
      create: { petId, itemKey: key, bound: true, acquiredVia: 'starter' },
    })
  }
}

/** 对外：给已有宠物补发绑定新手装（战斗快照前调用，兼容旧数据） */
export async function ensureStarterEquipment(userId: number): Promise<void> {
  const pet = await prisma.pet.findUnique({ where: { userId }, select: { id: true } })
  if (!pet) return
  await prisma.$transaction(async (tx) => {
    await grantStarterEquipmentTx(tx, pet.id)
  })
}

function starterLoadout(): PetLoadout {
  const loadout = emptyPetLoadout()
  for (const key of PET_STARTER_EQUIPMENT_KEYS) {
    const item = PET_EQUIPMENT_MAP.get(key)
    if (item) loadout[item.slot] = item.key
  }
  return loadout
}

/** 装备 / 技能目录 + 我的拥有与穿戴（前端装备页） */
export interface PetGearView {
  pet: PetDto
  catalog: PetCatalogDto
  points: number
  stats: {
    current: PetCombatStats
    /** 若把某件装备换上后的属性（前端悬停对比用） */
    equipment: Array<{
      key: string
      stats: PetCombatStats
      delta: PetCombatStats
    }>
  }
}

function statsDelta(next: PetCombatStats, base: PetCombatStats): PetCombatStats {
  return {
    maxHp: next.maxHp - base.maxHp,
    maxMp: next.maxMp - base.maxMp,
    atk: next.atk - base.atk,
    def: next.def - base.def,
    spd: next.spd - base.spd,
    crit: next.crit - base.crit,
  }
}

/** 读取装备页数据（首次访问补发绑定新手装） */
export async function getPetGearView(userId: number): Promise<PetGearView> {
  const existing = await prisma.pet.findUnique({ where: { userId }, select: { id: true } })
  if (!existing) throw new AppError('还没有宠物', 404)
  await prisma.$transaction(async (tx) => {
    await grantStarterEquipmentTx(tx, existing.id)
  })
  const view = await getPetView(userId)
  if (!view.pet) throw new AppError('还没有宠物', 404)
  const base = deriveCombatStats({
    species: view.pet.species,
    level: view.pet.level,
    equipmentKeys: loadoutEquipmentKeys(view.pet.loadout),
  })
  const equipment = view.pet.ownedEquipment
    .map((key) => PET_EQUIPMENT_MAP.get(key))
    .filter((item): item is PetEquipmentDef => !!item)
    .map((item) => {
      const nextKeys = loadoutEquipmentKeys(view.pet!.loadout).filter((key) => {
        const current = PET_EQUIPMENT_MAP.get(key)
        return current?.slot !== item.slot
      })
      nextKeys.push(item.key)
      const stats = deriveCombatStats({
        species: view.pet!.species,
        level: view.pet!.level,
        equipmentKeys: nextKeys,
      })
      return { key: item.key, stats, delta: statsDelta(stats, base) }
    })
  return { pet: view.pet, catalog: view.catalog, points: view.points, stats: { current: base, equipment } }
}

/** 购买装备（系统商店，只卖 shopable 的普通/稀有装备） */
export async function buyEquipment(userId: number, key: string): Promise<PetMutationResult> {
  const item = PET_EQUIPMENT_MAP.get(key)
  if (!item || !item.shopable) throw new AppError('商店里没有这件装备', 404)
  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const { pet } = state
    if (pet.level < item.minLevel) throw new AppError(`需要宠物等级 ${item.minLevel}`, 400)
    const owned = await tx.petEquipment.findUnique({
      where: { petId_itemKey: { petId: pet.id, itemKey: item.key } },
    })
    if (owned) throw new AppError('已经拥有这件装备了', 409)
    await spendPointsTx(tx, userId, item.price, {
      reason: 'pet_equipment_buy',
      note: `购买${item.name}`,
      game: null,
    })
    await tx.petEquipment.create({
      data: { petId: pet.id, itemKey: item.key, bound: false, acquiredVia: 'shop' },
    })
    await grantStarterEquipmentTx(tx, pet.id)
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/** 购买技能（技能商店） */
export async function buySkill(userId: number, key: string): Promise<PetMutationResult> {
  const skill = PET_SKILL_MAP.get(key)
  if (!skill || skill.key === 'basic_attack') throw new AppError('商店里没有这个技能', 404)
  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const { pet } = state
    if (pet.level < skill.minLevel) throw new AppError(`需要宠物等级 ${skill.minLevel}`, 400)
    const owned = await tx.petSkill.findUnique({
      where: { petId_skillKey: { petId: pet.id, skillKey: skill.key } },
    })
    if (owned) throw new AppError('已经学会这个技能了', 409)
    await spendPointsTx(tx, userId, skill.price, {
      reason: 'pet_skill_buy',
      note: `学习${skill.name}`,
      game: null,
    })
    await tx.petSkill.create({
      data: { petId: pet.id, skillKey: skill.key, acquiredVia: 'shop' },
    })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/**
 * 穿戴 / 卸下装备或技能。
 * itemType='equipment' 时 key 为装备 key（同槽位自动替换）；'skill' 时最多装 3 个。
 * 战斗进行中禁止换装（避免快照与实际装备不一致）。
 */
export async function equipGear(
  userId: number,
  input: { itemType: 'equipment' | 'skill'; key: string; equip: boolean },
): Promise<PetMutationResult> {
  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const { pet } = state

    const active = await tx.petBattle.count({
      where: {
        status: 'active',
        OR: [{ challengerId: userId }, { opponentId: userId }],
      },
    })
    if (active > 0) throw new AppError('对战进行中不能更换装备或技能', 409)

    const ownedEquipment = await tx.petEquipment.findMany({
      where: { petId: pet.id },
      select: { itemKey: true },
    })
    const ownedSkills = await tx.petSkill.findMany({
      where: { petId: pet.id },
      select: { skillKey: true },
    })
    const loadout = cleanLoadout(
      pet.equipped,
      ownedEquipment.map((item) => item.itemKey),
      ownedSkills.map((item) => item.skillKey),
    )

    if (input.itemType === 'equipment') {
      const item = PET_EQUIPMENT_MAP.get(input.key)
      if (!item) throw new AppError('装备不存在', 404)
      if (!ownedEquipment.some((row) => row.itemKey === item.key)) {
        throw new AppError('还没有这件装备', 400)
      }
      const listed = await tx.petMarketListing.count({
        where: { sellerId: userId, status: 'active', itemType: 'equipment', itemKey: item.key },
      })
      if (listed > 0) throw new AppError('这件装备正在交易行挂单，请先下架', 409)
      if (pet.level < item.minLevel) throw new AppError(`需要宠物等级 ${item.minLevel}`, 400)
      if (input.equip) {
        loadout[item.slot] = item.key
      } else if (loadout[item.slot] === item.key) {
        loadout[item.slot] = null
      }
    } else {
      const skill = PET_SKILL_MAP.get(input.key)
      if (!skill || skill.key === 'basic_attack') throw new AppError('技能不存在', 404)
      if (!ownedSkills.some((row) => row.skillKey === skill.key)) {
        throw new AppError('还没有学会这个技能', 400)
      }
      const listed = await tx.petMarketListing.count({
        where: { sellerId: userId, status: 'active', itemType: 'skill', itemKey: skill.key },
      })
      if (listed > 0) throw new AppError('这个技能正在交易行挂单，请先下架', 409)
      if (pet.level < skill.minLevel) throw new AppError(`需要宠物等级 ${skill.minLevel}`, 400)
      if (input.equip) {
        if (!loadout.skills.includes(skill.key)) {
          if (loadout.skills.length >= PET_SKILL_MAX_EQUIPPED) {
            throw new AppError(`最多只能装备 ${PET_SKILL_MAX_EQUIPPED} 个技能`, 400)
          }
          loadout.skills.push(skill.key)
        }
      } else {
        loadout.skills = loadout.skills.filter((key) => key !== skill.key)
      }
    }

    await tx.pet.update({
      where: { id: pet.id },
      data: { equipped: serializeLoadout(loadout) },
    })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/** 召唤宠物（出走后可重新召唤：复用同一行重置，已购装扮保留） */
export async function summonPet(
  userId: number,
  input: { species: string; name?: string },
): Promise<PetMutationResult> {
  const species = getPetSpecies(input.species)
  if (!species) throw new AppError('请选择一种宠物', 400)
  const name = normalizePetName(input.name, species.defaultName)

  await prisma.$transaction(async (tx) => {
    const existing = await tx.pet.findUnique({ where: { userId } })
    if (existing && existing.status === 'alive') throw new AppError('你已经有一只宠物啦', 409)
    const now = new Date()
    let petId: number
    if (existing) {
      const updated = await tx.pet.update({
        where: { id: existing.id },
        data: {
          species: species.key,
          name,
          level: 1,
          hunger: 100,
          cleanliness: 100,
          mood: 100,
          status: 'alive',
          equipped: serializeLoadout(starterLoadout()),
          decayedAt: now,
          criticalSince: null,
          lastTouchAt: null,
        },
      })
      petId = updated.id
    } else {
      const created = await tx.pet.create({
        data: {
          userId,
          species: species.key,
          name,
          hunger: 100,
          cleanliness: 100,
          mood: 100,
          equipped: serializeLoadout(starterLoadout()),
          decayedAt: now,
        },
      })
      petId = created.id
    }
    await grantStarterEquipmentTx(tx, petId)
    await spendPointsTx(tx, userId, PET_COSTS.summon, {
      reason: 'pet_summon',
      note: `召唤${species.name}·${name}`,
      game: null,
    })
  })
  return toMutationResult(await getPetView(userId))
}

/** 照顾动作（喂食 / 洗澡 / 玩耍）：结算后的新值上应用效果 */
export async function carePet(userId: number, kind: PetCareKind): Promise<PetMutationResult> {
  const action = PET_CARE_ACTIONS.find((item) => item.key === kind)
  if (!action) throw new AppError('未知的照顾动作', 400)

  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const { pet, settled } = state
    if (pet.level < action.minLevel) throw new AppError('等级不足，还不能进行这个操作', 400)
    if (kind === 'feed' && settled.hunger >= 99.5) throw new AppError('它现在很饱，不用喂啦', 400)
    if (kind === 'bathe' && settled.cleanliness >= 99.5) throw new AppError('它现在很干净，不用洗啦', 400)

    let { hunger, cleanliness, mood } = settled
    if (kind === 'feed') {
      hunger = 100
      mood = Math.min(100, mood + 5)
    } else if (kind === 'bathe') {
      cleanliness = 100
      mood = Math.min(100, mood + 5)
    } else {
      mood = Math.min(100, mood + 30)
    }
    const criticalSince = recomputeCriticalSince(hunger, cleanliness, mood, settled.criticalSince)

    await spendPointsTx(tx, userId, action.cost, {
      reason: `pet_${kind}`,
      note: action.name,
      game: null,
    })
    await tx.pet.update({
      where: { id: pet.id },
      data: { hunger, cleanliness, mood, criticalSince: criticalSince === null ? null : new Date(criticalSince), decayedAt: new Date(now) },
    })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/** 抚摸：免费；60 秒冷却，命中时心情 +2 */
export async function touchPet(userId: number): Promise<PetTouchResult> {
  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome & { gained: boolean }> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true, gained: false }
    const { pet, settled } = state
    const lastTouch = pet.lastTouchAt ? pet.lastTouchAt.getTime() : null
    const ready = lastTouch === null || now - lastTouch >= PET_TOUCH_COOLDOWN_MS
    if (ready) {
      const mood = Math.min(100, settled.mood + PET_TOUCH_MOOD_BONUS)
      const criticalSince = recomputeCriticalSince(settled.hunger, settled.cleanliness, mood, settled.criticalSince)
      await tx.pet.update({
        where: { id: pet.id },
        data: { mood, criticalSince: criticalSince === null ? null : new Date(criticalSince), decayedAt: new Date(now), lastTouchAt: new Date(now) },
      })
    }
    return { gone: false, gained: ready }
  })
  throwIfGone(outcome)
  const result = toMutationResult(await getPetView(userId))
  return { ...result, gained: outcome.gained }
}

/** 特技动作：免费、不改数值，只校验等级并结算衰减 */
export async function trickPet(userId: number, action: string): Promise<PetTrickResult> {
  const trick = PET_TRICKS.find((item) => item.key === action)
  if (!trick) throw new AppError('还没有解锁这个动作', 400)

  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    if (state.pet.level < trick.minLevel) throw new AppError('还没有解锁这个动作', 400)
    return { gone: false }
  })
  throwIfGone(outcome)
  const result = toMutationResult(await getPetView(userId))
  return { ...result, animation: trick.key }
}

/** 升级：花 petUpgradeCost(level) 积分 */
export async function upgradePet(userId: number): Promise<PetMutationResult> {
  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const { pet } = state
    if (pet.level >= PET_MAX_LEVEL) throw new AppError('已经是满级啦', 400)
    await spendPointsTx(tx, userId, petUpgradeCost(pet.level), {
      reason: 'pet_upgrade',
      note: `升级到 ${pet.level + 1} 级`,
      game: null,
    })
    await tx.pet.update({ where: { id: pet.id }, data: { level: { increment: 1 } } })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/** 购买装扮（写 PetOutfit 行，永久拥有） */
export async function buyOutfit(userId: number, outfitKey: string): Promise<PetMutationResult> {
  const outfit = getPetOutfit(outfitKey)
  if (!outfit) throw new AppError('没有这件装扮', 404)

  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const owned = await tx.petOutfit.findMany({ where: { petId: state.pet.id }, select: { outfitKey: true } })
    const ownedSet = new Set(owned.map((row) => row.outfitKey))
    if (ownedSet.has(outfit.key)) throw new AppError('已经拥有这件装扮啦', 409)
    if (state.pet.level < outfit.minLevel) throw new AppError('等级不足，还不能购买这件装扮', 400)
    await spendPointsTx(tx, userId, outfit.price, {
      reason: 'pet_outfit',
      note: `购买装扮·${outfit.name}`,
      game: null,
    })
    await tx.petOutfit.create({ data: { petId: state.pet.id, outfitKey: outfit.key } })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/** 佩戴 / 取下装扮（equipped JSON 同 slot 自动替换） */
export async function equipOutfit(
  userId: number,
  outfitKey: string,
  equip: boolean,
): Promise<PetMutationResult> {
  const outfit = getPetOutfit(outfitKey)
  if (!outfit) throw new AppError('没有这件装扮', 404)

  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const owned = await tx.petOutfit.findMany({ where: { petId: state.pet.id }, select: { outfitKey: true } })
    const ownedSet = new Set(owned.map((row) => row.outfitKey))
    if (!ownedSet.has(outfit.key)) throw new AppError('还没有获得这件装扮', 400)

    const [equipmentRows, skillRows] = await Promise.all([
      tx.petEquipment.findMany({ where: { petId: state.pet.id }, select: { itemKey: true } }),
      tx.petSkill.findMany({ where: { petId: state.pet.id }, select: { skillKey: true } }),
    ])
    const loadout = cleanLoadout(
      state.pet.equipped,
      equipmentRows.map((row) => row.itemKey),
      skillRows.map((row) => row.skillKey),
    )
    const next: PetLoadout = equip
      ? { ...loadout, [outfit.slot]: outfit.key }
      : { ...loadout, [outfit.slot]: loadout[outfit.slot] === outfit.key ? null : loadout[outfit.slot] }
    await tx.pet.update({ where: { id: state.pet.id }, data: { equipped: serializeLoadout(next) } })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/** 改名：trim 后 1–12 字 */
export async function renamePet(userId: number, name: string): Promise<PetMutationResult> {
  const clean = name.trim()
  if (!clean || clean.length > PET_NAME_MAX_LENGTH) {
    throw new AppError('宠物名字长度需在 1–12 个字之间', 400)
  }

  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    await tx.pet.update({ where: { id: state.pet.id }, data: { name: clean } })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/**
 * 换物种：保留等级 / 数值 / 已购装扮，只改 species（默认名同步，自定义名保留）。
 * 与召唤区分开：召唤是「重新开始」，换物种是「同一个伙伴换了个模样」。
 */
export async function switchPetSpecies(userId: number, speciesKey: string): Promise<PetMutationResult> {
  const species = getPetSpecies(speciesKey)
  if (!species) throw new AppError('请选择一种宠物', 400)

  const now = Date.now()
  const outcome = await prisma.$transaction(async (tx): Promise<PetTxOutcome> => {
    const state = await loadSettledPetTx(tx, userId, now)
    if (state.gone) return { gone: true }
    const { pet } = state
    if (pet.species === species.key) throw new AppError(`它已经是${species.name}啦`, 400)

    const name = nextNameAfterSwitch(pet.name, pet.species, species)
    await spendPointsTx(tx, userId, PET_COSTS.switch, {
      reason: 'pet_switch',
      note: `换成${species.name}`,
      game: null,
    })
    await tx.pet.update({ where: { id: pet.id }, data: { species: species.key, name } })
    return { gone: false }
  })
  throwIfGone(outcome)
  return toMutationResult(await getPetView(userId))
}

/* ============================================================
   宠物之家（公开串门）
   ============================================================ */

type TargetPetState =
  | { kind: 'missing' }
  | { kind: 'gone'; pet: Pet }
  | { kind: 'alive'; pet: Pet; settled: PetStatsSettled }

/**
 * 事务内读取「目标用户」的宠物并完成惰性结算（与自己的宠物走同一套衰减口径）。
 *
 * 只有「数值漂移 ≥ 0.2 / 危机时刻变化 / 判定出走」才写库：
 * 宠物之家会被反复轮询，没必要每个访客每次读取都写一行；
 * 不写库时返回值仍用本次结算出的数值，展示结果一致。
 */
async function settleTargetPetTx(tx: Db, targetUserId: number, now: number): Promise<TargetPetState> {
  const pet = await tx.pet.findUnique({
    where: { userId: targetUserId },
    include: { user: { select: { status: true } } },
  })
  if (!pet) return { kind: 'missing' }
  // 待审核 / 已拒绝账号的宠物不对外开放（列表里也不出现，这里兜住直接构造 userId 的请求）
  if (pet.user.status !== 'active') return { kind: 'missing' }
  if (pet.status !== 'alive') return { kind: 'gone', pet }

  const settled = settlePetStats(toStatsInput(pet), now)
  const criticalChanged = (settled.criticalSince ?? null)
    !== (pet.criticalSince ? pet.criticalSince.getTime() : null)
  const drifted = Math.abs(settled.hunger - pet.hunger) >= 0.2
    || Math.abs(settled.cleanliness - pet.cleanliness) >= 0.2
    || Math.abs(settled.mood - pet.mood) >= 0.2

  if (!settled.gone && !criticalChanged && !drifted) {
    return { kind: 'alive', pet, settled }
  }

  const updated = await tx.pet.update({
    where: { id: pet.id },
    data: {
      status: settled.gone ? 'gone' : 'alive',
      hunger: settled.hunger,
      cleanliness: settled.cleanliness,
      mood: settled.mood,
      decayedAt: new Date(settled.decayedAt),
      criticalSince: settled.gone
        ? null
        : settled.criticalSince === null ? null : new Date(settled.criticalSince),
    },
  })
  return settled.gone ? { kind: 'gone', pet: updated } : { kind: 'alive', pet: updated, settled }
}

/** 列表卡片用的宠物摘要（只暴露 mood，不暴露 hunger / cleanliness 精确值） */
function petHomeSummaryDto(
  row: Pet,
  owner: { id: number; username: string; avatarVersion: number },
  viewerId: number,
  mood: number,
): PetHomeSummary {
  const species = getPetSpecies(row.species)
  return {
    userId: owner.id,
    username: owner.username,
    avatarVersion: owner.avatarVersion,
    pet: {
      species: row.species,
      speciesName: species?.name ?? '宠物',
      name: row.name,
      level: row.level,
      mood: roundStat(mood),
      pats: Math.max(0, row.pats ?? 0),
      equipped: cleanEquipped(row.equipped),
    },
    isSelf: owner.id === viewerId,
  }
}

function petGuestbookDto(
  row: {
    id: number
    content: string
    createdAt: Date
    authorId: number
    author: { id: number; username: string }
  },
  viewerId: number,
): PetGuestbookEntryDto {
  return {
    id: row.id,
    content: row.content,
    author: { userId: row.author.id, username: row.author.username },
    createdAt: row.createdAt.toISOString(),
    isMine: row.authorId === viewerId,
  }
}

async function loadGuestbook(petId: number, viewerId: number): Promise<PetGuestbookEntryDto[]> {
  const rows = await prisma.petGuestbook.findMany({
    where: { petId },
    orderBy: { createdAt: 'desc' },
    take: GUESTBOOK_PAGE_SIZE,
    select: {
      id: true,
      content: true,
      createdAt: true,
      authorId: true,
      author: { select: { id: true, username: true } },
    },
  })
  return rows.map((row) => petGuestbookDto(row, viewerId))
}

/**
 * 宠物之家列表：所有在世宠物（最多 60 条），按人气 / 等级排序。
 * 搜索同时匹配用户名与宠物名（Prisma contains；SQLite 下 ASCII 天然不区分大小写）。
 */
export async function listPetHomes(viewerId: number, rawQuery?: string): Promise<PetHomesResult> {
  const query = (rawQuery ?? '').trim().slice(0, 30)
  const where: Prisma.PetWhereInput = {
    status: 'alive',
    user: { status: 'active' },
  }
  if (query) {
    where.OR = [
      { name: { contains: query } },
      { user: { username: { contains: query } } },
    ]
  }

  const rows = await prisma.pet.findMany({
    where,
    orderBy: [{ pats: 'desc' }, { level: 'desc' }, { createdAt: 'asc' }],
    take: PET_HOMES_LIMIT,
    include: { user: { select: { id: true, username: true, avatarVersion: true } } },
  })

  // 列表是「读」而不是「写」：只做内存结算，不为了展示去批量更新 60 行；
  // 已经过了宽限期但状态还没落库的宠物直接从列表剔除，避免把「实际已出走」的宠物展示出来。
  const now = Date.now()
  const homes: PetHomeSummary[] = []
  for (const row of rows) {
    const settled = row.status === 'alive' ? settlePetStats(toStatsInput(row), now) : null
    if (!settled || settled.gone) continue
    homes.push(petHomeSummaryDto(row, row.user, viewerId, settled.mood))
  }

  return { homes, query }
}

/** 宠物之家详情：目标宠物 + 最近留言 + 我的今日剩余次数 + 人气排名 */
export async function getPetHome(viewerId: number, targetUserId: number): Promise<PetHomeDetail> {
  const now = Date.now()
  const owner = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, username: true, avatarVersion: true, status: true },
  })
  if (!owner || owner.status !== 'active') throw new AppError(PET_HOME_EMPTY_MESSAGE, 404)

  const state = await prisma.$transaction((tx) => settleTargetPetTx(tx, targetUserId, now))
  if (state.kind !== 'alive') throw new AppError(PET_HOME_EMPTY_MESSAGE, 404)
  const { pet, settled } = state

  const dateKey = getTodayDateKey(now)
  const dayStart = getTodayDayStart(now)
  const [guestbook, visit, ownedOutfits, higherPats, guestbookToday] = await Promise.all([
    loadGuestbook(pet.id, viewerId),
    prisma.petVisit.findUnique({
      where: { petId_visitorId_dateKey: { petId: pet.id, visitorId: viewerId, dateKey } },
      select: { pats: true },
    }),
    prisma.petOutfit.findMany({ where: { petId: pet.id }, select: { outfitKey: true } }),
    prisma.pet.count({
      where: { status: 'alive', pats: { gt: pet.pats }, user: { status: 'active' } },
    }),
    prisma.petGuestbook.count({
      where: { petId: pet.id, authorId: viewerId, createdAt: { gte: dayStart } },
    }),
  ])

  const patsToday = Math.max(0, visit?.pats ?? 0)
  const isSelf = viewerId === targetUserId
  const species = getPetSpecies(pet.species)
  const owned = new Set(ownedOutfits.map((row) => row.outfitKey))

  return {
    owner: { userId: owner.id, username: owner.username, avatarVersion: owner.avatarVersion },
    publicPet: {
      species: pet.species,
      speciesName: species?.name ?? '宠物',
      name: pet.name,
      level: pet.level,
      mood: roundStat(settled.mood),
      equipped: filterEquippedByOwned(cleanEquipped(pet.equipped), owned),
      pats: Math.max(0, pet.pats ?? 0),
      status: pet.status,
    },
    guestbook,
    viewer: {
      patsToday,
      patsRemaining: Math.max(0, PAT_DAILY_LIMIT - patsToday),
      canGuestbook: !isSelf && guestbookToday < GUESTBOOK_DAILY_LIMIT,
    },
    rank: higherPats + 1,
    isSelf,
  }
}

/**
 * 撸一撸别人的宠物：每天同一只最多 PAT_DAILY_LIMIT 次。
 * 只回补目标宠物的 mood（不动主人的积分 / 喂养状态），累计 pats 作为人气。
 */
export async function patPet(viewerId: number, targetUserId: number): Promise<PetPatResult> {
  if (viewerId === targetUserId) throw new AppError('不能撸自己的宠物哦', 400)

  const now = Date.now()
  const dateKey = getTodayDateKey(now)
  const outcome = await prisma.$transaction(async (tx) => {
    const state = await settleTargetPetTx(tx, targetUserId, now)
    if (state.kind === 'missing') return { kind: 'missing' as const }
    if (state.kind === 'gone') return { kind: 'gone' as const }

    const { pet, settled } = state
    // 先原子自增当天计数再判上限：并发下两个请求不会都按「旧值」放行
    const visit = await tx.petVisit.upsert({
      where: { petId_visitorId_dateKey: { petId: pet.id, visitorId: viewerId, dateKey } },
      create: { petId: pet.id, visitorId: viewerId, dateKey, pats: 1 },
      update: { pats: { increment: 1 } },
      select: { pats: true },
    })
    if (visit.pats > PAT_DAILY_LIMIT) {
      // 抛错会回滚本次自增，计数器保持在上限值
      throw new AppError('今天已经撸够啦，明天再来吧', 409, 'PET_PAT_LIMIT')
    }

    const mood = Math.min(100, settled.mood + PET_PAT_MOOD_BONUS)
    const criticalSince = recomputeCriticalSince(settled.hunger, settled.cleanliness, mood, settled.criticalSince)
    const updated = await tx.pet.update({
      where: { id: pet.id },
      data: {
        pats: { increment: 1 },
        mood,
        criticalSince: criticalSince === null ? null : new Date(criticalSince),
        decayedAt: new Date(now),
      },
    })
    return { kind: 'ok' as const, popularity: Math.max(0, updated.pats), mood, used: visit.pats }
  })

  if (outcome.kind === 'missing' || outcome.kind === 'gone') {
    throw new AppError(PET_HOME_EMPTY_MESSAGE, 404)
  }
  return {
    pats: outcome.used,
    popularity: outcome.popularity,
    mood: roundStat(outcome.mood),
    remaining: Math.max(0, PAT_DAILY_LIMIT - outcome.used),
    animation: 'pat',
  }
}

/** 留言：同一访客对同一宠物每天最多 GUESTBOOK_DAILY_LIMIT 条 */
export async function addGuestbookEntry(
  viewerId: number,
  targetUserId: number,
  rawContent: string,
): Promise<PetGuestbookResult> {
  const content = sanitizeGuestbookContent(rawContent)
  if (!content) throw new AppError('留言内容不能为空', 400)
  if (viewerId === targetUserId) throw new AppError('不能在自己的宠物之家留言', 400)

  const now = Date.now()
  const dayStart = getTodayDayStart(now)
  const outcome = await prisma.$transaction(async (tx) => {
    const state = await settleTargetPetTx(tx, targetUserId, now)
    if (state.kind !== 'alive') return { kind: 'empty' as const }

    const usedToday = await tx.petGuestbook.count({
      where: { petId: state.pet.id, authorId: viewerId, createdAt: { gte: dayStart } },
    })
    if (usedToday >= GUESTBOOK_DAILY_LIMIT) return { kind: 'limited' as const }

    const entry = await tx.petGuestbook.create({
      data: { petId: state.pet.id, authorId: viewerId, content },
      select: {
        id: true,
        content: true,
        createdAt: true,
        authorId: true,
        author: { select: { id: true, username: true } },
      },
    })
    return { kind: 'ok' as const, petId: state.pet.id, entry }
  })

  if (outcome.kind === 'empty') throw new AppError(PET_HOME_EMPTY_MESSAGE, 404)
  if (outcome.kind === 'limited') {
    throw new AppError(`今天留言次数用完了（每天 ${GUESTBOOK_DAILY_LIMIT} 条）`, 409, 'PET_GUESTBOOK_LIMIT')
  }
  return {
    entry: petGuestbookDto(outcome.entry, viewerId),
    guestbook: await loadGuestbook(outcome.petId, viewerId),
  }
}

/** 删除留言：只有作者本人能删（宠物主人也不行） */
export async function deleteGuestbookEntry(
  userId: number,
  entryId: number,
): Promise<PetGuestbookDeleteResult> {
  const entry = await prisma.petGuestbook.findUnique({
    where: { id: entryId },
    select: { id: true, authorId: true },
  })
  if (!entry) throw new AppError('留言不存在或已被删除', 404)
  if (entry.authorId !== userId) throw new AppError('只能删除自己的留言', 403)
  await prisma.petGuestbook.delete({ where: { id: entryId } })
  return { id: entryId }
}




