import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { isUserOnline, sendToUser } from './chatHub.js'
import { isGamePresent, pruneGamePresence } from './gamePresence.js'
import {
  GAME2048_TARGET,
  applyMove,
  createEmptyBoard,
  createSeededGame,
  hasAvailableMoves,
  maxTileValue,
  type Game2048Board,
  type Game2048Direction,
  type Game2048Random,
} from './game2048.js'

/**
 * 2048 好友联机业务逻辑（内存态，无 Prisma 表）
 *
 * 设计：
 *   - 邀请 / 对局 / 玩家棋盘与 RNG 全部保存在服务进程内存中，服务重启即失效；
 *   - 服务端权威：客户端只提交移动方向，棋盘、得分、胜负全部由服务端计算；
 *   - 实时推送复用聊天 WebSocket（chatHub.sendToUser），不新增 WS 服务；
 *   - 无 WebSocket 时客户端通过 `sync` 轮询 + `presence` 心跳降级；
 *     在线判定统一为 isGameUserAvailable = 聊天 WS 在线 || presence 未过期；
 *   - sweeper 每 15 秒执行一次：邀请过期清理、超时判定、掉线判负、结束对局回收。
 *
 * 事件载荷（与前端 client/src/types/game.ts 对齐）：
 *   game:invite          { invite }
 *   game:invite:removed  { inviteId, reason: 'accepted'|'declined'|'cancelled'|'expired' }
 *   game:match:started   { match }
 *   game:match:update    { match }
 *   game:match:ended     { match }
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒 */
export const GAME_INVITE_TTL_MS = 60_000
/** 默认竞速时长：10 分钟（房主开始时可选择 1–60 分钟） */
export const GAME_DEFAULT_DURATION_MS = 10 * 60_000
/** 房主可选竞速时长范围（分钟） */
export const GAME_MIN_DURATION_MINUTES = 1
export const GAME_MAX_DURATION_MINUTES = 60
/** 单个房间最多玩家数（含房主） */
export const GAME_MAX_PLAYERS = 10
/** 房间最少开局人数 */
export const GAME_MIN_PLAYERS = 2
/** 等待房间最长存活时间：30 分钟（防止房主离开后房间永久占用） */
export const GAME_WAITING_ROOM_TTL_MS = 30 * 60_000
/** 已结束对局的保留期：5 分钟（供客户端补拉最终结果） */
export const GAME_FINISHED_RETENTION_MS = 5 * 60_000
/** 连续不可用超过该时长判负：120 秒 */
export const GAME_DISCONNECT_FORFEIT_MS = 120_000
/** 同时进行的对局上限 */
export const GAME_MAX_ACTIVE_MATCHES = 500
/** 单个用户最多收到的待处理邀请数 */
export const GAME_MAX_INCOMING_INVITES = 5
/** sweeper 执行间隔：15 秒 */
export const GAME_SWEEPER_INTERVAL_MS = 15_000

// === DTO（与前端契约一致，时间为 ISO 字符串） ===

export interface GameUserBriefDto {
  id: number
  username: string
}

export interface GameInviteDto {
  id: number
  matchId: number
  from: GameUserBriefDto
  to: GameUserBriefDto
  createdAt: string
  expiresAt: string
}

export type GameInviteRemovalReason = 'accepted' | 'declined' | 'cancelled' | 'expired'
export type GameMatchStatus = 'waiting' | 'playing' | 'finished'
export type GamePlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameEndReason =
  | 'target'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'blocked'
  | 'last_standing'
  | 'elimination'
  | 'cancelled'

export interface GamePlayerDto {
  userId: number
  username: string
  score: number
  maxTile: number
  moves: number
  status: GamePlayerStatus
  /** 可用性：聊天 WS 在线 或 presence 未过期 */
  online: boolean
  board: number[][]
}

