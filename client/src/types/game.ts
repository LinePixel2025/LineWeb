/**
 * 游戏模块类型定义
 *
 * 与后端 `/api/games/*` REST 响应及 `/ws/chat` 的 `game:*` 事件保持一致。
 * 时间字段统一为 ISO 字符串。
 */

import type { DoudizhuCombo } from '../lib/games/doudizhu'
import type { UnoCard, UnoColor } from '../lib/games/uno'
import type { LiarDeathCause, LiarTarget } from '../lib/games/liar'
import type { ParkourLane, ParkourPose } from '../lib/games/parkour'

/** 游戏种类（邀请与对局 DTO 的 game 字段；旧邀请缺省视为 2048） */
export type GameKind =
  | '2048'
  | 'doudizhu'
  | 'snake'
  | 'minesweeper'
  | 'jump'
  | 'minecraft'
  | 'gomoku'
  | 'liar'
  | 'uno'
  | 'xiangqi'
  | 'parkour'

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
  | GameMinecraftMatch
  | GameGomokuMatch
  | GameLiarMatch
  | GameUnoMatch
  | GameXiangqiMatch
  | GameParkourMatch

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

// ==================== 五子棋（gomoku，联机轮流落子） ====================

export type GameGomokuPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameGomokuMatchStatus = 'waiting' | 'playing' | 'finished'

/** 五子棋对局结束原因 */
export type GameGomokuEndReason =
  | 'five'
  | 'resign'
  | 'forfeit'
  | 'timeout'
  | 'draw'
  | 'cancelled'

/** 最近一手（auto = 回合超时由服务端托管落下） */
export interface GomokuLastMoveDto {
  userId: number
  x: number
  y: number
  color: 1 | 2
  auto: boolean
}

/** 五子棋联机中的单个玩家（座位 0 执黑、座位 1 执白） */
export interface GameGomokuPlayer {
  userId: number
  username: string
  online: boolean
  status: GameGomokuPlayerStatus
  /** 执子颜色：1 黑 / 2 白；等待房间中为 null */
  color: 1 | 2 | null
  /** 已落子手数 */
  moves: number
}

/** 五子棋对局 DTO：15×15 无禁手、棋盘全量可见（board 下标 = y×15+x） */
export interface GameGomokuMatch {
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
  /** 一维棋盘（0 空 1 黑 2 白，长度 225，无隐藏信息全量下发） */
  board: number[]
  /** 非 playing 状态固定为 null */
  turn: { userId: number; deadline: string } | null
  lastMove: GomokuLastMoveDto | null
  /** 获胜连线（含 ≥5 长连），reason = 'five' 结束时才有 */
  winningLine: Array<{ x: number; y: number }> | null
  /** 按座位顺序（座位 0 = 房主 = 黑） */
  players: GameGomokuPlayer[]
}

/** POST /api/games/gomoku/matches/:id/actions 的动作体（落子坐标） */
export type GomokuActionBody = { type: 'place'; x: number; y: number }

// ==================== 骗子酒馆（liar，2–4 人出牌 / 质疑） ====================

export type GameLiarPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameLiarMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameLiarEndReason = 'last_standing' | 'timeout' | 'cancelled'

export interface LiarTurnDto {
  userId: number
  deadline: string
}

export interface LiarPileEntryDto {
  userId: number
  count: number
}

export interface LiarRevealDto {
  round: number
  userId: number
  cards: number[]
  truthful: boolean
  challengerId: number
}

export type GameLiarLogEntry =
  | { type: 'round'; round: number; target: LiarTarget; starterUserId: number }
  | { type: 'play'; round: number; userId: number; count: number }
  | { type: 'challenge'; round: number; userId: number; targetUserId: number }
  | { type: 'reveal'; round: number; userId: number; cards: number[]; truthful: boolean }
  | { type: 'trigger'; round: number; userId: number; bullets: number; died: boolean }
  | { type: 'death'; round: number; userId: number; cause: LiarDeathCause }
  | { type: 'flush'; round: number }

export interface GameLiarPlayer {
  userId: number
  username: string
  online: boolean
  status: GameLiarPlayerStatus
  handCount: number
  plays: number
}

export interface GameLiarMatch {
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
  round: number
  target: LiarTarget | null
  turn: LiarTurnDto | null
  pile: LiarPileEntryDto[]
  lastReveal: LiarRevealDto | null
  log: GameLiarLogEntry[]
  gunBullets: number
  myHand: number[]
  players: GameLiarPlayer[]
}

export type LiarActionBody =
  | { type: 'play'; cards: number[] }
  | { type: 'challenge' }

