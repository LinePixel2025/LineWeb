/**
 * Lineweb 危机服务：总资产评估 → 公司业绩折减 → 惰性开轮 → 缴进公共银行 → 管理员强制到期。
 *
 * 判定与算式一律在 lib/crisisRules.ts（纯函数、可自检），本文件只做数据库编排。
 * 全链路无定时器：到期开轮、宽限翻转都由读请求惰性触发（与银行结息 / 宠物衰减 / 红包过期同一口径），
 * 服务端重启不会漏账，也不会因为多实例跑两个定时器而重复扣款。
 *
 * 公司减免（`crisis_waivers`）有两条生效路径，都不需要欠费成员自己调端点：
 * 1. 开轮时（`openLevy` / `forceDueForUser`）按成员所属公司的 `tierMask` 折减本轮应缴；
 * 2. 成交抬档后由 `companyService` 反向推送（`applyCompanyWaiversForCompany`），
 *    把已经到期 / 被封锁的成员账单就地下调，并立即作废他们的 5 秒税单缓存。
 */
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { RAID_GEAR_MAP, raidSellPrice } from '../lib/raidRun.js'
import { raidRecycleValue } from '../lib/raidStorage.js'
import { getCrop } from '../lib/farmCrops.js'
import { PET_OUTFIT_MAP } from '../lib/petCatalog.js'
import { PET_EQUIPMENT_MAP } from '../lib/petEquipment.js'
import { PET_SKILL_MAP } from '../lib/petSkills.js'
import { getLiveQuoteByCode } from '../lib/stockTicks.js'
import { fundNavOn } from '../lib/bankRules.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'
import {
  CRISIS_DEFAULTS,
  CRISIS_LEDGER_REASON,
  CRISIS_TAX_LEDGER_REASON,
  EMPTY_CRISIS_ASSETS,
  EMPTY_CRISIS_LEVY_VIEW,
  applyCrisisWaiversByTier,
  buildCrisisStateDto,
  computeRequired,
  crisisTiersFromMask,
  graceUntilOf,
  isLevyDue,
  nextDueAtOf,
  normalizeCrisisRules,
  remainingOf,
  resolveCrisisStatus,
  sumCrisisAssets,
  waiverPctOf,
  type CrisisAssetParts,
  type CrisisLevyView,
  type CrisisRules,
  type CrisisStateDto,
  type CrisisWaiverStep,
} from '../lib/crisisRules.js'
import type { Prisma } from '@prisma/client'

/** 税单快照缓存：守卫在每个请求上都要问一次，不能每请求查库（与 featureService 同一口径） */
const CACHE_MS = 5000

let rulesCache: { rules: CrisisRules; at: number } | null = null
const levyCache = new Map<number, { snapshot: LevySnapshot; at: number }>()

export interface LevySnapshot {
  levy: CrisisLevyView
  hasLiveRaid: boolean
}
/* ============================================================
   参数（单行 JSON，深合并 + 钳制）
   ============================================================ */

export async function getCrisisRules(force = false): Promise<CrisisRules> {
  if (!force && rulesCache && Date.now() - rulesCache.at < CACHE_MS) return rulesCache.rules
  let rules: CrisisRules = { ...CRISIS_DEFAULTS }
  try {
    const row = await prisma.crisisConfig.findUnique({ where: { id: 1 } })
    if (row?.config) {
      rules = normalizeCrisisRules(JSON.parse(row.config))
    }
  } catch (err) {
    console.warn('[crisis] 读取危机参数失败，按默认值处理：', err instanceof Error ? err.message : err)
  }
  rulesCache = { rules, at: Date.now() }
  return rules
}

export async function saveCrisisRules(raw: unknown, updatedBy: number): Promise<CrisisRules> {
  // 与 savePointsConfig 同口径：读旧 → 深合并 → normalize → 保存，管理员只覆盖想改的项
  const existing = await prisma.crisisConfig.findUnique({ where: { id: 1 } })
  let merged: Record<string, unknown> = {}
  if (existing?.config) {
    try {
      const parsed: unknown = JSON.parse(existing.config)
      if (parsed && typeof parsed === 'object') merged = { ...(parsed as Record<string, unknown>) }
    } catch {
      merged = {}
    }
  }
  if (raw && typeof raw === 'object') merged = { ...merged, ...(raw as Record<string, unknown>) }
  const rules = normalizeCrisisRules(merged)
  const payload = JSON.stringify(rules)
  await prisma.crisisConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: payload, updatedBy },
    update: { config: payload, updatedBy },
  })
  rulesCache = { rules, at: Date.now() }
  levyCache.clear()
  return rules
}

/* ============================================================
   公共银行（只进不出）
   ============================================================ */

async function ensurePoolRow(tx?: Prisma.TransactionClient): Promise<void> {
  const client = tx ?? prisma
  await client.crisisPool.upsert({
    where: { id: 1 },
    create: { id: 1, total: BigInt(0) },
    update: {},
  })
}

