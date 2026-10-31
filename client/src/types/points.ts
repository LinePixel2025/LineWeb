/** 传说称号动态特效白名单（与服务端 TITLE_EFFECT_STYLES 一致，顺序一致） */
export const TITLE_EFFECTS = ['classic', 'stardust', 'flame', 'aurora', 'thunder'] as const
export type TitleEffectStyle = typeof TITLE_EFFECTS[number]

/** 站内称号（只在 LineWeb 内部展示，不写入 neko / 聊天服务） */
export interface UserTitleDto {
  id: number
  name: string
  color: string
  icon: string
  /** 商品稀有度：legendary 会触发炸裂特效 */
  rarity: string
  /** 传说特效（legendary 时的动态特效 key，非 legendary 忽略；非法值回退 classic） */
  effect: string
}

/** 每日签到状态 */
export interface CheckinStatus {
  checkedInToday: boolean
  /** 当前连签天数（今日未签时为截至昨日仍有效的连签） */
  streak: number
  /** 今日已获得的签到积分（未签为 0） */
  todayPoints: number
  /** 下一次签到能拿多少 */
  nextPoints: number
}

/** POST /api/points/checkin */
export interface CheckinResult extends CheckinStatus {
  awarded: number
  balance: number
  note: string
}

/** GET /api/points/me */
export interface PointsProfile {
  /** 客户端据此判断头像是否属于自己（本人头像套用已佩戴头像框） */
  userId: number
  balance: number
  earned: number
  rank: number
  title: UserTitleDto | null
  /** 当前佩戴的单机榜一传说称号（与商店称号互斥） */
  equippedLeaderTitle: LeaderTitleDto | null
  /** 已购商品 key（含表情包，客户端据此解锁表情商店） */
  ownedKeys: string[]
  avatarFrame: AvatarFrameDto | null
  checkin: CheckinStatus
  leaderTitles: LeaderTitleDto[]
}

/** 单机榜一传说称号（自动授予，被超过即消失） */
export interface LeaderTitleDto {
  /** game_leader_titles 行 id（佩戴接口使用） */
  id: number
  game: string
  gameName: string
  name: string
  color: string
  icon: string
  rarity: 'legendary'
  /** 传说特效（非法值由客户端回退 classic） */
  effect: string
  awardedAt: string
}

export type ShopItemType = 'title' | 'emoji' | 'avatar_frame'
export type ShopRarity = 'common' | 'rare' | 'epic' | 'legendary'
export type AvatarFrameStyle = 'gold' | 'neon' | 'sakura' | 'galaxy'

/** 头像框（LineWeb 站内展示，不同步 neko） */
export interface AvatarFrameDto {
  id: number
  name: string
  frame: AvatarFrameStyle
  color: string
}

export interface ShopItem {
  id: number
  key: string
  type: ShopItemType
  name: string
  description: string
  cost: number
  rarity: ShopRarity
  payload: Record<string, unknown>
  isActive: boolean
  sortOrder: number
  owned: boolean
  equipped: boolean
}

/** GET /api/points/shop */
export interface ShopResponse {
  balance: number
  earned: number
  equippedTitleId: number | null
  equippedAvatarFrameId: number | null
  /** 当前佩戴的榜一传说称号 ID（与商店称号互斥） */
  equippedLeaderTitleId: number | null
  items: ShopItem[]
}

export interface PointsLeaderboardEntry {
  rank: number
  userId: number
  username: string
  value: number
  balance: number
  earned: number
  title: UserTitleDto | null
  avatarFrame: AvatarFrameDto | null
  isMe: boolean
}

export type PointsLeaderboardMetric = 'balance' | 'earned'

/** GET /api/points/leaderboard */
export interface PointsLeaderboardResponse {
  entries: PointsLeaderboardEntry[]
  me: PointsLeaderboardEntry | null
  total: number
  metric: PointsLeaderboardMetric
}

export interface PointsLedgerEntry {
  id: number
  userId: number
  amount: number
  balance: number
  reason: string
  game: string | null
  note: string | null
  createdAt: string
}

/** GET /api/points/ledger */
export interface PointsLedgerResponse {
  entries: PointsLedgerEntry[]
  total: number
  page: number
  limit: number
}

/** 单机战绩上报返回值里的积分变动 */
export interface GamePointsResult {
  delta: number
  balance: number
  gross: number
  capped: boolean
}

/** 每款游戏的积分规则（管理端可改） */
export interface GamePointRule {
  win: number
  loss: number
  draw: number
  participation: number
  scoreDivisor: number
  scoreBonusMax: number
  dailyCap: number
  dailyLossCap: number
}

export interface FarmPointRule {
  stealRatio: number
  stealDailyLimit: number
  stealSuccessRate: number
  victimDailyStealLimit: number
  seedDropMax: number
  merchantCount: number
  merchantDiscountMin: number
  merchantDiscountMax: number
  welcomePoints: number
}

export interface CheckinRule {
  basePoints: number
  streakStep: number
  streakMaxBonus: number
}

export interface LeaderTitleRule {
  rewardPoints: number
}

export interface PointsConfig {
  games: Record<string, GamePointRule>
  farm: FarmPointRule
  checkin: CheckinRule
  leaderTitle: LeaderTitleRule
}

/** 管理端商品（含拥有者数量与时间戳） */
export interface AdminShopItem {
  id: number
  key: string
  type: ShopItemType
  name: string
  description: string | null
  cost: number
  rarity: ShopRarity
  payload: Record<string, unknown>
  isActive: boolean
  sortOrder: number
  ownerCount: number
  createdAt: string
  updatedAt: string
}

/** GET /api/admin/points */
export interface AdminPointsResponse {
  config: PointsConfig
  items: AdminShopItem[]
  /** 单机榜一传说称号（自动授予，每游戏一位；管理端可调整特效） */
  leaderTitles: Array<LeaderTitleDto & { holderName: string }>
  catalog: Array<{
    key: string
    name: string
    emoji: string
    seedCost: number
    growMinutes: number
    yieldUnits: number
    value: number
    tier: number
    description: string
  }>
  emojiPacks: string[]
  stats: {
    users: number
    farms: number
    totalPlanted: number
    totalSteals: number
    totalPoints: number
    totalEarned: number
    todayGamePoints: number
    todayGameResults: number
  }
}

/** 管理端用户积分行 */
export interface AdminPointsUser {
  id: number
  username: string
  role: string
  status: string
  points: number
  pointsEarned: number
  equippedTitle: { name: string; payload: string | null } | null
  createdAt: string
}

