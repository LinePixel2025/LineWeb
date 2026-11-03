/**
 * 搜打撤对局服务（2026-11-03 重构）：开始对局 / 事件批处理 / 撤离与阵亡结算。
 *
 * 口径：
 *   - 地图由 seed 按 lib/raidRun.ts 确定性重算，服务端只校验事件（开箱 / 拾取 / 击杀 / 撤离），
 *     客户端负责实时表现与移动射击；
 *   - 撤离成功：背包 / 胸挂 / 安全箱内容原样保留（不自动入仓、不自动出售）；
 *   - 阵亡 / 失联 / 放弃：背包与胸挂清空、安全箱保留；随身装备必丢，行动保险可保住装备；
 *   - 旧 schema 对局在首次读取时按「放弃」结算，不扣装备。
 */

import prisma from '../lib/prisma.js'
import type { PetRaid, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_CONTAINER_LABELS,
  RAID_MAPS,
  RAID_STATE_VERSION,
  applyRaidEvents,
  createRaidRun,
  generateRaidMap,
  getRaidItem,
  getRaidMap,
  raidInsuranceCost,
  raidItemValue,
  raidKeptContainers,
  raidLootValue,
  tickRaidRun,
  type RaidContainerKind,
  type RaidEvent,
  type RaidGearInstance,
  type RaidItemStack,
  type RaidMapDef,
  type RaidMapNode,
  type RaidRunState,
  type RaidSkillRule,
  type RaidStatus,
} from '../lib/raidRun.js'
import {
  bagRowsToStacks,
  ensureRaidStorageTx,
  loadRaidLoadoutTx,
  writeContainersTx,
} from './raidCommon.js'
import { bumpRaidContractsTx } from './raidContractService.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { spendPointsTx } from './pointsService.js'
import {
  announceStarted,
  assertCanStart,
  broadcastWorld,
  dropMembers,
  getSquadById,
  getSquadMateIds,
  markSquadStarted,
  notifyMemberSettled,
  pushSquadState,
  toSquadDto,
  updateMemberLive,
  type RaidSquadDto,
  type RaidSquadMemberDto,
  type RaidWorldDelta,
} from './raidSquadService.js'

type Db = Prisma.TransactionClient

/* ============================================================
   DTO
   ============================================================ */

export interface RaidRunDto {
  id: number
  version: number
  mapKey: string
  mapName: string
  mapEmoji: string
  difficulty: string
  status: RaidStatus
  seed: number
  squadId: string | null
  insured: boolean
  hp: number
  mp: number
  maxHp: number
  maxMp: number
  atk: number
  kills: number
  damageTaken: number
  currentRoom: number
  clearedRooms: number[]
  killedEnemies: string[]
  openedContainers: string[]
  takenLoot: string[]
  backpack: RaidItemStack[]
  rig: RaidItemStack[]
  safe: RaidItemStack[]
  capacities: { backpack: number; rig: number; safe: number }
  gear: {
    helmet: RaidGearInstance | null
    armor: RaidGearInstance | null
    boots: string | null
    backpack: string | null
    rig: string | null
  }
  skills: RaidSkillRule[]
  map: RaidMapNode
  log: RaidRunState['log']
  extractionStartedAt: number | null
  startedAt: string
  expiresAt: string
  remainingMs: number
  entryCost: number
  insuranceCost: number
  insuranceRate: number
}

export interface RaidSettlementItemDto {
  container: RaidContainerKind
  itemKey: string
  name: string
  emoji: string
  rarity: string
  amount: number
  value: number
}

export interface RaidSettlementDto {
  result: RaidStatus
  points: number
  balance: number
  gearLost: string[]
  loot: RaidSettlementItemDto[]
  kept: {
    backpack: RaidItemStack[]
    rig: RaidItemStack[]
    safe: RaidItemStack[]
  }
  record: {
    id: number
    mapKey: string
    result: string
    kills: number
    lootValue: number
    createdAt: string
  }
}

function settlementItems(
  kept: { backpack: RaidItemStack[]; rig: RaidItemStack[]; safe: RaidItemStack[] },
): RaidSettlementItemDto[] {
  const out: RaidSettlementItemDto[] = []
  for (const container of ['backpack', 'rig', 'safe'] as const) {
    for (const stack of kept[container]) {
      const def = getRaidItem(stack.itemKey)
      out.push({
        container,
        itemKey: stack.itemKey,
        name: def?.name ?? stack.itemKey,
        emoji: def?.emoji ?? '📦',
        rarity: def?.rarity ?? 'common',
        amount: stack.amount,
        value: raidItemValue(stack.itemKey) * stack.amount,
      })
    }
  }
  return out
}

