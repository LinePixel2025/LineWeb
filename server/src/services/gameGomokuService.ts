import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { sendToUser } from './chatHub.js'
import { pruneGamePresence } from './gamePresence.js'
import { nextGameInviteId } from './gameIds.js'
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
  GOMOKU_BLACK,
  GOMOKU_BOARD_SIZE,
  GOMOKU_WHITE,
  createGomokuBoard,
  findGomokuWin,
  isGomokuBoardFull,
  placeGomokuStone,
  suggestGomokuMove,
  type GomokuColor,
} from './gameGomoku.js'

/**
 * 五子棋好友联机业务逻辑（内存态，无 Prisma 表）——「15×15 无禁手、轮流落子、率先连五获胜」
 *
 * 架构与 2048 / 斗地主 / 贪吃蛇 / 扫雷 / 跳一跳联机一致（回合结构逐字对齐 gameJumpService）：
 *   - 房间 / 邀请 / 棋盘全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：客户端只提交落子坐标 (x, y)，连五判定、胜负、托管全部由
 *     gameGomoku 引擎按同一份常量计算（DTO 形状与 client/src/types/game.ts 逐字一致）；
 *   - 实时推送复用聊天 WebSocket（game:invite / game:invite:removed /
 *     game:match:started|update|ended），无 WebSocket 时客户端用 `sync` 轮询 + `presence`
 *     心跳降级；在线判定统一走 gameService.isGameUserAvailable；
 *   - 回合制：只有 `turn.userId` 指向的玩家可落子，回合 60 秒，超时由 sweeper 自动
 *     托管落子（suggestGomokuMove，lastMove.auto = true），落子后正常判胜负与轮转——
 *     与斗地主的托管口径一致（超时不淘汰）；
 *   - 恰好 2 人对局：房主 = 座位 0 执黑先行，另一位执白；
 *   - 结束口径：连五（five）/ 认输（resign）/ 掉线超过 120 秒且对方在线（forfeit）/
 *     全局 30 分钟超时平局（timeout）/ 棋盘下满平局（draw）/ 等待房间解散（cancelled）。
 *
 * 跨游戏互斥：通过 registerGameModule 注册 isUserInMatch 探针与 sweep 钩子，
 * 2048 / 斗地主 / 贪吃蛇 / 扫雷 / 跳一跳侧发起或接受邀请时会检查这里；本模块反过来检查它们。
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒（与其他游戏共用同一口径） */
export const GOMOKU_INVITE_TTL_MS = GAME_INVITE_TTL_MS
/** 房间最少开局人数（五子棋是双人游戏，恰好 2 人） */
export const GOMOKU_MIN_PLAYERS = 2
/** 房间人数上限（恰好 2 人） */
export const GOMOKU_MAX_PLAYERS = 2
/** 默认对局时长：30 分钟（到点未分胜负 → timeout 平局） */
export const GOMOKU_DEFAULT_DURATION_MS = 30 * 60_000
/** 单个回合时长：60 秒（超时自动托管落子，不淘汰） */
export const GOMOKU_TURN_MS = 60_000
/** 等待房间最长存活时间：30 分钟（超时未开局解散） */
export const GOMOKU_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
/** 已结束对局保留期：5 分钟（供客户端补拉最终结果） */
export const GOMOKU_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
/** 连续不可用超过该时长且另一名玩家在线 → 判负：120 秒 */
export const GOMOKU_DISCONNECT_FORFEIT_MS = GAME_DISCONNECT_FORFEIT_MS
/** 同时进行的五子棋房间/对局上限 */
export const GOMOKU_MAX_ACTIVE_MATCHES = 200
/** 单个用户最多收到的待处理邀请数 */
export const GOMOKU_MAX_INCOMING_INVITES = 5

// === DTO（与前端 client/src/types/game.ts 逐字对齐，时间为 ISO 字符串） ===

export type GameGomokuMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameGomokuPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameGomokuEndReason =
  | 'five'
  | 'resign'
  | 'forfeit'
  | 'timeout'
  | 'draw'
  | 'cancelled'

export interface GomokuUserBriefDto {
  id: number
  username: string
}

export interface GomokuInviteDto {
  id: number
  matchId: number
  game: 'gomoku'
  from: GomokuUserBriefDto
  to: GomokuUserBriefDto
  createdAt: string
  expiresAt: string
}

/** 当前回合：只有一个持有者，deadline 为该玩家的回合截止时间 */
export interface GomokuTurnDto {
  userId: number
  deadline: string
}