/** 公共银行累计总额。BigInt 不能进 JSON，调用方出去前必须转字符串 */
export async function getPoolTotal(): Promise<bigint> {
  await ensurePoolRow()
  const row = await prisma.crisisPool.findUnique({ where: { id: 1 }, select: { total: true } })
  return row?.total ?? BigInt(0)
}

/* ============================================================
   总资产
   ============================================================ */

function catalogPrice(map: ReadonlyMap<string, { price: number }>, key: string): number {
  return map.get(key)?.price ?? 0
}

/** 同种物品合并后再算回收价：回收单价含向下取整，逐格累加与整组累加会有差额 */
function recycleByItemKey(rows: { itemKey: string; amount: number }[]): number {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (!Number.isFinite(row.amount) || row.amount <= 0) continue
    totals.set(row.itemKey, (totals.get(row.itemKey) ?? 0) + row.amount)
  }
  let sum = 0
  for (const [itemKey, amount] of totals) sum += raidRecycleValue(itemKey, amount)
  return sum
}

/**
 * 公司货栈里「本人捐入且未售出」那部分存货的计税价值。
 *
 * 单价口径按「参考价优先」：
 * - `raid_item` → `raidSellPrice(key, 1)`（官方回收价：材料/珍宝 100%、消耗品 60%、箱子 70%，
 *   与仓库 / 背包两项同源，同一件货在哪个容器里都按同一个价计税）；
 * - `farm_seed` → 作物目录的种子价 `seedCost`（农场唯一的积分子口径，与买价一致）；
 * - 目录里已经查不到（下架 / 改名 / key 脏）时退回捐入时的 `unitPrice` 快照——
 *   参考价缺失**不能**变成避税理由，宁可按公司自己的定价计税。
 * 在架量 = amount - soldAmount，脏值（已售多于总量）一律夹到 0。
 */
function companyStockValue(row: {
  source: string
  itemKey: string
  amount: number
  soldAmount: number
  unitPrice: number
}): number {
  const unsold = Math.floor(row.amount) - Math.floor(row.soldAmount)
  if (!Number.isFinite(unsold) || unsold <= 0) return 0
  const reference =
    row.source === 'farm_seed' ? (getCrop(row.itemKey)?.seedCost ?? 0) : raidSellPrice(row.itemKey, 1)
  const unit = reference > 0 ? reference : Math.max(0, Math.floor(row.unitPrice))
  return unit * unsold
}

/**
 * 评估总资产（十三项分项，前端按分项展示）。
 *
 * 三个容易漏的口径：
 * 1. **未成交的限价委托必须计入**：买入挂单冻结了积分、卖出挂单把份额从持仓里扣走了，
 *    不算这一项等于「把钱停在委托单里就能避税」；
 * 2. 存款 / 基金 / 股票投入时积分已经扣过，所以各项直接相加不是重复计算；
 * 3. **本人捐进公司货栈、还没卖掉的存货必须计入**（`companyStock`）：
 *    捐入是从 RaidInventoryItem / FarmItem 里**物理扣减**的，若这一项不计税，
 *    「把资产搬进公司货栈」就等于把税基整个搬空（货栈还是自己的公司，随时能撤单退回来），
 *    危机税当场形同虚设。已售出的部分不计（钱变成了积分或公司资金池，那边自然计税）。
 *
 * 不计：网盘文件与配额（那是配额不是资产）、已挂单宠物的二次价值（挂单是要价不是财富）。
 */
