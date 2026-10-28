import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { sendToUser } from './chatHub.js'
import { pruneGamePresence } from './gamePresence.js'
import { nextGameInviteId } from './gameIds.js'
import { resetUserInMatches } from './gameExit.js'
import {
  GAME_DISCONNECT_FORFEIT_MS,
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
  XIANGQI_BLACK,
  XIANGQI_CELLS,
  XIANGQI_RED,
  createXiangqiBoard,
  evaluateXiangqiStatus,
  isXiangqiInCheck,
  isXiangqiMoveLegal,
  makeXiangqiMove,
  suggestXiangqiMove,
  type XiangqiSide,
} from './gameXiangqi.js'

/**
 * 中国象棋好友联机业务逻辑（内存态，无 Prisma 表）—— 2 人轮流走子
 *
 * 架构与五子棋联机一致（回合制两人棋类）：
 *   - 房间 / 邀请 / 棋盘全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：客户端只提交 from / to 两个下标，合法性、将军、绝杀 / 困毙
 *     全部由 gameXiangqi 引擎判定（与单机前端共用同一份实现）；
 *   - 实时推送复用聊天 WebSocket（game:match:started|update|ended），
 *     无 WebSocket 时客户端用 `sync` 轮询 + `presence` 心跳降级；
 *   - 回合制：只有 `turn.userId` 指向的玩家可以走子，回合 60 秒，
 *     超时由 sweeper 自动托管走子（suggestXiangqiMove，lastMove.auto = true），
 *     不淘汰；掉线超过 120 秒且对方在线判负；
 *   - 恰好 2 人：房主 = 座位 0 执红先行，另一位执黑；
 *   - 结束口径：绝杀（checkmate）/ 困毙（stalemate）/ 认输（resign）/
 *     掉线判负（forfeit）/ 60 回合无吃子（draw）/ 全局 30 分钟（timeout）/
 *     等待房间解散（cancelled）。
 */

export const XIANGQI_INVITE_TTL_MS = GAME_INVITE_TTL_MS
export const XIANGQI_MIN_PLAYERS = 2
export const XIANGQI_MAX_PLAYERS = 2
export const XIANGQI_DEFAULT_DURATION_MS = 30 * 60_000
/** 单个回合时长：60 秒（超时自动托管走子，不淘汰） */
export const XIANGQI_TURN_MS = 60_000
/** 连续 120 个半回合（60 个完整回合）无吃子判和（中国象棋常用自然限着口径） */
export const XIANGQI_DRAW_HALF_MOVES = 120
export const XIANGQI_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
export const XIANGQI_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
export const XIANGQI_DISCONNECT_FORFEIT_MS = GAME_DISCONNECT_FORFEIT_MS
export const XIANGQI_MAX_ACTIVE_MATCHES = 200
export const XIANGQI_MAX_INCOMING_INVITES = 5

// === DTO ===

export type GameXiangqiMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameXiangqiPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameXiangqiEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'resign'
  | 'forfeit'
  | 'timeout'
  | 'draw'
  | 'cancelled'

export interface XiangqiUserBriefDto {
  id: number
  username: string
}

export interface XiangqiInviteDto {
  id: number
  matchId: number
  game: 'xiangqi'
  from: XiangqiUserBriefDto
  to: XiangqiUserBriefDto
  createdAt: string
  expiresAt: string
}

export interface XiangqiTurnDto {
  userId: number
  deadline: string
}

export interface XiangqiLastMoveDto {
  userId: number
  from: number
  to: number
  /** 被吃棋子（0 = 无） */
  captured: number
  /** 回合超时由服务端托管走出 */
  auto: boolean
}

export interface GameXiangqiPlayerDto {
  userId: number
  username: string
  online: boolean
  status: GameXiangqiPlayerStatus
  /** 座位 0（房主）执红、座位 1 执黑；等待房间为 null */
  side: 'red' | 'black' | null
  /** 已走子数 */
  moves: number
}

export interface GameXiangqiMatchDto {
  id: number
  game: 'xiangqi'
  hostId: number
  status: GameXiangqiMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameXiangqiEndReason | null
  /** 90 格棋盘（下标 = y*9+x；正数红、负数黑、0 空） */
  board: number[]
  turn: XiangqiTurnDto | null
  lastMove: XiangqiLastMoveDto | null
  /** 当前行棋方是否被将军 */
  checked: boolean
  /** 连续无吃子半回合数（达到 120 判和） */
  halfMoveClock: number
  players: GameXiangqiPlayerDto[]
}

