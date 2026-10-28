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
  LIAR_MAX_PLAYERS,
  LIAR_MIN_PLAYERS,
  applyLiarTableChallenge,
  applyLiarTablePlay,
  eliminateLiarTablePlayer,
  finishLiarTable,
  liarGunBullets,
  suggestLiarMove,
  createLiarTable,
  type LiarDeathCause,
  type LiarTableLogEntry,
  type LiarTableState,
  type LiarTarget,
} from './gameLiar.js'

/**
 * 骗子酒馆好友联机业务逻辑（内存态，无 Prisma 表）
 *
 * 架构与五子棋 / 扫雷 / 跳一跳联机一致（回合结构对齐 gameGomokuService）：
 *   - 房间 / 邀请 / 牌桌全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：牌桌流转（发牌 / 出牌 / 质疑 / 开牌 / 扣扳机 / 重发）全部由
 *     gameLiar 引擎的牌桌状态机完成（与单机前端共用同一份实现）；
 *   - 隐藏信息按观看者裁剪：myHand 只有自己的手牌，牌堆只下发 {userId, 张数}，
 *     只有被质疑开牌的牌面才公开（lastReveal 与事件流里的 reveal 条目）；
 *   - 实时推送复用聊天 WebSocket（game:match:started|update|ended），
 *     无 WebSocket 时客户端用 `sync` 轮询 + `presence` 心跳降级；
 *   - 回合制：回合 60 秒，超时由 sweeper 自动托管（suggestLiarMove，事件流可见）；
 *   - 2–4 人对局：房主 = 座位 0，首局由座位 0 先行；
 *   - 结束口径：只剩一名存活玩家（last_standing）/ 全局 30 分钟超时（timeout）/
 *     等待房间解散（cancelled）。认输与掉线判负只淘汰该玩家（不直接结束对局，
 *     除非因此只剩一人），死亡会推高左轮子弹数。
 *
 * 跨游戏互斥：通过 registerGameModule 注册 isUserInMatch 探针与 sweep 钩子，
 * 其他游戏侧发起或接受邀请时会检查这里；本模块反过来检查它们。
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒（与其他游戏共用同一口径） */
export const LIAR_INVITE_TTL_MS = GAME_INVITE_TTL_MS
/** 默认对局时长：30 分钟（到点未分胜负 → timeout 废弃） */
export const LIAR_DEFAULT_DURATION_MS = 30 * 60_000
/** 单个回合时长：60 秒（超时自动托管出牌/质疑，不淘汰） */
export const LIAR_TURN_MS = 60_000
/** 等待房间最长存活时间：30 分钟（超时未开局解散） */
export const LIAR_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
/** 已结束对局保留期：5 分钟（供客户端补拉最终结果） */
export const LIAR_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
/** 连续不可用超过该时长且其他存活玩家在线 → 判负出局：120 秒 */
export const LIAR_DISCONNECT_FORFEIT_MS = GAME_DISCONNECT_FORFEIT_MS
/** 同时进行的骗子酒馆房间/对局上限 */
export const LIAR_MAX_ACTIVE_MATCHES = 200
/** 单个用户最多收到的待处理邀请数 */
export const LIAR_MAX_INCOMING_INVITES = 5

// === DTO（与前端 client/src/types/game.ts 对齐，时间为 ISO 字符串） ===

export type GameLiarMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameLiarPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameLiarEndReason = 'last_standing' | 'timeout' | 'cancelled'

export interface LiarUserBriefDto {
  id: number
  username: string
}

export interface LiarInviteDto {
  id: number
  matchId: number
  game: 'liar'
  from: LiarUserBriefDto
  to: LiarUserBriefDto
  createdAt: string
  expiresAt: string
}

/** 当前回合：只有一个持有者，deadline 为该玩家的回合截止时间 */
export interface LiarTurnDto {
  userId: number
  deadline: string
}

/** 牌堆里的一手（盖着的：只有出牌人与张数，牌面不公开） */
export interface LiarPileEntryDto {
  userId: number
  count: number
}

/** 一次质疑开牌的结果（牌面此时对所有人公开） */
export interface LiarRevealDto {
  round: number
  /** 被开牌者（上一手出牌人） */
  userId: number
  cards: number[]
  /** 是否全部为真牌（true → 质疑者输） */
  truthful: boolean
  /** 质疑发起者 */
  challengerId: number
}

