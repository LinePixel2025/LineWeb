/**
 * 搜打撤「玩家匹配」PvPvE（2026-11-04）
 *
 * 对齐《三角洲行动》危险行动的核心口径：
 *   - 固定 3v3：双方各 3 人，人数不够用 AI 佣兵补位；
 *   - 同一 seed、同一张地图：两队在世界里会遇到彼此，NPC 敌人照常；
 *   - 爆率用 pvp 表（更高）；2026-11-07 起非洲之心两种模式都能掉，只是权重更低、价值更高；
 *   - 阵亡按普通阵亡结算：背包与胸挂清空（掉在原地可被舔）、安全箱保留、随身装备按保险规则处理。
 *
 * 实现：纯内存房间（与既有联机游戏一致，重启即失效），不新增 Prisma 表。
 * 位置走 1.5 秒轮询（`POST /pvp/pos` + `GET /pvp/state`），不依赖 WebSocket ——
 * 这个站点的聊天/游戏本来就有「无 WS 降级」，PvP 也不该成为例外。
 *
 * 信任模型：
 *   - 位置是自报的（与今日队友幽灵同一级）；服务端只做同房校验；
 *   - **伤害一律服务端重算**：客户端只能决定「打谁」，不能决定「打多少」，
 *     所以作弊者最多刷射速（有 700ms 冷却硬顶），刷不出伤害。
 */

import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  RAID_MAPS,
  RAID_STATE_VERSION,
  applyRaidDamage,
  getRaidMap,
  resolveRaidDamage,
  type RaidLootMode,
  type RaidRunState,
} from '../lib/raidRun.js'
import {
  giveGroundLootToUser,
  parseRaidRunState,
  settleRaidAsDeath,
  startRaid,
  type RaidRunDto,
} from './raidRunService.js'
import { getUserBrief } from './chatService.js'

export const RAID_PVP_TEAM_SIZE = 3
/** 排队 45 秒后即使人不够也开局，缺的位置由佣兵补 */
export const RAID_PVP_FILL_MS = 45_000
/** 单人开火冷却：作弊者最多把射速打满，伤害仍由服务端按攻击力重算 */
export const RAID_PVP_STRIKE_COOLDOWN_MS = 700
/** 玩家一枪的等效攻击力倍率（比 NPC 普攻高一档，但仍受目标护甲减伤） */
export const RAID_PVP_SHOT_MULT = 1.6
/** 一局最多多久（与地图上限取较小值，防止内存房间滞留） */
const PVP_MATCH_MAX_MS = 30 * 60_000
const PVP_POS_TTL_MS = 60_000

export interface PvpLivePosition {
  x: number
  y: number
  angle: number
  roomId: number
  at: number
}

export interface PvpMerc {
  id: string
  faction: PvpFaction
  name: string
  level: number
  hp: number
  maxHp: number
  roomId: number
  x: number
  y: number
}

export type PvpFaction = 'A' | 'B'

interface QueuedPlayer {
  userId: number
  mapKey: string
  at: number
}

interface PvpMatch {
  id: string
  seed: number
  mapKey: string
  factions: Record<PvpFaction, number[]>
  mercs: PvpMerc[]
  createdAt: number
  expiresAt: number
  lastStrikeAt: Map<number, number>
}

const queue: QueuedPlayer[] = []
const matches = new Map<string, PvpMatch>()
/** userId → 匹配 id */
const matchOfUser = new Map<number, string>()
const livePositions = new Map<number, PvpLivePosition>()
let matchSeq = 0

/* ============================================================
   纯函数（自检脚本直接断言）
   ============================================================ */

/** 按加入顺序交替分队：A/B/A/B…，保证两队人数差 ≤ 1 */
export function splitIntoFactions(userIds: readonly number[]): Record<PvpFaction, number[]> {
  const factions: Record<PvpFaction, number[]> = { A: [], B: [] }
  userIds.forEach((userId, index) => {
    if (index % 2 === 0) factions.A.push(userId)
    else factions.B.push(userId)
  })
  return factions
}

