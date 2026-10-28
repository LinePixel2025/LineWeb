import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { isUserOnline, sendToUser } from './chatHub.js'
import { isGamePresent } from './gamePresence.js'
import { nextGameInviteId } from './gameIds.js'
import { resetUserInMatches } from './gameExit.js'
import { publishGameEnd } from './gameStatsHooks.js'
import { isUserBusyInOtherGames, registerGameModule } from './gameService.js'
import {
  canDoudizhuBeat,
  dealDoudizhu,
  parseDoudizhuCombo,
  sortDoudizhuCards,
  type DoudizhuCard,
  type DoudizhuCombo,
} from './gameDoudizhu.js'

/**
 * 斗地主好友联机业务逻辑（内存态，无 Prisma 表）
 *
 * 架构与 2048 联机（gameService.ts）一致：
 *   - 房间 / 邀请 / 牌局全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：客户端只提交叫分 / 出牌 / 不出，牌与胜负全部由服务端判定；
 *   - 实时推送复用聊天 WebSocket（game:match:started|update|ended），
 *     无 WebSocket 时客户端用 `sync` 轮询 + `presence` 心跳降级；
 *   - 与 2048 的关键差异：
 *     1) 房间固定 3 人，房主开始后进入叫分（0–3 分，3 分立即成交）再出牌；
 *     2) 手牌对其他玩家不可见 —— DTO 按观看者裁剪（myHand 只有自己的牌）；
 *     3) 回合制无总时长：超时 / 掉线由 sweeper 自动托管（应叫=不叫、
 *        出牌=出最小单张、跟牌=不出），全员离线 10 分钟才废弃对局；
 *     4) 计分：底分 100 × 倍率（炸弹 / 王炸 / 春天 ×2），地主赢 +2 份、输 -2 份。
 *
 * 跨游戏互斥：通过 registerGameModule 注册 isUserInMatch 探针 ——
 * 2048 侧发起 / 接受邀请时会检查斗地主对局，反之亦然（同时只能在一场对局中）。
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒（与 2048 一致） */
export const DOUDIZHU_INVITE_TTL_MS = 60_000
/** 房间固定人数 */
export const DOUDIZHU_PLAYERS = 3
/** 等待房间最长存活时间：30 分钟 */
export const DOUDIZHU_WAITING_ROOM_TTL_MS = 30 * 60_000
/** 已结束对局保留期：5 分钟（供客户端补拉最终结果） */
export const DOUDIZHU_FINISHED_RETENTION_MS = 5 * 60_000
/** 出牌 / 应叫回合时限：90 秒 */
export const DOUDIZHU_TURN_DEADLINE_MS = 90_000
/** 回合玩家离线时，超过该时长即自动托管：30 秒 */
export const DOUDIZHU_OFFLINE_TURN_MS = 30_000
/** 无人叫地主的最大发牌轮数（超过即流局解散） */
export const DOUDIZHU_MAX_BID_ROUNDS = 3
/** 全员连续不可用超过该时长废弃对局：10 分钟 */
export const DOUDIZHU_ALL_OFFLINE_MS = 10 * 60_000
/** 同时进行的斗地主对局上限 */
export const DOUDIZHU_MAX_ACTIVE_MATCHES = 200
/** 单个用户最多收到的待处理邀请数 */
export const DOUDIZHU_MAX_INCOMING_INVITES = 5
/** 底分（地主赢 +2 份，每份 = 底分 × 倍率） */
export const DOUDIZHU_BASE_SCORE = 100

// === DTO（与前端 client/src/types/game.ts 对齐，时间为 ISO 字符串） ===

export type GameDoudizhuMatchStatus = 'waiting' | 'bidding' | 'playing' | 'finished'
export type DoudizhuRole = 'landlord' | 'farmer'
export type DoudizhuSide = 'landlord' | 'farmers'
export type GameDoudizhuEndReason = 'hand_empty' | 'resign' | 'no_bid' | 'cancelled' | 'abandoned'

export interface DoudizhuUserBriefDto {
  id: number
  username: string
}

export interface DoudizhuInviteDto {
  id: number
  matchId: number
  game: 'doudizhu'
  from: DoudizhuUserBriefDto
  to: DoudizhuUserBriefDto
  createdAt: string
  expiresAt: string
}

export interface DoudizhuTrickMoveDto {
  userId: number
  action: 'pass' | 'play'
  cards: DoudizhuCard[]
  /** 牌型摘要（pass 时为 null） */
  combo: DoudizhuCombo | null
}

