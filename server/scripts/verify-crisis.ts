/**
 * Lineweb 危机纯函数自检（不依赖数据库 / 环境变量 / 网络 / prisma）
 *
 * 覆盖：
 * - 参数归一化：缺失回退默认、脏值（NaN / 字符串 / null / 非对象）回退、比例与时长上下界钳制；
 * - 应缴额：向下取整、免征门槛归零、永不超过快照、ratio=0 与 ratio=1 两端、脏快照；
 * - 时间推进：宽限只由开轮时刻决定（部分缴纳不延长）、下轮到期只由结清时刻决定；
 * - 状态机真值表：开关关闭 / clear / clear 到期未开轮 / due 未缴满 / due 宽限内 /
 *   due 过宽限 / due 过宽限但有进行中搜打撤对局 / due 已缴满；
 * - 倒计时：msUntilBlock 仅在 due 时给出且不为负；
 * - 资产求和：NaN / 负数 / 小数按 0 或向下取整处理，绝不让 NaN 进账单；
 * - **公司业绩减免**：档位目录不变量、tierMask 解析、单/双/三档乘算与取整、
 *   档位越多应缴越小（单调）、无减免逐字返回 base、减免后允许低于免征门槛、
 *   base 低于门槛时不减免不消费、逐档归因望远镜求和、waiverPctOf 幂等与脏入参；
 * - **与 lib/companyRules.ts 的档位阈值交叉断言**（源码读取，文件不在时跳过，
 *   与 client/src/lib/__tests__/permissions.test.ts 跨端断言同一套路）；
 * - DTO 契约：blocked 与 status 一致、BigInt 总额必须是字符串、日期必须 ISO 或 null、
 *   requiredBase / waiverPct 出口口径（legacy 行不画折减）、companyStock 计入税基；
 * - 豁免名单：筹钱与查账端点放行，对局 / 宠物对战 / 交易行 / 游戏 / 聊天 / 网盘一律封锁，
 *   **公司端点也一律封锁**（减免由成交侧推送，不需要给欠费成员开后门），
 *   末尾斜杠与 '/api' 自描述端点的行为固定；
 * - **官方贷款**：额度 / 期限 / 溢价常量、officialLoanRateOf 的取整与脏入参、
 *   officialLoanBaseRateOf 的「非 0 最大值」口径（空 / 全 0 / 负数 / NaN 回退）；
 * - **每日随机分红**：dividendPctOf 确定性（同 dateKey 同结果）与 5–15 连续区间、
 *   dividendDrawOf 边界（0 池 / 负池 / floor 不足 1 分 / NaN）、
 *   normalizeCrisisRules 对 dividendEnabled 的缺省与布尔化透传。
 *
 * 用法: cd server && npm run verify:crisis
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  CRISIS_DEFAULTS,
  CRISIS_EXEMPT_RULES,
  CRISIS_LIMITS,
  CRISIS_LEDGER_REASON,
  CRISIS_TAX_LEDGER_REASON,
  CRISIS_WAIVER_TIERS,
  DIVIDEND_PCT_MAX,
  DIVIDEND_PCT_MIN,
  EMPTY_CRISIS_ASSETS,
  EMPTY_CRISIS_LEVY_VIEW,
  OFFICIAL_LOAN_DUE_DAYS,
  OFFICIAL_LOAN_MAX,
  OFFICIAL_LOAN_MIN,
  OFFICIAL_RATE_PREMIUM_PCT,
  applyCrisisWaivers,
  applyCrisisWaiversByTier,
  buildCrisisStateDto,
  computeRequired,
  crisisTiersFromMask,
  crisisWaiverPctOf,
  crisisWaiverPcts,
  crisisWaiverTiersOf,
  dividendDrawOf,
  dividendPctOf,
  graceUntilOf,
  isCrisisBlocked,
  isCrisisExempt,
  isLevyDue,
  msUntilBlock,
  nextDueAtOf,
  normalizeCrisisRules,
  officialLoanBaseRateOf,
  officialLoanRateOf,
  remainingOf,
  resolveCrisisStatus,
  sumCrisisAssets,
  waiverPctOf,
  type CrisisAssetParts,
  type CrisisLevyView,
  type CrisisRules,
} from '../src/lib/crisisRules.js'
import { COMPANY_LOAN_RATE_PCT } from '../src/lib/companyRules.js'

let passed = 0

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(`断言失败：${label}`)
  passed += 1
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const actualText = JSON.stringify(actual)
  const expectedText = JSON.stringify(expected)
  if (actualText !== expectedText) {
    throw new Error(`断言失败：${label}\n  实际: ${actualText}\n  期望: ${expectedText}`)
  }
  passed += 1
}

const HOUR_MS = 60 * 60 * 1000
const RULES: CrisisRules = { ...CRISIS_DEFAULTS }
/** 固定基准时刻，避免脚本随真实时间漂移 */
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0)

function levyOf(overrides: Partial<CrisisLevyView> = {}): CrisisLevyView {
  return { ...EMPTY_CRISIS_LEVY_VIEW, ...overrides }
}

/* ============================================================
   1. 常量与默认参数
   ============================================================ */

assertEqual(CRISIS_LEDGER_REASON, 'crisis_payment', '台账 reason 固定')
assertEqual(CRISIS_TAX_LEDGER_REASON, 'crisis_tax', '税款台账 reason 固定（与 crisis_payment 互免防循环）')
assertEqual(RULES.ratio, 0.5, '默认上缴比例 50%')
assertEqual(RULES.intervalMs, 48 * HOUR_MS, '默认每 48 小时一轮（每人各自滚动）')
assertEqual(RULES.graceMs, 12 * HOUR_MS, '默认宽限 12 小时')
assertEqual(RULES.spendTaxPct, 5, '默认积分税款 5%（用户自选开关，唯一挂钩 spendPointsTx）')
assert(CRISIS_LIMITS.spendTaxMin === 0 && CRISIS_LIMITS.spendTaxMax === 50, '税款比例钳制在 0–50')
assert(RULES.enabled, '默认启用')
assert(CRISIS_LIMITS.intervalMinMs >= 60 * 1000, '到期间隔下界不得小于 1 分钟，防误设成秒级把全站锁死')
assert(CRISIS_LIMITS.graceMinMs >= 60 * 1000, '宽拿下界不得小于 1 分钟')
assert(CRISIS_LIMITS.ratioMax === 1 && CRISIS_LIMITS.ratioMin === 0, '比例钳制在 0–1')

/* ============================================================
   2. 参数归一化
   ============================================================ */

