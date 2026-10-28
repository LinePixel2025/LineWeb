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
  JUMP_MAX_CHARGE_MS,
  createJumpCourse,
  ensureJumpCourse,
  jumpScore,
  resolveJump,
  type JumpBoxDto,
  type JumpLanding,
} from './gameJump.js'

/**
 * 跳一跳好友联机业务逻辑（内存态，无 Prisma 表）——「轮流各跳一次、同一条盒子路线、比分高低」
 *
 * 架构与 2048 / 斗地主 / 贪吃蛇 / 扫雷联机一致（回合结构逐字对齐 gameMinesweeperService）：
 *   - 房间 / 邀请 / 盒子序列全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：客户端只提交「蓄力毫秒数 chargeMs」，落点、连击、得分、胜负全部由
 *     gameJump 引擎按同一份常量计算（DTO 形状与 client/src/types/game.ts 逐字一致）；
 *   - 实时推送复用聊天 WebSocket（game:invite / game:invite:removed /
 *     game:match:started|update|ended），无 WebSocket 时客户端用 `sync` 轮询 + `presence`
 *     心跳降级；在线判定统一走 gameService.isGameUserAvailable；
 *   - 回合制：只有 `turn.userId` 指向的玩家可跳，一跳即用掉「这一次」，随后轮到下一名
 *     存活玩家；回合 deadline 20 秒，超时由 sweeper 自动以近乎 0 蓄力起跳（必判 short
 *     落空淘汰）；
 *   - 淘汰制：落空 / 回合超时 / 认输 / 掉线 → 该玩家出局；只剩 1 名存活 → 其获胜
 *     （last_standing / forfeit / resign，取决于淘汰起因）；全员淘汰 → 按分数判（elimination）；
 *     全局 6 分钟超时 → 存活者中分数最高者胜（并列平局）；
 *   - 盒子序列对所有玩家可见（无隐藏信息），按开局 seed 确定性生成，玩家前进到接近
 *     末尾时用 ensureJumpCourse 续生成，续生成绝不改变已有盒子。
 *
 * 跨游戏互斥：通过 registerGameModule 注册 isUserInMatch 探针与 sweep 钩子，
 * 2048 侧发起或接受邀请时会检查这里；本模块反过来检查 2048 / 斗地主 / 贪吃蛇。
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒（与 2048 / 斗地主 / 贪吃蛇 / 扫雷共用同一口径） */
export const JUMP_INVITE_TTL_MS = GAME_INVITE_TTL_MS
/** 房间最少开局人数 */
export const JUMP_MIN_PLAYERS = 2
/** 房间人数上限 */
export const JUMP_MAX_PLAYERS = 6
/** 默认对局时长：6 分钟（房主开始即固定，全局超时按分数结算） */
export const JUMP_DEFAULT_DURATION_MS = 6 * 60_000
/** 单个回合时长：20 秒（超时自动近乎 0 蓄力起跳 → short 落空淘汰） */
export const JUMP_TURN_MS = 20_000
/** 回合超时自动起跳的蓄力毫秒数（1ms → 距离 0.13，远小于任何 gap，必判 short） */
export const JUMP_TURN_TIMEOUT_AUTO_MS = 1
/** 等待房间最长存活时间：30 分钟（超时未开局解散） */
export const JUMP_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
/** 已结束对局保留期：5 分钟（供客户端补拉最终结果） */
export const JUMP_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
/** 连续不可用超过该时长且至少另一名玩家在线 → 淘汰：120 秒 */
export const JUMP_DISCONNECT_FORFEIT_MS = GAME_DISCONNECT_FORFEIT_MS
/** 同时进行的跳一跳房间/对局上限 */
export const JUMP_MAX_ACTIVE_MATCHES = 200
/** 单个用户最多收到的待处理邀请数 */
export const JUMP_MAX_INCOMING_INVITES = 5
/** 开局生成的初始盒子数量 */
export const JUMP_INITIAL_BOXES = 40
/** 续生成步长：盒子不够时补足到 boxIndex + 该值 */
export const JUMP_BOX_EXTENSION = 40
/** 领先玩家距序列末尾不足该盒数时触发续生成 */
export const JUMP_BOX_LOOKAHEAD = 5
/** 蓄力下限（毫秒，与 config 里 zod 的 min(1) 一致，服务层防御性复核） */
export const JUMP_MIN_CHARGE_MS = 1