export interface DoudizhuPlayerDto {
  userId: number
  username: string
  online: boolean
  /** 地主 / 农民（叫分结束前为 null） */
  role: DoudizhuRole | null
  /** 剩余手牌数（自己的手牌看 myHand） */
  cardCount: number
  status: 'waiting' | 'playing' | 'won' | 'lost'
  /** 当前叫分轮的叫分（null = 尚未应叫） */
  bid: number | null
  /** 结算积分（未结算为 null） */
  scoreDelta: number | null
}

export interface DoudizhuMatchDto {
  id: number
  game: 'doudizhu'
  hostId: number
  status: GameDoudizhuMatchStatus
  version: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  reason: GameDoudizhuEndReason | null
  /** 获胜方（未结束为 null；流局 / 解散为 null） */
  winnerSide: DoudizhuSide | null
  /** 当前倍率（底分 × 倍率 = 每份积分） */
  multiplier: number
  landlordId: number | null
  /** 底牌（叫分结束后对所有人可见） */
  bottomCards: DoudizhuCard[]
  /** 观看者自己的座位（0–2；players 按座位排序） */
  seat: number
  players: DoudizhuPlayerDto[]
  /** 观看者自己的手牌（等待房间为空数组） */
  myHand: DoudizhuCard[]
  /** 叫分阶段状态（status=bidding 时非 null） */
  bidding: {
    turnUserId: number
    highestBid: number
    highestBidderId: number | null
    bids: Array<{ userId: number; bid: number }>
    round: number
    deadline: string
  } | null
  /** 出牌阶段状态（status=playing 时非 null） */
  playing: {
    turnUserId: number
    /** 当前需要压住的上一手（新一轮出牌时为 null） */
    lastMove: DoudizhuTrickMoveDto | null
    /** 最近出牌记录（含当前轮与上一轮，按时间升序，最多 6 条） */
    recentMoves: DoudizhuTrickMoveDto[]
    deadline: string
  } | null
}

export interface DoudizhuFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface DoudizhuSyncDto {
  serverTime: string
  invites: { incoming: DoudizhuInviteDto[]; outgoing: DoudizhuInviteDto[] }
  match: DoudizhuMatchDto | null
}

// === 内部状态 ===

interface DoudizhuPlayerState {
  userId: number
  username: string
  hand: DoudizhuCard[]
  role: DoudizhuRole | null
  bid: number | null
  status: 'waiting' | 'playing' | 'won' | 'lost'
  scoreDelta: number | null
  /** 出牌手数（春天 / 反春判定） */
  playedCount: number
  lastAvailableAt: number
}

interface DoudizhuTrickEntry {
  seat: number
  action: 'pass' | 'play'
  cards: DoudizhuCard[]
  combo: DoudizhuCombo | null
}

interface DoudizhuMatchState {
  id: number
  hostId: number
  status: GameDoudizhuMatchStatus
  version: number
  createdAt: number
  startedAt: number | null
  endedAt: number | null
  reason: GameDoudizhuEndReason | null
  winnerSide: DoudizhuSide | null
  multiplier: number
  bottom: DoudizhuCard[]
  landlordId: number | null
  bidding: {
    round: number
    turnSeat: number
    firstSeat: number
    bids: Array<{ seat: number; bid: number }>
    highestBid: number
    highestSeat: number | null
    deadline: number
    turnStartedAt: number
  } | null
  playing: {
    turnSeat: number
    lastMoveSeat: number | null
    lastCombo: DoudizhuCombo | null
    lastCards: DoudizhuCard[]
    passCount: number
    trick: DoudizhuTrickEntry[]
    lastTrick: DoudizhuTrickEntry[]
    deadline: number
    turnStartedAt: number
  } | null
  waitingEndsAt: number
  /** 最后一次有任意玩家在线的时间（全员离线废弃判定） */
  lastAnyAvailableAt: number
  players: DoudizhuPlayerState[]
}

interface DoudizhuInviteState {
  id: number
  matchId: number
  from: DoudizhuUserBriefDto
  to: DoudizhuUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, DoudizhuInviteState>()
const matches = new Map<number, DoudizhuMatchState>()
let nextMatchId = 1

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function isGameUserAvailable(userId: number): boolean {
  return isUserOnline(userId) || isGamePresent(userId)
}

/** 对局是否已结束（独立函数避免 TS 控制流收窄误报——状态会被 applyBid 等就地修改） */
function matchFinished(match: DoudizhuMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: DoudizhuMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function activeMatchFor(userId: number): DoudizhuMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'finished') continue
    const me = match.players.find((player) => player.userId === userId)
    if (me && (match.status === 'waiting' || me.status === 'playing')) return match
  }
  return null
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

