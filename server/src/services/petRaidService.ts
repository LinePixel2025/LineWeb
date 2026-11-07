/**
 * 搜打撤概览服务：地图列表 / 当前对局 / 战绩 / 每日契约 / 出击装配预检。
 *
 * 对局生命周期在 raidRunService.ts，仓库与商店分别在 raidStorageService / raidShopService，
 * 契约在 raidContractService.ts；本文件只聚合大厅所需的只读数据。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_MAPS,
  getRaidItem,
  getRaidMap,
  raidInsuranceCost,
  raidItemValue,
  type RaidMapDef,
} from '../lib/raidRun.js'
import { bagRowsToStacks, loadRaidLoadoutTx } from './raidCommon.js'
import { listRaidContracts, claimRaidContract } from './raidContractService.js'
import { getActiveRaid, settleExpiredRaid, type RaidRunDto } from './raidRunService.js'
import { buildStorageView } from './raidStorageService.js'

/* ============================================================
   DTO
   ============================================================ */

export interface RaidMapListItemDto {
  key: string
  name: string
  emoji: string
  description: string
  difficulty: string
  cols: number
  rows: number
  entryCost: number
  recommendLevel: number
  lootTier: number
  color: string
  durationMs: number
  enemyBudget: number
  /** 地图独有机制名（没有则不显示） */
  gimmickLabel?: string
}

export interface RaidHistoryLootDto {
  itemKey: string
  name: string
  emoji: string
  amount: number
  value: number
}

export interface RaidHistoryDto {
  id: number
  mapKey: string
  mapName: string
  mapEmoji: string
  difficulty: string
  result: string
  kills: number
  moves: number
  durationMs: number
  lootValue: number
  loot: RaidHistoryLootDto[]
  createdAt: string
}

export interface RaidStatsDto {
  total: number
  extracted: number
  died: number
  mia: number
  kills: number
  bestLootValue: number
}

export interface RaidOverviewPetDto {
  name: string
  species: string
  level: number
}

export interface RaidOverviewLoadoutDto {
  gear: RaidRunDto['gear']
  capacities: { backpack: number; rig: number; safe: number }
  skills: RaidRunDto['skills']
  backpackUnits: number
  rigUnits: number
  safeUnits: number
  storageLevel: number
  insuranceCost: number
  insuranceRate: number
}

export interface RaidOverviewDto {
  active: boolean
  run: RaidRunDto | null
  maps: RaidMapListItemDto[]
  history: RaidHistoryDto[]
  stats: RaidStatsDto
  contracts: Awaited<ReturnType<typeof listRaidContracts>>
  pet: RaidOverviewPetDto | null
  points: number
  loadout: RaidOverviewLoadoutDto | null
  storage: { level: number; capacity: number; used: number; free: number }
}

function mapListItem(map: RaidMapDef): RaidMapListItemDto {
  return {
    key: map.key,
    name: map.name,
    emoji: map.emoji,
    description: map.description,
    difficulty: map.difficulty,
    cols: map.cols,
    rows: map.rows,
    entryCost: map.entryCost,
    recommendLevel: map.recommendLevel,
    lootTier: map.lootTier,
    color: map.color,
    durationMs: map.durationMs,
    enemyBudget: map.enemyBudget,
    gimmickLabel: map.gimmick?.label,
  }
}

function parseHistoryLoot(json: string | null): RaidHistoryLootDto[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as Array<{ itemKey?: string; key?: string; amount?: number }>
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry) => {
        const itemKey = entry.itemKey ?? entry.key ?? ''
        const def = getRaidItem(itemKey)
        if (!def) return null
        const amount = Math.max(1, Math.trunc(entry.amount ?? 1))
        return {
          itemKey,
          name: def.name,
          emoji: def.emoji,
          amount,
          value: raidItemValue(itemKey) * amount,
        }
      })
      .filter((entry): entry is RaidHistoryLootDto => entry !== null)
  } catch {
    return []
  }
}

/* ============================================================
   概览
   ============================================================ */

