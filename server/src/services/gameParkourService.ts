import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { sendToUser } from './chatHub.js'
import { pruneGamePresence } from './gamePresence.js'
import { nextGameInviteId } from './gameIds.js'
import { resetUserInMatches } from './gameExit.js'
import {
  GAME_FINISHED_RETENTION_MS,
  GAME_INVITE_TTL_MS,
  GAME_WAITING_ROOM_TTL_MS,
  isGameUserAvailable,
  isUserBusyInOtherGames,
  registerGameModule,
  type GameInviteRemovalReason,
} from './gameService.js'
import {
  PARKOUR_DASH_MULT,
  PARKOUR_LANES,
  PARKOUR_ONLINE_MAX_SPEED,
  PARKOUR_RACE_LENGTH_M,
  parkourScore,
  type ParkourLane,
  type ParkourPose,
} from './gameParkour.js'

/**
 * 霓虹跑酷好友联机业务逻辑（内存态，无 Prisma 表）
 *
 * 设计（与我的世界的 seed + 状态上报模型同构）：
 *   - 服务端权威下发 seed / 开始时间，客户端本地 60fps 跑同一条 800m 三车道赛道；
 *   - 客户端每 500ms POST progress（距离 / 金币 / 连击 / 车道 / 姿态 / 存活），
 *     服务端做单调、速度上限、金币上限与车道/姿态合法性校验，不做逐帧服务端物理；
 *   - 冲线按服务端收到 finish 的先后顺序排名；未完赛按距离 > 金币 > maxCombo；
 *   - 一次撞击 / 掉坑即出局；护盾 / 冲刺为客户端玩法，服务端只记录结果；
 *   - 无 WebSocket 时客户端用 sync 轮询 + presence 心跳降级；
 *   - 跨游戏互斥：本人仍在 waiting/playing 的跑酷房间会阻塞其他游戏；已冲线/已出局的
 *     观众不再阻塞，离开结果页不会被 active 查询拉回。
 *
 * 结束原因：finish / elimination / timeout / cancelled。
 * 掉线：连续 30 秒既无 WS/presence 也无进度上报且仍有其他可用玩家 → forfeit。
 */

// === 时效与容量参数 ===

export const PARKOUR_INVITE_TTL_MS = GAME_INVITE_TTL_MS
export const PARKOUR_MIN_PLAYERS = 2
export const PARKOUR_MAX_PLAYERS = 6
export const PARKOUR_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
export const PARKOUR_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
export const PARKOUR_RACE_DURATION_MS = 150_000
export const PARKOUR_COUNTDOWN_MS = 3_000
export const PARKOUR_DISCONNECT_FORFEIT_MS = 30_000
export const PARKOUR_PROGRESS_FRESH_MS = 10_000
export const PARKOUR_MAX_ACTIVE_MATCHES = 200
export const PARKOUR_MAX_INCOMING_INVITES = 5
export const PARKOUR_PROGRESS_BROADCAST_INTERVAL_MS = 400
/** 服务端允许的最大前进速度（含冲刺）：21 × 1.4 ≈ 29.4，留 0.6 余量 */
export const PARKOUR_SERVER_MAX_SPEED = Math.ceil(PARKOUR_ONLINE_MAX_SPEED * PARKOUR_DASH_MULT) + 1
/** finish 时允许的最小上报距离（略小于 800，容忍网络与浮点误差） */
export const PARKOUR_FINISH_DISTANCE_M = PARKOUR_RACE_LENGTH_M - 5

// === DTO（与 client/src/types/game.ts 逐字对齐） ===

export type GameParkourMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameParkourPlayerStatus = 'waiting' | 'playing' | 'finished' | 'lost'
export type GameParkourEndReason = 'finish' | 'elimination' | 'timeout' | 'cancelled'
export type ParkourDeathCause = 'hit' | 'pit' | 'resign' | 'forfeit'

export interface ParkourUserBriefDto {
  id: number
  username: string
}

