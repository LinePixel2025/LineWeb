import prisma from '../lib/prisma.js'
import type { Pet, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  PET_CARE_ACTIONS,
  PET_COSTS,
  PET_DECAY_PER_HOUR,
  PET_GRACE_HOURS,
  PET_MAX_LEVEL,
  PET_NAME_MAX_LENGTH,
  PET_OUTFITS,
  PET_OUTFIT_SLOTS,
  PET_SPECIES,
  PET_TOUCH_COOLDOWN_MS,
  PET_TOUCH_MOOD_BONUS,
  PET_TRICKS,
  cleanEquipped,
  emptyPetEquipped,
  getPetOutfit,
  getPetSpecies,
  petUnlockedActions,
  petUpgradeCost,
  recomputeCriticalSince,
  roundStat,
  serializeEquipped,
  settlePetStats,
  type PetCareActionDef,
  type PetCareKind,
  type PetEquipped,
  type PetOutfitDef,
  type PetSpeciesDef,
  type PetStatsInput,
  type PetStatsSettled,
  type PetTrickDef,
} from '../lib/petCatalog.js'
import { getPointsProfile, spendPointsTx } from './pointsService.js'

type Db = Prisma.TransactionClient

/* ============================================================
   DTO（前端契约，字段名保持稳定）
   ============================================================ */

export interface PetDto {
  id: number
  species: string
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
  unlockedActions: string[]
  /** 升到下一级的花费；满级为 null */
  nextLevelCost: number | null
  /** true = 现在抚摸可获得心情加成 */
  touchReady: boolean
}

export interface PetCatalogDto {
  species: readonly PetSpeciesDef[]
  outfits: readonly PetOutfitDef[]
  costs: typeof PET_COSTS
  careActions: readonly PetCareActionDef[]
  tricks: readonly PetTrickDef[]
  maxLevel: number
  levelCostBase: number
  decayPerHour: { hunger: number; cleanliness: number; mood: number }
  graceHours: number
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

function petCatalogDto(): PetCatalogDto {
  return {
    species: PET_SPECIES,
    outfits: PET_OUTFITS,
    costs: PET_COSTS,
    careActions: PET_CARE_ACTIONS,
    tricks: PET_TRICKS,
    maxLevel: PET_MAX_LEVEL,
    levelCostBase: petUpgradeCost(1),
    decayPerHour: { ...PET_DECAY_PER_HOUR },
    graceHours: PET_GRACE_HOURS,
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

function petDto(row: Pet, ownedOutfits: string[], now: number): PetDto {
  const alive = row.status === 'alive'
  const owned = new Set(ownedOutfits)
  const equipped = alive
    ? filterEquippedByOwned(cleanEquipped(row.equipped), owned)
    : emptyPetEquipped() // 出走的宠物展示时摘下全部装扮（库里仍保留）
  const lastTouch = row.lastTouchAt ? row.lastTouchAt.getTime() : null
  return {
    id: row.id,
    species: row.species,
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
    unlockedActions: petUnlockedActions(row.level),
    nextLevelCost: row.level < PET_MAX_LEVEL ? petUpgradeCost(row.level) : null,
    touchReady: alive && (lastTouch === null || now - lastTouch >= PET_TOUCH_COOLDOWN_MS),
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
    prisma.pet.findUnique({ where: { userId }, include: { outfits: { select: { outfitKey: true } } } }),
    getPointsProfile(userId),
  ])

  if (!row) {
    return { pet: null, catalog: petCatalogDto(), points: profile.balance }
  }

  const ownedOutfits = row.outfits.map((outfit) => outfit.outfitKey)
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

  return { pet: petDto(current, ownedOutfits, now), catalog: petCatalogDto(), points: profile.balance }
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

function normalizePetName(raw: string | null | undefined): string | null {
  const clean = (raw ?? '').trim()
  if (!clean) return null
  return clean.slice(0, PET_NAME_MAX_LENGTH)
}

/** 召唤宠物（出走后可重新召唤：复用同一行重置，已购装扮保留） */
export async function summonPet(
  userId: number,
  input: { species: string; name?: string },
): Promise<PetMutationResult> {
  const species = getPetSpecies(input.species)
  if (!species) throw new AppError('请选择一种宠物', 400)
  const name = normalizePetName(input.name) ?? species.defaultName

  await prisma.$transaction(async (tx) => {
    const existing = await tx.pet.findUnique({ where: { userId } })
    if (existing && existing.status === 'alive') throw new AppError('你已经有一只宠物啦', 409)
    const now = new Date()
    if (existing) {
      await tx.pet.update({
        where: { id: existing.id },
        data: {
          species: species.key,
          name,
          level: 1,
          hunger: 100,
          cleanliness: 100,
          mood: 100,
          status: 'alive',
          equipped: serializeEquipped(emptyPetEquipped()),
          decayedAt: now,
          criticalSince: null,
          lastTouchAt: null,
        },
      })
    } else {
      await tx.pet.create({
        data: {
          userId,
          species: species.key,
          name,
          hunger: 100,
          cleanliness: 100,
          mood: 100,
          decayedAt: now,
        },
      })
    }
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

    const base = filterEquippedByOwned(cleanEquipped(state.pet.equipped), ownedSet)
    const next: PetEquipped = equip
      ? { ...base, [outfit.slot]: outfit.key }
      : { ...base, [outfit.slot]: base[outfit.slot] === outfit.key ? null : base[outfit.slot] }
    await tx.pet.update({ where: { id: state.pet.id }, data: { equipped: serializeEquipped(next) } })
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
