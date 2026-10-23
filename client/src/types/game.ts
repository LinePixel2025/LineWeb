/**
 * 游戏模块类型定义
 *
 * 与后端 `/api/games/*` REST 响应及 `/ws/chat` 的 `game:*` 事件保持一致。
 * 时间字段统一为 ISO 字符串。
 */

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

/** 好友对战邀请 */
export interface GameInvite {
  id: number
  /** 邀请加入的房间/对局 id */
  matchId: number
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
  /** 本局竞速时长（毫秒）；等待房间中为房主默认/已选时长 */
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