export async function getCrisisAssetParts(userId: number, nowMs = Date.now()): Promise<CrisisAssetParts> {
  const todayKey = getTodayDateKey(nowMs)
  const [
    user,
    gears,
    warehouse,
    bags,
    pet,
    holdings,
    orders,
    bankAccount,
    deposits,
    funds,
    companyStock,
  ] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { points: true } }),
    prisma.raidGear.findMany({ where: { userId }, select: { gearKey: true } }),
    prisma.raidInventoryItem.findMany({ where: { userId }, select: { itemKey: true, amount: true } }),
    prisma.raidBagItem.findMany({ where: { userId }, select: { itemKey: true, amount: true } }),
    prisma.pet.findUnique({
      where: { userId },
      select: {
        outfits: { select: { outfitKey: true } },
        equipments: { select: { itemKey: true } },
        skills: { select: { skillKey: true } },
      },
    }),
    prisma.stockHolding.findMany({ where: { userId }, select: { code: true, shares: true } }),
    prisma.stockOrder.findMany({
      where: { userId, status: 'open' },
      select: { code: true, side: true, amount: true, shares: true },
    }),
    prisma.bankAccount.findUnique({ where: { userId }, select: { demandBalance: true } }),
    prisma.bankDeposit.aggregate({ where: { userId, status: 'active' }, _sum: { principal: true } }),
    prisma.fundHolding.findMany({ where: { userId }, select: { fundCode: true, shares: true } }),
    // 只扫「本人捐入且仍在架」的条目：[donorId, status] 索引就是为这条查询建的
    prisma.companyListing.findMany({
      where: { donorId: userId, status: 'active' },
      select: { source: true, itemKey: true, amount: true, soldAmount: true, unitPrice: true },
    }),
  ])

  const parts: CrisisAssetParts = {
    ...EMPTY_CRISIS_ASSETS,
    points: user?.points ?? 0,
    raidGear: gears.reduce((sum, gear) => sum + catalogPrice(RAID_GEAR_MAP, gear.gearKey), 0),
    raidWarehouse: recycleByItemKey(warehouse),
    raidBags: recycleByItemKey(bags),
    petOutfits: (pet?.outfits ?? []).reduce((sum, row) => sum + catalogPrice(PET_OUTFIT_MAP, row.outfitKey), 0),
    petEquipment: (pet?.equipments ?? []).reduce((sum, row) => sum + catalogPrice(PET_EQUIPMENT_MAP, row.itemKey), 0),
    petSkills: (pet?.skills ?? []).reduce((sum, row) => sum + catalogPrice(PET_SKILL_MAP, row.skillKey), 0),
    bankDemand: bankAccount?.demandBalance ?? 0,
    bankDeposits: deposits._sum.principal ?? 0,
    companyStock: companyStock.reduce((sum, row) => sum + companyStockValue(row), 0),
  }

  parts.stocks = holdings.reduce((sum, row) => {
    const price = getLiveQuoteByCode(row.code, nowMs)?.price ?? 0
    return sum + price * row.shares
  }, 0)

  // 冻结在委托里的资产：买入单按冻结积分，卖出单按冻结份额的实时市值
  parts.stockOrders = orders.reduce((sum, row) => {
    if (row.side === 'sell') {
      const price = getLiveQuoteByCode(row.code, nowMs)?.price ?? 0
      return sum + price * row.shares
    }
    return sum + row.amount
  }, 0)

  parts.funds = funds.reduce((sum, row) => sum + fundNavOn(row.fundCode, todayKey) * row.shares, 0)

  return parts
}

/* ============================================================
   税单读写
   ============================================================ */

function toView(row: {
  status: string
  round: number
  snapshot: number
  required: number
  requiredBase?: number
  waiverPct?: number
  paid: number
  openAt: Date | null
  graceUntil: Date | null
  settledAt: Date | null
  nextDueAt: Date | null
} | null): CrisisLevyView {
  if (!row) return { ...EMPTY_CRISIS_LEVY_VIEW }
  return {
    status: row.status,
    round: row.round,
    snapshot: row.snapshot,
    required: row.required,
    // 改造之前开的轮没有这两列的数据（默认 0）：视图里回退成「应缴即减免前」，
    // 于是 DTO 的 waiverPct 自然是 0，前端不会给一张没有减免的旧账单画折减条。
    requiredBase: row.requiredBase ?? row.required,
    waiverPct: row.waiverPct ?? 0,
    paid: row.paid,
    openAt: row.openAt ? row.openAt.getTime() : null,
    graceUntil: row.graceUntil ? row.graceUntil.getTime() : null,
    settledAt: row.settledAt ? row.settledAt.getTime() : null,
    nextDueAt: row.nextDueAt ? row.nextDueAt.getTime() : null,
  }
}

const LEVY_VIEW_SELECT = {
  status: true,
  round: true,
  snapshot: true,
  required: true,
  requiredBase: true,
  waiverPct: true,
  paid: true,
  openAt: true,
  graceUntil: true,
  settledAt: true,
  nextDueAt: true,
} as const

/** 有没有进行中的搜打撤对局：决定「打完这局再封」 */
export async function hasLiveRaidRun(userId: number, nowMs = Date.now()): Promise<boolean> {
  const row = await prisma.petRaid.findUnique({
    where: { userId },
    select: { status: true, expiresAt: true },
  })
  if (!row || row.status !== 'active') return false
  return row.expiresAt.getTime() > nowMs
}

/** 首访建行：新用户拿到一整段 interval 的起步期，不会被立刻征税 */
async function ensureLevyRow(userId: number, rules: CrisisRules, nowMs: number): Promise<CrisisLevyView> {
  const existing = await prisma.crisisLevy.findUnique({ where: { userId }, select: LEVY_VIEW_SELECT })
  if (existing) return toView(existing)
  const created = await prisma.crisisLevy.upsert({
    where: { userId },
    create: {
      userId,
      status: 'clear',
      nextDueAt: new Date(nextDueAtOf(nowMs, rules)),
    },
    update: {},
    select: LEVY_VIEW_SELECT,
  })
  return toView(created)
}

/* ============================================================
   公司业绩减免（用公司的营业额换本人的免税额）
   ============================================================ */

/** Prisma 唯一约束冲突（P2002）：并发重复享用同一档时由数据库兜底（与 redPacketService 同口径） */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2002'
}

