/**
 * 搜打撤共享装配层：装备行、容器行、容量换算与宠物基础属性。
 *
 * 被 raidGearService / raidStorageService / raidRunService 共用，避免服务之间循环依赖。
 */

import prisma from '../lib/prisma.js'
import type { Prisma, RaidBagItem, RaidGear, RaidStorage } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_GEAR_MAP,
  RAID_SKILL_CD_MS,
  getRaidGear,
  type RaidEquippedGear,
  type RaidGearInstance,
  type RaidItemStack,
  type RaidSkillRule,
} from '../lib/raidRun.js'
import { safeCapacityFor } from '../lib/raidStorage.js'
import { cleanLoadout } from '../lib/petCatalog.js'
import { deriveCombatStats } from '../lib/petBattle.js'
import { PET_SKILL_MAP } from '../lib/petSkills.js'

type Db = Prisma.TransactionClient

/* ============================================================
   仓库行
   ============================================================ */

export async function ensureRaidStorageTx(tx: Db, userId: number): Promise<RaidStorage> {
  return tx.raidStorage.upsert({ where: { userId }, create: { userId }, update: {} })
}

export async function ensureRaidStorage(userId: number): Promise<RaidStorage> {
  return prisma.$transaction((tx) => ensureRaidStorageTx(tx, userId))
}

/* ============================================================
   装备实例 / 容量
   ============================================================ */

export function gearInstanceOf(row: RaidGear | null | undefined): RaidGearInstance | null {
  if (!row) return null
  return {
    key: row.gearKey,
    durability: Math.max(0, Math.trunc(row.durability)),
    maxDurability: Math.max(0, Math.trunc(row.maxDurability)),
  }
}

/** 已装备的每一件装备行（同槽位重复时取 id 最小的一件） */
export function equippedGearRows(rows: readonly RaidGear[]): RaidGear[] {
  const bySlot = new Map<string, RaidGear>()
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (!row.equipped) continue
    if (!bySlot.has(row.slot)) bySlot.set(row.slot, row)
  }
  return [...bySlot.values()]
}

export interface RaidCapacities {
  backpack: number
  rig: number
  safe: number
}

export function capacitiesOf(rows: readonly RaidGear[], storageLevel: number): RaidCapacities {
  const equipped = equippedGearRows(rows)
  const backpackRow = equipped.find((row) => row.slot === 'backpack')
  const rigRow = equipped.find((row) => row.slot === 'rig')
  const backpackDef = backpackRow ? getRaidGear(backpackRow.gearKey) : null
  const rigDef = rigRow ? getRaidGear(rigRow.gearKey) : null
  return {
    backpack: Math.max(0, Math.trunc(backpackDef?.slots ?? 0)),
    rig: Math.max(0, Math.trunc(rigDef?.slots ?? 0)),
    safe: safeCapacityFor(storageLevel),
  }
}

/** 从装备行列表构造出击快照 */
export function equippedGearSnapshot(rows: readonly RaidGear[]): RaidEquippedGear {
  const equipped = equippedGearRows(rows)
  const pick = (slot: string): RaidGear | null => equipped.find((row) => row.slot === slot) ?? null
  return {
    helmet: gearInstanceOf(pick('helmet')),
    armor: gearInstanceOf(pick('armor')),
    boots: pick('boots')?.gearKey ?? null,
    backpack: pick('backpack')?.gearKey ?? null,
    rig: pick('rig')?.gearKey ?? null,
  }
}

/** 装备信息 DTO（仓库 / 商店 / 对局 HUD 共用） */
export interface RaidGearDto {
  gearKey: string
  name: string
  emoji: string
  slot: string
  tier: number
  rarity: string
  price: number
  description: string
  defense: number
  maxDurability: number
  durability: number
  speedBonus: number
  slots: number
  equipped: boolean
}

export function gearDto(row: RaidGear): RaidGearDto {
  const def = RAID_GEAR_MAP.get(row.gearKey)
  return {
    gearKey: row.gearKey,
    name: def?.name ?? row.gearKey,
    emoji: def?.emoji ?? '🎒',
    slot: row.slot,
    tier: def?.tier ?? 1,
    rarity: def?.rarity ?? 'common',
    price: def?.price ?? 0,
    description: def?.description ?? '',
    defense: def?.defense ?? 0,
    maxDurability: row.maxDurability,
    durability: row.durability,
    speedBonus: def?.speedBonus ?? 0,
    slots: def?.slots ?? 0,
    equipped: row.equipped,
  }
}

