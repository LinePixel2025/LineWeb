import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { sendToUser } from './chatHub.js'
import { pruneGamePresence } from './gamePresence.js'
import { nextGameInviteId } from './gameIds.js'
import {
  GAME_FINISHED_RETENTION_MS,
  GAME_INVITE_TTL_MS,
  GAME_SWEEPER_INTERVAL_MS,
  GAME_WAITING_ROOM_TTL_MS,
  isGameUserAvailable,
  isUserBusyInOtherGames,
  registerGameModule,
  type GameInviteRemovalReason,
} from './gameService.js'
import {
  MC_BLOCK_COUNT,
  MC_MAX_WORLD_EDITS,
  MC_SEA_LEVEL,
  MC_WORLD_HEIGHT,
  MC_WORLD_SIZE,
  mcCreateWorld,
  mcEditKey,
  mcHashWorld,
  mcSpawnForSeed,
} from './gameMinecraftWorld.js'

/**
 * 我的世界好友联机业务逻辑（内存态，无 Prisma 表）——「共享体素世界」
 *
 * 与 2048 / 斗地主 / 贪吃蛇 / 扫雷 / 跳一跳一致的骨架（等待房间 → 房主开始 → 对局），
 * 关键差异（沙盒没有胜负与回合）：
 *   1. 世界**不在服务端存储**：开局只生成一个随机 seed，各客户端用同一份
 *      gameMinecraftWorld.ts 拷贝按 seed 本地生成完整世界（确定性哈希对齐测试兜底）；
 *   2. 服务端只持久化两类轻量状态：
 *      - 方块修改日志（{seq,x,y,z,b}，增量 seq 供断线补拉 / 轮询降级 since 增量）；
 *      - 每个玩家的实时状态（位置 / 朝向 / 飞行），由客户端以 ~2Hz `state` 动作上报，
 *        服务端转发给其他玩家（WS `game:minecraft:state`）并在 sync 里附带最新快照；
 *   3. 没有 endsAt / 胜负：对局一直进行，直到房主解散 / 全员离开 / 全员掉线超时；
 *      房主中途离开会把房主位移交给剩余玩家（沙盒世界不因房主退出而作废）；
 *   4. 掉线处置：不淘汰（沙盒没有淘汰），掉线超过 10 分钟的玩家被移出世界；
 *      全员掉线 10 分钟后世界按 abandoned 关闭；
 *   5. 修改上限：单个世界最多 MC_MAX_WORLD_EDITS 条修改（超限 409），防内存膨胀。
 *
 * 事件载荷（与前端 client/src/types/game.ts 对齐）：
 *   game:invite / game:invite:removed / game:match:started|update|ended —— 与其他游戏一致
 *   game:minecraft:state  { matchId, userId, state } —— 单个玩家的位置快照（发给其他人）
 *   game:minecraft:edit   { matchId, userId, edits } —— 新增的方块修改（发给其他人）
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒（与其他游戏共用同一口径） */
export const MINECRAFT_INVITE_TTL_MS = GAME_INVITE_TTL_MS
/** 房间最少开局人数 */
export const MINECRAFT_MIN_PLAYERS = 2
/** 房间人数上限 */
export const MINECRAFT_MAX_PLAYERS = 8
/** 等待房间最长存活时间：30 分钟（超时未开局解散） */
export const MINECRAFT_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
/** 已结束对局保留期：5 分钟（供客户端补拉最终结果） */
export const MINECRAFT_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
/** 玩家掉线（不可用）超过该时长被移出世界：10 分钟 */
export const MINECRAFT_OFFLINE_KICK_MS = 10 * 60_000
/** 同时进行的我的世界房间/世界上限 */
export const MINECRAFT_MAX_ACTIVE_MATCHES = 100
/** 单个用户最多收到的待处理邀请数 */
export const MINECRAFT_MAX_INCOMING_INVITES = 5

// === DTO（与前端 client/src/types/game.ts 逐字对齐，时间为 ISO 字符串） ===