/** 本人已经享用过的档位（crisis_waivers 是唯一真相源：每人每档终身一次，跳槽换公司也不能重复领） */
async function consumedWaiverTiers(userId: number): Promise<Set<number>> {
  const rows = await prisma.crisisWaiver.findMany({ where: { userId }, select: { tier: true } })
  return new Set(rows.map((row) => row.tier))
}

/**
 * 这个成员「公司已达成、本人还没享用」的档位（升序）+ 所属公司 id；没有则 null。
 * 不按公司状态过滤：tierMask 只增不减，公司事后解散也不该把成员已经挣到的折减收回去；
 * 档位本来就是一次性的，不存在「靠一个已解散公司反复领减免」的口子。
 */
async function pendingCompanyWaivers(userId: number): Promise<{ companyId: number; tiers: number[] } | null> {
  const membership = await prisma.companyMember.findFirst({
    where: { userId },
    select: { companyId: true, company: { select: { tierMask: true } } },
  })
  if (!membership) return null
  const crossed = crisisTiersFromMask(membership.company?.tierMask ?? 0)
  if (crossed.length === 0) return null
  const consumed = await consumedWaiverTiers(userId)
  const tiers = crossed.filter((tier) => !consumed.has(tier))
  return tiers.length > 0 ? { companyId: membership.companyId, tiers } : null
}

/**
 * 把「这一档我已经用掉了」落库。**必须在税单 CAS 抢到之后**才调，
 * 否则并发双开轮时输家也会消费掉档位，等于白白作废一次免税。
 * 唯一键 [userId, tier] 是幂等锚：撞 P2002 说明这一档早就享用过，静默跳过，绝不让开轮因此失败。
 * reduction 为 0 的档位不写行 —— 这一轮本来就没减出分，把档位留给以后真正有分量的账单。
 */
