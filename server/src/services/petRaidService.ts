/**
 * 宠物搜打撤服务：把纯函数引擎（lib/petRaid.ts）接到 Prisma。
 *
 * 结算口径：
 *   - 撤离成功：随身 + 保险箱战利品全部入账（积分 / 种子 / 装备 / 技能）；
 *   - 阵亡 / 失联 / 放弃：随身战利品丢失，保险箱物品保留；
 *   - 装备掉落：阵亡或失联时每件非绑定装备 50% 概率丢失，行动保险可完全免除；
 *   - 每日契约 3 条，按「撤离次数 / 击杀数 / 带出价值」累计，手动领取积分。
 */

import prisma from '../lib/prisma.js'
import type { PetRaid, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { ensureStarterEquipment } from './petService.js'
import {
  cleanLoadout,
  loadoutEquipmentKeys,
  serializeLoadout,
  type PetLoadout,
} from '../lib/petCatalog.js'
import { deriveCombatStats } from '../lib/petBattle.js'
import { PET_EQUIPMENT_MAP } from '../lib/petEquipment.js'
import { PET_SKILL_MAP } from '../lib/petSkills.js'
import { getCrop } from '../lib/farmCrops.js'
import {
  RAID_CONTRACTS,
  RAID_CONTRACT_MAP,
  RAID_GEAR_LOSS_CHANCE,
  RAID_INSURANCE_RATE,
  RAID_MAPS,
  RAID_SAFE_CAPACITY,
  abandonRaid,
  buildRaidCellDtos,
  createRaidRng,
  createRaidState,
  expireRaid,
  extractRaid,
  getRaidMap,
  insuranceCost,
  keptLoot,
  lootValue,
  moveRaid,
  searchRaid,
  storeSafeRaid,
  takeSafeRaid,
  totalLootValue,
  useMedkitRaid,
  type RaidActionResult,
  type RaidContractDef,
  type RaidDifficulty,
  type RaidLootItem,
  type RaidMapDef,
  type RaidState,
  type RaidStatus,
} from '../lib/petRaid.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { awardPointsTx, getPointsProfile, spendPointsTx } from './pointsService.js'

type Db = Prisma.TransactionClient

/* ============================================================
   DTO
   ============================================================ */

export interface RaidLootDto {
  id: string
  key: string
  name: string
  emoji: string
  rarity: RaidLootItem['rarity']
  kind: RaidLootItem['kind']
  value: number
  amount: number
  payload: string | null
}

function lootDto(item: RaidLootItem): RaidLootDto {
  return {
    id: item.id,
    key: item.key,
    name: item.name,
    emoji: item.emoji,
    rarity: item.rarity,
    kind: item.kind,
    value: lootValue(item),
    amount: item.amount,
    payload: item.payload,
  }
}

export interface RaidStateDto {
  id: number
  version: number
  mapKey: string
  mapName: string
  mapEmoji: string
  difficulty: RaidDifficulty
  status: RaidStatus
  turn: number
  maxTurns: number
  hp: number
  mp: number
  maxHp: number
  maxMp: number
  stats: RaidState['stats']
  player: { x: number; y: number }
  width: number
  height: number
  cells: ReturnType<typeof buildRaidCellDtos>
  loot: RaidLootDto[]
  safe: RaidLootDto[]
  safeCapacity: number
  log: RaidState['log']
  kills: number
  insured: boolean
  extracting: number
  extractionCell: number | null
  totalLootValue: number
  startedAt: string
  expiresAt: string
  remainingMs: number
  loadout: RaidState['loadout']
}

function raidStateDto(row: PetRaid, state: RaidState, now: number): RaidStateDto {
  const map = getRaidMap(state.mapKey)
  return {
    id: row.id,
    version: state.version,
    mapKey: state.mapKey,
    mapName: map?.name ?? state.mapKey,
    mapEmoji: map?.emoji ?? '🗺️',
    difficulty: state.difficulty,
    status: state.status,
    turn: state.turn,
    maxTurns: state.maxTurns,
    hp: state.hp,
    mp: state.mp,
    maxHp: state.stats.maxHp,
    maxMp: state.stats.maxMp,
    stats: state.stats,
    player: state.player,
    width: state.width,
    height: state.height,
    cells: buildRaidCellDtos(state),
    loot: state.loot.map(lootDto),
    safe: state.safe.map(lootDto),
    safeCapacity: RAID_SAFE_CAPACITY,
    log: state.log,
    kills: state.kills,
    insured: state.insured,
    extracting: state.extracting,
    extractionCell: state.extractionCell,
    totalLootValue: totalLootValue([...state.loot, ...state.safe]),
    startedAt: new Date(state.startedAt).toISOString(),
    expiresAt: new Date(state.expiresAt).toISOString(),
    remainingMs: Math.max(0, state.expiresAt - now),
    loadout: state.loadout,
  }
}

export interface RaidHistoryDto {
  id: number
  mapKey: string
  mapName: string
  difficulty: string
  result: RaidStatus
  points: number
  kills: number
  moves: number
  durationMs: number
  loot: RaidLootDto[]
  createdAt: string
}

function historyDto(row: {
  id: number
  mapKey: string
  difficulty: string
  result: string
  points: number
  kills: number
  moves: number
  durationMs: number
  lootJson: string | null
  createdAt: Date
}): RaidHistoryDto {
  let loot: RaidLootDto[] = []
  if (row.lootJson) {
    try {
      const parsed = JSON.parse(row.lootJson) as RaidLootItem[]
      if (Array.isArray(parsed)) loot = parsed.map(lootDto)
    } catch {
      loot = []
    }
  }
  return {
    id: row.id,
    mapKey: row.mapKey,
    mapName: getRaidMap(row.mapKey)?.name ?? row.mapKey,
    difficulty: row.difficulty,
    result: row.result as RaidStatus,
    points: row.points,
    kills: row.kills,
    moves: row.moves,
    durationMs: row.durationMs,
    loot,
    createdAt: row.createdAt.toISOString(),
  }
}

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

export interface RaidOverviewDto {
  active: boolean
  raid: RaidStateDto | null
  maps: RaidMapDef[]
  history: RaidHistoryDto[]
  stats: {
    totalRaids: number
    extracted: number
    died: number
    mia: number
    kills: number
    bestValue: number
  }
  contracts: RaidContractDto[]
  pet: null | {
    species: string
    name: string
    level: number
    equipped: PetLoadout
    stats: ReturnType<typeof deriveCombatStats>
    hp: number
    mp: number
    maxHp: number
    maxMp: number
    equipmentKeys: string[]
    skillKeys: string[]
  }
  points: number
  insuranceRate: number
}

/* ============================================================
   工具
   ============================================================ */

function parseState(raw: string): RaidState | null {
  try {
    const parsed = JSON.parse(raw) as RaidState
    if (!parsed || typeof parsed !== 'object') return null
    if (!Array.isArray(parsed.cells) || !getRaidMap(parsed.mapKey)) return null
    return parsed
  } catch {
    return null
  }
}

interface RaidPetInfo {
  pet: {
    id: number
    userId: number
    species: string
    name: string
    level: number
    status: string
    equipped: string
    equipments: Array<{ itemKey: string }>
    skills: Array<{ skillKey: string }>
  }
  loadout: PetLoadout
  equipmentKeys: string[]
  skillKeys: string[]
  stats: ReturnType<typeof deriveCombatStats>
}

async function loadRaidPet(userId: number): Promise<RaidPetInfo> {
  await ensureStarterEquipment(userId)
  const pet = await prisma.pet.findUnique({
    where: { userId },
    include: {
      equipments: { select: { itemKey: true } },
      skills: { select: { skillKey: true } },
    },
  })
  if (!pet) throw new AppError('先召唤一只宠物吧', 400)
  if (pet.status !== 'alive') throw new AppError('宠物已经离家出走了，先重新召唤吧', 400)
  const loadout = cleanLoadout(
    pet.equipped,
    pet.equipments.map((row) => row.itemKey),
    pet.skills.map((row) => row.skillKey),
  )
  const equipmentKeys = loadoutEquipmentKeys(loadout)
  return {
    pet,
    loadout,
    equipmentKeys,
    skillKeys: loadout.skills,
    stats: deriveCombatStats({ species: pet.species, level: pet.level, equipmentKeys }),
  }
}

async function ensureContractsTx(tx: Db, userId: number, dateKey: string) {
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

async function bumpContractsTx(
  tx: Db,
  userId: number,
  dateKey: string,
  delta: { extracts: number; kills: number; lootValue: number },
) {
  await ensureContractsTx(tx, userId, dateKey)
  for (const def of RAID_CONTRACTS) {
    const amount = def.metric === 'extracts'
      ? delta.extracts
      : def.metric === 'kills'
        ? delta.kills
        : delta.lootValue
    if (amount <= 0) continue
    await tx.petRaidContract.update({
      where: { userId_dateKey_contractKey: { userId, dateKey, contractKey: def.key } },
      data: { progress: { increment: amount } },
    })
  }
}

function contractDto(row: {
  contractKey: string
  target: number
  progress: number
  claimed: boolean
  rewardPoints: number
}): RaidContractDto | null {
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

/* ============================================================
   结算
   ============================================================ */

export interface RaidSettlementDto {
  result: RaidStatus
  points: number
  balance: number
  gearLost: string[]
  loot: RaidLootDto[]
  record: RaidHistoryDto
  contracts: RaidContractDto[]
}

async function finishRaid(
  row: PetRaid,
  state: RaidState,
  now = Date.now(),
): Promise<RaidSettlementDto | null> {
  if (state.status === 'active') return null
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.petRaid.updateMany({
      where: { id: row.id, status: 'active' },
      data: {
        status: state.status,
        state: JSON.stringify({ ...state, settled: true }),
        version: state.version + 1,
        finishedAt: new Date(now),
      },
    })
    if (claimed.count === 0) return null

    const kept = keptLoot(state)
    const pet = await tx.pet.findUnique({
      where: { userId: row.userId },
      include: {
        equipments: { select: { itemKey: true } },
        skills: { select: { skillKey: true } },
      },
    })
    const farm = await tx.farm.findUnique({
      where: { userId: row.userId },
      select: { id: true },
    })
    const ownedEquipment = new Set(pet?.equipments.map((item) => item.itemKey) ?? [])
    const ownedSkills = new Set(pet?.skills.map((item) => item.skillKey) ?? [])
    let points = 0
    const seedGains = new Map<string, number>()

    for (const item of kept) {
      if (item.kind === 'points' || item.kind === 'material') {
        points += item.value * Math.max(1, item.amount)
        continue
      }
      if (item.kind === 'medkit') {
        points += item.value
        continue
      }
      if (item.kind === 'seed') {
        const crop = getCrop(item.payload)
        if (!crop) continue
        if (farm) {
          seedGains.set(crop.key, (seedGains.get(crop.key) ?? 0) + item.amount)
        } else {
          points += crop.seedCost * item.amount
        }
        continue
      }
      if (item.kind === 'equipment') {
        const def = PET_EQUIPMENT_MAP.get(item.payload ?? '')
        if (!def) continue
        if (pet && !ownedEquipment.has(def.key)) {
          await tx.petEquipment.create({
            data: { petId: pet.id, itemKey: def.key, acquiredVia: 'raid' },
          })
          ownedEquipment.add(def.key)
        } else {
          points += Math.max(1, Math.round(def.price * 0.4))
        }
        continue
      }
      if (item.kind === 'skill') {
        const skill = PET_SKILL_MAP.get(item.payload ?? '')
        if (!skill || skill.key === 'basic_attack') continue
        if (pet && !ownedSkills.has(skill.key)) {
          await tx.petSkill.create({
            data: { petId: pet.id, skillKey: skill.key, acquiredVia: 'raid' },
          })
          ownedSkills.add(skill.key)
        } else {
          points += Math.max(1, Math.round(skill.price * 0.4))
        }
      }
    }

    if (farm) {
      for (const [cropKey, count] of seedGains) {
        await tx.farmItem.upsert({
          where: { farmId_kind_itemKey: { farmId: farm.id, kind: 'seed', itemKey: cropKey } },
          create: { farmId: farm.id, kind: 'seed', itemKey: cropKey, count },
          update: { count: { increment: count } },
        })
      }
    }

    const award = points > 0
      ? await awardPointsTx(tx, row.userId, {
        amount: points,
        reason: 'pet_raid',
        note: `搜打撤带出：${getRaidMap(state.mapKey)?.name ?? state.mapKey}`,
      })
      : { balance: (await tx.user.findUnique({ where: { id: row.userId }, select: { points: true } }))?.points ?? 0 }

    const gearLost: string[] = []
    if (pet && !state.insured && (state.status === 'died' || state.status === 'mia')) {
      const loadout = cleanLoadout(
        pet.equipped,
        pet.equipments.map((item) => item.itemKey),
        pet.skills.map((item) => item.skillKey),
      )
      const rng = createRaidRng((state.seed ^ 0x9e3779b9) >>> 0)
      for (const key of loadoutEquipmentKeys(loadout)) {
        const def = PET_EQUIPMENT_MAP.get(key)
        if (!def || def.bound) continue
        if (rng() >= RAID_GEAR_LOSS_CHANCE) continue
        gearLost.push(key)
        loadout[def.slot] = null
        await tx.petEquipment.deleteMany({ where: { petId: pet.id, itemKey: key } })
      }
      if (gearLost.length > 0) {
        await tx.pet.update({
          where: { id: pet.id },
          data: { equipped: serializeLoadout(loadout) },
        })
      }
    }

    const lootSummary = kept.map((item) => ({
      ...item,
      value: lootValue(item),
    }))
    const record = await tx.petRaidRecord.create({
      data: {
        userId: row.userId,
        mapKey: state.mapKey,
        difficulty: state.difficulty,
        result: state.status,
        points,
        lootJson: JSON.stringify(lootSummary),
        kills: state.kills,
        moves: state.turn,
        durationMs: Math.max(0, now - state.startedAt),
      },
    })

    const dateKey = getTodayDateKey(now)
    await bumpContractsTx(tx, row.userId, dateKey, {
      extracts: state.status === 'extracted' ? 1 : 0,
      kills: state.kills,
      lootValue: totalLootValue(kept),
    })
    const contractRows = await tx.petRaidContract.findMany({
      where: { userId: row.userId, dateKey },
    })

    return {
      result: state.status,
      points,
      balance: award.balance,
      gearLost,
      loot: kept.map(lootDto),
      record: historyDto(record),
      contracts: contractRows
        .map((contract) => contractDto(contract))
        .filter((contract): contract is RaidContractDto => contract !== null),
    }
  })
}

/** 惰性结算超时对局（读概览 / 开始新局前调用） */
async function settleExpiredRaid(userId: number, now = Date.now()): Promise<RaidSettlementDto | null> {
  const row = await prisma.petRaid.findUnique({ where: { userId } })
  if (!row || row.status !== 'active') return null
  const state = parseState(row.state)
  if (!state) {
    await prisma.petRaid.updateMany({
      where: { id: row.id, status: 'active' },
      data: { status: 'mia', finishedAt: new Date(now) },
    })
    return null
  }
  if (state.expiresAt > now) return null
  const expired = expireRaid(state).state
  return finishRaid(row, expired, now)
}

/* ============================================================
   读取
   ============================================================ */

export async function getRaidOverview(userId: number): Promise<RaidOverviewDto> {
  const now = Date.now()
  await settleExpiredRaid(userId, now)
  const [row, petInfo, profile, history, totalRaids, extracted, died, mia, killsSum, best] = await Promise.all([
    prisma.petRaid.findUnique({ where: { userId } }),
    loadRaidPet(userId).catch(() => null),
    getPointsProfile(userId),
    prisma.petRaidRecord.findMany({
      where: { userId },
      orderBy: [{ id: 'desc' }],
      take: 20,
    }),
    prisma.petRaidRecord.count({ where: { userId } }),
    prisma.petRaidRecord.count({ where: { userId, result: 'extracted' } }),
    prisma.petRaidRecord.count({ where: { userId, result: 'died' } }),
    prisma.petRaidRecord.count({ where: { userId, result: 'mia' } }),
    prisma.petRaidRecord.aggregate({ where: { userId }, _sum: { kills: true } }),
    prisma.petRaidRecord.findFirst({
      where: { userId, result: 'extracted' },
      orderBy: { points: 'desc' },
      select: { points: true },
    }),
  ])

  const activeRow = row && row.status === 'active' ? row : null
  const state = activeRow ? parseState(activeRow.state) : null
  const raid = activeRow && state ? raidStateDto(activeRow, state, now) : null

  const contracts = await prisma.$transaction((tx) =>
    ensureContractsTx(tx, userId, getTodayDateKey(now)))
  const contractDtos = contracts
    .map((contract) => contractDto(contract))
    .filter((contract): contract is RaidContractDto => contract !== null)

  const pet = petInfo
    ? {
      species: petInfo.pet.species,
      name: petInfo.pet.name,
      level: petInfo.pet.level,
      equipped: petInfo.loadout,
      stats: petInfo.stats,
      hp: raid?.hp ?? petInfo.stats.maxHp,
      mp: raid?.mp ?? petInfo.stats.maxMp,
      maxHp: petInfo.stats.maxHp,
      maxMp: petInfo.stats.maxMp,
      equipmentKeys: petInfo.equipmentKeys,
      skillKeys: petInfo.skillKeys,
    }
    : null

  return {
    active: !!raid,
    raid,
    maps: [...getRaidMaps()],
    history: history.map(historyDto),
    stats: {
      totalRaids,
      extracted,
      died,
      mia,
      kills: killsSum._sum.kills ?? 0,
      bestValue: best?.points ?? 0,
    },
    contracts: contractDtos,
    pet,
    points: profile.balance,
    insuranceRate: RAID_INSURANCE_RATE,
  }
}

function getRaidMaps(): readonly RaidMapDef[] {
  // 单独包一层，避免把 lib 的数组引用直接暴露给调用方修改
  return RAID_MAPS
}

/* ============================================================
   开始 / 动作
   ============================================================ */

export interface StartRaidOptions {
  insured?: boolean
}

export async function startRaid(
  userId: number,
  mapKey: string,
  options: StartRaidOptions = {},
): Promise<RaidOverviewDto> {
  const map = getRaidMap(mapKey)
  if (!map) throw new AppError('没有这张地图', 404)
  const now = Date.now()
  await settleExpiredRaid(userId, now)

  const existing = await prisma.petRaid.findUnique({ where: { userId } })
  if (existing?.status === 'active') {
    throw new AppError('已经有进行中的行动，先撤离或放弃吧', 409, 'RAID_ACTIVE')
  }
  const petInfo = await loadRaidPet(userId)
  if (petInfo.pet.level + 2 < map.recommendLevel) {
    throw new AppError(`这张地图建议 ${map.recommendLevel} 级，先让宠物升升级吧`, 400)
  }
  const insurance = options.insured ? insuranceCost(petInfo.equipmentKeys) : 0
  const seed = Math.floor(Math.random() * 0x7fffffff)
  const state = createRaidState({
    map,
    seed,
    now,
    loadout: {
      petId: petInfo.pet.id,
      userId,
      name: petInfo.pet.name,
      species: petInfo.pet.species,
      level: petInfo.pet.level,
      equipmentKeys: petInfo.equipmentKeys,
      skillKeys: petInfo.skillKeys,
    },
    stats: petInfo.stats,
    insured: !!options.insured,
  })

  await prisma.$transaction(async (tx) => {
    if (map.entryCost > 0) {
      await spendPointsTx(tx, userId, map.entryCost, {
        reason: 'pet_raid_entry',
        note: `进入「${map.name}」`,
      })
    }
    if (insurance > 0) {
      await spendPointsTx(tx, userId, insurance, {
        reason: 'pet_raid_insurance',
        note: `行动保险（${map.name}）`,
      })
    }
    const data = {
      mapKey: map.key,
      difficulty: map.difficulty,
      status: 'active',
      state: JSON.stringify(state),
      version: 0,
      seed,
      startedAt: new Date(now),
      expiresAt: new Date(state.expiresAt),
      finishedAt: null,
    }
    await tx.petRaid.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    })
  })
  return getRaidOverview(userId)
}