/** 最近一手（auto = 回合超时由服务端托管落下） */
export interface GomokuLastMoveDto {
  userId: number
  x: number
  y: number
  color: GomokuColor
  auto: boolean
}

export interface GameGomokuPlayerDto {
  userId: number
  username: string
  online: boolean
  status: GameGomokuPlayerStatus
  /** 座位 0（房主）执黑 = 1、座位 1 执白 = 2；等待房间中为 null */
  color: GomokuColor | null
  /** 已落子手数 */
  moves: number
}

export interface GameGomokuMatchDto {
  id: number
  game: 'gomoku'
  hostId: number
  status: GameGomokuMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameGomokuEndReason | null
  /** 棋盘边长（恒 15） */
  boardSize: number
  /** 一维棋盘（下标 = y * 15 + x，0 空 1 黑 2 白；无隐藏信息，全量下发） */
  board: number[]
  /** 非 playing 状态固定为 null */
  turn: GomokuTurnDto | null
  lastMove: GomokuLastMoveDto | null
  /** 获胜连线（含 ≥5 长连），reason = 'five' 结束时才有 */
  winningLine: Array<{ x: number; y: number }> | null
  /** 按座位顺序（座位 0 = 房主 = 黑） */
  players: GameGomokuPlayerDto[]
}

export interface GomokuFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface GomokuInvitesDto {
  incoming: GomokuInviteDto[]
  outgoing: GomokuInviteDto[]
}

export interface GomokuSyncDto {
  serverTime: string
  invites: GomokuInvitesDto
  match: GameGomokuMatchDto | null
}

/** POST /api/games/gomoku/matches/:id/actions 的动作体（落子坐标） */
export interface GomokuAction {
  type: 'place'
  x: number
  y: number
}

// === 内部状态 ===

interface GomokuPlayerState {
  userId: number
  username: string
  status: GameGomokuPlayerStatus
  /** 座位 0 执黑、座位 1 执白；等待房间中为 null，开局时定格 */
  color: GomokuColor | null
  /** 已落子手数 */
  moves: number
  /** 最近一次被判定为在线的时间（用于掉线判负） */
  lastAvailableAt: number
}

interface GomokuMatchState {
  id: number
  hostId: number
  status: GameGomokuMatchStatus
  version: number
  /** 等待房间里 = 建房时间；开始后 = 开局时间 */
  startedAt: number
  /** 等待房间里 = 房间到期时间；开始后 = 全局结束时间 */
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameGomokuEndReason | null
  durationMs: number
  /** 数组下标即座位（开局后不再增删；五子棋恰 2 人） */
  players: GomokuPlayerState[]
  /** 一维棋盘（下标 = y * 15 + x）；等待房间中为空数组 */
  board: number[]
  /** 获胜连线；未分胜负为 null */
  winningLine: Array<{ x: number; y: number }> | null
  /** 当前回合持有者（非 playing 为 null） */
  turnUserId: number | null
  /** 当前回合截止时间（毫秒时间戳） */
  turnDeadline: number
  lastMove: GomokuLastMoveDto | null
}