assertEqual(normalizeCrisisRules(undefined), RULES, 'undefined 回退全套默认值')
assertEqual(normalizeCrisisRules(null), RULES, 'null 回退默认值')
assertEqual(normalizeCrisisRules('nope'), RULES, '非对象回退默认值')
assertEqual(normalizeCrisisRules({}), RULES, '空对象回退默认值')
assertEqual(normalizeCrisisRules({ ratio: 'abc' }), RULES, '脏比例回退默认值')
assertEqual(normalizeCrisisRules({ ratio: Number.NaN }), RULES, 'NaN 比例回退默认值')
assertEqual(normalizeCrisisRules({ ratio: 5 }), { ...RULES, ratio: CRISIS_LIMITS.ratioMax }, '比例上钳到 1')
assertEqual(normalizeCrisisRules({ ratio: -3 }), { ...RULES, ratio: 0 }, '比例下钳到 0')
assertEqual(
  normalizeCrisisRules({ intervalMs: 1000 }),
  { ...RULES, intervalMs: CRISIS_LIMITS.intervalMinMs },
  '到期间隔下钳到最小值',
)
assertEqual(
  normalizeCrisisRules({ intervalMs: 10 * 365 * 24 * HOUR_MS }),
  { ...RULES, intervalMs: CRISIS_LIMITS.intervalMaxMs },
  '到期间隔上钳到最大值',
)
assertEqual(
  normalizeCrisisRules({ graceMs: 1 }),
  { ...RULES, graceMs: CRISIS_LIMITS.graceMinMs },
  '宽限下钳到最小值',
)
assertEqual(normalizeCrisisRules({ minLevy: 1234.9 }), { ...RULES, minLevy: 1234 }, '免征门槛取整')
assertEqual(normalizeCrisisRules({ minLevy: -100 }), { ...RULES, minLevy: 0 }, '免征门槛不为负')
assertEqual(normalizeCrisisRules({ spendTaxPct: -1 }), { ...RULES, spendTaxPct: 0 }, '税款比例下钳到 0')
assertEqual(normalizeCrisisRules({ spendTaxPct: 99 }), { ...RULES, spendTaxPct: 50 }, '税款比例上钳到 50')
assertEqual(normalizeCrisisRules({ spendTaxPct: 7.9 }), { ...RULES, spendTaxPct: 7 }, '税款比例 floor 取整（照 minLevy 口径）')
assertEqual(normalizeCrisisRules({ spendTaxPct: 'abc' }), RULES, '脏税款比例回退默认值')
assertEqual(normalizeCrisisRules({ enabled: false }), { ...RULES, enabled: false }, 'enabled=false 被保留')
assertEqual(normalizeCrisisRules({ enabled: 1 }), { ...RULES, enabled: true }, 'enabled 走布尔化')
assert(
  normalizeCrisisRules({ ratio: 0.3 }).ratio === 0.3 && normalizeCrisisRules({ ratio: 0.3 }).graceMs === RULES.graceMs,
  '深合并语义：只覆盖传入项，其余保持默认',
)

/* ============================================================
   3. 应缴额
   ============================================================ */

assertEqual(computeRequired(1000, RULES), 500, '1000 资产缴 500')
assertEqual(computeRequired(1001, RULES), 500, '向下取整')
assertEqual(computeRequired(999, RULES), 499, '奇数快照向下取整')
assertEqual(computeRequired(199, RULES), 0, '未达免征门槛（99 < 100）直接归零，穷人不该被封锁')
assertEqual(computeRequired(200, RULES), 100, '刚好达到免征门槛就按门槛收')
assertEqual(computeRequired(0, RULES), 0, '零资产应缴 0')
assertEqual(computeRequired(-5000, RULES), 0, '负快照应缴 0')
assertEqual(computeRequired(Number.NaN, RULES), 0, 'NaN 快照应缴 0')
assertEqual(computeRequired(Number.POSITIVE_INFINITY, RULES), 0, '无穷快照应缴 0')
assertEqual(computeRequired(1_000_000, { ...RULES, ratio: 0 }), 0, '比例为 0 等于免税')
assertEqual(computeRequired(1_000_000, { ...RULES, ratio: 1 }), 1_000_000, '比例为 1 全额征收')
assertEqual(computeRequired(50, { ...RULES, ratio: 1, minLevy: 0 }), 50, '全额也不会超过快照')
assertEqual(computeRequired(10, { ...RULES, ratio: 0.9, minLevy: 0 }), 9, '全额钳制不超过快照本身')
assertEqual(computeRequired(1_000_000_000, { ...RULES, minLevy: 0 }), 500_000_000, '大额仍按半')

let monotonic = true
let lastRequired = -1
for (let snapshot = 0; snapshot <= 200_000; snapshot += 997) {
  const required = computeRequired(snapshot, { ...RULES, minLevy: 0 })
  if (required < lastRequired) monotonic = false
  lastRequired = required
  if (required > snapshot) monotonic = false
}
assert(monotonic, '应缴额对资产单调不减且恒不超过资产')

/* ============================================================
   4. 时间推进：宽限只看开轮，到期只看结清
   ============================================================ */

assertEqual(graceUntilOf(T0, RULES), T0 + 12 * HOUR_MS, '宽限截止 = 开轮 + graceMs')
assertEqual(
  graceUntilOf(T0, RULES),
  graceUntilOf(T0, { ...RULES }),
  '同一开轮时刻的宽限截止恒定（与缴纳进度无关）',
)
assert(
  graceUntilOf(T0, RULES) === graceUntilOf(T0, normalizeCrisisRules({ graceMs: RULES.graceMs })),
  '归一化后同一 graceMs 得到同样的宽限截止',
)
assertEqual(nextDueAtOf(T0, RULES), T0 + 48 * HOUR_MS, '下一轮到期 = 结清 + intervalMs')
assertEqual(
  nextDueAtOf(T0 + 3 * HOUR_MS, RULES),
  T0 + 3 * HOUR_MS + 48 * HOUR_MS,
  '结清越晚，下一轮越晚（滚动而非全站统一）',
)
assert(remainingOf(levyOf({ required: 500, paid: 120 })) === 380, '剩余应缴 = 应缴 - 已缴')
assertEqual(remainingOf(levyOf({ required: 500, paid: 900 })), 0, '超额记录不会算出负数剩余')

/* ============================================================
   5. 状态机真值表
   ============================================================ */

const DISABLED: CrisisRules = { ...RULES, enabled: false }
const DUE_LEVY = levyOf({ status: 'due', required: 500, paid: 0, openAt: T0, graceUntil: T0 + 12 * HOUR_MS })

