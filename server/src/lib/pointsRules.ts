/**
 * 统一积分规则（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 所有游戏共用一套积分余额：单机结果由客户端上报、联机结果由服务端结算，
 * 两侧都调用 `computeGamePoints` 得到同一套「胜 / 负 / 平 / 参与 + 表现加成」。
 * 管理员可在 /admin/points 修改每个游戏的数值、每日获得上限与每日输分上限。
 *
 * 每日上限分两个方向：`dailyCap` 压正收益、`dailyLossCap` 压负收益（按绝对值），
 * 两者都是「按游戏、按当日」统计；达到上限后仍可继续游戏，只是不再计分。
 * 农场、签到、榜一奖励等非游戏来源不参与游戏日上限统计。
 */

import { GAME_KEYS, type GameKey, type GameOutcome } from './gameStatsRules.js'

export interface GamePointRule {
  /** 胜利 */
  win: number
  /** 失败 */
  loss: number
  /** 平局 */
  draw: number
  /** 无胜负概念的游戏（贪吃蛇 / 跳一跳 / 跑酷）完成一局 */
  participation: number
  /** 表现加成：score / scoreDivisor（0 = 不启用） */
  scoreDivisor: number
  /** 表现加成上限 */
  scoreBonusMax: number
  /** 每日正收益上限（0 = 不限） */
  dailyCap: number
  /** 每日负收益上限（绝对值，0 = 不限） */
  dailyLossCap: number
}

export interface FarmPointRule {
  /** 偷菜所得 = 作物单位价值 × 比例（0.1–1） */
  stealRatio: number
  /** 每日偷菜次数上限（小偷维度） */
  stealDailyLimit: number
  /** 偷菜成功率（0–1） */
  stealSuccessRate: number
  /** 每个玩家每天最多被成功偷几次（0 = 全天不可被偷） */
  victimDailyStealLimit: number
  /** 每日随机掉落种子上限（0 = 关闭掉落） */
  seedDropMax: number
  /** 随机商人每日商品数量（0 = 关闭商人） */
  merchantCount: number
  /** 商人最低折扣（0.4 = 4 折） */
  merchantDiscountMin: number
  /** 商人最高折扣（0.7 = 7 折） */
  merchantDiscountMax: number
  /** 首次创建农场赠送积分 */
  welcomePoints: number
}

export interface CheckinRule {
  /** 签到基础积分 */
  basePoints: number
  /** 连续签到每天递增积分 */
  streakStep: number
  /** 连签递增上限 */
  streakMaxBonus: number
}

export interface LeaderTitleRule {
  /** 单机榜一获得称号时的积分奖励（0 = 不发） */
  rewardPoints: number
}

export interface PointsConfigDto {
  games: Record<GameKey, GamePointRule>
  farm: FarmPointRule
  checkin: CheckinRule
  leaderTitle: LeaderTitleRule
}

export const DEFAULT_GAME_RULES: Record<GameKey, GamePointRule> = {
  '2048': { win: 25, loss: -6, draw: 0, participation: 0, scoreDivisor: 1000, scoreBonusMax: 20, dailyCap: 120, dailyLossCap: 20 },
  doudizhu: { win: 28, loss: -12, draw: 2, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 240, dailyLossCap: 40 },
  snake: { win: 0, loss: -2, draw: 0, participation: 4, scoreDivisor: 5, scoreBonusMax: 20, dailyCap: 100, dailyLossCap: 20 },
  minesweeper: { win: 20, loss: -5, draw: 0, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 160, dailyLossCap: 30 },
  jump: { win: 0, loss: -2, draw: 0, participation: 4, scoreDivisor: 5, scoreBonusMax: 20, dailyCap: 100, dailyLossCap: 20 },
  gomoku: { win: 25, loss: -10, draw: 3, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 200, dailyLossCap: 30 },
  liar: { win: 30, loss: -12, draw: 0, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 200, dailyLossCap: 40 },
  uno: { win: 22, loss: -8, draw: 2, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 200, dailyLossCap: 30 },
  xiangqi: { win: 35, loss: -12, draw: 4, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 240, dailyLossCap: 40 },
  parkour: { win: 0, loss: -2, draw: 0, participation: 6, scoreDivisor: 100, scoreBonusMax: 30, dailyCap: 120, dailyLossCap: 20 },
}

export const DEFAULT_FARM_RULE: FarmPointRule = {
  stealRatio: 0.6,
  stealDailyLimit: 10,
  stealSuccessRate: 0.65,
  victimDailyStealLimit: 10,
  seedDropMax: 3,
  merchantCount: 3,
  merchantDiscountMin: 0.4,
  merchantDiscountMax: 0.7,
  welcomePoints: 20,
}