interface GomokuInviteState {
  id: number
  matchId: number
  from: GomokuUserBriefDto
  to: GomokuUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, GomokuInviteState>()
const matches = new Map<number, GomokuMatchState>()
let nextMatchId = 1
let sweeperTimer: ReturnType<typeof setInterval> | null = null

// === 工具函数 ===

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

/** 对局是否已结束（独立函数避免 TS 控制流收窄误报——状态会被就地修改） */
function matchFinished(match: GomokuMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: GomokuMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function seatOf(match: GomokuMatchState, userId: number): number {
  return match.players.findIndex((player) => player.userId === userId)
}

function activeMatchFor(userId: number): GomokuMatchState | null {
  for (const match of matches.values()) {
    if (match.status !== 'finished' && isParticipant(match, userId)) return match
  }
  return null
}

function waitingRoomFor(userId: number): GomokuMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

/** 仍在场（status === 'playing'）的玩家，按座位顺序 */
function alivePlayers(match: GomokuMatchState): GomokuPlayerState[] {
  return match.players.filter((player) => player.status === 'playing')
}

/** 从 fromSeat 起，按座位循环找下一名仍在场的玩家座位；找不到返回 -1 */
function nextAliveSeat(match: GomokuMatchState, fromSeat: number): number {
  const total = match.players.length
  for (let offset = 1; offset <= total; offset += 1) {
    const seat = (fromSeat + offset) % total
    if (match.players[seat].status === 'playing') return seat
  }
  return -1
}

/**
 * 用户是否已在其他游戏的房间或对局中（跨游戏互斥的另一半）。
 * 异常时按不忙处理，避免其它游戏模块的问题把五子棋大厅一起拖垮。
 */
function isBusyInOtherGames(userId: number): boolean {
  // 统一走注册表：2048 / 斗地主 / 贪吃蛇 / 扫雷 / 跳一跳 / 我的世界（排除自己）
  return isUserBusyInOtherGames(userId, 'gomoku')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

function toInviteDto(invite: GomokuInviteState): GomokuInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'gomoku',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

/** 对局 DTO（所有玩家收到同一份，不按观看者裁剪；棋盘无隐藏信息） */
function toMatchDto(match: GomokuMatchState): GameGomokuMatchDto {
  return {
    id: match.id,
    game: 'gomoku',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    boardSize: GOMOKU_BOARD_SIZE,
    board: [...match.board],
    turn:
      match.status === 'playing' && match.turnUserId !== null
        ? { userId: match.turnUserId, deadline: iso(match.turnDeadline) }
        : null,
    lastMove: match.lastMove === null ? null : { ...match.lastMove },
    winningLine: match.winningLine === null ? null : match.winningLine.map((point) => ({ ...point })),
    players: match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      online: isGameUserAvailable(player.userId),
      status: player.status,
      color: player.color,
      moves: player.moves,
    })),
  }
}

// === 事件推送 ===

function broadcastMatch(match: GomokuMatchState, type: MatchEventType): void {
  const dto = toMatchDto(match)
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: dto })
  }
}