/** 佣兵补位数量：两队各补到 3 人 */
export function mercFillCounts(realA: number, realB: number): { A: number; B: number } {
  return {
    A: Math.max(0, RAID_PVP_TEAM_SIZE - Math.max(0, Math.trunc(realA))),
    B: Math.max(0, RAID_PVP_TEAM_SIZE - Math.max(0, Math.trunc(realB))),
  }
}

/** 是否该开局：满 6 人立即开；否则最早排队的人等满 45 秒后，只要有 2 人（一人也能靠佣兵打）就开 */
export function shouldFormMatch(queued: readonly { at: number }[], nowMs: number): boolean {
  if (queued.length >= RAID_PVP_TEAM_SIZE * 2) return true
  if (queued.length < 1) return false
  const oldest = Math.min(...queued.map((entry) => entry.at))
  return queued.length >= 2 && nowMs - oldest >= RAID_PVP_FILL_MS
}

/** 开火前置校验：同场、敌对阵营、都在同一房间、冷却已过 */
export function canStrike(input: {
  attackerFaction: PvpFaction
  targetFaction: PvpFaction
  attackerRoom: number
  targetRoom: number
  lastStrikeAt: number
  nowMs: number
}): { ok: boolean; reason?: string } {
  if (input.attackerFaction === input.targetFaction) return { ok: false, reason: '不能攻击队友' }
  if (input.attackerRoom !== input.targetRoom) return { ok: false, reason: '不在同一个房间里' }
  if (input.nowMs - input.lastStrikeAt < RAID_PVP_STRIKE_COOLDOWN_MS) {
    return { ok: false, reason: '射速冷却中' }
  }
  return { ok: true }
}

export function pvpLootMode(): RaidLootMode {
  return 'pvp'
}

/* ============================================================
   队列 / 成局
   ============================================================ */

function isBusyInRaid(userId: number): boolean {
  return matchOfUser.has(userId)
}

export interface PvpQueueView {
  queueing: boolean
  position: number
  waitingMs: number
  matched: boolean
  matchId: string | null
  faction: PvpFaction | null
  teammates: { userId: number; username: string }[]
  hostiles: { userId: number; username: string; live: PvpLivePosition | null }[]
  mercs: PvpMerc[]
  teamSize: number
  fillMs: number
}

export async function enqueuePvp(
  userId: number,
  mapKey: string,
): Promise<PvpQueueView> {
  const map = getRaidMap(mapKey)
  if (!map) throw new AppError('地图不存在', 404)
  if (matchOfUser.has(userId)) throw new AppError('你已经在 PvP 对局中了', 409, 'PVP_ACTIVE')
  const current = await prisma.petRaid.findUnique({ where: { userId }, select: { status: true } })
  if (current?.status === 'active') throw new AppError('你已经在行动中了', 409, 'RAID_ACTIVE')

  const existing = queue.findIndex((entry) => entry.userId === userId)
  if (existing >= 0) queue.splice(existing, 1)
  queue.push({ userId, mapKey: map.key, at: Date.now() })
  await tryFormMatch()
  return getQueueView(userId)
}

export function cancelPvp(userId: number): PvpQueueView {
  const index = queue.findIndex((entry) => entry.userId === userId)
  if (index >= 0) queue.splice(index, 1)
  return {
    queueing: false,
    position: 0,
    waitingMs: 0,
    matched: matchOfUser.has(userId),
    matchId: matchOfUser.get(userId) ?? null,
    faction: null,
    teammates: [],
    hostiles: [],
    mercs: [],
    teamSize: RAID_PVP_TEAM_SIZE,
    fillMs: RAID_PVP_FILL_MS,
  }
}