export interface XiangqiFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface XiangqiInvitesDto {
  incoming: XiangqiInviteDto[]
  outgoing: XiangqiInviteDto[]
}

export interface XiangqiSyncDto {
  serverTime: string
  invites: XiangqiInvitesDto
  match: GameXiangqiMatchDto | null
}

export interface XiangqiAction {
  type: 'move'
  from: number
  to: number
}

// === 内部状态 ===

interface XiangqiPlayerState {
  userId: number
  username: string
  status: GameXiangqiPlayerStatus
  side: XiangqiSide | null
  moves: number
  lastAvailableAt: number
}

interface XiangqiMatchState {
  id: number
  hostId: number
  status: GameXiangqiMatchStatus
  version: number
  startedAt: number
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameXiangqiEndReason | null
  durationMs: number
  players: XiangqiPlayerState[]
  board: number[]
  turnUserId: number | null
  turnDeadline: number
  lastMove: XiangqiLastMoveDto | null
  halfMoveClock: number
}

interface XiangqiInviteState {
  id: number
  matchId: number
  from: XiangqiUserBriefDto
  to: XiangqiUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, XiangqiInviteState>()
const matches = new Map<number, XiangqiMatchState>()
let nextMatchId = 1
let sweeperTimer: ReturnType<typeof setInterval> | null = null

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function matchFinished(match: XiangqiMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: XiangqiMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function seatOf(match: XiangqiMatchState, userId: number): number {
  return match.players.findIndex((player) => player.userId === userId)
}

function activeMatchFor(userId: number): XiangqiMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'finished') continue
    const me = match.players.find((player) => player.userId === userId)
    if (me && (match.status === 'waiting' || me.status === 'playing')) return match
  }
  return null
}

function waitingRoomFor(userId: number): XiangqiMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

function isBusyInOtherGames(userId: number): boolean {
  return isUserBusyInOtherGames(userId, 'xiangqi')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

function toInviteDto(invite: XiangqiInviteState): XiangqiInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'xiangqi',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

function sideOfSeat(seat: number): 'red' | 'black' {
  return seat === 0 ? 'red' : 'black'
}

function toMatchDto(match: XiangqiMatchState): GameXiangqiMatchDto {
  const turnSide = match.turnUserId === null
    ? null
    : match.players.find((player) => player.userId === match.turnUserId)?.side ?? null
  return {
    id: match.id,
    game: 'xiangqi',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    board: [...match.board],
    turn:
      match.status === 'playing' && match.turnUserId !== null
        ? { userId: match.turnUserId, deadline: iso(match.turnDeadline) }
        : null,
    lastMove: match.lastMove === null ? null : { ...match.lastMove },
    checked: turnSide !== null && match.status === 'playing' ? isXiangqiInCheck(match.board, turnSide) : false,
    halfMoveClock: match.halfMoveClock,
    players: match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      online: isGameUserAvailable(player.userId),
      status: player.status,
      side: player.side === null ? null : player.side === XIANGQI_RED ? 'red' : 'black',
      moves: player.moves,
    })),
  }
}

// === 事件推送 ===

function broadcastMatch(match: XiangqiMatchState, type: MatchEventType): void {
  const dto = toMatchDto(match)
  for (const player of match.players) sendToUser(player.userId, { type, match: dto })
}

function emitInviteToTarget(invite: XiangqiInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

function emitInviteRemoved(invite: XiangqiInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) sendToUser(userId, event)
}

function removeInvite(invite: XiangqiInviteState, reason: GameInviteRemovalReason): void {
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

function sortInvites(list: XiangqiInviteDto[]): XiangqiInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): XiangqiInvitesDto {
  const incoming: XiangqiInviteDto[] = []
  const outgoing: XiangqiInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createXiangqiWaitingPlayer(user: XiangqiUserBriefDto, now: number): XiangqiPlayerState {
  return {
    userId: user.id,
    username: user.username,
    status: 'waiting',
    side: null,
    moves: 0,
    lastAvailableAt: now,
  }
}

function createWaitingRoom(host: XiangqiUserBriefDto, now: number): XiangqiMatchState {
  const match: XiangqiMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    startedAt: now,
    endsAt: now + XIANGQI_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    durationMs: XIANGQI_DEFAULT_DURATION_MS,
    players: [createXiangqiWaitingPlayer(host, now)],
    board: [],
    turnUserId: null,
    turnDeadline: 0,
    lastMove: null,
    halfMoveClock: 0,
  }
  matches.set(match.id, match)
  return match
}

