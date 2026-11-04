/**
 * 游戏门票规则（纯函数，禁止 import prisma —— scripts/verify-ticket.ts 直接复用）。
 *
 * 口径（用户锁定，勿改）：
 *   - 游戏大厅 11 款游戏每局要 1 张门票，单机与联机一致；
 *   - 开心农场（farm）、贪吃蛇同屏双人（snake-local）、搜打撤（raid，仍走地图门票）不门票；
 *   - 门票在搜打撤官方商店 40 积分一张；每局真正打完必返 20 积分（胜/负/平/阵亡都返），
 *     该返还与胜负积分叠加；联机从未开局的对局（cancelled / dissolved / disbanded）
 *     把门票原样退回，且不返 20 积分；
 *   - 门票本体存在搜打撤仓库表 RaidInventoryItem 里（itemKey = game_ticket），
 *     余额只认服务端数据库，绝不相信客户端上报。
 *
 * 幂等锚：GameTicketLog.dedupKey 唯一索引，跨进程重启仍然有效；
 * P2002 一律视为「已经做过」静默跳过，绝不报错。
 */

import {
  GAME_TICKET_KEY,
  GAME_TICKET_PRICE,
  GAME_TICKET_RECYCLE_VALUE,
  GAME_TICKET_REFUND_POINTS,
} from './raidRun.js'

/* ============================================================
   经济口径（全部转引 raidRun.ts，本文件不重述任何数字）
   ============================================================ */

/** 门票物品 key（在 RAID_ITEMS 里，kind = material，因此可掉落 / 可买卖） */
export const TICKET_ITEM_KEY = GAME_TICKET_KEY
/** 官方商店一口价（积分） */
export const TICKET_PRICE = GAME_TICKET_PRICE
/** 每局打完必返（积分） */
export const TICKET_REFUND_POINTS = GAME_TICKET_REFUND_POINTS
/** 官方商店回收单价（积分） */
export const TICKET_RECYCLE_VALUE = GAME_TICKET_RECYCLE_VALUE

/** 打完一局的净成本：门票价 - 返还额（恒为正，否则「卖票」会优于「打球」） */
export const TICKET_NET_COST_PER_MATCH = TICKET_PRICE - TICKET_REFUND_POINTS

/** 经济不变量：买票 > 打球返还 > 卖票回收 */
export function ticketEconomicsSane(): boolean {
  return (
    TICKET_PRICE > TICKET_REFUND_POINTS
    && TICKET_REFUND_POINTS > TICKET_RECYCLE_VALUE
    && TICKET_NET_COST_PER_MATCH > 0
  )
}

/* ============================================================
   门票范围（11 款游戏大厅游戏）
   ============================================================ */

/**
 * 需要门票的游戏 key。
 *
 * 注意与 `gameStatsRules.GAME_KEYS` 不同：minecraft 不上报战绩（沙盒无胜负），
 * 但联机/单机开局同样要门票，所以门票清单单独维护，是 GAME_KEYS 的超集。
 */
export const TICKET_GAME_KEYS = [
  '2048',
  'doudizhu',
  'snake',
  'minesweeper',
  'jump',
  'minecraft',
  'gomoku',
  'liar',
  'uno',
  'xiangqi',
  'parkour',
] as const

export type TicketGameKey = typeof TICKET_GAME_KEYS[number]

/** 明确不门票的玩法（文档 / 自检用；snake-local 是同屏双人本地模式，服务端从未记账） */
export const NON_TICKETED_GAMES = ['farm', 'raid', 'snake-local'] as const

export type NonTicketedGame = typeof NON_TICKETED_GAMES[number]

/** 会话 / 台账里的玩法维度：single = 单机一局，online = 联机一场 */
export const TICKET_VARIANTS = ['single', 'online'] as const

export type TicketVariant = typeof TICKET_VARIANTS[number]

export const SOLO_TICKET_VARIANT: TicketVariant = 'single'
export const ONLINE_TICKET_VARIANT: TicketVariant = 'online'

