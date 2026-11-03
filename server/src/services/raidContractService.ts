/**
 * 搜打撤每日契约（3 条/天，按「撤离次数 / 击杀数 / 带出价值」累计）。
 *
 * 日界使用 Asia/Shanghai（pointsRules.getTodayDateKey），领取发积分 reason=pet_raid_contract。
 */

import prisma from '../lib/prisma.js'
import type { PetRaidContract, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_CONTRACTS,
  RAID_CONTRACT_MAP,
  type RaidContractDef,
} from '../lib/raidRun.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { awardPointsTx } from './pointsService.js'

type Db = Prisma.TransactionClient

export interface RaidContractDto {
  key: string
  name: string
  description: string
  metric: RaidContractDef['metric']
  target: number
  progress: number
  claimed: boolean
  rewardPoints: number
}

export function raidContractDto(row: PetRaidContract): RaidContractDto | null {
  const def = RAID_CONTRACT_MAP.get(row.contractKey)
  if (!def) return null
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    metric: def.metric,
    target: row.target,
    progress: Math.min(row.progress, row.target),
    claimed: row.claimed,
    rewardPoints: row.rewardPoints,
  }
}

export async function ensureRaidContractsTx(
  tx: Db,
  userId: number,
  dateKey: string,
): Promise<PetRaidContract[]> {
  for (const def of RAID_CONTRACTS) {
    await tx.petRaidContract.upsert({
      where: { userId_dateKey_contractKey: { userId, dateKey, contractKey: def.key } },
      create: {
        userId,
        dateKey,
        contractKey: def.key,
        target: def.target,
        rewardPoints: def.rewardPoints,
      },
      update: {},
    })
  }
  return tx.petRaidContract.findMany({ where: { userId, dateKey } })
}

export interface RaidContractProgress {
  extracts: number
  kills: number
  lootValue: number
}

export async function bumpRaidContractsTx(
  tx: Db,
  userId: number,
  dateKey: string,
  delta: RaidContractProgress,
): Promise<void> {
  await ensureRaidContractsTx(tx, userId, dateKey)
  for (const def of RAID_CONTRACTS) {
    const add = def.metric === 'extracts'
      ? delta.extracts
      : def.metric === 'kills'
        ? delta.kills
        : delta.lootValue
    if (add <= 0) continue
    const row = await tx.petRaidContract.findUnique({
      where: { userId_dateKey_contractKey: { userId, dateKey, contractKey: def.key } },
    })
    if (!row || row.progress >= row.target) continue
    await tx.petRaidContract.update({
      where: { id: row.id },
      data: { progress: Math.min(row.target, row.progress + Math.trunc(add)) },
    })
  }
}

export async function listRaidContracts(userId: number, now = Date.now()): Promise<RaidContractDto[]> {
  const dateKey = getTodayDateKey(now)
  const rows = await prisma.$transaction((tx) => ensureRaidContractsTx(tx, userId, dateKey))
  return rows
    .sort((a, b) => RAID_CONTRACTS.findIndex((def) => def.key === a.contractKey) - RAID_CONTRACTS.findIndex((def) => def.key === b.contractKey))
    .map((row) => raidContractDto(row))
    .filter((row): row is RaidContractDto => row !== null)
}

export interface RaidClaimResult {
  points: number
  balance: number
  contracts: RaidContractDto[]
}

export async function claimRaidContract(
  userId: number,
  contractKey: string,
  now = Date.now(),
): Promise<RaidClaimResult> {
  const def = RAID_CONTRACT_MAP.get(contractKey)
  if (!def) throw new AppError('没有这个契约', 404)
  const dateKey = getTodayDateKey(now)
  const result = await prisma.$transaction(async (tx) => {
    const row = await tx.petRaidContract.findUnique({
      where: { userId_dateKey_contractKey: { userId, dateKey, contractKey } },
    })
    if (!row) throw new AppError('今天还没有这个契约', 404)
    if (row.claimed) throw new AppError('这个契约已经领过了', 400)
    if (row.progress < row.target) throw new AppError('契约还没完成', 400)
    const claimed = await tx.petRaidContract.updateMany({
      where: { id: row.id, claimed: false, progress: { gte: row.target } },
      data: { claimed: true },
    })
    if (claimed.count === 0) throw new AppError('这个契约已经领过了', 400)
    return awardPointsTx(tx, userId, {
      amount: row.rewardPoints,
      reason: 'pet_raid_contract',
      note: `搜打撤契约：${def.name}`,
    })
  })
  const rows = await prisma.petRaidContract.findMany({ where: { userId, dateKey } })
  return {
    points: def.rewardPoints,
    balance: result.balance,
    contracts: rows
      .map((row) => raidContractDto(row))
      .filter((row): row is RaidContractDto => row !== null),
  }
}
