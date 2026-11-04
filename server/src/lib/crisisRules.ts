/**
 * Lineweb 危机（纯函数，禁止 import prisma / 网络依赖）。
 *
 * 机制：站内积分长期只增不减，需要一条全局回收阀。每个非管理员用户每 `intervalMs`
 * （默认 48 小时，从**自己上次结清**的时刻起滚动计算）要向「Lineweb 公共银行」上缴
 * 约总资产 `ratio`（默认 50%）的积分；未缴清且过了宽限，就封锁全站功能，
 * 只留下筹钱与查账需要的端点。公共银行只进不出，站内只显示总额。
 *
 * 四条容易做错的口径，都在这里定死：
 * 1. **应缴额在开轮瞬间按总资产快照冻结**，此后资产涨跌不改本轮账单（否则就是移动球门）；
 * 2. **部分缴纳不延长宽限**：`graceUntil` 只由开轮时刻决定，否则「每次缴 1 分」能无限续命；
 * 3. **未达免征门槛一律归零**：算出来的应缴额小于 `minLevy` 就当没有税，
 *    保证新注册 / 零资产用户永远不会被封锁。
 * 4. **公司业绩可以折减账单，但只折减、不赦免**：见下方 `CRISIS_WAIVER_TIERS` 与
 *    `applyCrisisWaivers`。减免档位每人每档终身只享一次（`crisis_waivers` 的唯一键），
 *    折减后的数字允许低于 `minLevy`。
 */

export const CRISIS_LEDGER_REASON = 'crisis_payment'

/**
 * 积分税款台账 reason：开启自选开关（User.crisisTaxEnabled）的用户每次花费积分
 * 额外扣出的那笔税（唯一写入点在 pointsService.spendPointsTx）。
 * 它与 CRISIS_LEDGER_REASON 互为免税口径——还危机本身（crisis_payment）不再抽税，
 * 防「缴税又被抽税」的死循环；两处常量必须一起改。
 */
export const CRISIS_TAX_LEDGER_REASON = 'crisis_tax'

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
  /**
   * 积分税款比例（%）：自选开关开启后，每次花费积分额外扣除的百分比，直接进 CrisisPool。
   * 口径（唯一挂钩点是 pointsService.spendPointsTx，别处不抽税）：
   * - reason 为 crisis_payment（还危机本身）免税，防循环；
   * - 管理员加分与 awardPointsTx 负数（游戏输分）都不经过 spendPointsTx，天然不抽税；
   * - 该税独立于危机总开关 enabled——它是用户自愿的捐赠，不是强制征收。
   */
  spendTaxPct: number
}

const HOUR_MS = 60 * 60 * 1000

export const CRISIS_DEFAULTS: CrisisRules = {
  enabled: true,
  ratio: 0.5,
  intervalMs: 48 * HOUR_MS,
  graceMs: 12 * HOUR_MS,
  minLevy: 100,
  spendTaxPct: 5,
}

/**
 * 管理员可调范围。上下界存在的意义是防止一个误操作把全站锁死：
 * intervalMs 下限 1 小时（比它更短的周期等于持续封锁），graceMs 下限 1 分钟，
 * 积分税款上限 50%（比它更高的「自愿」税等于半价消费，必然是误操作）。
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
  spendTaxMin: 0,
  spendTaxMax: 50,
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
    // 与 minLevy 同口径 floor：税款按分收，不出现小数百分比
    spendTaxPct: Math.floor(
      clampNumber(input.spendTaxPct, CRISIS_LIMITS.spendTaxMin, CRISIS_LIMITS.spendTaxMax, CRISIS_DEFAULTS.spendTaxPct),
    ),
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

/**
 * ============ 公司业绩减免（危机税唯一的「减税」原语） ============
 *
 * 公司累计营业额（`Company.revenue`，只增）跨过三档阈值后，成员可以用它折减**当前这一轮**
 * 的应缴额。三档在 `Company.tierMask` 里按位记录（bit0 = 档 1），服务层据此判断「已达成」，
 * 用 `crisis_waivers` 的唯一键 [userId, tier] 判断「已享用」（每人每档终身一次，换公司也不能重复领）。
 *
 * 阈值必须与 lib/companyRules.ts 抬档时用的阈值完全一致 —— 两份清单各自成文，
 * 由 scripts/verify-crisis.ts 直接读 companyRules.ts 源码做交叉断言（与
 * client/src/lib/__tests__/permissions.test.ts 读服务端源码同一路子）。
 */