function runDto(row: PetRaid, state: RaidRunState, now: number): RaidRunDto {
  const mapDef = getRaidMap(state.mapKey)
  return {
    id: row.id,
    version: row.version,
    mapKey: state.mapKey,
    mapName: mapDef?.name ?? state.mapKey,
    mapEmoji: mapDef?.emoji ?? '🗺️',
    difficulty: state.difficulty,
    status: state.status,
    seed: state.seed,
    squadId: state.squadId ?? null,
    insured: state.insured,
    hp: state.hp,
    mp: state.mp,
    maxHp: state.maxHp,
    maxMp: state.maxMp,
    atk: state.atk,
    kills: state.kills,
    damageTaken: state.damageTaken,
    currentRoom: state.currentRoom,
    clearedRooms: [...state.clearedRooms],
    killedEnemies: [...state.killedEnemies],
    openedContainers: [...state.openedContainers],
    takenLoot: [...state.takenLoot],
    backpack: state.backpack,
    rig: state.rig,
    safe: state.safe,
    capacities: state.capacities,
    gear: state.gear,
    skills: state.skills,
    map: generateRaidMap(state.seed, mapDef ?? (RAID_MAPS[0] as RaidMapDef)),
    log: state.log,
    extractionStartedAt: state.extractionStartedAt,
    startedAt: new Date(state.startedAt).toISOString(),
    expiresAt: new Date(state.expiresAt).toISOString(),
    remainingMs: Math.max(0, state.expiresAt - now),
    entryCost: mapDef?.entryCost ?? 0,
    insuranceCost: state.insured ? raidInsuranceCost(state.gear) : 0,
    insuranceRate: 0.15,
  }
}

/* ============================================================
   状态解析
   ============================================================ */

export function parseRaidRunState(json: string): RaidRunState | null {
  try {
    const parsed = JSON.parse(json) as Partial<RaidRunState>
    if (!parsed || parsed.schemaVersion !== RAID_STATE_VERSION) return null
    if (typeof parsed.seed !== 'number' || typeof parsed.mapKey !== 'string') return null
    if (!Array.isArray(parsed.backpack) || !Array.isArray(parsed.safe)) return null
    return parsed as RaidRunState
  } catch {
    return null
  }
}

async function abandonLegacyRaid(row: PetRaid): Promise<void> {
  await prisma.petRaid.updateMany({
    where: { id: row.id, status: 'active' },
    data: { status: 'abandoned', finishedAt: new Date() },
  })
}

/* ============================================================
   开始对局
   ============================================================ */

export interface RaidStartOptions {
  insured?: boolean
  /** 组队模式：全队共用同一个 seed（同一张地图），单人开局自行随机 */
  seed?: number
  squadId?: string
}

