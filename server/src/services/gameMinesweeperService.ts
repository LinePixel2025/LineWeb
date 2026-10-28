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
  MS_ONLINE_HEIGHT,
  MS_ONLINE_MINES,
  MS_ONLINE_WIDTH,
  adjacentMines,
  createMinesweeperBoard,
  isCleared,
  isMine,
  revealCells,
  type MinesweeperBoard,
} from './gameMinesweeper.js'

/**
 * 扫雷好友联机业务逻辑（内存态，无 Prisma 表）——「轮流点：一人只许下一次」
 *
 * 架构与 2048 / 斗地主 / 贪吃蛇联机一致：
 *   - 房间 / 邀请 / 盘面全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：客户端只提交「翻开某格 / 在某格插拔旗」，盘面、旗子、得分、胜负全部由服务端计算；
 *   - 实时推送复用聊天 WebSocket（game:invite / game:invite:removed /
 *     game:match:started|update|ended），无 WebSocket 时客户端用 `sync` 轮询 + `presence`
 *     心跳降级；在线判定统一走 gameService.isGameUserAvailable；
 *   - 与贪吃蛇的关键差异：
 *     1) 房间 2–4 人；开局后按 seed 生成 12×12 / 22 雷的权威盘面；
 *     2) **轮流一次**：只有 `turn.userId` 指向的玩家可以操作，一次动作（翻开或插拔旗）
 *        就用掉「这一次」，随后轮到下一名存活玩家；不是回合制计时器自动推进；
 *     3) 有隐藏信息：只有被翻开的格子才进 DTO 的 `opened` 数组，
 *        **未翻开的雷位绝不发布**（结算也不公布全部雷位，见 toMatchDto 注释）；
 *     4) 淘汰制：踩雷 / 连续 3 次回合超时 / 认输 / 掉线 → 该玩家出局，其余人继续；
 *        只剩 1 人时该玩家获胜。
 *
 * 跨游戏互斥：通过 registerGameModule 注册 isUserInMatch 探针与 sweep 钩子，
 * 2048 / 斗地主 / 贪吃蛇侧发起或接受邀请时会检查这里；本模块反过来检查它们。
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒（与 2048 / 斗地主 / 贪吃蛇共用同一口径） */
export const MINESWEEPER_INVITE_TTL_MS = GAME_INVITE_TTL_MS
/** 房间最少开局人数 */
export const MINESWEEPER_MIN_PLAYERS = 2
/** 房间人数上限 */
export const MINESWEEPER_MAX_PLAYERS = 4
/** 默认对局时长：10 分钟（房主开始即固定，全局超时按翻开数结算） */
export const MINESWEEPER_DEFAULT_DURATION_MS = 10 * 60_000
/** 单个回合时长：30 秒（超时记一次 skip，累计到上限即淘汰） */
export const MINESWEEPER_TURN_MS = 30_000
/** 同一玩家连续回合超时达到该次数 → 淘汰 */
export const MINESWEEPER_MAX_SKIPS = 3
/** 等待房间最长存活时间：30 分钟（超时未开局解散） */
export const MINESWEEPER_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
/** 已结束对局保留期：5 分钟（供客户端补拉最终结果） */
export const MINESWEEPER_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
/** 连续不可用超过该时长且至少另一名玩家在线 → 淘汰：120 秒 */
export const MINESWEEPER_DISCONNECT_FORFEIT_MS = GAME_DISCONNECT_FORFEIT_MS
/** 同时进行的扫雷房间/对局上限 */
export const MINESWEEPER_MAX_ACTIVE_MATCHES = 200
/** 单个用户最多收到的待处理邀请数 */
export const MINESWEEPER_MAX_INCOMING_INVITES = 5

// === DTO（与前端 client/src/types/game.ts 逐字对齐，时间为 ISO 字符串） ===

export type GameMinesweeperMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameMinesweeperPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameMinesweeperEndReason =
  | 'boom'
  | 'cleared'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'cancelled'
/** 最近一次动作的种类（拔旗单独一种，客户端据此区分动画） */
export type MinesweeperActionKind = 'open' | 'flag' | 'unflag'