export interface ParkourInviteDto {
  id: number
  matchId: number
  game: 'parkour'
  from: ParkourUserBriefDto
  to: ParkourUserBriefDto
  createdAt: string
  expiresAt: string
}

export interface GameParkourPlayerDto {
  userId: number
  username: string
  online: boolean
  colorIndex: number
  status: GameParkourPlayerStatus
  distanceM: number
  coins: number
  maxCombo: number
  score: number
  lane: ParkourLane
  pose: ParkourPose
  rank: number | null
  finishMs: number | null
  cause: ParkourDeathCause | null
}

export interface GameParkourMatchDto {
  id: number
  game: 'parkour'
  hostId: number
  status: GameParkourMatchStatus
  version: number
  createdAt: string
  startedAt: string | null
  startsAt: string | null
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameParkourEndReason | null
  seed: number
  trackLengthM: number
  countdownMs: number
  remainingMs: number
  players: GameParkourPlayerDto[]
}

export interface ParkourFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface ParkourInvitesDto {
  incoming: ParkourInviteDto[]
  outgoing: ParkourInviteDto[]
}

export interface ParkourSyncDto {
  serverTime: string
  invites: ParkourInvitesDto
  match: GameParkourMatchDto | null
}

export interface ParkourProgressAction {
  type: 'progress'
  distanceM: number
  coins: number
  maxCombo: number
  lane: ParkourLane
  pose: ParkourPose
  alive: boolean
  cause?: 'hit' | 'pit'
}

export interface ParkourFinishAction {
  type: 'finish'
  distanceM: number
  coins: number
  maxCombo: number
}

export type ParkourAction = ParkourProgressAction | ParkourFinishAction

// === 内部状态 ===

interface ParkourPlayerState {
  userId: number
  username: string
  status: GameParkourPlayerStatus
  colorIndex: number
  distanceM: number
  coins: number
  maxCombo: number
  lane: ParkourLane
  pose: ParkourPose
  alive: boolean
  finished: boolean
  rank: number | null
  finishMs: number | null
  cause: ParkourDeathCause | null
  /** 最近一次 WS/presence 被判定可用的时间（毫秒） */
  lastAvailableAt: number
  /** 最近一次进度上报时间（毫秒） */
  lastProgressAt: number
}

interface ParkourMatchState {
  id: number
  hostId: number
  status: GameParkourMatchStatus
  version: number
  createdAt: number
  startedAt: number | null
  startsAt: number | null
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameParkourEndReason | null
  seed: number
  players: ParkourPlayerState[]
  finishCounter: number
  lastBroadcastAt: number
}

interface ParkourInviteState {
  id: number
  matchId: number
  from: ParkourUserBriefDto
  to: ParkourUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, ParkourInviteState>()
const matches = new Map<number, ParkourMatchState>()
let nextMatchId = 1

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}

function matchFinished(match: ParkourMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: ParkourMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function playerOf(match: ParkourMatchState, userId: number): ParkourPlayerState | null {
  return match.players.find((player) => player.userId === userId) ?? null
}

/**
 * 仍能参与比赛的未结束对局（waiting/playing 且本人 status 也是 waiting/playing）。
 * 已冲线 / 已出局的观众不再算 active，也不会阻塞其它游戏。
 */
function activeRaceForUser(userId: number): ParkourMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'finished') continue
    const player = playerOf(match, userId)
    if (player && (player.status === 'waiting' || player.status === 'playing')) return match
  }
  return null
}

function waitingRoomFor(userId: number): ParkourMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