/** 公开事件流条目（座位已换算成 userId；数组顺序即发生顺序） */
export type GameLiarLogEntry =
  | { type: 'round'; round: number; target: LiarTarget; starterUserId: number }
  | { type: 'play'; round: number; userId: number; count: number }
  | { type: 'challenge'; round: number; userId: number; targetUserId: number }
  | { type: 'reveal'; round: number; userId: number; cards: number[]; truthful: boolean }
  | { type: 'trigger'; round: number; userId: number; bullets: number; died: boolean }
  | { type: 'death'; round: number; userId: number; cause: LiarDeathCause }
  | { type: 'flush'; round: number }

export interface GameLiarPlayerDto {
  userId: number
  username: string
  online: boolean
  status: GameLiarPlayerStatus
  /** 当前手牌张数（牌面不下发） */
  handCount: number
  /** 累计出牌手数 */
  plays: number
}

export interface GameLiarMatchDto {
  id: number
  game: 'liar'
  hostId: number
  status: GameLiarMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameLiarEndReason | null
  /** 当前局号（从 1 开始；每次重发 +1） */
  round: number
  /** 本局目标牌面（等待房间中为 null） */
  target: LiarTarget | null
  /** 非 playing 状态固定为 null */
  turn: LiarTurnDto | null
  /** 当前桌面牌堆（盖着，只有 userId + 张数） */
  pile: LiarPileEntryDto[]
  /** 最近一次质疑开牌结果（保留到下一次质疑覆盖） */
  lastReveal: LiarRevealDto | null
  /** 公开事件流（最近 200 条） */
  log: GameLiarLogEntry[]
  /** 当前左轮子弹数（= 死亡人数 + 1，封顶 6） */
  gunBullets: number
  /** 观看者自己的手牌（他人查看 / 等待房间为 []） */
  myHand: number[]
  /** 按座位顺序（座位 0 = 房主） */
  players: GameLiarPlayerDto[]
}

export interface LiarFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface LiarInvitesDto {
  incoming: LiarInviteDto[]
  outgoing: LiarInviteDto[]
}

export interface LiarSyncDto {
  serverTime: string
  invites: LiarInvitesDto
  match: GameLiarMatchDto | null
}

/** POST /api/games/liar/matches/:id/actions 的动作体（出牌 / 质疑） */
export type LiarAction = { type: 'play'; cards: number[] } | { type: 'challenge' }

// === 内部状态 ===

interface LiarPlayerState {
  userId: number
  username: string
  /** 最近一次被判定为在线的时间（用于掉线判负） */
  lastAvailableAt: number
}

interface LiarMatchState {
  id: number
  hostId: number
  status: GameLiarMatchStatus
  version: number
  /** 等待房间里 = 建房时间；开始后 = 开局时间 */
  startedAt: number
  /** 等待房间里 = 房间到期时间；开始后 = 全局结束时间 */
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameLiarEndReason | null
  /** 数组下标即座位（开局后不再增删；离开只发生在等待房间） */
  players: LiarPlayerState[]
  /** 牌桌状态机（等待房间中为 null） */
  table: LiarTableState | null
  /** 当前回合截止时间（毫秒时间戳） */
  turnDeadline: number
}

interface LiarInviteState {
  id: number
  matchId: number
  from: LiarUserBriefDto
  to: LiarUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, LiarInviteState>()
const matches = new Map<number, LiarMatchState>()
let nextMatchId = 1
let sweeperTimer: ReturnType<typeof setInterval> | null = null

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 对局是否已结束（独立函数避免 TS 控制流收窄误报——状态会被就地修改） */
function matchFinished(match: LiarMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: LiarMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function seatOf(match: LiarMatchState, userId: number): number {
  return match.players.findIndex((player) => player.userId === userId)
}

/**
 * 当前用户「仍在其中」的房间/对局：等待房间，或进行中且本人仍存活。
 * 认输 / 中弹出局后不再返回，避免大厅与邀请把玩家卡在「你正在对局中」。
 */
function activeMatchFor(userId: number): LiarMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'finished') continue
    const seat = seatOf(match, userId)
    if (seat < 0) continue
    if (match.status === 'waiting' || playerStatusOf(match, seat) === 'playing') return match
  }
  return null
}