function finishXiangqiMatch(
  match: XiangqiMatchState,
  reason: GameXiangqiEndReason,
  winnerId: number | null,
  now: number,
): void {
  if (match.status === 'finished') return
  match.status = 'finished'
  match.reason = reason
  match.winnerId = winnerId
  match.endedAt = now
  match.version += 1
  match.turnUserId = null
  for (const player of match.players) {
    player.status = winnerId === null ? 'lost' : player.userId === winnerId ? 'won' : 'lost'
  }
  broadcastMatch(match, 'game:match:ended')
}

function teammateOf(match: XiangqiMatchState, userId: number): number | null {
  return match.players.find((player) => player.userId !== userId)?.userId ?? null
}

/** 检查走子后的局面：绝杀 / 困毙 / 自然限着和棋，并广播或终局 */
function settleAfterMove(match: XiangqiMatchState, now: number): void {
  if (match.status !== 'playing') return
  const nextTurnUserId = match.turnUserId
  const nextPlayer = match.players.find((player) => player.userId === nextTurnUserId)
  if (!nextPlayer || nextPlayer.side === null) {
    finishXiangqiMatch(match, 'timeout', null, now)
    return
  }
  const status = evaluateXiangqiStatus(match.board, nextPlayer.side)
  if (status.finished) {
    finishXiangqiMatch(
      match,
      status.reason === 'stalemate' ? 'stalemate' : 'checkmate',
      status.winner === XIANGQI_RED
        ? match.players[0]?.userId ?? null
        : match.players[1]?.userId ?? null,
      now,
    )
    return
  }
  if (match.halfMoveClock >= XIANGQI_DRAW_HALF_MOVES) {
    finishXiangqiMatch(match, 'draw', null, now)
    return
  }
  broadcastMatch(match, 'game:match:update')
}

/** 走一步（玩家请求与超时托管共用）；调用方已完成回合 / 身份校验 */
function performMove(
  match: XiangqiMatchState,
  userId: number,
  from: number,
  to: number,
  auto: boolean,
  now: number,
  nextDeadline: number,
): void {
  const seat = seatOf(match, userId)
  const player = match.players[seat]
  const side = player.side ?? XIANGQI_RED
  const captured = makeXiangqiMove(match.board, from, to)
  if (captured === null) throw new AppError('无效的走子', 400)
  player.moves += 1
  match.lastMove = { userId, from, to, captured, auto }
  match.halfMoveClock = captured === 0 ? match.halfMoveClock + 1 : 0
  match.version += 1
  const opponentSeat = seat === 0 ? 1 : 0
  match.turnUserId = match.players[opponentSeat]?.userId ?? null
  match.turnDeadline = nextDeadline
  settleAfterMove(match, now)
}

/**
 * 把一个对局结算到 now 时刻的一致状态：
 *   1. 等待房间超过 30 分钟 → cancelled；
 *   2. 全局超时 → timeout；
 *   3. 掉线超过 120 秒且对方在线 → forfeit；
 *   4. 回合超时 → 自动托管走子（循环处理连续超时）。
 */