/* —— 封锁只在「启用 + 本轮未缴满 + 已过宽限」时发生 —— */
assertEqual(resolveCrisisStatus(DUE_LEVY, DISABLED, T0 + 99 * HOUR_MS), 'clear', '开关关闭时一律放行（连欠费也不封）')
assertEqual(isCrisisBlocked(DUE_LEVY, DISABLED, T0 + 99 * HOUR_MS), false, '开关关闭时 isCrisisBlocked 为假')
assertEqual(resolveCrisisStatus(levyOf(), RULES, T0), 'clear', '空税单（新用户）不封')
assertEqual(resolveCrisisStatus(DUE_LEVY, RULES, T0 + 1 * HOUR_MS), 'due', '宽限内不封')
assertEqual(resolveCrisisStatus(DUE_LEVY, RULES, T0 + 12 * HOUR_MS), 'due', '正好卡在宽限截止这一毫秒还不封')
assertEqual(resolveCrisisStatus(DUE_LEVY, RULES, T0 + 12 * HOUR_MS + 1), 'blocked', '过宽限且未缴满 → 封锁')
assertEqual(
  resolveCrisisStatus({ ...DUE_LEVY, paid: 250 }, RULES, T0 + 20 * HOUR_MS),
  'blocked',
  '部分缴纳过宽限仍未缴满 → 封锁（部分缴纳只买宽限内的时间，不延长宽限）',
)
assertEqual(
  resolveCrisisStatus({ ...DUE_LEVY, paid: 500 }, RULES, T0 + 99 * HOUR_MS),
  'clear',
  '缴满即结清，不再封锁')
assertEqual(resolveCrisisStatus({ ...DUE_LEVY, required: 0 }, RULES, T0 + 99 * HOUR_MS), 'clear', '应缴 0（免征）永不封锁')
assertEqual(
  resolveCrisisStatus(DUE_LEVY, RULES, T0 + 20 * HOUR_MS, true),
  'due',
  '过了宽限但有进行中的搜打撤对局 → 打完这局再封',
)
assertEqual(
  isCrisisBlocked(DUE_LEVY, RULES, T0 + 20 * HOUR_MS, true),
  false,
  '对局保护期间守卫必须放行',
)
assertEqual(
  isCrisisBlocked(levyOf({ status: 'due', required: 500, paid: 0 }), RULES, T0 + 99 * HOUR_MS),
  false,
  '宽限截止缺失（脏数据）时不封，避免误伤',
)

/* —— 到期未开轮：状态显示 due，服务层据此开轮 —— */
const CLEAR_PAST_DUE = levyOf({ status: 'clear', nextDueAt: T0 - 1 })
assertEqual(isLevyDue(CLEAR_PAST_DUE, RULES, T0), true, '结清后满 48 小时 → 该开新一轮')
assertEqual(isLevyDue(CLEAR_PAST_DUE, DISABLED, T0), false, '开关关闭时不开轮')
assertEqual(isLevyDue(levyOf({ status: 'clear', nextDueAt: T0 + 1000 }), RULES, T0), false, '还没到期不开轮')
assertEqual(isLevyDue(levyOf({ status: 'clear', nextDueAt: null }), RULES, T0), false, '没有到期时刻（首访未建行）不开轮')
assertEqual(isLevyDue({ ...DUE_LEVY, nextDueAt: T0 - 1 }, RULES, T0), false, 'due 状态不会被再次开轮（避免重复快照）')
assertEqual(resolveCrisisStatus(CLEAR_PAST_DUE, RULES, T0), 'due', '到期未开轮对外显示为 due')
assertEqual(isCrisisBlocked(CLEAR_PAST_DUE, RULES, T0), false, '刚到期还没生成账单，不直接封')

/* —— 倒计时 —— */
assertEqual(msUntilBlock(DUE_LEVY, T0 + 2 * HOUR_MS), 10 * HOUR_MS, '宽限内给出剩余毫秒')
assertEqual(msUntilBlock(DUE_LEVY, T0 + 13 * HOUR_MS), 0, '已过宽限倒计时为 0 且不为负')
assertEqual(msUntilBlock(levyOf({ status: 'clear', nextDueAt: T0 + HOUR_MS }), T0), 0, '未开轮没有倒计时')
assertEqual(msUntilBlock({ ...DUE_LEVY, paid: 500 }, T0 + HOUR_MS), 0, '缴满后倒计时归零（不再显示「距封锁还剩 N 小时」）')
assertEqual(msUntilBlock({ ...DUE_LEVY, paid: 499 }, T0 + HOUR_MS), 11 * HOUR_MS, '差 1 分仍未缴满，倒计时继续走')

/* ============================================================
   6. 资产求与 DTO 契约
   ============================================================ */

const FULL_PARTS: CrisisAssetParts = {
  ...EMPTY_CRISIS_ASSETS,
  points: 1000,
  raidGear: 600,
  raidWarehouse: 300,
  raidBags: 120,
  petOutfits: 2000,
  petEquipment: 800,
  petSkills: 300,
  stocks: 2500,
  stockOrders: 400,
  bankDemand: 1500,
  bankDeposits: 5000,
  funds: 1800,
  companyStock: 700,
}
assertEqual(sumCrisisAssets(FULL_PARTS), 17_020, '十三项资产全部相加')
assertEqual(sumCrisisAssets(EMPTY_CRISIS_ASSETS), 0, '空分项求和为 0')
assertEqual(
  sumCrisisAssets({ ...EMPTY_CRISIS_ASSETS, points: Number.NaN, stocks: -500, funds: 9.9 }),
  9,
  'NaN 与负数按 0，小数向下取整（脏值不进账单）',
)
assertEqual(
  sumCrisisAssets({ ...EMPTY_CRISIS_ASSETS, companyStock: 700 }),
  700,
  '本人捐入公司货栈的未售存货必须计入税基（否则把资产搬进货栈就能避税）',
)
assertEqual(computeRequired(sumCrisisAssets(FULL_PARTS), RULES), 8510, '应缴额直接建立在求和结果上')
assert(
  sumCrisisAssets({ ...EMPTY_CRISIS_ASSETS, stockOrders: 400 }) > sumCrisisAssets(EMPTY_CRISIS_ASSETS),
  '冻结在限价委托里的资产必须计入（否则把钱停在委托单就能避税）',
)