export interface MinesweeperUserBriefDto {
  id: number
  username: string
}

export interface MinesweeperInviteDto {
  id: number
  matchId: number
  game: 'minesweeper'
  from: MinesweeperUserBriefDto
  to: MinesweeperUserBriefDto
  createdAt: string
  expiresAt: string
}

/** 已翻开格（未翻开的格子绝不出现在这里，雷位因此不泄露） */
export interface MinesweeperOpenedDto {
  index: number
  mine: boolean
  adjacent: number
}

/** 插旗记录（by = 插旗者 userId；拔旗时整条移除） */
export interface MinesweeperFlagDto {
  index: number
  by: number
}

/** 当前回合：只有一个持有者，deadline 为该玩家的回合截止时间 */
export interface MinesweeperTurnDto {
  userId: number
  deadline: string
  skips: number
}

export interface MinesweeperLastActionDto {
  userId: number
  kind: MinesweeperActionKind
  index: number
}

export interface GameMinesweeperPlayerDto {
  userId: number
  username: string
  online: boolean
  status: GameMinesweeperPlayerStatus
  /** 安全翻开格子数（本玩家名下） */
  opened: number
  /** 踩雷次数 */
  booms: number
  /** 计分 = opened（踩雷不扣分，仅记录） */
  score: number
}

export interface GameMinesweeperMatchDto {
  id: number
  game: 'minesweeper'
  hostId: number
  status: GameMinesweeperMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameMinesweeperEndReason | null
  board: { width: number; height: number; mines: number }
  opened: MinesweeperOpenedDto[]
  flags: MinesweeperFlagDto[]
  /** 非 playing 状态固定为 null */
  turn: MinesweeperTurnDto | null
  lastAction: MinesweeperLastActionDto | null
  /** 按座位顺序 */
  players: GameMinesweeperPlayerDto[]
}

export interface MinesweeperFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface MinesweeperInvitesDto {
  incoming: MinesweeperInviteDto[]
  outgoing: MinesweeperInviteDto[]
}

export interface MinesweeperSyncDto {
  serverTime: string
  invites: MinesweeperInvitesDto
  match: GameMinesweeperMatchDto | null
}

/** POST /api/games/minesweeper/matches/:id/actions 的动作体 */
export type MinesweeperAction = { type: 'open'; index: number } | { type: 'flag'; index: number }

// === 内部状态 ===

interface MinesweeperPlayerState {
  userId: number
  username: string
  status: GameMinesweeperPlayerStatus
  /** 名下安全翻开格子数（计分用；踩雷那一格不计入） */
  opened: number
  /** 踩雷次数 */
  booms: number
  /** 最近一次被判定为在线的时间（用于掉线淘汰） */
  lastAvailableAt: number
}

interface MinesweeperMatchState {
  id: number
  hostId: number
  status: GameMinesweeperMatchStatus
  version: number
  createdAt: number
  /** 等待房间里 = 建房时间；开始后 = 开局时间 */
  startedAt: number
  /** 等待房间里 = 房间到期时间；开始后 = 全局结束时间 */
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameMinesweeperEndReason | null
  durationMs: number
  /** 数组下标即座位（开局后不再增删，轮转按座位循环） */
  players: MinesweeperPlayerState[]
  /** 等待房间中为 null，开始后按 seed 生成 */
  board: MinesweeperBoard | null
  /** 已翻开格下标集合（引擎查询用） */
  openedIndexes: Set<number>
  /** 已翻开格明细（DTO 用，按翻开先后顺序） */
  openedCells: MinesweeperOpenedDto[]
  /** index → 插旗者 userId */
  flags: Map<number, number>
  /** 当前回合持有者（非 playing 为 null） */
  turnUserId: number | null
  /** 当前回合截止时间（毫秒时间戳） */
  turnDeadline: number
  /** 当前回合连续无人有效操作的次数（有效动作归零，达到上限淘汰当前回合玩家） */
  turnSkips: number
  lastAction: MinesweeperLastActionDto | null
  /** 仅供自检脚本固定盘面种子（生产流量恒为 null，开局用随机 seed） */
  forcedSeed: number | null
}

