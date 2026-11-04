/**
 * 公司（成员组织 + 货栈 + 资金池 + 放贷 + 危机减免）的纯函数口径。
 *
 * 禁止 import prisma / 网络：所有阈值、判定、取整与配置清洗都在这里定死，
 * services/companyService.ts 只做数据库编排，scripts/verify-company.ts 可以不开库直接验算。
 *
 * 四条容易做错的口径在这里说清楚：
 * 1. **档位只增不减**：tierMask 是 bit0/bit1/bit2 的掩码，由 revenue 单调推导，
 *    跨过 5 万时 bit0 必然已经置位（否则减免会被重复发放）；
 * 2. **等级 = 已达成档数**，直接作为 COMPANY_LOAN_CAPS / COMPANY_LOAN_RATE_PCT 的下标，
 *    等级 0（一分钱营业额都没有）的上限是 0 → 成立即不可借款，不需要额外分支；
 * 3. **利息在放款时一次算死**（dueAmount），此后利率表怎么改都不影响存量贷款；
 * 4. **种子捐入按 rare 档计上限**：种子价格区间跨两个数量级，按 common 放开会淹没货栈。
 */

import { RAID_ITEM_MAP, raidSellPrice, type RaidRarity } from './raidRun.js'
import { getCrop } from './farmCrops.js'

/* ============================================================
   成员与创建
   ============================================================ */

/** 创建即需 3 人：发起人 + 恰好 2 名受邀好友 */
export const COMPANY_MIN_MEMBERS = 3
/** 满编 7 人（含 CEO） */
export const COMPANY_MAX_MEMBERS = 7
/** 发起后 7 天内凑不满 3 人就自动作废（惰性结算，无定时器） */
export const COMPANY_FOUNDING_DAYS = 7
export const COMPANY_FOUNDING_MS = COMPANY_FOUNDING_DAYS * 24 * 60 * 60 * 1000

export const COMPANY_STATUS_FOUNDING = 'founding'
export const COMPANY_STATUS_ACTIVE = 'active'
export const COMPANY_STATUS_DISBANDED = 'disbanded'

/** 发起时刻 → 作废截止时刻 */
export function foundingExpiresAtOf(startedMs: number): number {
  return startedMs + COMPANY_FOUNDING_MS
}

/** founding 是否已经过期作废（到期时刻缺失按「未过期」处理，脏数据不吞掉公司） */
export function isFoundingExpired(foundingExpiresAtMs: number | null, nowMs: number): boolean {
  if (foundingExpiresAtMs === null || !Number.isFinite(foundingExpiresAtMs)) return false
  return nowMs >= foundingExpiresAtMs
}

/** 凑满最低成员数就该转 active */
export function shouldActivateCompany(memberCount: number): boolean {
  return memberCount >= COMPANY_MIN_MEMBERS
}

/** 距离作废还剩多少毫秒（已过期 / 无截止 → 0） */
export function foundingRemainingMs(foundingExpiresAtMs: number | null, nowMs: number): number {
  if (foundingExpiresAtMs === null || !Number.isFinite(foundingExpiresAtMs)) return 0
  return Math.max(0, foundingExpiresAtMs - nowMs)
}

/* ============================================================
   公司名（2–12 字，全站唯一，服务端权威校验）
   ============================================================ */

export const COMPANY_NAME_MIN = 2
export const COMPANY_NAME_MAX = 12

/**
 * 名称清洗：去首尾空白 + 把连续空白压成一个空格。
 * 全角空格也算空白，否则「有 限 公 司」这种名字能绕开唯一性（肉眼看着一样）。
 */
export function normalizeCompanyName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\s\u3000]+/g, ' ').trim()
}

export function validateCompanyName(name: string): string | null {
  const length = [...name].length
  if (length < COMPANY_NAME_MIN) return `公司名至少 ${COMPANY_NAME_MIN} 个字符`
  if (length > COMPANY_NAME_MAX) return `公司名最多 ${COMPANY_NAME_MAX} 个字符`
  // 只留空白 / 只留标点的名字没有识别价值，也会让唯一性校验形同虚设
  if (!/[\p{L}\p{N}]/u.test(name)) return '公司名需要包含字母或数字'
  return null
}

