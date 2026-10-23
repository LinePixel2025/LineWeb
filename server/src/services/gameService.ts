import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { isUserOnline, sendToUser } from './chatHub.js'
import { isGamePresent, pruneGamePresence } from './gamePresence.js'
import {
  GAME2048_TARGET,
  applyMove,
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
/** 单局时长上限：10 分钟 */
export const GAME_MATCH_DURATION_MS = 10 * 60_000
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
  from: GameUserBriefDto
  to: GameUserBriefDto
  createdAt: string
  expiresAt: string
}

export type GameInviteRemovalReason = 'accepted' | 'declined' | 'cancelled' | 'expired'
export type GameMatchStatus = 'playing' | 'finished'
export type GamePlayerStatus = 'playing' | 'won' | 'lost'
export type GameEndReason = 'target' | 'timeout' | 'resign' | 'forfeit' | 'blocked'

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
  status: GameMatchStatus
  version: number
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
  /** 该玩家专属的随机序列（与对手同种子起步，之后独立推进） */
  random: Game2048Random
  /** 最近一次被判定为可用的时间（用于掉线判负） */
  lastAvailableAt: number
}

interface MatchState {
  id: number
  status: GameMatchStatus
  version: number
  startedAt: number
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameEndReason | null
  players: [PlayerState, PlayerState]
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
  return match.players[0].userId === userId || match.players[1].userId === userId
}

/** 当前用户进行中的对局（status === 'playing'） */
function activeMatchFor(userId: number): MatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'playing' && isParticipant(match, userId)) return match
  }
  return null
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
    status: match.status,
    version: match.version,
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

// === 对局生命周期 ===

function createPlayerState(user: GameUserBriefDto, seed: number, now: number): PlayerState {
  const initial = createSeededGame(seed)
  return {
    userId: user.id,
    username: user.username,
    board: initial.board,
    score: 0,
    maxTile: maxTileValue(initial.board),
    moves: 0,
    status: 'playing',
    random: initial.random,
    lastAvailableAt: now,
  }
}

/** 建立对局：双方用同一 seed 得到完全相同的初始棋盘 */
function createMatch(host: GameUserBriefDto, guest: GameUserBriefDto, now: number): MatchState {
  const seed = randomSeed()
  const match: MatchState = {
    id: nextMatchId++,
    status: 'playing',
    version: 1,
    startedAt: now,
    endsAt: now + GAME_MATCH_DURATION_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    players: [createPlayerState(host, seed, now), createPlayerState(guest, seed, now)],
  }
  matches.set(match.id, match)
  return match
}

/**
 * 结束对局并广播 game:match:ended。
 *
 * 单个玩家状态：winnerId 对应玩家为 won、另一人为 lost；
 * 平局（winnerId === null，仅 timeout 平分）双方均为 lost，客户端应以
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

/** 超时结算：比较分数，高者胜；平分则 winnerId = null（平局） */
function finishByTimeout(match: MatchState, now: number): void {
  const [first, second] = match.players
  const winnerId = first.score > second.score
    ? first.userId
    : second.score > first.score
      ? second.userId
      : null
  finishMatch(match, 'timeout', winnerId, now)
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

/** POST /api/games/2048/invites */
export async function createGameInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: GameInviteDto }> {
  if (friendId === userId) throw new AppError('不能邀请自己', 400)
  if (!(await areFriends(userId, friendId))) throw new AppError('只能邀请好友进行对战', 403)

  pruneExpiredInvites(now)

  if (activeMatchFor(userId)) throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId)) throw new AppError('对方正在对局中，无法邀请', 409)

  // 同一发送者只能有一条待处理邀请；同一好友重复发起幂等返回已有邀请
  for (const invite of invites.values()) {
    if (invite.from.id !== userId) continue
    if (invite.to.id === friendId) return { invite: toInviteDto(invite) }
    throw new AppError('你已有一条待处理的对战邀请，请先取消', 409)
  }

  // 对方已经先邀请了自己 → 先处理对方邀请
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  let incomingCount = 0
  for (const invite of invites.values()) {
    if (invite.to.id === friendId) incomingCount += 1
  }
  if (incomingCount >= GAME_MAX_INCOMING_INVITES) {
    throw new AppError('对方的待处理邀请过多，请稍后再试', 409)
  }

  const [from, to] = await Promise.all([getUserBrief(userId), getUserBrief(friendId)])

  // 异步查询期间可能已有并发请求写入邀请/对局；落库前再检查一次，避免同一发送者产生多条邀请。
  if (activeMatchFor(userId)) throw new AppError('你正在对局中，无法发起邀请', 409)
  if (activeMatchFor(friendId)) throw new AppError('对方正在对局中，无法邀请', 409)
  for (const invite of invites.values()) {
    if (invite.from.id !== userId) continue
    if (invite.to.id === friendId) return { invite: toInviteDto(invite) }
    throw new AppError('你已有一条待处理的对战邀请，请先取消', 409)
  }
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }
  if (!isGameUserAvailable(friendId)) throw new AppError('对方不在线，无法邀请', 409)

  const invite: InviteState = {
    id: nextInviteId++,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + GAME_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteInviteToTarget(invite)
  return { invite: toInviteDto(invite) }
}