interface MinesweeperInviteState {
  id: number
  matchId: number
  from: MinesweeperUserBriefDto
  to: MinesweeperUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, MinesweeperInviteState>()
const matches = new Map<number, MinesweeperMatchState>()
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
function matchFinished(match: MinesweeperMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: MinesweeperMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function seatOf(match: MinesweeperMatchState, userId: number): number {
  return match.players.findIndex((player) => player.userId === userId)
}

function activeMatchFor(userId: number): MinesweeperMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'finished') continue
    const me = match.players.find((player) => player.userId === userId)
    if (me && (match.status === 'waiting' || me.status === 'playing')) return match
  }
  return null
}

function waitingRoomFor(userId: number): MinesweeperMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

/** 仍在场（status === 'playing'）的玩家，按座位顺序 */
function alivePlayers(match: MinesweeperMatchState): MinesweeperPlayerState[] {
  return match.players.filter((player) => player.status === 'playing')
}

/** 从 fromSeat 起，按座位循环找下一名仍在场的玩家座位；找不到返回 -1 */
function nextAliveSeat(match: MinesweeperMatchState, fromSeat: number): number {
  const total = match.players.length
  for (let offset = 1; offset <= total; offset += 1) {
    const seat = (fromSeat + offset) % total
    if (match.players[seat].status === 'playing') return seat
  }
  return -1
}

/**
 * 用户是否已在 2048 / 斗地主 / 贪吃蛇的房间或对局中（跨游戏互斥的另一半）。
 * 异常时按不忙处理，避免其它游戏模块的问题把扫雷大厅一起拖垮。
 */
function isBusyInOtherGames(userId: number): boolean {
  // 统一走注册表：2048 / 斗地主 / 贪吃蛇 / 跳一跳（排除自己）
  return isUserBusyInOtherGames(userId, 'minesweeper')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

/** 在候选集合里选翻开格数最高者；最高数并列时返回 null（平局） */
function highestOpenedWinner(candidates: Array<{ userId: number; opened: number }>): number | null {
  if (candidates.length === 0) return null
  let best = candidates[0]
  let tie = false
  for (const candidate of candidates.slice(1)) {
    if (candidate.opened > best.opened) {
      best = candidate
      tie = false
    } else if (candidate.opened === best.opened) {
      tie = true
    }
  }
  return tie ? null : best.userId
}

function toInviteDto(invite: MinesweeperInviteState): MinesweeperInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'minesweeper',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

/**
 * 对局 DTO（所有玩家收到同一份，不按观看者裁剪）。
 *
 * 隐藏信息纪律：`opened` 只包含**已经被翻开**的格子，未翻开的雷位绝不出现；
 * 引擎的 minePositions 因此在本模块里完全不被调用（包括终局），
 * 客户端若要做终局复盘，只能依据已翻开格 + 旗子推断。
 */
function toMatchDto(match: MinesweeperMatchState): GameMinesweeperMatchDto {
  const flags = Array.from(match.flags.entries())
    .map(([index, by]) => ({ index, by }))
    .sort((a, b) => a.index - b.index)
  return {
    id: match.id,
    game: 'minesweeper',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    board: {
      width: match.board?.width ?? MS_ONLINE_WIDTH,
      height: match.board?.height ?? MS_ONLINE_HEIGHT,
      mines: match.board?.mines ?? MS_ONLINE_MINES,
    },
    opened: match.openedCells.map((cell) => ({
      index: cell.index,
      mine: cell.mine,
      adjacent: cell.adjacent,
    })),
    flags,
    turn:
      match.status === 'playing' && match.turnUserId !== null
        ? { userId: match.turnUserId, deadline: iso(match.turnDeadline), skips: match.turnSkips }
        : null,
    lastAction: match.lastAction === null ? null : { ...match.lastAction },
    players: match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      online: isGameUserAvailable(player.userId),
      status: player.status,
      opened: player.opened,
      booms: player.booms,
      score: player.opened,
    })),
  }
}

// === 事件推送 ===

