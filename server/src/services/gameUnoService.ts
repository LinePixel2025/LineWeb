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
  UNO_MAX_PLAYERS,
  UNO_MIN_PLAYERS,
  createUnoTable,
  drawUnoTurn,
  eliminateUnoPlayer,
  passUnoTurn,
  playUnoCard,
  suggestUnoMove,
  unoTopCard,
  type UnoCard,
  type UnoColor,
  type UnoTableState,
} from './gameUno.js'

/**
 * UNO 好友联机业务逻辑（内存态，无 Prisma 表）—— 2–10 人经典 UNO
 *
 * 架构与五子棋 / 骗子酒馆联机一致：
 *   - 房间 / 邀请 / 牌桌全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：发牌、出牌、摸牌、功能牌结算全部由 gameUno 引擎完成
 *     （与单机前端共用同一份实现）；
 *   - 隐藏信息按观看者裁剪：myHand 只有自己的手牌，其他玩家只下发张数，
 *     牌堆只下发剩余张数；
 *   - 实时推送复用聊天 WebSocket（game:match:started|update|ended），
 *     无 WebSocket 时客户端用 `sync` 轮询 + `presence` 心跳降级；
 *   - 回合制：回合 60 秒，超时由 sweeper 自动托管（suggestUnoMove）；
 *   - 2–10 人对局：房主 = 座位 0 先手；
 *   - 结束口径：有人出完手牌（hand_empty）/ 认输或掉线后只剩一人（last_standing）/
 *     全局 30 分钟超时（timeout）/ 等待房间解散（cancelled）。
 *
 * 跨游戏互斥：通过 registerGameModule 注册 isUserInMatch 探针与 sweep 钩子，
 * 其他游戏侧发起或接受邀请时会检查这里；本模块反过来检查它们。
 */

// === 时效与容量参数 ===

export const UNO_INVITE_TTL_MS = GAME_INVITE_TTL_MS
export const UNO_DEFAULT_DURATION_MS = 30 * 60_000
/** 单个回合时长：60 秒（超时自动托管） */
export const UNO_TURN_MS = 60_000
export const UNO_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
export const UNO_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
export const UNO_DISCONNECT_FORFEIT_MS = GAME_DISCONNECT_FORFEIT_MS
export const UNO_MAX_ACTIVE_MATCHES = 200
export const UNO_MAX_INCOMING_INVITES = 5

// === DTO（与前端 client/src/types/game.ts 对齐，时间为 ISO 字符串） ===

export type GameUnoMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameUnoPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameUnoEndReason = 'hand_empty' | 'last_standing' | 'timeout' | 'cancelled'

export interface UnoUserBriefDto {
  id: number
  username: string
}

export interface UnoInviteDto {
  id: number
  matchId: number
  game: 'uno'
  from: UnoUserBriefDto
  to: UnoUserBriefDto
  createdAt: string
  expiresAt: string
}

export interface UnoCardDto {
  id: number
  color: UnoColor | 'wild'
  kind: UnoCard['kind']
  number: number | null
}

export interface UnoTurnDto {
  userId: number
  deadline: string
}

/** 最近一次公开动作（用于播报；摸牌不下发具体牌面） */
export type UnoLatelyDto =
  | { type: 'play'; userId: number; card: UnoCardDto; color: UnoColor }
  | { type: 'draw'; userId: number; count: number }
  | { type: 'pass'; userId: number }

export interface GameUnoPlayerDto {
  userId: number
  username: string
  online: boolean
  status: GameUnoPlayerStatus
  /** 当前手牌张数（牌面不下发） */
  handCount: number
  /** 累计出牌张数 */
  plays: number
}

export interface GameUnoMatchDto {
  id: number
  game: 'uno'
  hostId: number
  status: GameUnoMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameUnoEndReason | null
  /** 当前生效颜色（等待房间为 null） */
  currentColor: UnoColor | null
  /** 1 = 座位递增，-1 = 座位递减 */
  direction: 1 | -1
  /** 当前弃牌堆顶（等待房间为 null） */
  topCard: UnoCardDto | null
  deckCount: number
  discardCount: number
  /** 当前回合玩家摸到、尚可打出的牌 id（仅该玩家可出；其他玩家没有手牌也打不出） */
  drawnCardId: number | null
  turn: UnoTurnDto | null
  lastAction: UnoLatelyDto | null
  /** 观看者自己的手牌（他人查看 / 等待房间为 []） */
  myHand: UnoCardDto[]
  players: GameUnoPlayerDto[]
}