function isBusyInOtherGames(userId: number): boolean {
  return isUserBusyInOtherGames(userId, 'parkour')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

function allPlayersDone(match: ParkourMatchState): boolean {
  return match.players.every(
    (player) => player.status === 'finished' || player.status === 'lost',
  )
}

function toInviteDto(invite: ParkourInviteState): ParkourInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'parkour',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

function toPlayerDto(player: ParkourPlayerState): GameParkourPlayerDto {
  return {
    userId: player.userId,
    username: player.username,
    online: isGameUserAvailable(player.userId),
    colorIndex: player.colorIndex,
    status: player.status,
    distanceM: Math.round(player.distanceM * 10) / 10,
    coins: player.coins,
    maxCombo: player.maxCombo,
    score: parkourScore(player),
    lane: player.lane,
    pose: player.pose,
    rank: player.rank,
    finishMs: player.finishMs,
    cause: player.cause,
  }
}

function toMatchDto(match: ParkourMatchState, now: number): GameParkourMatchDto {
  const countdownMs = match.status === 'playing' && match.startsAt !== null
    ? Math.max(0, match.startsAt - now)
    : 0
  // 倒计时期间不把 3 秒算进比赛剩余时间：未到起跑点按 150 秒显示
  const raceClockNow = match.startsAt === null ? now : Math.max(now, match.startsAt)
  const remainingMs = match.status === 'finished' ? 0 : Math.max(0, match.endsAt - raceClockNow)
  return {
    id: match.id,
    game: 'parkour',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    createdAt: iso(match.createdAt),
    startedAt: match.startedAt === null ? null : iso(match.startedAt),
    startsAt: match.startsAt === null ? null : iso(match.startsAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    seed: match.seed,
    trackLengthM: PARKOUR_RACE_LENGTH_M,
    countdownMs,
    remainingMs,
    players: match.players.map(toPlayerDto),
  }
}

// === 事件推送 ===

function broadcastMatch(match: ParkourMatchState, type: MatchEventType, now: number): void {
  const dto = toMatchDto(match, now)
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: dto })
  }
  if (type === 'game:match:update') match.lastBroadcastAt = now
}