// === DTO（与前端 client/src/types/game.ts 逐字对齐，时间为 ISO 字符串） ===

export type GameJumpMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameJumpPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameJumpEndReason =
  | 'last_standing'
  | 'elimination'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'cancelled'

export interface JumpUserBriefDto {
  id: number
  username: string
}

export interface JumpInviteDto {
  id: number
  matchId: number
  game: 'jump'
  from: JumpUserBriefDto
  to: JumpUserBriefDto
  createdAt: string
  expiresAt: string
}

/** 当前回合：只有一个持有者，deadline 为该玩家的回合截止时间 */
export interface JumpTurnDto {
  userId: number
  deadline: string
}

/** 上一次跳跃结果（所有玩家看到同一份；盒子序列无隐藏信息） */
export interface JumpLastResultDto {
  userId: number
  kind: JumpLanding
  gained: number
  offset: number
  scoreAfter: number
  comboAfter: number
}

export interface GameJumpPlayerDto {
  userId: number
  username: string
  online: boolean
  status: GameJumpPlayerStatus
  score: number
  /** 连续中心命中次数（连击） */
  combo: number
  /** 已跳次数 */
  jumps: number
  /** 当前所站盒子序号（掉出则为 null） */
  boxIndex: number | null
  /** 落点偏移（逻辑单位，右为正；未跳为 null） */
  offset: number | null
}

export interface GameJumpMatchDto {
  id: number
  game: 'jump'
  hostId: number
  status: GameJumpMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameJumpEndReason | null
  /** 共享盒子序列（服务端按 seed 生成，长度随对局推进增长） */
  boxes: JumpBoxDto[]
  /** 非 playing 状态固定为 null */
  turn: JumpTurnDto | null
  lastResult: JumpLastResultDto | null
  /** 按座位顺序 */
  players: GameJumpPlayerDto[]
}

export interface JumpFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface JumpInvitesDto {
  incoming: JumpInviteDto[]
  outgoing: JumpInviteDto[]
}

export interface JumpSyncDto {
  serverTime: string
  invites: JumpInvitesDto
  match: GameJumpMatchDto | null
}

/** POST /api/games/jump/matches/:id/actions 的动作体（蓄力毫秒数） */
export interface JumpAction {
  type: 'jump'
  chargeMs: number
}

// === 内部状态 ===

interface JumpPlayerState {
  userId: number
  username: string
  status: GameJumpPlayerStatus
  score: number
  combo: number
  jumps: number
  /** 当前所站盒子下标；等待房间与被淘汰时为 null */
  boxIndex: number | null
  /** 最近一次跳跃的落点偏移；未跳为 null（淘汰后保留，供客户端播放坠落动画） */
  offset: number | null
  /** 最近一次被判定为在线的时间（用于掉线淘汰） */
  lastAvailableAt: number
}

interface JumpMatchState {
  id: number
  hostId: number
  status: GameJumpMatchStatus
  version: number
  /** 等待房间里 = 建房时间；开始后 = 开局时间 */
  startedAt: number
  /** 等待房间里 = 房间到期时间；开始后 = 全局结束时间 */
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameJumpEndReason | null
  durationMs: number
  /** 数组下标即座位（开局后不再增删，轮转按座位循环） */
  players: JumpPlayerState[]
  /** 开局种子（等待房间中为 null；盒子序列的确定性续生成依赖它） */
  seed: number | null
  boxes: JumpBoxDto[]
  /** 当前回合持有者（非 playing 为 null） */
  turnUserId: number | null
  /** 当前回合截止时间（毫秒时间戳） */
  turnDeadline: number
  lastResult: JumpLastResultDto | null
  /** 仅供自检脚本固定盒子序列种子（生产流量恒为 null，开局用随机 seed） */
  forcedSeed: number | null
}

interface JumpInviteState {
  id: number
  matchId: number
  from: JumpUserBriefDto
  to: JumpUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, JumpInviteState>()
const matches = new Map<number, JumpMatchState>()
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
function matchFinished(match: JumpMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: JumpMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function seatOf(match: JumpMatchState, userId: number): number {
  return match.players.findIndex((player) => player.userId === userId)
}

function activeMatchFor(userId: number): JumpMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'finished') continue
    const me = match.players.find((player) => player.userId === userId)
    if (me && (match.status === 'waiting' || me.status === 'playing')) return match
  }
  return null
}