export interface UnoFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface UnoInvitesDto {
  incoming: UnoInviteDto[]
  outgoing: UnoInviteDto[]
}

export interface UnoSyncDto {
  serverTime: string
  invites: UnoInvitesDto
  match: GameUnoMatchDto | null
}

export type UnoAction =
  | { type: 'play'; cardId: number; color?: UnoColor }
  | { type: 'draw' }
  | { type: 'pass' }

// === 内部状态 ===

interface UnoPlayerState {
  userId: number
  username: string
  lastAvailableAt: number
}

interface UnoMatchState {
  id: number
  hostId: number
  status: GameUnoMatchStatus
  version: number
  startedAt: number
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameUnoEndReason | null
  players: UnoPlayerState[]
  table: UnoTableState | null
  turnDeadline: number
  lastAction: UnoLatelyDto | null
}

interface UnoInviteState {
  id: number
  matchId: number
  from: UnoUserBriefDto
  to: UnoUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, UnoInviteState>()
const matches = new Map<number, UnoMatchState>()
let nextMatchId = 1
let sweeperTimer: ReturnType<typeof setInterval> | null = null

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function matchFinished(match: UnoMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: UnoMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function seatOf(match: UnoMatchState, userId: number): number {
  return match.players.findIndex((player) => player.userId === userId)
}

/** 当前用户所在的房间/对局（等待或进行中；UNO 玩家没有逐人出局状态，对局结束即全员释放） */
function activeMatchFor(userId: number): UnoMatchState | null {
  for (const match of matches.values()) {
    if (match.status !== 'finished' && isParticipant(match, userId)) return match
  }
  return null
}

function waitingRoomFor(userId: number): UnoMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

function isBusyInOtherGames(userId: number): boolean {
  return isUserBusyInOtherGames(userId, 'uno')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

function toCardDto(card: UnoCard): UnoCardDto {
  return { id: card.id, color: card.color, kind: card.kind, number: card.number }
}

function toInviteDto(invite: UnoInviteState): UnoInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'uno',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

function playerStatusOf(match: UnoMatchState, seat: number): GameUnoPlayerStatus {
  if (match.status === 'waiting' || match.table === null) return 'waiting'
  if (match.table.status === 'finished') {
    return match.table.winnerSeat === seat ? 'won' : 'lost'
  }
  return match.table.players[seat]?.alive ? 'playing' : 'lost'
}

/** 从公开日志里取最近一条可展示动作（内联在 toMatchDto 中，避免重复扫描） */

/** 对局 DTO：隐藏信息按观看者裁剪（myHand / 牌堆牌面） */
function toMatchDto(match: UnoMatchState, viewerId: number): GameUnoMatchDto {
  const table = match.table
  const viewerSeat = seatOf(match, viewerId)
  const lastPlay = (() => {
    if (!table) return null
    for (let i = table.log.length - 1; i >= 0; i -= 1) {
      const entry = table.log[i]
      if (entry.type === 'play') {
        return {
          type: 'play' as const,
          userId: match.players[entry.seat]?.userId ?? 0,
          card: toCardDto(entry.card),
          color: entry.color,
        }
      }
      if (entry.type === 'draw') {
        return { type: 'draw' as const, userId: match.players[entry.seat]?.userId ?? 0, count: entry.count }
      }
      if (entry.type === 'pass') {
        return { type: 'pass' as const, userId: match.players[entry.seat]?.userId ?? 0 }
      }
    }
    return null
  })()
  return {
    id: match.id,
    game: 'uno',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    currentColor: table?.currentColor ?? null,
    direction: table?.direction ?? 1,
    topCard: table && table.discard.length > 0 ? toCardDto(unoTopCard(table)) : null,
    deckCount: table?.deck.length ?? 0,
    discardCount: table?.discard.length ?? 0,
    // 摸到的牌 id 只下发给当前回合玩家（牌 id 可反推牌面，不能泄露给其他人）
    drawnCardId:
      table !== null && viewerSeat >= 0 && table.turnSeat === viewerSeat ? table.drawnCardId : null,
    turn:
      match.status === 'playing' && table !== null && table.turnSeat !== null && table.status !== 'finished'
        ? { userId: match.players[table.turnSeat]?.userId ?? 0, deadline: iso(match.turnDeadline) }
        : null,
    lastAction: lastPlay,
    myHand: table !== null && viewerSeat >= 0 ? (table.players[viewerSeat]?.hand ?? []).map(toCardDto) : [],
    players: match.players.map((player, seat) => ({
      userId: player.userId,
      username: player.username,
      online: isGameUserAvailable(player.userId),
      status: playerStatusOf(match, seat),
      handCount: table?.players[seat]?.hand.length ?? 0,
      plays: table?.players[seat]?.plays ?? 0,
    })),
  }
}

// === 事件推送 ===

function broadcastMatch(match: UnoMatchState, type: MatchEventType): void {
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: toMatchDto(match, player.userId) })
  }
}