function emitInviteToTarget(invite: ParkourInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

function emitInviteRemoved(invite: ParkourInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: ParkourInviteState, reason: GameInviteRemovalReason): void {
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

function sortInvites(list: ParkourInviteDto[]): ParkourInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): ParkourInvitesDto {
  const incoming: ParkourInviteDto[] = []
  const outgoing: ParkourInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createParkourPlayer(
  user: ParkourUserBriefDto,
  colorIndex: number,
  now: number,
): ParkourPlayerState {
  return {
    userId: user.id,
    username: user.username,
    status: 'waiting',
    colorIndex,
    distanceM: 0,
    coins: 0,
    maxCombo: 0,
    lane: 1,
    pose: 'run',
    alive: true,
    finished: false,
    rank: null,
    finishMs: null,
    cause: null,
    lastAvailableAt: now,
    lastProgressAt: now,
  }
}

function createWaitingRoom(host: ParkourUserBriefDto, now: number): ParkourMatchState {
  const match: ParkourMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    createdAt: now,
    startedAt: null,
    startsAt: null,
    endsAt: now + PARKOUR_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    seed: 0,
    players: [createParkourPlayer(host, 0, now)],
    finishCounter: 0,
    lastBroadcastAt: 0,
  }
  matches.set(match.id, match)
  return match
}

/**
 * 结束对局：为未完赛玩家按距离 > 金币 > maxCombo 补排名，广播 ended。
 * cancelled 是等待房间解散，不参与排名。
 */
function finishParkourMatch(
  match: ParkourMatchState,
  reason: GameParkourEndReason,
  now: number,
): void {
  if (match.status === 'finished') return
  match.status = 'finished'
  match.reason = reason
  match.endedAt = now
  match.version += 1

  if (reason === 'cancelled') {
    match.winnerId = null
    for (const player of match.players) {
      player.status = 'lost'
      player.alive = false
      player.rank = null
      player.finishMs = null
    }
    broadcastMatch(match, 'game:match:ended', now)
    return
  }

  const unranked = match.players
    .filter((player) => player.status !== 'finished')
    .sort(
      (a, b) =>
        b.distanceM - a.distanceM
        || b.coins - a.coins
        || b.maxCombo - a.maxCombo
        || a.userId - b.userId,
    )
  let nextRank = match.finishCounter + 1
  for (const player of unranked) {
    player.rank = nextRank
    nextRank += 1
    player.alive = false
    player.status = 'lost'
  }
  const winner = match.players.find((player) => player.rank === 1) ?? null
  match.winnerId = winner === null ? null : winner.userId
  broadcastMatch(match, 'game:match:ended', now)
}

/** 单个玩家冲线：记录服务端到达顺序，不结束其他玩家 */
function completeParkourPlayer(
  match: ParkourMatchState,
  player: ParkourPlayerState,
  now: number,
): void {
  player.distanceM = PARKOUR_RACE_LENGTH_M
  player.finished = true
  player.alive = true
  player.status = 'finished'
  player.cause = null
  player.finishMs = match.startsAt === null ? 0 : Math.max(0, now - match.startsAt)
  if (player.rank === null) {
    match.finishCounter += 1
    player.rank = match.finishCounter
  }
}

function finishReasonFor(match: ParkourMatchState): GameParkourEndReason {
  return match.players.some((player) => player.status === 'finished') ? 'finish' : 'elimination'
}

/** 每次进度后检查是否全员完成/出局；是则结束并返回 true */
function settleIfAllDone(match: ParkourMatchState, now: number): boolean {
  if (!allPlayersDone(match)) return false
  finishParkourMatch(match, finishReasonFor(match), now)
  return true
}

// === 对外 API ===

/** 房主开始：2–6 人，3 秒倒计时，800m 同 seed 赛道 */
export function startParkourMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameParkourMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < PARKOUR_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${PARKOUR_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > PARKOUR_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${PARKOUR_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= PARKOUR_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  match.status = 'playing'
  match.version += 1
  match.seed = randomSeed() || 1
  match.startedAt = now
  match.startsAt = now + PARKOUR_COUNTDOWN_MS
  match.endsAt = match.startsAt + PARKOUR_RACE_DURATION_MS
  match.finishCounter = 0
  match.lastBroadcastAt = now
  match.players.forEach((player, seat) => {
    player.status = 'playing'
    player.colorIndex = seat
    player.distanceM = 0
    player.coins = 0
    player.maxCombo = 0
    player.lane = 1
    player.pose = 'run'
    player.alive = true
    player.finished = false
    player.rank = null
    player.finishMs = null
    player.cause = null
    player.lastAvailableAt = now
    player.lastProgressAt = now
  })
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started', now)
  return { match: toMatchDto(match, now) }
}

/** 离开等待房间：房主离开 = 解散；普通玩家离开 = 移除 */
export function leaveParkourMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { ok: true; dissolved: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') {
    const me = match.players.find((player) => player.userId === userId)
    if (match.status === 'playing' && me?.status === 'playing') {
      throw new AppError('对局进行中，请先认输再退出房间', 409)
    }
    removeInvitesForUsers([userId], 'cancelled')
    return { ok: true, dissolved: false }
  }

  removeInvitesForUsers([userId], 'cancelled')
  if (match.hostId === userId) {
    removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
    finishParkourMatch(match, 'cancelled', now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishParkourMatch(match, 'cancelled', now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update', now)
  return { ok: true, dissolved: false }
}

/** GET /api/games/parkour/friends */
export async function listParkourFriends(userId: number): Promise<{ friends: ParkourFriendDto[] }> {
  const { friends } = await listFriends(userId)
  return {
    friends: friends.map((friend) => ({
      id: friend.id,
      username: friend.username,
      online: isGameUserAvailable(friend.id),
      inMatch: activeRaceForUser(friend.id) !== null || isBusyInOtherGames(friend.id),
    })),
  }
}

/** GET /api/games/parkour/invites */
export function listParkourInvites(userId: number, now: number = Date.now()): ParkourInvitesDto {
  return collectInvites(userId, now)
}

/** POST /api/games/parkour/invites —— 邀请好友加入 2–6 人等待房间 */
export async function createParkourInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: ParkourInviteDto; match: GameParkourMatchDto }> {
  if (friendId === userId) throw new AppError('不能邀请自己', 400)
  if (!(await areFriends(userId, friendId))) throw new AppError('只能邀请好友进行对战', 403)

  pruneExpiredInvites(now)

  const current = activeRaceForUser(userId)
  if (current && current.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeRaceForUser(friendId) || isBusyInOtherGames(friendId)) {
    throw new AppError('对方正在对局/房间中，无法邀请', 409)
  }
  if (isBusyInOtherGames(userId)) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let incomingCount = 0
  for (const invite of invites.values()) {
    if (invite.to.id === friendId) incomingCount += 1
  }
  if (incomingCount >= PARKOUR_MAX_INCOMING_INVITES) {
    throw new AppError('对方的待处理邀请过多，请稍后再试', 409)
  }

  const [from, to] = await Promise.all([getUserBrief(userId), getUserBrief(friendId)])

  // 异步查询期间再检查一次，避免并发写
  const currentAfter = activeRaceForUser(userId)
  if (currentAfter && currentAfter.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeRaceForUser(friendId) || isBusyInOtherGames(friendId)) {
    throw new AppError('对方正在对局/房间中，无法邀请', 409)
  }
  if (isBusyInOtherGames(userId)) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let room = currentAfter ?? waitingRoomFor(userId)
  if (!room) room = createWaitingRoom({ id: from.id, username: from.username }, now)
  if (room.status !== 'waiting') throw new AppError('房间已经开始，无法继续邀请', 409)
  if (room.players.length >= PARKOUR_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${PARKOUR_MAX_PLAYERS} 人）`, 409)
  }

  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room, now) }
    }
  }
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  const invite: ParkourInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + PARKOUR_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room, now) }
}

/** POST /api/games/parkour/invites/:id/respond —— 接受 = 加入等待房间 */
export function respondParkourInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameParkourMatchDto } {
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
  if (activeRaceForUser(userId) || isBusyInOtherGames(userId)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('你已在另一场对局或房间中', 409)
  }
  if (!isParticipant(room, invite.from.id)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('邀请已失效', 409)
  }
  if (room.players.length >= PARKOUR_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${PARKOUR_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= PARKOUR_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(
    createParkourPlayer(
      { id: invite.to.id, username: invite.to.username },
      room.players.length,
      now,
    ),
  )
  room.version += 1
  if (room.players.length >= PARKOUR_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update', now)
  return { ok: true, match: toMatchDto(room, now) }
}

/** DELETE /api/games/parkour/invites/:id */
export function cancelParkourInvite(
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

/** GET /api/games/parkour/sync —— 轮询降级统一同步 */
export function getParkourSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): ParkourSyncDto {
  runParkourSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: ParkourMatchState | null
  if (matchId === undefined) {
    match = activeRaceForUser(userId)
  } else {
    const found = matches.get(matchId)
    if (!found || !isParticipant(found, userId)) throw new AppError('对局不存在', 404)
    match = found
  }

  return {
    serverTime: iso(now),
    invites: invitesDto,
    match: match === null ? null : toMatchDto(match, now),
  }
}

/** GET /api/games/parkour/matches/active —— 本人仍参与的房间/对局，或 null */
export function getActiveParkourMatch(
  userId: number,
  now: number = Date.now(),
): GameParkourMatchDto | null {
  runParkourSweeper(now)
  const match = activeRaceForUser(userId)
  return match === null ? null : toMatchDto(match, now)
}

/** GET /api/games/parkour/matches/:id —— 参与者可补拉最终结果 */
export function getParkourMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): GameParkourMatchDto {
  runParkourSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match, now)
}

/**
 * POST /api/games/parkour/matches/:id/actions
 *
 * progress：幂等、绝对值上报；距离单调且受速度上限约束，金币/连击取 max，
 * 车道/姿态合法化；一次 progress 视为一次可用心跳。不会返回完整 DTO。
 * finish：服务端收到顺序即名次；要求最近距离 ≥ 795 且速度上限允许。
 */
export function applyParkourAction(
  userId: number,
  matchId: number,
  action: ParkourAction,
  now: number = Date.now(),
): { ok: true } | { match: GameParkourMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status === 'finished') throw new AppError('对局已结束', 409)
  if (match.status !== 'playing') throw new AppError('对局未开始', 409)

  runParkourSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const player = playerOf(match, userId)
  if (!player) throw new AppError('你不在本局中', 404)
  if (player.finished) {
    return action.type === 'finish' ? { match: toMatchDto(match, now) } : { ok: true }
  }
  if (player.status === 'lost' || !player.alive) {
    if (action.type === 'finish') throw new AppError('你已出局', 409)
    return { ok: true }
  }

  const elapsedMs = match.startsAt === null ? 0 : Math.max(0, now - match.startsAt)
  const maxDistance = (elapsedMs / 1000) * PARKOUR_SERVER_MAX_SPEED + 2
  const reportedDistance = clamp(
    Number.isFinite(action.distanceM) ? action.distanceM : 0,
    0,
    Math.min(PARKOUR_RACE_LENGTH_M, maxDistance),
  )

  if (action.type === 'progress') {
    player.lastProgressAt = now
    player.lastAvailableAt = now
    const nextDistance = Math.max(player.distanceM, reportedDistance)
    player.distanceM = nextDistance
    const coinCap = Math.floor(nextDistance * 3) + 10
    player.coins = Math.max(player.coins, Math.min(Math.floor(action.coins), coinCap))
    player.maxCombo = Math.max(
      player.maxCombo,
      Math.min(Math.floor(action.maxCombo), player.coins),
    )
    player.lane = clamp(Math.floor(action.lane), 0, PARKOUR_LANES - 1) as ParkourLane
    player.pose = action.pose

    if (!action.alive) {
      player.alive = false
      player.status = 'lost'
      player.cause = action.cause ?? 'hit'
      match.version += 1
      broadcastMatch(match, 'game:match:update', now)
      settleIfAllDone(match, now)
      return { ok: true }
    }

    match.version += 1
    if (nextDistance >= PARKOUR_RACE_LENGTH_M) {
      completeParkourPlayer(match, player, now)
      broadcastMatch(match, 'game:match:update', now)
      settleIfAllDone(match, now)
      return { ok: true }
    }

    // 进度包很密，广播节流到 ~2.5Hz；跳过的更新由下一次进度 / 结束事件带上
    if (now - match.lastBroadcastAt >= PARKOUR_PROGRESS_BROADCAST_INTERVAL_MS) {
      broadcastMatch(match, 'game:match:update', now)
    }
    return { ok: true }
  }

  // finish
  if (action.distanceM < PARKOUR_FINISH_DISTANCE_M) {
    throw new AppError('尚未到达终点', 400)
  }
  if (maxDistance < PARKOUR_RACE_LENGTH_M) {
    throw new AppError('进度异常，无法冲线', 400)
  }
  player.lastProgressAt = now
  player.lastAvailableAt = now
  player.distanceM = PARKOUR_RACE_LENGTH_M
  const coinCap = Math.floor(PARKOUR_RACE_LENGTH_M * 3) + 10
  player.coins = Math.max(player.coins, Math.min(Math.floor(action.coins), coinCap))
  player.maxCombo = Math.max(
    player.maxCombo,
    Math.min(Math.floor(action.maxCombo), player.coins),
  )
  completeParkourPlayer(match, player, now)
  match.version += 1
  broadcastMatch(match, 'game:match:update', now)
  settleIfAllDone(match, now)
  return { match: toMatchDto(match, now) }
}

/** POST /api/games/parkour/matches/:id/resign —— 中途退出 = 本局 DNF */
export function resignParkourMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameParkourMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status === 'finished') throw new AppError('对局已结束', 409)

  runParkourSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const player = playerOf(match, userId)
  if (!player || player.status !== 'playing' || !player.alive) throw new AppError('你已出局', 409)

  player.alive = false
  player.status = 'lost'
  player.cause = 'resign'
  player.lastProgressAt = now
  match.version += 1
  broadcastMatch(match, 'game:match:update', now)
  settleIfAllDone(match, now)
  return { match: toMatchDto(match, now) }
}

// === 定时清理（sweeper） ===

/**
 * 主 sweeper 每 15 秒调用一次：
 *   1. 过期邀请 / presence；
 *   2. 等待房 30 分钟 → cancelled；
 *   3. 比赛 150 秒 → timeout 按距离排名；
 *   4. 掉线 30 秒且仍有其他可用者 → forfeit（全员不可用留给超时）；
 *   5. 回收结束 5 分钟的对局。
 */
export function runParkourSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    if (match.status === 'waiting') {
      if (now >= match.endsAt) {
        removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
        finishParkourMatch(match, 'cancelled', now)
      }
      continue
    }
    if (match.status !== 'playing') continue

    if (now >= match.endsAt) {
      finishParkourMatch(match, 'timeout', now)
      continue
    }

    let changed = false
    for (const player of match.players) {
      if (player.status !== 'playing') continue
      const available = isGameUserAvailable(player.userId)
        || now - player.lastProgressAt < PARKOUR_PROGRESS_FRESH_MS
      if (available) {
        player.lastAvailableAt = now
        continue
      }
      if (now - player.lastAvailableAt < PARKOUR_DISCONNECT_FORFEIT_MS) continue

      const othersAvailable = match.players.some(
        (candidate) =>
          candidate.userId !== player.userId
          && candidate.status === 'playing'
          && (isGameUserAvailable(candidate.userId)
            || now - candidate.lastProgressAt < PARKOUR_PROGRESS_FRESH_MS),
      )
      if (!othersAvailable) continue

      player.alive = false
      player.status = 'lost'
      player.cause = 'forfeit'
      changed = true
    }
    if (changed) {
      match.version += 1
      if (settleIfAllDone(match, now)) continue
      broadcastMatch(match, 'game:match:update', now)
    }
  }

  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= PARKOUR_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

// === 自检脚本 / 单测入口 ===

export function createParkourRoomForTest(
  hostId: number,
  hostName: string,
  memberIds: number[] = [],
  now: number = Date.now(),
): { matchId: number } {
  const room = createWaitingRoom({ id: hostId, username: hostName }, now)
  memberIds.forEach((memberId) => {
    room.players.push(
      createParkourPlayer({ id: memberId, username: `u${memberId}` }, room.players.length, now),
    )
  })
  room.version += 1
  return { matchId: room.id }
}

export function createParkourInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: ParkourInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + PARKOUR_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

export function resetParkourStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
}

// === 跨游戏互斥注册 ===

/**
 * 只有本人仍在 waiting/playing 的未结束对局算忙；已冲线 / 已出局的观众放行，
 * 这样完赛选手离开结果页后可以立刻加入别的游戏。
 */
function isUserInParkourMatch(userId: number): boolean {
  return activeRaceForUser(userId) !== null
}

/** 强制清除该用户在跑酷里的房间 / 比赛状态（等待房间离开，比赛中 DNF） */
export function resetParkourUser(userId: number): number {
  return resetUserInMatches(matches.values(), userId, {
    leave: (uid, id) => leaveParkourMatch(uid, id),
    resign: (uid, id) => resignParkourMatch(uid, id),
  })
}

registerGameModule({
  name: 'parkour',
  isUserInMatch: isUserInParkourMatch,
  sweep: runParkourSweeper,
  resetUser: resetParkourUser,
})