/** emoji 快照清洗：目录缺 emoji 时兜底成 📦，且限制长度（脏数据不能撑破卡片） */
export function sanitizeEmoji(raw: unknown): string {
  if (typeof raw !== 'string') return '📦'
  const chars = [...raw.trim()]
  if (chars.length === 0) return '📦'
  return chars.slice(0, 4).join('')
}

/** 物品名快照清洗（目录改名不影响已售出账目，但落库前要有个可读值） */
export function sanitizeItemName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback
  const name = raw.trim().slice(0, 40)
  return name.length > 0 ? name : fallback
}

/* ============================================================
   营业额 → 危机减免档位
   ============================================================ */

export interface CompanyRevenueTier {
  /** 1 | 2 | 3（与 CrisisWaiver.tier 同一口径） */
  tier: number
  /** 达成所需的累计营业额（积分） */
  threshold: number
  /** 减免百分比：全体成员当期危机应缴下调的幅度 */
  reductionPct: number
}

export const COMPANY_REVENUE_TIERS: readonly CompanyRevenueTier[] = [
  { tier: 1, threshold: 10_000, reductionPct: 10 },
  { tier: 2, threshold: 50_000, reductionPct: 25 },
  { tier: 3, threshold: 200_000, reductionPct: 50 },
]

export function companyTierOf(tier: number): CompanyRevenueTier | null {
  return COMPANY_REVENUE_TIERS.find((entry) => entry.tier === tier) ?? null
}

/** 档位 → 掩码位（tier 1 → bit0） */
export function tierBitOf(tier: number): number {
  if (!Number.isInteger(tier) || tier < 1 || tier > COMPANY_REVENUE_TIERS.length) return 0
  return 1 << (tier - 1)
}

/** tier 是否已置位（脏掩码里多余的位一律当未达成） */
export function isTierReached(mask: number, tier: number): boolean {
  const bit = tierBitOf(tier)
  return bit > 0 && (Math.trunc(mask) & bit) === bit
}

/**
 * 由累计营业额推导应有掩码。
 * 阈值单调递增 ⇒ 高位达成必然低位也达成，所以「跨过 5 万」时 bit0 一定已置位。
 */
export function companyTierMaskForRevenue(revenue: number): number {
  const value = Number.isFinite(revenue) ? Math.max(0, Math.trunc(revenue)) : 0
  let mask = 0
  for (const entry of COMPANY_REVENUE_TIERS) {
    if (value >= entry.threshold) mask |= tierBitOf(entry.tier)
  }
  return mask
}

/** 本次新越过的档位（旧掩码 → 新掩码只取差集，绝不重复发减免） */
export function crossedTiers(prevMask: number, nextMask: number): number[] {
  const added = Math.trunc(nextMask) & ~Math.trunc(prevMask)
  if (added <= 0) return []
  return COMPANY_REVENUE_TIERS.filter((entry) => (added & tierBitOf(entry.tier)) !== 0).map((entry) => entry.tier)
}

/** 公司等级 = 已达成档数（0–3），直接当贷款参数表的下标 */
export function companyLevelOf(tierMask: number): number {
  let level = 0
  for (const entry of COMPANY_REVENUE_TIERS) {
    if (isTierReached(tierMask, entry.tier)) level += 1
  }
  return level
}

export interface CompanyTierProgress {
  level: number
  /** 下一档（已满级为 null） */
  next: { tier: number; threshold: number; reductionPct: number; remaining: number } | null
  /** 当前档位给全体成员的减免百分比（等级 0 为 0） */
  reductionPct: number
}