function emitInviteToTarget(invite: UnoInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

function emitInviteRemoved(invite: UnoInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: UnoInviteState, reason: GameInviteRemovalReason): void {
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

function sortInvites(list: UnoInviteDto[]): UnoInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): UnoInvitesDto {
  const incoming: UnoInviteDto[] = []
  const outgoing: UnoInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createUnoWaitingPlayer(user: UnoUserBriefDto, now: number): UnoPlayerState {
  return { userId: user.id, username: user.username, lastAvailableAt: now }
}

function createWaitingRoom(host: UnoUserBriefDto, now: number): UnoMatchState {
  const match: UnoMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    startedAt: now,
    endsAt: now + UNO_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    players: [createUnoWaitingPlayer(host, now)],
    table: null,
    turnDeadline: 0,
    lastAction: null,
  }
  matches.set(match.id, match)
  return match
}

function finishUnoMatch(
  match: UnoMatchState,
  reason: GameUnoEndReason,
  winnerId: number | null,
  now: number,
): void {
  if (match.status === 'finished') return
  match.status = 'finished'
  match.reason = reason
  match.winnerId = winnerId
  match.endedAt = now
  match.version += 1
  broadcastMatch(match, 'game:match:ended')
}

/**
 * 牌桌打完（有人出完 / 只剩一人）后收口：把牌桌结果同步成对局结果并广播。
 */
function finishUnoMatchByTable(match: UnoMatchState, now: number): void {
  const table = match.table
  if (!table || table.status !== 'finished') return
  const winnerId = table.winnerSeat === null ? null : (match.players[table.winnerSeat]?.userId ?? null)
  finishUnoMatch(match, table.endReason === 'last_standing' ? 'last_standing' : 'hand_empty', winnerId, now)
}

function applyEngineAction(
  match: UnoMatchState,
  seat: number,
  action: UnoAction,
): void {
  const table = match.table
  if (!table || table.status === 'finished') throw new AppError('对局未开始或已结束', 409)
  try {
    match.table =
      action.type === 'play'
        ? playUnoCard(table, seat, action.cardId, action.color)
        : action.type === 'draw'
          ? drawUnoTurn(table, seat)
          : passUnoTurn(table, seat)
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : '无效操作', 400)
  }
}

/**
 * 执行一次牌桌动作（玩家请求与超时托管共用）：动作 → 版本推进 →
 * 终局收口或广播 update。
 */
function performUnoAction(
  match: UnoMatchState,
  seat: number,
  action: UnoAction,
  now: number,
): void {
  applyEngineAction(match, seat, action)
  match.version += 1
  if (match.table?.status === 'finished') {
    finishUnoMatchByTable(match, now)
    return
  }
  match.turnDeadline = now + UNO_TURN_MS
  broadcastMatch(match, 'game:match:update')
}

/**
 * 结算一次回合超时：当前回合玩家自动托管（suggestUnoMove）。
 * 如果摸到的牌可出，会紧接着自动打出或跳过，避免同一个玩家卡住两个 60 秒。
 */
function chargeUnoTurnTimeout(match: UnoMatchState, now: number): 'acted' | 'noop' {
  const table = match.table
  if (!table || table.status === 'finished' || table.turnSeat === null) return 'noop'
  const seat = table.turnSeat
  const tablePlayer = table.players[seat]
  if (!tablePlayer || !tablePlayer.alive) return 'noop'
  const top = table.discard[table.discard.length - 1]
  if (!top) return 'noop'
  const nextSeat = (() => {
    for (let offset = 1; offset <= table.players.length; offset += 1) {
      const candidate = ((seat + offset * table.direction) % table.players.length + table.players.length) % table.players.length
      if (table.players[candidate]?.alive) return candidate
    }
    return seat
  })()
  const first = suggestUnoMove({
    hand: tablePlayer.hand,
    top,
    currentColor: table.currentColor,
    drawnCardId: table.drawnCardId,
    nextHandCount: table.players[nextSeat]?.hand.length ?? 5,
  })
  try {
    performUnoAction(
      match,
      seat,
      first.action === 'play'
        ? { type: 'play', cardId: first.cardId, color: first.color }
        : { type: first.action },
      now,
    )
  } catch {
    return 'noop'
  }
  // 摸牌后仍轮到同一玩家：再托管一次（能出就出，不能出就跳过）
  if (
    match.status === 'playing'
    && match.table
    && match.table.status !== 'finished'
    && match.table.turnSeat === seat
    && match.table.drawnCardId !== null
  ) {
    const current = match.table
    const playerAgain = current.players[seat]
    const topAgain = current.discard[current.discard.length - 1]
    if (playerAgain && topAgain) {
      const second = suggestUnoMove({
        hand: playerAgain.hand,
        top: topAgain,
        currentColor: current.currentColor,
        drawnCardId: current.drawnCardId,
        nextHandCount: current.players[nextSeat]?.hand.length ?? 5,
      })
      try {
        performUnoAction(
          match,
          seat,
          second.action === 'play'
            ? { type: 'play', cardId: second.cardId, color: second.color }
            : { type: second.action },
          now,
        )
      } catch {
        return 'noop'
      }
    }
  }
  return 'acted'
}