/**
 * 单机战绩变体（solo / beginner / intermediate / expert …）在门票侧统一为 single；
 * 联机统一为 online；其余（含同屏双人 local）不接受门票记账。
 */
const SOLO_STATS_VARIANTS: readonly string[] = [
  'single',
  'solo',
  'beginner',
  'intermediate',
  'expert',
]

const ONLINE_STATS_VARIANTS: readonly string[] = ['online']

/** 明确免门票的客户端模式标识（同屏双人在前端本地进行，不上报任何数据） */
const EXEMPT_MODES: readonly string[] = ['local', 'snake-local', 'farm', 'raid']

export const SESSION_STATUS_OPEN = 'open'
export const SESSION_STATUS_CLOSED = 'closed'

export type SessionStatus = typeof SESSION_STATUS_OPEN | typeof SESSION_STATUS_CLOSED

export const TICKET_ACTIONS = {
  consume: 'consume',
  return: 'return',
  refund: 'refund',
} as const

export type TicketAction = typeof TICKET_ACTIONS[keyof typeof TICKET_ACTIONS]

/** 悬空单机会话的判死时长：超过它，下次开局时惰性结算（项目约定不跑定时器） */
export const STALE_SOLO_SESSION_MS = 6 * 60 * 60 * 1000

/** 台账备注长度上限（SQLite INT 之外唯一需要清洗的字符串） */
export const MAX_TICKET_NOTE_LENGTH = 200

/** 错误码：缺门票 / 会话无效（客户端据此弹门票说明框） */
export const TICKET_ERROR_CODE = 'TICKET_REQUIRED'

/** 一次联机开局最多处理的座位数（游戏人数上限 10，留一倍余量防异常入参放大查询） */
export const MAX_MATCH_SEATS = 20

/** matchId 落库为字符串（各游戏房间 id 类型不一律），限制字符集与长度 */
const MATCH_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/

/* ============================================================
   归一化纯函数
   ============================================================ */

export function isTicketGame(value: unknown): value is TicketGameKey {
  return typeof value === 'string' && (TICKET_GAME_KEYS as readonly string[]).includes(value)
}

/** 门票游戏 key 归一化（去空白、大小写敏感——key 本身就是小写标识符） */
export function normalizeTicketGame(value: unknown): TicketGameKey | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isTicketGame(trimmed) ? trimmed : null
}

/** 免门票玩法判定（farm / raid / 同屏双人） */
export function isTicketExemptMode(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim().toLowerCase()
  return EXEMPT_MODES.includes(trimmed)
}

/** 玩法维度归一化：单机战绩变体 → single；联机 → online；其它 → null */
export function ticketVariantOf(value: unknown): TicketVariant | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (SOLO_STATS_VARIANTS.includes(trimmed)) return SOLO_TICKET_VARIANT
  if (ONLINE_STATS_VARIANTS.includes(trimmed)) return ONLINE_TICKET_VARIANT
  return null
}

/** 会话 id 归一化：正整数才有效，其余（含 NaN / 小数 / 字符串数字）按 null */
export function normalizeSessionId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  return null
}

/** 用户 id 集合归一化：正整数、去重、保持首次出现顺序；非法元素丢弃 */
export function normalizeUserIds(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  const seen = new Set<number>()
  const out: number[] = []
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) continue
    if (seen.has(value)) continue
    seen.add(value)
    out.push(value)
    if (out.length >= MAX_MATCH_SEATS) break
  }
  return out
}

/** 对局 id 归一化（number 与非零填充的字符串都接受；空白丢弃） */
export function normalizeMatchId(value: unknown): string | null {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || !Number.isFinite(value)) return null
    return String(value)
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return MATCH_ID_PATTERN.test(trimmed) ? trimmed : null
}

/** 台账备注清洗：截断长度、压掉换行；空 → null */
export function normalizeTicketNote(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return cleaned.slice(0, MAX_TICKET_NOTE_LENGTH)
}

/** 门票数量归一化（仓库行的 amount 可能是负数脏数据，一律夹到非负整数） */
export function normalizeTicketAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  const int = Math.trunc(value)
  return int > 0 ? int : 0
}