export interface LiarMatchResponse {
  match: GameLiarMatch
}
export interface LiarActiveMatchResponse {
  match: GameLiarMatch | null
}
export interface LiarSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameLiarMatch | null
}

// ==================== UNO（uno，2–10 人经典牌局） ====================

export type GameUnoPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameUnoMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameUnoEndReason = 'hand_empty' | 'last_standing' | 'timeout' | 'cancelled'

/** 牌 DTO 与双端引擎的 UnoCard 结构一致 */
export type UnoCardDto = UnoCard

export interface GameUnoPlayer {
  userId: number
  username: string
  online: boolean
  status: GameUnoPlayerStatus
  handCount: number
  plays: number
}

export type UnoLatelyDto =
  | { type: 'play'; userId: number; card: UnoCardDto; color: UnoColor }
  | { type: 'draw'; userId: number; count: number }
  | { type: 'pass'; userId: number }

export interface GameUnoMatch {
  id: number
  game: 'uno'
  hostId: number
  status: GameUnoMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameUnoEndReason | null
  currentColor: UnoColor | null
  direction: 1 | -1
  topCard: UnoCardDto | null
  deckCount: number
  discardCount: number
  /** 当前回合玩家摸到的牌 id（仅自己可打出） */
  drawnCardId: number | null
  turn: { userId: number; deadline: string } | null
  lastAction: UnoLatelyDto | null
  myHand: UnoCardDto[]
  players: GameUnoPlayer[]
}

export type UnoActionBody =
  | { type: 'play'; cardId: number; color?: UnoColor }
  | { type: 'draw' }
  | { type: 'pass' }

export interface UnoMatchResponse {
  match: GameUnoMatch
}
export interface UnoActiveMatchResponse {
  match: GameUnoMatch | null
}
export interface UnoSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameUnoMatch | null
}

// ==================== 中国象棋（xiangqi，2 人轮流走子） ====================

export type GameXiangqiPlayerStatus = 'waiting' | 'playing' | 'won' | 'lost'
export type GameXiangqiMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameXiangqiEndReason =
  | 'checkmate'
  | 'stalemate'
  | 'resign'
  | 'forfeit'
  | 'timeout'
  | 'draw'
  | 'cancelled'

export interface XiangqiLastMoveDto {
  userId: number
  from: number
  to: number
  captured: number
  auto: boolean
}

export interface GameXiangqiPlayer {
  userId: number
  username: string
  online: boolean
  status: GameXiangqiPlayerStatus
  side: 'red' | 'black' | null
  moves: number
}

export interface GameXiangqiMatch {
  id: number
  game: 'xiangqi'
  hostId: number
  status: GameXiangqiMatchStatus
  version: number
  startedAt: string
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameXiangqiEndReason | null
  board: number[]
  turn: { userId: number; deadline: string } | null
  lastMove: XiangqiLastMoveDto | null
  checked: boolean
  halfMoveClock: number
  players: GameXiangqiPlayer[]
}

export type XiangqiActionBody = { type: 'move'; from: number; to: number }

export interface XiangqiMatchResponse {
  match: GameXiangqiMatch
}
export interface XiangqiActiveMatchResponse {
  match: GameXiangqiMatch | null
}
export interface XiangqiSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameXiangqiMatch | null
}

// ==================== 霓虹跑酷（parkour，3D 三车道联机） ====================

export type GameParkourMatchStatus = 'waiting' | 'playing' | 'finished'
export type GameParkourPlayerStatus = 'waiting' | 'playing' | 'finished' | 'lost'
export type GameParkourEndReason = 'finish' | 'elimination' | 'timeout' | 'cancelled'
export type GameParkourCause = 'hit' | 'pit' | 'resign' | 'forfeit'

/** 联机对局中的单个跑者（服务端权威进度 + 客户端本地渲染） */
export interface GameParkourPlayer {
  userId: number
  username: string
  online: boolean
  /** 跑者配色索引（0–5，由座位决定） */
  colorIndex: number
  status: GameParkourPlayerStatus
  /** 服务端已接受的最远距离（米，单调） */
  distanceM: number
  coins: number
  maxCombo: number
  /** 服务端按同一公式计算的得分 */
  score: number
  /** 当前车道 0 / 1 / 2 */
  lane: ParkourLane
  /** 当前姿态（幽灵渲染用） */
  pose: ParkourPose
  rank: number | null
  /** 完赛用时（毫秒，从 startsAt 起算；未完赛为 null） */
  finishMs: number | null
  cause: GameParkourCause | null
}