/** POST /api/games/2048/invites/:id/respond */
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

  // === 接受邀请 ===
  const inviterId = invite.from.id
  if (activeMatchFor(userId)) {
    // 自己已在另一场对局：清理本条邀请
    removeInvite(invite, 'cancelled')
    throw new AppError('你已在另一场对局中', 409)
  }
  if (activeMatchFor(inviterId)) {
    removeInvite(invite, 'cancelled')
    throw new AppError('对方已进入另一场对局', 409)
  }
  if (!isGameUserAvailable(inviterId)) {
    removeInvite(invite, 'expired')
    throw new AppError('对方已离线，邀请已失效', 409)
  }
  if (countActiveMatches() >= GAME_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  // 接受后先标记本条为 accepted，再清理双方之间其它待处理邀请，最后建立对局
  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 对局开始后清理双方其它待处理邀请（包括与第三人的邀请），避免过期邀请堆积
  removeInvitesForUsers([userId, inviterId], 'cancelled')

  const match = createMatch(invite.from, invite.to, now)
  broadcastMatch(match, 'game:match:started')
  return { ok: true, match: toMatchDto(match) }
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
      finishByTimeout(match, now)
      match = null
    }
  } else {
    const found = matches.get(matchId)
    if (!found || !isParticipant(found, userId)) throw new AppError('对局不存在', 404)
    if (found.status === 'playing' && now >= found.endsAt) finishByTimeout(found, now)
    match = found
  }

  return {
    serverTime: iso(now),
    invites: invitesDto,
    match: match === null ? null : toMatchDto(match),
  }
}

/** GET /api/games/2048/matches/active —— 当前进行中的对局或 null */
export function getActiveGameMatch(userId: number, now: number = Date.now()): GameMatchDto | null {
  const match = activeMatchFor(userId)
  if (match === null) return null
  // sweeper 有 15 秒间隔：读取时先结算已超时的对局，避免大厅继续跳回一场已超时的对局
  if (now >= match.endsAt) {
    finishByTimeout(match, now)
    return null
  }
  return toMatchDto(match)
}

/** GET /api/games/2048/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getGameMatch(userId: number, matchId: number): GameMatchDto {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
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

  const playerIndex = match.players[0].userId === userId ? 0 : 1
  const player = match.players[playerIndex]
  const opponent = match.players[1 - playerIndex]

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
    // 无合法移动 → 该玩家判负，对手获胜
    finishMatch(match, 'blocked', opponent.userId, now)
  } else {
    broadcastMatch(match, 'game:match:update')
  }

  return { match: toMatchDto(match), moved: true }
}

/** POST /api/games/2048/matches/:id/resign —— 认输，对手获胜 */
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

  const opponentId = match.players[0].userId === userId
    ? match.players[1].userId
    : match.players[0].userId
  finishMatch(match, 'resign', opponentId, now)
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
    if (match.status !== 'playing') continue

    if (now >= match.endsAt) {
      finishByTimeout(match, now)
      continue
    }

    for (const player of match.players) {
      if (isGameUserAvailable(player.userId)) {
        player.lastAvailableAt = now
        continue
      }
      if (now - player.lastAvailableAt < GAME_DISCONNECT_FORFEIT_MS) continue

      const opponent = match.players[0].userId === player.userId
        ? match.players[1]
        : match.players[0]
      // 双方都不可用时不判负（等超时或任意一方恢复）
      if (!isGameUserAvailable(opponent.userId)) continue

      finishMatch(match, 'forfeit', opponent.userId, now)
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