function emitInviteToTarget(invite: GomokuInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

/** 邀请移除事件发给双方（发出方与接收方都要清理本地弹窗/列表） */
function emitInviteRemoved(invite: GomokuInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: GomokuInviteState, reason: GameInviteRemovalReason): void {
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
function sortInvites(list: GomokuInviteDto[]): GomokuInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): GomokuInvitesDto {
  const incoming: GomokuInviteDto[] = []
  const outgoing: GomokuInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createGomokuWaitingPlayer(user: GomokuUserBriefDto, now: number): GomokuPlayerState {
  return {
    userId: user.id,
    username: user.username,
    status: 'waiting',
    color: null,
    moves: 0,
    lastAvailableAt: now,
  }
}

/** 创建等待房间（房主已在房间里） */
function createWaitingRoom(host: GomokuUserBriefDto, now: number): GomokuMatchState {
  const match: GomokuMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    startedAt: now,
    endsAt: now + GOMOKU_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    durationMs: GOMOKU_DEFAULT_DURATION_MS,
    players: [createGomokuWaitingPlayer(host, now)],
    board: [],
    winningLine: null,
    turnUserId: null,
    turnDeadline: 0,
    lastMove: null,
  }
  matches.set(match.id, match)
  return match
}

/**
 * 结束对局并广播 game:match:ended。
 * winnerId === null 表示平局（全局超时 / 棋盘下满）或房间解散；
 * 客户端应以 `winnerId === null` 判断平局，而不是以单个玩家 status 判断。
 */
function finishGomokuMatch(
  match: GomokuMatchState,
  reason: GameGomokuEndReason,
  winnerId: number | null,
  now: number,
): void {
  if (match.status === 'finished') return
  match.status = 'finished'
  match.reason = reason
  match.winnerId = winnerId
  match.endedAt = now
  match.version += 1
  // 终局没有「下一次」——回合清空，客户端据此隐藏回合提示
  match.turnUserId = null
  for (const player of match.players) {
    player.status = winnerId === null ? 'lost' : (player.userId === winnerId ? 'won' : 'lost')
  }
  broadcastMatch(match, 'game:match:ended')
}

/** 把回合交给座位 fromSeat 之后的下一名在场玩家；deadline 由调用方给出 */
function rotateTurn(match: GomokuMatchState, fromSeat: number, deadline: number): boolean {
  const seat = nextAliveSeat(match, fromSeat)
  if (seat < 0) {
    match.turnUserId = null
    return false
  }
  match.turnUserId = match.players[seat].userId
  match.turnDeadline = deadline
  return true
}

/**
 * 执行一手权威落子（玩家动作与回合超时托管共用）：
 * 落子 → 连五判定（five 结束并记录 winningLine）→ 满盘判定（draw 平局）
 * → 否则轮转对方回合并广播 update。
 *
 * @param nextDeadline 落子后新回合的 deadline（托管路径传入顺延值以支持连续结算）
 */
function performPlace(
  match: GomokuMatchState,
  userId: number,
  x: number,
  y: number,
  auto: boolean,
  now: number,
  nextDeadline: number,
): void {
  const seat = seatOf(match, userId)
  const player = match.players[seat]
  const color = player.color ?? GOMOKU_BLACK
  placeGomokuStone(match.board, x, y, color)
  player.moves += 1
  match.lastMove = { userId, x, y, color, auto }
  match.version += 1

  const win = findGomokuWin(match.board, x, y)
  if (win !== null) {
    match.winningLine = win
    finishGomokuMatch(match, 'five', userId, now)
    return
  }
  if (isGomokuBoardFull(match.board)) {
    finishGomokuMatch(match, 'draw', null, now)
    return
  }
  rotateTurn(match, seat, nextDeadline)
  broadcastMatch(match, 'game:match:update')
}

/**
 * 结算一次回合超时：当前回合玩家自动托管落子（suggestGomokuMove），
 * 落子后正常判胜负与轮转——超时不淘汰（与斗地主托管口径一致）。
 *
 * @returns `placed` = 已托管落下一手（performPlace 内部已广播或已结束对局）；
 *          `noop` = 回合缺失或持有者已出局，没有记账
 */
function chargeGomokuTurnTimeout(match: GomokuMatchState, now: number): 'placed' | 'noop' {
  if (match.turnUserId === null) return 'noop'
  const seat = seatOf(match, match.turnUserId)
  if (seat < 0) {
    match.turnUserId = null
    return 'noop'
  }
  const player = match.players[seat]
  if (player.status !== 'playing') {
    rotateTurn(match, seat, now + GOMOKU_TURN_MS)
    return 'noop'
  }
  const move = suggestGomokuMove(match.board, player.color ?? GOMOKU_BLACK)
  if (move === null) {
    // 无子可下（棋盘已满的兜底路径）：按满盘平局结算
    finishGomokuMatch(match, 'draw', null, now)
    return 'noop'
  }
  // 新回合 deadline 由已过期的 deadline 顺延一个回合时长，
  // 这样长时间无人操作时一轮结算可以连续处理多手托管
  const expiredDeadline = match.turnDeadline
  performPlace(match, player.userId, move.x, move.y, true, now, expiredDeadline + GOMOKU_TURN_MS)
  return 'placed'
}

/**
 * 把一个对局结算到 now 时刻的一致状态（可能连续触发多步）：
 *   1. 等待房间超过 30 分钟未开局 → cancelled 解散；
 *   2. 全局超时（now >= endsAt）→ timeout 平局；
 *   3. 掉线超过 120 秒且对方在线 → forfeit 判负（双人局即结束）；
 *   4. 回合超时 → 自动托管落子并轮转（循环处理，连续多回合超时逐手结算）。
 * 状态发生变化时广播（结束广播由 finishGomokuMatch 负责）。
 */
function settleGomokuMatch(match: GomokuMatchState, now: number): void {
  if (match.status === 'waiting') {
    if (now >= match.endsAt) {
      removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
      finishGomokuMatch(match, 'cancelled', null, now)
    }
    return
  }
  if (match.status !== 'playing') return

  if (now >= match.endsAt) {
    finishGomokuMatch(match, 'timeout', null, now)
    return
  }

  // 掉线：先刷新在线记录，再判断是否有人连续不可用超限
  for (const player of match.players) {
    if (player.status === 'playing' && isGameUserAvailable(player.userId)) player.lastAvailableAt = now
  }
  for (const player of match.players) {
    if (player.status !== 'playing') continue
    if (now - player.lastAvailableAt < GOMOKU_DISCONNECT_FORFEIT_MS) continue
    const othersAvailable = match.players.some(
      (candidate) =>
        candidate.userId !== player.userId
        && candidate.status === 'playing'
        && isGameUserAvailable(candidate.userId),
    )
    if (!othersAvailable) continue
    // 双人局：一人判负即整局结束，对方获胜
    finishGomokuMatch(match, 'forfeit', match.players.find((c) => c.userId !== player.userId)?.userId ?? null, now)
    return
  }

  // 回合超时：连续多回合都可能已经跨过 deadline，循环到一致状态
  // （每次超时托管一手，循环上限取总手数规模即可）
  let guard = 0
  while (
    match.status === 'playing'
    && match.turnUserId !== null
    && now >= match.turnDeadline
    && guard <= GOMOKU_MAX_PLAYERS * 2
  ) {
    guard += 1
    const outcome = chargeGomokuTurnTimeout(match, now)
    if (outcome === 'noop' || matchFinished(match)) break
  }
}

// === 对外 API ===

/**
 * 房主开始游戏：恰好 2 人，空棋盘开局，座位 0（房主）执黑先行
 * （回合 60 秒、全局 30 分钟）。只允许房主操作；房间已开始 / 已结束时拒绝。
 */
export function startGomokuMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameGomokuMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < GOMOKU_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${GOMOKU_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > GOMOKU_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${GOMOKU_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= GOMOKU_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  match.board = createGomokuBoard()
  match.winningLine = null
  match.lastMove = null
  match.status = 'playing'
  match.startedAt = now
  match.durationMs = GOMOKU_DEFAULT_DURATION_MS
  match.endsAt = now + match.durationMs
  match.version += 1
  // 座位与颜色在开局时定格：座位 0 执黑先行（房主），座位 1 执白
  match.players.forEach((player, seat) => {
    player.status = 'playing'
    player.color = seat === 0 ? GOMOKU_BLACK : GOMOKU_WHITE
    player.moves = 0
    player.lastAvailableAt = now
  })
  match.turnUserId = match.players[0].userId
  match.turnDeadline = now + GOMOKU_TURN_MS
  // 对局开始后不再接受任何邀请
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match) }
}

