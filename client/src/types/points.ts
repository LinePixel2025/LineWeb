/** 站内称号（只在 LineWeb 内部展示，不写入 neko / 聊天服务） */
export interface UserTitleDto {
  id: number
  name: string
  color: string
  icon: string
}

/** GET /api/points/me */
export interface PointsProfile {
  balance: number
  earned: number
  rank: number
  title: UserTitleDto | null
  /** 已购商品 key（含表情包，客户端据此解锁表情商店） */
  ownedKeys: string[]
}

export type ShopItemType = 'title' | 'emoji'
export type ShopRarity = 'common' | 'rare' | 'epic' | 'legendary'

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
}

export interface FarmPointRule {
  stealRatio: number
  stealDailyLimit: number
  welcomePoints: number
}

export interface PointsConfig {
  games: Record<string, GamePointRule>
  farm: FarmPointRule
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

