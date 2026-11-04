/**
 * 搜打撤装备服务：装备列表 / 穿戴 / 维修 / 开箱（装备箱与技能卷轴）。
 *
 * 口径：
 *   - 每个槽位最多穿一件（helmet / armor / boots / backpack / rig）；
 *   - 换小背包 / 卸下胸挂前，容器里的物品必须先腾空到仓库；
 *   - 维修消耗仓库里的头修包 / 甲修包，每次维修永久降低 5% 耐久上限（不低于初始 30%）；
 *   - 装备箱 / 技能卷轴在仓库页开启，重复装备折 60% 积分（这是开箱行为，不是撤离自动出售）。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_GEAR_MAP,
  RAID_GEARS,
  RAID_ITEM_MAP,
  getRaidGear,
  repairRaidGear,
  type RaidGearSlot,
} from '../lib/raidRun.js'
import { PET_SKILLS, PET_SKILL_MAP, PET_BASIC_SKILL_KEY } from '../lib/petSkills.js'
import { awardPointsTx } from './pointsService.js'
import { ensureRaidStorageTx, gearDto } from './raidCommon.js'
import { buildStorageView, type RaidStorageViewDto } from './raidStorageService.js'
import { assertNoActiveRaid } from './raidRunService.js'

const RAID_GEAR_SLOTS: readonly RaidGearSlot[] = ['helmet', 'armor', 'boots', 'backpack', 'rig']

function assertSlot(slot: string): RaidGearSlot {
  if (!(RAID_GEAR_SLOTS as readonly string[]).includes(slot)) {
    throw new AppError('装备槽位不存在', 400)
  }
  return slot as RaidGearSlot
}

const CONTAINER_BY_SLOT: Partial<Record<RaidGearSlot, 'backpack' | 'rig'>> = {
  backpack: 'backpack',
  rig: 'rig',
}

/* ============================================================
   穿戴 / 卸下
   ============================================================ */

/**
 * 穿戴 / 卸下。
 *
 * 装备现在是「实例物品」（同一个 gearKey 可以有多件、各自独立耐久），所以定位一律用 RaidGear 行 id。
 * gearKey 作为向后兼容入参保留：旧标签页只提交 key 时取该型号里 id 最小的那一件，不至于全线 400。
 */
export async function equipRaidGear(
  userId: number,
  slotInput: string,
  gearId: number | null,
  gearKey?: string | null,
): Promise<RaidStorageViewDto> {
  await assertNoActiveRaid(userId)
  const slot = assertSlot(slotInput)
  await prisma.$transaction(async (tx) => {
    await ensureRaidStorageTx(tx, userId)
    const container = CONTAINER_BY_SLOT[slot]

    let nextRowId: number | null = null
    if (gearId !== null || gearKey) {
      const row = gearId !== null && gearId > 0
        ? await tx.raidGear.findFirst({ where: { id: gearId, userId } })
        : await tx.raidGear.findFirst({ where: { userId, gearKey: gearKey ?? '' }, orderBy: { id: 'asc' } })
      if (!row) throw new AppError('还没有这件装备', 404)
      const def = getRaidGear(row.gearKey)
      if (!def || def.slot !== slot) throw new AppError('装备槽位不匹配', 400)
      nextRowId = row.id
    }

    if (container) {
      // 换装备会改变容器容量：容量不足时禁止卸下 / 换小
      const nextDef = nextRowId !== null ? RAID_GEAR_MAP.get(
        (await tx.raidGear.findUnique({ where: { id: nextRowId } }))?.gearKey ?? '',
      ) : null
      const nextCapacity = Math.max(0, Math.trunc(nextDef?.slots ?? 0))
      const used = await tx.raidBagItem.count({ where: { userId, container } })
      if (used > nextCapacity) {
        const label = container === 'backpack' ? '背包' : '胸挂'
        throw new AppError(`先把${label}里的 ${used - nextCapacity} 格物品存进仓库，再更换${label}`, 400)
      }
    }

    await tx.raidGear.updateMany({
      where: { userId, slot, equipped: true },
      data: { equipped: false },
    })
    if (nextRowId !== null) {
      await tx.raidGear.update({ where: { id: nextRowId }, data: { equipped: true } })
    }
  })
  return buildStorageView(userId)
}