export async function getRaidOverview(userId: number): Promise<RaidOverviewDto> {
  const now = Date.now()
  await settleExpiredRaid(userId, now)

  const [run, contracts, historyRows, total, extracted, died, mia, killsAgg, user, bagRows, storageView] =
    await Promise.all([
      getActiveRaid(userId, now),
      listRaidContracts(userId, now),
      prisma.petRaidRecord.findMany({
        where: { userId },
        orderBy: { id: 'desc' },
        take: 20,
      }),
      prisma.petRaidRecord.count({ where: { userId } }),
      prisma.petRaidRecord.count({ where: { userId, result: 'extracted' } }),
      prisma.petRaidRecord.count({ where: { userId, result: 'died' } }),
      prisma.petRaidRecord.count({ where: { userId, result: 'mia' } }),
      prisma.petRaidRecord.aggregate({ where: { userId }, _sum: { kills: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
      prisma.raidBagItem.findMany({ where: { userId } }),
      buildStorageView(userId).catch(() => null),
    ])

  const history: RaidHistoryDto[] = historyRows.map((row) => {
    const map = getRaidMap(row.mapKey)
    const loot = parseHistoryLoot(row.lootJson)
    return {
      id: row.id,
      mapKey: row.mapKey,
      mapName: map?.name ?? row.mapKey,
      mapEmoji: map?.emoji ?? '🗺️',
      difficulty: row.difficulty,
      result: row.result,
      kills: row.kills,
      moves: row.moves,
      durationMs: row.durationMs,
      lootValue: loot.reduce((sum, item) => sum + item.value, 0),
      loot,
      createdAt: row.createdAt.toISOString(),
    }
  })
  const bestLootValue = history.reduce((best, entry) => Math.max(best, entry.lootValue), 0)

  const loadout = await loadRaidLoadoutTx(prisma as never, userId).catch(() => null)
  const backpackUnits = bagRowsToStacks(bagRows.filter((row) => row.container === 'backpack'))
    .reduce((sum, stack) => sum + stack.amount, 0)
  const rigUnits = bagRowsToStacks(bagRows.filter((row) => row.container === 'rig'))
    .reduce((sum, stack) => sum + stack.amount, 0)
  const safeUnits = bagRowsToStacks(bagRows.filter((row) => row.container === 'safe'))
    .reduce((sum, stack) => sum + stack.amount, 0)

  return {
    active: run !== null,
    run,
    maps: RAID_MAPS.map(mapListItem),
    history,
    stats: {
      total,
      extracted,
      died,
      mia,
      kills: killsAgg._sum.kills ?? 0,
      bestLootValue,
    },
    contracts,
    pet: loadout
      ? { name: loadout.pet.name, species: loadout.pet.species, level: loadout.pet.level }
      : null,
    points: user?.points ?? 0,
    loadout: loadout
      ? {
          gear: loadout.gear,
          capacities: loadout.capacities,
          skills: loadout.skills,
          backpackUnits,
          rigUnits,
          safeUnits,
          storageLevel: loadout.storageLevel,
          insuranceCost: raidInsuranceCost(loadout.gear),
          insuranceRate: 0.15,
        }
      : null,
    storage: storageView
      ? {
          level: storageView.level,
          capacity: storageView.capacity,
          used: storageView.used,
          free: storageView.free,
        }
      : { level: 1, capacity: 0, used: 0, free: 0 },
  }
}

export async function claimRaidContractForUser(userId: number, contractKey: string) {
  return claimRaidContract(userId, contractKey)
}

export { getRaidStartPreview, startRaid, performRaidEvents, abandonRaid } from './raidRunService.js'

/** 出击前预检（客户端大厅开始按钮前调用） */
export async function assertRaidReady(userId: number): Promise<void> {
  const loadout = await loadRaidLoadoutTx(prisma as never, userId).catch(() => null)
  if (!loadout) throw new AppError('还没有可出击的宠物，先去宠物之家召唤一只吧', 400)
  if (loadout.capacities.backpack <= 0) {
    throw new AppError('还没有装备背包，去仓库的装备页买一个背包再出发', 400)
  }
}