export const DEFAULT_CHECKIN_RULE: CheckinRule = {
  basePoints: 10,
  streakStep: 5,
  streakMaxBonus: 100,
}

export const DEFAULT_LEADER_RULE: LeaderTitleRule = {
  rewardPoints: 50,
}

export const DEFAULT_POINTS_CONFIG: PointsConfigDto = {
  games: DEFAULT_GAME_RULES,
  farm: DEFAULT_FARM_RULE,
  checkin: DEFAULT_CHECKIN_RULE,
  leaderTitle: DEFAULT_LEADER_RULE,
}

/** 单条规则的合法范围（管理员输入会被夹到这里） */
const RULE_LIMITS = {
  win: [0, 1000],
  loss: [-1000, 0],
  draw: [-1000, 1000],
  participation: [-1000, 1000],
  scoreDivisor: [0, 1_000_000],
  scoreBonusMax: [0, 1000],
  dailyCap: [0, 100_000],
  dailyLossCap: [0, 100_000],
} as const

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

/** 浮点夹紧：0 是合法值，不能像 `|| 默认` 那样被吞掉 */
function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function normalizeGameRule(raw: unknown, fallback: GamePointRule): GamePointRule {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    win: clampInt(row.win, ...RULE_LIMITS.win, fallback.win),
    loss: clampInt(row.loss, ...RULE_LIMITS.loss, fallback.loss),
    draw: clampInt(row.draw, ...RULE_LIMITS.draw, fallback.draw),
    participation: clampInt(row.participation, ...RULE_LIMITS.participation, fallback.participation),
    scoreDivisor: clampInt(row.scoreDivisor, ...RULE_LIMITS.scoreDivisor, fallback.scoreDivisor),
    scoreBonusMax: clampInt(row.scoreBonusMax, ...RULE_LIMITS.scoreBonusMax, fallback.scoreBonusMax),
    dailyCap: clampInt(row.dailyCap, ...RULE_LIMITS.dailyCap, fallback.dailyCap),
    dailyLossCap: clampInt(row.dailyLossCap, ...RULE_LIMITS.dailyLossCap, fallback.dailyLossCap),
  }
}

/** 把数据库里的 JSON（可能缺字段 / 被手改坏）规整成完整配置 */
export function normalizePointsConfig(raw: unknown): PointsConfigDto {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const gamesRaw = source.games && typeof source.games === 'object'
    ? source.games as Record<string, unknown>
    : {}
  const games = {} as Record<GameKey, GamePointRule>
  for (const key of GAME_KEYS) {
    games[key] = normalizeGameRule(gamesRaw[key], DEFAULT_GAME_RULES[key])
  }

  const farmRaw = source.farm && typeof source.farm === 'object'
    ? source.farm as Record<string, unknown>
    : {}
  const discountMin = clampFloat(
    farmRaw.merchantDiscountMin,
    0.1,
    0.9,
    DEFAULT_FARM_RULE.merchantDiscountMin,
  )
  const discountMax = clampFloat(
    farmRaw.merchantDiscountMax,
    0.1,
    0.9,
    DEFAULT_FARM_RULE.merchantDiscountMax,
  )
  const farm: FarmPointRule = {
    stealRatio: clampFloat(farmRaw.stealRatio, 0.1, 1, DEFAULT_FARM_RULE.stealRatio),
    stealDailyLimit: clampInt(farmRaw.stealDailyLimit, 0, 100, DEFAULT_FARM_RULE.stealDailyLimit),
    stealSuccessRate: clampFloat(farmRaw.stealSuccessRate, 0, 1, DEFAULT_FARM_RULE.stealSuccessRate),
    victimDailyStealLimit: clampInt(farmRaw.victimDailyStealLimit, 0, 100, DEFAULT_FARM_RULE.victimDailyStealLimit),
    seedDropMax: clampInt(farmRaw.seedDropMax, 0, 10, DEFAULT_FARM_RULE.seedDropMax),
    merchantCount: clampInt(farmRaw.merchantCount, 0, 6, DEFAULT_FARM_RULE.merchantCount),
    merchantDiscountMin: Math.min(discountMin, discountMax),
    merchantDiscountMax: Math.max(discountMin, discountMax),
    welcomePoints: clampInt(farmRaw.welcomePoints, 0, 10_000, DEFAULT_FARM_RULE.welcomePoints),
  }

  const checkinRaw = source.checkin && typeof source.checkin === 'object'
    ? source.checkin as Record<string, unknown>
    : {}
  const checkin: CheckinRule = {
    basePoints: clampInt(checkinRaw.basePoints, 0, 1000, DEFAULT_CHECKIN_RULE.basePoints),
    streakStep: clampInt(checkinRaw.streakStep, 0, 500, DEFAULT_CHECKIN_RULE.streakStep),
    streakMaxBonus: clampInt(checkinRaw.streakMaxBonus, 0, 10_000, DEFAULT_CHECKIN_RULE.streakMaxBonus),
  }

  const leaderRaw = source.leaderTitle && typeof source.leaderTitle === 'object'
    ? source.leaderTitle as Record<string, unknown>
    : {}
  const leaderTitle: LeaderTitleRule = {
    rewardPoints: clampInt(leaderRaw.rewardPoints, 0, 10_000, DEFAULT_LEADER_RULE.rewardPoints),
  }

  return { games, farm, checkin, leaderTitle }
}