/** 跑酷对局 DTO（webSocket game:match:* 事件与 REST 共用） */
export interface GameParkourMatch {
  id: number
  game: 'parkour'
  hostId: number
  status: GameParkourMatchStatus
  version: number
  createdAt: string
  startedAt: string | null
  startsAt: string | null
  endsAt: string
  endedAt: string | null
  winnerId: number | null
  reason: GameParkourEndReason | null
  /** 等待房间为 0，开始后为服务端权威 seed */
  seed: number
  trackLengthM: number
  /** 距起跑的剩余毫秒（服务端算好） */
  countdownMs: number
  /** 距比赛结束的剩余毫秒（服务端算好） */
  remainingMs: number
  players: GameParkourPlayer[]
}

export type ParkourActionBody =
  | {
      type: 'progress'
      distanceM: number
      coins: number
      maxCombo: number
      lane: ParkourLane
      pose: ParkourPose
      alive: boolean
      cause?: 'hit' | 'pit'
    }
  | {
      type: 'finish'
      distanceM: number
      coins: number
      maxCombo: number
    }

export interface ParkourMatchResponse {
  match: GameParkourMatch
}
export interface ParkourActiveMatchResponse {
  match: GameParkourMatch | null
}
export interface ParkourSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameParkourMatch | null
}

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

export interface GomokuMatchResponse {
  match: GameGomokuMatch
}
export interface GomokuActiveMatchResponse {
  match: GameGomokuMatch | null
}
export interface GomokuSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameGomokuMatch | null
}

// ==================== 我的世界（minecraft，联机共享体素世界） ====================

/** 我的世界对局状态（waiting = 等待房主开始；playing = 共享世界进行中；finished = 已关闭） */
export type GameMinecraftMatchStatus = 'waiting' | 'playing' | 'finished'

/** 沙盒只有两种结束原因：解散（等待期）/ 废弃（全员离开或全员掉线超时） */
export type GameMinecraftEndReason = 'cancelled' | 'abandoned'

/** 玩家实时状态（位置为脚底中心坐标，与客户端引擎一致） */
export interface MinecraftPlayerStateDto {
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  flying: boolean
}

/** 我的世界对局中的单个玩家 */
export interface GameMinecraftPlayer {
  userId: number
  username: string
  online: boolean
  /** waiting / 从未上报为 null；开始后为最近一次上报的位置快照 */
  state: MinecraftPlayerStateDto | null
  joinedAt: string
}

/** 我的世界对局 DTO（世界由各端按 seed 本地生成；修改日志走增量同步） */
export interface GameMinecraftMatch {
  id: number
  game: 'minecraft'
  hostId: number
  status: GameMinecraftMatchStatus
  version: number
  /** 等待房间中为 0；开始后为服务端权威 seed */
  seed: number
  startedAt: string
  endedAt: string | null
  reason: GameMinecraftEndReason | null
  world: {
    size: number
    height: number
    seaLevel: number
    spawn: { x: number; y: number; z: number } | null
  }
  /** 修改日志水位（单调递增），客户端据此做 since 增量补拉 */
  editSeq: number
  editCount: number
  maxEdits: number
  players: GameMinecraftPlayer[]
}

/** 一条已落账的方块修改（WS game:minecraft:edit 与 sync 增量共用） */
export interface MinecraftEditDto {
  seq: number
  x: number
  y: number
  z: number
  b: number
  userId: number
}

/** POST /api/games/minecraft/matches/:id/actions 的动作体 */
export type MinecraftActionBody =
  | {
      type: 'state'
      x: number
      y: number
      z: number
      yaw: number
      pitch: number
      flying: boolean
    }
  | { type: 'edit'; edits: Array<{ x: number; y: number; z: number; b: number }> }

/** WS 轻量事件：单个玩家的位置快照（发给其他玩家，不含完整对局 DTO） */
export interface MinecraftStateEvent {
  type: 'game:minecraft:state'
  matchId: number
  userId: number
  state: MinecraftPlayerStateDto
}

/** WS 轻量事件：一批新增的方块修改（发给其他玩家） */
export interface MinecraftEditEvent {
  type: 'game:minecraft:edit'
  matchId: number
  userId: number
  edits: MinecraftEditDto[]
}

export interface MinecraftMatchResponse {
  match: GameMinecraftMatch
}
export interface MinecraftActiveMatchResponse {
  match: GameMinecraftMatch | null
}
export interface MinecraftSyncResponse {
  serverTime: string
  invites: GameInvitesResponse
  match: GameMinecraftMatch | null
  /** 自 since 水位之后的修改日志（match 不存在时为空数组） */
  edits: MinecraftEditDto[]
}