/** 前端进度条的唯一口径：等级、距下一档还差多少、达成后解锁什么 */
export function companyTierProgress(revenue: number, tierMask: number): CompanyTierProgress {
  const value = Number.isFinite(revenue) ? Math.max(0, Math.trunc(revenue)) : 0
  const level = companyLevelOf(tierMask)
  const current = companyTierOf(level)
  const nextTier = COMPANY_REVENUE_TIERS.find((entry) => !isTierReached(tierMask, entry.tier) && value < entry.threshold)
  return {
    level,
    reductionPct: current?.reductionPct ?? 0,
    next: nextTier
      ? { tier: nextTier.tier, threshold: nextTier.threshold, reductionPct: nextTier.reductionPct, remaining: Math.max(0, nextTier.threshold - value) }
      : null,
  }
}

/* ============================================================
   贷款（公司资金池放贷）
   ============================================================ */

/** 按公司等级的累计借款上限（积分）；下标 0 = 等级 0 = 不能借 */
export const COMPANY_LOAN_CAPS: readonly number[] = [0, 500, 2000, 8000]
/** 按公司等级的整期利率（百分比）；等级越高越便宜，这是「把货栈做大」的实际回报 */
export const COMPANY_LOAN_RATE_PCT: readonly number[] = [0, 5, 4, 3]
/** 借款期限（天） */
export const COMPANY_LOAN_DUE_DAYS = 7
export const COMPANY_LOAN_DAY_MS = 24 * 60 * 60 * 1000

export const COMPANY_LOAN_STATUS_OPEN = 'open'
export const COMPANY_LOAN_STATUS_REPAID = 'repaid'
export const COMPANY_LOAN_STATUS_OVERDUE = 'overdue'

export function loanCapForLevel(level: number): number {
  const index = clampIndex(level, COMPANY_LOAN_CAPS.length)
  return Math.max(0, Math.trunc(COMPANY_LOAN_CAPS[index] ?? 0))
}

export function loanRateForLevel(level: number): number {
  const index = clampIndex(level, COMPANY_LOAN_RATE_PCT.length)
  return Math.max(0, Math.trunc(COMPANY_LOAN_RATE_PCT[index] ?? 0))
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(length - 1, Math.trunc(value)))
}

/**
 * 应还总额 = 本金 + floor(本金 × 利率 / 100)。
 * 用 floor 而不是 round：利息对用户略为有利，且放款那一刻就把整数钉死，
 * 之后不会因为「日息口径」产生第二个数字。
 */
export function computeLoanDue(principal: number, ratePct: number): number {
  const value = Number.isFinite(principal) ? Math.max(0, Math.trunc(principal)) : 0
  const rate = Number.isFinite(ratePct) ? Math.max(0, Math.trunc(ratePct)) : 0
  return value + Math.floor((value * rate) / 100)
}

export function loanDueAtOf(borrowedMs: number, dueDays: number): number {
  const days = Number.isFinite(dueDays) && dueDays > 0 ? Math.trunc(dueDays) : COMPANY_LOAN_DUE_DAYS
  return borrowedMs + days * COMPANY_LOAN_DAY_MS
}

/** 剩余应还（还款额永远不为负，脏 repaid 也夹得住） */
export function loanRemaining(dueAmount: number, repaid: number): number {
  const due = Number.isFinite(dueAmount) ? Math.max(0, Math.trunc(dueAmount)) : 0
  const paid = Number.isFinite(repaid) ? Math.max(0, Math.trunc(repaid)) : 0
  return Math.max(0, due - paid)
}

/** 一笔贷款是否还欠着钱（逾期也算未结清：挡退司、挡解散） */
export function isLoanUnsettled(status: string, repaid: number, dueAmount: number): boolean {
  if (status === COMPANY_LOAN_STATUS_REPAID) return false
  return loanRemaining(dueAmount, repaid) > 0
}

/** 借款额校验：正整数、不超过剩余额度（等级 0 时剩余为 0，直接拒） */
export function validateBorrowAmount(principal: unknown, cap: number, outstanding: number): string | null {
  const value = typeof principal === 'number' ? principal : Number(principal)
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return '借款积分必须是正整数'
  const remainingCap = Math.max(0, Math.trunc(cap) - Math.max(0, Math.trunc(outstanding)))
  if (remainingCap <= 0) return '当前公司等级还没有借款额度，先把货栈营业额做上去'
  if (value > remainingCap) return `本次最多还能借 ${remainingCap} 积分（等级 ${companyLevelOfMaskByCap(cap)} 上限 ${cap}，已借 ${Math.max(0, Math.trunc(outstanding))}）`
  return null
}

