import { AppError } from '../middleware/errorHandler.js'
import { areFriends, getUserBrief, listFriends } from './chatService.js'
import { sendToUser } from './chatHub.js'
import { pruneGamePresence } from './gamePresence.js'
import { nextGameInviteId } from './gameIds.js'
import { resetUserInMatches } from './gameExit.js'
import { publishGameEnd } from './gameStatsHooks.js'
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
  SNAKE_MAP_HEIGHT,
  SNAKE_MAP_WIDTH,
  SNAKE_SPAWN_POINTS,
  SNAKE_STEP_MS,
  countAliveSnakes,
  createSnakeWorld,
  setSnakeTurn,
  stepSnakeWorld,
  type SnakeDirection,
  type SnakeWorld,
  type SnakeWorldPlayer,
} from './gameSnake.js'

/**
 * 贪吃蛇大地图好友联机业务逻辑（内存态，无 Prisma 表）
 *
 * 架构与 2048 / 斗地主联机一致：
 *   - 房间 / 邀请 / 世界全部保存在服务进程内存，重启即失效；
 *   - 服务端权威：客户端只提交方向（turn），蛇身、果实、得分、胜负全部由服务端计算；
 *   - 实时推送复用聊天 WebSocket（game:invite / game:invite:removed /
 *     game:match:started|update|ended），无 WebSocket 时客户端用 `sync` 轮询 +
 *     `presence` 心跳降级；在线判定统一走 gameService.isGameUserAvailable；
 *   - 与 2048 / 斗地主的关键差异：
 *     1) 房间 2–8 人，房主开始后按 seed 生成 40×40 大地图世界，8 个固定出生点按座位分配；
 *     2) 服务端每 SNAKE_STEP_MS 自动推进一步（每个 playing 房间一个 unref 定时器），
 *        而不是等玩家动作；玩家动作只写入 pendingDirection；
 *     3) 大地图无隐藏信息 —— 所有玩家收到同一份世界 DTO（不按观看者裁剪）；
 *     4) 淘汰制：撞墙 / 撞身 / 蛇头相撞即出局，只剩 1 人时该玩家获胜。
 *
 * 跨游戏互斥：通过 registerGameModule 注册 isUserInMatch 探针与 sweep 钩子，
 * 2048 侧发起 / 接受邀请时会检查这里；本模块反过来检查 2048 与斗地主的活跃对局。
 */

// === 时效与容量参数 ===

/** 邀请有效期：60 秒（与 2048 / 斗地主共用同一口径） */
export const SNAKE_INVITE_TTL_MS = GAME_INVITE_TTL_MS
/** 房间最少开局人数 */
export const SNAKE_MIN_PLAYERS = 2
/** 房间人数上限（等于出生点数量 8） */
export const SNAKE_MAX_PLAYERS = SNAKE_SPAWN_POINTS.length
/** 默认对局时长：5 分钟（房主开始即固定，超时按分数结算） */
export const SNAKE_DEFAULT_DURATION_MS = 5 * 60_000
/** 等待房间最长存活时间：30 分钟（超时未开局解散） */
export const SNAKE_WAITING_ROOM_TTL_MS = GAME_WAITING_ROOM_TTL_MS
/** 已结束对局保留期：5 分钟（供客户端补拉最终结果） */
export const SNAKE_FINISHED_RETENTION_MS = GAME_FINISHED_RETENTION_MS
/** 连续不可用超过该时长且至少另一名玩家可用 → 淘汰：120 秒 */
export const SNAKE_DISCONNECT_FORFEIT_MS = GAME_DISCONNECT_FORFEIT_MS
/** 同时进行的贪吃蛇房间/对局上限 */
export const SNAKE_MAX_ACTIVE_MATCHES = 200
/** 单个用户最多收到的待处理邀请数 */
export const SNAKE_MAX_INCOMING_INVITES = 5

// === DTO（与前端 client/src/types/game.ts 对齐，时间为 ISO 字符串） ===

export type GameSnakeMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameSnakePlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameSnakeEndReason =
  | 'last_standing'
  | 'elimination'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'cancelled'

export interface SnakeUserBriefDto {
  id: number
  username: string
}

export interface SnakeInviteDto {
  id: number
  matchId: number
  game: 'snake'
  from: SnakeUserBriefDto
  to: SnakeUserBriefDto
  createdAt: string
  expiresAt: string
}

export interface SnakeCellDto {
  x: number
  y: number
}