function toInviteDto(invite: DoudizhuInviteState): DoudizhuInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'doudizhu',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

function toTrickMoveDto(match: DoudizhuMatchState, entry: DoudizhuTrickEntry): DoudizhuTrickMoveDto {
  return {
    userId: match.players[entry.seat].userId,
    action: entry.action,
    cards: entry.cards.map((card) => ({ ...card })),
    combo: entry.combo,
  }
}

/** 按观看者裁剪的对局 DTO（myHand 只含观看者自己的牌） */
function toMatchDto(match: DoudizhuMatchState, viewerId: number): DoudizhuMatchDto {
  const seat = match.players.findIndex((player) => player.userId === viewerId)
  const playing = match.playing
  const lastMoveDto = playing && playing.lastMoveSeat !== null && playing.lastCombo
    ? toTrickMoveDto(match, {
        seat: playing.lastMoveSeat,
        action: 'play',
        cards: playing.lastCards,
        combo: playing.lastCombo,
      })
    : null
  const recent = playing
    ? [...playing.lastTrick, ...playing.trick].slice(-6).map((entry) => toTrickMoveDto(match, entry))
    : []

  return {
    id: match.id,
    game: 'doudizhu',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    createdAt: iso(match.createdAt),
    startedAt: match.startedAt === null ? null : iso(match.startedAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    reason: match.reason,
    winnerSide: match.winnerSide,
    multiplier: match.multiplier,
    landlordId: match.landlordId,
    bottomCards: match.status === 'waiting' || match.status === 'bidding'
      ? []
      : match.bottom.map((card) => ({ ...card })),
    seat: seat < 0 ? 0 : seat,
    players: match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      online: isGameUserAvailable(player.userId),
      role: player.role,
      cardCount: player.hand.length,
      status: player.status,
      bid: player.bid,
      scoreDelta: player.scoreDelta,
    })),
    myHand: seat < 0 ? [] : sortDoudizhuCards(match.players[seat].hand).map((card) => ({ ...card })),
    bidding: match.bidding
      ? {
          turnUserId: match.players[match.bidding.turnSeat].userId,
          highestBid: match.bidding.highestBid,
          highestBidderId: match.bidding.highestSeat === null
            ? null
            : match.players[match.bidding.highestSeat].userId,
          bids: match.bidding.bids.map((entry) => ({
            userId: match.players[entry.seat].userId,
            bid: entry.bid,
          })),
          round: match.bidding.round,
          deadline: iso(match.bidding.deadline),
        }
      : null,
    playing: playing
      ? {
          turnUserId: match.players[playing.turnSeat].userId,
          lastMove: lastMoveDto,
          recentMoves: recent,
          deadline: iso(playing.deadline),
        }
      : null,
  }
}

// === 事件推送（每位玩家收到自己的视角） ===

function broadcastMatch(match: DoudizhuMatchState, type: MatchEventType): void {
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: toMatchDto(match, player.userId) })
  }
}

function emitInviteToTarget(invite: DoudizhuInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

function emitInviteRemoved(invite: DoudizhuInviteState, reason: 'accepted' | 'declined' | 'cancelled' | 'expired'): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: DoudizhuInviteState, reason: 'accepted' | 'declined' | 'cancelled' | 'expired'): void {
  invites.delete(invite.id)
  emitInviteRemoved(invite, reason)
}

function pruneExpiredInvites(now: number): void {
  for (const invite of Array.from(invites.values())) {
    if (invite.expiresAt <= now) removeInvite(invite, 'expired')
  }
}

function removeInvitesForUsers(userIds: number[], reason: 'cancelled' | 'expired' | 'declined' | 'accepted'): void {
  const targets = new Set(userIds)
  for (const invite of Array.from(invites.values())) {
    if (targets.has(invite.from.id) || targets.has(invite.to.id)) removeInvite(invite, reason)
  }
}

function sortInvites(list: DoudizhuInviteDto[]): DoudizhuInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): { incoming: DoudizhuInviteDto[]; outgoing: DoudizhuInviteDto[] } {
  const incoming: DoudizhuInviteDto[] = []
  const outgoing: DoudizhuInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createWaitingRoom(host: DoudizhuUserBriefDto, now: number): DoudizhuMatchState {
  const match: DoudizhuMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    createdAt: now,
    startedAt: null,
    endedAt: null,
    reason: null,
    winnerSide: null,
    multiplier: 1,
    bottom: [],
    landlordId: null,
    bidding: null,
    playing: null,
    waitingEndsAt: now + DOUDIZHU_WAITING_ROOM_TTL_MS,
    lastAnyAvailableAt: now,
    players: [
      {
        userId: host.id,
        username: host.username,
        hand: [],
        role: null,
        bid: null,
        status: 'waiting',
        scoreDelta: null,
        playedCount: 0,
        lastAvailableAt: now,
      },
    ],
  }
  matches.set(match.id, match)
  return match
}