export interface GameMatchDto {
  id: number
  game: '2048'
  hostId: number
  status: GameMatchStatus
  version: number
  /** 竞速时长（毫秒）；等待房间中为默认 10 分钟，开始后为房主选择值 */
  durationMs: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameEndReason | null
  players: GamePlayerDto[]
}

export interface GameFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface GameInvitesDto {
  incoming: GameInviteDto[]
  outgoing: GameInviteDto[]
}

export interface GameSyncDto {
  serverTime: string
  invites: GameInvitesDto
  match: GameMatchDto | null
}

// === 内部状态 ===

interface InviteState {
  id: number
  matchId: number
  from: GameUserBriefDto
  to: GameUserBriefDto
  createdAt: number
  expiresAt: number
}

interface PlayerState {
  userId: number
  username: string
  board: Game2048Board
  score: number
  maxTile: number
  moves: number
  status: GamePlayerStatus
  /** 该玩家专属的随机序列（开局后分配；等待房间中为 null） */
  random: Game2048Random | null
  /** 最近一次被判定为可用的时间（用于掉线判负） */
  lastAvailableAt: number
}

interface MatchState {
  id: number
  hostId: number
  status: GameMatchStatus
  version: number
  durationMs: number
  startedAt: number
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameEndReason | null
  players: PlayerState[]
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, InviteState>()
const matches = new Map<number, MatchState>()
let nextInviteId = 1
let nextMatchId = 1

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 32 位随机种子（服务端为权威随机源） */
function randomSeed(): number {
  return Math.floor(Math.random() * 0x1_0000_0000) >>> 0
}

/** 游戏可用性：聊天 WS 在线 或 游戏 presence 未过期 */
export function isGameUserAvailable(userId: number): boolean {
  return isUserOnline(userId) || isGamePresent(userId)
}

function isParticipant(match: MatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

/** 当前用户所在的房间/对局（等待或进行中） */
function activeMatchFor(userId: number): MatchState | null {
  for (const match of matches.values()) {
    if (match.status !== 'finished' && isParticipant(match, userId)) return match
  }
  return null
}

/** 寻找当前用户所在的等待房间 */
function waitingRoomFor(userId: number): MatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

function activePlayerCount(match: MatchState): number {
  return match.players.filter((player) => player.status === 'playing').length
}

/** 当前总进行中对局数 */
function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status === 'playing') count += 1
  }
  return count
}

function toInviteDto(invite: InviteState): GameInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

function toMatchDto(match: MatchState): GameMatchDto {
  return {
    id: match.id,
    game: '2048',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    durationMs: match.durationMs,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    players: match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      score: player.score,
      maxTile: player.maxTile,
      moves: player.moves,
      status: player.status,
      online: isGameUserAvailable(player.userId),
      board: player.board.map((row) => row.slice()),
    })),
  }
}

// === 事件推送 ===

function broadcastMatch(match: MatchState, type: MatchEventType): void {
  const dto = toMatchDto(match)
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: dto })
  }
}