export async function getQueueView(userId: number): Promise<PvpQueueView> {
  const queueIndex = queue.findIndex((entry) => entry.userId === userId)
  const queued = queueIndex >= 0 ? queue[queueIndex] : null
  const matchId = matchOfUser.get(userId) ?? null
  const match = matchId ? matches.get(matchId) : null
  const faction = match
    ? (match.factions.A.includes(userId) ? 'A' : match.factions.B.includes(userId) ? 'B' : null)
    : null
  const teammateIds = faction && match ? match.factions[faction] : []
  const hostileIds = faction && match ? match.factions[faction === 'A' ? 'B' : 'A'] : []
  const [teammates, hostiles] = await Promise.all([
    Promise.all(teammateIds.map(async (id) => ({ userId: id, username: await nameOf(id) }))),
    Promise.all(hostileIds.map(async (id) => ({
      userId: id,
      username: await nameOf(id),
      live: livePositions.get(id) ?? null,
    }))),
  ])
  return {
    queueing: queueIndex >= 0,
    position: queueIndex >= 0 ? queueIndex + 1 : 0,
    waitingMs: queued ? Date.now() - queued.at : 0,
    matched: !!match,
    matchId,
    faction,
    teammates,
    hostiles,
    mercs: match?.mercs ?? [],
    teamSize: RAID_PVP_TEAM_SIZE,
    fillMs: RAID_PVP_FILL_MS,
  }
}

async function nameOf(userId: number): Promise<string> {
  try {
    const brief = await getUserBrief(userId)
    return brief?.username ?? `玩家${userId}`
  } catch {
    return `玩家${userId}`
  }
}

/** 成局：取最早排队的人组成的池子，按 mapKey 分组，满足条件就开 */
export async function tryFormMatch(nowMs = Date.now()): Promise<{ formed: number; started: number; failed: number }> {
  let formed = 0
  let started = 0
  let failed = 0
  const mapKeys = [...new Set(queue.map((entry) => entry.mapKey))]
  for (const mapKey of mapKeys) {
    const pool = queue.filter((entry) => entry.mapKey === mapKey)
    if (!shouldFormMatch(pool, nowMs)) continue
    const picked = pool.slice(0, RAID_PVP_TEAM_SIZE * 2)
    // 先出队再开局：开局失败的玩家不回到队里（他们自己会看到失败原因）
    for (const entry of picked) {
      const index = queue.findIndex((row) => row.userId === entry.userId)
      if (index >= 0) queue.splice(index, 1)
    }
    const result = await startPvpMatch(picked.map((entry) => entry.userId), mapKey, nowMs)
    if (result.matchId) formed += 1
    started += result.started
    failed += result.failed
  }
  return { formed, started, failed }
}

async function startPvpMatch(
  userIds: readonly number[],
  mapKey: string,
  nowMs: number,
): Promise<{ matchId: string | null; started: number; failed: number }> {
  if (userIds.length === 0) return { matchId: null, started: 0, failed: 0 }
  const map = getRaidMap(mapKey) ?? RAID_MAPS[0]!
  // SQLite INT 是 32 位有符号，seed 必须落在 1..2^31-1
  const seed = (Math.floor(Math.random() * 0x7fffffff) >>> 0) || 1
  const factions = splitIntoFactions(userIds)
  const fills = mercFillCounts(factions.A.length, factions.B.length)
  matchSeq += 1
  const matchId = `pvp-${nowMs.toString(36)}-${matchSeq}`
  const mercs: PvpMerc[] = []
  const pushMercs = (faction: PvpFaction, count: number) => {
    for (let i = 0; i < count; i += 1) {
      mercs.push({
        id: `merc-${matchId}-${faction}-${i}`,
        faction,
        name: faction === 'A' ? `佣兵·蓝${i + 1}` : `佣兵·红${i + 1}`,
        level: Math.max(1, 6 + i),
        hp: 120,
        maxHp: 120,
        roomId: 0,
        x: 0,
        y: 0,
      })
    }
  }
  pushMercs('A', fills.A)
  pushMercs('B', fills.B)

  let started = 0
  let failed = 0
  for (const userId of userIds) {
    const faction: PvpFaction = factions.A.includes(userId) ? 'A' : 'B'
    try {
      // 同一 seed + mode=pvp：两队在世界里看到的是同一张地图、同一批容器与敌人
      const dto = await startRaid(userId, mapKey, {
        seed,
        mode: pvpLootMode(),
        squadId: `${matchId}-${faction}`,
      })
      applyStartedRun(userId, dto)
      started += 1
    } catch {
      failed += 1
    }
  }
  if (started === 0) return { matchId: null, started, failed }

  const match: PvpMatch = {
    id: matchId,
    seed,
    mapKey: map.key,
    factions,
    mercs,
    createdAt: nowMs,
    expiresAt: Math.min(nowMs + map.durationMs, nowMs + PVP_MATCH_MAX_MS),
    lastStrikeAt: new Map(),
  }
  matches.set(matchId, match)
  for (const userId of userIds) matchOfUser.set(userId, matchId)
  return { matchId, started, failed }
}