export interface SnakeFoodDto extends SnakeCellDto {
  big: boolean
}

/** 最近一次事件（吃果 / 死亡）；step 与世界步数同为「已执行步数」口径 */
export interface SnakeLastEventDto {
  kind: 'eat' | 'dead'
  userId: number
  step: number
}

export interface GameSnakePlayerDto {
  userId: number
  username: string
  online: boolean
  status: GameSnakePlayerStatus
  /** 蛇身配色索引（0–7，由座位决定） */
  colorIndex: number
  /** 蛇身（头部在前）；已出局为空数组 */
  body: SnakeCellDto[]
  /** 服务端当前生效方向 */
  direction: SnakeDirection
  /** 已提交、下一步生效的方向（无则 null） */
  pendingDirection: SnakeDirection | null
  score: number
  /** 当前蛇身长度（等价于 body.length） */
  length: number
  /** 死亡步数（未死亡为 null） */
  deathStep: number | null
}

export interface GameSnakeMatchDto {
  id: number
  game: 'snake'
  hostId: number
  status: GameSnakeMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameSnakeEndReason | null
  /** 大地图尺寸 */
  board: { width: number; height: number }
  /** 服务端步进间隔（毫秒） */
  stepMs: number
  /** 已执行步数 */
  step: number
  /** 距对局结束的剩余毫秒（服务端算，客户端不自己减） */
  remainingMs: number
  foods: SnakeFoodDto[]
  /** 按座位顺序（与 colorIndex 一致） */
  players: GameSnakePlayerDto[]
  lastEvent: SnakeLastEventDto | null
}

export interface SnakeFriendDto {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

export interface SnakeInvitesDto {
  incoming: SnakeInviteDto[]
  outgoing: SnakeInviteDto[]
}

export interface SnakeSyncDto {
  serverTime: string
  invites: SnakeInvitesDto
  match: GameSnakeMatchDto | null
}

/** POST /api/games/snake/matches/:id/actions 的动作体 */
export type SnakeAction = { type: 'turn'; direction: SnakeDirection }

// === 内部状态 ===

interface SnakePlayerState {
  userId: number
  username: string
  /** 配色索引（开局前为加入顺序，开局时按最终座位重排） */
  colorIndex: number
  status: GameSnakePlayerStatus
  /** 最近一次被判定为可用的时间（用于掉线淘汰） */
  lastAvailableAt: number
}

interface SnakeMatchState {
  id: number
  hostId: number
  status: GameSnakeMatchStatus
  version: number
  createdAt: number
  /** 等待房间里 = 建房时间；开始后 = 开局时间 */
  startedAt: number
  /** 等待房间里 = 房间到期时间；开始后 = 对局结束时间 */
  endsAt: number
  endedAt: number | null
  winnerId: number | null
  reason: GameSnakeEndReason | null
  durationMs: number
  /** 数组下标即座位（开局后不再增删，保证与世界蛇位一一对应） */
  players: SnakePlayerState[]
  /** 等待房间中为 null，开始后按 seed 生成 */
  world: SnakeWorld | null
  lastEvent: SnakeLastEventDto | null
  /** 每个 playing 房间一个步进定时器 */
  tick: ReturnType<typeof setInterval> | null
}

interface SnakeInviteState {
  id: number
  matchId: number
  from: SnakeUserBriefDto
  to: SnakeUserBriefDto
  createdAt: number
  expiresAt: number
}

type MatchEventType = 'game:match:started' | 'game:match:update' | 'game:match:ended'

const invites = new Map<number, SnakeInviteState>()
const matches = new Map<number, SnakeMatchState>()
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
function matchFinished(match: SnakeMatchState): boolean {
  return match.status === 'finished'
}

function isParticipant(match: SnakeMatchState, userId: number): boolean {
  return match.players.some((player) => player.userId === userId)
}

function activeMatchFor(userId: number): SnakeMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'finished') continue
    const me = match.players.find((player) => player.userId === userId)
    if (me && (match.status === 'waiting' || me.status === 'playing')) return match
  }
  return null
}

function waitingRoomFor(userId: number): SnakeMatchState | null {
  for (const match of matches.values()) {
    if (match.status === 'waiting' && isParticipant(match, userId)) return match
  }
  return null
}

/**
 * 用户是否已在 2048 / 斗地主的房间或对局中（跨游戏互斥的另一半）。
 * 两个「当前活跃对局」查询都不写业务状态以外的东西；异常时按不忙处理，
 * 避免其它游戏模块的问题把贪吃蛇大厅一起拖垮。
 */