/* ============================================================
   容器行
   ============================================================ */

export const RAID_BAG_CONTAINERS = ['backpack', 'rig', 'safe'] as const
export type RaidBagContainer = (typeof RAID_BAG_CONTAINERS)[number]

export function bagRowsToStacks(rows: readonly RaidBagItem[]): RaidItemStack[] {
  return rows
    .map((row) => ({ slotIndex: row.slotIndex, itemKey: row.itemKey, amount: row.amount }))
    .sort((a, b) => a.slotIndex - b.slotIndex)
}

export function bagRowsOf(rows: readonly RaidBagItem[], container: RaidBagContainer): RaidBagItem[] {
  return rows.filter((row) => row.container === container)
}

/** 用给定容器内容整体覆盖该用户的容器行（事务内） */
export async function writeContainersTx(
  tx: Db,
  userId: number,
  containers: Partial<Record<RaidBagContainer, readonly RaidItemStack[]>>,
): Promise<void> {
  for (const container of RAID_BAG_CONTAINERS) {
    const stacks = containers[container]
    if (!stacks) continue
    await tx.raidBagItem.deleteMany({ where: { userId, container } })
    if (stacks.length === 0) continue
    await tx.raidBagItem.createMany({
      data: stacks.map((stack) => ({
        userId,
        container,
        slotIndex: stack.slotIndex,
        itemKey: stack.itemKey,
        amount: stack.amount,
      })),
    })
  }
}

/* ============================================================
   出击装配
   ============================================================ */

export interface RaidLoadoutContext {
  pet: {
    id: number
    species: string
    level: number
    name: string
    equipped: string
  }
  stats: { maxHp: number; maxMp: number; atk: number; def: number; spd: number; crit: number }
  gearRows: RaidGear[]
  gear: RaidEquippedGear
  capacities: RaidCapacities
  skills: RaidSkillRule[]
  skillKeys: string[]
  storageLevel: number
}

/**
 * 读取出击装配：宠物基础属性（不含宠物 PvP 装备）、已装备的搜打撤装备、
 * 容器容量、手动技能列表（宠物已装备技能，冷却按回合折算毫秒）。
 */
export async function loadRaidLoadoutTx(tx: Db, userId: number): Promise<RaidLoadoutContext> {
  const [pet, gearRows, storage] = await Promise.all([
    tx.pet.findUnique({
      where: { userId },
      select: {
        id: true,
        species: true,
        level: true,
        name: true,
        status: true,
        equipped: true,
        skills: { select: { skillKey: true } },
      },
    }),
    tx.raidGear.findMany({ where: { userId } }),
    ensureRaidStorageTx(tx, userId),
  ])
  if (!pet) throw new AppError('还没有宠物，先去宠物之家召唤一只吧', 400)
  if (pet.status !== 'alive') throw new AppError('宠物已经离家出走，先去宠物之家找回来吧', 400)

  const stats = deriveCombatStats({ species: pet.species, level: pet.level, equipmentKeys: [] })
  const loadout = cleanLoadout(pet.equipped, [], pet.skills.map((skill) => skill.skillKey))
  const skills: RaidSkillRule[] = []
  for (const key of loadout.skills.slice(0, 3)) {
    const def = PET_SKILL_MAP.get(key)
    if (!def || def.key === 'basic_attack') continue
    skills.push({
      key: def.key,
      name: def.name,
      emoji: def.emoji,
      kind: def.kind,
      mpCost: def.mpCost,
      cooldownMs: Math.max(0, def.cooldown) * RAID_SKILL_CD_MS,
      power: def.power,
      ...(def.healPct ? { healPct: def.healPct } : {}),
    })
  }

  const rows = gearRows as RaidGear[]
  return {
    pet: {
      id: pet.id,
      species: pet.species,
      level: pet.level,
      name: pet.name,
      equipped: pet.equipped,
    },
    stats,
    gearRows: rows,
    gear: equippedGearSnapshot(rows),
    capacities: capacitiesOf(rows, storage.level),
    skills,
    skillKeys: skills.map((skill) => skill.key),
    storageLevel: storage.level,
  }
}

export async function loadRaidLoadout(userId: number): Promise<RaidLoadoutContext> {
  return prisma.$transaction((tx) => loadRaidLoadoutTx(tx, userId))
}