/** 管理员免票（管理员的 isFeatureEnabled 恒为 true，不免票会被自己的开关锁死） */
export function isTicketExemptRole(role: unknown): boolean {
  return role === 'admin'
}

/* ============================================================
   幂等键（dedupKey 的唯一真相源）
   ============================================================ */

/** 单机开局扣票：c:s:<sessionId> */
export function consumeSoloDedupKey(sessionId: number): string {
  return `c:s:${normalizeSessionId(sessionId) ?? 0}`
}

/** 单机局终返还 20 积分：f:s:<sessionId> */
export function refundSoloDedupKey(sessionId: number): string {
  return `f:s:${normalizeSessionId(sessionId) ?? 0}`
}

/** 联机开局扣票：c:o:<game>:<matchId>:<userId> */
export function consumeOnlineDedupKey(game: string, matchId: string, userId: number): string {
  return `c:o:${game}:${matchId}:${userId}`
}

/** 联机未开局退票：r:o:<game>:<matchId>:<userId> */
export function returnOnlineDedupKey(game: string, matchId: string, userId: number): string {
  return `r:o:${game}:${matchId}:${userId}`
}

/** 联机局终返还 20 积分：f:o:<game>:<matchId>:<userId> */
export function refundOnlineDedupKey(game: string, matchId: string, userId: number): string {
  return `f:o:${game}:${matchId}:${userId}`
}

/** 扣票（consume）在台账里记 -1 张；退票（return）记 +1 张；返还积分不动票 */
export function ticketDeltaForAction(action: TicketAction): number {
  if (action === TICKET_ACTIONS.consume) return -1
  if (action === TICKET_ACTIONS.return) return 1
  return 0
}

/* ============================================================
   会话生命周期纯函数
   ============================================================ */

/** 单机会话是否已悬空（超过 STALE_SOLO_SESSION_MS 未结算） */
export function isStaleSoloSession(startedAtMs: number, nowMs: number): boolean {
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(nowMs)) return false
  return nowMs - startedAtMs >= STALE_SOLO_SESSION_MS
}

/**
 * 单机结算是否要求会话：
 * 开关关闭时恒为 false（与门票上线前的行为逐字一致），
 * 开启时必须有属于本人且仍为 open 的会话。
 */
export function soloResultNeedsSession(ticketEnforced: boolean, sessionId: unknown): boolean {
  return ticketEnforced && normalizeSessionId(sessionId) === null
}

/** 缺票提示里最多点名几位玩家（其余折叠成「等 N 人」） */
const MAX_MISSING_NAMES = 5

/** 联机开局前预检失败文案：点名没有门票的玩家 */
export function formatMissingTicketMessage(names: readonly string[]): string {
  const list = names.map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean)
  if (list.length === 0) return `所有玩家都需要 1 张游戏门票才能开局（门票 ${TICKET_PRICE} 积分一张，打完必返 ${TICKET_REFUND_POINTS} 积分）`
  const head = list.slice(0, MAX_MISSING_NAMES).join('、')
  const rest = list.length - Math.min(list.length, MAX_MISSING_NAMES)
  const tail = rest > 0 ? ` 等 ${rest} 人` : ''
  return `${head}${tail} 没有游戏门票，开局需要每人 1 张（门票 ${TICKET_PRICE} 积分一张，打完必返 ${TICKET_REFUND_POINTS} 积分）`
}

/** 门票规则文案（大厅卡片 / 弹窗共用口径） */
export function ticketLobbyCopy(): string {
  return '本局需 1 张门票'
}

/**
 * 返还积分的台账 reason（前端 PointsPage 的中文标签由主代理同步）。
 * 单一定义点，避免各处字符串漂移。
 */
export const TICKET_REFUND_REASON = 'game_ticket_refund'
/** 扣票 / 退票的台账 reason（GameTicketLog 是票据台账，不进积分台账） */
export const TICKET_CONSUME_REASON = 'game_ticket_consume'
export const TICKET_RETURN_REASON = 'game_ticket_return'