function settleXiangqiMatch(match: XiangqiMatchState, now: number): void {
  if (match.status === 'waiting') {
    if (now >= match.endsAt) {
      removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
      finishXiangqiMatch(match, 'cancelled', null, now)
    }
    return
  }
  if (match.status !== 'playing') return

  if (now >= match.endsAt) {
    finishXiangqiMatch(match, 'timeout', null, now)
    return
  }

  for (const player of match.players) {
    if (player.status === 'playing' && isGameUserAvailable(player.userId)) player.lastAvailableAt = now
  }
  for (const player of match.players) {
    if (player.status !== 'playing') continue
    if (now - player.lastAvailableAt < XIANGQI_DISCONNECT_FORFEIT_MS) continue
    const other = match.players.find((candidate) => candidate.userId !== player.userId)
    if (!other || !isGameUserAvailable(other.userId)) continue
    finishXiangqiMatch(match, 'forfeit', other.userId, now)
    return
  }

  let guard = 0
  while (
    match.status === 'playing'
    && match.turnUserId !== null
    && now >= match.turnDeadline
    && guard <= XIANGQI_MAX_PLAYERS * 2
  ) {
    guard += 1
    const seat = seatOf(match, match.turnUserId)
    const player = seat < 0 ? null : match.players[seat]
    if (!player || player.status !== 'playing' || player.side === null) {
      match.turnUserId = null
      break
    }
    const move = suggestXiangqiMove(match.board, player.side, { depth: 2 })
    if (!move) {
      const status = evaluateXiangqiStatus(match.board, player.side)
      finishXiangqiMatch(
        match,
        status.reason === 'stalemate' ? 'stalemate' : 'checkmate',
        status.winner === XIANGQI_RED ? match.players[0]?.userId ?? null : match.players[1]?.userId ?? null,
        now,
      )
      break
    }
    const expiredDeadline = match.turnDeadline
    try {
      performMove(match, player.userId, move.from, move.to, true, now, expiredDeadline + XIANGQI_TURN_MS)
    } catch {
      break
    }
    if (matchFinished(match)) break
  }
}

// === 对外 API ===

export function startXiangqiMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameXiangqiMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < XIANGQI_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${XIANGQI_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > XIANGQI_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${XIANGQI_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= XIANGQI_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  match.board = createXiangqiBoard()
  match.lastMove = null
  match.halfMoveClock = 0
  match.status = 'playing'
  match.startedAt = now
  match.endsAt = now + match.durationMs
  match.version += 1
  match.players.forEach((player, seat) => {
    player.status = 'playing'
    player.side = seat === 0 ? XIANGQI_RED : XIANGQI_BLACK
    player.moves = 0
    player.lastAvailableAt = now
  })
  // 房主执红先行
  match.turnUserId = match.players[0].userId
  match.turnDeadline = now + XIANGQI_TURN_MS
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match) }
}