/**
 * 把一个对局结算到 now 时刻的一致状态：
 *   1. 等待房间超过 30 分钟未开局 → cancelled 解散；
 *   2. 全局超时（now >= endsAt）→ timeout；
 *   3. 掉线超过 120 秒且其他存活玩家在线 → 该玩家出局；
 *   4. 回合超时 → 自动托管（循环处理连续多回合）。
 */
function settleUnoMatch(match: UnoMatchState, now: number): void {
  if (match.status === 'waiting') {
    if (now >= match.endsAt) {
      removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
      finishUnoMatch(match, 'cancelled', null, now)
    }
    return
  }
  if (match.status !== 'playing') return

  if (now >= match.endsAt) {
    finishUnoMatch(match, 'timeout', null, now)
    return
  }

  for (const player of match.players) {
    if (isGameUserAvailable(player.userId)) player.lastAvailableAt = now
  }
  const table = match.table
  if (table !== null && table.status !== 'finished') {
    for (const seat of table.players.map((player) => player.seat)) {
      if (match.status !== 'playing' || match.table === null || match.table.status === 'finished') break
      const tablePlayer = match.table.players[seat]
      if (!tablePlayer || !tablePlayer.alive) continue
      const player = match.players[seat]
      if (!player) continue
      if (now - player.lastAvailableAt < UNO_DISCONNECT_FORFEIT_MS) continue
      const othersAvailable = match.players.some(
        (candidate, otherSeat) =>
          otherSeat !== seat
          && match.table?.players[otherSeat]?.alive
          && isGameUserAvailable(candidate.userId),
      )
      if (!othersAvailable) continue
      try {
        match.table = eliminateUnoPlayer(match.table, seat)
      } catch {
        continue
      }
      match.version += 1
      if (match.table.status === 'finished') {
        finishUnoMatchByTable(match, now)
        return
      }
      match.turnDeadline = now + UNO_TURN_MS
      broadcastMatch(match, 'game:match:update')
    }
  }

  let guard = 0
  while (
    match.status === 'playing'
    && match.table !== null
    && match.table.status !== 'finished'
    && match.table.turnSeat !== null
    && now >= match.turnDeadline
    && guard <= UNO_MAX_PLAYERS * 2
  ) {
    guard += 1
    const outcome = chargeUnoTurnTimeout(match, now)
    if (outcome === 'noop' || matchFinished(match)) break
  }
}

// === 对外 API ===

/** 房主开始游戏：2–10 人，立即发牌（座位 0 = 房主先手） */
export function startUnoMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameUnoMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < UNO_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${UNO_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > UNO_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${UNO_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= UNO_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  match.table = createUnoTable(match.players.length)
  match.status = 'playing'
  match.startedAt = now
  match.endsAt = now + UNO_DEFAULT_DURATION_MS
  match.turnDeadline = now + UNO_TURN_MS
  match.version += 1
  match.players.forEach((player) => {
    player.lastAvailableAt = now
  })
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match, userId) }
}