export async function startRaid(
  userId: number,
  mapKey: string,
  options: RaidStartOptions = {},
): Promise<RaidRunDto> {
  const map = getRaidMap(mapKey)
  if (!map) throw new AppError('地图不存在', 404)
  const now = Date.now()
  await settleExpiredRaid(userId, now)

  const existing = await prisma.petRaid.findUnique({ where: { userId } })
  if (existing?.status === 'active') throw new AppError('你已经在行动中了', 409, 'RAID_ACTIVE')

  const bagRows = await prisma.raidBagItem.findMany({ where: { userId } })
  const loadout = await loadRaidLoadoutTx(prisma as unknown as Db, userId)
  const insuranceCost = options.insured ? raidInsuranceCost(loadout.gear) : 0
  const insured = insuranceCost > 0
  const entryCost = map.entryCost
  const totalCost = entryCost + insuranceCost

  const containers = {
    backpack: bagRowsToStacks(bagRows.filter((row) => row.container === 'backpack')),
    rig: bagRowsToStacks(bagRows.filter((row) => row.container === 'rig')),
    safe: bagRowsToStacks(bagRows.filter((row) => row.container === 'safe')),
  }
  // SQLite 的 INT 是 32 位有符号，seed 必须落在 1..2^31-1，避免 P2023 溢出
  const seed = options.seed
    ? ((options.seed >>> 0) % 0x7fffffff) || 1
    : (Math.floor(Math.random() * 0x7fffffff) >>> 0) || 1
  const state = createRaidRun({
    seed,
    squadId: options.squadId,
    mapKey: map.key,
    difficulty: map.difficulty,
    hp: loadout.stats.maxHp,
    maxHp: loadout.stats.maxHp,
    mp: loadout.stats.maxMp,
    maxMp: loadout.stats.maxMp,
    atk: loadout.stats.atk,
    insured,
    capacities: loadout.capacities,
    gear: loadout.gear,
    backpack: containers.backpack,
    rig: containers.rig,
    safe: containers.safe,
    skills: loadout.skills,
    startedAt: now,
  })

  await prisma.$transaction(async (tx) => {
    if (totalCost > 0) {
      await spendPointsTx(tx, userId, totalCost, {
        reason: 'pet_raid_entry',
        note: insured ? `进入 ${map.name}（含行动保险）` : `进入 ${map.name}`,
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

  const row = await prisma.petRaid.findUnique({ where: { userId } })
  if (!row) throw new AppError('对局创建失败', 500)
  return runDto(row, state, now)
}

/* ============================================================
   组队出击
   ============================================================ */

export interface RaidSquadStartResult {
  squad: RaidSquadDto
  failed: { userId: number; name: string; reason: string }[]
}

/**
 * 房主一次性为全队开局：同一个 seed（同一张地图）+ 同一个 squadId。
 *
 * 门票与保险各自扣。先在请求内逐个预检（积分 / 是否已在行动中），不合格的人只进 failed
 * 名单并移出队伍，不会留下半截对局，也不需要退款；真正开局阶段再失败（并发把积分花掉了）
 * 同样只是该成员不进本局，其余人照常出击。
 */
export async function startSquadRaid(
  userId: number,
  mapKey: string,
  insured: boolean,
): Promise<RaidSquadStartResult> {
  const squad = assertCanStart(userId, mapKey)
  const mapDef = getRaidMap(mapKey)
  if (!mapDef) throw new AppError('地图不存在', 404)
  // SQLite 的 INT 是 32 位有符号，seed 必须落在 1..2^31-1
  const seed = (Math.floor(Math.random() * 0x7fffffff) >>> 0) || 1

  const failed: RaidSquadStartResult['failed'] = []
  const eligible: { userId: number; name: string }[] = []
  for (const member of squad.members) {
    const loadout = await loadRaidLoadoutTx(prisma as unknown as Db, member.userId).catch(() => null)
    if (!loadout) {
      failed.push({ userId: member.userId, name: member.name, reason: '还没有可出击的宠物' })
      continue
    }
    if (loadout.capacities.backpack <= 0) {
      failed.push({ userId: member.userId, name: member.name, reason: '没有装备背包，进场也装不了东西' })
      continue
    }
    const cost = mapDef.entryCost + (insured ? raidInsuranceCost(loadout.gear) : 0)
    const points = await prisma.user.findUnique({ where: { id: member.userId }, select: { points: true } })
    if ((points?.points ?? 0) < cost) {
      failed.push({ userId: member.userId, name: member.name, reason: `积分不足，进入本图需 ${cost}` })
      continue
    }
    eligible.push({ userId: member.userId, name: member.name })
  }

  if (eligible.length < 2) {
    throw new AppError(
      failed.length > 0
        ? `可以出击的人数不足 2 人（${failed.map((item) => `${item.name}：${item.reason}`).join('；')}）`
        : '至少 2 人才能组队出击',
      400,
      'SQUAD_START_FAILED',
    )
  }

  const started: number[] = []
  for (const member of eligible) {
    try {
      await startRaid(member.userId, mapKey, { insured, seed, squadId: squad.id })
      started.push(member.userId)
    } catch (err) {
      failed.push({
        userId: member.userId,
        name: member.name,
        reason: err instanceof AppError ? err.message : '开局失败',
      })
    }
  }
  if (started.length === 0) throw new AppError('出击失败，请重试', 400, 'SQUAD_START_FAILED')

  dropMembers(squad, started)
  markSquadStarted(squad, mapKey, seed, mapDef.durationMs)
  const dto = await announceStarted(squad)
  return { squad: dto, failed }
}

/* ============================================================
   事件批处理
   ============================================================ */

export interface RaidEventBatchInput {
  version: number
  events: RaidEvent[]
  /** 组队模式：本端实时位置（纯表现，不落库，只用于队友幽灵与小地图） */
  me?: { x?: number; y?: number; angle?: number; roomId?: number }
}

export interface RaidEventBatchResult {
  run: RaidRunDto | null
  errors: string[]
  settlement: RaidSettlementDto | null
  /** 本人所在队伍的成员实时状态；单人局为 null */
  squad?: { members: RaidSquadMemberDto[] } | null
}

/** 会改变全队共享地图状态的事件 */
function diffWorldDelta(before: RaidRunState, after: RaidRunState): RaidWorldDelta | null {
  const killedEnemies = after.killedEnemies.filter((id) => !before.killedEnemies.includes(id))
  const openedContainers = after.openedContainers.filter((id) => !before.openedContainers.includes(id))
  const takenLoot = after.takenLoot.filter((id) => !before.takenLoot.includes(id))
  const clearedRooms = after.clearedRooms.filter((id) => !before.clearedRooms.includes(id))
  if (killedEnemies.length === 0 && openedContainers.length === 0 && takenLoot.length === 0 && clearedRooms.length === 0) {
    return null
  }
  return { killedEnemies, openedContainers, takenLoot, clearedRooms }
}

/** 只并入世界集合，不给队友计击杀、不占队友背包（战利品归拾取者） */
function mergeWorldDelta(state: RaidRunState, delta: RaidWorldDelta): void {
  for (const id of delta.killedEnemies) if (!state.killedEnemies.includes(id)) state.killedEnemies.push(id)
  for (const id of delta.openedContainers) if (!state.openedContainers.includes(id)) state.openedContainers.push(id)
  for (const id of delta.takenLoot) if (!state.takenLoot.includes(id)) state.takenLoot.push(id)
  // 门是否解锁由 killedEnemies 推导（roomIsClear），clearedRooms 只是房间已清的记录
  for (const roomId of delta.clearedRooms) if (!state.clearedRooms.includes(roomId)) state.clearedRooms.push(roomId)
}

/**
 * 把世界增量写进队友的对局行。
 *
 * 队友那一行可能正在被 TA 自己的批处理推进，所以用 version 守卫写：
 * 抢不到就跳过（下一个世界事件批次还会再同步一次），绝不覆盖队友的本地进度。
 */
async function propagateWorldDelta(
  squadId: string,
  actorUserId: number,
  actorMapKey: string,
  delta: RaidWorldDelta,
): Promise<void> {
  const mateIds = getSquadMateIds(squadId, actorUserId)
  if (mateIds.length === 0) return
  const rows = await prisma.petRaid.findMany({ where: { userId: { in: mateIds }, status: 'active' } })
  for (const row of rows) {
    const state = parseRaidRunState(row.state)
    if (!state || state.squadId !== squadId || state.mapKey !== actorMapKey) continue
    mergeWorldDelta(state, delta)
    await prisma.petRaid.updateMany({
      where: { id: row.id, version: row.version },
      data: { state: JSON.stringify(state), version: row.version + 1 },
    })
  }
}

export async function performRaidEvents(
  userId: number,
  input: RaidEventBatchInput,
): Promise<RaidEventBatchResult> {
  const now = Date.now()
  const row = await prisma.petRaid.findUnique({ where: { userId } })
  if (!row) throw new AppError('当前没有进行中的行动', 404)
  if (row.status !== 'active') {
    return { run: null, errors: ['对局已结束'], settlement: null, squad: null }
  }
  const state = parseRaidRunState(row.state)
  if (!state) {
    await abandonLegacyRaid(row)
    throw new AppError('旧版本对局已结束，请重新开始行动', 409, 'RAID_LEGACY')
  }
  // 队友的世界同步会推进本行 version，所以只拒绝「客户端比服务端还新」的情况
  if (Number.isFinite(input.version) && input.version > row.version) {
    throw new AppError('对局状态已变化，请刷新后继续', 409, 'RAID_VERSION')
  }
  const mapDef = getRaidMap(state.mapKey)
  if (!mapDef) throw new AppError('地图不存在', 500)
  const map = generateRaidMap(state.seed, mapDef)

  const ticked = tickRaidRun(state, now)
  const { state: applied, errors } = applyRaidEvents(ticked, map, input.events, now)
  const delta = diffWorldDelta(ticked, applied)
  applied.version = row.version + 1

  if (applied.status !== 'active') {
    const settlement = await finishRaid(row, applied, now)
    return { run: null, errors, settlement, squad: null }
  }

  const updated = await prisma.petRaid.updateMany({
    where: { id: row.id, version: row.version },
    data: {
      state: JSON.stringify(applied),
      version: applied.version,
      expiresAt: new Date(applied.expiresAt),
    },
  })
  if (updated.count === 0) {
    throw new AppError('对局状态已变化，请刷新后继续', 409, 'RAID_VERSION')
  }

  const run = runDto({ ...row, version: applied.version }, applied, now)

  if (applied.squadId) {
    const squad = getSquadById(applied.squadId)
    if (squad) {
      updateMemberLive(squad.id, userId, {
        hp: applied.hp,
        maxHp: applied.maxHp,
        kills: applied.kills,
        roomId: applied.currentRoom,
        lootValue: raidLootValue([...applied.backpack, ...applied.rig, ...applied.safe]),
        x: clampCoord(input.me?.x),
        y: clampCoord(input.me?.y),
        angle: clampAngle(input.me?.angle),
      })
      if (delta) {
        await propagateWorldDelta(squad.id, userId, applied.mapKey, delta)
        broadcastWorld(squad.id, userId, delta)
      }
      void pushSquadState(squad.id)
      const dto = await toSquadDto(squad, userId)
      return { run, errors, settlement: null, squad: { members: dto.members } }
    }
  }

  return { run, errors, settlement: null, squad: null }
}

function clampCoord(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(400, Number(value)))
}

function clampAngle(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(-Math.PI * 2, Math.min(Math.PI * 2, Number(value)))
}

export async function abandonRaid(userId: number): Promise<RaidSettlementDto> {
  const now = Date.now()
  const row = await prisma.petRaid.findUnique({ where: { userId } })
  if (!row || row.status !== 'active') throw new AppError('当前没有进行中的行动', 404)
  const state = parseRaidRunState(row.state)
  if (!state) {
    await abandonLegacyRaid(row)
    throw new AppError('旧版本对局已结束，请重新开始行动', 409, 'RAID_LEGACY')
  }
  state.status = 'abandoned'
  const settlement = await finishRaid(row, state, now)
  if (!settlement) throw new AppError('对局已结束', 409)
  return settlement
}

/* ============================================================
   结算
   ============================================================ */

async function finishRaid(
  row: PetRaid,
  state: RaidRunState,
  now: number,
): Promise<RaidSettlementDto | null> {
  if (state.status === 'active') return null
  const kept = raidKeptContainers(state)
  const lostAll = (state.status === 'died' || state.status === 'mia') && !state.insured

  const outcome = await prisma.$transaction(async (tx) => {
    const claimed = await tx.petRaid.updateMany({
      where: { id: row.id, status: 'active' },
      data: {
        status: state.status,
        state: JSON.stringify({ ...state, settled: true }),
        version: { increment: 1 },
        finishedAt: new Date(now),
      },
    })
    if (claimed.count === 0) return null

    await writeContainersTx(tx, row.userId, kept)

    const gearRows = await tx.raidGear.findMany({ where: { userId: row.userId, equipped: true } })
    const gearLost: string[] = []
    if (lostAll) {
      for (const gear of gearRows) gearLost.push(gear.gearKey)
      await tx.raidGear.deleteMany({ where: { userId: row.userId, equipped: true } })
    } else {
      for (const gear of gearRows) {
        const instance = gear.slot === 'helmet'
          ? state.gear.helmet
          : gear.slot === 'armor'
            ? state.gear.armor
            : null
        if (!instance) continue
        await tx.raidGear.update({
          where: { id: gear.id },
          data: { durability: instance.durability, maxDurability: instance.maxDurability },
        })
      }
    }

    const keptStacks = [...kept.safe, ...kept.backpack, ...kept.rig]
    const lootValue = raidLootValue(keptStacks)
    const record = await tx.petRaidRecord.create({
      data: {
        userId: row.userId,
        mapKey: state.mapKey,
        difficulty: state.difficulty,
        result: state.status,
        points: 0,
        lootJson: JSON.stringify(keptStacks),
        kills: state.kills,
        moves: state.clearedRooms.length,
        durationMs: Math.max(0, now - state.startedAt),
      },
    })

    await bumpRaidContractsTx(tx, row.userId, getTodayDateKey(now), {
      extracts: state.status === 'extracted' ? 1 : 0,
      kills: state.kills,
      lootValue,
    })

    const user = await tx.user.findUnique({ where: { id: row.userId }, select: { points: true } })
    return {
      balance: user?.points ?? 0,
      gearLost,
      lootValue,
      record,
    }
  })

  if (!outcome) return null
  if (state.squadId) {
    // 队伍里少了一个活口：通知其他人刷新队友状态，并安排空队伍回收
    notifyMemberSettled(state.squadId)
    void pushSquadState(state.squadId)
  }
  return {
    result: state.status,
    points: 0,
    balance: outcome.balance,
    gearLost: outcome.gearLost,
    loot: settlementItems(kept),
    kept,
    record: {
      id: outcome.record.id,
      mapKey: outcome.record.mapKey,
      result: outcome.record.result,
      kills: outcome.record.kills,
      lootValue: outcome.lootValue,
      createdAt: outcome.record.createdAt.toISOString(),
    },
  }
}

/** 惰性结算超时对局（读概览 / 开始新局前调用） */
export async function settleExpiredRaid(userId: number, now = Date.now()): Promise<RaidSettlementDto | null> {
  const row = await prisma.petRaid.findUnique({ where: { userId } })
  if (!row || row.status !== 'active') return null
  const state = parseRaidRunState(row.state)
  if (!state) {
    await abandonLegacyRaid(row)
    return null
  }
  if (now < state.expiresAt) return null
  const ticked = tickRaidRun(state, now)
  if (ticked.status === 'active') return null
  return finishRaid(row, ticked, now)
}

/* ============================================================
   读取
   ============================================================ */

export async function getActiveRaid(userId: number, now = Date.now()): Promise<RaidRunDto | null> {
  const row = await prisma.petRaid.findUnique({ where: { userId } })
  if (!row) return null
  if (row.status !== 'active') return null
  const state = parseRaidRunState(row.state)
  if (!state) {
    await abandonLegacyRaid(row)
    return null
  }
  if (now >= state.expiresAt) {
    await settleExpiredRaid(userId, now)
    return null
  }
  return runDto(row, state, now)
}

/** 是否有进行中的行动（装备 / 维修 / 开箱等操作在行动中禁止） */
export async function hasActiveRaid(userId: number, tx: Db = prisma): Promise<boolean> {
  const row = await tx.petRaid.findUnique({ where: { userId }, select: { status: true } })
  return row?.status === 'active'
}

export async function assertNoActiveRaid(userId: number): Promise<void> {
  if (await hasActiveRaid(userId)) {
    throw new AppError('行动中不能整理装备，先撤离或放弃吧', 400, 'RAID_ACTIVE')
  }
}

/** 出击预检：门票 / 保险 / 容器容量（大厅展示用） */
export async function getRaidStartPreview(userId: number, mapKey: string) {
  const map = getRaidMap(mapKey)
  if (!map) throw new AppError('地图不存在', 404)
  const loadout = await loadRaidLoadoutTx(prisma as unknown as Db, userId)
  const bagRows = await prisma.raidBagItem.findMany({ where: { userId } })
  return {
    mapKey: map.key,
    entryCost: map.entryCost,
    insuranceCost: raidInsuranceCost(loadout.gear),
    insuranceRate: 0.15,
    capacities: loadout.capacities,
    gear: loadout.gear,
    skills: loadout.skills,
    backpackUnits: bagRowsToStacks(bagRows.filter((row) => row.container === 'backpack')).reduce((sum, stack) => sum + stack.amount, 0),
    rigUnits: bagRowsToStacks(bagRows.filter((row) => row.container === 'rig')).reduce((sum, stack) => sum + stack.amount, 0),
    safeUnits: bagRowsToStacks(bagRows.filter((row) => row.container === 'safe')).reduce((sum, stack) => sum + stack.amount, 0),
    storageLevel: loadout.storageLevel,
    containerLabels: RAID_CONTAINER_LABELS,
  }
}