/** startRaid 之后的位置预热（进入出生房间，避免第一次轮询前没有位置） */
function applyStartedRun(userId: number, dto: RaidRunDto): void {
  livePositions.set(userId, {
    x: 0,
    y: 0,
    angle: 0,
    roomId: dto.currentRoom,
    at: Date.now(),
  })
}

/* ============================================================
   位置 / 对手视图
   ============================================================ */

export function recordPvpPosition(userId: number, pos: { x?: number; y?: number; angle?: number; roomId?: number }): void {
  const matchId = matchOfUser.get(userId)
  if (!matchId) return
  livePositions.set(userId, {
    x: clampNumber(pos.x, 0, 4096),
    y: clampNumber(pos.y, 0, 4096),
    angle: clampNumber(pos.angle, -Math.PI * 4, Math.PI * 4),
    roomId: Math.max(0, Math.trunc(pos.roomId ?? 0)),
    at: Date.now(),
  })
}

function clampNumber(value: unknown, min: number, max: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : min
  return Math.max(min, Math.min(max, num))
}

export interface PvpStateView {
  matchId: string
  faction: PvpFaction | null
  hostiles: { userId: number; username: string; live: PvpLivePosition | null }[]
  mercs: PvpMerc[]
  teammates: { userId: number; username: string; live: PvpLivePosition | null }[]
  remainingMs: number
}

export async function getPvpState(userId: number): Promise<PvpStateView | null> {
  const matchId = matchOfUser.get(userId)
  if (!matchId) return null
  const match = matches.get(matchId)
  if (!match) return null
  const view = await getQueueView(userId)
  return {
    matchId,
    faction: view.faction,
    hostiles: view.hostiles,
    mercs: match.mercs.filter((merc) => merc.faction !== view.faction),
    teammates: view.teammates.map((mate) => ({
      ...mate,
      live: livePositions.get(mate.userId) ?? null,
    })),
    remainingMs: Math.max(0, match.expiresAt - Date.now()),
  }
}

/* ============================================================
   伤害（服务端权威）
   ============================================================ */

export interface PvpStrikeResult {
  ok: boolean
  damage: number
  targetHp: number
  targetMaxHp: number
  killed: boolean
  /** 击杀后掉在地上的战利品数量 */
  lootDropped: number
  reason?: string
}

async function loadActiveState(userId: number): Promise<{ row: { id: number; version: number; state: string }; state: RaidRunState } | null> {
  const row = await prisma.petRaid.findUnique({
    where: { userId },
    select: { id: true, version: true, state: true, status: true },
  })
  if (!row || row.status !== 'active') return null
  const state = parseRaidRunState(row.state)
  if (!state || state.schemaVersion !== RAID_STATE_VERSION) return null
  return { row: { id: row.id, version: row.version, state: row.state }, state }
}