async function recordWaivers(
  userId: number,
  companyId: number,
  steps: CrisisWaiverStep[],
  levyRound: number,
): Promise<void> {
  for (const step of steps) {
    if (step.reduction <= 0) continue
    try {
      await prisma.crisisWaiver.create({
        data: { userId, companyId, tier: step.tier, reduction: step.reduction, levyRound },
      })
    } catch (err) {
      if (isUniqueViolation(err)) continue
      console.warn(
        `[crisis] 记录公司减免失败 userId=${userId} tier=${step.tier}：`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}

/** 开轮时套用公司减免的结果（companyId 为 null 表示本轮没有任何折减，走原路径） */
interface WaiverPlan {
  required: number
  requiredBase: number
  waiverPct: number
  steps: CrisisWaiverStep[]
  companyId: number | null
}

/**
 * 按成员所属公司把「减免前」的应缴额折一次。
 * 减免是额外好处，所以任何异常 / 脏档位都只回退成「不减免」，
 * 绝不把账单算大，也绝不因为算不出减免而让开轮失败。
 */
async function planCompanyWaiver(userId: number, baseRequired: number, rules: CrisisRules): Promise<WaiverPlan> {
  const untouched: WaiverPlan = {
    required: baseRequired,
    requiredBase: baseRequired,
    waiverPct: 0,
    steps: [],
    companyId: null,
  }
  if (baseRequired <= 0) return untouched
  const pending = await pendingCompanyWaivers(userId)
  if (!pending) return untouched
  const result = applyCrisisWaiversByTier(baseRequired, pending.tiers, rules.minLevy)
  if (result.required >= baseRequired) return untouched
  return {
    required: result.required,
    requiredBase: baseRequired,
    waiverPct: result.waiverPct,
    steps: result.steps,
    companyId: pending.companyId,
  }
}

/**
 * 惰性开轮：按读到的 round 做 CAS，抢不到说明别人（管理员强制到期 / 并发请求）已经改过税单，
 * 直接放弃本次开轮，下一次读会看到新状态。
 */
async function openLevy(
  userId: number,
  levy: CrisisLevyView,
  rules: CrisisRules,
  nowMs: number,
): Promise<CrisisLevyView> {
  const parts = await getCrisisAssetParts(userId, nowMs)
  const snapshot = sumCrisisAssets(parts)
  const baseRequired = computeRequired(snapshot, rules)
  const graceUntil = new Date(graceUntilOf(nowMs, rules))
  // 本轮的轮次号：updateMany 用 increment，落库减免行要的是「加一之后」的那个值
  const newRound = levy.round + 1

  // 应缴为 0 等于没有税：直接顺延下一轮，不留下一个「欠费 0 分」的假账单
  if (baseRequired <= 0) {
    await prisma.crisisLevy.updateMany({
      where: { userId, round: levy.round, status: 'clear' },
      data: {
        status: 'clear',
        round: { increment: 1 },
        snapshot,
        required: 0,
        requiredBase: 0,
        waiverPct: 0,
        paid: 0,
        openAt: null,
        graceUntil: null,
        settledAt: new Date(nowMs),
        nextDueAt: new Date(nextDueAtOf(nowMs, rules)),
      },
    })
    return readLevy(userId)
  }

  // 公司业绩折减：只在这一刻查公司（有公司的用户才有第二次查询，多数人一步就返回 null）
  const waiver = await planCompanyWaiver(userId, baseRequired, rules)

  const updated = await prisma.crisisLevy.updateMany({
    where: { userId, round: levy.round, status: 'clear' },
    data: {
      status: 'due',
      round: { increment: 1 },
      snapshot,
      required: waiver.required,
      requiredBase: waiver.requiredBase,
      waiverPct: waiver.waiverPct,
      paid: 0,
      openAt: new Date(nowMs),
      graceUntil,
      settledAt: null,
      nextDueAt: null,
    },
  })
  if (updated.count === 0) return readLevy(userId)
  if (waiver.companyId !== null) await recordWaivers(userId, waiver.companyId, waiver.steps, newRound)
  return readLevy(userId)
}

/**
 * 【推送路径 · 跨模块硬契约】公司累计营业额跨过新档位后，把减免压到成员**当前这张**待缴账单上。
 *
 * `companyService` 在「成交事务抬档」之后调用它（签名固定，不要改）：
 * `await applyCompanyWaiversForCompany(companyId)`。
 *
 * 为什么必须存在这条路径：应缴额在开轮瞬间冻结（口径 1），所以「公司后来挣到的折减」不会
 * 自动落到已经到期 / 已经封锁的成员头上。这条路径让他们**什么都不用点**就能恢复 ——
 * 减免由成交那一侧推送，欠费成员的下一个请求经 `resolveSnapshot` 读到的就是新账单
 * （`/api/crisis/**` 与 `/api/company*` 谁都不需要为封锁让路，见 CRISIS_EXEMPT_RULES 的说明）。
 *
 * 三条硬约束：
 * 1. **永不抛出**：逐成员 try/catch，一个人失败不影响其余人（这是成交事务的尾巴，不能反噬下单请求）；
 * 2. **CAS 降级**：`where` 带上读到的 round + status='due' + required 原值，抢不到就说明账单
 *    在我们读改写之间变了（成员正在缴 / 管理员强制到期），静默跳过即可 —— 那一侧写的是新数字，
 *    下一轮开轮（`openLevy`）会按未消费的档位重新折减；
 * 3. **立即作废 5 秒税单缓存**：否则守卫还会按旧应缴把人挡最多 CACHE_MS，
 *    而弹窗写着「缴清即刻恢复」，不能让人对着一条已经不该存在的封锁等 5 秒。
 *
 * 已缴部分（paid）不退：折减只把「还欠多少」变小，缴进公共银行的分照旧只进不出。
 */
export async function applyCompanyWaiversForCompany(companyId: number, nowMs?: number): Promise<void> {
  const at = nowMs ?? Date.now()
  try {
    const rules = await getCrisisRules()
    if (!rules.enabled) return
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { tierMask: true } })
    const crossed = crisisTiersFromMask(company?.tierMask ?? 0)
    if (crossed.length === 0) return
    const members = await prisma.companyMember.findMany({ where: { companyId }, select: { userId: true } })
    let applied = 0
    for (const member of members) {
      try {
        if (await pushWaiverToMember(member.userId, companyId, crossed, rules)) applied += 1
      } catch (err) {
        console.warn(
          `[crisis] 推送公司减免失败 userId=${member.userId} companyId=${companyId}：`,
          err instanceof Error ? err.message : err,
        )
      }
    }
    if (applied > 0) {
      console.log(
        `[crisis] 公司 ${companyId} 档位 ${crossed.join('/')} 减免已推送到 ${applied}/${members.length} 名成员的待缴账单（${new Date(at).toISOString()}）`,
      )
    }
  } catch (err) {
    console.warn(`[crisis] 推送公司减免异常 companyId=${companyId}：`, err instanceof Error ? err.message : err)
  }
}

/** 给单个成员当前那张待缴账单打折；返回是否真的改了行 */
async function pushWaiverToMember(
  userId: number,
  companyId: number,
  crossedTiers: readonly number[],
  rules: CrisisRules,
): Promise<boolean> {
  const row = await prisma.crisisLevy.findUnique({ where: { userId }, select: LEVY_VIEW_SELECT })
  if (!row) return false
  const levy = toView(row)
  if (levy.status !== 'due') return false
  if (remainingOf(levy) <= 0) return false
  const consumed = await consumedWaiverTiers(userId)
  const pending = crossedTiers.filter((tier) => !consumed.has(tier))
  if (pending.length === 0) return false
  // 折减基准优先用「本轮减免前」的 requiredBase：这样多轮推送与一次性开轮的结果逐字相同
  // （档位本来就是乘在减免前基数上的），且 requiredBase / waiverPct 始终是「本轮总账」。
  // legacy 行 requiredBase 为 0（toView 已回退成 required），所以这里取 max 只是脏数据保险。
  const base = Math.max(levy.requiredBase, levy.required)
  const result = applyCrisisWaiversByTier(base, pending, rules.minLevy)
  if (result.required >= base) return false
  const updated = await prisma.crisisLevy.updateMany({
    where: { userId, round: levy.round, status: 'due', required: levy.required },
    data: { required: result.required, requiredBase: result.requiredBase, waiverPct: result.waiverPct },
  })
  if (updated.count === 0) return false
  await recordWaivers(userId, companyId, result.steps, levy.round)
  invalidateCrisisCache(userId)
  return true
}


async function readLevy(userId: number): Promise<CrisisLevyView> {
  const row = await prisma.crisisLevy.findUnique({ where: { userId }, select: LEVY_VIEW_SELECT })
  return toView(row)
}

/**
 * 读税单并就地推进状态机（开轮）。返回评估好的快照，供守卫与 DTO 共用。
 * 危机关闭时一律回 clear 视图，保证「一键解除封锁」立即生效（缓存同时作废）。
 */
async function resolveSnapshot(userId: number, nowMs: number, bypassCache = false): Promise<LevySnapshot> {
  const cached = levyCache.get(userId)
  if (!bypassCache && cached && nowMs - cached.at < CACHE_MS) return cached.snapshot
  const rules = await getCrisisRules()
  if (!rules.enabled) {
    const snapshot: LevySnapshot = { levy: { ...EMPTY_CRISIS_LEVY_VIEW }, hasLiveRaid: false }
    levyCache.set(userId, { snapshot, at: nowMs })
    return snapshot
  }
  let levy = await ensureLevyRow(userId, rules, nowMs)
  if (isLevyDue(levy, rules, nowMs)) {
    levy = await openLevy(userId, levy, rules, nowMs)
  }
  const hasLive = resolveCrisisStatus(levy, rules, nowMs) === 'blocked' ? await hasLiveRaidRun(userId, nowMs) : false
  const snapshot: LevySnapshot = { levy, hasLiveRaid: hasLive }
  levyCache.set(userId, { snapshot, at: nowMs })
  return snapshot
}

export function invalidateCrisisCache(userId?: number): void {
  if (userId === undefined) {
    levyCache.clear()
    rulesCache = null
    return
  }
  levyCache.delete(userId)
}

/* ============================================================
   对外读接口
   ============================================================ */

export async function getCrisisState(
  userId: number,
  nowMs = Date.now(),
  opts: { exempt?: boolean } = {},
): Promise<CrisisStateDto> {
  const rules = await getCrisisRules()
  const exempt = opts.exempt === true
  // 管理员豁免：连开轮都不做，避免给豁免账号生成一条永远不会缴的账单
  const [levy, parts, poolTotal, taxUser, taxSum] = await Promise.all([
    exempt ? Promise.resolve({ ...EMPTY_CRISIS_LEVY_VIEW }) : (await resolveSnapshot(userId, nowMs, true)).levy,
    getCrisisAssetParts(userId, nowMs),
    getPoolTotal(),
    prisma.user.findUnique({ where: { id: userId }, select: { crisisTaxEnabled: true } }),
    prisma.pointsLedger.aggregate({
      where: { userId, reason: CRISIS_TAX_LEDGER_REASON },
      _sum: { amount: true },
    }),
  ])
  const hasLiveRaid = !exempt && levy.status === 'due' ? await hasLiveRaidRun(userId, nowMs) : false
  // taxOptIn / taxPaidTotal 在这里现查后传入 DTO，不进 levyCache（快照缓存只含 levy + hasLiveRaid），
  // 所以 PUT /tax 改完开关，下一次读 state 立即可见，无需失效任何缓存
  return buildCrisisStateDto({
    levy,
    rules,
    parts,
    poolTotal: poolTotal.toString(),
    hasLiveRaid,
    exempt,
    nowMs,
    taxOptIn: taxUser?.crisisTaxEnabled === true,
    taxPaidTotal: Math.abs(taxSum._sum.amount ?? 0).toString(),
  })
}

/** 守卫用的最小判定：命中缓存时零查询 */
export async function isUserCrisisBlocked(userId: number, nowMs = Date.now()): Promise<boolean> {
  const rules = await getCrisisRules()
  if (!rules.enabled) return false
  const snapshot = await resolveSnapshot(userId, nowMs)
  return resolveCrisisStatus(snapshot.levy, rules, nowMs, snapshot.hasLiveRaid) === 'blocked'
}

/** 封锁原因文案（守卫与 WebSocket 共用，避免两处各写一句） */
export function crisisBlockMessage(levy: CrisisLevyView): string {
  const remaining = remainingOf(levy)
  return `Lineweb 危机尚未结清，还需上缴 ${remaining} 积分，请前往「Lineweb 危机」页面缴纳`
}

/** 守卫读取税单快照（带缓存），命中封锁时路由层要一并下发账单数字 */
export async function getCrisisGuardSnapshot(userId: number, nowMs = Date.now()): Promise<LevySnapshot> {
  return resolveSnapshot(userId, nowMs)
}

/* ============================================================
   缴纳
   ============================================================ */

export interface CrisisPayResult {
  state: CrisisStateDto
  charged: number
  settled: boolean
}

/**
 * 上缴积分到公共银行。
 *
 * 并发口径（全部在同一事务内）：
 * - 先按读到的 round + status='due' 做 CAS 占位，抢不到就 409 重来（管理员可能刚强制到期）；
 * - 扣积分走 spendPointsTx 自身的 `points >= cost` 条件更新，是防双花的最后一道；
 * - 池总额同事务 increment，保证「扣了分必然进了池」。
 */
export async function payCrisis(userId: number, requestedAmount: number, nowMs = Date.now()): Promise<CrisisPayResult> {
  const rules = await getCrisisRules()
  if (!rules.enabled) throw new AppError('Lineweb 危机当前未开启', 409, 'CRISIS_DISABLED')
  const amount = Math.floor(requestedAmount)
  if (!Number.isFinite(amount) || amount <= 0) throw new AppError('缴纳积分必须为正整数', 400)

  const snapshot = await resolveSnapshot(userId, nowMs, true)
  const levy = snapshot.levy
  if (levy.status !== 'due') throw new AppError('当前没有待缴的危机账单', 409, 'CRISIS_NO_LEVY')
  const remaining = remainingOf(levy)
  if (remaining <= 0) throw new AppError('本轮账单已经结清', 409, 'CRISIS_SETTLED')

  const charged = Math.min(amount, remaining)
  if (charged <= 0) throw new AppError('缴纳额度无效', 400)

  const settledNow = charged >= remaining

  await prisma.$transaction(async (tx) => {
    // 加上 paid 上界条件：并发下两笔缴纳不会把已缴推过应缴额（抢不到就 409 让前端重读账单）
    const claim = await tx.crisisLevy.updateMany({
      where: { userId, round: levy.round, status: 'due', paid: { lte: levy.required - charged } },
      data: { paid: { increment: charged } },
    })
    if (claim.count === 0) {
      throw new AppError('危机账单状态已变化，请刷新后重试', 409, 'CRISIS_STALE')
    }
    await spendPointsTx(tx, userId, charged, {
      reason: CRISIS_LEDGER_REASON,
      note: '上缴 Lineweb 公共银行',
      game: null,
    })
    await ensurePoolRow(tx)
    await tx.crisisPool.update({ where: { id: 1 }, data: { total: { increment: BigInt(charged) } } })

    if (settledNow) {
      // paid 已在上面原子累加到恰好 required，这里只翻状态并排下一轮
      await tx.crisisLevy.update({
        where: { userId },
        data: {
          status: 'clear',
          round: { increment: 1 },
          openAt: null,
          graceUntil: null,
          settledAt: new Date(nowMs),
          nextDueAt: new Date(nextDueAtOf(nowMs, rules)),
        },
      })
    }
  })

  invalidateCrisisCache(userId)
  const state = await getCrisisState(userId, Date.now())
  return { state, charged, settled: settledNow }
}

/* ============================================================
   管理员：强制到期
   ============================================================ */

/** 立即给某个用户开新一轮（重算总资产快照）；已经在缴的轮次会被作废重开 */
export async function forceDueForUser(userId: number, nowMs = Date.now()): Promise<CrisisStateDto> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (!target) throw new AppError('用户不存在', 404)
  if (target.role === 'admin') throw new AppError('管理员豁免危机，无需上缴', 400)
  const rules = await getCrisisRules()
  const levy = await ensureLevyRow(userId, rules, nowMs)
  const parts = await getCrisisAssetParts(userId, nowMs)
  const snapshot = sumCrisisAssets(parts)
  const baseRequired = computeRequired(snapshot, rules)
  // 与 openLevy 同口径：管理员强制到期也要套用公司业绩折减，否则「逼一轮」就把成员挣到的免税额吞掉
  const waiver = baseRequired > 0 ? await planCompanyWaiver(userId, baseRequired, rules) : null
  const required = waiver ? waiver.required : baseRequired
  const requiredBase = waiver ? waiver.requiredBase : baseRequired
  const waiverPct = waiver ? waiver.waiverPct : 0
  const newRound = levy.round + 1

  if (required <= 0) {
    await prisma.crisisLevy.update({
      where: { userId },
      data: {
        status: 'clear',
        round: { increment: 1 },
        snapshot,
        required: 0,
        requiredBase: 0,
        waiverPct: 0,
        paid: 0,
        openAt: null,
        graceUntil: null,
        settledAt: new Date(nowMs),
        nextDueAt: new Date(nextDueAtOf(nowMs, rules)),
      },
    })
  } else {
    await prisma.crisisLevy.update({
      where: { userId },
      data: {
        status: 'due',
        round: { increment: 1 },
        snapshot,
        required,
        requiredBase,
        waiverPct,
        paid: 0,
        openAt: new Date(nowMs),
        graceUntil: new Date(graceUntilOf(nowMs, rules)),
        settledAt: null,
        nextDueAt: null,
      },
    })
    // 这里用的是整行 update（非 CAS）：管理员操作本身就是权威覆盖，档位消费照旧一次性落账
    if (waiver && waiver.companyId !== null) {
      await recordWaivers(userId, waiver.companyId, waiver.steps, newRound)
    }
  }
  invalidateCrisisCache(userId)
  return getCrisisState(userId, Date.now())
}