function emitInviteInviteToTarget(invite: InviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

/** 邀请移除事件发给双方（发出方与接收方都需要清理本地弹窗/列表） */
function emitInviteRemoved(invite: InviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  const targets = new Set<number>([invite.from.id, invite.to.id])
  for (const userId of targets) {
    sendToUser(userId, event)
  }
}

// === 邀请清理 ===

/** 清理所有已过期邀请并广播 expired 事件 */
function pruneExpiredInvites(now: number): void {
  for (const invite of Array.from(invites.values())) {
    if (invite.expiresAt <= now) {
      invites.delete(invite.id)
      emitInviteRemoved(invite, 'expired')
    }
  }
}

/** 删除单条邀请并广播移除事件 */
function removeInvite(invite: InviteState, reason: GameInviteRemovalReason): void {
  invites.delete(invite.id)
  emitInviteRemoved(invite, reason)
}

/**
 * 清理与这些用户相关的所有待处理邀请（接受邀请建立对局时调用）。
 * 对局一旦开始，双方不应再被其它邀请打扰；其它邀请的发起/接收方会收到 removed 事件。
 */
function removeInvitesForUsers(userIds: number[], reason: GameInviteRemovalReason): void {
  const targets = new Set(userIds)
  for (const invite of Array.from(invites.values())) {
    if (targets.has(invite.from.id) || targets.has(invite.to.id)) {
      removeInvite(invite, reason)
    }
  }
}

/** 按创建时间升序（同毫秒按 id）排序 —— 前端弹窗与列表依赖该顺序 */
function sortInvites(list: GameInviteDto[]): GameInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): GameInvitesDto {
  const incoming: GameInviteDto[] = []
  const outgoing: GameInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

/** 等待房间中的玩家：还没有棋盘，等房主开始后统一种子发牌 */
function createWaitingPlayer(user: GameUserBriefDto, now: number): PlayerState {
  return {
    userId: user.id,
    username: user.username,
    board: createEmptyBoard(),
    score: 0,
    maxTile: 0,
    moves: 0,
    status: 'waiting',
    random: null,
    lastAvailableAt: now,
  }
}

/** 创建等待房间（房主已在房间里） */
function createWaitingRoom(host: GameUserBriefDto, now: number): MatchState {
  const match: MatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    durationMs: GAME_DEFAULT_DURATION_MS,
    startedAt: now,
    endsAt: now + GAME_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    players: [createWaitingPlayer(host, now)],
  }
  matches.set(match.id, match)
  return match
}

/** 把等待房间里的玩家初始化成同一 seed 的竞速棋盘 */
function initPlayerForGame(player: PlayerState, seed: number, now: number): void {
  const initial = createSeededGame(seed)
  player.board = initial.board
  player.score = 0
  player.maxTile = maxTileValue(initial.board)
  player.moves = 0
  player.status = 'playing'
  player.random = initial.random
  player.lastAvailableAt = now
}

/**
 * 房主开始游戏：2–10 人，所有人同一 seed，状态从 waiting 切到 playing。
 * 只允许房主操作；房间已开始/已结束时拒绝。
 */
export function startGameMatch(
  userId: number,
  matchId: number,
  durationMinutes: number = GAME_DEFAULT_DURATION_MS / 60_000,
  now: number = Date.now(),
): { match: GameMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < GAME_MIN_PLAYERS) throw new AppError('至少需要 2 名玩家才能开始', 400)
  if (match.players.length > GAME_MAX_PLAYERS) throw new AppError('房间人数超过上限', 400)
  if (
    !Number.isInteger(durationMinutes)
    || durationMinutes < GAME_MIN_DURATION_MINUTES
    || durationMinutes > GAME_MAX_DURATION_MINUTES
  ) {
    throw new AppError(`竞速时长需为 ${GAME_MIN_DURATION_MINUTES}–${GAME_MAX_DURATION_MINUTES} 分钟`, 400)
  }

  const seed = randomSeed()
  for (const player of match.players) initPlayerForGame(player, seed, now)
  match.status = 'playing'
  match.durationMs = durationMinutes * 60_000
  match.startedAt = now
  match.endsAt = now + match.durationMs
  match.version += 1
  // 对局开始后不再接受任何邀请
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match) }
}

/**
 * 离开等待房间：房主离开 = 解散房间；普通玩家离开 = 从房间移除。
 * 已开始的对局不能走这个接口（请使用 resign）。
 */