function waitingRoomFor(userId: number): LiarMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

/**
 * 用户是否已在其他游戏的房间或对局中（跨游戏互斥的另一半）。
 * 异常时按不忙处理，避免其它游戏模块的问题把骗子酒馆大厅一起拖垮。
 */
function isBusyInOtherGames(userId: number): boolean {
  return isUserBusyInOtherGames(userId, 'liar')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

function toInviteDto(invite: LiarInviteState): LiarInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'liar',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

function playerStatusOf(match: LiarMatchState, seat: number): GameLiarPlayerStatus {
  if (match.status === 'waiting' || match.table === null) return 'waiting'
  const tablePlayer = match.table.players[seat]
  if (match.table.finished) {
    return tablePlayer && match.table.winnerSeat === seat ? 'won' : 'lost'
  }
  return tablePlayer?.alive ? 'playing' : 'lost'
}

function mapLogEntry(match: LiarMatchState, entry: LiarTableLogEntry): GameLiarLogEntry {
  const userIdOf = (seat: number): number => match.players[seat]?.userId ?? 0
  switch (entry.type) {
    case 'round':
      return { type: 'round', round: entry.round, target: entry.target, starterUserId: userIdOf(entry.starterSeat) }
    case 'play':
      return { type: 'play', round: entry.round, userId: userIdOf(entry.seat), count: entry.count }
    case 'challenge':
      return {
        type: 'challenge',
        round: entry.round,
        userId: userIdOf(entry.seat),
        targetUserId: userIdOf(entry.targetSeat),
      }
    case 'reveal':
      return {
        type: 'reveal',
        round: entry.round,
        userId: userIdOf(entry.seat),
        cards: [...entry.cards],
        truthful: entry.truthful,
      }
    case 'trigger':
      return { type: 'trigger', round: entry.round, userId: userIdOf(entry.seat), bullets: entry.bullets, died: entry.died }
    case 'death':
      return { type: 'death', round: entry.round, userId: userIdOf(entry.seat), cause: entry.cause }
    case 'flush':
      return { type: 'flush', round: entry.round }
  }
}

/** 对局 DTO：隐藏信息按观看者裁剪（myHand / 牌堆牌面） */
function toMatchDto(match: LiarMatchState, viewerId: number): GameLiarMatchDto {
  const table = match.table
  const viewerSeat = seatOf(match, viewerId)
  return {
    id: match.id,
    game: 'liar',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    round: table?.round ?? 0,
    target: table?.target ?? null,
    turn:
      match.status === 'playing' && table !== null && table.turnSeat !== null && !table.finished
        ? { userId: match.players[table.turnSeat]?.userId ?? 0, deadline: iso(match.turnDeadline) }
        : null,
    pile: (table?.pile ?? []).map((entry) => ({
      userId: match.players[entry.seat]?.userId ?? 0,
      count: entry.count,
    })),
    lastReveal:
      table?.lastReveal === null || table?.lastReveal === undefined
        ? null
        : {
            round: table.lastReveal.round,
            userId: match.players[table.lastReveal.seat]?.userId ?? 0,
            cards: [...table.lastReveal.cards],
            truthful: table.lastReveal.truthful,
            challengerId: match.players[table.lastReveal.challengerSeat]?.userId ?? 0,
          },
    log: (table?.log ?? []).map((entry) => mapLogEntry(match, entry)),
    gunBullets: liarGunBullets(table?.deaths ?? 0),
    myHand: table !== null && viewerSeat >= 0 ? [...table.players[viewerSeat]?.hand ?? []] : [],
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

/** 广播对局事件：每个玩家收到按自己裁剪的 DTO（myHand 不同） */
function broadcastMatch(match: LiarMatchState, type: MatchEventType): void {
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: toMatchDto(match, player.userId) })
  }
}