/**
 * 全员立刻到期（管理员手动触发危机）。
 * 分页逐人处理：总资产评估要对每个人打十几个查询，一把梭会打爆请求超时。
 */
export async function forceDueForAll(nowMs = Date.now(), pageSize = 20): Promise<{ opened: number; skipped: number }> {
  let opened = 0
  let skipped = 0
  let cursor: number | null = null
  for (;;) {
    // 显式标注：cursor 由本页最后一行的 id 反推，TS 在这个 for(;;) 里推不出自引用类型
    const users: { id: number }[] = await prisma.user.findMany({
      where: {
        status: 'active',
        role: { not: 'admin' },
        ...(cursor === null ? {} : { id: { gt: cursor } }),
      },
      orderBy: { id: 'asc' },
      select: { id: true },
      take: pageSize,
    })
    if (users.length === 0) break
    for (const user of users) {
      try {
        const state = await forceDueForUser(user.id, nowMs)
        if (state.required > 0) opened += 1
        else skipped += 1
      } catch (err) {
        console.warn(`[crisis] 强制到期失败 userId=${user.id}：`, err instanceof Error ? err.message : err)
        skipped += 1
      }
    }
    cursor = users[users.length - 1]?.id ?? cursor
    if (users.length < pageSize) break
  }
  return { opened, skipped }
}

