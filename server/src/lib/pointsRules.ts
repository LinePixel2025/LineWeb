/**
 * 统一积分规则（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 所有游戏共用一套积分余额：单机结果由客户端上报、联机结果由服务端结算，
 * 两侧都调用 `computeGamePoints` 得到同一套「胜 / 负 / 平 / 参与 + 表现加成」。
 * 管理员可在 /admin/points 修改每个游戏的数值与每日上限。
 *
 * 每日上限只限制「正收益」：输棋扣分始终生效，避免刷上限的动机反过来放大小号送分。
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
}

export interface FarmPointRule {
  /** 偷菜所得 = 作物单位价值 × 比例（0.1–1） */
  stealRatio: number
  /** 每日偷菜次数上限 */
  stealDailyLimit: number
  /** 首次创建农场赠送积分 */
  welcomePoints: number
}

export interface PointsConfigDto {
  games: Record<GameKey, GamePointRule>
  farm: FarmPointRule
}

export const DEFAULT_GAME_RULES: Record<GameKey, GamePointRule> = {
  '2048': { win: 25, loss: -6, draw: 0, participation: 0, scoreDivisor: 1000, scoreBonusMax: 20, dailyCap: 120 },
  doudizhu: { win: 28, loss: -12, draw: 2, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 240 },
  snake: { win: 0, loss: -2, draw: 0, participation: 4, scoreDivisor: 5, scoreBonusMax: 20, dailyCap: 100 },
  minesweeper: { win: 20, loss: -5, draw: 0, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 160 },
  jump: { win: 0, loss: -2, draw: 0, participation: 4, scoreDivisor: 5, scoreBonusMax: 20, dailyCap: 100 },
  gomoku: { win: 25, loss: -10, draw: 3, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 200 },
  liar: { win: 30, loss: -12, draw: 0, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 200 },
  uno: { win: 22, loss: -8, draw: 2, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 200 },
  xiangqi: { win: 35, loss: -12, draw: 4, participation: 0, scoreDivisor: 0, scoreBonusMax: 0, dailyCap: 240 },
  parkour: { win: 0, loss: -2, draw: 0, participation: 6, scoreDivisor: 100, scoreBonusMax: 30, dailyCap: 120 },
}

export const DEFAULT_FARM_RULE: FarmPointRule = {
  stealRatio: 0.6,
  stealDailyLimit: 10,
  welcomePoints: 20,
}

export const DEFAULT_POINTS_CONFIG: PointsConfigDto = {
  games: DEFAULT_GAME_RULES,
  farm: DEFAULT_FARM_RULE,
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
} as const

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
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
  const farm: FarmPointRule = {
    stealRatio: Math.min(1, Math.max(0.1, Number(farmRaw.stealRatio) || DEFAULT_FARM_RULE.stealRatio)),
    stealDailyLimit: clampInt(farmRaw.stealDailyLimit, 0, 100, DEFAULT_FARM_RULE.stealDailyLimit),
    welcomePoints: clampInt(farmRaw.welcomePoints, 0, 10_000, DEFAULT_FARM_RULE.welcomePoints),
  }
  return { games, farm }
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