/** 报错文案用：由上限反查等级（上限表本身就是等级表，够用且不再引入第二份真相） */
function companyLevelOfMaskByCap(cap: number): number {
  const index = COMPANY_LOAN_CAPS.indexOf(Math.trunc(cap))
  return index < 0 ? 0 : index
}

/* ============================================================
   货栈：稀有度 / 单条捐入上限 / 每日补货上限 / 定价带宽
   ============================================================ */

export const COMPANY_LISTING_SOURCE_RAID = 'raid_item'
export const COMPANY_LISTING_SOURCE_SEED = 'farm_seed'
export const COMPANY_LISTING_SOURCES = [COMPANY_LISTING_SOURCE_RAID, COMPANY_LISTING_SOURCE_SEED] as const
export type CompanyListingSource = (typeof COMPANY_LISTING_SOURCES)[number]

/** 货栈稀有度直接用搜打撤的 6 档；种子归到 rare 档 */
export const COMPANY_RARITIES: readonly RaidRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']
export const COMPANY_SEED_RARITY_BUCKET: RaidRarity = 'rare'

export const COMPANY_RARITY_LABELS: Readonly<Record<RaidRarity, string>> = {
  common: '普通',
  uncommon: '优良',
  rare: '稀有',
  epic: '史诗',
  legendary: '传说',
  mythic: '神话',
}

/** 单条捐入的件数上限（按稀有度）：稀有度越高越少，防止一件神话把货栈挤满 */
export const COMPANY_DONATION_CAPS: Readonly<Record<RaidRarity, number>> = {
  common: 200,
  uncommon: 120,
  rare: 60,
  epic: 24,
  legendary: 8,
  mythic: 2,
}

/**
 * 每公司每日按稀有度的补货上限（Asia/Shanghai 日界，落 CompanyRestock）。
 * 恒有 restock <= donation：单日补货不可能超过单条上限，读起来才不会自相矛盾。
 */
export const COMPANY_RESTOCK_CAPS: Readonly<Record<RaidRarity, number>> = {
  common: 400,
  uncommon: 240,
  rare: 120,
  epic: 48,
  legendary: 16,
  mythic: 2,
}

export function isCompanyRarity(value: unknown): value is RaidRarity {
  return typeof value === 'string' && (COMPANY_RARITIES as readonly string[]).includes(value)
}

/** 捐入来源 → 计上限用的稀有度 */
export function donationRarityOf(source: CompanyListingSource, itemRarity: RaidRarity): RaidRarity {
  return source === COMPANY_LISTING_SOURCE_SEED ? COMPANY_SEED_RARITY_BUCKET : itemRarity
}

export function donationCapOf(rarity: RaidRarity): number {
  return Math.max(1, Math.trunc(COMPANY_DONATION_CAPS[rarity] ?? 1))
}

export function restockCapOf(rarity: RaidRarity): number {
  return Math.max(1, Math.trunc(COMPANY_RESTOCK_CAPS[rarity] ?? 1))
}

/**
 * 当日补货是否还放得下 n 件（CAS 递增前用的谓词）。
 * 单独抽出来是因为并发捐入必须走「先占位再校验」，读到的旧值不能直接相加。
 */
export function restockAllows(current: number, n: number, cap: number): boolean {
  const used = Math.max(0, Math.trunc(current))
  const want = Math.trunc(n)
  const limit = Math.max(1, Math.trunc(cap))
  if (want <= 0) return false
  return used + want <= limit
}

/** 捐入货栈的目录解析：一次拿到显示快照 + 参考价 + 稀有度 */
export interface CompanyCatalogEntry {
  itemKey: string
  itemName: string
  emoji: string
  rarity: RaidRarity
  /** 计上限用的稀有度（种子固定 rare） */
  capRarity: RaidRarity
  /** 参考价（raid_item 用官方回收单价、种子用目录种子价），<=0 表示不可捐 */
  referencePrice: number
}