/**
 * 离开等待房间：房主离开 = 解散房间；普通玩家离开 = 从房间移除。
 * 已开始的对局不能走这个接口（请使用 resign）。
 */
export function leaveGomokuMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { ok: true; dissolved: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('对局已开始，无法离开房间', 409)

  removeInvitesForUsers([userId], 'cancelled')
  if (match.hostId === userId) {
    removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
    finishGomokuMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishGomokuMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

/** GET /api/games/gomoku/friends */
export async function listGomokuFriends(userId: number): Promise<{ friends: GomokuFriendDto[] }> {
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

/** GET /api/games/gomoku/invites */
export function listGomokuInvites(userId: number, now: number = Date.now()): GomokuInvitesDto {
  return collectInvites(userId, now)
}

/**
 * POST /api/games/gomoku/invites —— 邀请好友加入自己的 2 人等待房间
 *
 * 没有房间时自动创建（发起方为房主）；同一好友重复邀请幂等；
 * 任一方已在其他游戏房间或对局中时拒绝（跨游戏互斥）。
 */
export async function createGomokuInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: GomokuInviteDto; match: GameGomokuMatchDto }> {
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
  if (incomingCount >= GOMOKU_MAX_INCOMING_INVITES) {
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
  if (room.players.length >= GOMOKU_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${GOMOKU_MAX_PLAYERS} 人）`, 409)
  }

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

  const invite: GomokuInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + GOMOKU_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room) }
}

/** POST /api/games/gomoku/invites/:id/respond —— 接受 = 加入等待房间（仍由房主统一开始） */
export function respondGomokuInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameGomokuMatchDto } {
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
  if (room.players.length >= GOMOKU_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${GOMOKU_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= GOMOKU_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 只清理「接受者」相关的其它邀请，保留房主邀请其他好友的邀请
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createGomokuWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= GOMOKU_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room) }
}

/** DELETE /api/games/gomoku/invites/:id */
export function cancelGomokuInvite(
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

/** GET /api/games/gomoku/sync —— 轮询降级的统一同步（先清理一轮保证状态新鲜） */
export function getGomokuSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): GomokuSyncDto {
  runGomokuSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: GomokuMatchState | null
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

/** GET /api/games/gomoku/matches/active —— 当前等待房间 / 进行中对局，或 null */
export function getActiveGomokuMatch(userId: number, now: number = Date.now()): GameGomokuMatchDto | null {
  runGomokuSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match)
}

/** GET /api/games/gomoku/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getGomokuMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): GameGomokuMatchDto {
  runGomokuSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match)
}

/**
 * POST /api/games/gomoku/matches/:id/actions
 *
 * 只有 `turn.userId` 指向的在场玩家可以落子：
 *   - 落子后由引擎判定连五（five 获胜并下发 winningLine）/ 满盘（draw 平局），
 *     否则轮到对方（回合 60 秒）；
 *   - 非参与者 404；对局非 playing 409；不是当前回合玩家 409「还没轮到你」；
 *   - 坐标越界或该点已有棋子 400（zod 已限 0–14，这里防御性复核占用）。
 */
export function applyGomokuAction(
  userId: number,
  matchId: number,
  action: GomokuAction,
  now: number = Date.now(),
): { match: GameGomokuMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局未开始或已结束', 409)

  // 已超时 / 该掉线的先结算，再判断本局是否仍在进行
  runGomokuSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const player = seat < 0 ? null : match.players[seat]
  if (!player || player.status !== 'playing') throw new AppError('你已出局或对局未开始', 409)
  if (match.turnUserId !== userId) throw new AppError('还没轮到你', 409)
  if (action.type !== 'place') throw new AppError('不支持的操作类型', 400)
  if (
    !Number.isInteger(action.x) || !Number.isInteger(action.y)
    || action.x < 0 || action.x >= GOMOKU_BOARD_SIZE
    || action.y < 0 || action.y >= GOMOKU_BOARD_SIZE
  ) {
    throw new AppError(`落子坐标需在 0–${GOMOKU_BOARD_SIZE - 1} 之间`, 400)
  }
  if (match.board[action.y * GOMOKU_BOARD_SIZE + action.x] !== 0) {
    throw new AppError('该位置已有棋子', 400)
  }

  performPlace(match, userId, action.x, action.y, false, now, now + GOMOKU_TURN_MS)
  return { match: toMatchDto(match) }
}

/** POST /api/games/gomoku/matches/:id/resign —— 认输：对方获胜 */
export function resignGomokuMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameGomokuMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局尚未开始或已结束', 409)

  runGomokuSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player || player.status !== 'playing') throw new AppError('你已出局', 409)
  finishGomokuMatch(
    match,
    'resign',
    match.players.find((candidate) => candidate.userId !== userId)?.userId ?? null,
    now,
  )
  return { match: toMatchDto(match) }
}

// === 定时清理（sweeper） ===

/**
 * 执行一轮五子棋清理与结算（已由 registerGameModule 交给 gameService 主 sweeper
 * 每 15 秒调用一次；也导出供 routes / 自检脚本显式触发）：
 *   1. 清理过期邀请与 presence；
 *   2. 逐房间结算（等待解散 / 全局超时平局 / 掉线判负 / 回合超时托管）；
 *   3. 回收结束超过 5 分钟的对局。
 */
export function runGomokuSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    settleGomokuMatch(match, now)
  }

  // 回收已结束的对局（保留期 5 分钟，供客户端补拉最终结果）
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= GOMOKU_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

/**
 * 兜底清理定时器（可选）：主链路已由 gameService.startGameSweeper() 经
 * registerGameModule 的 sweep 钩子驱动，这里只是多一层保险，重复调用安全。
 */
export function startGomokuTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runGomokuSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ 五子棋清理定时器已启动（间隔 ${intervalMs}ms）`)
}

/** 停止兜底清理定时器（自检脚本收尾用；重复调用安全） */
function stopGomokuTicker(): void {
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
export function createGomokuRoomForTest(
  hostId: number,
  hostName: string,
  memberIds: number[] = [],
  now: number = Date.now(),
): { matchId: number } {
  const room = createWaitingRoom({ id: hostId, username: hostName }, now)
  memberIds.forEach((memberId) => {
    room.players.push(createGomokuWaitingPlayer({ id: memberId, username: `u${memberId}` }, now))
  })
  room.version += 1
  return { matchId: room.id }
}

/**
 * 仅供 verify 脚本 / 单测使用：直接登记一条待处理邀请
 * （真实流程需要数据库里的好友关系），便于验证接受 / 拒绝 / 取消与过期语义。
 */
export function createGomokuInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: GomokuInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + GOMOKU_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

/** 仅供自检脚本使用：清空内存状态（含兜底定时器），便于脚本反复运行 */
export function resetGomokuStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopGomokuTicker()
}

// === 跨游戏互斥注册（其他游戏侧发起或接受邀请时会检查这里） ===

function isUserInGomokuMatch(userId: number): boolean {
  return activeMatchFor(userId) !== null
}

registerGameModule({ name: 'gomoku', isUserInMatch: isUserInGomokuMatch, sweep: runGomokuSweeper })