function broadcastMatch(match: MinesweeperMatchState, type: MatchEventType): void {
  const dto = toMatchDto(match)
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: dto })
  }
}

function emitInviteToTarget(invite: MinesweeperInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

/** 邀请移除事件发给双方（发出方与接收方都要清理本地弹窗/列表） */
function emitInviteRemoved(invite: MinesweeperInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: MinesweeperInviteState, reason: GameInviteRemovalReason): void {
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
function sortInvites(list: MinesweeperInviteDto[]): MinesweeperInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): MinesweeperInvitesDto {
  const incoming: MinesweeperInviteDto[] = []
  const outgoing: MinesweeperInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createMinesweeperWaitingPlayer(user: MinesweeperUserBriefDto, now: number): MinesweeperPlayerState {
  return {
    userId: user.id,
    username: user.username,
    status: 'waiting',
    opened: 0,
    booms: 0,
    lastAvailableAt: now,
  }
}

/** 创建等待房间（房主已在房间里） */
function createWaitingRoom(
  host: MinesweeperUserBriefDto,
  now: number,
  forcedSeed: number | null = null,
): MinesweeperMatchState {
  const match: MinesweeperMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    createdAt: now,
    startedAt: now,
    endsAt: now + MINESWEEPER_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    durationMs: MINESWEEPER_DEFAULT_DURATION_MS,
    players: [createMinesweeperWaitingPlayer(host, now)],
    board: null,
    openedIndexes: new Set<number>(),
    openedCells: [],
    flags: new Map<number, number>(),
    turnUserId: null,
    turnDeadline: 0,
    turnSkips: 0,
    lastAction: null,
    forcedSeed,
  }
  matches.set(match.id, match)
  return match
}

/**
 * 结束对局并广播 game:match:ended。
 * winnerId === null 表示平局（踩雷全灭 / 超时并列 / 全清并列 / 房间解散）；
 * 客户端应以 `winnerId === null` 判断平局，而不是以单个玩家 status 判断。
 */
function finishMinesweeperMatch(
  match: MinesweeperMatchState,
  reason: GameMinesweeperEndReason,
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

/** 把回合交给座位 fromSeat 之后的下一名在场玩家；deadline 从 expiredDeadline 顺延一个回合时长（便于补齐连续超时） */
function rotateTurn(
  match: MinesweeperMatchState,
  fromSeat: number,
  deadline: number,
): boolean {
  const seat = nextAliveSeat(match, fromSeat)
  if (seat < 0) {
    match.turnUserId = null
    return false
  }
  match.turnUserId = match.players[seat].userId
  match.turnDeadline = deadline
  return true
}

/** 全局超时结算：仍在场的玩家按翻开数判定（并列平局）；无人存活时比较所有玩家 */
function finishByTimeout(match: MinesweeperMatchState, now: number): void {
  const alive = alivePlayers(match)
  const pool = alive.length > 0 ? alive : match.players
  finishMinesweeperMatch(
    match,
    'timeout',
    highestOpenedWinner(pool.map((player) => ({ userId: player.userId, opened: player.opened }))),
    now,
  )
}

/** 全清结算：仍在场的玩家按翻开数判定胜者（并列平局） */
function finishByCleared(match: MinesweeperMatchState, now: number): void {
  const alive = alivePlayers(match)
  const pool = alive.length > 0 ? alive : match.players
  finishMinesweeperMatch(
    match,
    'cleared',
    highestOpenedWinner(pool.map((player) => ({ userId: player.userId, opened: player.opened }))),
    now,
  )
}

/**
 * 淘汰一名玩家（踩雷 / 认输 / 回合超时 / 掉线），起因即结束原因：
 * - 仍有 2+ 人在场 → 对局继续（若淘汰的是当前回合玩家则把回合交给下一名）；
 * - 只剩 1 人在场 → 该玩家获胜；
 * - 全部出局 → 平局（winnerId = null）。
 */
function eliminateMinesweeperPlayer(
  match: MinesweeperMatchState,
  userId: number,
  now: number,
  reason: GameMinesweeperEndReason,
): void {
  const seat = seatOf(match, userId)
  if (seat < 0) return
  const player = match.players[seat]
  if (player.status !== 'playing') return
  player.status = 'lost'

  const alive = alivePlayers(match)
  if (alive.length === 1) {
    finishMinesweeperMatch(match, reason, alive[0].userId, now)
    return
  }
  if (alive.length === 0) {
    finishMinesweeperMatch(match, reason, null, now)
    return
  }
  if (match.turnUserId === userId) rotateTurn(match, seat, now + MINESWEEPER_TURN_MS)
  match.version += 1
  broadcastMatch(match, 'game:match:update')
}

/**
 * 记一次当前回合的超时（turnSkips += 1）：
 * 达到上限 → 当前回合玩家以 forfeit 淘汰（skips 归零，其余人重新计数）；
 * 否则把回合交给下一名在场玩家，新回合 deadline 由已过期的 deadline 顺延一个回合时长，
 * 这样长时间无人操作时一轮结算可以连续处理多名玩家。
 *
 * @returns `rotated` = 只轮到了下一名玩家（调用方负责广播）；
 *          `eliminated` = 淘汰了当前回合玩家（eliminateMinesweeperPlayer 内部已广播）；
 *          `noop` = 回合缺失或持有者已出局，没有记账
 */
function chargeTurnTimeout(match: MinesweeperMatchState, now: number): 'rotated' | 'eliminated' | 'noop' {
  if (match.turnUserId === null) return 'noop'
  const seat = seatOf(match, match.turnUserId)
  if (seat < 0) {
    match.turnUserId = null
    return 'noop'
  }
  const player = match.players[seat]
  if (player.status !== 'playing') {
    rotateTurn(match, seat, now + MINESWEEPER_TURN_MS)
    return 'noop'
  }
  const expiredDeadline = match.turnDeadline
  match.turnSkips += 1
  match.version += 1
  if (match.turnSkips >= MINESWEEPER_MAX_SKIPS) {
    match.turnSkips = 0
    eliminateMinesweeperPlayer(match, player.userId, now, 'forfeit')
    return 'eliminated'
  }
  rotateTurn(match, seat, expiredDeadline + MINESWEEPER_TURN_MS)
  return 'rotated'
}

/**
 * 把一个对局结算到 now 时刻的一致状态（可能连续触发多步）：
 *   1. 等待房间超过 30 分钟未开局 → cancelled 解散；
 *   2. 全局超时（now >= endsAt）→ timeout 按翻开数结算；
 *   3. 掉线超过 120 秒且至少另一名在场玩家在线 → forfeit 淘汰（每轮最多一名）；
 *   4. 回合超时 → skips 累计，达到上限淘汰，否则轮到下一名在场玩家（循环处理）。
 * 状态发生变化时广播（结束广播由 finishMinesweeperMatch 负责）。
 */
function settleMinesweeperMatch(match: MinesweeperMatchState, now: number): void {
  if (match.status === 'waiting') {
    if (now >= match.endsAt) {
      removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
      finishMinesweeperMatch(match, 'cancelled', null, now)
    }
    return
  }
  if (match.status !== 'playing') return

  if (now >= match.endsAt) {
    finishByTimeout(match, now)
    return
  }

  // 掉线：先刷新在线记录，再判断是否有人连续不可用超限
  for (const player of match.players) {
    if (player.status === 'playing' && isGameUserAvailable(player.userId)) player.lastAvailableAt = now
  }
  for (const player of match.players) {
    if (player.status !== 'playing') continue
    if (now - player.lastAvailableAt < MINESWEEPER_DISCONNECT_FORFEIT_MS) continue
    const othersAvailable = match.players.some(
      (candidate) =>
        candidate.userId !== player.userId
        && candidate.status === 'playing'
        && isGameUserAvailable(candidate.userId),
    )
    if (!othersAvailable) continue
    eliminateMinesweeperPlayer(match, player.userId, now, 'forfeit')
    if (matchFinished(match)) return
    break
  }

  // 回合超时：连续多名玩家都可能已经跨过自己的 deadline，循环到一致状态
  let rotated = false
  let guard = 0
  while (
    match.status === 'playing'
    && match.turnUserId !== null
    && now >= match.turnDeadline
    && guard <= MINESWEEPER_MAX_PLAYERS * MINESWEEPER_MAX_SKIPS * 4
  ) {
    guard += 1
    const outcome = chargeTurnTimeout(match, now)
    if (outcome === 'noop') break
    if (outcome === 'eliminated') {
      // 淘汰路径已经自行广播（或对局已结束），不再重复广播
      rotated = false
      if (matchFinished(match)) return
    } else {
      rotated = true
    }
  }
  if (rotated && match.status === 'playing') broadcastMatch(match, 'game:match:update')
}

/**
 * 房主开始游戏：2–4 人，按 seed 生成 12×12 / 22 雷的权威盘面，
 * 座位 0 玩家先手，回合 30 秒、全局 10 分钟。
 * 只允许房主操作；房间已开始 / 已结束时拒绝。
 */
export function startMinesweeperMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameMinesweeperMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < MINESWEEPER_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${MINESWEEPER_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > MINESWEEPER_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${MINESWEEPER_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= MINESWEEPER_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  match.board = createMinesweeperBoard(
    match.forcedSeed ?? randomSeed(),
    MS_ONLINE_WIDTH,
    MS_ONLINE_HEIGHT,
    MS_ONLINE_MINES,
  )
  match.status = 'playing'
  match.startedAt = now
  match.durationMs = MINESWEEPER_DEFAULT_DURATION_MS
  match.endsAt = now + match.durationMs
  match.openedIndexes = new Set<number>()
  match.openedCells = []
  match.flags = new Map<number, number>()
  match.lastAction = null
  match.version += 1
  // 座位在开局时定格；先手为座位 0
  match.players.forEach((player) => {
    player.status = 'playing'
    player.opened = 0
    player.booms = 0
    player.lastAvailableAt = now
  })
  match.turnUserId = match.players[0].userId
  match.turnDeadline = now + MINESWEEPER_TURN_MS
  match.turnSkips = 0
  // 对局开始后不再接受任何邀请
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match) }
}

/**
 * 离开等待房间：房主离开 = 解散房间；普通玩家离开 = 从房间移除。
 * 已开始的对局不能走这个接口（请使用 resign）。
 */
export function leaveMinesweeperMatch(
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
    finishMinesweeperMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishMinesweeperMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

// === 好友大厅 ===

/** GET /api/games/minesweeper/friends */
export async function listMinesweeperFriends(userId: number): Promise<{ friends: MinesweeperFriendDto[] }> {
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

/** GET /api/games/minesweeper/invites */
export function listMinesweeperInvites(userId: number, now: number = Date.now()): MinesweeperInvitesDto {
  return collectInvites(userId, now)
}

/**
 * POST /api/games/minesweeper/invites —— 邀请好友加入自己的 2–4 人等待房间
 *
 * 没有房间时自动创建（发起方为房主）；同一好友重复邀请幂等；
 * 任一方已在 2048 / 斗地主 / 贪吃蛇房间或对局中时拒绝（跨游戏互斥）。
 */
export async function createMinesweeperInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: MinesweeperInviteDto; match: GameMinesweeperMatchDto }> {
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
  if (incomingCount >= MINESWEEPER_MAX_INCOMING_INVITES) {
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
  if (room.players.length >= MINESWEEPER_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${MINESWEEPER_MAX_PLAYERS} 人）`, 409)
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

  const invite: MinesweeperInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + MINESWEEPER_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room) }
}

/** POST /api/games/minesweeper/invites/:id/respond —— 接受 = 加入等待房间（仍由房主统一开始） */
export function respondMinesweeperInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameMinesweeperMatchDto } {
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
  if (room.players.length >= MINESWEEPER_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${MINESWEEPER_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= MINESWEEPER_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 只清理「接受者」相关的其它邀请，保留房主邀请其他好友的邀请
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createMinesweeperWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= MINESWEEPER_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room) }
}

/** DELETE /api/games/minesweeper/invites/:id */
export function cancelMinesweeperInvite(
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

/** GET /api/games/minesweeper/sync —— 轮询降级的统一同步（先清理一轮保证状态新鲜） */
export function getMinesweeperSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): MinesweeperSyncDto {
  runMinesweeperSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: MinesweeperMatchState | null
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

/** GET /api/games/minesweeper/matches/active —— 当前等待房间 / 进行中对局，或 null */
export function getActiveMinesweeperMatch(userId: number, now: number = Date.now()): GameMinesweeperMatchDto | null {
  runMinesweeperSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match)
}

/** GET /api/games/minesweeper/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getMinesweeperMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): GameMinesweeperMatchDto {
  runMinesweeperSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match)
}

// === 对局操作（轮流点：一人只许下一次） ===

/**
 * POST /api/games/minesweeper/matches/:id/actions
 *
 * 只有 `turn.userId` 指向的在场玩家可以操作，一次动作即用掉「这一次」：
 *   - `{ type:'open' }`：洪水展开新格写入 opened；踩到雷则本人与该雷一起淘汰；
 *   - `{ type:'flag' }`：未翻开格切换插/拔旗（拔旗记为 unflag），同样算用掉一次；
 *   - 目标格已翻开 → 宽容返回 `applied:false`（不轮转、不递增版本、不广播，
 *     与 2048 的 `moved:false` / 贪吃蛇的 `applied:false` 口径一致）。
 * 非参与者 404；对局非 playing 409；不是当前回合玩家 409「还没轮到你」；下标越界 400。
 */
export function applyMinesweeperAction(
  userId: number,
  matchId: number,
  action: MinesweeperAction,
  now: number = Date.now(),
): { match: GameMinesweeperMatchDto; applied: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局未开始或已结束', 409)

  // 已超时 / 该掉线的先结算，再判断本局是否仍在进行
  runMinesweeperSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const player = seat < 0 ? null : match.players[seat]
  if (!player || player.status !== 'playing') throw new AppError('你已出局或对局未开始', 409)
  if (match.turnUserId !== userId) throw new AppError('还没轮到你', 409)

  const board = match.board
  if (!board) throw new AppError('对局尚未开始', 409)
  const index = action.index
  if (
    typeof index !== 'number'
    || !Number.isInteger(index)
    || index < 0
    || index >= board.width * board.height
  ) {
    throw new AppError('格子不在棋盘范围内', 400)
  }
  // 已翻开的格子：什么都不做（不轮转），与 2048 的无效移动口径一致
  if (match.openedIndexes.has(index)) return { match: toMatchDto(match), applied: false }

  if (action.type === 'flag') {
    const kind: MinesweeperActionKind = match.flags.has(index) ? 'unflag' : 'flag'
    if (kind === 'flag') match.flags.set(index, userId)
    else match.flags.delete(index)
    match.lastAction = { userId, kind, index }
    match.turnSkips = 0
    match.version += 1
    rotateTurn(match, seat, now + MINESWEEPER_TURN_MS)
    broadcastMatch(match, 'game:match:update')
    return { match: toMatchDto(match), applied: true }
  }

  if (action.type !== 'open') throw new AppError('不支持的操作类型', 400)

  const revealed = revealCells(board, match.openedIndexes, index)
  if (revealed.cells.length === 0) return { match: toMatchDto(match), applied: false }

  for (const cellIndex of revealed.cells) {
    if (match.openedIndexes.has(cellIndex)) continue
    match.openedIndexes.add(cellIndex)
    match.openedCells.push({
      index: cellIndex,
      mine: isMine(board, cellIndex),
      adjacent: adjacentMines(board, cellIndex),
    })
  }
  // 计分只统计安全格（踩雷那一格不算「翻开」，与 DTO 注释「安全翻开格子数」一致）
  player.opened += revealed.mine ? 0 : revealed.cells.length
  match.lastAction = { userId, kind: 'open', index }
  match.turnSkips = 0

  if (revealed.mine) {
    player.booms += 1
    eliminateMinesweeperPlayer(match, userId, now, 'boom')
    return { match: toMatchDto(match), applied: true }
  }

  if (isCleared(board, match.openedIndexes)) {
    finishByCleared(match, now)
    return { match: toMatchDto(match), applied: true }
  }

  match.version += 1
  rotateTurn(match, seat, now + MINESWEEPER_TURN_MS)
  broadcastMatch(match, 'game:match:update')
  return { match: toMatchDto(match), applied: true }
}

/** POST /api/games/minesweeper/matches/:id/resign —— 认输：本人淘汰（不影响已翻开数），其余继续 */
export function resignMinesweeperMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameMinesweeperMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局尚未开始或已结束', 409)

  runMinesweeperSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player || player.status !== 'playing') throw new AppError('你已出局', 409)
  eliminateMinesweeperPlayer(match, userId, now, 'resign')
  return { match: toMatchDto(match) }
}

// === 定时清理（sweeper） ===

/**
 * 执行一轮扫雷清理与结算（已由 registerGameModule 交给 gameService 主 sweeper
 * 每 15 秒调用一次；也导出供 routes / 自检脚本显式触发）：
 *   1. 清理过期邀请与 presence；
 *   2. 逐房间结算（等待解散 / 全局超时 / 掉线淘汰 / 回合超时轮转）；
 *   3. 回收结束超过 5 分钟的对局。
 */
export function runMinesweeperSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    settleMinesweeperMatch(match, now)
  }

  // 回收已结束的对局（保留期 5 分钟，供客户端补拉最终结果）
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= MINESWEEPER_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

/**
 * 兜底清理定时器（可选）：主链路已由 gameService.startGameSweeper() 经
 * registerGameModule 的 sweep 钩子驱动，这里只是多一层保险，重复调用安全。
 */
export function startMinesweeperTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runMinesweeperSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ 扫雷清理定时器已启动（间隔 ${intervalMs}ms）`)
}

/** 停止兜底清理定时器（自检脚本收尾用；重复调用安全） */
function stopMinesweeperTicker(): void {
  if (sweeperTimer !== null) {
    clearInterval(sweeperTimer)
    sweeperTimer = null
  }
}

// === 自检脚本 / 单测入口 ===

/**
 * 仅供 verify 脚本 / 单测使用：跳过好友与可用性校验，直接创建一个包含指定玩家的
 * 等待房间（第一位为房主，其余按加入顺序分配座位）。生产流量请走邀请流程。
 *
 * `options.seed` 只影响开局盘面（便于脚本按同一 seed 复现雷位）；
 * 生产流量恒为 null，即由服务端随机取种。
 */
export function createMinesweeperRoomForTest(
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
    room.players.push(createMinesweeperWaitingPlayer({ id: memberId, username: `u${memberId}` }, now))
  })
  room.version += 1
  return { matchId: room.id }
}

/**
 * 仅供 verify 脚本 / 单测使用：直接登记一条待处理邀请
 * （真实流程需要数据库里的好友关系），便于验证接受 / 拒绝 / 取消与过期语义。
 */
export function createMinesweeperInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: MinesweeperInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + MINESWEEPER_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

/** 仅供自检脚本使用：清空内存状态（含兜底定时器），便于脚本反复运行 */
export function resetMinesweeperStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopMinesweeperTicker()
}

// === 跨游戏互斥注册（2048 / 斗地主 / 贪吃蛇侧发起或接受邀请时会检查这里） ===

function isUserInMinesweeperMatch(userId: number): boolean {
  return activeMatchFor(userId) !== null
}

/** 强制清除该用户在扫雷里的房间 / 对局状态（等待房间离开，进行中认输） */
export function resetMinesweeperUser(userId: number): number {
  return resetUserInMatches(matches.values(), userId, {
    leave: (uid, id) => leaveMinesweeperMatch(uid, id),
    resign: (uid, id) => resignMinesweeperMatch(uid, id),
  })
}

registerGameModule({
  name: 'minesweeper',
  isUserInMatch: isUserInMinesweeperMatch,
  sweep: runMinesweeperSweeper,
  resetUser: resetMinesweeperUser,
})