export type RaidActionType =
  | 'move' | 'search' | 'extract' | 'medkit' | 'safe' | 'unsafe' | 'abandon'

export interface RaidActionInput {
  type: RaidActionType
  dir?: 'up' | 'down' | 'left' | 'right'
  lootId?: string
  version?: number
}

export interface RaidActionResponse {
  raid: RaidStateDto | null
  gained: RaidLootDto[]
  combat: RaidActionResult['combat']
  settlement: RaidSettlementDto | null
}

export async function performRaidAction(
  userId: number,
  input: RaidActionInput,
): Promise<RaidActionResponse> {
  const now = Date.now()
  const row = await prisma.petRaid.findUnique({ where: { userId } })
  if (!row || row.status !== 'active') throw new AppError('没有进行中的行动', 404, 'RAID_NONE')
  const state = parseState(row.state)
  if (!state) throw new AppError('行动数据异常', 500)

  if (state.expiresAt <= now) {
    const expired = expireRaid(state).state
    const settlement = await finishRaid(row, expired, now)
    return { raid: null, gained: [], combat: null, settlement }
  }
  if (input.version !== undefined && input.version !== state.version) {
    throw new AppError('行动状态已更新，请刷新', 409, 'RAID_VERSION')
  }

  const rng = createRaidRng((state.seed ^ (state.version * 0x9e3779b1)) >>> 0)
  let result: RaidActionResult
  switch (input.type) {
    case 'move':
      if (!input.dir) throw new AppError('缺少移动方向', 400)
      result = moveRaid(state, input.dir, rng)
      break
    case 'search':
      result = searchRaid(state, rng)
      break
    case 'extract':
      result = extractRaid(state)
      break
    case 'medkit':
      if (!input.lootId) throw new AppError('缺少物品编号', 400)
      result = useMedkitRaid(state, input.lootId)
      break
    case 'safe':
      if (!input.lootId) throw new AppError('缺少物品编号', 400)
      result = storeSafeRaid(state, input.lootId)
      break
    case 'unsafe':
      if (!input.lootId) throw new AppError('缺少物品编号', 400)
      result = takeSafeRaid(state, input.lootId)
      break
    case 'abandon':
      result = abandonRaid(state)
      break
    default:
      throw new AppError('未知的行动', 400)
  }
  if (result.error) throw new AppError(result.error, 400)

  const next = result.state
  next.version = state.version + 1
  if (next.status !== 'active') {
    const settlement = await finishRaid(row, next, now)
    return {
      raid: null,
      gained: (result.gained ?? []).map(lootDto),
      combat: result.combat ?? null,
      settlement,
    }
  }

  const updated = await prisma.petRaid.updateMany({
    where: { id: row.id, version: state.version, status: 'active' },
    data: { state: JSON.stringify(next), version: next.version },
  })
  if (updated.count !== 1) {
    throw new AppError('行动状态已更新，请刷新', 409, 'RAID_VERSION')
  }
  return {
    raid: raidStateDto(row, next, now),
    gained: (result.gained ?? []).map(lootDto),
    combat: result.combat ?? null,
    settlement: null,
  }
}