export type GameMinecraftMatchStatus = 'waiting' | 'playing' | 'finished'
/** 沙盒只有两种结束原因：解散（等待期）/ 废弃（全员离开或掉线超时） */
export type GameMinecraftEndReason = 'cancelled' | 'abandoned'

export interface MinecraftUserBriefDto {
  id: number
  username: string
}

/** 玩家实时状态（位置为脚底中心坐标，与客户端引擎一致） */
export interface MinecraftPlayerStateDto {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  flying: boolean
}

export interface GameMinecraftPlayerDto {
  userId: number
  username: string
  online: boolean
  /** waiting 阶段为 null；开始后为最近一次上报的状态（从未上报则为出生点） */
  state: MinecraftPlayerStateDto | null
  joinedAt: string
}

export interface GameMinecraftWorldDto {
  size: number
  height: number
  seaLevel: number
  /** 开始后才有：按 seed 计算的出生点（脚底坐标） */
  spawn: { x: number; y: number; z: number } | null
}

export interface GameMinecraftMatchDto {
  id: number
  game: 'minecraft'
  hostId: number
  status: GameMinecraftMatchStatus
  version: number
  /** 等待房间中为 0；开始后为服务端权威 seed（各端据此本地生成世界） */
  seed: number
  startedAt: string
  endedAt: string | null
  reason: GameMinecraftEndReason | null
  world: GameMinecraftWorldDto
  /** 修改日志水位（单调递增），客户端据此做 since 增量补拉 */
  editSeq: number
  editCount: number
  maxEdits: number
  players: GameMinecraftPlayerDto[]
}

export interface MinecraftFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface MinecraftInviteDto {
  id: number
  matchId: number
  game: 'minecraft'
  from: MinecraftUserBriefDto
  to: MinecraftUserBriefDto
  createdAt: string
  expiresAt: string
}

export interface MinecraftInvitesDto {
  incoming: MinecraftInviteDto[]
  outgoing: MinecraftInviteDto[]
}

/** 一条已落账的方块修改 */
export interface MinecraftEditDto {
  seq: number
  x: number
  y: number
  z: number
  b: number
  userId: number
}

export interface MinecraftSyncDto {
  serverTime: string
  invites: MinecraftInvitesDto
  match: GameMinecraftMatchDto | null
  /** 自 since（不含）之后的修改日志；match 不存在时为空数组 */
  edits: MinecraftEditDto[]
}

/** POST /api/games/minecraft/matches/:id/actions 的动作体（zod schema 见 config） */
export type MinecraftAction =
  | {
      type: 'state'
      x: number
      y: number
      z: number
      yaw: number
      pitch: number
      flying: boolean
    }
  | { type: 'edit'; edits: Array<{ x: number; y: number; z: number; b: number }> }

// === 内部状态 ===

interface MinecraftPlayerState {
  userId: number
  username: string
  /** 最近一次上报的实时状态；waiting / 从未上报为 null */
  state: MinecraftPlayerStateDto | null
  joinedAt: number
  /** 最近一次被判定为在线的时间（全员掉线超时关闭世界用） */
  lastAvailableAt: number
}

interface MinecraftMatchState {
  id: number
  hostId: number
  status: GameMinecraftMatchStatus
  version: number
  createdAt: number
  /** 等待房间 = 建房时间；开始后 = 开局时间 */
  startedAt: number
  endedAt: number | null
  reason: GameMinecraftEndReason | null
  /** 等待房间中为 0；开始后为权威 seed */
  seed: number
  /** 开始后按 seed 计算并缓存的出生点 */
  spawn: { x: number; y: number; z: number } | null
  players: MinecraftPlayerState[]
  /** 编辑键（"x,y,z"）→ 该键的最新修改（seq + b） */
  edits: Map<string, { seq: number; b: number }>
  /** 修改日志（按 seq 升序），与 edits 同步追加 */
  editLog: MinecraftEditDto[]
  /** 日志水位（最后一条的 seq） */
  editSeq: number
  /** 仅供自检脚本固定世界种子（生产流量恒为 null，开局用随机 seed） */
  forcedSeed: number | null
}