function isBusyInOtherGames(userId: number): boolean {
  // 统一走注册表：斗地主 / 扫雷 / 跳一跳（排除自己，等待房间里仍可邀请好友）
  return isUserBusyInOtherGames(userId, 'snake')
}

function countActiveMatches(): number {
  let count = 0
  for (const match of matches.values()) {
    if (match.status !== 'finished') count += 1
  }
  return count
}

/** 座位（match.players 下标）对应的世界蛇；开局前为 null */
function worldPlayerAt(match: SnakeMatchState, seat: number): SnakeWorldPlayer | null {
  const world = match.world
  if (!world) return null
  return world.players[seat] ?? null
}

/** 座位对应的出生点（座位超过出生点数量时取模，理论上不会发生） */
function spawnPointFor(seat: number) {
  return SNAKE_SPAWN_POINTS[seat % SNAKE_SPAWN_POINTS.length]
}

/** 玩家当前分数（开局前为 0） */
function scoreOf(match: SnakeMatchState, seat: number): number {
  return worldPlayerAt(match, seat)?.score ?? 0
}

/** 按分数候选集合（onlyAlive = 仅仍在场的玩家） */
function scoreCandidates(match: SnakeMatchState, onlyAlive: boolean): Array<{ userId: number; score: number }> {
  const candidates: Array<{ userId: number; score: number }> = []
  match.players.forEach((player, seat) => {
    if (onlyAlive && player.status !== 'playing') return
    candidates.push({ userId: player.userId, score: scoreOf(match, seat) })
  })
  return candidates
}

/** 在候选集合中选分数最高者；最高分并列时返回 null（平局） */
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

function toInviteDto(invite: SnakeInviteState): SnakeInviteDto {
  return {
    id: invite.id,
    matchId: invite.matchId,
    game: 'snake',
    from: { id: invite.from.id, username: invite.from.username },
    to: { id: invite.to.id, username: invite.to.username },
    createdAt: iso(invite.createdAt),
    expiresAt: iso(invite.expiresAt),
  }
}

/** 大地图无隐藏信息：所有玩家收到同一份世界 DTO（players 按座位顺序） */
function toMatchDto(match: SnakeMatchState, now: number): GameSnakeMatchDto {
  const world = match.world
  return {
    id: match.id,
    game: 'snake',
    hostId: match.hostId,
    status: match.status,
    version: match.version,
    startedAt: iso(match.startedAt),
    endsAt: iso(match.endsAt),
    endedAt: match.endedAt === null ? null : iso(match.endedAt),
    winnerId: match.winnerId,
    reason: match.reason,
    board: { width: world?.width ?? SNAKE_MAP_WIDTH, height: world?.height ?? SNAKE_MAP_HEIGHT },
    stepMs: SNAKE_STEP_MS,
    step: world?.step ?? 0,
    remainingMs: Math.max(0, match.endsAt - now),
    foods: world ? world.foods.map((food) => ({ x: food.x, y: food.y, big: food.big })) : [],
    players: match.players.map((player, seat) => {
      const snake = worldPlayerAt(match, seat)
      return {
        userId: player.userId,
        username: player.username,
        online: isGameUserAvailable(player.userId),
        status: player.status,
        colorIndex: player.colorIndex,
        body: snake ? snake.body.map((cell) => ({ x: cell.x, y: cell.y })) : [],
        // 开局前也给出该座位的初始朝向与配色，便于客户端预览出生点
        direction: snake ? snake.direction : spawnPointFor(player.colorIndex).direction,
        pendingDirection: snake ? snake.pendingDirection : null,
        score: snake?.score ?? 0,
        length: snake ? snake.body.length : 0,
        deathStep: snake ? snake.deathStep : null,
      }
    }),
    lastEvent: match.lastEvent === null ? null : { ...match.lastEvent },
  }
}

// === 事件推送 ===

function broadcastMatch(match: SnakeMatchState, type: MatchEventType, now: number): void {
  const dto = toMatchDto(match, now)
  for (const player of match.players) {
    sendToUser(player.userId, { type, match: dto })
  }
}

function emitInviteToTarget(invite: SnakeInviteState): void {
  sendToUser(invite.to.id, { type: 'game:invite', invite: toInviteDto(invite) })
}

