/**
 * 传说称号动态特效白名单（与服务端 TITLE_EFFECT_STYLES 一致，顺序一致，共 17 种）。
 * 炸裂系列：nova 超新星 / prism 棱镜虹光 / void 虚空黑洞 / singularity 奇点坍缩。
 * 幻彩系列：meteor 流星拖尾 / blossom 花瓣飘落 / zenith 极巅光柱 / eternity 永恒之环 /
 *          chaos 混沌碎片 / firmament 苍穹星海。
 * 至臻系列：genesis 创世星环 / oblivion 湮灭奇点（只给至臻稀有度称号使用）。
 */
export const TITLE_EFFECTS = [
  'classic',
  'stardust',
  'flame',
  'aurora',
  'thunder',
  'nova',
  'prism',
  'void',
  'meteor',
  'blossom',
  'singularity',
  'zenith',
  'eternity',
  'chaos',
  'firmament',
  'genesis',
  'oblivion',
] as const
export type TitleEffectStyle = typeof TITLE_EFFECTS[number]

/**
 * 商品稀有度：legendary / mythic / transcendent 都会触发炸裂特效：
 * mythic 额外挂黑金翼饰层，transcendent（至臻，2026-11-10 新增最高档）再叠一层至臻星环。
 */
export interface UserTitleDto {
  id: number
  name: string
  color: string
  icon: string
  /** 商品稀有度：legendary / mythic / transcendent 都会触发炸裂特效 */
  rarity: string
  /** 传说特效（legendary / mythic / transcendent 时的动态特效 key，其余稀有度忽略；非法值回退 classic） */
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
export type ShopRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'transcendent'

/**
 * 头像框样式白名单（与服务端 AVATAR_FRAME_STYLES 一致，顺序一致，共 16 种）。
 * 炸裂系列：inferno 炽焰 / storm 雷霆 / supernova 星爆。
 * 幻彩系列：frost 冰晶 / venom 翠毒（普通框）、royal 紫金 / cyber 赛博（装饰层框）。
 * 神话系列：abyss 深渊 / eclipse 蚀月（普通框）、quantum 量子 / draconis 龙裔 / immortal 不朽（装饰层框）。
 */
export const AVATAR_FRAMES = [
  'gold',
  'neon',
  'sakura',
  'galaxy',
  'inferno',
  'storm',
  'supernova',
  'frost',
  'venom',
  'royal',
  'cyber',
  'abyss',
  'eclipse',
  'quantum',
  'draconis',
  'immortal',
] as const
export type AvatarFrameStyle = typeof AVATAR_FRAMES[number]

/** 需要额外装饰层（gh-avatar-frame-fx）的炸裂 / 幻彩 / 神话头像框；其余框只用外圈伪元素 */
export const PREMIUM_AVATAR_FRAMES = [
  'inferno', 'storm', 'supernova', 'royal', 'cyber',
  'quantum', 'draconis', 'immortal',
] as const
export type PremiumAvatarFrameStyle = typeof PREMIUM_AVATAR_FRAMES[number]

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