interface MinecraftInviteState {
  id: number
  matchId: number
  from: MinecraftUserBriefDto
  to: MinecraftUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, MinecraftInviteState>()
const matches = new Map<number, MinecraftMatchState>()
let nextMatchId = 1
let sweeperTimer: ReturnType<typeof setInterval> | null = null

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 32 位随机种子（服务端为权威随机源） */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}

/** 对局是否已结束（独立函数避免 TS 控制流收窄误报——状态会被就地修改） */
function matchFinished(match: MinecraftMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: MinecraftMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function activeMatchFor(userId: number): MinecraftMatchState | null {
  for (const match of matches.values()) {
    if (match.status !== 'finished' && isParticipant(match, userId)) return match
  }
  return null
}

function waitingRoomFor(userId: number): MinecraftMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

/** 用户是否已在其他游戏的房间/对局中（跨游戏互斥的另一半） */
function isBusyInOtherGames(userId: number): boolean {
  return isUserBusyInOtherGames(userId, 'minecraft')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

function toInviteDto(invite: MinecraftInviteState): MinecraftInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'minecraft',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

function toMatchDto(match: MinecraftMatchState, now: number): GameMinecraftMatchDto {
  return {
    id: match.id,
    game: 'minecraft',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    seed: match.seed,
    startedAt: iso(match.startedAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    reason: match.reason,
    world: {
      size: MC_WORLD_SIZE,
      height: MC_WORLD_HEIGHT,
      seaLevel: MC_SEA_LEVEL,
      spawn: match.spawn === null ? null : { ...match.spawn },
    },
    editSeq: match.editSeq,
    editCount: match.edits.size,
    maxEdits: MC_MAX_WORLD_EDITS,
    players: match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      online: isGameUserAvailable(player.userId),
      state: player.state === null ? null : { ...player.state },
      joinedAt: iso(player.joinedAt),
    })),
  }
}

// === 事件推送 ===

function broadcastMatch(match: MinecraftMatchState, type: MatchEventType): void {
  const dto = toMatchDto(match, Date.now())
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: dto })
  }
}

/**
 * 把一名玩家的最新状态转发给世界里的其他玩家（轻量事件，不携带完整对局 DTO）。
 * 上报者自己收不到（本地的位置是权威的）。
 */
function emitPlayerState(match: MinecraftMatchState, userId: number, state: MinecraftPlayerStateDto): void {
  const event = { type: 'game:minecraft:state', matchId: match.id, userId, state: { ...state } }
  for (const player of match.players) {
    if (player.userId !== userId) sendToUser(player.userId, event)
  }
}

/** 把一批新修改转发给其他玩家（增量事件；since 补拉走 sync） */
function emitEdits(match: MinecraftMatchState, userId: number, edits: MinecraftEditDto[]): void {
  if (edits.length === 0) return
  const event = { type: 'game:minecraft:edit', matchId: match.id, userId, edits }
  for (const player of match.players) {
    if (player.userId !== userId) sendToUser(player.userId, event)
  }
}