/** 结束对局并广播 game:match:ended；winnerSide 非 null 时按当前倍率结算积分 */
function finishMatch(
  match: DoudizhuMatchState,
  reason: GameDoudizhuEndReason,
  winnerSide: DoudizhuSide | null,
  now: number,
): void {
  if (match.status === 'finished') return
  match.status = 'finished'
  match.reason = reason
  match.winnerSide = winnerSide
  match.endedAt = now
  match.bidding = null
  match.playing = null
  match.version += 1
  if (winnerSide === null) {
    for (const player of match.players) {
      player.status = 'lost'
      player.scoreDelta = null
    }
  } else {
    settleScores(match)
    for (const player of match.players) {
      player.status = (player.role === 'landlord') === (winnerSide === 'landlord') ? 'won' : 'lost'
    }
  }
  broadcastMatch(match, 'game:match:ended')
  publishGameEnd({
    game: 'doudizhu',
    matchId: match.id,
    reason,
    results: match.players.map((player) => ({
      userId: player.userId,
      outcome: winnerSide === null
        ? 'draw'
        : player.status === 'won' ? 'win' : 'loss',
      scoreDelta: player.scoreDelta ?? 0,
    })),
  })
}

/** 按当前倍率结算积分：地主 ±2 份、农民各 ∓1 份（须在 winnerSide 赋值后调用） */
function settleScores(match: DoudizhuMatchState): void {
  const unit = DOUDIZHU_BASE_SCORE * match.multiplier
  for (const player of match.players) {
    const isLandlord = player.role === 'landlord'
    const won = isLandlord === (match.winnerSide === 'landlord')
    player.scoreDelta = won ? (isLandlord ? 2 * unit : unit) : (isLandlord ? -2 * unit : -unit)
  }
}

/** 房主开始游戏：需要恰好 3 人，发牌并进入叫分 */
/**
 * 发牌与首个叫分座位的随机源。生产恒为 Math.random；
 * 自检脚本通过 setDoudizhuRandomForTest 注入确定性序列，
 * 避免「随机牌局撞上脚本假设」造成的偶发失败。
 */
let doudizhuRandom: () => number = Math.random

export function setDoudizhuRandomForTest(random: (() => number) | null): void {
  doudizhuRandom = random ?? Math.random
}

export function startDoudizhuMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: DoudizhuMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length !== DOUDIZHU_PLAYERS) {
    throw new AppError(`斗地主需要恰好 ${DOUDIZHU_PLAYERS} 名玩家（当前 ${match.players.length} 人）`, 400)
  }
  if (countActiveMatches() >= DOUDIZHU_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  beginBidding(match, 1, Math.floor(doudizhuRandom() * DOUDIZHU_PLAYERS), now)
  match.startedAt = now
  match.version += 1
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match, userId) }
}

/** 发牌并进入（或重新进入）叫分阶段 */
function beginBidding(match: DoudizhuMatchState, round: number, firstSeat: number, now: number): void {
  const { hands, bottom } = dealDoudizhu(doudizhuRandom)
  for (let seat = 0; seat < match.players.length; seat += 1) {
    const player = match.players[seat]
    player.hand = hands[seat]
    player.role = null
    player.bid = null
    player.status = 'playing'
    player.scoreDelta = null
    player.playedCount = 0
  }
  match.bottom = bottom
  match.landlordId = null
  match.multiplier = 1
  match.winnerSide = null
  match.playing = null
  match.status = 'bidding'
  match.bidding = {
    round,
    turnSeat: firstSeat,
    firstSeat,
    bids: [],
    highestBid: 0,
    highestSeat: null,
    deadline: now + DOUDIZHU_TURN_DEADLINE_MS,
    turnStartedAt: now,
  }
}

/** 叫分结束：确定地主、亮底牌、进入出牌阶段 */
function settleLandlord(match: DoudizhuMatchState, seat: number, now: number): void {
  const bidding = match.bidding
  if (!bidding) return
  const landlord = match.players[seat]
  landlord.role = 'landlord'
  landlord.hand = sortDoudizhuCards([...landlord.hand, ...match.bottom])
  for (const player of match.players) {
    if (player.role === null) player.role = 'farmer'
  }
  match.landlordId = landlord.userId
  match.bidding = null
  match.status = 'playing'
  match.playing = {
    turnSeat: seat,
    lastMoveSeat: null,
    lastCombo: null,
    lastCards: [],
    passCount: 0,
    trick: [],
    lastTrick: [],
    deadline: now + DOUDIZHU_TURN_DEADLINE_MS,
    turnStartedAt: now,
  }
}

