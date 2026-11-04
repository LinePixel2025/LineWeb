/**
 * Lineweb 危机（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 机制：站内积分长期只增不减，需要一条全局回收阀。每个非管理员用户每 `intervalMs`
 * （默认 48 小时，从**自己上次结清**的时刻起滚动计算）要向「Lineweb 公共银行」上缴
 * 约总资产 `ratio`（默认 50%）的积分；未缴清且过了宽限，就封锁全站功能，
 * 只留下筹钱与查账需要的端点。公共银行只进不出，站内只显示总额。
 *
 * 三条容易做错的口径，都在这里定死：
 * 1. **应缴额在开轮瞬间按总资产快照冻结**，此后资产涨跌不改本轮账单（否则就是移动球门）；
 * 2. **部分缴纳不延长宽限**：`graceUntil` 只由开轮时刻决定，否则「每次缴 1 分」能无限续命；
 * 3. **未达免征门槛一律归零**：算出来的应缴额小于 `minLevy` 就当没有税，
 *    保证新注册 / 零资产用户永远不会被封锁。
 */

export const CRISIS_LEDGER_REASON = 'crisis_payment'

export interface CrisisRules {
  /** 危机总开关：关掉后守卫一律放行 */
  enabled: boolean
  /** 应缴比例：required = floor(快照 × ratio) */
  ratio: number
  /** 结清后多久开下一轮（毫秒） */
  intervalMs: number
  /** 开轮后到封锁之前的宽限时长（毫秒） */
  graceMs: number
  /** 免征门槛：算出的应缴额低于它则归零 */
  minLevy: number
}

const HOUR_MS = 60 * 60 * 1000

export const CRISIS_DEFAULTS: CrisisRules = {
  enabled: true,
  ratio: 0.5,
  intervalMs: 48 * HOUR_MS,
  graceMs: 12 * HOUR_MS,
  minLevy: 100,
}

/**
 * 管理员可调范围。上下界存在的意义是防止一个误操作把全站锁死：
 * intervalMs 下限 1 小时（比它更短的周期等于持续封锁），graceMs 下限 1 分钟。
 */
export const CRISIS_LIMITS = {
  ratioMin: 0,
  ratioMax: 1,
  intervalMinMs: HOUR_MS,
  intervalMaxMs: 365 * 24 * HOUR_MS,
  graceMinMs: 60 * 1000,
  graceMaxMs: 30 * 24 * HOUR_MS,
  minLevyMin: 0,
  minLevyMax: 1_000_000,
} as const

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.min(max, Math.max(min, num))
}

/** 深合并语义：缺失 / 脏字段一律回退默认值，管理员只覆盖想改的项 */
export function normalizeCrisisRules(raw: unknown): CrisisRules {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    enabled: input.enabled === undefined ? CRISIS_DEFAULTS.enabled : Boolean(input.enabled),
    ratio: clampNumber(input.ratio, CRISIS_LIMITS.ratioMin, CRISIS_LIMITS.ratioMax, CRISIS_DEFAULTS.ratio),
    intervalMs: clampNumber(
      input.intervalMs,
      CRISIS_LIMITS.intervalMinMs,
      CRISIS_LIMITS.intervalMaxMs,
      CRISIS_DEFAULTS.intervalMs,
    ),
    graceMs: clampNumber(input.graceMs, CRISIS_LIMITS.graceMinMs, CRISIS_LIMITS.graceMaxMs, CRISIS_DEFAULTS.graceMs),
    minLevy: Math.floor(clampNumber(input.minLevy, CRISIS_LIMITS.minLevyMin, CRISIS_LIMITS.minLevyMax, CRISIS_DEFAULTS.minLevy)),
  }
}

/**
 * 本轮应缴额。
 * - 向下取整（对用户友好，也不出现 0.5 分这种无意义数字）；
 * - 未达免征门槛直接归零；
 * - 绝不允许超过快照本身（ratio 被管理员调到 1 时等于全额，但不能变成负资产）。
 */
export function computeRequired(snapshot: number, rules: CrisisRules): number {
  if (!Number.isFinite(snapshot) || snapshot <= 0) return 0
  const raw = Math.floor(snapshot * rules.ratio)
  if (raw <= 0 || raw < rules.minLevy) return 0
  return Math.min(raw, Math.floor(snapshot))
}

/** 宽限截止：只由开轮时刻决定，部分缴纳不改这个值 */
export function graceUntilOf(openAtMs: number, rules: CrisisRules): number {
  return openAtMs + rules.graceMs
}

/** 下一轮到期时刻：只由结清时刻决定 */
export function nextDueAtOf(settledAtMs: number, rules: CrisisRules): number {
  return settledAtMs + rules.intervalMs
}

/** 税单的最小视图（服务层从 Prisma 行或缓存里取到的形状） */
export interface CrisisLevyView {
  status: string
  round: number
  snapshot: number
  required: number
  paid: number
  openAt: number | null
  graceUntil: number | null
  settledAt: number | null
  nextDueAt: number | null
}