export function leaveGameMatch(userId: number, matchId: number, now: number = Date.now()): { ok: true; dissolved: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('对局已开始，无法离开房间', 409)

  const isHost = match.hostId === userId
  removeInvitesForUsers([userId], 'cancelled')

  if (isHost) {
    removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
    finishMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

/**
 * 结束对局并广播 game:match:ended。
 *
 * winnerId 对应玩家为 won，其余玩家为 lost；
 * 平局（winnerId === null，仅超时平分）所有玩家均为 lost，客户端应以
 * `winnerId === null` 判断平局，而不是以单个玩家 status 判断。
 */
function finishMatch(
  match: MatchState,
  reason: GameEndReason,
  winnerId: number | null,
  now: number,
): void {
  if (match.status === 'finished') return
  match.status = 'finished'
  match.reason = reason
  match.winnerId = winnerId
  match.endedAt = now
  match.version += 1
  for (const player of match.players) {
    if (winnerId === null) player.status = 'lost'
    else player.status = player.userId === winnerId ? 'won' : 'lost'
  }
  broadcastMatch(match, 'game:match:ended')
}

/** 在指定玩家集合中按分数选最高者；最高分并列时返回 null（平局） */
function highestScoreWinner(players: PlayerState[]): number | null {
  if (players.length === 0) return null
  let winner = players[0]
  let tie = false
  for (const player of players.slice(1)) {
    if (player.score > winner.score) {
      winner = player
      tie = false
    } else if (player.score === winner.score) {
      tie = true
    }
  }
  return tie ? null : winner.userId
}

/** 超时结算：优先在仍存活的玩家中比较分数；全部出局时比较所有玩家分数 */
function finishByTimeout(match: MatchState, now: number): void {
  const alive = match.players.filter((player) => player.status === 'playing')
  const candidates = alive.length > 0 ? alive : match.players
  finishMatch(match, 'timeout', highestScoreWinner(candidates), now)
}

/**
 * 淘汰一名玩家（无路可走 / 认输 / 掉线）：
 * - 仍有 2+ 人存活 → 对局继续，广播 update；
 * - 只剩 1 人存活 → 该玩家以 last_standing 获胜；
 * - 全部出局 → 按分数判定（elimination，平分则平局）。
 */
function eliminatePlayer(match: MatchState, player: PlayerState, now: number): void {
  if (player.status !== 'playing') return
  player.status = 'lost'
  const alive = match.players.filter((candidate) => candidate.status === 'playing')
  if (alive.length === 1) {
    finishMatch(match, 'last_standing', alive[0].userId, now)
    return
  }
  if (alive.length === 0) {
    finishMatch(match, 'elimination', highestScoreWinner(match.players), now)
    return
  }
  match.version += 1
  broadcastMatch(match, 'game:match:update')
}

// === 好友大厅 ===

/** GET /api/games/2048/friends */
export async function listGameFriends(userId: number): Promise<{ friends: GameFriendDto[] }> {
  const { friends } = await listFriends(userId)
  return {
    friends: friends.map((friend) => ({
      id: friend.id,
      username: friend.username,
      online: isGameUserAvailable(friend.id),
      inMatch: activeMatchFor(friend.id) !== null,
    })),
  }
}

// === 邀请 ===

/** GET /api/games/2048/invites */
export function listGameInvites(userId: number, now: number = Date.now()): GameInvitesDto {
  return collectInvites(userId, now)
}

/**
 * POST /api/games/2048/invites
 *
 * 邀请加入自己的等待房间；没有房间时自动创建（inviter 为房主）。
 * 一个房间可以同时向多名好友发出邀请（上限 10 人），同一好友重复邀请幂等。
 */
export async function createGameInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: GameInviteDto; match: GameMatchDto }> {
  if (friendId === userId) throw new AppError('不能邀请自己', 400)
  if (!(await areFriends(userId, friendId))) throw new AppError('只能邀请好友进行对战', 403)

  pruneExpiredInvites(now)

  const current = activeMatchFor(userId)
  if (current && current.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId)) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let incomingCount = 0
  for (const invite of invites.values()) {
    if (invite.to.id === friendId) incomingCount += 1
  }
  if (incomingCount >= GAME_MAX_INCOMING_INVITES) {
    throw new AppError('对方的待处理邀请过多，请稍后再试', 409)
  }

  const [from, to] = await Promise.all([getUserBrief(userId), getUserBrief(friendId)])

  // 异步查询期间可能已有并发请求写入邀请/房间；落库前再检查一次
  const currentAfter = activeMatchFor(userId)
  if (currentAfter && currentAfter.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId)) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let room = currentAfter ?? waitingRoomFor(userId)
  if (!room) {
    room = createWaitingRoom({ id: from.id, username: from.username }, now)
  }
  if (room.status !== 'waiting') throw new AppError('房间已经开始，无法继续邀请', 409)
  if (room.players.length >= GAME_MAX_PLAYERS) throw new AppError('房间已满（最多 10 人）', 409)

  // 同一好友重复邀请：幂等返回已有邀请与房间
  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room) }
    }
  }

  // 对方已经先邀请了自己 → 先处理对方邀请
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  const invite: InviteState = {
    id: nextInviteId++,
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + GAME_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room) }
}