/** 离开等待房间：房主离开 = 解散；已开始（叫分/出牌）不能离开（请用认输） */
export function leaveDoudizhuMatch(
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
 * 仅供 verify 脚本 / 单测使用：跳过好友与邀请校验，直接创建一个
 * 已包含指定玩家的等待房间（第一位为房主）。生产流量请走邀请流程。
 */
export function createDoudizhuRoomForTest(
  players: Array<{ id: number; username: string }>,
  now: number = Date.now(),
): DoudizhuMatchDto {
  if (players.length !== DOUDIZHU_PLAYERS) {
    throw new AppError(`斗地主需要恰好 ${DOUDIZHU_PLAYERS} 名玩家`, 400)
  }
  const host = players[0]
  const match = createWaitingRoom({ id: host.id, username: host.username }, now)
  for (const player of players.slice(1)) {
    match.players.push({
      userId: player.id,
      username: player.username,
      hand: [],
      role: null,
      bid: null,
      status: 'waiting',
      scoreDelta: null,
      playedCount: 0,
      lastAvailableAt: now,
    })
  }
  match.version += 1
  return toMatchDto(match, host.id)
}

// === 好友大厅 ===

/** GET /api/games/doudizhu/friends */
export async function listDoudizhuFriends(userId: number): Promise<{ friends: DoudizhuFriendDto[] }> {
  const { friends } = await listFriends(userId)
  return {
    friends: friends.map((friend) => ({
      id: friend.id,
      username: friend.username,
      online: isGameUserAvailable(friend.id),
      inMatch: activeMatchFor(friend.id) !== null || isUserBusyInOtherGames(friend.id, 'doudizhu'),
    })),
  }
}

// === 邀请 ===

/** GET /api/games/doudizhu/invites */
export function listDoudizhuInvites(userId: number, now: number = Date.now()): { incoming: DoudizhuInviteDto[]; outgoing: DoudizhuInviteDto[] } {
  return collectInvites(userId, now)
}

/** POST /api/games/doudizhu/invites —— 邀请好友加入自己的 3 人等待房间 */
export async function createDoudizhuInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: DoudizhuInviteDto; match: DoudizhuMatchDto }> {
  if (friendId === userId) throw new AppError('不能邀请自己', 400)
  if (!(await areFriends(userId, friendId))) throw new AppError('只能邀请好友进行对战', 403)

  pruneExpiredInvites(now)

  const current = activeMatchFor(userId)
  if (current && current.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId) || isUserBusyInOtherGames(friendId, 'doudizhu')) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (isUserBusyInOtherGames(userId, 'doudizhu')) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let incomingCount = 0
  for (const invite of invites.values()) {
    if (invite.to.id === friendId) incomingCount += 1
  }
  if (incomingCount >= DOUDIZHU_MAX_INCOMING_INVITES) {
    throw new AppError('对方的待处理邀请过多，请稍后再试', 409)
  }

  const [from, to] = await Promise.all([getUserBrief(userId), getUserBrief(friendId)])

  // 异步查询期间的并发写保护：落库前再检查一次
  const currentAfter = activeMatchFor(userId)
  if (currentAfter && currentAfter.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId) || isUserBusyInOtherGames(friendId, 'doudizhu')) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (isUserBusyInOtherGames(userId, 'doudizhu')) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let room = currentAfter
  if (!room) room = createWaitingRoom({ id: from.id, username: from.username }, now)
  if (room.status !== 'waiting') throw new AppError('房间已经开始，无法继续邀请', 409)
  if (room.players.length >= DOUDIZHU_PLAYERS) throw new AppError('房间已满（斗地主 3 人）', 409)

  // 同一好友重复邀请：幂等返回
  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room, userId) }
    }
  }

  const invite: DoudizhuInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + DOUDIZHU_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room, userId) }
}