export const EMPTY_CRISIS_LEVY_VIEW: CrisisLevyView = {
  status: 'clear',
  round: 0,
  snapshot: 0,
  required: 0,
  paid: 0,
  openAt: null,
  graceUntil: null,
  settledAt: null,
  nextDueAt: null,
}

export type CrisisStatus = 'clear' | 'due' | 'blocked'

/**
 * 该不该开新一轮税单：已结清且到期。
 * `nextDueAt` 为空表示从未结清过（新用户首访建行时会设成「now + interval」，给出宽裕的起步期）。
 */
export function isLevyDue(levy: CrisisLevyView, rules: CrisisRules, nowMs: number): boolean {
  if (!rules.enabled) return false
  if (levy.status !== 'clear') return false
  if (levy.nextDueAt === null) return false
  return nowMs >= levy.nextDueAt
}

export function remainingOf(levy: CrisisLevyView): number {
  return Math.max(0, levy.required - levy.paid)
}

/**
 * 封锁判定的唯一口径（守卫、DTO、自检都走这里，不允许各处各写一套）。
 *
 * 四个条件全部成立才封：开关开着 · 本轮未缴满 · 已过宽限 · 没有进行中的搜打撤对局。
 * 最后一条是「打完这局再封」：对局进行中断封会把已经撤离但没存进仓库的战利品卡死。
 */
export function isCrisisBlocked(
  levy: CrisisLevyView,
  rules: CrisisRules,
  nowMs: number,
  hasLiveRaid = false,
): boolean {
  return resolveCrisisStatus(levy, rules, nowMs, hasLiveRaid) === 'blocked'
}

export function resolveCrisisStatus(
  levy: CrisisLevyView,
  rules: CrisisRules,
  nowMs: number,
  hasLiveRaid = false,
): CrisisStatus {
  if (!rules.enabled) return 'clear'
  if (levy.status === 'due') {
    if (remainingOf(levy) === 0) return 'clear'
    if (hasLiveRaid) return 'due'
    if (levy.graceUntil === null) return 'due'
    return nowMs > levy.graceUntil ? 'blocked' : 'due'
  }
  // clear：到期待开轮也显示为 due（服务层会在读到这一刻顺手开轮）
  if (isLevyDue(levy, rules, nowMs)) return 'due'
  return 'clear'
}

/** 距离被封锁还剩多少毫秒；已封锁、未开轮或已缴满时返回 0 */
export function msUntilBlock(levy: CrisisLevyView, nowMs: number): number {
  if (levy.status !== 'due' || levy.graceUntil === null) return 0
  // 已缴满但服务层还没落 settledAt 的瞬时状态，不该再显示「距封锁还剩 N 小时」
  if (remainingOf(levy) === 0) return 0
  return Math.max(0, levy.graceUntil - nowMs)
}

/** 资产分项（顺序即前端展示顺序；任何一项都不允许是负数） */
export interface CrisisAssetParts {
  points: number
  raidGear: number
  raidWarehouse: number
  raidBags: number
  petOutfits: number
  petEquipment: number
  petSkills: number
  stocks: number
  stockOrders: number
  bankDemand: number
  bankDeposits: number
  funds: number
}

export const EMPTY_CRISIS_ASSETS: CrisisAssetParts = {
  points: 0,
  raidGear: 0,
  raidWarehouse: 0,
  raidBags: 0,
  petOutfits: 0,
  petEquipment: 0,
  petSkills: 0,
  stocks: 0,
  stockOrders: 0,
  bankDemand: 0,
  bankDeposits: 0,
  funds: 0,
}