function emitInviteToTarget(invite: MinecraftInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

/** 邀请移除事件发给双方（发出方与接收方都要清理本地弹窗/列表） */
function emitInviteRemoved(invite: MinecraftInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: MinecraftInviteState, reason: GameInviteRemovalReason): void {
  invites.delete(invite.id)
  emitInviteRemoved(invite, reason)
}

function pruneExpiredInvites(now: number): void {
  for (const invite of Array.from(invites.values())) {
    if (invite.expiresAt <= now) removeInvite(invite, 'expired')
  }
}

function removeInvitesForUsers(userIds: number[], reason: GameInviteRemovalReason): void {
  const targets = new Set(userIds)
  for (const invite of Array.from(invites.values())) {
    if (targets.has(invite.from.id) || targets.has(invite.to.id)) removeInvite(invite, reason)
  }
}

/** 按创建时间升序（同毫秒按 id）排序 —— 前端弹窗与列表依赖该顺序 */
function sortInvites(list: MinecraftInviteDto[]): MinecraftInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): MinecraftInvitesDto {
  const incoming: MinecraftInviteDto[] = []
  const outgoing: MinecraftInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 世界生命周期 ===

function createMinecraftWaitingPlayer(user: MinecraftUserBriefDto, now: number): MinecraftPlayerState {
  return {
    userId: user.id,
    username: user.username,
    state: null,
    joinedAt: now,
    lastAvailableAt: now,
  }
}

/** 创建等待房间（房主已在房间里） */
function createWaitingRoom(
  host: MinecraftUserBriefDto,
  now: number,
  forcedSeed: number | null = null,
): MinecraftMatchState {
  const match: MinecraftMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    createdAt: now,
    startedAt: now,
    endedAt: null,
    reason: null,
    seed: 0,
    spawn: null,
    players: [createMinecraftWaitingPlayer(host, now)],
    edits: new Map(),
    editLog: [],
    editSeq: 0,
    forcedSeed,
  }
  matches.set(match.id, match)
  return match
}

/** 结束世界并广播 game:match:ended（沙盒没有赢家，winnerId 恒为 null） */
function finishMinecraftMatch(
  match: MinecraftMatchState,
  reason: GameMinecraftEndReason,
  now: number,
): void {
  if (match.status === 'finished') return
  match.status = 'finished'
  match.reason = reason
  match.endedAt = now
  match.version += 1
  broadcastMatch(match, 'game:match:ended')
}

/**
 * 离开房间 / 世界（等待与进行中都允许）：
 * - 等待房间：房主离开 = 解散房间；普通玩家离开 = 移出房间；
 * - 进行中的世界：离开者移出世界；若房主离开则房主位移交给剩余玩家（沙盒不因房主退出作废）；
 * - 最后一人离开 = 世界关闭（abandoned）。
 */