/* ============================================================
   手动回收重复装备（2026-11-04：重复获得不再自动折分，改由玩家自己决定留还是卖）
   ============================================================ */

/** 装备回收比例：与「重复装备自动折分」时代保持一致，避免改变老玩家的预期 */
export const RAID_GEAR_RECYCLE_RATE = 0.6

export interface RaidGearRecycleResult {
  points: number
  name: string
  view: RaidStorageViewDto
}

export async function recycleRaidGear(
  userId: number,
  gearId: number,
): Promise<RaidGearRecycleResult> {
  await assertNoActiveRaid(userId)
  const outcome = await prisma.$transaction(async (tx) => {
    const row = await tx.raidGear.findFirst({ where: { id: gearId, userId } })
    if (!row) throw new AppError('还没有这件装备', 404)
    if (row.equipped) throw new AppError('先把这件装备脱下，再回收', 400)
    const def = RAID_GEAR_MAP.get(row.gearKey)
    if (!def) throw new AppError('装备不存在', 404)
    // 条件删除：同一件被并发回收时第二次抢不到行，直接报错而不是白送一次积分
    const deleted = await tx.raidGear.deleteMany({ where: { id: row.id, userId } })
    if (deleted.count === 0) throw new AppError('这件装备已经被回收了', 409, 'RAID_GEAR_GONE')
    const points = Math.max(1, Math.round(def.price * RAID_GEAR_RECYCLE_RATE))
    const mutation = await awardPointsTx(tx, userId, {
      amount: points,
      reason: 'raid_recycle',
      note: `回收 ${def.name}`,
    })
    return { points, name: def.name, balance: mutation.balance }
  })
  void outcome.balance
  return { points: outcome.points, name: outcome.name, view: await buildStorageView(userId) }
}

/* ============================================================
   维修
   ============================================================ */

const REPAIR_KIT_BY_SLOT: Partial<Record<RaidGearSlot, string>> = {
  helmet: 'helmet_repair',
  armor: 'armor_repair',
}

/** 维修同样按 RaidGear 行 id 定位（同一个型号可能有几件、耐久各自独立）；gearKey 仅作向后兼容 */
export async function repairRaidGearForUser(
  userId: number,
  gearId: number,
  gearKey?: string | null,
): Promise<RaidStorageViewDto> {
  await assertNoActiveRaid(userId)
  await prisma.$transaction(async (tx) => {
    const row = gearId > 0
      ? await tx.raidGear.findFirst({ where: { id: gearId, userId } })
      : await tx.raidGear.findFirst({ where: { userId, gearKey: gearKey ?? '' }, orderBy: { id: 'asc' } })
    if (!row) throw new AppError('还没有这件装备', 404)
    const def = RAID_GEAR_MAP.get(row.gearKey)
    if (!def) throw new AppError('装备不存在', 404)
    const kitKey = REPAIR_KIT_BY_SLOT[def.slot]
    if (!kitKey) throw new AppError('这件装备不需要维修', 400)
    const kit = await tx.raidInventoryItem.findUnique({
      where: { userId_itemKey: { userId, itemKey: kitKey } },
    })
    if (!kit || kit.amount < 1) {
      throw new AppError(`仓库里没有${def.slot === 'helmet' ? '头修包' : '甲修包'}，先去商店买一个吧`, 400)
    }
    const result = repairRaidGear(
      { key: row.gearKey, durability: row.durability, maxDurability: row.maxDurability },
      kitKey,
    )
    if (!result.ok || !result.gear) throw new AppError(result.error ?? '维修失败', 400)

    if (kit.amount <= 1) {
      await tx.raidInventoryItem.delete({ where: { id: kit.id } })
    } else {
      await tx.raidInventoryItem.update({ where: { id: kit.id }, data: { amount: kit.amount - 1 } })
    }
    await tx.raidGear.update({
      where: { id: row.id },
      data: {
        durability: result.gear.durability,
        maxDurability: result.gear.maxDurability,
      },
    })
  })
  return buildStorageView(userId)
}