export function resolveCatalog(source: CompanyListingSource, itemKey: string): CompanyCatalogEntry | null {
  if (source === COMPANY_LISTING_SOURCE_RAID) {
    const def = RAID_ITEM_MAP.get(itemKey)
    if (!def) return null
    // 参考价取「官方商店回收单价」：玩家自己能卖给系统的价格就是这件货的地板价
    const reference = raidSellPrice(itemKey, 1)
    return {
      itemKey: def.key,
      itemName: sanitizeItemName(def.name, def.key),
      emoji: sanitizeEmoji(def.emoji),
      rarity: def.rarity,
      capRarity: def.rarity,
      referencePrice: reference,
    }
  }
  if (source === COMPANY_LISTING_SOURCE_SEED) {
    const crop = getCrop(itemKey)
    if (!crop) return null
    return {
      itemKey: crop.key,
      itemName: `${crop.name}种子`,
      emoji: sanitizeEmoji(crop.emoji),
      rarity: COMPANY_SEED_RARITY_BUCKET,
      capRarity: COMPANY_SEED_RARITY_BUCKET,
      referencePrice: Math.max(0, Math.trunc(crop.seedCost)),
    }
  }
  return null
}

export function isCompanyListingSource(value: unknown): value is CompanyListingSource {
  return typeof value === 'string' && (COMPANY_LISTING_SOURCES as readonly string[]).includes(value)
}

/* ============================================================
   定价带宽（相对参考价的百分比，含端点）
   ============================================================ */

export interface PriceBand {
  min: number
  max: number
}

/**
 * 带宽计算：下界 floor、上界 ceil（含端点，边界值必须可捐）。
 * 参考价 <= 0（目录里回收价为 0 的垃圾件）时返回 null —— 没有锚就没法定价，
 * 允许捐入只会让「一件 1 积分」的货物淹没市场。
 */
export function priceBandOf(referencePrice: number, bandMinPct: number, bandMaxPct: number): PriceBand | null {
  const ref = Number.isFinite(referencePrice) ? Math.trunc(referencePrice) : 0
  if (ref <= 0) return null
  const minPct = Math.max(1, Math.trunc(bandMinPct))
  const maxPct = Math.max(minPct, Math.trunc(bandMaxPct))
  const min = Math.max(1, Math.floor((ref * minPct) / 100))
  const max = Math.max(min, Math.ceil((ref * maxPct) / 100))
  return { min, max }
}

export function isPriceInBand(unitPrice: number, band: PriceBand | null): boolean {
  if (!band) return false
  if (!Number.isFinite(unitPrice) || !Number.isInteger(unitPrice)) return false
  return unitPrice >= band.min && unitPrice <= band.max
}

/** 校验失败时给用户看的文案（唯一一份，避免前后端两套措辞） */
export function priceBandMessage(band: PriceBand | null): string {
  if (!band) return '这件物品没有参考价，无法捐入货栈'
  return `定价须在 ${band.min}–${band.max} 积分之间（参考价的带宽）`
}

/* ============================================================
   配置（单行 JSON：读旧 → 深合并 → normalize → 保存）
   ============================================================ */

export interface CompanyConfig {
  /** 定价带宽下界（参考价百分比） */
  priceBandMin: number
  /** 定价带宽上界 */
  priceBandMax: number
  /** 按公司等级的累计借款上限（长度固定 4，含等级 0） */
  loanTierCaps: readonly number[]
  /** 按公司等级的整期利率百分比（长度固定 4） */
  loanRatePct: readonly number[]
  /** 借款期限（天） */
  loanDueDays: number
  /** 单条捐入件数上限（按稀有度） */
  donationCaps: Record<RaidRarity, number>
  /** 每公司每日补货上限（按稀有度） */
  restockCaps: Record<RaidRarity, number>
}