export interface CrisisWaiverTier {
  /** 档位号 1/2/3，同时是 tierMask 的位序（tier - 1 即比特位） */
  tier: number
  /** 达成阈值：公司累计营业额达到它才算跨过这一档 */
  threshold: number
  /** 折减百分比：作用于「减免前」的应缴额，多档按乘算叠加 */
  pct: number
}

export const CRISIS_WAIVER_TIERS: readonly CrisisWaiverTier[] = [
  { tier: 1, threshold: 10_000, pct: 10 },
  { tier: 2, threshold: 50_000, pct: 25 },
  { tier: 3, threshold: 200_000, pct: 50 },
]

/** 按档位号取折减百分比（未知档位返回 0：目录外的人不该凭空减税） */
export function crisisWaiverPctOf(tier: number): number {
  const hit = CRISIS_WAIVER_TIERS.find((entry) => entry.tier === tier)
  return hit ? hit.pct : 0
}

/** tierMask → 已达成的档位列表（升序）。脏掩码（非整数 / 负数）与高位脏比特一律忽略。 */
export function crisisTiersFromMask(mask: number): number[] {
  if (!Number.isFinite(mask) || mask < 0) return []
  const clean = Math.floor(mask)
  return CRISIS_WAIVER_TIERS.filter((entry) => ((clean >> (entry.tier - 1)) & 1) === 1).map((entry) => entry.tier)
}

/** 档位列表 → 合法且去噪后的档位列表（升序，目录外的档位剔除） */
export function crisisWaiverTiersOf(tiers: readonly number[]): number[] {
  return [...new Set(tiers)]
    .filter((tier) => CRISIS_WAIVER_TIERS.some((entry) => entry.tier === tier))
    .sort((a, b) => a - b)
}

/** 档位列表 → 折减百分比列表（按档位升序，未知档位剔除） */
export function crisisWaiverPcts(tiers: readonly number[]): number[] {
  return crisisWaiverTiersOf(tiers).map((tier) => crisisWaiverPctOf(tier))
}

/**
 * 把若干档折减乘算作用到「减免前」的应缴额上：`base × 0.9 × 0.75 × 0.5`。
 *
 * 三处口径：
 * - **只在最后取整一次**（逐档取整会因为 1 分的误差累积让账单少得更多，也让双端难对齐）；
 * - 结果恒在 `[0, base]`：折减只会把账单变小，绝不会变大，也不会变成负数；
 * - 没有任何档位时**逐字返回 base**（无减免路径必须与改动前完全等价）。
 *
 * 关于 `minLevy`（这是本次改造最容易改错的一处，别再「顺手」加钳制）：
 * `minLevy` 是**累计征收的门槛**——应缴额算不到它就当本轮没有税，它**不是已生成账单的下界**。
 * 所以折减后的数字允许低于 `minLevy`（甚至允许被 100% 档折到 0）：债务已经成立，
 * 公司业绩只负责把它打折。反过来，`minLevy` 在这里唯一参与的地方是**入参侧**——
 * 若传进来的 `base` 本身就低于当前门槛（只可能是管理员事后把门槛调高、
 * 或历史脏数据），这笔账单不按「业绩减免」处理：原样返回、不消费档位。
 * 这样既不会把小额账单又抬回门槛（等于取消减免），也不会因为调高门槛就凭空赦免欠款。
 */
