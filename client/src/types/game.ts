/**
 * 游戏模块类型定义
 *
 * 与后端 `/api/games/*` REST 响应及 `/ws/chat` 的 `game:*` 事件保持一致。
 * 时间字段统一为 ISO 字符串。
 */

import type { DoudizhuCombo } from '../lib/games/doudizhu'

/** 游戏种类（邀请与对局 DTO 的 game 字段；旧邀请缺省视为 2048） */
export type GameKind = '2048' | 'doudizhu' | 'snake' | 'minesweeper' | 'jump'

/** 2048 移动方向 */
export type Game2048Direction = 'up' | 'down' | 'left' | 'right'

/** 单个玩家在房间/对局中的状态 */
export type Game2048PlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'

/** 对局状态：waiting = 等待房主开始；playing = 竞速中；finished = 已结束 */
export type Game2048MatchStatus = 'waiting' | 'playing' | 'finished'

/** 对局结束原因 */
export type Game2048EndReason =
  | 'target'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'blocked'
  | 'last_standing'
  | 'elimination'
  | 'cancelled'

/** 邀请移除原因 */
export type GameInviteRemovalReason = 'accepted' | 'declined' | 'cancelled' | 'expired'

/** 游戏场景下的用户简要信息 */
export interface GameUserBrief {
  id: number
  username: string
}

/** 好友对战邀请（2048 与斗地主共用；id 跨游戏唯一） */
export interface GameInvite {
  id: number
  /** 邀请加入的房间/对局 id */
  matchId: number
  /** 所属游戏（2048 的旧响应可能缺省） */
  game?: GameKind
  from: GameUserBrief
  to: GameUserBrief
  createdAt: string
  expiresAt: string
}

/** 对局中的单个玩家（含只读棋盘） */
export interface Game2048Player {
  userId: number
  username: string
  score: number
  maxTile: number
  moves: number
  status: Game2048PlayerStatus
  /** 服务端判定的可用状态（聊天 WS 在线或轮询 presence 未过期） */
  online: boolean
  board: number[][]
}

/** 2048 对局 DTO */
export interface Game2048Match {
  id: number
  game: '2048'
  /** 房主（只有房主可以开始游戏/解散房间） */
  hostId: number
  status: Game2048MatchStatus
  version: number
  /** 竞速时长（毫秒）；等待房间中为默认 10 分钟，开始后为房主选择值 */
  durationMs: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: Game2048EndReason | null
  players: Game2048Player[]
}

/** 联机大厅好友项 */
export interface GameFriend {
  id: number
  username: string
  online: boolean
  inMatch: boolean
}

/** GET /api/games/2048/friends */
export interface GameFriendsResponse {
  friends: GameFriend[]
}

/** GET /api/games/2048/invites */
export interface GameInvitesResponse {
  incoming: GameInvite[]
  outgoing: GameInvite[]
}

/** POST /api/games/2048/invites —— 同时返回邀请加入的房间 */
export interface GameInviteResponse {
  invite: GameInvite
  match?: Game2048Match
}

/** POST /api/games/2048/invites/:id/respond */
export interface GameInviteRespondResponse {
  ok: boolean
  match?: Game2048Match
}

/** GET /api/games/2048/matches/:id 与 POST resign */
export interface GameMatchResponse {
  match: Game2048Match
}

/** GET /api/games/2048/matches/active */
export interface GameActiveMatchResponse {
  match: Game2048Match | null
}

/** POST /api/games/2048/matches/:id/start */
export interface GameStartResponse {
  match: Game2048Match
}

/** POST /api/games/2048/matches/:id/moves */
export interface GameMoveResponse {
  match: Game2048Match
  moved: boolean
}

/** GET /api/games/2048/sync —— 轮询降级时的统一状态同步 */
export interface GameSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: Game2048Match | null
}

/** POST /api/games/2048/presence —— 轮询降级时的在线心跳 */
export interface GamePresenceResponse {
  ok: boolean
  serverTime: string
}

// ==================== 斗地主（doudizhu） ====================

/** 斗地主一张牌（与后端引擎一致：rank 为比较点数，suit 0–3 为 ♠♥♣♦、4 为王） */
export interface DoudizhuCardDto {
  id: number
  rank: number
  suit: number
}