function waitingRoomFor(userId: number): JumpMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

/** 仍在场（status === 'playing'）的玩家，按座位顺序 */
function alivePlayers(match: JumpMatchState): JumpPlayerState[] {
  return match.players.filter((player) => player.status === 'playing')
}

/** 从 fromSeat 起，按座位循环找下一名仍在场的玩家座位；找不到返回 -1 */
function nextAliveSeat(match: JumpMatchState, fromSeat: number): number {
  const total = match.players.length
  for (let offset = 1; offset <= total; offset += 1) {
    const seat = (fromSeat + offset) % total
    if (match.players[seat].status === 'playing') return seat
  }
  return -1
}

/**
 * 用户是否已在 2048 / 斗地主 / 贪吃蛇的房间或对局中（跨游戏互斥的另一半）。
 * 异常时按不忙处理，避免其它游戏模块的问题把跳一跳大厅一起拖垮。
 */
function isBusyInOtherGames(userId: number): boolean {
  // 统一走注册表：2048 / 斗地主 / 贪吃蛇 / 扫雷（排除自己）
  return isUserBusyInOtherGames(userId, 'jump')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

/** 在候选集合里选分数最高者；最高分并列时返回 null（平局） */
function highestScoreWinner(candidates: Array<{ userId: number; score: number }>): number | null {
  if (candidates.length === 0) return null
  let best = candidates[0]
  let tie = false
  for (const candidate of candidates.slice(1)) {
    if (candidate.score > best.score) {
      best = candidate
      tie = false
    } else if (candidate.score === best.score) {
      tie = true
    }
  }
  return tie ? null : best.userId
}

function toInviteDto(invite: JumpInviteState): JumpInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'jump',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

/** 对局 DTO（所有玩家收到同一份，不按观看者裁剪；盒子序列无隐藏信息） */
function toMatchDto(match: JumpMatchState): GameJumpMatchDto {
  return {
    id: match.id,
    game: 'jump',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    boxes: match.boxes.map((box) => ({ ...box })),
    turn:
      match.status === 'playing' && match.turnUserId !== null
        ? { userId: match.turnUserId, deadline: iso(match.turnDeadline) }
        : null,
    lastResult: match.lastResult === null ? null : { ...match.lastResult },
    players: match.players.map((player) => ({
      userId: player.userId,
      username: player.username,
      online: isGameUserAvailable(player.userId),
      status: player.status,
      score: player.score,
      combo: player.combo,
      jumps: player.jumps,
      boxIndex: player.boxIndex,
      offset: player.offset,
    })),
  }
}

// === 事件推送 ===

function broadcastMatch(match: JumpMatchState, type: MatchEventType): void {
  const dto = toMatchDto(match)
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: dto })
  }
}