/** POST /api/games/doudizhu/invites/:id/respond —— 接受 = 加入等待房间 */
export function respondDoudizhuInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: DoudizhuMatchDto } {
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
  if (activeMatchFor(userId) || isUserBusyInOtherGames(userId, 'doudizhu')) {
    removeInvite(invite, 'cancelled')
    throw new AppError('你已在另一场对局或房间中', 409)
  }
  if (!isParticipant(room, invite.from.id)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('邀请已失效', 409)
  }
  if (room.players.length >= DOUDIZHU_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError('房间已满（斗地主 3 人）', 409)
  }
  if (countActiveMatches() >= DOUDIZHU_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push({
    userId: invite.to.id,
    username: invite.to.username,
    hand: [],
    role: null,
    bid: null,
    status: 'waiting',
    scoreDelta: null,
    playedCount: 0,
    lastAvailableAt: now,
  })
  room.version += 1
  if (room.players.length >= DOUDIZHU_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room, userId) }
}

/** DELETE /api/games/doudizhu/invites/:id */
export function cancelDoudizhuInvite(userId: number, inviteId: number, now: number = Date.now()): { ok: true } {
  const invite = invites.get(inviteId)
  if (!invite || invite.from.id !== userId) throw new AppError('邀请不存在', 404)
  if (invite.expiresAt <= now) {
    removeInvite(invite, 'expired')
    return { ok: true }
  }
  removeInvite(invite, 'cancelled')
  return { ok: true }
}

// === 同步 / 查询 ===