/* ============================================================
   开箱（装备箱 / 技能卷轴）
   ============================================================ */

export interface RaidOpenCacheResult {
  type: 'gear' | 'skill'
  key: string
  name: string
  emoji: string
  /** 重复获得时折算的积分（0 表示是新物品） */
  duplicatePoints: number
  view: RaidStorageViewDto
}

export async function openRaidCache(
  userId: number,
  itemKey: string,
  random: () => number = Math.random,
): Promise<RaidOpenCacheResult> {
  await assertNoActiveRaid(userId)
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.raidInventoryItem.findUnique({
      where: { userId_itemKey: { userId, itemKey } },
    })
    if (!row || row.amount < 1) throw new AppError('仓库里没有这个箱子', 404)
    const cache = RAID_ITEM_MAP.get(itemKey)
    if (!cache || (cache.kind !== 'gear_cache' && cache.kind !== 'skill_cache')) {
      throw new AppError('这不是可开启的箱子', 400)
    }
    // 先扣箱子
    if (row.amount <= 1) {
      await tx.raidInventoryItem.delete({ where: { id: row.id } })
    } else {
      await tx.raidInventoryItem.update({ where: { id: row.id }, data: { amount: row.amount - 1 } })
    }

    const minTier = cache.cacheTierMin ?? 1
    const maxTier = cache.cacheTierMax ?? 6

    if (cache.kind === 'gear_cache') {
      const pool = RAID_GEARS.filter((gear) => gear.tier >= minTier && gear.tier <= maxTier)
      const picked = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
      if (!picked) throw new AppError('箱子是空的', 500)
      // 装备是普通物品：重复开箱不再自动折 60% 积分，而是再落一行独立实例（独立耐久），
      // 玩家想变现就到装备页手动回收。技能卷轴仍维持「重复即折分」语义（PetSkill 是拥有制）。
      await tx.raidGear.create({
        data: {
          userId,
          gearKey: picked.key,
          slot: picked.slot,
          durability: picked.maxDurability ?? 0,
          maxDurability: picked.maxDurability ?? 0,
          equipped: false,
          acquiredVia: 'drop',
        },
      })
      return {
        type: 'gear' as const,
        key: picked.key,
        name: picked.name,
        emoji: picked.emoji,
        duplicatePoints: 0,
        balance: 0,
      }
    }

    // 技能卷轴
    const pet = await tx.pet.findUnique({
      where: { userId },
      include: { skills: { select: { skillKey: true } } },
    })
    if (!pet) throw new AppError('还没有宠物，无法使用技能卷轴', 400)
    const pool = PET_SKILLS.filter(
      (skill) =>
        skill.key !== PET_BASIC_SKILL_KEY &&
        skill.minLevel >= minTier &&
        skill.minLevel <= maxTier,
    )
    const picked = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))] ?? PET_SKILL_MAP.get('fire_claw')
    if (!picked) throw new AppError('卷轴是空的', 500)
    let duplicatePoints = 0
    const owned = pet.skills.some((skill) => skill.skillKey === picked.key)
    if (owned) {
      duplicatePoints = Math.max(1, Math.round(picked.price * 0.6))
      await awardPointsTx(tx, userId, {
        amount: duplicatePoints,
        reason: 'raid_recycle',
        note: `重复技能 ${picked.name} 折积分`,
      })
    } else {
      await tx.petSkill.create({
        data: { petId: pet.id, skillKey: picked.key, acquiredVia: 'raid' },
      })
    }
    return {
      type: 'skill' as const,
      key: picked.key,
      name: picked.name,
      emoji: picked.emoji,
      duplicatePoints,
      balance: 0,
    }
  })
  const view = await buildStorageView(userId)
  return { ...result, view }
}

/** 装备列表（仓库页装备 Tab 直接用 storage view 即可） */
export async function listRaidGears(userId: number) {
  const rows = await prisma.raidGear.findMany({
    where: { userId },
    orderBy: [{ slot: 'asc' }, { id: 'asc' }],
  })
  return rows.map((row) => gearDto(row))
}