export function leaveMinecraftMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { ok: true; dissolved: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status === 'finished') throw new AppError('房间已结束', 409)

  removeInvitesForUsers([userId], 'cancelled')

  if (match.status === 'waiting' && match.hostId === userId) {
    removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
    finishMinecraftMatch(match, 'cancelled', now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1

  if (match.players.length === 0) {
    finishMinecraftMatch(match, 'abandoned', now)
    return { ok: true, dissolved: true }
  }

  if (match.hostId === userId) {
    match.hostId = match.players[0].userId
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

/** 认输端点与 leave 同义（沙盒没有认输概念，为端点形状一致保留） */
export function resignMinecraftMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameMinecraftMatchDto } {
  leaveMinecraftMatch(userId, matchId, now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('你已不在该世界中', 404)
  return { match: toMatchDto(match, now) }
}

// === 好友大厅 ===

/** GET /api/games/minecraft/friends */
export async function listMinecraftFriends(userId: number): Promise<{ friends: MinecraftFriendDto[] }> {
  const { friends } = await listFriends(userId)
  return {
    friends: friends.map((friend) => ({
      id: friend.id,
      username: friend.username,
      online: isGameUserAvailable(friend.id),
      inMatch: activeMatchFor(friend.id) !== null || isBusyInOtherGames(friend.id),
    })),
  }
}

// === 邀请 ===

/** GET /api/games/minecraft/invites */
export function listMinecraftInvites(userId: number, now: number = Date.now()): MinecraftInvitesDto {
  return collectInvites(userId, now)
}

/**
 * POST /api/games/minecraft/invites —— 邀请好友加入自己的 2–8 人等待房间
 *
 * 没有房间时自动创建（发起方为房主）；同一好友重复邀请幂等；
 * 任一方已在其他游戏的房间或对局中时拒绝（跨游戏互斥）。
 */
export async function createMinecraftInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: MinecraftInviteDto; match: GameMinecraftMatchDto }> {
  if (friendId === userId) throw new AppError('不能邀请自己', 400)
  if (!(await areFriends(userId, friendId))) throw new AppError('只能邀请好友进行对战', 403)

  pruneExpiredInvites(now)

  const current = activeMatchFor(userId)
  if (current && current.status !== 'waiting') throw new AppError('你正在世界中，无法发起邀请', 409)
  if (activeMatchFor(friendId) || isBusyInOtherGames(friendId)) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (isBusyInOtherGames(userId)) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let incomingCount = 0
  for (const invite of invites.values()) {
    if (invite.to.id === friendId) incomingCount += 1
  }
  if (incomingCount >= MINECRAFT_MAX_INCOMING_INVITES) {
    throw new AppError('对方的待处理邀请过多，请稍后再试', 409)
  }

  const [from, to] = await Promise.all([getUserBrief(userId), getUserBrief(friendId)])

  // 异步查询期间的并发写保护：落库前再检查一次
  const currentAfter = activeMatchFor(userId)
  if (currentAfter && currentAfter.status !== 'waiting') throw new AppError('你正在世界中，无法发起邀请', 409)
  if (activeMatchFor(friendId) || isBusyInOtherGames(friendId)) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (isBusyInOtherGames(userId)) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let room = currentAfter ?? waitingRoomFor(userId)
  if (!room) room = createWaitingRoom({ id: from.id, username: from.username }, now)
  if (room.status !== 'waiting') throw new AppError('房间已经开始，无法继续邀请', 409)
  if (room.players.length >= MINECRAFT_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${MINECRAFT_MAX_PLAYERS} 人）`, 409)
  }

  // 同一好友重复邀请：幂等返回已有邀请与房间
  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room, now) }
    }
  }

  // 对方已经先邀请了自己 → 先处理对方邀请
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  const invite: MinecraftInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + MINECRAFT_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room, now) }
}

/** POST /api/games/minecraft/invites/:id/respond —— 接受 = 加入等待房间（仍由房主统一开始） */
export function respondMinecraftInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameMinecraftMatchDto } {
  const invite = invites.get(inviteId)
  if (!invite || invite.to.id !== userId) throw new AppError('邀请不存在', 404)

  if (invite.expiresAt <= now) {
    removeInvite(invite, 'expired')
    throw new AppError('邀请已过期', 410)
  }

  if (action === 'decline') {
    removeInvite(invite, 'declined')
    return { ok: true }
  }

  const room = matches.get(invite.matchId)
  if (!room || room.status !== 'waiting') {
    removeInvite(invite, 'cancelled')
    throw new AppError('房间已开始或已解散', 409)
  }
  if (activeMatchFor(userId) || isBusyInOtherGames(userId)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('你已在另一场对局或房间中', 409)
  }
  if (!isParticipant(room, invite.from.id)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('邀请已失效', 409)
  }
  if (room.players.length >= MINECRAFT_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${MINECRAFT_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= MINECRAFT_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 只清理「接受者」相关的其它邀请，保留房主邀请其他好友的邀请
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createMinecraftWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= MINECRAFT_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room, now) }
}

/** DELETE /api/games/minecraft/invites/:id */
export function cancelMinecraftInvite(
  userId: number,
  inviteId: number,
  now: number = Date.now(),
): { ok: true } {
  const invite = invites.get(inviteId)
  if (!invite || invite.from.id !== userId) throw new AppError('邀请不存在', 404)
  if (invite.expiresAt <= now) {
    removeInvite(invite, 'expired')
    return { ok: true }
  }
  removeInvite(invite, 'cancelled')
  return { ok: true }
}

// === 同步 / 对局查询 ===

/** GET /api/games/minecraft/sync —— 轮询降级的统一同步（先清理一轮保证状态新鲜） */
export function getMinecraftSync(
  userId: number,
  matchId?: number,
  since?: number,
  now: number = Date.now(),
): MinecraftSyncDto {
  runMinecraftSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: MinecraftMatchState | null
  if (matchId === undefined) {
    match = activeMatchFor(userId)
  } else {
    const found = matches.get(matchId)
    if (!found || !isParticipant(found, userId)) throw new AppError('对局不存在', 404)
    match = found
  }

  // 只在显式传了 since 时才返回增量修改——GameContext 的邀请轮询不带 since，
  // 不能让它每次都拖全量修改日志
  const edits: MinecraftEditDto[] = []
  if (match !== null && since !== undefined && since < match.editSeq) {
    // 日志按 seq 升序，二分找第一条 > since 的记录
    let lo = 0
    let hi = match.editLog.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (match.editLog[mid].seq <= since) lo = mid + 1
      else hi = mid
    }
    for (let i = lo; i < match.editLog.length; i += 1) {
      const entry = match.editLog[i]
      edits.push({ seq: entry.seq, x: entry.x, y: entry.y, z: entry.z, b: entry.b, userId: entry.userId })
    }
  }

  return {
    serverTime: iso(now),
    invites: invitesDto,
    match: match === null ? null : toMatchDto(match, now),
    edits,
  }
}

/** GET /api/games/minecraft/matches/active —— 当前等待房间 / 进行中世界，或 null */
export function getActiveMinecraftMatch(userId: number, now: number = Date.now()): GameMinecraftMatchDto | null {
  runMinecraftSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match, now)
}

/** GET /api/games/minecraft/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getMinecraftMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): GameMinecraftMatchDto {
  runMinecraftSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match, now)
}

// === 对局操作（状态上报 / 方块编辑 —— 沙盒没有回合与胜负） ===

/**
 * 房主开始世界：2–8 人，生成权威 seed 与出生点。
 * 只允许房主操作；房间已开始 / 已结束时拒绝。
 */
export function startMinecraftMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameMinecraftMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < MINECRAFT_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${MINECRAFT_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > MINECRAFT_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${MINECRAFT_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= MINECRAFT_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  const seed = match.forcedSeed ?? randomSeed()
  // 出生点按 seed 生成一次并缓存（150ms 级别的世界生成只发生在开局时刻）
  const spawn = mcSpawnForSeed(seed)
  match.seed = seed >>> 0
  match.spawn = spawn
  match.status = 'playing'
  match.startedAt = now
  match.endedAt = null
  match.reason = null
  match.edits = new Map()
  match.editLog = []
  match.editSeq = 0
  match.version += 1
  // 所有玩家以出生点作为初始状态（从未上报也有合理位置）
  for (const player of match.players) {
    player.state = { x: spawn.x, y: spawn.y, z: spawn.z, yaw: 0, pitch: 0, flying: false }
    player.lastAvailableAt = now
  }
  // 对局开始后不再接受任何邀请
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match, now) }
}

/**
 * POST /api/games/minecraft/matches/:id/actions —— { type:'state' } 玩家状态上报
 *
 * 高频动作（客户端 ~2Hz）：只更新内存快照并转发给其他玩家，
 * 不递增 version、不广播完整对局 DTO；顺带刷新在线判定记录。
 */
function applyMinecraftStateAction(
  match: MinecraftMatchState,
  userId: number,
  action: Extract<MinecraftAction, { type: 'state' }>,
  now: number,
): { ok: true } {
  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player) throw new AppError('你不在该世界中', 404)
  player.state = {
    x: action.x,
    y: action.y,
    z: action.z,
    yaw: action.yaw,
    pitch: action.pitch,
    flying: action.flying,
  }
  player.lastAvailableAt = now
  emitPlayerState(match, userId, player.state)
  return { ok: true }
}

/**
 * POST /api/games/minecraft/matches/:id/actions —— { type:'edit' } 方块修改
 *
 * 校验（与客户端 mcApplyEdits 口径一致）：边界内、y ≥ 1（y=0 基岩层不可改）、
 * 方块 id 合法、与该键最新值相同则跳过；应用的修改追加进日志并转发其他玩家。
 * 世界修改总数达到上限后拒绝（409）。
 */
function applyMinecraftEditAction(
  match: MinecraftMatchState,
  userId: number,
  action: Extract<MinecraftAction, { type: 'edit' }>,
): { applied: MinecraftEditDto[] } {
  if (match.edits.size >= MC_MAX_WORLD_EDITS) {
    throw new AppError('这个世界修改已达上限，无法继续修改', 409)
  }

  const applied: MinecraftEditDto[] = []
  for (const edit of action.edits) {
    if (
      !Number.isInteger(edit.x)
      || !Number.isInteger(edit.y)
      || !Number.isInteger(edit.z)
      || edit.x < 0
      || edit.x >= MC_WORLD_SIZE
      || edit.y < 1
      || edit.y >= MC_WORLD_HEIGHT
      || edit.z < 0
      || edit.z >= MC_WORLD_SIZE
      || !Number.isInteger(edit.b)
      || edit.b < 0
      || edit.b >= MC_BLOCK_COUNT
    ) {
      continue
    }
    const key = mcEditKey(edit.x, edit.y, edit.z)
    const existing = match.edits.get(key)
    if (existing && existing.b === edit.b) continue
    if (match.edits.size >= MC_MAX_WORLD_EDITS) break

    match.editSeq += 1
    const entry: MinecraftEditDto = {
      seq: match.editSeq,
      x: edit.x,
      y: edit.y,
      z: edit.z,
      b: edit.b,
      userId,
    }
    match.edits.set(key, { seq: entry.seq, b: entry.b })
    match.editLog.push(entry)
    applied.push(entry)
  }

  if (applied.length > 0) emitEdits(match, userId, applied)
  return { applied }
}

/**
 * POST /api/games/minecraft/matches/:id/actions
 * 非参与者 404；等待房间 409（世界还没开始）。
 */
export function applyMinecraftAction(
  userId: number,
  matchId: number,
  action: MinecraftAction,
  now: number = Date.now(),
): { ok: true } | { applied: MinecraftEditDto[] } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('世界尚未开始或已结束', 409)

  if (action.type === 'state') return applyMinecraftStateAction(match, userId, action, now)
  if (action.type === 'edit') return applyMinecraftEditAction(match, userId, action)
  throw new AppError('不支持的操作类型', 400)
}

// === 定时清理（sweeper） ===

/**
 * 执行一轮我的世界清理与结算（已由 registerGameModule 交给 gameService 主 sweeper
 * 每 15 秒调用一次；也导出供 routes / 自检脚本显式触发）：
 *   1. 清理过期邀请与 presence；
 *   2. 等待房间超过 30 分钟未开局 → cancelled 解散；
 *   3. 进行中的世界：刷新各玩家在线记录；单个玩家掉线超过 10 分钟移出世界；
 *      全员掉线超过 10 分钟 → abandoned 关闭；
 *   4. 回收结束超过 5 分钟的对局。
 */
export function runMinecraftSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    if (match.status === 'waiting') {
      if (now >= match.createdAt + MINECRAFT_WAITING_ROOM_TTL_MS) {
        removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
        finishMinecraftMatch(match, 'cancelled', now)
      }
      continue
    }
    if (match.status !== 'playing') continue

    // 刷新在线记录；离线超时者先收集（本轮一次性移出，避免迭代中修改数组）
    for (const player of match.players) {
      if (isGameUserAvailable(player.userId)) player.lastAvailableAt = now
    }
    const kicked: number[] = []
    for (const player of match.players) {
      if (now - player.lastAvailableAt >= MINECRAFT_OFFLINE_KICK_MS) kicked.push(player.userId)
    }
    if (kicked.length > 0) {
      // 全员掉线超时：直接关闭世界但**保留参与者名单**——
      // 结束后的世界要在保留期内可读（掉线玩家重连后能看到「世界已关闭」）
      if (kicked.length >= match.players.length) {
        finishMinecraftMatch(match, 'abandoned', now)
        continue
      }
      const kickedSet = new Set(kicked)
      match.players = match.players.filter((player) => !kickedSet.has(player.userId))
      match.version += 1
      if (match.players.length === 0) {
        finishMinecraftMatch(match, 'abandoned', now)
        continue
      }
      if (kickedSet.has(match.hostId)) match.hostId = match.players[0].userId
      broadcastMatch(match, 'game:match:update')
    }
  }

  // 回收已结束的对局（保留期 5 分钟，供客户端补拉最终结果）
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= MINECRAFT_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

/**
 * 兜底清理定时器（可选）：主链路已由 gameService.startGameSweeper() 经
 * registerGameModule 的 sweep 钩子驱动，这里只是多一层保险，重复调用安全。
 */
export function startMinecraftTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runMinecraftSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ 我的世界清理定时器已启动（间隔 ${intervalMs}ms）`)
}

/** 停止兜底清理定时器（自检脚本收尾用；重复调用安全） */
function stopMinecraftTicker(): void {
  if (sweeperTimer !== null) {
    clearInterval(sweeperTimer)
    sweeperTimer = null
  }
}

// === 自检脚本 / 单测入口 ===

/**
 * 仅供 verify 脚本 / 单测使用：跳过好友与可用性校验，直接创建一个包含指定玩家的
 * 等待房间（第一位为房主，其余按加入顺序）。生产流量请走邀请流程。
 *
 * `options.seed` 只影响开局世界（便于脚本按同一 seed 复现出生点）；
 * 生产流量恒为 null，即由服务端随机取种。
 */
export function createMinecraftRoomForTest(
  hostId: number,
  hostName: string,
  memberIds: number[] = [],
  now: number = Date.now(),
  options?: { seed?: number },
): { matchId: number } {
  const room = createWaitingRoom(
    { id: hostId, username: hostName },
    now,
    options && typeof options.seed === 'number' ? options.seed >>> 0 : null,
  )
  memberIds.forEach((memberId) => {
    room.players.push(createMinecraftWaitingPlayer({ id: memberId, username: `u${memberId}` }, now))
  })
  room.version += 1
  return { matchId: room.id }
}

/**
 * 仅供 verify 脚本 / 单测使用：直接登记一条待处理邀请
 * （真实流程需要数据库里的好友关系），便于验证接受 / 拒绝 / 取消与过期语义。
 */
export function createMinecraftInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: MinecraftInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + MINECRAFT_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

/** 仅供自检脚本使用：清空内存状态（含兜底定时器），便于脚本反复运行 */
export function resetMinecraftStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopMinecraftTicker()
}

/** 仅供自检脚本使用：确认世界生成拷贝可用（哈希对齐由测试断言） */
export function minecraftWorldSanityForTest(seed: number): { hash: string; spawn: { x: number; y: number; z: number } } {
  const world = mcCreateWorld(seed)
  return { hash: mcHashWorld(world), spawn: mcSpawnForSeed(seed) }
}

// === 跨游戏互斥注册（其他游戏侧发起或接受邀请时会检查这里） ===

function isUserInMinecraftMatch(userId: number): boolean {
  return activeMatchFor(userId) !== null
}

/**
 * 强制清除该用户在世界里的房间 / 世界状态。
 * 沙盒没有认输概念，统一走 leave：等待房间房主 = 解散，其余 = 移出并移交房主。
 */
export function resetMinecraftUser(userId: number): number {
  let cleared = 0
  for (const match of Array.from(matches.values())) {
    if (!match.players.some((player) => player.userId === userId)) continue
    try {
      leaveMinecraftMatch(userId, match.id)
      cleared += 1
    } catch {
      // 已结束 / 并发离开：忽略
    }
  }
  return cleared
}

registerGameModule({
  name: 'minecraft',
  isUserInMatch: isUserInMinecraftMatch,
  sweep: runMinecraftSweeper,
  resetUser: resetMinecraftUser,
})