export function leaveXiangqiMatch(
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
    finishXiangqiMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishXiangqiMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

export async function listXiangqiFriends(userId: number): Promise<{ friends: XiangqiFriendDto[] }> {
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

export function listXiangqiInvites(userId: number, now: number = Date.now()): XiangqiInvitesDto {
  return collectInvites(userId, now)
}

export async function createXiangqiInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: XiangqiInviteDto; match: GameXiangqiMatchDto }> {
  if (friendId === userId) throw new AppError('不能邀请自己', 400)
  if (!(await areFriends(userId, friendId))) throw new AppError('只能邀请好友进行对战', 403)

  pruneExpiredInvites(now)

  const current = activeMatchFor(userId)
  if (current && current.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId) || isBusyInOtherGames(friendId)) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (isBusyInOtherGames(userId)) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let incomingCount = 0
  for (const invite of invites.values()) {
    if (invite.to.id === friendId) incomingCount += 1
  }
  if (incomingCount >= XIANGQI_MAX_INCOMING_INVITES) {
    throw new AppError('对方的待处理邀请过多，请稍后再试', 409)
  }

  const [from, to] = await Promise.all([getUserBrief(userId), getUserBrief(friendId)])

  const currentAfter = activeMatchFor(userId)
  if (currentAfter && currentAfter.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId) || isBusyInOtherGames(friendId)) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (isBusyInOtherGames(userId)) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let room = currentAfter ?? waitingRoomFor(userId)
  if (!room) room = createWaitingRoom({ id: from.id, username: from.username }, now)
  if (room.status !== 'waiting') throw new AppError('房间已经开始，无法继续邀请', 409)
  if (room.players.length >= XIANGQI_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${XIANGQI_MAX_PLAYERS} 人）`, 409)
  }

  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room) }
    }
  }
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  const invite: XiangqiInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + XIANGQI_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room) }
}

export function respondXiangqiInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameXiangqiMatchDto } {
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
  if (room.players.length >= XIANGQI_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${XIANGQI_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= XIANGQI_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createXiangqiWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= XIANGQI_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room) }
}

export function cancelXiangqiInvite(
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

export function getXiangqiSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): XiangqiSyncDto {
  runXiangqiSweeper(now)
  const invitesDto = collectInvites(userId, now)
  let match: XiangqiMatchState | null
  if (matchId === undefined) {
    match = activeMatchFor(userId)
  } else {
    const found = matches.get(matchId)
    if (!found || !isParticipant(found, userId)) throw new AppError('对局不存在', 404)
    match = found
  }
  return {
    serverTime: iso(now),
    invites: invitesDto,
    match: match === null ? null : toMatchDto(match),
  }
}

export function getActiveXiangqiMatch(userId: number, now: number = Date.now()): GameXiangqiMatchDto | null {
  runXiangqiSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match)
}

export function getXiangqiMatch(userId: number, matchId: number, now: number = Date.now()): GameXiangqiMatchDto {
  runXiangqiSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match)
}

/**
 * POST /api/games/xiangqi/matches/:id/actions —— 走子
 * 只有当前回合玩家可以操作；from / to 为 0–89 的一维下标。
 */
export function applyXiangqiAction(
  userId: number,
  matchId: number,
  action: XiangqiAction,
  now: number = Date.now(),
): { match: GameXiangqiMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局未开始或已结束', 409)

  runXiangqiSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const player = seat < 0 ? null : match.players[seat]
  if (!player || player.status !== 'playing' || player.side === null) throw new AppError('你已出局或对局未开始', 409)
  if (match.turnUserId !== userId) throw new AppError('还没轮到你', 409)
  if (action.type !== 'move') throw new AppError('不支持的操作类型', 400)
  if (
    !Number.isInteger(action.from) || !Number.isInteger(action.to)
    || action.from < 0 || action.from >= XIANGQI_CELLS
    || action.to < 0 || action.to >= XIANGQI_CELLS
  ) {
    throw new AppError('走子坐标无效', 400)
  }
  if (!isXiangqiMoveLegal(match.board, action.from, action.to, player.side)) {
    throw new AppError('这步棋不合法（可能送将或不符合走子规则）', 400)
  }

  performMove(match, userId, action.from, action.to, false, now, now + XIANGQI_TURN_MS)
  return { match: toMatchDto(match) }
}

/** 认输：对方获胜 */
export function resignXiangqiMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameXiangqiMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局尚未开始或已结束', 409)

  runXiangqiSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player || player.status !== 'playing') throw new AppError('你已出局', 409)
  finishXiangqiMatch(match, 'resign', teammateOf(match, userId), now)
  return { match: toMatchDto(match) }
}

// === 定时清理（sweeper） ===

export function runXiangqiSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)
  for (const match of matches.values()) settleXiangqiMatch(match, now)
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= XIANGQI_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

export function startXiangqiTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runXiangqiSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ 中国象棋清理定时器已启动（间隔 ${intervalMs}ms）`)
}

function stopXiangqiTicker(): void {
  if (sweeperTimer !== null) {
    clearInterval(sweeperTimer)
    sweeperTimer = null
  }
}

// === 自检脚本 / 单测入口 ===

export function createXiangqiRoomForTest(
  hostId: number,
  hostName: string,
  memberIds: number[] = [],
  now: number = Date.now(),
): { matchId: number } {
  const room = createWaitingRoom({ id: hostId, username: hostName }, now)
  memberIds.forEach((memberId) => {
    room.players.push(createXiangqiWaitingPlayer({ id: memberId, username: `u${memberId}` }, now))
  })
  room.version += 1
  return { matchId: room.id }
}

export function createXiangqiInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: XiangqiInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + XIANGQI_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

export function resetXiangqiStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopXiangqiTicker()
}

/** 强制清除该用户在中国象棋里的房间 / 对局状态（等待房间离开，进行中认输） */
export function resetXiangqiUser(userId: number): number {
  return resetUserInMatches(matches.values(), userId, {
    leave: (uid, id) => leaveXiangqiMatch(uid, id),
    resign: (uid, id) => resignXiangqiMatch(uid, id),
  })
}

registerGameModule({
  name: 'xiangqi',
  isUserInMatch: (userId) => activeMatchFor(userId) !== null,
  sweep: runXiangqiSweeper,
  resetUser: resetXiangqiUser,
})