const dto = buildCrisisStateDto({
  levy: DUE_LEVY,
  rules: RULES,
  parts: FULL_PARTS,
  poolTotal: '12345',
  nowMs: T0 + HOUR_MS,
})
assertEqual(dto.status, 'due', 'DTO 状态与真值表一致')
assertEqual(dto.blocked, false, '宽限内 blocked=false')
assertEqual(dto.remaining, 500, 'DTO 剩余应缴')
assertEqual(dto.assets.total, 17_020, 'DTO 总资产（含公司货栈）')
assertEqual(dto.poolTotal, '12345', '公共银行总额必须是字符串（BigInt 不能进 JSON）')
assertEqual(typeof dto.poolTotal, 'string', '池总额类型固定')
assertEqual(dto.msUntilBlock, 11 * HOUR_MS, 'DTO 倒计时')
assertEqual(dto.openAt, new Date(T0).toISOString(), '开轮时刻输出 ISO 字符串')
assertEqual(dto.graceUntil, new Date(T0 + 12 * HOUR_MS).toISOString(), '宽限截止输出 ISO 字符串')
assertEqual(dto.settledAt, null, '未结清时 settledAt 为 null')
assertEqual(dto.nextDueAt, null, 'due 期间 nextDueAt 为 null')
assertEqual(dto.round, 0, 'DTO 透传乐观锁轮次')
assertEqual(dto.rules, RULES, 'DTO 下发当前规则供前端显示')
assertEqual(dto.hasLiveRaid, false, '默认无进行中对局')
assertEqual(dto.taxOptIn, false, 'taxOptIn 缺省 false（未传 = 未开税款开关）')
assertEqual(dto.taxPaidTotal, '0', 'taxPaidTotal 缺省 0（字符串出口口径与 poolTotal 一致）')
assertEqual(
  buildCrisisStateDto({
    levy: DUE_LEVY,
    rules: RULES,
    parts: FULL_PARTS,
    poolTotal: '0',
    nowMs: T0 + HOUR_MS,
    taxOptIn: true,
    taxPaidTotal: '123',
  }).taxOptIn,
  true,
  'taxOptIn 透传',
)
assertEqual(
  buildCrisisStateDto({
    levy: DUE_LEVY,
    rules: RULES,
    parts: FULL_PARTS,
    poolTotal: '0',
    nowMs: T0 + HOUR_MS,
    taxOptIn: true,
    taxPaidTotal: '123',
  }).taxPaidTotal,
  '123',
  'taxPaidTotal 透传（累计缴税一律字符串出口）',
)
assertEqual(
  buildCrisisStateDto({ levy: DUE_LEVY, rules: RULES, parts: FULL_PARTS, poolTotal: '0', nowMs: T0 + 20 * HOUR_MS }).blocked,
  true,
  'DTO 的 blocked 与状态机同口径',
)
assertEqual(
  buildCrisisStateDto({
    levy: DUE_LEVY,
    rules: RULES,
    parts: FULL_PARTS,
    poolTotal: '0',
    nowMs: T0 + 20 * HOUR_MS,
    hasLiveRaid: true,
  }).blocked,
  false,
  'DTO 在对局保护期间 blocked=false',
)
assertEqual(
  buildCrisisStateDto({ levy: DUE_LEVY, rules: RULES, parts: FULL_PARTS, poolTotal: '0', nowMs: T0 + 20 * HOUR_MS })
    .msUntilBlock,
  0,
  '已封锁时倒计时归零（前端不再显示「还剩 -3 小时」）',
)
assertEqual(
  buildCrisisStateDto({ levy: DUE_LEVY, rules: RULES, parts: FULL_PARTS, poolTotal: '0', nowMs: T0 + 20 * HOUR_MS, exempt: true })
    .blocked,
  false,
  '管理员豁免：过宽限也不封锁',
)
assertEqual(
  buildCrisisStateDto({ levy: DUE_LEVY, rules: RULES, parts: FULL_PARTS, poolTotal: '0', nowMs: T0 + 20 * HOUR_MS, exempt: true })
    .status,
  'clear',
  '管理员豁免：账单显示为 clear 而不是 due',
)
assertEqual(
  buildCrisisStateDto({ levy: DUE_LEVY, rules: RULES, parts: FULL_PARTS, poolTotal: '0', nowMs: T0 }).exempt,
  false,
  '普通用户 exempt=false',
)
assertEqual(
  buildCrisisStateDto({ levy: levyOf(), rules: RULES, parts: { ...EMPTY_CRISIS_ASSETS, points: NaN }, poolTotal: '0', nowMs: T0 })
    .assets.total,
  0,
  '脏资产分项在 DTO 出口被洗成 0',
)

/* —— DTO 的公司减免两个字段 —— */
const WAIVERED_LEVY = levyOf({
  status: 'due',
  snapshot: 2000,
  required: 675,
  requiredBase: 1000,
  waiverPct: 33,
  paid: 0,
  openAt: T0,
  graceUntil: T0 + 12 * HOUR_MS,
})
const waiverDto = buildCrisisStateDto({ levy: WAIVERED_LEVY, rules: RULES, parts: FULL_PARTS, poolTotal: '0', nowMs: T0 })
assertEqual(waiverDto.required, 675, 'DTO 的 required 是折减后的实数')
assertEqual(waiverDto.requiredBase, 1000, 'DTO 透出减免前的基数供前端画折减对照')
assertEqual(waiverDto.waiverPct, 33, 'DTO 的 waiverPct 由 base 与 required 反推（1000→675 即 32.5%，四舍五入 33）')
assertEqual(waiverDto.remaining, 675, '剩余应缴按折减后的 required 算')
// 老行（改造之前开的轮）两列都是 0：必须表现成「没有减免」，而不是「减免了 100%」
const legacyDto = buildCrisisStateDto({
  levy: levyOf({ status: 'due', required: 500, paid: 0, openAt: T0, graceUntil: T0 + 12 * HOUR_MS }),
  rules: RULES,
  parts: FULL_PARTS,
  poolTotal: '0',
  nowMs: T0,
})
assertEqual(legacyDto.requiredBase, 500, 'legacy 行（requiredBase=0）出口回退成 required')
assertEqual(legacyDto.waiverPct, 0, 'legacy 行不能画出折减')
assertEqual(dto.requiredBase, 500, '未折减账单的 base 恒等于 required（前端可无条件按 base→required 画）')
assertEqual(dto.waiverPct, 0, '未折减账单的百分比为 0')
assert(
  buildCrisisStateDto({
    levy: levyOf({ status: 'due', required: 675, requiredBase: 100 }),
    rules: RULES,
    parts: FULL_PARTS,
    poolTotal: '0',
    nowMs: T0,
  }).requiredBase >= 675,
  '脏数据里 base 小于 required 时按 required 兜底：折减只能让账单变小，不能反过来',
)

/* ============================================================
   7. 公司业绩减免（纯函数口径）
   ============================================================ */