/* ============================================================
   管理端总览
   ============================================================ */

export interface CrisisAdminOverview {
  rules: CrisisRules
  poolTotal: string
  totals: { users: number; due: number; blocked: number; settled: number }
  /** 按应缴额排序的欠费用户（含已封锁的） */
  topDebtors: {
    userId: number
    username: string
    snapshot: number
    /** 本轮应缴（已经过公司减免） */
    required: number
    /** 公司减免之前的应缴；无减免时与 required 相同 */
    requiredBase: number
    /** 本轮生效的公司减免百分比 */
    waiverPct: number
    paid: number
    remaining: number
    graceUntil: string | null
    blocked: boolean
  }[]
}

export async function getCrisisAdminOverview(nowMs = Date.now(), debtorLimit = 30): Promise<CrisisAdminOverview> {
  const rules = await getCrisisRules()
  const poolTotal = await getPoolTotal()
  const [users, dueRows, blockedCount] = await Promise.all([
    prisma.user.count({ where: { status: 'active', role: { not: 'admin' } } }),
    prisma.crisisLevy.findMany({
      where: { status: 'due' },
      orderBy: { required: 'desc' },
      take: debtorLimit,
      select: {
        userId: true,
        snapshot: true,
        required: true,
        requiredBase: true,
        waiverPct: true,
        paid: true,
        graceUntil: true,
        user: { select: { username: true } },
      },
    }),
    // 走 [status, graceUntil] 索引精确统计「已过宽限仍未缴满」，不受 debtorLimit 截断影响
    prisma.crisisLevy.count({ where: { status: 'due', graceUntil: { lt: new Date(nowMs) } } }),
  ])

  let due = 0
  let settled = 0
  const counted = await prisma.crisisLevy.groupBy({ by: ['status'], _count: { _all: true } })
  for (const row of counted) {
    if (row.status === 'due') due = row._count._all
    if (row.status === 'clear') settled = row._count._all
  }

  const topDebtors = dueRows.map((row) => ({
    userId: row.userId,
    username: row.user.username,
    snapshot: row.snapshot,
    required: row.required,
    // 与 CrisisStateDto 同口径：老行 requiredBase = 0 时按「减免前就是应缴」兜底，百分比自然是 0
    requiredBase: Math.max(row.requiredBase, row.required),
    waiverPct: waiverPctOf(Math.max(row.requiredBase, row.required), row.required),
    paid: row.paid,
    remaining: remainingOf({ ...EMPTY_CRISIS_LEVY_VIEW, required: row.required, paid: row.paid }),
    graceUntil: row.graceUntil ? row.graceUntil.toISOString() : null,
    blocked: row.graceUntil !== null && nowMs > row.graceUntil.getTime(),
  }))

  return {
    rules,
    poolTotal: poolTotal.toString(),
    // blocked 是「已过宽限未缴满」的行数；正在打搜打撤的玩家仍在这一档里但实际尚未被封锁
    totals: { users, due, blocked: blockedCount, settled },
    topDebtors,
  }
}

/** 某人的危机流水（缴纳记录），走统一台账，不另建表 */
export async function getCrisisHistory(userId: number, limit = 30) {
  const rows = await prisma.pointsLedger.findMany({
    where: { userId, reason: CRISIS_LEDGER_REASON },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, amount: true, balance: true, note: true, createdAt: true },
  })
  return rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    balance: row.balance,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  }))
}