function emitInviteToTarget(invite: LiarInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

/** 邀请移除事件发给双方（发出方与接收方都要清理本地弹窗/列表） */
function emitInviteRemoved(invite: LiarInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: LiarInviteState, reason: GameInviteRemovalReason): void {
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
function sortInvites(list: LiarInviteDto[]): LiarInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): LiarInvitesDto {
  const incoming: LiarInviteDto[] = []
  const outgoing: LiarInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createLiarWaitingPlayer(user: LiarUserBriefDto, now: number): LiarPlayerState {
  return {
    userId: user.id,
    username: user.username,
    lastAvailableAt: now,
  }
}

/** 创建等待房间（房主已在房间里） */
function createWaitingRoom(host: LiarUserBriefDto, now: number): LiarMatchState {
  const match: LiarMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    startedAt: now,
    endsAt: now + LIAR_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    players: [createLiarWaitingPlayer(host, now)],
    table: null,
    turnDeadline: 0,
  }
  matches.set(match.id, match)
  return match
}

/**
 * 结束对局并广播 game:match:ended。
 * winnerId === null 表示废弃（全局超时）或房间解散；
 * 客户端应以 `winnerId === null` 判断无胜者，而不是以单个玩家 status 判断。
 */
function finishLiarMatch(
  match: LiarMatchState,
  reason: GameLiarEndReason,
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
 * 牌桌打完（只剩一名存活玩家）后收口：把牌桌结果同步成对局结果并广播。
 */
function finishLiarMatchByTable(match: LiarMatchState, now: number): void {
  const table = match.table
  if (!table || !table.finished) return
  const winnerId = table.winnerSeat === null ? null : match.players[table.winnerSeat]?.userId ?? null
  finishLiarMatch(match, 'last_standing', winnerId, now)
}

/**
 * 执行一次牌桌动作（玩家请求与超时托管共用）：动作 → 版本推进 →
 * 终局收口或广播 update。引擎抛出的规则错误统一转 400。
 */
function performLiarTableAction(
  match: LiarMatchState,
  seat: number,
  action:
    | { kind: 'play'; cards: number[] }
    | { kind: 'challenge' },
  now: number,
): void {
  const table = match.table
  if (!table || table.finished) throw new AppError('对局未开始或已结束', 409)
  if (table.turnSeat !== seat) throw new AppError('还没轮到你', 409)
  try {
    match.table =
      action.kind === 'play'
        ? applyLiarTablePlay(table, seat, action.cards)
        : applyLiarTableChallenge(table, seat)
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : '无效操作', 400)
  }
  match.version += 1
  if (match.table.finished) {
    finishLiarMatchByTable(match, now)
    return
  }
  match.turnDeadline = now + LIAR_TURN_MS
  broadcastMatch(match, 'game:match:update')
}

/**
 * 结算一次回合超时：当前回合玩家自动托管（suggestLiarMove 决定出牌或质疑）。
 *
 * @returns `acted` = 已托管一次动作（内部已广播或已终局）；
 *          `noop` = 回合缺失或持有者已出局，没有记账
 */
function chargeLiarTurnTimeout(match: LiarMatchState, now: number): 'acted' | 'noop' {
  const table = match.table
  if (!table || table.finished || table.turnSeat === null) return 'noop'
  const seat = table.turnSeat
  const tablePlayer = table.players[seat]
  if (!tablePlayer || !tablePlayer.alive) return 'noop'
  const top = table.pile[table.pile.length - 1] ?? null
  const suggestion = suggestLiarMove({
    hand: tablePlayer.hand,
    target: table.target,
    lastPlay: top === null ? null : { seat: top.seat, count: top.count },
  })
  if (suggestion === null) return 'noop'
  try {
    performLiarTableAction(
      match,
      seat,
      suggestion.action === 'play' ? { kind: 'play', cards: suggestion.cards } : { kind: 'challenge' },
      now,
    )
  } catch {
    // 托管动作与玩家并发冲突等异常：不记账，下一轮 sweeper 重新收敛
    return 'noop'
  }
  return 'acted'
}

/**
 * 把一个对局结算到 now 时刻的一致状态（可能连续触发多步）：
 *   1. 等待房间超过 30 分钟未开局 → cancelled 解散；
 *   2. 全局超时（now >= endsAt）→ timeout 废弃（无胜者）；
 *   3. 掉线超过 120 秒且其他存活玩家在线 → 该玩家判负出局（forfeit 死亡，
 *      会推高子弹数；只剩一人时终局）；
 *   4. 回合超时 → 自动托管出牌/质疑（循环处理，连续多回合超时逐手结算）。
 * 状态发生变化时广播（结束广播由 finishLiarMatch 负责）。
 */
function settleLiarMatch(match: LiarMatchState, now: number): void {
  if (match.status === 'waiting') {
    if (now >= match.endsAt) {
      removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
      finishLiarMatch(match, 'cancelled', null, now)
    }
    return
  }
  if (match.status !== 'playing') return

  if (now >= match.endsAt) {
    if (match.table !== null) match.table = finishLiarTable(match.table, null)
    finishLiarMatch(match, 'timeout', null, now)
    return
  }

  // 掉线：先刷新在线记录，再判断是否有人连续不可用超限
  for (const player of match.players) {
    if (isGameUserAvailable(player.userId)) player.lastAvailableAt = now
  }
  const table = match.table
  if (table !== null && !table.finished) {
    for (const seat of table.players.map((player) => player.seat)) {
      if (match.status !== 'playing' || match.table === null || match.table.finished) break
      const tablePlayer = match.table.players[seat]
      if (!tablePlayer || !tablePlayer.alive) continue
      const player = match.players[seat]
      if (!player) continue
      if (now - player.lastAvailableAt < LIAR_DISCONNECT_FORFEIT_MS) continue
      const othersAvailable = match.players.some(
        (candidate, otherSeat) =>
          otherSeat !== seat
          && match.table?.players[otherSeat]?.alive
          && isGameUserAvailable(candidate.userId),
      )
      if (!othersAvailable) continue
      try {
        match.table = eliminateLiarTablePlayer(match.table, seat, 'forfeit')
      } catch {
        continue
      }
      match.version += 1
      if (match.table.finished) {
        finishLiarMatchByTable(match, now)
        return
      }
      match.turnDeadline = now + LIAR_TURN_MS
      broadcastMatch(match, 'game:match:update')
    }
  }

  // 回合超时：连续多回合都可能已经跨过 deadline，循环到一致状态
  let guard = 0
  while (
    match.status === 'playing'
    && match.table !== null
    && !match.table.finished
    && match.table.turnSeat !== null
    && now >= match.turnDeadline
    && guard <= LIAR_MAX_PLAYERS + 2
  ) {
    guard += 1
    const outcome = chargeLiarTurnTimeout(match, now)
    if (outcome === 'noop' || matchFinished(match)) break
  }
}

// === 对外 API ===

/**
 * 房主开始游戏：2–4 人，立即发牌进入第 1 局（座位 0 = 房主先行；
 * 回合 60 秒、全局 30 分钟）。只允许房主操作；房间已开始 / 已结束时拒绝。
 */
export function startLiarMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameLiarMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < LIAR_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${LIAR_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > LIAR_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${LIAR_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= LIAR_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  match.table = createLiarTable(match.players.length)
  match.status = 'playing'
  match.startedAt = now
  match.endsAt = now + LIAR_DEFAULT_DURATION_MS
  match.turnDeadline = now + LIAR_TURN_MS
  match.version += 1
  match.players.forEach((player) => {
    player.lastAvailableAt = now
  })
  // 对局开始后不再接受任何邀请
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match, userId) }
}