/* —— 档位目录不变量 —— */
assertEqual(CRISIS_WAIVER_TIERS.length, 3, '减免共三档')
assertEqual(
  CRISIS_WAIVER_TIERS.map((entry) => entry.tier),
  [1, 2, 3],
  '档位号连续且从 1 开始（tierMask 的位序就是 tier-1）',
)
assertEqual(
  CRISIS_WAIVER_TIERS.map((entry) => entry.threshold),
  [10_000, 50_000, 200_000],
  '阈值 1 万 / 5 万 / 20 万',
)
assertEqual(
  CRISIS_WAIVER_TIERS.map((entry) => entry.pct),
  [10, 25, 50],
  '折减 10% / 25% / 50%',
)
assert(
  CRISIS_WAIVER_TIERS.every((entry, index) => index === 0 || CRISIS_WAIVER_TIERS[index - 1].threshold < entry.threshold),
  '阈值严格递增（高位达成必然低位也达成，抬档才不会漏发低档）',
)
assert(
  CRISIS_WAIVER_TIERS.every((entry, index) => index === 0 || CRISIS_WAIVER_TIERS[index - 1].pct < entry.pct),
  '折减幅度随档位递增（越高的营业额换越大的免税）',
)
assert(
  CRISIS_WAIVER_TIERS.every((entry) => entry.pct > 0 && entry.pct < 100),
  '任何一档都不能是 0% 或 100%（前者等于没有这一档，后者等于赦免）',
)
assertEqual(crisisWaiverPctOf(1), 10, '按档位号取折减百分比')
assertEqual(crisisWaiverPctOf(3), 50, '第三档 50%')
assertEqual(crisisWaiverPctOf(4), 0, '目录外的档位不减税')
assertEqual(crisisWaiverPctOf(0), 0, '档位 0 不存在')

/* —— tierMask 解析 —— */
assertEqual(crisisTiersFromMask(0), [], '掩码 0 = 一档未达')
assertEqual(crisisTiersFromMask(1), [1], 'bit0 = 档 1')
assertEqual(crisisTiersFromMask(2), [2], 'bit1 = 档 2')
assertEqual(crisisTiersFromMask(4), [3], 'bit2 = 档 3')
assertEqual(crisisTiersFromMask(3), [1, 2], 'bit0+bit1 = 档 1、2（升序）')
assertEqual(crisisTiersFromMask(7), [1, 2, 3], '全档达成')
assertEqual(crisisTiersFromMask(8), [], '高位脏比特一律忽略（掩码只认目录里的三位）')
assertEqual(crisisTiersFromMask(-1), [], '负掩码按未达成')
assertEqual(crisisTiersFromMask(Number.NaN), [], 'NaN 掩码按未达成')
assertEqual(crisisTiersFromMask(1.9), [1], '小数掩码向下取整后解析')
assertEqual(crisisWaiverTiersOf([3, 1, 9, 1, 0, -2]), [1, 3], '档位去噪 + 去重 + 升序')
assertEqual(crisisWaiverPcts([3, 1]), [10, 50], '档位列表 → 百分比列表（按档位升序，不是按百分比）')
assertEqual(crisisWaiverPcts([9]), [], '目录外档位不产生任何折减')

/* —— 单档乘算与取整 —— */
assertEqual(applyCrisisWaivers(1000, []), 1000, '无减免：逐字返回 base（与改造前的开轮完全等价）')
assertEqual(applyCrisisWaivers(1000, [], 100), 1000, '无减免 + 门槛：仍逐字返回 base')
assertEqual(applyCrisisWaivers(0, [50]), 0, 'base 为 0（本轮免征）时没有可减的东西')
assertEqual(applyCrisisWaivers(-500, [50]), 0, '负 base 归零')
assertEqual(applyCrisisWaivers(Number.NaN, [50]), 0, 'NaN base 归零')
assertEqual(applyCrisisWaivers(1000, [10]), 900, '一档 10% → 900')
assertEqual(applyCrisisWaivers(1000, [25]), 750, '一档 25% → 750')
assertEqual(applyCrisisWaivers(1000, [50]), 500, '一档 50% → 500')
assertEqual(applyCrisisWaivers(999, [50]), 499, '向下取整（499.5 → 499）')
assertEqual(applyCrisisWaivers(1000, [10, 25]), 675, '两档乘算 1000 × 0.9 × 0.75')
assertEqual(applyCrisisWaivers(1000, [10, 25, 50]), 337, '三档乘算 1000 × 0.9 × 0.75 × 0.5 = 337.5 → 337')
assertEqual(applyCrisisWaivers(2000, [10, 25, 50]), 675, '两千元三档后 675')
assertEqual(applyCrisisWaivers(999, [10, 25, 50]), 337, '999 × 0.3375 = 337.16 → 337')
// 这是「只在最后取整一次」的可观察证据：逐档取整会因为 0.9 的小数先被截掉而多减 1 分
assertEqual(applyCrisisWaivers(101, [10, 25]), 68, '只在最后取整一次（逐档取整会得到 67）')
assertEqual(applyCrisisWaivers(1, [50]), 0, '1 分账单被 50% 折到 0（折减允许清零，不产生负数）')
assertEqual(applyCrisisWaivers(1000, [100]), 0, '100% 档（目录里不存在，但口径要固定）等于赦免')
assertEqual(applyCrisisWaivers(1000, [Number.NaN]), 1000, '脏百分比按 0% 处理，不影响账单')
assertEqual(applyCrisisWaivers(1000, [-30]), 1000, '负百分比下钳到 0')
assertEqual(applyCrisisWaivers(1000, [300]), 0, '超额百分比上钳到 100%，绝不变负')

/* —— 单调性与边界 —— */
let waiverMonotonic = true
for (let base = 0; base <= 60_000; base += 37) {
  const none = applyCrisisWaivers(base, [], 0)
  const one = applyCrisisWaivers(base, [10], 0)
  const two = applyCrisisWaivers(base, [10, 25], 0)
  const three = applyCrisisWaivers(base, [10, 25, 50], 0)
  if (three > two || two > one || one > none) waiverMonotonic = false
  if (three < 0 || three > base) waiverMonotonic = false
}
assert(waiverMonotonic, '档位越多应缴只可能更小或相等，且恒在 [0, base] 内')
assert(
  applyCrisisWaivers(5000, [10, 25, 50]) <= applyCrisisWaivers(5000, [50]),
  '高档组合不会反低于单档',
)