/** 邀请移除事件发给双方（发出方与接收方都要清理本地弹窗/列表） */
function emitInviteRemoved(invite: SnakeInviteState, reason: GameInviteRemovalReason): void {
  const event = { type: 'game:invite:removed', inviteId: invite.id, reason }
  for (const userId of new Set<number>([invite.from.id, invite.to.id])) {
    sendToUser(userId, event)
  }
}

function removeInvite(invite: SnakeInviteState, reason: GameInviteRemovalReason): void {
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
function sortInvites(list: SnakeInviteDto[]): SnakeInviteDto[] {
  return list.sort((a, b) => {
    const diff = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    return diff !== 0 ? diff : a.id - b.id
  })
}

function collectInvites(userId: number, now: number): SnakeInvitesDto {
  const incoming: SnakeInviteDto[] = []
  const outgoing: SnakeInviteDto[] = []
  for (const invite of invites.values()) {
    if (invite.expiresAt <= now) continue
    if (invite.to.id === userId) incoming.push(toInviteDto(invite))
    if (invite.from.id === userId) outgoing.push(toInviteDto(invite))
  }
  return { incoming: sortInvites(incoming), outgoing: sortInvites(outgoing) }
}

// === 步进定时器 ===

function stopSnakeMatchTick(match: SnakeMatchState): void {
  if (match.tick !== null) {
    clearInterval(match.tick)
    match.tick = null
  }
}

/** 为 playing 房间挂一个每步定时器（unref，不阻止进程退出） */
function scheduleSnakeMatchTick(match: SnakeMatchState): void {
  stopSnakeMatchTick(match)
  const timer = setInterval(() => {
    advanceSnakeMatch(match.id)
  }, SNAKE_STEP_MS)
  timer.unref()
  match.tick = timer
}

// === 房间 / 对局生命周期 ===

function createSnakeWaitingPlayer(user: SnakeUserBriefDto, colorIndex: number, now: number): SnakePlayerState {
  return {
    userId: user.id,
    username: user.username,
    colorIndex: colorIndex % SNAKE_SPAWN_POINTS.length,
    status: 'waiting',
    lastAvailableAt: now,
  }
}

/** 创建等待房间（房主已在房间里） */
function createWaitingRoom(host: SnakeUserBriefDto, now: number): SnakeMatchState {
  const match: SnakeMatchState = {
    id: nextMatchId++,
    hostId: host.id,
    status: 'waiting',
    version: 1,
    createdAt: now,
    startedAt: now,
    endsAt: now + SNAKE_WAITING_ROOM_TTL_MS,
    endedAt: null,
    winnerId: null,
    reason: null,
    durationMs: SNAKE_DEFAULT_DURATION_MS,
    players: [createSnakeWaitingPlayer(host, 0, now)],
    world: null,
    lastEvent: null,
    tick: null,
  }
  matches.set(match.id, match)
  return match
}

/**
 * 结束对局并广播 game:match:ended（同时停掉步进定时器）。
 * winnerId === null 表示平局（全灭同分 / 超时同分 / 房间解散），
 * 客户端应以 `winnerId === null` 判断平局，而不是以单个玩家 status 判断。
 */
function finishSnakeMatch(
  match: SnakeMatchState,
  reason: GameSnakeEndReason,
  winnerId: number | null,
  now: number,
): void {
  if (match.status === 'finished') return
  stopSnakeMatchTick(match)
  match.status = 'finished'
  match.reason = reason
  match.winnerId = winnerId
  match.endedAt = now
  match.version += 1
  for (const player of match.players) {
    player.status = winnerId === null ? 'lost' : (player.userId === winnerId ? 'won' : 'lost')
  }
  broadcastMatch(match, 'game:match:ended', now)
  publishGameEnd({
    game: 'snake',
    matchId: match.id,
    reason,
    results: match.players.map((player, seat) => ({
      userId: player.userId,
      outcome: winnerId === null ? 'draw' : player.userId === winnerId ? 'win' : 'loss',
      score: scoreOf(match, seat),
    })),
  })
}

/** 超时结算：仍存活玩家按分数判定（并列平局）；无人存活时比较所有玩家分数 */
function finishByTimeout(match: SnakeMatchState, now: number): void {
  const alive = scoreCandidates(match, true)
  const candidates = alive.length > 0 ? alive : scoreCandidates(match, false)
  finishSnakeMatch(match, 'timeout', highestScoreWinner(candidates), now)
}

/** 世界结束的判定：只剩 1 条蛇 → last_standing 获胜；全部死亡 → 按分数 elimination */
function finishByWorld(match: SnakeMatchState, now: number): void {
  const world = match.world
  if (!world) return
  const survivors = world.players.filter((snake) => snake.alive)
  if (survivors.length === 1) {
    finishSnakeMatch(match, 'last_standing', survivors[0].id, now)
    return
  }
  finishSnakeMatch(match, 'elimination', highestScoreWinner(scoreCandidates(match, false)), now)
}

/**
 * 淘汰一名玩家（认输 / 掉线）：世界与玩家状态同时置为出局。
 * 只剩 1 名存活者时按起因（resign / forfeit）结束对局，全灭则按分数判定。
 */
function eliminateSnakePlayer(
  match: SnakeMatchState,
  userId: number,
  now: number,
  finishReason: 'resign' | 'forfeit',
): void {
  const seat = match.players.findIndex((player) => player.userId === userId)
  if (seat < 0) return
  const player = match.players[seat]
  if (player.status !== 'playing') return
  player.status = 'lost'

  const world = match.world
  if (!world) {
    match.version += 1
    broadcastMatch(match, 'game:match:update', now)
    return
  }
  const snake = worldPlayerAt(match, seat)
  if (snake && snake.alive) {
    snake.alive = false
    snake.deathStep = world.step
    snake.body = []
    snake.pendingDirection = null
  }
  match.lastEvent = { kind: 'dead', userId, step: world.step }

  const aliveCount = countAliveSnakes(world)
  if (aliveCount === 1) {
    const survivor = world.players.find((candidate) => candidate.alive)
    finishSnakeMatch(match, finishReason, survivor ? survivor.id : null, now)
    return
  }
  if (aliveCount === 0) {
    finishSnakeMatch(match, 'elimination', highestScoreWinner(scoreCandidates(match, false)), now)
    return
  }
  match.version += 1
  broadcastMatch(match, 'game:match:update', now)
}

/**
 * 房主开始游戏：2–8 人，按 seed 生成大地图世界，座位即出生点与配色。
 * 只允许房主操作；房间已开始 / 已结束时拒绝。
 */
export function startSnakeMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameSnakeMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('房间不存在', 404)
  if (match.status !== 'waiting') throw new AppError('房间已经开始或已结束', 409)
  if (match.hostId !== userId) throw new AppError('只有房主可以开始游戏', 403)
  if (match.players.length < SNAKE_MIN_PLAYERS) {
    throw new AppError(`至少需要 ${SNAKE_MIN_PLAYERS} 名玩家才能开始`, 400)
  }
  if (match.players.length > SNAKE_MAX_PLAYERS) {
    throw new AppError(`房间人数超过上限（${SNAKE_MAX_PLAYERS} 人）`, 400)
  }
  if (countActiveMatches() >= SNAKE_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  const seats = match.players.map((player, seat) => {
    const spawn = spawnPointFor(seat)
    return {
      id: player.userId,
      colorIndex: seat,
      x: spawn.x,
      y: spawn.y,
      direction: spawn.direction,
    }
  })
  match.world = createSnakeWorld(randomSeed(), seats)
  match.status = 'playing'
  match.startedAt = now
  match.durationMs = SNAKE_DEFAULT_DURATION_MS
  match.endsAt = now + match.durationMs
  match.lastEvent = null
  match.version += 1
  // 座位在开局时定格：配色索引与蛇位、出生点一一对应
  match.players.forEach((player, seat) => {
    player.colorIndex = seat
    player.status = 'playing'
    player.lastAvailableAt = now
  })
  // 对局开始后不再接受任何邀请
  removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
  scheduleSnakeMatchTick(match)
  broadcastMatch(match, 'game:match:started', now)
  return { match: toMatchDto(match, now) }
}

/**
 * 推进一步（服务端权威步进；每个 playing 房间的定时器调用这里）。
 * 导出供自检脚本显式驱动，避免真的等待 SNAKE_STEP_MS × N。
 *
 * @returns 是否真正推进了一步（房间不存在 / 未进行中 / 本步前先结算超时返回 false）
 */
export function advanceSnakeMatch(matchId: number, now: number = Date.now()): boolean {
  const match = matches.get(matchId)
  if (!match || match.status !== 'playing' || match.world === null) return false
  // 已超时但 sweeper 尚未结算：先结算，不再推进棋盘
  if (now >= match.endsAt) {
    finishByTimeout(match, now)
    return false
  }

  const executedStep = match.world.step
  const { events } = stepSnakeWorld(match.world)
  match.version += 1
  const latest = events.length > 0 ? events[events.length - 1] : null
  if (latest !== null) match.lastEvent = { kind: latest.kind, userId: latest.userId, step: executedStep }

  // 世界里的死亡（撞墙 / 撞身 / 蛇头相撞）同步到玩家状态
  match.players.forEach((player, seat) => {
    const snake = worldPlayerAt(match, seat)
    if (player.status === 'playing' && snake !== null && !snake.alive) player.status = 'lost'
  })

  if (match.world.over) {
    finishByWorld(match, now)
    return true
  }
  broadcastMatch(match, 'game:match:update', now)
  return true
}

/**
 * 离开等待房间：房主离开 = 解散房间；普通玩家离开 = 从房间移除。
 * 已开始的对局不能走这个接口（请使用 resign）。
 */
export function leaveSnakeMatch(
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
    finishSnakeMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }

  match.players = match.players.filter((player) => player.userId !== userId)
  match.version += 1
  if (match.players.length === 0) {
    finishSnakeMatch(match, 'cancelled', null, now)
    return { ok: true, dissolved: true }
  }
  broadcastMatch(match, 'game:match:update', now)
  return { ok: true, dissolved: false }
}