/**
 * POST /api/games/2048/invites/:id/respond
 *
 * 接受邀请 = 加入邀请对应的等待房间（不会立刻开局；由房主统一开始）。
 */
export function respondGameInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameMatchDto } {
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

  // === 接受邀请：加入等待房间 ===
  const room = matches.get(invite.matchId)
  if (!room || room.status !== 'waiting') {
    removeInvite(invite, 'cancelled')
    throw new AppError('房间已开始或已解散', 409)
  }
  if (activeMatchFor(userId)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('你已在另一场对局或房间中', 409)
  }
  if (!isParticipant(room, invite.from.id)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('邀请已失效', 409)
  }
  if (room.players.length >= GAME_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError('房间已满（最多 10 人）', 409)
  }
  if (countActiveMatches() >= GAME_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 只清理「接受者」相关的其它邀请，保留房主邀请其他好友的邀请
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= GAME_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room) }
}

/** DELETE /api/games/2048/invites/:id */
export function cancelGameInvite(
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

/**
 * GET /api/games/2048/sync
 *
 * - 不带 matchId：match = 当前进行中的对局，没有则为 null；
 * - 带 matchId：返回指定对局（含结束 5 分钟内），不存在或非参与者 404。
 * 该端点不更新 presence。
 */
export function getGameSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): GameSyncDto {
  pruneExpiredInvites(now)
  const invitesDto = collectInvites(userId, now)

  let match: MatchState | null
  if (matchId === undefined) {
    match = activeMatchFor(userId)
    if (match !== null && now >= match.endsAt) {
      if (match.status === 'waiting') {
        removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
        finishMatch(match, 'cancelled', null, now)
      } else {
        finishByTimeout(match, now)
      }
      match = null
    }
  } else {
    const found = matches.get(matchId)
    if (!found || !isParticipant(found, userId)) throw new AppError('对局不存在', 404)
    if (found.status === 'waiting' && now >= found.endsAt) {
      removeInvitesForUsers(found.players.map((player) => player.userId), 'cancelled')
      finishMatch(found, 'cancelled', null, now)
    } else if (found.status === 'playing' && now >= found.endsAt) {
      finishByTimeout(found, now)
    }
    match = found
  }

  return {
    serverTime: iso(now),
    invites: invitesDto,
    match: match === null ? null : toMatchDto(match),
  }
}

/** GET /api/games/2048/matches/active —— 当前等待房间/进行中对局或 null */
export function getActiveGameMatch(userId: number, now: number = Date.now()): GameMatchDto | null {
  const match = activeMatchFor(userId)
  if (match === null) return null
  // sweeper 有 15 秒间隔：读取时先结算已超时/已过期的房间，避免大厅继续跳回旧房间
  if (now >= match.endsAt) {
    if (match.status === 'waiting') {
      removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
      finishMatch(match, 'cancelled', null, now)
    } else {
      finishByTimeout(match, now)
    }
    return null
  }
  return toMatchDto(match)
}