/** GET /api/games/doudizhu/sync —— 轮询降级的统一同步（先执行一轮清理保证状态新鲜） */
export function getDoudizhuSync(userId: number, matchId?: number, now: number = Date.now()): DoudizhuSyncDto {
  runDoudizhuSweep(now)
  const invitesDto = collectInvites(userId, now)

  let match: DoudizhuMatchState | null
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

/** GET /api/games/doudizhu/matches/active */
export function getActiveDoudizhuMatch(userId: number, now: number = Date.now()): DoudizhuMatchDto | null {
  runDoudizhuSweep(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match, userId)
}

/** GET /api/games/doudizhu/matches/:id —— 非参与者按 404 处理 */
export function getDoudizhuMatch(userId: number, matchId: number, now: number = Date.now()): DoudizhuMatchDto {
  runDoudizhuSweep(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match, userId)
}

// === 对局操作 ===

export type DoudizhuAction =
  | { type: 'bid'; bid: number }
  | { type: 'play'; cards: number[] }
  | { type: 'pass' }

/** 应叫（0 = 不叫）；必须轮到自己且分数高于当前最高 */
function applyBid(match: DoudizhuMatchState, seat: number, bid: number, now: number, auto: boolean): void {
  const bidding = match.bidding
  if (!bidding) throw new AppError('当前不在叫分阶段', 409)
  if (bidding.turnSeat !== seat) throw new AppError('还没轮到你叫分', 409)
  if (!Number.isInteger(bid) || bid < 0 || bid > 3) throw new AppError('叫分需为 0–3', 400)
  if (bid !== 0 && bid <= bidding.highestBid) throw new AppError('叫分必须高于当前最高分', 400)

  const player = match.players[seat]
  player.bid = bid
  bidding.bids.push({ seat, bid })
  if (bid > bidding.highestBid) {
    bidding.highestBid = bid
    bidding.highestSeat = seat
  }

  if (bid === 3) {
    settleLandlord(match, seat, now)
  } else if (bidding.bids.length >= DOUDIZHU_PLAYERS) {
    if (bidding.highestBid === 0) {
      // 本轮流局：重新发牌（首叫轮转），超过上限解散
      if (bidding.round >= DOUDIZHU_MAX_BID_ROUNDS) {
        finishMatch(match, 'no_bid', null, now)
        return
      }
      beginBidding(match, bidding.round + 1, (bidding.firstSeat + 1) % DOUDIZHU_PLAYERS, now)
    } else {
      settleLandlord(match, bidding.highestSeat ?? seat, now)
    }
  } else {
    bidding.turnSeat = (seat + 1) % DOUDIZHU_PLAYERS
    bidding.deadline = now + DOUDIZHU_TURN_DEADLINE_MS
    bidding.turnStartedAt = now
  }

  match.version += 1
  if (!auto) {
    broadcastMatch(match, 'game:match:update')
  }
}

/** 出牌：从手牌中移除并推进回合；出完即结算 */
function applyPlay(match: DoudizhuMatchState, seat: number, cards: DoudizhuCard[], now: number): void {
  const playing = match.playing
  if (!playing) throw new AppError('当前不在出牌阶段', 409)
  if (playing.turnSeat !== seat) throw new AppError('还没轮到你出牌', 409)

  const player = match.players[seat]
  const combo = parseDoudizhuCombo(cards)
  if (!combo) throw new AppError('不是合法牌型', 400)

  const leading = playing.lastCombo === null
  if (!canDoudizhuBeat(combo, leading ? null : playing.lastCombo)) {
    throw new AppError(leading ? '请出合法牌型' : '压不住上一手牌', 400)
  }

  const ids = new Set(cards.map((card) => card.id))
  player.hand = player.hand.filter((card) => !ids.has(card.id))
  player.playedCount += 1
  if (combo.type === 'bomb' || combo.type === 'rocket') match.multiplier *= 2

  playing.lastMoveSeat = seat
  playing.lastCombo = combo
  playing.lastCards = cards.map((card) => ({ ...card }))
  playing.passCount = 0
  playing.trick.push({ seat, action: 'play', cards: playing.lastCards, combo })

  if (player.hand.length === 0) {
    finishByHandEmpty(match, seat, now)
    return
  }

  playing.turnSeat = (seat + 1) % DOUDIZHU_PLAYERS
  playing.deadline = now + DOUDIZHU_TURN_DEADLINE_MS
  playing.turnStartedAt = now
  match.version += 1
  broadcastMatch(match, 'game:match:update')
}

/** 不出（跟牌时）；连续两家不出 → 上一手出牌者获得新一轮出牌权 */
function applyPass(match: DoudizhuMatchState, seat: number, now: number): void {
  const playing = match.playing
  if (!playing) throw new AppError('当前不在出牌阶段', 409)
  if (playing.turnSeat !== seat) throw new AppError('还没轮到你出牌', 409)
  if (playing.lastCombo === null) throw new AppError('新一轮出牌必须出牌', 400)

  playing.passCount += 1
  playing.trick.push({ seat, action: 'pass', cards: [], combo: null })

  if (playing.passCount >= 2 && playing.lastMoveSeat !== null) {
    playing.lastTrick = playing.trick
    playing.trick = []
    playing.lastCombo = null
    playing.lastCards = []
    playing.passCount = 0
    playing.turnSeat = playing.lastMoveSeat
  } else {
    playing.turnSeat = (seat + 1) % DOUDIZHU_PLAYERS
  }
  playing.deadline = now + DOUDIZHU_TURN_DEADLINE_MS
  playing.turnStartedAt = now
  match.version += 1
  broadcastMatch(match, 'game:match:update')
}

/** 有人出完牌：结算春天 / 反春倍率后按出完牌结算 */
function finishByHandEmpty(match: DoudizhuMatchState, seat: number, now: number): void {
  const winner = match.players[seat]
  const winnerSide: DoudizhuSide = winner.role === 'landlord' ? 'landlord' : 'farmers'
  const farmers = match.players.filter((player) => player.role === 'farmer')
  const landlord = match.players.find((player) => player.role === 'landlord')

  if (winnerSide === 'landlord' && farmers.every((farmer) => farmer.playedCount === 0)) {
    match.multiplier *= 2 // 春天
  } else if (winnerSide === 'farmers' && landlord && landlord.playedCount === 1) {
    match.multiplier *= 2 // 反春
  }

  finishMatch(match, 'hand_empty', winnerSide, now)
}

/**
 * POST /api/games/doudizhu/matches/:id/actions
 * 统一动作入口：bid / play / pass（服务端权威判定）。
 */
export function applyDoudizhuAction(
  userId: number,
  matchId: number,
  action: DoudizhuAction,
  now: number = Date.now(),
): { match: DoudizhuMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status === 'finished') throw new AppError('对局已结束', 409)

  const seat = match.players.findIndex((player) => player.userId === userId)
  runDoudizhuSweep(now)
  if (matchFinished(match)) throw new AppError('对局已结束', 409)

  if (action.type === 'bid') {
    if (match.status !== 'bidding' || !match.bidding) throw new AppError('当前不在叫分阶段', 409)
    if (match.bidding.turnSeat !== seat) throw new AppError('还没轮到你叫分', 409)
    applyBid(match, seat, action.bid, now, false)
  } else if (action.type === 'play') {
    if (match.status !== 'playing' || !match.playing) throw new AppError('当前不在出牌阶段', 409)
    if (match.playing.turnSeat !== seat) throw new AppError('还没轮到你出牌', 409)
    const hand = match.players[seat].hand
    const unique = new Set(action.cards)
    if (unique.size !== action.cards.length) throw new AppError('出牌包含重复牌', 400)
    const cards = action.cards.map((id) => hand.find((card) => card.id === id))
    if (cards.some((card) => card === undefined)) throw new AppError('出牌包含不在手上的牌', 400)
    applyPlay(match, seat, cards as DoudizhuCard[], now)
  } else {
    if (match.status !== 'playing' || !match.playing) throw new AppError('当前不在出牌阶段', 409)
    if (match.playing.turnSeat !== seat) throw new AppError('还没轮到你出牌', 409)
    applyPass(match, seat, now)
  }

  return { match: toMatchDto(match, userId) }
}