// === 好友大厅 ===

/** GET /api/games/snake/friends */
export async function listSnakeFriends(userId: number): Promise<{ friends: SnakeFriendDto[] }> {
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

/** GET /api/games/snake/invites */
export function listSnakeInvites(userId: number, now: number = Date.now()): SnakeInvitesDto {
  return collectInvites(userId, now)
}

/**
 * POST /api/games/snake/invites —— 邀请好友加入自己的 2–8 人等待房间
 *
 * 没有房间时自动创建（发起方为房主）；同一好友重复邀请幂等；
 * 任一方已在 2048 / 斗地主房间或对局中时拒绝（跨游戏互斥）。
 */
export async function createSnakeInvite(
  userId: number,
  friendId: number,
  now: number = Date.now(),
): Promise<{ invite: SnakeInviteDto; match: GameSnakeMatchDto }> {
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
  if (incomingCount >= SNAKE_MAX_INCOMING_INVITES) {
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
  if (room.players.length >= SNAKE_MAX_PLAYERS) {
    throw new AppError(`房间已满（最多 ${SNAKE_MAX_PLAYERS} 人）`, 409)
  }

  // 同一好友重复邀请：幂等返回已有邀请与房间
  for (const invite of invites.values()) {
    if (invite.matchId === room.id && invite.to.id === friendId) {
      return { invite: toInviteDto(invite), match: toMatchDto(room, now) }
    }
  }

  // 对方已经先邀请了自己 → 先处理对方邀请
  for (const invite of invites.values()) {
    if (invite.from.id === friendId && invite.to.id === userId) {
      throw new AppError('对方已向你发出邀请，请先处理', 409)
    }
  }

  const invite: SnakeInviteState = {
    id: nextGameInviteId(),
    matchId: room.id,
    from: { id: from.id, username: from.username },
    to: { id: to.id, username: to.username },
    createdAt: now,
    expiresAt: now + SNAKE_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  emitInviteToTarget(invite)
  return { invite: toInviteDto(invite), match: toMatchDto(room, now) }
}

/** POST /api/games/snake/invites/:id/respond —— 接受 = 加入等待房间（仍由房主统一开始） */
export function respondSnakeInvite(
  userId: number,
  inviteId: number,
  action: 'accept' | 'decline',
  now: number = Date.now(),
): { ok: true; match?: GameSnakeMatchDto } {
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
  if (room.players.length >= SNAKE_MAX_PLAYERS) {
    removeInvite(invite, 'cancelled')
    throw new AppError(`房间已满（最多 ${SNAKE_MAX_PLAYERS} 人）`, 409)
  }
  if (countActiveMatches() >= SNAKE_MAX_ACTIVE_MATCHES) {
    throw new AppError('游戏服务繁忙，请稍后再试', 503)
  }

  invites.delete(invite.id)
  emitInviteRemoved(invite, 'accepted')
  // 只清理「接受者」相关的其它邀请，保留房主邀请其他好友的邀请
  removeInvitesForUsers([userId], 'cancelled')

  room.players.push(
    createSnakeWaitingPlayer({ id: invite.to.id, username: invite.to.username }, room.players.length, now),
  )
  room.version += 1
  if (room.players.length >= SNAKE_MAX_PLAYERS) {
    removeInvitesForUsers(room.players.map((player) => player.userId), 'cancelled')
  }
  broadcastMatch(room, 'game:match:update', now)
  return { ok: true, match: toMatchDto(room, now) }
}

/** DELETE /api/games/snake/invites/:id */
export function cancelSnakeInvite(userId: number, inviteId: number, now: number = Date.now()): { ok: true } {
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

/** GET /api/games/snake/sync —— 轮询降级的统一同步（先清理一轮保证状态新鲜） */
export function getSnakeSync(userId: number, matchId?: number, now: number = Date.now()): SnakeSyncDto {
  runSnakeSweeper(now)
  const invitesDto = collectInvites(userId, now)

  let match: SnakeMatchState | null
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
    match: match === null ? null : toMatchDto(match, now),
  }
}

/** GET /api/games/snake/matches/active —— 当前等待房间 / 进行中对局，或 null */
export function getActiveSnakeMatch(userId: number, now: number = Date.now()): GameSnakeMatchDto | null {
  runSnakeSweeper(now)
  const match = activeMatchFor(userId)
  return match === null ? null : toMatchDto(match, now)
}

/** GET /api/games/snake/matches/:id —— 非参与者按 404 处理（不泄露对局是否存在） */
export function getSnakeMatch(userId: number, matchId: number, now: number = Date.now()): GameSnakeMatchDto {
  runSnakeSweeper(now)
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  return toMatchDto(match, now)
}

// === 对局操作 ===

/**
 * POST /api/games/snake/matches/:id/actions —— 只接受 { type:'turn', direction }
 *
 * 宽容语义与 2048 的 `moved:false` 一致：180° 反向（或非法方向）不写 pending、
 * 不递增版本、不广播，只返回 `applied:false`；
 * 非参与者 404、对局非 playing 409、已出局玩家 409。
 */
export function applySnakeAction(
  userId: number,
  matchId: number,
  action: SnakeAction,
  now: number = Date.now(),
): { match: GameSnakeMatchDto; applied: boolean } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing' || match.world === null) throw new AppError('对局未开始或已结束', 409)

  // 已超时 / 该掉线的先结算，再判断本局是否仍在进行
  runSnakeSweeper(now)
  if (matchFinished(match) || match.status !== 'playing' || match.world === null) {
    throw new AppError('对局已结束', 409)
  }

  const seat = match.players.findIndex((player) => player.userId === userId)
  const snake = seat < 0 ? null : worldPlayerAt(match, seat)
  if (seat < 0 || match.players[seat].status !== 'playing' || snake === null || !snake.alive) {
    throw new AppError('你已出局或对局未开始', 409)
  }

  const applied = setSnakeTurn(match.world, userId, action.direction)
  if (applied) {
    match.version += 1
    broadcastMatch(match, 'game:match:update', now)
  }
  return { match: toMatchDto(match, now), applied }
}

/** POST /api/games/snake/matches/:id/resign —— 认输：本人判死淘汰，其余继续 */
export function resignSnakeMatch(
  userId: number,
  matchId: number,
  now: number = Date.now(),
): { match: GameSnakeMatchDto } {
  const match = matches.get(matchId)
  if (!match || !isParticipant(match, userId)) throw new AppError('对局不存在', 404)
  if (match.status !== 'playing') throw new AppError('对局尚未开始或已结束', 409)

  runSnakeSweeper(now)
  if (matchFinished(match) || match.status !== 'playing') throw new AppError('对局已结束', 409)

  const player = match.players.find((candidate) => candidate.userId === userId)
  if (!player || player.status !== 'playing') throw new AppError('你已出局', 409)
  eliminateSnakePlayer(match, userId, now, 'resign')
  return { match: toMatchDto(match, now) }
}

// === 定时清理（sweeper） ===

/**
 * 执行一轮贪吃蛇清理与结算（已由 registerGameModule 交给 gameService 主 sweeper
 * 每 15 秒调用一次；也导出供 routes / 自检脚本显式触发）：
 *   1. 清理过期邀请与 presence；
 *   2. 等待房间 30 分钟未开局 → cancelled 解散；
 *   3. 进行中：超时按分数结算 → 连续不可用 120 秒且他人可用则淘汰（forfeit）；
 *   4. 回收结束超过 5 分钟的对局（同时停掉步进定时器）。
 */
export function runSnakeSweeper(now: number = Date.now()): void {
  pruneExpiredInvites(now)
  pruneGamePresence(now)

  for (const match of matches.values()) {
    if (match.status === 'waiting') {
      if (now >= match.endsAt) {
        removeInvitesForUsers(match.players.map((player) => player.userId), 'cancelled')
        finishSnakeMatch(match, 'cancelled', null, now)
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
      if (now - player.lastAvailableAt < SNAKE_DISCONNECT_FORFEIT_MS) continue

      // 至少还有一名其他存活玩家可用时才淘汰掉线者；全员掉线留给超时结算
      const othersAvailable = match.players.some(
        (candidate) =>
          candidate.userId !== player.userId
          && candidate.status === 'playing'
          && isGameUserAvailable(candidate.userId),
      )
      if (!othersAvailable) continue

      eliminateSnakePlayer(match, player.userId, now, 'forfeit')
      break
    }
  }

  // 回收已结束的对局（保留期 5 分钟，供客户端补拉最终结果）
  for (const match of Array.from(matches.values())) {
    if (
      match.status === 'finished'
      && match.endedAt !== null
      && now - match.endedAt >= SNAKE_FINISHED_RETENTION_MS
    ) {
      stopSnakeMatchTick(match)
      matches.delete(match.id)
    }
  }
}

/**
 * 兜底清理定时器（可选）：主链路已由 gameService.startGameSweeper() 经
 * registerGameModule 的 sweep 钩子驱动，这里只是多一层保险，重复调用安全。
 */
export function startSnakeTicker(intervalMs: number = GAME_SWEEPER_INTERVAL_MS): void {
  if (sweeperTimer !== null) return
  sweeperTimer = setInterval(() => runSnakeSweeper(), intervalMs)
  sweeperTimer.unref()
  console.log(`✦ 贪吃蛇清理定时器已启动（间隔 ${intervalMs}ms）`)
}

/** 停止兜底清理定时器（自检脚本收尾用；重复调用安全） */
function stopSnakeTicker(): void {
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
export function createSnakeRoomForTest(
  hostId: number,
  hostName: string,
  memberIds: number[] = [],
  now: number = Date.now(),
): { matchId: number } {
  const room = createWaitingRoom({ id: hostId, username: hostName }, now)
  memberIds.forEach((memberId, index) => {
    room.players.push(
      createSnakeWaitingPlayer({ id: memberId, username: `u${memberId}` }, index + 1, now),
    )
  })
  room.version += 1
  return { matchId: room.id }
}

/**
 * 仅供 verify 脚本 / 单测使用：直接登记一条待处理邀请
 * （真实流程需要数据库里的好友关系），便于验证接受 / 拒绝 / 取消与过期语义。
 */
export function createSnakeInviteForTest(
  fromId: number,
  toId: number,
  matchId: number,
  now: number = Date.now(),
): { inviteId: number } {
  const invite: SnakeInviteState = {
    id: nextGameInviteId(),
    matchId,
    from: { id: fromId, username: `u${fromId}` },
    to: { id: toId, username: `u${toId}` },
    createdAt: now,
    expiresAt: now + SNAKE_INVITE_TTL_MS,
  }
  invites.set(invite.id, invite)
  return { inviteId: invite.id }
}

/** 仅供自检脚本使用：清空内存状态（含所有定时器），便于脚本反复运行 */
export function resetSnakeStateForTest(): void {
  for (const match of matches.values()) stopSnakeMatchTick(match)
  matches.clear()
  invites.clear()
  nextMatchId = 1
  stopSnakeTicker()
}

// === 跨游戏互斥注册（2048 侧发起 / 接受邀请时会检查这里） ===

function isUserInSnakeMatch(userId: number): boolean {
  return activeMatchFor(userId) !== null
}

/** 强制清除该用户在贪吃蛇里的房间 / 对局状态（等待房间离开，进行中认输） */
export function resetSnakeUser(userId: number): number {
  return resetUserInMatches(matches.values(), userId, {
    leave: (uid, id) => leaveSnakeMatch(uid, id),
    resign: (uid, id) => resignSnakeMatch(uid, id),
  })
}

registerGameModule({
  name: 'snake',
  isUserInMatch: isUserInSnakeMatch,
  sweep: runSnakeSweeper,
  resetUser: resetSnakeUser,
})