/** GET /api/games/2048/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getGameMatch(userId: number, matchId: number, now: number = Date.now()): GameMatchDto {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status === 'waiting' && now >= match.endsAt) {
    removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
    finishMatch(match, 'cancelled', null, now)
  } else if (match.status === 'playing' && now >= match.endsAt) {
    finishByTimeout(match, now)
  }
  return toMatchDto(match)
}

// === 对局操作 ===

/** POST /api/games/2048/matches/:id/moves —— 服务端权威移动 */
export function applyGameMove(
  userId: number,
  matchId: number,
  direction: Game2048Direction,
  now: number = Date.now(),
): { match: GameMatchDto; moved: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局已结束', 409)

  // 已超时但 sweeper 尚未结算：先结算再拒绝本次移动
  if (now >= match.endsAt) {
    finishByTimeout(match, now)
    throw new AppError('对局已结束', 409)
  }

  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player || player.status !== 'playing') throw new AppError('你已出局或对局未开始', 409)
  if (!player.random) throw new AppError('对局尚未开始', 409)

  const result = applyMove(player.board, direction, player.random)
  if (!result.moved) {
    // 无效移动：不递增版本、不广播
    return { match: toMatchDto(match), moved: false }
  }

  player.board = result.board
  player.score += result.scoreGained
  player.moves += 1
  player.maxTile = maxTileValue(result.board)
  match.version += 1

  if (player.maxTile >= GAME2048_TARGET) {
    // 先合成 2048 者获胜
    finishMatch(match, 'target', player.userId, now)
  } else if (!hasAvailableMoves(player.board)) {
    // 无合法移动：该玩家淘汰，其他人继续竞速
    eliminatePlayer(match, player, now)
  } else {
    broadcastMatch(match, 'game:match:update')
  }

  return { match: toMatchDto(match), moved: true }
}

/** POST /api/games/2048/matches/:id/resign —— 认输：该玩家淘汰，其他人继续 */
export function resignGameMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局已结束', 409)

  if (now >= match.endsAt) {
    finishByTimeout(match, now)
    throw new AppError('对局已结束', 409)
  }

  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player || player.status !== 'playing') throw new AppError('你已出局', 409)
  eliminatePlayer(match, player, now)
  return { match: toMatchDto(match) }
}

// === 定时清理（sweeper） ===

/**
 * 执行一轮清理与结算（每 15 秒由 startGameSweeper 调用；导出便于单测/手动触发）：
 *   1. 清理过期邀请（广播 expired）；
 *   2. 清理过期 presence；
 *   3. 对进行中的对局：超时结算 → 掉线判负（连续不可用 120 秒且对手可用）；
 *   4. 回收结束超过 5 分钟的对局。
 */
export function runGameSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    if (match.status === 'waiting') {
      if (now >= match.endsAt) {
        removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
        finishMatch(match, 'cancelled', null, now)
      }
      continue
    }
    if (match.status !== 'playing') continue

    if (now >= match.endsAt) {
      finishByTimeout(match, now)
      continue
    }

    for (const player of match.players) {
      if (player.status !== 'playing') continue
      if (isGameUserAvailable(player.userId)) {
        player.lastAvailableAt = now
        continue
      }
      if (now - player.lastAvailableAt < GAME_DISCONNECT_FORFEIT_MS) continue

      // 至少还有一名其他存活玩家可用时才淘汰掉线者；全员掉线等超时
      const othersAvailable = match.players.some(
        (candidate) =>
          candidate.userId !== player.userId
          && candidate.status === 'playing'
          && isGameUserAvailable(candidate.userId),
      )
      if (!othersAvailable) continue

      eliminatePlayer(match, player, now)
      break
    }
  }

  // 回收已结束的对局（保留期 5 分钟）
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= GAME_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

let sweeperTimer: ReturnType<typeof setInterval> | null = null

/** 启动游戏 sweeper（在 initChatHub 之后调用；定时器 unref，不阻止进程退出） */
export function startGameSweeper(): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runGameSweeper(), GAME_SWEEPER_INTERVAL_MS)
  sweeperTimer.unref()
  console.log(`✦ Game sweeper started (interval: ${GAME_SWEEPER_INTERVAL_MS}ms)`)
}