export function applyCrisisWaivers(base: number, tierPcts: readonly number[], minLevy = 0): number {
  const cleanBase = safeInt(base)
  if (cleanBase <= 0) return 0
  if (minLevy > 0 && cleanBase < minLevy) return cleanBase
  const pcts = normalizeWaiverPcts(tierPcts)
  if (pcts.length === 0) return cleanBase
  // 纯整数运算：分子 = ∏(100 - pct)，分母 = 100^档数，最后一次 floor，避免浮点误差改变取整结果
  const numerator = pcts.reduce((product, pct) => product * (100 - pct), 1)
  const denominator = 100 ** pcts.length
  const reduced = Math.floor((cleanBase * numerator) / denominator)
  return Math.max(0, Math.min(cleanBase, reduced))
}

/** 脏百分比一律钳进 [0, 100]；非有限值按 0（等于这一档不生效）处理 */
function normalizeWaiverPcts(tierPcts: readonly number[]): number[] {
  return tierPcts.map((pct) => (Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.floor(pct))) : 0))
}

export interface CrisisWaiverStep {
  tier: number
  pct: number
  /** 这一档相对上一档累计状态**多减**的积分（各档相加恰好等于 base - 最终应缴） */
  reduction: number
}

/**
 * 逐档归因：把总折减拆到每一档头上，供 `crisis_waivers.reduction` 落账（税单页与审计要看得到
 * 「这一档到底给我省了几分」）。实现上是对同一个 base 取「档位前缀」再调一次 `applyCrisisWaivers`，
 * 所以差额天然望远镜求和 = base - 最终应缴，不会出现「各档相加对不上总账」。
 */
export function applyCrisisWaiversByTier(
  base: number,
  tiers: readonly number[],
  minLevy = 0,
): { required: number; requiredBase: number; waiverPct: number; steps: CrisisWaiverStep[] } {
  const cleanBase = safeInt(base)
  const tierList = crisisWaiverTiersOf(tiers)
  const required = applyCrisisWaivers(cleanBase, crisisWaiverPcts(tierList), minLevy)
  const steps: CrisisWaiverStep[] = []
  let previous = cleanBase
  const prefixPcts: number[] = []
  for (const tier of tierList) {
    prefixPcts.push(crisisWaiverPctOf(tier))
    const after = applyCrisisWaivers(cleanBase, prefixPcts, minLevy)
    steps.push({ tier, pct: crisisWaiverPctOf(tier), reduction: Math.max(0, previous - after) })
    previous = after
  }
  return { required, requiredBase: cleanBase, waiverPct: waiverPctOf(cleanBase, required), steps }
}

/**
 * 实际生效的折减百分比（DTO / 前端展示口径，四舍五入到整数）。
 *
 * 幂等且与调用顺序无关：`waiverPctOf(base, base) === 0`；把返回值再喂回自己
 * （`waiverPctOf(reduced, reduced)`）依旧是 0，所以推送路径重复调用不会把百分比越算越大。
 * 脏入参（NaN / 负 base）一律回 0，绝不让 NaN 进账单。
 */