/* —— 与免征门槛的相互作用（本次最容易改错的一处）—— */
assertEqual(applyCrisisWaivers(240, [50], 200), 120, '折减后的数字允许低于 minLevy（120 < 200 也照收 120）')
assertEqual(applyCrisisWaivers(1000, [10, 25, 50], 900), 337, '折减到门槛以下不会因为 minLevy 被抬回去')
assertEqual(applyCrisisWaivers(100, [50], 200), 100, 'base 本身就低于当前门槛时不减免、不消费档位')
assertEqual(applyCrisisWaivers(100, [50], 0), 50, 'minLevy=0（管理员取消免征门槛）时正常折减')
assertEqual(applyCrisisWaivers(100, [50]), 50, 'minLevy 缺省为 0')
assert(
  applyCrisisWaivers(240, [50], 200) < 200 && applyCrisisWaivers(240, [50], 200) > 0,
  'minLevy 只当门槛、不当账单下界：既没有把小额欠款赦成 0，也没有抬回门槛',
)

/* —— 逐档归因（crisis_waivers.reduction 的口径）—— */
for (const tiers of [[1], [2], [3], [1, 2], [1, 3], [2, 3], [1, 2, 3]] as const) {
  for (const base of [0, 1, 99, 101, 1000, 8510, 999_999]) {
    const plan = applyCrisisWaiversByTier(base, tiers, 0)
    const totalCut = plan.steps.reduce((sum, step) => sum + step.reduction, 0)
    if (base > 0 && plan.required !== base) {
      if (totalCut !== base - plan.required) throw new Error(`断言失败：档位 ${tiers.join('/')} base=${base} 各档减免相加必须等于总减免`)
      passed += 1
    }
    if (plan.required !== applyCrisisWaivers(base, crisisWaiverPcts(tiers), 0)) {
      throw new Error(`断言失败：档位 ${tiers.join('/')} base=${base} 的归因结果与 applyCrisisWaivers 不一致`)
    }
    passed += 1
    if (plan.requiredBase !== (base > 0 ? Math.floor(base) : 0)) {
      throw new Error(`断言失败：档位 ${tiers.join('/')} base=${base} 的 requiredBase 必须等于减免前基数`)
    }
    passed += 1
    if (plan.steps.length !== tiers.length) throw new Error(`断言失败：档位 ${tiers.join('/')} 每一档都要有一条归因`)
    passed += 1
    if (plan.steps.some((step, index) => step.reduction < 0)) throw new Error(`断言失败：档位 ${tiers.join('/')} 出现负减免`)
    passed += 1
    if (plan.steps.some((step, index) => step.pct !== crisisWaiverPctOf(step.tier))) {
      throw new Error(`断言失败：档位 ${tiers.join('/')} 的百分比与目录不符`)
    }
    passed += 1
  }
}

const tierPlan = applyCrisisWaiversByTier(1000, [1, 2, 3], 100)
assertEqual(tierPlan.required, 337, '三档归因后的应缴与直接乘算一致')
assertEqual(
  tierPlan.steps.map((step) => step.reduction),
  [100, 225, 338],
  '逐档减免：档 1 减 100、档 2 再减 225、档 3 再减 338（合计 663 = 1000 − 337）',
)
assertEqual(tierPlan.waiverPct, 66, '三档合计的展示百分比（66.25% → 66）')
assertEqual(
  applyCrisisWaiversByTier(100, [1, 2], 200).required,
  100,
  '门槛退化时逐档归因也不改账单',
)
assertEqual(applyCrisisWaiversByTier(100, [1, 2], 200).steps.length, 2, '归因仍逐档给出（服务层按 reduction>0 决定是否消费档位）')
assert(
  applyCrisisWaiversByTier(100, [1, 2], 200).steps.every((step) => step.reduction === 0),
  '门槛退化时每档减免为 0，服务层据此不消费档位',
)
assertEqual(applyCrisisWaiversByTier(1000, [9], 0).required, 1000, '目录外档位不产生折减')
assertEqual(applyCrisisWaiversByTier(1000, [9], 0).steps, [], '目录外档位不产生归因行')

/* —— waiverPctOf —— */
assertEqual(waiverPctOf(1000, 1000), 0, '没有折减 → 0%')
assertEqual(waiverPctOf(1000, 900), 10, '一档 10%')
assertEqual(waiverPctOf(1000, 750), 25, '一档 25%')
assertEqual(waiverPctOf(1000, 500), 50, '一档 50%')
assertEqual(waiverPctOf(1000, 675), 33, '两档 32.5% 四舍五入到 33（展示口径，精确数字由 base→required 给出）')
assertEqual(waiverPctOf(1000, 337), 66, '三档 66.3% → 66')
assertEqual(waiverPctOf(1000, 0), 100, '全额减免 → 100')
assertEqual(waiverPctOf(0, 500), 0, '脏 base 回 0，绝不做除零')
assertEqual(waiverPctOf(Number.NaN, 500), 0, 'NaN base 回 0')
assertEqual(waiverPctOf(1000, -20), 100, 'required 为负按 0 夹住 → 100%')
assertEqual(waiverPctOf(1000, 2000), 0, 'required 反而大于 base（脏数据）时按无减免，绝不报成负百分比')
assertEqual(waiverPctOf(1000, Number.NaN), 0, 'NaN required 按 0 折减处理')
assertEqual(waiverPctOf(999, 999), 0, '同值必为 0（幂等锚）')
assertEqual(
  waiverPctOf(800, applyCrisisWaivers(800, [10, 25], 0)),
  waiverPctOf(800, applyCrisisWaivers(800, [10, 25], 0)),
  '同一入参重复调用结果一致（纯函数）',
)
const waiverOnce = applyCrisisWaivers(1000, [10], 0)
const waiverTwice = applyCrisisWaivers(waiverOnce, [25], 0)
assert(
  waiverTwice <= waiverOnce,
  '再叠加一档只会更低，不会把账单算大（推送路径可重复调用）',
)
assertEqual(
  waiverPctOf(1000, waiverTwice) >= waiverPctOf(1000, waiverOnce),
  true,
  '折减比例只增不减（展示口径与账单同向）',
)
// 折减后的账单再折一次（把它的 base 当作新的 base、档位为空）必须逐字不变：幂等
assertEqual(
  applyCrisisWaivers(applyCrisisWaivers(1000, [10, 25], 0), [], 0),
  applyCrisisWaivers(1000, [10, 25], 0),
  '无档位时二次应用不改账单（幂等）',
)