function safeInt(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** 总资产 = 各项之和；脏值按 0 处理，绝不让 NaN 进账单 */
export function sumCrisisAssets(parts: CrisisAssetParts): number {
  return Object.values(parts).reduce((sum, value) => sum + safeInt(value), 0)
}

export interface CrisisStateDto {
  enabled: boolean
  /** 管理员豁免：不参与开轮与封锁，账单恒为 clear（服务端守卫也直接放行） */
  exempt: boolean
  status: CrisisStatus
  blocked: boolean
  hasLiveRaid: boolean
  round: number
  snapshot: number
  required: number
  paid: number
  remaining: number
  assets: { total: number; parts: CrisisAssetParts }
  rules: CrisisRules
  openAt: string | null
  graceUntil: string | null
  settledAt: string | null
  nextDueAt: string | null
  msUntilBlock: number
  /** 公共银行累计上缴总额。BigInt 不能进 JSON，一律字符串 */
  poolTotal: string
}

function isoOf(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString()
}

/** DTO 出口（纯函数，便于自检脚本断言字段契约；BigInt 在这里就必须已经转成字符串） */
export function buildCrisisStateDto(input: {
  levy: CrisisLevyView
  rules: CrisisRules
  parts: CrisisAssetParts
  poolTotal: string
  hasLiveRaid?: boolean
  exempt?: boolean
  nowMs: number
}): CrisisStateDto {
  const { levy, rules, nowMs } = input
  const exempt = input.exempt === true
  const parts: CrisisAssetParts = {
    points: safeInt(input.parts.points),
    raidGear: safeInt(input.parts.raidGear),
    raidWarehouse: safeInt(input.parts.raidWarehouse),
    raidBags: safeInt(input.parts.raidBags),
    petOutfits: safeInt(input.parts.petOutfits),
    petEquipment: safeInt(input.parts.petEquipment),
    petSkills: safeInt(input.parts.petSkills),
    stocks: safeInt(input.parts.stocks),
    stockOrders: safeInt(input.parts.stockOrders),
    bankDemand: safeInt(input.parts.bankDemand),
    bankDeposits: safeInt(input.parts.bankDeposits),
    funds: safeInt(input.parts.funds),
  }
  const hasLiveRaid = input.hasLiveRaid === true
  // 管理员豁免：不封锁、不计账单，但仍如实展示其资产（便于管理员核对征收口径）
  const status: CrisisStatus = exempt ? 'clear' : resolveCrisisStatus(levy, rules, nowMs, hasLiveRaid)
  return {
    enabled: rules.enabled,
    exempt,
    status,
    blocked: status === 'blocked',
    hasLiveRaid,
    round: levy.round,
    snapshot: levy.snapshot,
    required: levy.required,
    paid: levy.paid,
    remaining: remainingOf(levy),
    assets: { total: sumCrisisAssets(parts), parts },
    rules,
    openAt: isoOf(levy.openAt),
    graceUntil: isoOf(levy.graceUntil),
    settledAt: isoOf(levy.settledAt),
    nextDueAt: isoOf(levy.nextDueAt),
    msUntilBlock: status === 'due' ? msUntilBlock(levy, nowMs) : 0,
    poolTotal: input.poolTotal,
  }
}

export interface CrisisExemptRule {
  pattern: RegExp
}

/**
 * 被封锁用户仍可访问的端点（deny-by-default：未列入一律 403）。
 *
 * 只留两类：**处理税单本身**、**把资产换成流动积分 / 查账**。
 * 特别注意 `/api/pets/*` 与 `/api/pets/raid/*` 是前缀关系，必须写精确，
 * 绝不能图省事写成 `^/api/pets`——那等于把搜打撤对局、宠物对战、交易行全放行。
 * 一律不放行任何「能挣分」的入口（游戏 / 农场 / 抽奖 / 签到在 points 之外，
 * 对局结算走 pets 与 game-stats 也都不在名单里）。
 */
export const CRISIS_EXEMPT_RULES: readonly CrisisExemptRule[] = [
  // 税单本身
  { pattern: /^\/api\/crisis(?:\/.*)?$/ },
  // 登录态与个人资料（不能把人锁在站外，也要能退出登录）
  { pattern: /^\/api\/auth\/me$/ },
  { pattern: /^\/api\/auth\/profile$/ },
  { pattern: /^\/api\/auth\/settings$/ },
  { pattern: /^\/api\/auth\/logout$/ },
  { pattern: /^\/api\/auth\/avatar(?:\/.*)?$/ },
  // 运维探针与开关（前端要按开关渲染导航）
  { pattern: /^\/api\/features$/ },
  { pattern: /^\/api\/health(?:\/.*)?$/ },
  { pattern: /^\/api\/version$/ },
  // 筹钱 / 查账：积分余额与流水
  { pattern: /^\/api\/points(?:\/.*)?$/ },
  // 筹钱：银行取出 / 定期支取 / 基金赎回
  { pattern: /^\/api\/bank(?:\/.*)?$/ },
  // 筹钱：卖股票、撤单退冻结积分
  { pattern: /^\/api\/stocks(?:\/.*)?$/ },
  // 筹钱：搜打撤仓库存取 / 一键回收 / 官方商店 / 开箱（都不产生新积分来源）
  { pattern: /^\/api\/pets\/raid\/storage(?:\/.*)?$/ },
  { pattern: /^\/api\/pets\/raid\/shop(?:\/.*)?$/ },
  { pattern: /^\/api\/pets\/raid\/gear\/open-cache$/ },
]

/**
 * 未列入豁免表的端点是否需要封锁（豁免规则与方法无关，一律按路径判定）。
 * 末尾斜杠容错与 appScopes.requiredScopeForEndpoint 同口径：
 * 挂在 /api/pets 的 router 处理 POST /api/pets 时 req.path 是 '/'，拼接后带尾斜杠。
 */
export function isCrisisExempt(fullPath: string): boolean {
  const normalized = fullPath.length > 1 && fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath
  return CRISIS_EXEMPT_RULES.some((rule) => rule.pattern.test(normalized))
}
