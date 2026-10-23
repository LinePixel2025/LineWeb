/**
 * 游戏模块类型定义
 *
 * 与后端 `/api/games/*` REST 响应及 `/ws/chat` 的 `game:*` 事件保持一致。
 * 时间字段统一为 ISO 字符串。
 */

import type { DoudizhuCombo } from '../lib/games/doudizhu'

/** 游戏种类（邀请与对局 DTO 的 game 字段；旧邀请缺省视为 2048） */
export type GameKind = '2048' | 'doudizhu'

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
export type AnyGameMatch = Game2048Match | GameDoudizhuMatch

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