/**
 * 离开等待房间：房主离开 = 解散房间；普通玩家离开 = 从房间移除。
 * 已开始的对局不能走这个接口（请使用 resign 认输出局）。
 */
export function leaveLiarMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { ok: true; dissolved: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') {
    const seat = seatOf(match, userId)
    if (match.status === 'playing' && seat >= 0 && playerStatusOf(match, seat) === 'playing') {
      throw new AppError('对局进行中，请先认输再退出房间', 409)
    }
    removeInvitesForUsers([userId], 'cancelled')
    return { ok: true, dissolved: false }
  }

  removeInvitesForUsers([userId], 'cancelled')
  if (match.hostId === userId) {
    removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
    finishLiarMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishLiarMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

/** GET /api/games/liar/friends */
export async function listLiarFriends(userId: number): Promise<{ friends: LiarFriendDto[] }> {
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

/** GET /api/games/liar/invites */
export function listLiarInvites(userId: number, now: number = Date.now()): LiarInvitesDto {
  return collectInvites(userId, now)
}

/**
 * POST /api/games/liar/invites —— 邀请好友加入自己的等待房间（2–4 人）
 *
 * 没有房间时自动创建（发起方为房主）；同一好友重复邀请幂等；
 * 任一方已在其他游戏房间或对局中时拒绝（跨游戏互斥）。
 */
export async function createLiarInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: LiarInviteDto; match: GameLiarMatchDto }> {
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
  if (incomingCount >= LIAR_MAX_INCOMING_INVITES) {
    throw new AppError('对方的待处理邀请过多，请稍后再试', 409)
  }

  const [from, to] = await Promise.all([getUserBrief(userId), getUserBrief(friendId)])

  // 异步查询期间的并发写保护：落库前再检查一次
  const currentAfter = activeMatchFor(userId)
  if (currentAfter && currentAfter.status !== 'waiting') throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId) || isBusyInOtherGames(friendId)) throw new AppError('对方正在对局/房间中，无法邀请', 409)
  if (isBusyInOtherGames(userId)) throw new AppError('你正在其他游戏对局中，无法发起邀请', 409)
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let room = currentAfter ?? waitingRoomFor(userId)
  if (!room) room = createWaitingRoom({ id: from.id, username: from.username }, now)
  if (room.status !== 'waiting') throw new AppError('房间已经开始，无法继续邀请', 409)
  if (room.players.length >= LIAR_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${LIAR_MAX_PLAYERS} 人）`, 409)
  }

  // 同一好友重复邀请：幂等返回已有邀请与房间
  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room, userId) }
    }
  }

  // 对方已经先邀请了自己 → 先处理对方邀请
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  const invite: LiarInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + LIAR_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room, userId) }
}

/** POST /api/games/liar/invites/:id/respond —— 接受 = 加入等待房间（仍由房主统一开始） */
export function respondLiarInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameLiarMatchDto } {
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
  if (room.players.length >= LIAR_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${LIAR_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= LIAR_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 只清理「接受者」相关的其它邀请，保留房主邀请其他好友的邀请
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createLiarWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= LIAR_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room, userId) }
}

/** DELETE /api/games/liar/invites/:id */
export function cancelLiarInvite(
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

/** GET /api/games/liar/sync —— 轮询降级的统一同步（先清理一轮保证状态新鲜） */
export function getLiarSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): LiarSyncDto {
  runLiarSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: LiarMatchState | null
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

/** GET /api/games/liar/matches/active —— 当前等待房间 / 进行中对局，或 null */
export function getActiveLiarMatch(userId: number, now: number = Date.now()): GameLiarMatchDto | null {
  runLiarSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match, userId)
}

/** GET /api/games/liar/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getLiarMatch(userId: number, matchId: number, now: number = Date.now()): GameLiarMatchDto {
  runLiarSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match, userId)
}

/**
 * POST /api/games/liar/matches/:id/actions
 *
 * 只有 `turn.userId` 指向的存活玩家可以动作：
 *   - play：盖着出 1–3 张手牌（声称目标牌面，实际可任意，牌面对其他玩家不可见）；
 *   - challenge：质疑上一手 → 开牌定真假 → 输家扣扳机（生死都重发开新局）；
 *   - 非参与者 404；对局非 playing 409；不是当前回合玩家 409「还没轮到你」；
 *     牌组非法（1–3 张 / 非手牌 / 重复）400。
 */
export function applyLiarAction(
  userId: number,
  matchId: number,
  action: LiarAction,
  now: number = Date.now(),
): { match: GameLiarMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局未开始或已结束', 409)

  // 已超时 / 该淘汰的先结算，再判断本局是否仍在进行
  runLiarSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const tablePlayer = match.table?.players[seat]
  if (!tablePlayer || !tablePlayer.alive) throw new AppError('你已出局', 409)

  performLiarTableAction(
    match,
    seat,
    action.type === 'play' ? { kind: 'play', cards: action.cards } : { kind: 'challenge' },
    now,
  )
  return { match: toMatchDto(match, userId) }
}

/**
 * POST /api/games/liar/matches/:id/resign —— 认输：立即出局（不扣扳机）。
 * 与其他游戏不同：多人局里认输不直接结束对局，剩余玩家继续；
 * 只有因此只剩一名存活玩家时才终局（对方获胜）。
 */
export function resignLiarMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameLiarMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局尚未开始或已结束', 409)

  runLiarSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const table = match.table
  const tablePlayer = table?.players[seat]
  if (!table || !tablePlayer || !tablePlayer.alive) throw new AppError('你已出局', 409)

  match.table = eliminateLiarTablePlayer(table, seat, 'resign')
  match.version += 1
  if (match.table.finished) {
    finishLiarMatchByTable(match, now)
  } else {
    match.turnDeadline = now + LIAR_TURN_MS
    broadcastMatch(match, 'game:match:update')
  }
  return { match: toMatchDto(match, userId) }
}

// === 定时清理（sweeper） ===

/**
 * 执行一轮骗子酒馆清理与结算（已由 registerGameModule 交给 gameService 主 sweeper
 * 每 15 秒调用一次；也导出供 routes / 自检脚本显式触发）：
 *   1. 清理过期邀请与 presence；
 *   2. 逐房间结算（等待解散 / 全局超时 / 掉线判负出局 / 回合超时托管）；
 *   3. 回收结束超过 5 分钟的对局。
 */
export function runLiarSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    settleLiarMatch(match, now)
  }

  // 回收已结束的对局（保留期 5 分钟，供客户端补拉最终结果）
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= LIAR_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

/**
 * 兜底清理定时器（可选）：主链路已由 gameService.startGameSweeper() 经
 * registerGameModule 的 sweep 钩子驱动，这里只是多一层保险，重复调用安全。
 */
export function startLiarTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runLiarSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ 骗子酒馆清理定时器已启动（间隔 ${intervalMs}ms）`)
}