export function waiverPctOf(base: number, required: number): number {
  const cleanBase = safeInt(base)
  if (cleanBase <= 0) return 0
  // required 是脏值（NaN / 无穷）时按「与 base 相同」处理：宁可少报一个折减，
  // 也不能因为读不到数字就在税单页上吹出「减免 100%」。
  if (!Number.isFinite(required)) return 0
  const cleanRequired = Math.min(cleanBase, Math.max(0, safeInt(required)))
  const pct = Math.round(((cleanBase - cleanRequired) / cleanBase) * 100)
  if (!Number.isFinite(pct) || pct <= 0) return 0
  return Math.min(100, pct)
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
  /** 公司减免**之前**的应缴额（对账与展示口径；legacy 行为 0，DTO 里按 required 兜底） */
  requiredBase: number
  /** 本轮已生效的公司减免合计百分比（0 = 无减免） */
  waiverPct: number
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
  requiredBase: 0,
  waiverPct: 0,
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
  /**
   * 本人捐给公司货栈、**还没卖出去**的存货（按参考价估值）。
   * 这一项存在的唯一理由是堵住一个避税口子：捐入公司的货会从 RaidInventoryItem /
   * FarmItem 里物理扣减，若不计税，「把资产搬进公司货栈」就等于把税基搬空。
   * 已售出的部分不再计入（钱已经变成积分 / 公司资金池，另一头自然计税）。
   */
  companyStock: number
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
  companyStock: 0,
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
  /** 本轮应缴（已经过公司减免） */
  required: number
  /** 公司减免之前的应缴额；没有减免时与 required 相同 */
  requiredBase: number
  /** 本轮实际生效的公司减免百分比（由 requiredBase 与 required 反推，四舍五入） */
  waiverPct: number
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
  /** 本人是否开启了积分税款开关（User.crisisTaxEnabled） */
  taxOptIn: boolean
  /** 本人累计缴税（PointsLedger 按 crisis_tax 汇总取绝对值）。字符串出口口径与 poolTotal 一致 */
  taxPaidTotal: string
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
  /** 本人税款开关（缺省 false） */
  taxOptIn?: boolean
  /** 本人累计缴税，字符串出口（缺省 '0'） */
  taxPaidTotal?: string
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
    companyStock: safeInt(input.parts.companyStock),
  }
  const hasLiveRaid = input.hasLiveRaid === true
  // 管理员豁免：不封锁、不计账单，但仍如实展示其资产（便于管理员核对征收口径）
  const status: CrisisStatus = exempt ? 'clear' : resolveCrisisStatus(levy, rules, nowMs, hasLiveRaid)
  // 公司减免的两个展示字段在出口处再算一次，而不是盲信库里的列：
  // - 老行（改造前开的轮）requiredBase = 0，此时 base 就是 required，百分比自然是 0；
  // - base 恒不小于 required（减免只会把账单变小），前端可以无条件按「base → required」画折减。
  const required = safeInt(levy.required)
  const requiredBase = Math.max(safeInt(levy.requiredBase), required)
  return {
    enabled: rules.enabled,
    exempt,
    status,
    blocked: status === 'blocked',
    hasLiveRaid,
    round: levy.round,
    snapshot: levy.snapshot,
    required,
    requiredBase,
    waiverPct: waiverPctOf(requiredBase, required),
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
    taxOptIn: input.taxOptIn === true,
    taxPaidTotal: input.taxPaidTotal ?? '0',
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
 *
 * 【为什么 `/api/company*` 不在这里 —— 别「顺手」把它加进来】
 * 有人会担心死锁：成员被封锁 → 不能买公司货栈 → 公司营业额不能抬档 → 减免拿不到 → 永远封锁。
 * 这个担心不成立，因为减免**不是由买方（欠费成员）触发的**：
 * 1. 抬档与减免由**成交那一侧**（卖家 / 任意正常用户的购买事务）在
 *    `companyService` 里调用 `crisisService.applyCompanyWaiversForCompany(companyId)` 主动**推送**，
 *    欠费成员什么端点都不用调；
 * 2. 推送之后立刻对该成员 `invalidateCrisisCache`，守卫在他**下一个请求**上就走
 *    `resolveSnapshot` 读到折减后的新账单（不失效也最多 CACHE_MS = 5 秒后自愈）；
 * 3. 就算一时没被推送，`/api/crisis/**` 本来就在名单里：被封锁的人随时能进危机页看账单，
 *    而公司档位在 `tierMask` 里只增不减，下一轮开轮时（`openLevy`）自然会把他已达成而未享用的
 *    档位折减掉——债务是「变慢」而不是「锁死」。
 * 反过来，一旦放行 `/api/company*` 就等于给封锁期间开了一个「买货 / 挂货 / 借贷」的口子
 * （公司货栈能买、贷款能借出流动积分），那才是真的把危机封锁打穿。
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