/** POST /api/games/doudizhu/matches/:id/resign —— 认输：本方按当前倍率判负 */
export function resignDoudizhuMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: DoudizhuMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing' && match.status !== 'bidding') throw new AppError('对局尚未开始', 409)

  const resigner = match.players.find((player) => player.userId === userId)
  if (!resigner) throw new AppError('对局不存在', 404)
  // 叫分阶段无人是地主：认输直接解散对局（无阵营可言）
  if (match.status === 'bidding' || resigner.role === null) {
    finishMatch(match, 'resign', null, now)
    return { match: toMatchDto(match, userId) }
  }
  const winnerSide: DoudizhuSide = resigner.role === 'landlord' ? 'farmers' : 'landlord'
  finishMatch(match, 'resign', winnerSide, now)
  return { match: toMatchDto(match, userId) }
}

// === 托管与清理（sweeper，由 gameService 每 15 秒调用一次） ===

/** 托管出牌：出最小的可拆单张（不拆炸弹） */
function autoSingleCard(hand: DoudizhuCard[]): DoudizhuCard {
  const byRank = new Map<number, DoudizhuCard[]>()
  for (const card of sortDoudizhuCards(hand)) {
    const list = byRank.get(card.rank)
    if (list) list.push(card)
    else byRank.set(card.rank, [card])
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b)
  const splittable = ranks.find((rank) => (byRank.get(rank)?.length ?? 0) < 4)
  const rank = splittable ?? ranks[0]
  return byRank.get(rank)![0]
}

/** 回合是否需要托管：超时，或玩家已离线超过宽限时长 */
function shouldAutoAct(deadline: number, turnStartedAt: number, userId: number, now: number): boolean {
  if (now >= deadline) return true
  if (!isGameUserAvailable(userId) && now - turnStartedAt >= DOUDIZHU_OFFLINE_TURN_MS) return true
  return false
}

/** 执行一轮斗地主清理与托管（导出便于单测 / verify 脚本触发） */
export function runDoudizhuSweep(now: number = Date.now()): void {
  pruneExpiredInvites(now)

  for (const match of matches.values()) {
    if (match.status === 'waiting') {
      if (now >= match.waitingEndsAt) {
        removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
        finishMatch(match, 'cancelled', null, now)
      }
      continue
    }
    if (match.status === 'finished') continue

    // 全员离线废弃判定
    if (match.players.some((player) => isGameUserAvailable(player.userId))) {
      match.lastAnyAvailableAt = now
    } else if (now - match.lastAnyAvailableAt >= DOUDIZHU_ALL_OFFLINE_MS) {
      finishMatch(match, 'abandoned', null, now)
      continue
    }

    // 回合托管
    if (match.bidding) {
      const turnUser = match.players[match.bidding.turnSeat].userId
      if (shouldAutoAct(match.bidding.deadline, match.bidding.turnStartedAt, turnUser, now)) {
        applyBid(match, match.bidding.turnSeat, 0, now, true)
        if (!matchFinished(match)) broadcastMatch(match, 'game:match:update')
      }
      continue
    }
    if (match.playing) {
      const seat = match.playing.turnSeat
      const turnUser = match.players[seat].userId
      if (shouldAutoAct(match.playing.deadline, match.playing.turnStartedAt, turnUser, now)) {
        if (match.playing.lastCombo === null) {
          const card = autoSingleCard(match.players[seat].hand)
          applyPlay(match, seat, [card], now)
        } else {
          applyPass(match, seat, now)
        }
      }
    }
  }

  // 回收已结束的对局
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= DOUDIZHU_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

// === 跨游戏互斥注册（2048 侧发起 / 接受邀请时会检查这里） ===

function isUserInDoudizhuMatch(userId: number): boolean {
  return activeMatchFor(userId) !== null
}

/** 强制清除该用户在斗地主里的房间 / 对局状态（等待房间离开，进行中认输） */
export function resetDoudizhuUser(userId: number): number {
  return resetUserInMatches(matches.values(), userId, {
    leave: (uid, id) => leaveDoudizhuMatch(uid, id),
    resign: (uid, id) => resignDoudizhuMatch(uid, id),
  })
}

registerGameModule({
  name: 'doudizhu',
  isUserInMatch: isUserInDoudizhuMatch,
  sweep: runDoudizhuSweep,
  resetUser: resetDoudizhuUser,
})