export interface GamePointInput {
  outcome?: GameOutcome
  score?: number
}

/**
 * 单局理论积分（未套每日上限）。
 *
 * - 有胜负：胜 / 负 / 平
 * - 无胜负（贪吃蛇 / 跳一跳 / 跑酷）：完成即参与分；0 分按失败处理
 * - 表现加成对所有带 score 的游戏生效，封顶 scoreBonusMax
 */
export function computeGamePoints(game: GameKey, rule: GamePointRule, input: GamePointInput): number {
  let amount = 0
  if (input.outcome === 'win') amount = rule.win
  else if (input.outcome === 'loss') amount = rule.loss
  else if (input.outcome === 'draw') amount = rule.draw
  else amount = (input.score ?? 0) > 0 ? rule.participation : rule.loss

  const score = input.score ?? 0
  if (score > 0 && rule.scoreDivisor > 0 && rule.scoreBonusMax > 0) {
    amount += Math.min(rule.scoreBonusMax, Math.floor(score / rule.scoreDivisor))
  }
  // 积分是整数；负值保留（扣分）
  return Math.trunc(amount)
}

/** 正收益按「今日该游戏已得」截断；非正收益原样返回 */
export function applyDailyCap(amount: number, earnedToday: number, dailyCap: number): number {
  if (amount <= 0) return amount
  if (dailyCap <= 0) return amount
  return Math.max(0, Math.min(amount, dailyCap - earnedToday))
}

/** 负收益按「今日该游戏已扣（绝对值）」截断；非负收益原样返回 */
export function applyDailyLossCap(amount: number, lostToday: number, dailyLossCap: number): number {
  if (amount >= 0) return amount
  if (dailyLossCap <= 0) return amount
  const allowed = Math.max(0, dailyLossCap - Math.max(0, lostToday))
  return -Math.min(-amount, allowed)
}

/** 今日日期键（Asia/Shanghai，YYYY-MM-DD） */
export function getTodayDateKey(now: number = Date.now()): string {
  const shanghai = new Date(now + 8 * 60 * 60 * 1000)
  const y = shanghai.getUTCFullYear()
  const m = String(shanghai.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shanghai.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 今日 0 点（Asia/Shanghai）对应的时间 */
export function getTodayDayStart(now: number = Date.now()): Date {
  return new Date(`${getTodayDateKey(now)}T00:00:00+08:00`)
}

/** 昨日日期键（用于签到连签判断） */
export function getYesterdayDateKey(now: number = Date.now()): string {
  return getTodayDateKey(now - 24 * 60 * 60 * 1000)
}

/** 签到奖励：基础分 + 连签递增（封顶） */
export function checkinReward(streak: number, rule: CheckinRule): number {
  const safeStreak = Math.max(1, Math.trunc(streak))
  return Math.max(0, Math.trunc(rule.basePoints + Math.min(rule.streakMaxBonus, (safeStreak - 1) * rule.streakStep)))
}

/** 商店 payload 解析（坏数据一律回退空对象） */
export function parseShopPayload(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** 称号颜色只接受 #rgb / #rrggbb，避免把任意 CSS 注入管理端展示 */
export function sanitizeTitleColor(value: unknown, fallback = '#57606a'): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value) ? value : fallback
}

/** 称号表情只取 1–2 个字符（emoji 可能是代理对），否则回退为空 */
export function sanitizeTitleIcon(value: unknown): string {
  if (typeof value !== 'string') return ''
  return [...value].slice(0, 2).join('')
}

/** 可购买的表情包 key（与客户端表情商店的包 id 对应） */
export const EMOJI_PACK_KEYS = ['nailong', 'felyne', 'twemoji'] as const

/** 头像框样式（客户端 CSS 类名后缀） */
export const AVATAR_FRAME_STYLES = ['gold', 'neon', 'sakura', 'galaxy'] as const
export type AvatarFrameStyle = typeof AVATAR_FRAME_STYLES[number]

export function sanitizeAvatarFrame(value: unknown): AvatarFrameStyle | null {
  return typeof value === 'string' && (AVATAR_FRAME_STYLES as readonly string[]).includes(value)
    ? value as AvatarFrameStyle
    : null
}