export async function claimRaidContract(userId: number, contractKey: string) {
  const def = RAID_CONTRACT_MAP.get(contractKey)
  if (!def) throw new AppError('没有这条契约', 404)
  const dateKey = getTodayDateKey()
  await prisma.$transaction(async (tx) => {
    await ensureContractsTx(tx, userId, dateKey)
    const row = await tx.petRaidContract.findUnique({
      where: { userId_dateKey_contractKey: { userId, dateKey, contractKey } },
    })
    if (!row) throw new AppError('没有这条契约', 404)
    if (row.claimed) throw new AppError('这条契约已经领取过了', 409)
    if (row.progress < row.target) throw new AppError('契约进度还没完成', 400)
    const claimed = await tx.petRaidContract.updateMany({
      where: { id: row.id, claimed: false },
      data: { claimed: true },
    })
    if (claimed.count !== 1) throw new AppError('这条契约已经领取过了', 409)
    await awardPointsTx(tx, userId, {
      amount: row.rewardPoints,
      reason: 'pet_raid_contract',
      note: `搜打撤契约：${def.name}`,
    })
  })
  return getRaidOverview(userId)
}

/** 供自检 / 路由使用的目录 */
export function raidMaps(): readonly RaidMapDef[] {
  return RAID_MAPS
}