export type GameDoudizhuMatchStatus = 'waiting' | 'bidding' | 'playing' | 'finished'
export type DoudizhuRole = 'landlord' | 'farmer'
export type GameDoudizhuEndReason = 'hand_empty' | 'resign' | 'no_bid' | 'cancelled' | 'abandoned'

/** 斗地主对局中的单个玩家（只暴露剩余张数，手牌仅自己可见） */
export interface GameDoudizhuPlayer {
  userId: number
  username: string
  online: boolean
  role: DoudizhuRole | null
  cardCount: number
  status: 'waiting' | 'playing' | 'won' | 'lost'
  /** 当前叫分轮的叫分（null = 尚未应叫） */
  bid: number | null
  /** 结算积分（未结算为 null） */
  scoreDelta: number | null
}

/** 一手出牌记录（action=pass 时 cards 为空、combo 为 null） */
export interface DoudizhuTrickMoveDto {
  userId: number
  action: 'pass' | 'play'
  cards: DoudizhuCardDto[]
  combo: DoudizhuCombo | null
}

/** 斗地主对局 DTO（按观看者裁剪：myHand 只有自己的牌） */
export interface GameDoudizhuMatch {
  id: number
  game: 'doudizhu'
  hostId: number
  status: GameDoudizhuMatchStatus
  version: number
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  reason: GameDoudizhuEndReason | null
  /** 获胜方（流局 / 解散为 null） */
  winnerSide: 'landlord' | 'farmers' | null
  /** 当前倍率（底分 100 × 倍率 = 每份积分） */
  multiplier: number
  landlordId: number | null
  /** 底牌（叫分结束后对所有人可见） */
  bottomCards: DoudizhuCardDto[]
  /** 观看者自己的座位（0–2；players 按座位排序） */
  seat: number
  players: GameDoudizhuPlayer[]
  myHand: DoudizhuCardDto[]
  bidding: {
    turnUserId: number
    highestBid: number
    highestBidderId: number | null
    bids: Array<{ userId: number; bid: number }>
    round: number
    deadline: string
  } | null
  playing: {
    turnUserId: number
    lastMove: DoudizhuTrickMoveDto | null
    recentMoves: DoudizhuTrickMoveDto[]
    deadline: string
  } | null
}

/** 任一游戏的对局（game:match:* 事件载荷） */
export type AnyGameMatch =
  | Game2048Match
  | GameDoudizhuMatch
  | GameSnakeMatch
  | GameMinesweeperMatch
  | GameJumpMatch

/** GET/POST /api/games/doudizhu/* 对局响应 */
export interface DoudizhuMatchResponse {
  match: GameDoudizhuMatch
}

export interface DoudizhuActiveMatchResponse {
  match: GameDoudizhuMatch | null
}

/** GET /api/games/doudizhu/sync —— 轮询降级统一同步 */
export interface DoudizhuSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameDoudizhuMatch | null
}

/** POST /api/games/doudizhu/matches/:id/actions 的动作体 */
export type DoudizhuActionBody =
  | { type: 'bid'; bid: number }
  | { type: 'play'; cards: number[] }
  | { type: 'pass' }

// ==================== 贪吃蛇（snake，大地图联机） ====================

/** 蛇的移动方向 */
export type SnakeDirection = 'up' | 'down' | 'left' | 'right'

/** 联机房间/对局中的玩家状态 */
export type GameSnakePlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'

/** 大地图联机对局状态 */
export type GameSnakeMatchStatus = 'waiting' | 'playing' | 'finished'

/** 大地图对局结束原因 */
export type GameSnakeEndReason =
  | 'last_standing'
  | 'elimination'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'cancelled'

/** 网格坐标 */
export interface SnakeCellDto {
  x: number
  y: number
}

/** 地图上的果实（big = 加分更多的金果） */
export interface SnakeFoodDto extends SnakeCellDto {
  big: boolean
}