export const COMPANY_DEFAULTS: CompanyConfig = {
  priceBandMin: 50,
  priceBandMax: 150,
  loanTierCaps: [...COMPANY_LOAN_CAPS],
  loanRatePct: [...COMPANY_LOAN_RATE_PCT],
  loanDueDays: COMPANY_LOAN_DUE_DAYS,
  donationCaps: { ...COMPANY_DONATION_CAPS },
  restockCaps: { ...COMPANY_RESTOCK_CAPS },
}

export const COMPANY_LIMITS = {
  bandMinFloor: 10,
  bandMinCeil: 100,
  bandMaxFloor: 100,
  bandMaxCeil: 1000,
  loanDaysMin: 1,
  loanDaysMax: 90,
  loanAmountMax: 10_000_000,
  donationMax: 1000,
  restockMax: 5000,
} as const

/**
 * 数值钳制。
 *
 * 关键：**用 undefined 判断是否缺省，而不是 `value || 默认值`**。
 * 借款上限的等级 0 就是 0，`input.loanDueDays || 7` 这类写法会把管理员
 * 故意设成 0 的值当成缺省吞掉（savePointsConfig 当年就踩过这个坑）。
 */
function pickNumber(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null) return fallback
  const num = typeof value === 'number' ? value : Number(value)
  // 脏值（NaN / Infinity / 字符串）回退默认值，而不是悄悄夹到边界
  return Number.isFinite(num) ? num : fallback
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const picked = pickNumber(value, fallback)
  if (picked === null) return fallback
  return Math.min(max, Math.max(min, picked))
}

/** 稀有度字典清洗：缺项回退默认值，非法键忽略，脏值回退 */
function clampRarityMap(
  raw: unknown,
  defaults: Readonly<Record<RaidRarity, number>>,
  max: number,
): Record<RaidRarity, number> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out = { ...defaults } as Record<RaidRarity, number>
  for (const rarity of COMPANY_RARITIES) {
    if (input[rarity] === undefined) continue
    out[rarity] = Math.floor(clamp(input[rarity], 1, max, defaults[rarity]))
  }
  return out
}

/** 等级数组清洗：长度钉死（下标语义即等级，管理员不能增删档位），0 值必须保留 */
function clampLevelArray(raw: unknown, defaults: readonly number[], max: number): number[] {
  if (raw === undefined || raw === null) return [...defaults]
  if (!Array.isArray(raw)) return [...defaults]
  return defaults.map((fallback, index) => {
    if (raw[index] === undefined) return fallback
    // 上限可以是 0（等级 0 不许借），利率也可以是 0（免息）——所以这里下界就是 0
    return Math.floor(clamp(raw[index], 0, max, fallback))
  })
}

/** 深合并 + 钳制 + 归一化：normalize 的输出恒为合法配置 */
export function normalizeCompanyConfig(raw: unknown): CompanyConfig {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const priceBandMin = Math.floor(clamp(input.priceBandMin, COMPANY_LIMITS.bandMinFloor, COMPANY_LIMITS.bandMinCeil, COMPANY_DEFAULTS.priceBandMin))
  const priceBandMax = Math.floor(clamp(input.priceBandMax, COMPANY_LIMITS.bandMaxFloor, COMPANY_LIMITS.bandMaxCeil, COMPANY_DEFAULTS.priceBandMax))
  return {
    priceBandMin,
    // 上界必须 >= 下界，否则 priceBandOf 会算出空带宽、全站捐入被静默拒绝
    priceBandMax: Math.max(priceBandMin, priceBandMax),
    loanTierCaps: clampLevelArray(input.loanTierCaps, COMPANY_DEFAULTS.loanTierCaps, COMPANY_LIMITS.loanAmountMax),
    loanRatePct: clampLevelArray(input.loanRatePct, COMPANY_DEFAULTS.loanRatePct, 50),
    loanDueDays: Math.floor(clamp(input.loanDueDays, COMPANY_LIMITS.loanDaysMin, COMPANY_LIMITS.loanDaysMax, COMPANY_DEFAULTS.loanDueDays)),
    donationCaps: clampRarityMap(input.donationCaps, COMPANY_DONATION_CAPS, COMPANY_LIMITS.donationMax),
    restockCaps: clampRarityMap(input.restockCaps, COMPANY_RESTOCK_CAPS, COMPANY_LIMITS.restockMax),
  }
}