/** 离开等待房间：房主离开 = 解散房间；普通玩家离开 = 从房间移除 */
export function leaveUnoMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { ok: true; dissolved: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') {
    if (match.status === 'playing') {
      throw new AppError('对局进行中，请先认输再退出房间', 409)
    }
    removeInvitesForUsers([userId], 'cancelled')
    return { ok: true, dissolved: false }
  }

  removeInvitesForUsers([userId], 'cancelled')
  if (match.hostId === userId) {
    removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
    finishUnoMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishUnoMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

export async function listUnoFriends(userId: number): Promise<{ friends: UnoFriendDto[] }> {
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

export function listUnoInvites(userId: number, now: number = Date.now()): UnoInvitesDto {
  return collectInvites(userId, now)
}

export async function createUnoInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: UnoInviteDto; match: GameUnoMatchDto }> {
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
  if (incomingCount >= UNO_MAX_INCOMING_INVITES) {
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
  if (room.players.length >= UNO_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${UNO_MAX_PLAYERS} 人）`, 409)
  }

  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room, userId) }
    }
  }
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  const invite: UnoInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + UNO_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room, userId) }
}

export function respondUnoInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameUnoMatchDto } {
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
  if (room.players.length >= UNO_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${UNO_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= UNO_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createUnoWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= UNO_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room, userId) }
}

export function cancelUnoInvite(
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

export function getUnoSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): UnoSyncDto {
  runUnoSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: UnoMatchState | null
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
    match: match === null ? null : toMatchDto(match, userId),
  }
}

export function getActiveUnoMatch(userId: number, now: number = Date.now()): GameUnoMatchDto | null {
  runUnoSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match, userId)
}

export function getUnoMatch(userId: number, matchId: number, now: number = Date.now()): GameUnoMatchDto {
  runUnoSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match, userId)
}

/**
 * POST /api/games/uno/matches/:id/actions
 *
 * play：出牌（万能牌必须带 color，万能+4 受手牌限制）；draw：摸一张；
 * pass：摸牌后选择跳过。非回合 409，非法牌 400。
 */
export function applyUnoAction(
  userId: number,
  matchId: number,
  action: UnoAction,
  now: number = Date.now(),
): { match: GameUnoMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局未开始或已结束', 409)

  runUnoSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const tablePlayer = match.table?.players[seat]
  if (!tablePlayer || !tablePlayer.alive) throw new AppError('你已出局', 409)
  if (match.table?.turnSeat !== seat) throw new AppError('还没轮到你', 409)

  performUnoAction(match, seat, action, now)
  return { match: toMatchDto(match, userId) }
}

/** 认输：立即出局；只剩一人时终局 */
export function resignUnoMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameUnoMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局尚未开始或已结束', 409)

  runUnoSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const table = match.table
  const tablePlayer = table?.players[seat]
  if (!table || !tablePlayer || !tablePlayer.alive) throw new AppError('你已出局', 409)

  match.table = eliminateUnoPlayer(table, seat)
  match.version += 1
  if (match.table.status === 'finished') {
    finishUnoMatchByTable(match, now)
  } else {
    match.turnDeadline = now + UNO_TURN_MS
    broadcastMatch(match, 'game:match:update')
  }
  return { match: toMatchDto(match, userId) }
}

// === 定时清理（sweeper） ===

export function runUnoSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    settleUnoMatch(match, now)
  }

  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= UNO_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

export function startUnoTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runUnoSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ UNO 清理定时器已启动（间隔 ${intervalMs}ms）`)
}

function stopUnoTicker(): void {
  if (sweeperTimer !== null) {
    clearInterval(sweeperTimer)
    sweeperTimer = null
  }
}

// === 自检脚本 / 单测入口 ===

export function createUnoRoomForTest(
  hostId: number,
  hostName: string,
  memberIds: number[] = [],
  now: number = Date.now(),
): { matchId: number } {
  const room = createWaitingRoom({ id: hostId, username: hostName }, now)
  memberIds.forEach((memberId) => {
    room.players.push(createUnoWaitingPlayer({ id: memberId, username: `u${memberId}` }, now))
  })
  room.version += 1
  return { matchId: room.id }
}

export function createUnoInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: UnoInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + UNO_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

export function resetUnoStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopUnoTicker()
}

/** 强制清除该用户在 UNO 里的房间 / 对局状态（等待房间离开，进行中认输） */
export function resetUnoUser(userId: number): number {
  let cleared = 0
  for (const match of Array.from(matches.values())) {
    if (!isParticipant(match, userId)) continue
    if (match.status === 'waiting') {
      try {
        leaveUnoMatch(userId, match.id)
        cleared += 1
      } catch {
        // 已被 sweeper 结算 / 并发离开：忽略
      }
      continue
    }
    if (match.status === 'playing') {
      try {
        resignUnoMatch(userId, match.id)
        cleared += 1
      } catch {
        // 结算竞态：忽略
      }
      continue
    }
    cleared += 1
  }
  return cleared
}

registerGameModule({
  name: 'uno',
  isUserInMatch: (userId) => activeMatchFor(userId) !== null,
  sweep: runUnoSweeper,
  resetUser: resetUnoUser,
})