/* —— 与 lib/companyRules.ts 的阈值交叉断言（源码读取，文件还没落盘就跳过）—— */
const COMPANY_RULES_FILE = resolve(process.cwd(), 'src/lib/companyRules.ts')
if (existsSync(COMPANY_RULES_FILE)) {
  const companySource = readFileSync(COMPANY_RULES_FILE, 'utf8')
  const block = /COMPANY_REVENUE_TIERS[^=]*=\s*\[([\s\S]*?)\]/.exec(companySource)?.[1]
  if (!block) throw new Error('断言失败：未能从 src/lib/companyRules.ts 解析出 COMPANY_REVENUE_TIERS')
  const companyTiers = [...block.matchAll(/\{\s*tier:\s*(\d+),\s*threshold:\s*([\d_]+),\s*reductionPct:\s*(\d+)\s*\}/g)].map(
    (match) => ({
      tier: Number(match[1]),
      threshold: Number(match[2].replace(/_/g, '')),
      pct: Number(match[3]),
    }),
  )
  assert(companyTiers.length === CRISIS_WAIVER_TIERS.length, '两份档位目录档数一致（公司抬档与危机折减必须同一清单）')
  for (const entry of CRISIS_WAIVER_TIERS) {
    const counterpart = companyTiers.find((row) => row.tier === entry.tier)
    if (!counterpart) throw new Error(`断言失败：companyRules.ts 缺少档 ${entry.tier}`)
    assertEqual(counterpart.threshold, entry.threshold, `档 ${entry.tier} 的营业额阈值与 companyRules.ts 一致`)
    assertEqual(counterpart.pct, entry.pct, `档 ${entry.tier} 的折减百分比与 companyRules.ts 一致`)
  }
} else {
  console.log('（提示：src/lib/companyRules.ts 还不存在，跳过与公司的阈值交叉断言）')
}

/* ============================================================
   8. 豁免名单（deny-by-default）
   ============================================================ */

const EXEMPT_POSITIVE = [
  'GET /api/crisis/me',
  'POST /api/crisis/pay',
  'GET /api/crisis/pool',
  'GET /api/auth/me',
  'PUT /api/auth/profile',
  'POST /api/auth/logout',
  'GET /api/auth/avatar/7',
  'GET /api/features',
  'GET /api/health',
  'GET /api/points/me',
  'GET /api/points/ledger',
  'POST /api/points/checkin',
  'GET /api/bank',
  'POST /api/bank/demand/withdraw',
  'POST /api/bank/fixed/redeem',
  'POST /api/bank/fund/redeem',
  'GET /api/stocks/portfolio',
  'POST /api/stocks/sell',
  'DELETE /api/stocks/orders/12',
  'GET /api/pets/raid/storage',
  'POST /api/pets/raid/storage/recycle',
  'POST /api/pets/raid/storage/recycle-all',
  'POST /api/pets/raid/storage/deposit-all',
  'GET /api/pets/raid/shop',
  'POST /api/pets/raid/shop/buy',
  'POST /api/pets/raid/gear/open-cache',
]
for (const entry of EXEMPT_POSITIVE) {
  const [method, path] = entry.split(' ')
  assert(isCrisisExempt(path as string), `豁免应放行 ${method} ${path}（筹钱 / 查账 / 税单本身）`)
}

const BLOCKED_PATHS = [
  // 对局与对战：封锁期间不许打（否则等于一边欠费一边继续挣分）
  '/api/pets/raid',
  '/api/pets/raid/start',
  '/api/pets/raid/events',
  '/api/pets/raid/abandon',
  '/api/pets/raid/squad/invite',
  '/api/pets/raid/contracts/daily_1/claim',
  '/api/pets/raid/gear/equip',
  '/api/pets/raid/gear/repair',
  // 宠物本体 / 对战 / 交易行
  '/api/pets',
  '/api/pets/summon',
  '/api/pets/gear',
  '/api/pets/battle/invite',
  '/api/pets/market',
  '/api/pets/overview',
  // 挣分入口与其余全部功能
  '/api/games/2048/matches/1/moves',
  '/api/games/doudizhu/matches/1/actions',
  '/api/game-stats/result',
  '/api/game-stats/leaderboard',
  '/api/farm/harvest-all',
  '/api/farm/steal',
  '/api/lottery/draw',
  '/api/chat/xmpp/bootstrap',
  '/api/chat/friends',
  '/api/drive/files',
  '/api/drive/upload',
  '/api/posts',
  '/api/pages/featured',
  '/api/comments',
  '/api/ai/chat',
  '/api/ai-chat/messages',
  '/api/reader/books',
  '/api/music/search',
  '/api/users',
  '/api/devices',
  '/api/stats',
  '/api/admin/points',
  '/api/oauth/authorize',
  '/api/personal-space',
  '/api/announcements',
  '/api',
]
for (const path of BLOCKED_PATHS) {
  assert(!isCrisisExempt(path), `未列入豁免表必须封锁：${path}`)
}

/* —— 末尾斜杠与 GET /api/pets/raid/gear 这类兄弟路径的边界 —— */
assert(isCrisisExempt('/api/crisis/me/'), '末尾斜杠与不带斜杠同等处理')
assert(isCrisisExempt('/api/pets/raid/storage/'), '挂载在子路径的 router 拼接后带尾斜杠也要放行')
assert(!isCrisisExempt('/api/'), '自描述端点不算豁免')
assert(!isCrisisExempt('/api/pets/raid/gear'), '开箱豁免不能扩到整个 gear 子树')
assert(!isCrisisExempt('/api/pets/raid/storageshit'), '正则必须按段匹配，不能被拼接绕过')
assert(!isCrisisExempt('/api/crisisevil'), '前缀相似路径不得误放行')
assert(isCrisisExempt('/api/points'), '积分根路径本身放行')
assert(!isCrisisExempt('/'), '非 /api 路径不在豁免表内（守卫本来就只挂 /api，固定这个边界）')
assert(CRISIS_EXEMPT_RULES.length >= 12, '豁免规则数量下限（防止有人手滑删掉整段）')
assert(
  CRISIS_EXEMPT_RULES.every((rule) => rule.pattern.source.startsWith('^')),
  '每条豁免正则都必须锚定开头，避免中间匹配放大暴露面',
)

/* ============================================================
   9. 官方贷款与每日分红（纯函数口径）
   ============================================================ */