/** 停止兜底清理定时器（自检脚本收尾用；重复调用安全） */
function stopLiarTicker(): void {
  if (sweeperTimer !== null) {
    clearInterval(sweeperTimer)
    sweeperTimer = null
  }
}

// === 自检脚本 / 单测入口 ===

/**
 * 仅供 verify 脚本 / 单测使用：跳过好友与可用性校验，直接创建一个包含指定玩家的
 * 等待房间（第一位为房主，其余按加入顺序分配座位）。生产流量请走邀请流程。
 */
export function createLiarRoomForTest(
  hostId: number,
  hostName: string,
  memberIds: number[] = [],
  now: number = Date.now(),
): { matchId: number } {
  const room = createWaitingRoom({ id: hostId, username: hostName }, now)
  memberIds.forEach((memberId) => {
    room.players.push(createLiarWaitingPlayer({ id: memberId, username: `u${memberId}` }, now))
  })
  room.version += 1
  return { matchId: room.id }
}

/**
 * 仅供 verify 脚本 / 单测使用：直接登记一条待处理邀请
 * （真实流程需要数据库里的好友关系），便于验证接受 / 拒绝 / 取消与过期语义。
 */
export function createLiarInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: LiarInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + LIAR_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

/** 仅供自检脚本使用：清空内存状态（含兜底定时器），便于脚本反复运行 */
export function resetLiarStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopLiarTicker()
}

// === 跨游戏互斥注册（其他游戏侧发起或接受邀请时会检查这里） ===

function isUserInLiarMatch(userId: number): boolean {
  return activeMatchFor(userId) !== null
}

/** 强制清除该用户在骗子酒馆里的房间 / 对局状态（等待房间离开，进行中认输） */
export function resetLiarUser(userId: number): number {
  let cleared = 0
  for (const match of Array.from(matches.values())) {
    const seat = seatOf(match, userId)
    if (seat < 0) continue
    if (match.status === 'waiting') {
      try {
        leaveLiarMatch(userId, match.id)
        cleared += 1
      } catch {
        // 已被 sweeper 结算 / 并发离开：忽略
      }
      continue
    }
    if (match.status === 'playing' && playerStatusOf(match, seat) === 'playing') {
      try {
        resignLiarMatch(userId, match.id)
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
  name: 'liar',
  isUserInMatch: isUserInLiarMatch,
  sweep: runLiarSweeper,
  resetUser: resetLiarUser,
})