/** 大地图对局中的单个玩家 */
export interface GameSnakePlayer {
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

/** 贪吃蛇大地图联机对局 DTO（服务端权威，客户端只做渲染与方向输入） */
export interface GameSnakeMatch {
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
  /** 距对局结束的剩余毫秒（服务端算好，避免客户端时钟漂移） */
  remainingMs: number
  foods: SnakeFoodDto[]
  players: GameSnakePlayer[]
  /** 最近一次事件（吃果 / 死亡），用于播报；无则 null */
  lastEvent: { kind: 'eat' | 'dead'; userId: number; step: number } | null
}

/** POST /api/games/snake/matches/:id/actions 的动作体 */
export type SnakeActionBody = { type: 'turn'; direction: SnakeDirection }

// ==================== 扫雷（minesweeper，联机轮流点） ====================

export type GameMinesweeperPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameMinesweeperMatchStatus = 'waiting' | 'playing' | 'finished'

/** 联机扫雷结束原因 */
export type GameMinesweeperEndReason =
  | 'boom'
  | 'cleared'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'cancelled'

/** 联机扫雷中的单个玩家 */
export interface GameMinesweeperPlayer {
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

/** 已翻开的格子（翻开后才对所有人可见） */
export interface MinesweeperOpenedDto {
  index: number
  mine: boolean
  adjacent: number
}

/** 插旗记录（by = 插旗者 userId） */
export interface MinesweeperFlagDto {
  index: number
  by: number
}

/** 联机扫雷对局 DTO：一人只许下一次（翻开或插旗），随后轮到下一名玩家 */
export interface GameMinesweeperMatch {
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
  /** 已翻开格（未翻开的格子不出现在这里，雷位因此不泄露） */
  opened: MinesweeperOpenedDto[]
  flags: MinesweeperFlagDto[]
  /** 当前回合 */
  turn: { userId: number; deadline: string; skips: number } | null
  lastAction: { userId: number; kind: 'open' | 'flag' | 'unflag'; index: number } | null
  players: GameMinesweeperPlayer[]
}

/** POST /api/games/minesweeper/matches/:id/actions 的动作体 */
export type MinesweeperActionBody =
  | { type: 'open'; index: number }
  | { type: 'flag'; index: number }

// ==================== 跳一跳（jump，联机轮流跳） ====================

export type GameJumpPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameJumpMatchStatus = 'waiting' | 'playing' | 'finished'

/** 跳一跳对局结束原因 */
export type GameJumpEndReason =
  | 'last_standing'
  | 'elimination'
  | 'timeout'
  | 'resign'
  | 'forfeit'
  | 'cancelled'

/** 一次跳跃的落点判定（对齐微信小游戏：中心命中可连击翻倍） */
export type JumpLanding = 'center' | 'normal' | 'short' | 'long' | 'off'

/** 共享盒子序列里的一格 */
export interface JumpBoxDto {
  index: number
  /** 与上一格的中心间距（逻辑单位） */
  gap: number
  kind: 'box' | 'cylinder'
  /** 半宽（逻辑单位），落点判定用 */
  size: number
  /** 是否特殊盒（音乐盒 / 加分盒），预留 */
  bonus: boolean
}

/** 跳一跳联机中的单个玩家 */
export interface GameJumpPlayer {
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

/** 上一次跳跃结果 */
export interface JumpLastResultDto {
  userId: number
  kind: JumpLanding
  gained: number
  offset: number
  scoreAfter: number
  comboAfter: number
}

/** 跳一跳对局 DTO：好友轮流各跳一次，同一条盒子序列，掉出即淘汰 */
export interface GameJumpMatch {
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
  turn: { userId: number; deadline: string } | null
  lastResult: JumpLastResultDto | null
  players: GameJumpPlayer[]
}

/** POST /api/games/jump/matches/:id/actions 的动作体（蓄力毫秒数） */
export type JumpActionBody = { type: 'jump'; chargeMs: number }

// ==================== 通用对局响应（新游戏复用同一形状） ====================

export interface SnakeMatchResponse {
  match: GameSnakeMatch
}
export interface SnakeActiveMatchResponse {
  match: GameSnakeMatch | null
}
export interface SnakeSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameSnakeMatch | null
}

export interface MinesweeperMatchResponse {
  match: GameMinesweeperMatch
}
export interface MinesweeperActiveMatchResponse {
  match: GameMinesweeperMatch | null
}
export interface MinesweeperSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameMinesweeperMatch | null
}

export interface JumpMatchResponse {
  match: GameJumpMatch
}
export interface JumpActiveMatchResponse {
  match: GameJumpMatch | null
}
export interface JumpSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameJumpMatch | null
}