export async function strikePlayer(
  attackerId: number,
  targetId: number,
  zoneRaw: unknown,
): Promise<PvpStrikeResult> {
  const matchId = matchOfUser.get(attackerId)
  if (!matchId) throw new AppError('你不在 PvP 对局中', 400, 'PVP_NOT_IN_MATCH')
  if (attackerId === targetId) throw new AppError('不能打自己', 400)
  const match = matches.get(matchId)
  if (!match) throw new AppError('对局已结束', 404, 'PVP_MATCH_GONE')
  if (matchOfUser.get(targetId) !== matchId) throw new AppError('目标不在同一局', 400, 'PVP_NOT_SAME_MATCH')

  const attackerFaction: PvpFaction = match.factions.A.includes(attackerId) ? 'A' : 'B'
  const targetFaction: PvpFaction = match.factions.A.includes(targetId) ? 'A' : 'B'
  const target = await loadActiveState(targetId)
  const attacker = await loadActiveState(attackerId)
  if (!target || !attacker) throw new AppError('对局已结束', 404, 'PVP_MATCH_GONE')

  const guard = canStrike({
    attackerFaction,
    targetFaction,
    attackerRoom: attacker.state.currentRoom,
    targetRoom: target.state.currentRoom,
    lastStrikeAt: match.lastStrikeAt.get(attackerId) ?? 0,
    nowMs: Date.now(),
  })
  if (!guard.ok) throw new AppError(guard.reason ?? '现在不能开火', 400, 'PVP_STRIKE_BLOCKED')
  match.lastStrikeAt.set(attackerId, Date.now())

  const zone = zoneRaw === 'head' ? 'head' : 'body'
  // 伤害只认攻击者的攻击力与目标的护甲：客户端传什么都不影响结果
  const raw = Math.max(1, Math.round(attacker.state.atk * RAID_PVP_SHOT_MULT))
  const damage = resolveRaidDamage({
    raw,
    zone,
    helmet: target.state.gear.helmet,
    armor: target.state.gear.armor,
  })
  const next = JSON.parse(JSON.stringify(target.state)) as RaidRunState
  applyRaidDamage(next, damage)
  next.killedByUserId = next.status === 'died' ? attackerId : next.killedByUserId
  next.version = target.row.version + 1
  next.lastSyncAt = Date.now()

  const claimed = await prisma.petRaid.updateMany({
    where: { id: target.row.id, version: target.row.version },
    data: { state: JSON.stringify(next), version: next.version },
  })
  if (claimed.count === 0) {
    // 目标那一行刚被他自己的一批事件改过：本次开火作废，让客户端重试（不写坏数据）
    throw new AppError('目标状态刚变化，请再开一枪', 409, 'PVP_RETRY')
  }

  let lootDropped = 0
  if (next.status === 'died') {
    const stacks = [...next.backpack, ...next.rig].map((stack) => ({
      itemKey: stack.itemKey,
      amount: stack.amount,
    }))
    if (stacks.length > 0) {
      const dropped = await giveGroundLootToUser(attackerId, next.currentRoom, stacks)
      lootDropped = dropped?.ground.length ?? 0
    }
    const row = await prisma.petRaid.findUnique({ where: { userId: targetId } })
    if (row) await settleRaidAsDeath(row, next)
  }

  return {
    ok: true,
    damage: damage.hpDamage,
    targetHp: next.hp,
    targetMaxHp: next.maxHp,
    killed: next.status === 'died',
    lootDropped,
  }
}

export interface MercStrikeResult {
  ok: boolean
  mercId: string
  mercHp: number
  killed: boolean
  reason?: string
}