function emitInviteToTarget(invite: JumpInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

/** 邀请移除事件发给双方（发出方与接收方都要清理本地弹窗/列表） */
function emitInviteRemoved(invite: JumpInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: JumpInviteState, reason: GameInviteRemovalReason): void {
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
function sortInvites(list: JumpInviteDto[]): JumpInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): JumpInvitesDto {
  const incoming: JumpInviteDto[] = []
  const outgoing: JumpInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 房间 / 对局生命周期 ===

function createJumpWaitingPlayer(user: JumpUserBriefDto, now: number): JumpPlayerState {
  return {
    userId: user.id,
    username: user.username,
    status: 'waiting',
    score: 0,
    combo: 0,
    jumps: 0,
    boxIndex: null,
    offset: null,
    lastAvailableAt: now,
  }
}

/** 创建等待房间（房主已在房间里） */
function createWaitingRoom(
  host: JumpUserBriefDto,
  now: number,
  forcedSeed: number | null = null,
): JumpMatchState {
  const match: JumpMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    startedAt: now,
    endsAt: now + JUMP_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    durationMs: JUMP_DEFAULT_DURATION_MS,
    players: [createJumpWaitingPlayer(host, now)],
    seed: null,
    boxes: [],
    turnUserId: null,
    turnDeadline: 0,
    lastResult: null,
    forcedSeed,
  }
  matches.set(match.id, match)
  return match
}

/**
 * 结束对局并广播 game:match:ended。
 * winnerId === null 表示平局（全员淘汰同分 / 全局超时同分 / 房间解散）；
 * 客户端应以 `winnerId === null` 判断平局，而不是以单个玩家 status 判断。
 */
function finishJumpMatch(
  match: JumpMatchState,
  reason: GameJumpEndReason,
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
function rotateTurn(match: JumpMatchState, fromSeat: number, deadline: number): boolean {
  const seat = nextAliveSeat(match, fromSeat)
  if (seat < 0) {
    match.turnUserId = null
    return false
  }
  match.turnUserId = match.players[seat].userId
  match.turnDeadline = deadline
  return true
}

/** 全局超时结算：仍在场的玩家按分数判定（并列平局）；无人存活时比较所有玩家 */
function finishByTimeout(match: JumpMatchState, now: number): void {
  const alive = alivePlayers(match)
  const pool = alive.length > 0 ? alive : match.players
  finishJumpMatch(
    match,
    'timeout',
    highestScoreWinner(pool.map((player) => ({ userId: player.userId, score: player.score }))),
    now,
  )
}

/**
 * 淘汰一名玩家（落空 / 认输 / 回合超时 / 掉线）：
 * - 仍有 2+ 人在场 → 对局继续（若淘汰的是当前回合玩家则把回合交给下一名）；
 * - 只剩 1 人在场 → 该玩家获胜，结束原因取 lastStandingReason（落空为 last_standing，
 *   超时/掉线为 forfeit，认输为 resign）；
 * - 全部出局 → 按分数判（allDeadReason，通常仅落空路径可达：elimination，同分平局）。
 */
function eliminateJumpPlayer(
  match: JumpMatchState,
  userId: number,
  now: number,
  lastStandingReason: GameJumpEndReason,
  allDeadReason: GameJumpEndReason,
  nextDeadline: number = now + JUMP_TURN_MS,
): void {
  const seat = seatOf(match, userId)
  if (seat < 0) return
  const player = match.players[seat]
  if (player.status !== 'playing') return
  player.status = 'lost'
  player.boxIndex = null
  player.combo = 0

  const alive = alivePlayers(match)
  if (alive.length === 1) {
    finishJumpMatch(match, lastStandingReason, alive[0].userId, now)
    return
  }
  if (alive.length === 0) {
    finishJumpMatch(
      match,
      allDeadReason,
      highestScoreWinner(match.players.map((candidate) => ({ userId: candidate.userId, score: candidate.score }))),
      now,
    )
    return
  }
  if (match.turnUserId === userId) rotateTurn(match, seat, nextDeadline)
  match.version += 1
  broadcastMatch(match, 'game:match:update')
}

/**
 * 执行一次权威跳跃（动作与回合超时自动起跳共用）。
 *
 * 落点判定的 size 口径：**统一用目标盒（boxes[boxIndex + 1]）的 size**——
 * 即「落点所在盒」的半宽容差，与引擎 resolveJump 的 size 参数注释一致；
 * gap 同样取目标盒的 gap（与上一盒的中心间距）。
 *
 * @param nextDeadline 落空淘汰后新回合的 deadline（回合超时路径传入顺延值以支持连续结算）
 * @returns 本次跳跃的落点（调用方可据此区分命中 / 落空）
 */
function performJump(
  match: JumpMatchState,
  userId: number,
  chargeMs: number,
  now: number,
  lastStandingReason: GameJumpEndReason,
  allDeadReason: GameJumpEndReason,
  nextDeadline: number,
): JumpLanding {
  const seat = seatOf(match, userId)
  const player = match.players[seat]
  // 玩家前进到接近序列末尾时先按同一 seed 续生成（ensureJumpCourse 幂等，绝不改变已有前缀）
  const currentBox = player.boxIndex ?? 0
  if (match.seed !== null && currentBox + JUMP_BOX_LOOKAHEAD >= match.boxes.length) {
    match.boxes = ensureJumpCourse(match.boxes, match.seed, currentBox + JUMP_BOX_EXTENSION)
  }
  const target = match.boxes[currentBox + 1]
  const landing = resolveJump(chargeMs, target.gap, target.size)
  const { comboAfter, gained } = jumpScore(player.combo, landing.kind)

  player.jumps += 1
  player.offset = landing.offset
  if (landing.kind === 'center' || landing.kind === 'normal') {
    // 命中：前进一格，计分与连击按引擎结果更新
    player.boxIndex = (player.boxIndex ?? 0) + 1
    player.score += gained
    player.combo = comboAfter
  }

  match.lastResult = {
    userId,
    kind: landing.kind,
    gained,
    offset: landing.offset,
    scoreAfter: player.score,
    comboAfter,
  }
  match.version += 1

  if (landing.kind !== 'center' && landing.kind !== 'normal') {
    // 落空（short / long / off）：淘汰该玩家（boxIndex 置 null、连击归零在淘汰函数内完成）
    eliminateJumpPlayer(match, userId, now, lastStandingReason, allDeadReason, nextDeadline)
    return landing.kind
  }

  rotateTurn(match, seat, now + JUMP_TURN_MS)
  broadcastMatch(match, 'game:match:update')
  return landing.kind
}

/**
 * 结算一次回合超时：当前回合玩家自动以近乎 0 蓄力起跳 → 必判 short 落空淘汰。
 *
 * @returns `eliminated` = 已淘汰当前回合玩家（performJump 内部已广播或已结束对局）；
 *          `noop` = 回合缺失或持有者已出局，没有记账
 */
function chargeJumpTurnTimeout(match: JumpMatchState, now: number): 'eliminated' | 'noop' {
  if (match.turnUserId === null) return 'noop'
  const seat = seatOf(match, match.turnUserId)
  if (seat < 0) {
    match.turnUserId = null
    return 'noop'
  }
  const player = match.players[seat]
  if (player.status !== 'playing') {
    rotateTurn(match, seat, now + JUMP_TURN_MS)
    return 'noop'
  }
  // 新回合 deadline 由已过期的 deadline 顺延一个回合时长，
  // 这样长时间无人操作时一轮结算可以连续处理多名玩家
  const expiredDeadline = match.turnDeadline
  performJump(match, player.userId, JUMP_TURN_TIMEOUT_AUTO_MS, now, 'forfeit', 'forfeit', expiredDeadline + JUMP_TURN_MS)
  return 'eliminated'
}

/**
 * 把一个对局结算到 now 时刻的一致状态（可能连续触发多步）：
 *   1. 等待房间超过 30 分钟未开局 → cancelled 解散；
 *   2. 全局超时（now >= endsAt）→ timeout 按分数结算；
 *   3. 掉线超过 120 秒且至少另一名在场玩家在线 → forfeit 淘汰（每轮最多一名）；
 *   4. 回合超时 → 自动 short 落空淘汰并轮转（循环处理，每名超时玩家都会被结算）。
 * 状态发生变化时广播（结束广播由 finishJumpMatch 负责）。
 */
function settleJumpMatch(match: JumpMatchState, now: number): void {
  if (match.status === 'waiting') {
    if (now >= match.endsAt) {
      removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
      finishJumpMatch(match, 'cancelled', null, now)
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
    if (now - player.lastAvailableAt < JUMP_DISCONNECT_FORFEIT_MS) continue
    const othersAvailable = match.players.some(
      (candidate) =>
        candidate.userId !== player.userId
        && candidate.status === 'playing'
        && isGameUserAvailable(candidate.userId),
    )
    if (!othersAvailable) continue
    eliminateJumpPlayer(match, player.userId, now, 'forfeit', 'forfeit')
    if (matchFinished(match)) return
    break
  }

  // 回合超时：连续多名玩家都可能已经跨过自己的 deadline，循环到一致状态
  // （每次超时都会淘汰一名玩家，循环上限取座位数即可）
  let guard = 0
  while (
    match.status === 'playing'
    && match.turnUserId !== null
    && now >= match.turnDeadline
    && guard <= JUMP_MAX_PLAYERS * 2
  ) {
    guard += 1
    const outcome = chargeJumpTurnTimeout(match, now)
    if (outcome === 'noop') break
  }
}

// === 对外 API ===

/**
 * 房主开始游戏：2–6 人，随机 seed 生成 40 个盒子的共享路线，
 * 所有人从 boxIndex 0 起步，座位 0 先跳（回合 20 秒）、全局 6 分钟。
 * 只允许房主操作；房间已开始 / 已结束时拒绝。
 */
export function startJumpMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameJumpMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < JUMP_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${JUMP_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > JUMP_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${JUMP_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= JUMP_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  match.seed = match.forcedSeed ?? randomSeed()
  match.boxes = createJumpCourse(match.seed, JUMP_INITIAL_BOXES)
  match.status = 'playing'
  match.startedAt = now
  match.durationMs = JUMP_DEFAULT_DURATION_MS
  match.endsAt = now + match.durationMs
  match.lastResult = null
  match.version += 1
  // 座位在开局时定格；先手为座位 0
  match.players.forEach((player) => {
    player.status = 'playing'
    player.score = 0
    player.combo = 0
    player.jumps = 0
    player.boxIndex = 0
    player.offset = null
    player.lastAvailableAt = now
  })
  match.turnUserId = match.players[0].userId
  match.turnDeadline = now + JUMP_TURN_MS
  // 对局开始后不再接受任何邀请
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  broadcastMatch(match, 'game:match:started')
  return { match: toMatchDto(match) }
}

/**
 * 离开等待房间：房主离开 = 解散房间；普通玩家离开 = 从房间移除。
 * 已开始的对局不能走这个接口（请使用 resign）。
 */
export function leaveJumpMatch(
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
    finishJumpMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishJumpMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update')
  return { ok: true, dissolved: false }
}

/** GET /api/games/jump/friends */
export async function listJumpFriends(userId: number): Promise<{ friends: JumpFriendDto[] }> {
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

/** GET /api/games/jump/invites */
export function listJumpInvites(userId: number, now: number = Date.now()): JumpInvitesDto {
  return collectInvites(userId, now)
}

/**
 * POST /api/games/jump/invites —— 邀请好友加入自己的 2–6 人等待房间
 *
 * 没有房间时自动创建（发起方为房主）；同一好友重复邀请幂等；
 * 任一方已在 2048 / 斗地主 / 贪吃蛇房间或对局中时拒绝（跨游戏互斥）。
 */
export async function createJumpInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: JumpInviteDto; match: GameJumpMatchDto }> {
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
  if (incomingCount >= JUMP_MAX_INCOMING_INVITES) {
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
  if (room.players.length >= JUMP_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${JUMP_MAX_PLAYERS} 人）`, 409)
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

  const invite: JumpInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + JUMP_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room) }
}

/** POST /api/games/jump/invites/:id/respond —— 接受 = 加入等待房间（仍由房主统一开始） */
export function respondJumpInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameJumpMatchDto } {
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
  if (room.players.length >= JUMP_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${JUMP_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= JUMP_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 只清理「接受者」相关的其它邀请，保留房主邀请其他好友的邀请
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(createJumpWaitingPlayer({ id: invite.to.id, username: invite.to.username }, now))
  room.version += 1
  if (room.players.length >= JUMP_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update')
  return { ok: true, match: toMatchDto(room) }
}

/** DELETE /api/games/jump/invites/:id */
export function cancelJumpInvite(
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

/** GET /api/games/jump/sync —— 轮询降级的统一同步（先清理一轮保证状态新鲜） */
export function getJumpSync(
  userId: number,
  matchId?: number,
  now: number = Date.now(),
): JumpSyncDto {
  runJumpSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: JumpMatchState | null
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

/** GET /api/games/jump/matches/active —— 当前等待房间 / 进行中对局，或 null */
export function getActiveJumpMatch(userId: number, now: number = Date.now()): GameJumpMatchDto | null {
  runJumpSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match)
}

/** GET /api/games/jump/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getJumpMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): GameJumpMatchDto {
  runJumpSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match)
}

/**
 * POST /api/games/jump/matches/:id/actions
 *
 * 只有 `turn.userId` 指向的在场玩家可以起跳，一跳即用掉「这一次」：
 *   - 命中（center / normal）：前进一格并按引擎计分（中心连击 2/4/8/16/32 封顶，普通 +1）；
 *   - 落空（short / long）：该玩家淘汰（boxIndex=null、连击归零，offset 保留）；
 *   - 淘汰后只剩 1 名存活 → last_standing 决出胜者；全员淘汰 → elimination 按分数判。
 * 非参与者 404；对局非 playing 409；不是当前回合玩家 409「还没轮到你」；
 * 已出局 409；chargeMs 越界（< 1 或 > 2000）400（与 config 里 zod 口径一致，防御性复核）。
 */
export function applyJumpAction(
  userId: number,
  matchId: number,
  action: JumpAction,
  now: number = Date.now(),
): { match: GameJumpMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局未开始或已结束', 409)

  // 已超时 / 该掉线的先结算，再判断本局是否仍在进行
  runJumpSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const seat = seatOf(match, userId)
  const player = seat < 0 ? null : match.players[seat]
  if (!player || player.status !== 'playing') throw new AppError('你已出局或对局未开始', 409)
  if (match.turnUserId !== userId) throw new AppError('还没轮到你', 409)
  if (action.type !== 'jump') throw new AppError('不支持的操作类型', 400)
  if (
    typeof action.chargeMs !== 'number'
    || !Number.isFinite(action.chargeMs)
    || action.chargeMs < JUMP_MIN_CHARGE_MS
    || action.chargeMs > JUMP_MAX_CHARGE_MS
  ) {
    throw new AppError(`蓄力时长需在 ${JUMP_MIN_CHARGE_MS}–${JUMP_MAX_CHARGE_MS} 毫秒之间`, 400)
  }

  performJump(match, userId, action.chargeMs, now, 'last_standing', 'elimination', now + JUMP_TURN_MS)
  return { match: toMatchDto(match) }
}

/** POST /api/games/jump/matches/:id/resign —— 认输：本人淘汰（分数保留），其余继续 */
export function resignJumpMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameJumpMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局尚未开始或已结束', 409)

  runJumpSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player || player.status !== 'playing') throw new AppError('你已出局', 409)
  eliminateJumpPlayer(match, userId, now, 'resign', 'resign')
  return { match: toMatchDto(match) }
}

// === 定时清理（sweeper） ===

/**
 * 执行一轮跳一跳清理与结算（已由 registerGameModule 交给 gameService 主 sweeper
 * 每 15 秒调用一次；也导出供 routes / 自检脚本显式触发）：
 *   1. 清理过期邀请与 presence；
 *   2. 逐房间结算（等待解散 / 全局超时 / 掉线淘汰 / 回合超时自动 short）；
 *   3. 回收结束超过 5 分钟的对局。
 */
export function runJumpSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    settleJumpMatch(match, now)
  }

  // 回收已结束的对局（保留期 5 分钟，供客户端补拉最终结果）
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= JUMP_FINISHED_RETENTION_MS
    ) {
      matches.delete(match.id)
    }
  }
}

/**
 * 兜底清理定时器（可选）：主链路已由 gameService.startGameSweeper() 经
 * registerGameModule 的 sweep 钩子驱动，这里只是多一层保险，重复调用安全。
 */
export function startJumpTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runJumpSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ 跳一跳清理定时器已启动（间隔 ${intervalMs}ms）`)
}

/** 停止兜底清理定时器（自检脚本收尾用；重复调用安全） */
function stopJumpTicker(): void {
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
 * `options.seed` 只影响开局盒子序列（便于脚本按同一 seed 复现路线）；
 * 生产流量恒为 null，即由服务端随机取种。
 */
export function createJumpRoomForTest(
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
    room.players.push(createJumpWaitingPlayer({ id: memberId, username: `u${memberId}` }, now))
  })
  room.version += 1
  return { matchId: room.id }
}

/**
 * 仅供 verify 脚本 / 单测使用：直接登记一条待处理邀请
 * （真实流程需要数据库里的好友关系），便于验证接受 / 拒绝 / 取消与过期语义。
 */
export function createJumpInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: JumpInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + JUMP_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

/** 仅供自检脚本使用：清空内存状态（含兜底定时器），便于脚本反复运行 */
export function resetJumpStateForTest(): void {
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopJumpTicker()
}

// === 跨游戏互斥注册（2048 / 斗地主 / 贪吃蛇 / 扫雷侧发起或接受邀请时会检查这里） ===

function isUserInJumpMatch(userId: number): boolean {
  return activeMatchFor(userId) !== null
}

/** 强制清除该用户在跳一跳里的房间 / 对局状态（等待房间离开，进行中认输） */
export function resetJumpUser(userId: number): number {
  return resetUserInMatches(matches.values(), userId, {
    leave: (uid, id) => leaveJumpMatch(uid, id),
    resign: (uid, id) => resignJumpMatch(uid, id),
  })
}

registerGameModule({
  name: 'jump',
  isUserInMatch: isUserInJumpMatch,
  sweep: runJumpSweeper,
  resetUser: resetJumpUser,
})