/* —— 官方贷款常量与利率 —— */
assertEqual(OFFICIAL_LOAN_MIN, 100, '官方贷款单笔下限 100')
assertEqual(OFFICIAL_LOAN_MAX, 20_000, '官方贷款单笔上限 20000')
assertEqual(OFFICIAL_LOAN_DUE_DAYS, 30, '官方贷款期限 30 天')
assertEqual(OFFICIAL_RATE_PREMIUM_PCT, 5, '官方利率溢价 5%')
assert(OFFICIAL_LOAN_MIN > 0 && OFFICIAL_LOAN_MAX > OFFICIAL_LOAN_MIN, '贷款额度区间有效')
assertEqual(officialLoanRateOf(0), 5, '民间利率全 0 时官方利率退化为纯溢价')
assertEqual(officialLoanRateOf(3), 8, '基准 3% + 溢价 5% = 8%')
assertEqual(officialLoanRateOf(7.9), 12, '基准先取整再加溢价（7.9 → 7 + 5）')
assertEqual(officialLoanRateOf(-2), 5, '负基准按 0 处理，绝不出现低于溢价的官方利率')
assertEqual(officialLoanRateOf(Number.NaN), 5, 'NaN 基准按 0 处理')
assertEqual(officialLoanRateOf(50), 55, '高基准照常加溢价（服务层没有上限钳制，管理员把民间利率调多高官方就多高）')

/* —— 全站最差民间利率 —— */
assertEqual(officialLoanBaseRateOf([]), 0, '空档位表回退 0')
assertEqual(officialLoanBaseRateOf([0, 0, 0]), 0, '全 0 档位表回退 0（全站免息 → 官方利率只剩溢价）')
assertEqual(officialLoanBaseRateOf([0, 5, 4, 3]), 5, '取非 0 值的最大值（等级 0 的 0 不参与）')
assertEqual(officialLoanBaseRateOf([3, 4]), 4, '最差利率 = 最大值')
assertEqual(officialLoanBaseRateOf([10]), 10, '单档取该档')
assertEqual(officialLoanBaseRateOf([0, -2, 7]), 7, '负利率是脏数据，不计入最差利率')
assertEqual(officialLoanBaseRateOf([Number.NaN, 2]), 2, 'NaN 档位忽略')
assertEqual(officialLoanBaseRateOf([Number.POSITIVE_INFINITY]), 0, '无穷档位忽略（脏配置不放贷）')
assertEqual(
  officialLoanRateOf(officialLoanBaseRateOf(COMPANY_LOAN_RATE_PCT)),
  10,
  '默认公司档位利率 [0,5,4,3] → 官方利率 10%（最差民间 5% + 溢价 5%）',
)
assertEqual(
  officialLoanRateOf(officialLoanBaseRateOf([0, 5, 4, 3].map((rate) => rate * 2))),
  15,
  '档位整体翻倍时官方利率同步抬升（10% + 溢价 5%）',
)

/* —— 每日分红：确定性 / 区间 / 抽取额 —— */
assertEqual(DIVIDEND_PCT_MIN, 5, '分红比例下限 5%')
assertEqual(DIVIDEND_PCT_MAX, 15, '分红比例上限 15%')
assert(DIVIDEND_PCT_MIN < DIVIDEND_PCT_MAX, '分红比例区间有效')
assertEqual(dividendPctOf('2026-11-07'), dividendPctOf('2026-11-07'), '同 dateKey 结果恒定（当日任何时刻读到同一比例）')
assertEqual(
  dividendPctOf('2026-11-07'),
  dividendPctOf('2026-11-07'),
  '重复调用仍一致（纯函数，重放不会改变当天比例）',
)

let dividendInRange = true
let dividendDeterministic = true
for (let offset = 0; offset < 2000; offset += 1) {
  const dateKey = new Date(Date.UTC(2026, 0, 1) + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const first = dividendPctOf(dateKey)
  if (!(first >= DIVIDEND_PCT_MIN && first <= DIVIDEND_PCT_MAX)) dividendInRange = false
  if (first !== dividendPctOf(dateKey)) dividendDeterministic = false
}
assert(dividendInRange, `2000 天的分红比例全部落在 [${DIVIDEND_PCT_MIN}, ${DIVIDEND_PCT_MAX}]（连续值，含边界）`)
assert(dividendDeterministic, '分红比例对同一 dateKey 确定性（2000 天抽查）')

assertEqual(dividendDrawOf(0, 10), 0, '空池抽 0')
assertEqual(dividendDrawOf(-500, 10), 0, '负池（脏数据）抽 0，绝不为负')
assertEqual(dividendDrawOf(100, 0.4), 0, '比例 × 池子不足 1 分时 floor 归 0（触发「人均不足 1 分跳过」的前提）')
assertEqual(dividendDrawOf(1000, 10), 100, '1000 池 × 10% = 100')
assertEqual(dividendDrawOf(999, 12.345), 123, '向下取整（123.3255 → 123）')
assertEqual(dividendDrawOf(10_000, 5), 500, '下限比例 5%')
assertEqual(dividendDrawOf(10_000, 15), 1500, '上限比例 15%')
assertEqual(dividendDrawOf(1000, Number.NaN), 0, 'NaN 比例抽 0')
assertEqual(dividendDrawOf(Number.NaN, 10), 0, 'NaN 池子抽 0')
assert(
  dividendDrawOf(100_000, dividendPctOf('2026-11-07')) >= dividendDrawOf(100_000, DIVIDEND_PCT_MIN) &&
    dividendDrawOf(100_000, dividendPctOf('2026-11-07')) <= dividendDrawOf(100_000, DIVIDEND_PCT_MAX),
  '抽取额与比例同向：确定性比例算出的抽取额必在 5%–15% 的抽取额之间',
)

/* —— normalizeCrisisRules 对 dividendEnabled 的缺省 / 透传 —— */
assert(CRISIS_DEFAULTS.dividendEnabled === true, '每日分红默认开启')
assertEqual(normalizeCrisisRules(undefined).dividendEnabled, true, 'undefined 归一化后分红默认开启')
assertEqual(normalizeCrisisRules({}).dividendEnabled, true, '缺字段回默认开启（深合并语义）')
assertEqual(normalizeCrisisRules({ dividendEnabled: false }).dividendEnabled, false, '显式 false 被保留')
assertEqual(normalizeCrisisRules({ dividendEnabled: 1 }).dividendEnabled, true, '布尔化：1 → true（与 enabled 同口径）')
assertEqual(normalizeCrisisRules({ dividendEnabled: 0 }).dividendEnabled, false, '布尔化：0 → false')
assertEqual(normalizeCrisisRules({ dividendEnabled: 'x' }).dividendEnabled, true, '布尔化：真值字符串 → true')
assertEqual(
  normalizeCrisisRules({ enabled: false, dividendEnabled: false }).dividendEnabled,
  false,
  '与危机总开关互相独立（关危机不等于关分红，两者各自成开关）',
)
assertEqual(RULES.dividendEnabled, true, '本脚本基准 RULES（全套默认值）分红开启')

console.log(`✅ Lineweb 危机纯函数自检通过：${passed} 个断言`)