/** 配置里读出的等级数组按 normalize 口径取用（服务层不再各自夹一遍） */
export function loanCapFromConfig(cfg: CompanyConfig, level: number): number {
  const index = clampIndex(level, cfg.loanTierCaps.length)
  return Math.max(0, Math.trunc(cfg.loanTierCaps[index] ?? 0))
}

export function loanRateFromConfig(cfg: CompanyConfig, level: number): number {
  const index = clampIndex(level, cfg.loanRatePct.length)
  return Math.max(0, Math.trunc(cfg.loanRatePct[index] ?? 0))
}

/* ============================================================
   分页与市场排序
   ============================================================ */

export const COMPANY_PAGE_SIZE_DEFAULT = 20
export const COMPANY_PAGE_SIZE_MAX = 60
export const COMPANY_MARKET_SORTS = ['newest', 'price_asc', 'price_desc', 'rarity'] as const
export type CompanyMarketSort = (typeof COMPANY_MARKET_SORTS)[number]

export function normalizePageQuery(raw: unknown, takeRaw: unknown): { page: number; pageSize: number } {
  const page = Math.max(1, Math.floor(clamp(raw, 1, 100_000, 1)))
  const pageSize = Math.floor(clamp(takeRaw, 1, COMPANY_PAGE_SIZE_MAX, COMPANY_PAGE_SIZE_DEFAULT))
  return { page, pageSize }
}

export function isMarketSort(value: unknown): value is CompanyMarketSort {
  return typeof value === 'string' && (COMPANY_MARKET_SORTS as readonly string[]).includes(value)
}

/** 稀有度排序权重（未知值排最后，不让脏数据插到队首） */
export function rarityWeight(rarity: string): number {
  const index = COMPANY_RARITIES.indexOf(rarity as RaidRarity)
  return index < 0 ? COMPANY_RARITIES.length : index
}

/* ============================================================
   DTO 出口（纯函数，自检脚本可以直接断言字段契约）
   ============================================================ */

export interface CompanyLoanDto {
  id: number
  companyId: number
  companyName: string
  principal: number
  dueAmount: number
  repaid: number
  remaining: number
  ratePct: number
  dueDays: number
  status: string
  borrowedAt: string
  dueAt: string
  /** 距到期还剩多少毫秒（已逾期为 0） */
  msUntilDue: number
  overdueMs: number
}

export function buildLoanDto(input: {
  id: number
  companyId: number
  companyName: string
  principal: number
  dueAmount: number
  repaid: number
  ratePct: number
  dueDays: number
  status: string
  borrowedAtMs: number
  dueAtMs: number
  nowMs: number
}): CompanyLoanDto {
  const remaining = loanRemaining(input.dueAmount, input.repaid)
  const left = Math.max(0, input.dueAtMs - input.nowMs)
  return {
    id: input.id,
    companyId: input.companyId,
    companyName: input.companyName,
    principal: input.principal,
    dueAmount: input.dueAmount,
    repaid: Math.max(0, Math.trunc(input.repaid)),
    remaining,
    ratePct: input.ratePct,
    dueDays: input.dueDays,
    // DTO 出口兜底一次：逾期行还没被惰性翻过时也按 overdue 展示
    status: input.status === COMPANY_LOAN_STATUS_OPEN && input.dueAtMs <= input.nowMs && remaining > 0
      ? COMPANY_LOAN_STATUS_OVERDUE
      : input.status,
    borrowedAt: new Date(input.borrowedAtMs).toISOString(),
    dueAt: new Date(input.dueAtMs).toISOString(),
    msUntilDue: remaining > 0 ? left : 0,
    overdueMs: remaining > 0 ? Math.max(0, input.nowMs - input.dueAtMs) : 0,
  }
}