/** 佣兵击杀记在服务端（佣兵本身由客户端模拟，这里只做存在性 + 同房 + 血量账本） */
export async function strikeMerc(attackerId: number, mercId: string): Promise<MercStrikeResult> {
  const matchId = matchOfUser.get(attackerId)
  if (!matchId) throw new AppError('你不在 PvP 对局中', 400, 'PVP_NOT_IN_MATCH')
  const match = matches.get(matchId)
  if (!match) throw new AppError('对局已结束', 404, 'PVP_MATCH_GONE')
  const attackerFaction: PvpFaction = match.factions.A.includes(attackerId) ? 'A' : 'B'
  const merc = match.mercs.find((item) => item.id === mercId)
  if (!merc) throw new AppError('没有这个佣兵', 404)
  if (merc.faction === attackerFaction) throw new AppError('不能攻击己方佣兵', 400)
  if (merc.hp <= 0) return { ok: true, mercId, mercHp: 0, killed: false, reason: '已经倒下了' }

  const attacker = await loadActiveState(attackerId)
  if (!attacker) throw new AppError('对局已结束', 404, 'PVP_MATCH_GONE')
  const last = match.lastStrikeAt.get(attackerId) ?? 0
  if (Date.now() - last < RAID_PVP_STRIKE_COOLDOWN_MS) {
    throw new AppError('射速冷却中', 400, 'PVP_STRIKE_BLOCKED')
  }
  match.lastStrikeAt.set(attackerId, Date.now())

  const damage = Math.max(1, Math.round(attacker.state.atk * RAID_PVP_SHOT_MULT))
  merc.hp = Math.max(0, merc.hp - damage)
  const killed = merc.hp === 0
  if (killed) {
    const next = JSON.parse(JSON.stringify(attacker.state)) as RaidRunState
    next.kills += 1
    next.version = attacker.row.version + 1
    next.lastSyncAt = Date.now()
    await prisma.petRaid.updateMany({
      where: { id: attacker.row.id, version: attacker.row.version },
      data: { state: JSON.stringify(next), version: next.version },
    })
  }
  return { ok: true, mercId, mercHp: merc.hp, killed }
}

/* ============================================================
   生命周期 / 清扫（挂在既有 15 秒 sweeper 上，不新增定时器）
   ============================================================ */

/** 玩家离开 PvP 匹配（放弃对局 / 被结算时调用） */
export function leavePvpMatch(userId: number): void {
  matchOfUser.delete(userId)
  livePositions.delete(userId)
}

export function isUserInPvpMatch(userId: number): boolean {
  return isBusyInRaid(userId)
}

export function getPvpMatchOf(userId: number): { matchId: string; seed: number } | null {
  const matchId = matchOfUser.get(userId)
  if (!matchId) return null
  const match = matches.get(matchId)
  return match ? { matchId, seed: match.seed } : null
}

/** 每 15 秒由 gameService 的 sweeper 调用：清队列老化、清过期对局、清陈旧位置 */
export async function sweepPvp(nowMs = Date.now()): Promise<void> {
  // 队列里的玩家可能已经开了别的对局：先剔掉，再尝试成局
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    const entry = queue[index]!
    if (matchOfUser.has(entry.userId) || nowMs - entry.at > 10 * 60_000) queue.splice(index, 1)
  }
  await tryFormMatch(nowMs)

  for (const [matchId, match] of matches) {
    if (match.expiresAt <= nowMs) {
      for (const userId of [...match.factions.A, ...match.factions.B]) {
        if (matchOfUser.get(userId) === matchId) matchOfUser.delete(userId)
      }
      matches.delete(matchId)
    }
  }
  for (const [userId, pos] of livePositions) {
    if (nowMs - pos.at > PVP_POS_TTL_MS) livePositions.delete(userId)
  }
  // 已被别的路径结算掉的人（阵亡/撤离/超时）从匹配里摘掉
  for (const userId of [...matchOfUser.keys()]) {
    const row = await prisma.petRaid.findUnique({ where: { userId }, select: { status: true } })
    if (row && row.status !== 'active') matchOfUser.delete(userId)
  }
}
