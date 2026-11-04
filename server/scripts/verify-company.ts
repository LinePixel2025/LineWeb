/**
 * 公司（成员 / 货栈 / 资金池 / 放贷 / 危机减免）纯函数自检（不依赖数据库 / 网络）。
 *
 * 覆盖：成员下限与上限、创立期 7 天的时界数学、三档营业额阈值与 tierMask 单调性、
 *       等级→借款上限/利率、computeLoanDue 的取整精确性、定价带宽的两端边界、
 *       按稀有度的单条捐入上限与每日补货上限算术、normalizeCompanyConfig 的深合并与钳制
 *       （0 与缺省键不能被默认值吞掉）、DTO 与入参清洗（名称长度、emoji 兜底）。
 *
 * 用法: cd server && npx tsx scripts/verify-company.ts（或 npm run verify:company）
 */

import {
  COMPANY_DONATION_CAPS,
  COMPANY_LIMITS,
  COMPANY_LISTING_SOURCE_RAID,
  COMPANY_LISTING_SOURCE_SEED,
  COMPANY_LOAN_CAPS,
  COMPANY_LOAN_DUE_DAYS,
  COMPANY_LOAN_RATE_PCT,
  COMPANY_MAX_MEMBERS,
  COMPANY_MIN_MEMBERS,
  COMPANY_PAGE_SIZE_MAX,
  COMPANY_RARITIES,
  COMPANY_REVENUE_TIERS,
  COMPANY_RESTOCK_CAPS,
  COMPANY_SEED_RARITY_BUCKET,
  buildLoanDto,
  companyLevelOf,
  companyTierMaskForRevenue,
  companyTierProgress,
  computeLoanDue,
  crossedTiers,
  donationCapOf,
  donationRarityOf,
  foundingExpiresAtOf,
  foundingRemainingMs,
  isCompanyListingSource,
  isFoundingExpired,
  isLoanUnsettled,
  isMarketSort,
  isPriceInBand,
  isTierReached,
  loanCapForLevel,
  loanCapFromConfig,
  loanDueAtOf,
  loanRateForLevel,
  loanRateFromConfig,
  loanRemaining,
  normalizeCompanyName,
  normalizeCompanyConfig,
  normalizePageQuery,
  priceBandMessage,
  priceBandOf,
  rarityWeight,
  resolveCatalog,
  restockAllows,
  restockCapOf,
  sanitizeEmoji,
  sanitizeItemName,
  shouldActivateCompany,
  tierBitOf,
  validateBorrowAmount,
  validateCompanyName,
} from '../src/lib/companyRules.js'
import { RAID_ITEMS, raidSellPrice } from '../src/lib/raidRun.js'
import { FARM_CROPS } from '../src/lib/farmCrops.js'

let passed = 0

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(`断言失败：${message}`)
  passed += 1
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`断言失败：${message}（期望 ${String(expected)}，实际 ${String(actual)}）`)
  }
  passed += 1
}

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/* ============================================================
   1. 成员数与创立期时界
   ============================================================ */

assertEqual(COMPANY_MIN_MEMBERS, 3, '创建公司需要 3 名成员（发起人 + 2 位受邀好友）')
assertEqual(COMPANY_MAX_MEMBERS, 7, '成员上限 7 人')
assert(COMPANY_MIN_MEMBERS < COMPANY_MAX_MEMBERS, '下限必须小于上限')
assert(!shouldActivateCompany(2), '2 个人还不该转 active')
assert(shouldActivateCompany(3), '3 个人就该转 active')
assert(shouldActivateCompany(7), '7 个人当然算满员')

const start = Date.UTC(2026, 10, 4, 12, 0, 0)
const expires = foundingExpiresAtOf(start)
assertEqual(expires - start, 7 * DAY, '创立期有效期恰好 7 天')
assert(!isFoundingExpired(expires, start), '发起那一刻不该判过期')
assert(!isFoundingExpired(expires, expires - 1), '截止前 1 毫秒仍算有效')
assert(isFoundingExpired(expires, expires), '恰好到点按已过期处理（与红包 settle 的 lte 口径一致）')
assert(isFoundingExpired(expires, expires + 1), '过点即过期')
assert(!isFoundingExpired(null, expires + DAY), '没有截止时刻（已 active）一律判未过期')
assertEqual(foundingRemainingMs(expires, start), 7 * DAY, '剩余时间 = 截止 − 现在')
assertEqual(foundingRemainingMs(expires, expires + DAY), 0, '过期后剩余时间归零，不出现负数')
assertEqual(foundingRemainingMs(null, start), 0, '没有截止时刻时剩余时间 0')

/* ============================================================
   2. 营业额三档阈值与 tierMask 单调性
   ============================================================ */

assertEqual(COMPANY_REVENUE_TIERS.length, 3, '减免恰好三档')
assertEqual(COMPANY_REVENUE_TIERS[0].threshold, 10_000, '第一档：营业额 1 万')
assertEqual(COMPANY_REVENUE_TIERS[0].reductionPct, 10, '第一档减免 10%')
assertEqual(COMPANY_REVENUE_TIERS[1].threshold, 50_000, '第二档：营业额 5 万')
assertEqual(COMPANY_REVENUE_TIERS[1].reductionPct, 25, '第二档减免 25%')
assertEqual(COMPANY_REVENUE_TIERS[2].threshold, 200_000, '第三档：营业额 20 万')
assertEqual(COMPANY_REVENUE_TIERS[2].reductionPct, 50, '第三档减免 50%')
for (let i = 1; i < COMPANY_REVENUE_TIERS.length; i += 1) {
  assert(COMPANY_REVENUE_TIERS[i].threshold > COMPANY_REVENUE_TIERS[i - 1].threshold, `第 ${i + 1} 档阈值必须高于前一档`)
  assert(COMPANY_REVENUE_TIERS[i].reductionPct > COMPANY_REVENUE_TIERS[i - 1].reductionPct, `第 ${i + 1} 档减免必须高于前一档`)
  assert(tierBitOf(COMPANY_REVENUE_TIERS[i].tier) !== tierBitOf(COMPANY_REVENUE_TIERS[i - 1].tier), '每档占独立比特位')
}
assertEqual(tierBitOf(1), 0b001, 'bit0 = 第一档')
assertEqual(tierBitOf(2), 0b010, 'bit1 = 第二档')
assertEqual(tierBitOf(3), 0b100, 'bit2 = 第三档')
assertEqual(tierBitOf(0), 0, '非法档位不占位')
assertEqual(tierBitOf(4), 0, '超出档数不占位')
assertEqual(companyTierMaskForRevenue(-5), 0, '脏营业额按 0 处理')
assertEqual(companyTierMaskForRevenue(0), 0, '零营业额没有档位')
assertEqual(companyTierMaskForRevenue(9_999), 0, '差 1 分不到位，不发减免')
assertEqual(companyTierMaskForRevenue(10_000), 0b001, '满 1 万 → bit0')
assertEqual(companyTierMaskForRevenue(49_999), 0b001, '4.99 万仍只有 bit0')
assertEqual(companyTierMaskForRevenue(50_000), 0b011, '满 5 万 → bit0 + bit1')
assertEqual(companyTierMaskForRevenue(199_999), 0b011, '19.99 万只有前两档')
assertEqual(companyTierMaskForRevenue(200_000), 0b111, '满 20 万 → 三档全亮')
assertEqual(companyTierMaskForRevenue(9_999_999), 0b111, '封顶不再叠加')

// 单调性：营业额上升时掩码只能是「只增不减」的超集；跨高位必然已含低位
let prevMask = 0
for (let revenue = 0; revenue <= 260_000; revenue += 137) {
  const mask = companyTierMaskForRevenue(revenue)
  assert((mask & prevMask) === prevMask, `掩码必须单调递增（营业额 ${revenue}）`)
  assert((mask & companyTierMaskForRevenue(Math.max(0, revenue - 137))) === companyTierMaskForRevenue(Math.max(0, revenue - 137)), '掩码差集只会新增')
  if ((mask & 0b010) !== 0) assert((mask & 0b001) !== 0, '跨过 5 万时 bit0 必须已经置位（否则减免会被重复发）')
  if ((mask & 0b100) !== 0) assert((mask & 0b011) === 0b011, '跨过 20 万时前两档必须都已置位')
  prevMask = mask
}
assertEqual(crossedTiers(0, 0b001).join(','), '1', '首次跨过只发第 1 档')
assertEqual(crossedTiers(0b001, 0b011).join(','), '2', '从 1 万到 5 万只补发第 2 档')
assertEqual(crossedTiers(0, 0b111).join(','), '1,2,3', '一次冲顶按顺序发三档')
assertEqual(crossedTiers(0b111, 0b111).length, 0, '掩码没变就一枚都不发（幂等）')
assertEqual(crossedTiers(0b111, 0b001).length, 0, '掩码回退（脏数据）也不发，绝不重复吃减免')
assertEqual(crossedTiers(0b010, 0b011).join(','), '1', '差集里只有新置的位')
assert(isTierReached(0b101, 1) && isTierReached(0b101, 3) && !isTierReached(0b101, 2), '按位判定档位')
assertEqual(companyLevelOf(0), 0, '没有档位 → 等级 0')
assertEqual(companyLevelOf(0b001), 1, '一档 → 等级 1')
assertEqual(companyLevelOf(0b011), 2, '两档 → 等级 2')
assertEqual(companyLevelOf(0b111), 3, '三档 → 等级 3')
assertEqual(companyLevelOf(0b1111), 3, '脏掩码里多余的高位不算等级')
assert(!isCompanyListingSource('pet_item') && isCompanyListingSource('farm_seed') && isCompanyListingSource('raid_item'), '来源白名单')

const progress = companyTierProgress(12_000, companyTierMaskForRevenue(12_000))
assertEqual(progress.level, 1, '1.2 万营业额是等级 1')
assertEqual(progress.reductionPct, 10, '等级 1 展示 10% 减免')
assertEqual(progress.next?.tier, 2, '下一档是第 2 档')
assertEqual(progress.next?.threshold, 50_000, '下一档阈值 5 万')
assertEqual(progress.next?.remaining, 38_000, '距下一档还差 3.8 万')
const maxed = companyTierProgress(300_000, companyTierMaskForRevenue(300_000))
assertEqual(maxed.next, null, '满级没有下一档')
assertEqual(maxed.reductionPct, 50, '满级展示 50%')
assertEqual(companyTierProgress(0, 0).reductionPct, 0, '零营业额没有减免')

/* ============================================================
   3. 等级 → 借款上限 / 利率 / 期限
   ============================================================ */

assertEqual(COMPANY_LOAN_CAPS.length, 4, '借款上限表按等级 0–3')
assertEqual(COMPANY_LOAN_CAPS[0], 0, '等级 0 的额度是 0（成立即借不到，不需要额外分支）')
assertEqual(COMPANY_LOAN_CAPS[1], 500, '等级 1 上限 500')
assertEqual(COMPANY_LOAN_CAPS[2], 2000, '等级 2 上限 2000')
assertEqual(COMPANY_LOAN_CAPS[3], 8000, '等级 3 上限 8000')
assertEqual(COMPANY_LOAN_RATE_PCT[0], 0, '等级 0 利率 0')
assertEqual(COMPANY_LOAN_RATE_PCT[1], 5, '等级 1 利率 5%')
assertEqual(COMPANY_LOAN_RATE_PCT[2], 4, '等级 2 利率 4%')
assertEqual(COMPANY_LOAN_RATE_PCT[3], 3, '等级 3 利率 3%')
assertEqual(COMPANY_LOAN_CAPS.length, COMPANY_LOAN_RATE_PCT.length, '两张表长度一致（同一下标语义）')
for (let i = 1; i < COMPANY_LOAN_CAPS.length; i += 1) {
  assert(COMPANY_LOAN_CAPS[i] > COMPANY_LOAN_CAPS[i - 1], '等级越高额度越大')
  // 等级 0 的利率是 0 的占位值（该档额度也是 0，借不出来），从等级 1 起才要求递减
  if (i >= 2) {
    assert(COMPANY_LOAN_RATE_PCT[i] < COMPANY_LOAN_RATE_PCT[i - 1], '等级越高利率越低（把货栈做大的实际回报）')
  }
}
assertEqual(loanCapForLevel(-3), 0, '脏等级按 0 处理')
assertEqual(loanCapForLevel(99), 8000, '超出表长夹到最后一档')
assertEqual(loanRateForLevel(2), 4, '等级 2 利率取到 4%')
assertEqual(COMPANY_LOAN_DUE_DAYS, 7, '借款期限 7 天')

const cfg = normalizeCompanyConfig(null)
assertEqual(loanCapFromConfig(cfg, 0), 0, '配置口径的等级 0 额度也是 0')
assertEqual(loanCapFromConfig(cfg, 2), 2000, '配置口径与常量表一致')
assertEqual(loanRateFromConfig(cfg, 3), 3, '配置口径的利率与常量表一致')
// 管理员把某档上限设成 0 必须生效（这正是历史上被 `|| 默认值` 吞掉的那类 bug）
const zeroed = normalizeCompanyConfig({ loanTierCaps: [0, 0, 0, 0] })
assertEqual(loanCapFromConfig(zeroed, 2), 0, '管理员全档设为 0 时必须真的是 0')
assertEqual(loanRateFromConfig(normalizeCompanyConfig({ loanRatePct: [0, 0, 0, 0] }), 1), 0, '利率设 0（免息）必须保留')

/* ============================================================
   4. computeLoanDue 精确性与取整
   ============================================================ */

assertEqual(computeLoanDue(1000, 5), 1050, '1000 × 5% → 应还 1050')
assertEqual(computeLoanDue(2000, 4), 2080, '2000 × 4% → 应还 2080')
assertEqual(computeLoanDue(8000, 3), 8240, '8000 × 3% → 应还 8240')
assertEqual(computeLoanDue(199, 5), 208, '利息向下取整：floor(9.95) = 9')
assertEqual(computeLoanDue(333, 3), 342, '利息向下取整：floor(9.99) = 9')
assertEqual(computeLoanDue(1, 5), 1, '1 积分的 5% 不足 1 分 → 免息整数')
assertEqual(computeLoanDue(100, 0), 100, '0 利率时 dueAmount 恰等于本金')
assertEqual(computeLoanDue(-5, 5), 0, '脏本金按 0 处理')
assertEqual(computeLoanDue(1000, NaN), 1000, '脏利率退回 0 利率')
for (const principal of [1, 7, 33, 500, 1234, 7999, 100_000]) {
  for (const rate of [0, 3, 4, 5, 12]) {
    const due = computeLoanDue(principal, rate)
    assertEqual(due, principal + Math.floor((principal * rate) / 100), `应还额公式（本金 ${principal}，利率 ${rate}%）`)
    assert(due >= principal, '应还额永不低于本金')
  }
}
const borrowed = Date.UTC(2026, 10, 4)
assertEqual(loanDueAtOf(borrowed, 7), borrowed + 7 * DAY, '到期时刻 = 放款 + 7 天')
assertEqual(loanDueAtOf(borrowed, 0), borrowed + COMPANY_LOAN_DUE_DAYS * DAY, '脏期限回退默认 7 天')
assertEqual(loanDueAtOf(borrowed, -3), borrowed + COMPANY_LOAN_DUE_DAYS * DAY, '负期限回退默认')
assertEqual(loanRemaining(1050, 0), 1050, '未还时剩余 = 应还额')
assertEqual(loanRemaining(1050, 1050), 0, '还清时剩余 0')
assertEqual(loanRemaining(1050, 2000), 0, '脏的多还不出现负剩余')
assertEqual(loanRemaining(1050, -10), 1050, '脏的负还款按 0 处理')
assert(isLoanUnsettled('open', 0, 100), 'open 未还算未结清')
assert(isLoanUnsettled('overdue', 50, 100), '部分还款的逾期单仍未结清')
assert(!isLoanUnsettled('repaid', 100, 100), 'repaid 算结清')
assert(!isLoanUnsettled('overdue', 100, 100), '还满就是结清（状态由 DTO 兜底展示）')
assert(!isLoanUnsettled('open', 100, 100), '还满但未翻状态的单不再挡解散')

assertEqual(validateBorrowAmount(500, 500, 0), null, '刚好用满额度合法')
assert(validateBorrowAmount(501, 500, 0) !== null, '超出额度要拒')
assert(validateBorrowAmount(100, 500, 450) !== null, '剩余额度只有 50 时借 100 要拒')
assertEqual(validateBorrowAmount(100, 500, 400), null, '已借 400 再借 100 正好到顶')
assert(validateBorrowAmount(100, 0, 0) !== null, '等级 0 一分都借不到')
assert(validateBorrowAmount(0, 500, 0) !== null, '0 本金拒掉')
assert(validateBorrowAmount(-10, 500, 0) !== null, '负本金拒掉')
assert(validateBorrowAmount(1.5, 500, 0) !== null, '非整数拒掉')

/* ============================================================
   5. 定价带宽（两端边界都要精确）
   ============================================================ */

const band100 = priceBandOf(100, 50, 150)
assertEqual(band100?.min, 50, '参考价 100 的下界 = 50%')
assertEqual(band100?.max, 150, '参考价 100 的上界 = 150%')
assert(isPriceInBand(50, band100), '下界含端点')
assert(isPriceInBand(150, band100), '上界含端点')
assert(!isPriceInBand(49, band100), '低于下界拒绝')
assert(!isPriceInBand(151, band100), '高于上界拒绝')
assert(!isPriceInBand(100.5, band100), '非整数定价拒绝')
assert(!isPriceInBand(NaN, band100), '脏定价拒绝')
assertEqual(priceBandOf(0, 50, 150), null, '参考价为 0 没有带宽（没有锚就不能定价）')
assertEqual(priceBandOf(-8, 50, 150), null, '脏参考价同样拒绝')
assertEqual(priceBandOf(7, 50, 150)?.min, 3, '下界 floor(3.5) = 3')
assertEqual(priceBandOf(7, 50, 150)?.max, 11, '上界 ceil(10.5) = 11')
assertEqual(priceBandOf(1, 50, 150)?.min, 1, '参考价 1 时下界至少 1（不许出现 0 元货）')
// 管理员把带宽调歪（上界 < 下界）时不能算出空区间
const inverted = priceBandOf(100, 200, 50)
assert(inverted !== null && inverted.min <= inverted.max, '带宽颠倒时仍产出可用区间')
assert(typeof priceBandMessage(null) === 'string' && priceBandMessage(null).includes('参考价'), '无参考价的文案要说明原因')
assert(priceBandOf(100, 50, 150) !== null && isPriceInBand(priceBandOf(100, 50, 150)!.max, priceBandOf(100, 50, 150)), '上界自身可捐')

/* ============================================================
   6. 稀有度：单条捐入上限与每日补货上限
   ============================================================ */

assertEqual(COMPANY_RARITIES.length, 6, '稀有度 6 档')
assertEqual(COMPANY_SEED_RARITY_BUCKET, 'rare', '种子归到 rare 档计上限')
assertEqual(donationRarityOf(COMPANY_LISTING_SOURCE_SEED, 'common'), 'rare', '种子无视目录稀有度，固定按 rare')
assertEqual(donationRarityOf(COMPANY_LISTING_SOURCE_RAID, 'legendary'), 'legendary', '搜打撤物品按目录稀有度')
for (const rarity of COMPANY_RARITIES) {
  const donation = donationCapOf(rarity)
  const restock = restockCapOf(rarity)
  assert(donation >= 1, `${rarity} 单条上限至少 1 件`)
  assert(restock >= donation, `${rarity} 单日补货上限不低于单条上限（否则永远捐不满一条）`)
  assert(donation <= COMPANY_LIMITS.donationMax, `${rarity} 单条上限在可调范围内`)
  assert(restock <= COMPANY_LIMITS.restockMax, `${rarity} 单日补货上限在可调范围内`)
}
for (let i = 1; i < COMPANY_RARITIES.length; i += 1) {
  // 稀有度越高越少：一件神话不该和二十块废铁占同样的位置
  assert(COMPANY_DONATION_CAPS[COMPANY_RARITIES[i]] <= COMPANY_DONATION_CAPS[COMPANY_RARITIES[i - 1]], '单条捐入上限随稀有度递减')
  assert(COMPANY_RESTOCK_CAPS[COMPANY_RARITIES[i]] <= COMPANY_RESTOCK_CAPS[COMPANY_RARITIES[i - 1]], '每日补货上限随稀有度递减')
}

// 补货 CAS 谓词：并发两笔合计不能越过上限
const rareCap = restockCapOf('rare')
assert(restockAllows(0, rareCap, rareCap), '用满上限恰好允许')
assert(!restockAllows(0, rareCap + 1, rareCap), '单笔超上限拒绝')
assert(!restockAllows(rareCap, 1, rareCap), '已经满了再加 1 件拒绝')
assert(restockAllows(rareCap - 3, 3, rareCap), '只剩 3 件额度时恰好加 3 件')
assert(!restockAllows(rareCap - 3, 4, rareCap), '只剩 3 件额度时加 4 件拒绝')
assert(!restockAllows(0, 0, rareCap), '0 件不占额度也不该落账')
assert(restockAllows(-5, 1, rareCap), '脏的已用量按 0 处理（宁可少收也不误拒）')
// 模拟同一天两笔并发捐入：第二笔必须按第一笔之后的余额判定（服务层用 CAS 递增拿到的是新值）
let units = 0
for (const want of [80, 80]) {
  if (restockAllows(units, want, rareCap)) units += want
}
assertEqual(units, 80, 'rare 档两笔 80 件只落第一笔（合计 160 会越过 120 的上限）')
assert(restockAllows(units, rareCap - units, rareCap), '剩余 40 件额度刚好还能捐满')
assert(!restockAllows(units, rareCap - units + 1, rareCap), '再多 1 件就被挡住')

/* ============================================================
   7. 目录解析：参考价与显示快照
   ============================================================ */

const seedEntry = resolveCatalog(COMPANY_LISTING_SOURCE_SEED, 'carrot')
assert(seedEntry !== null, '胡萝卜种子在目录里')
assertEqual(seedEntry?.capRarity, 'rare', '种子按 rare 档计上限')
assertEqual(seedEntry?.referencePrice, 10, '种子参考价 = 目录种子价')
assert(seedEntry !== null && seedEntry.itemName.includes('种子'), '种子名带「种子」便于市场展示')
const raidEntry = resolveCatalog(COMPANY_LISTING_SOURCE_RAID, 'scrap_metal')
assertEqual(raidEntry?.referencePrice, raidSellPrice('scrap_metal', 1), '搜打撤参考价 = 官方回收单价')
assert(raidEntry !== null && raidEntry.referencePrice > 0, '废金属块有正参考价')
assertEqual(resolveCatalog(COMPANY_LISTING_SOURCE_RAID, 'not_a_real_item'), null, '未知物品解析失败返回 null')
assertEqual(resolveCatalog(COMPANY_LISTING_SOURCE_SEED, 'not_a_real_crop'), null, '未知作物解析失败返回 null')
for (const item of RAID_ITEMS) {
  const entry = resolveCatalog(COMPANY_LISTING_SOURCE_RAID, item.key)
  assert(entry !== null, `目录物品 ${item.key} 能被解析`)
  assert(entry !== null && entry.emoji.length > 0 && entry.itemName.length > 0, `目录物品 ${item.key} 有显示快照`)
}
for (const crop of FARM_CROPS) {
  const entry = resolveCatalog(COMPANY_LISTING_SOURCE_SEED, crop.key)
  assert(entry !== null && entry.referencePrice === crop.seedCost, `作物 ${crop.key} 参考价对齐种子价`)
}

/* ============================================================
   8. normalizeCompanyConfig：深合并 + 钳制（0 与缺省不能被默认值吞掉）
   ============================================================ */

const fresh = normalizeCompanyConfig(null)
assertEqual(fresh.priceBandMin, 50, '缺省带宽下界 50')
assertEqual(fresh.priceBandMax, 150, '缺省带宽上界 150')
assertEqual(fresh.loanDueDays, 7, '缺省期限 7 天')
assertEqual(fresh.loanTierCaps.join(','), '0,500,2000,8000', '缺省借款上限表')
assertEqual(fresh.loanRatePct.join(','), '0,5,4,3', '缺省利率表')
assertEqual(Object.keys(fresh.donationCaps).length, 6, '缺省捐入上限覆盖 6 档')
assertEqual(fresh.restockCaps.mythic, COMPANY_RESTOCK_CAPS.mythic, '缺省补货上限对齐常量')

// 只覆盖一个键，其他键必须保持原值（深合并语义）
const partial = normalizeCompanyConfig({ priceBandMax: 200 })
assertEqual(partial.priceBandMax, 200, '显式覆盖生效')
assertEqual(partial.priceBandMin, 50, '未提供的键退回默认而不是被清空')
assertEqual(partial.loanDueDays, 7, '未提供的期限保持默认')

// 0 值必须原样保留
const zeroDays = normalizeCompanyConfig({ loanDueDays: 0 })
assert(zeroDays.loanDueDays >= COMPANY_LIMITS.loanDaysMin, '期限有下界（0 天等于当天到期，钳到最小 1 天）')
const zeroCap = normalizeCompanyConfig({ loanTierCaps: [0, 0, 2000, 8000] })
assertEqual(zeroCap.loanTierCaps[1], 0, '等级 1 上限设 0 必须保留为 0（这正是 `|| 默认值` 会吞掉的值）')
assertEqual(zeroCap.loanTierCaps[0], 0, '等级 0 上限保持 0')

// 数组长度钉死：下标语义就是等级
assertEqual(normalizeCompanyConfig({ loanTierCaps: [0] }).loanTierCaps.length, 4, '短数组补齐到 4 档')
assertEqual(normalizeCompanyConfig({ loanTierCaps: [0, 1, 2, 3, 4, 5] }).loanTierCaps.length, 4, '长数组截断到 4 档')
assertEqual(normalizeCompanyConfig({ loanTierCaps: [0, 1, 2, 3, 4, 5] }).loanTierCaps[3], 3, '截断保留前 4 项')
assertEqual(normalizeCompanyConfig({ loanRatePct: 'not-an-array' }).loanRatePct.join(','), '0,5,4,3', '脏数组整体回退默认')
assertEqual(normalizeCompanyConfig({ loanTierCaps: [0, NaN, 2000, 8000] }).loanTierCaps[1], 500, '数组里的脏项回退默认')

// 钳制范围
assertEqual(normalizeCompanyConfig({ priceBandMin: -100 }).priceBandMin, COMPANY_LIMITS.bandMinFloor, '带宽下界被钳到最小值')
assertEqual(normalizeCompanyConfig({ priceBandMax: 99999 }).priceBandMax, COMPANY_LIMITS.bandMaxCeil, '带宽上界被钳到最大值')
assertEqual(normalizeCompanyConfig({ loanDueDays: 5000 }).loanDueDays, COMPANY_LIMITS.loanDaysMax, '期限被钳到最大值')
assert(normalizeCompanyConfig({ loanTierCaps: [0, 99_999_999_999, 2000, 8000] }).loanTierCaps[1] <= COMPANY_LIMITS.loanAmountMax, '借款上限被钳到最大值')
assert(normalizeCompanyConfig({ loanRatePct: [0, 90, 4, 3] }).loanRatePct[1] <= 50, '利率钳到 50% 以内（不出现高利贷）')
// 上界 < 下界时自动抬平，避免全站捐入被空带宽静默拒绝
const flipped = normalizeCompanyConfig({ priceBandMin: 100, priceBandMax: 100 })
assertEqual(flipped.priceBandMax >= flipped.priceBandMin, true, '上界不低于下界')
assert(normalizeCompanyConfig({ priceBandMin: 90, priceBandMax: 20 }).priceBandMax >= 90, '管理员写出颠倒带宽时自动抬平')

// 稀有度字典：合法键钳制、非法键忽略、脏值回退
const dictConfig = normalizeCompanyConfig({ donationCaps: { mythic: 0, common: 999_999, bogus: 5 } })
assertEqual(dictConfig.donationCaps.mythic, 1, '单条捐入上限下界为 1（0 等于该档直接禁捐，不合法）')
assertEqual(dictConfig.donationCaps.common, COMPANY_LIMITS.donationMax, '脏的大值被钳到上界')
assert(!('bogus' in dictConfig.donationCaps), '未知稀有度键被忽略')
assertEqual(dictConfig.donationCaps.rare, COMPANY_DONATION_CAPS.rare, '未提供的稀有度保持默认')
const badDict = normalizeCompanyConfig({ restockCaps: { rare: 'abc' } })
assertEqual(badDict.restockCaps.rare, COMPANY_RESTOCK_CAPS.rare, '脏值回退默认而不是夹到 0')
// normalize 的输出必须永远能算出合法带宽
for (const raw of [null, undefined, {}, { priceBandMin: 0, priceBandMax: 0 }, { priceBandMin: 10, priceBandMax: 10 }, 'garbage']) {
  const normalized = normalizeCompanyConfig(raw)
  const band = priceBandOf(100, normalized.priceBandMin, normalized.priceBandMax)
  assert(band !== null && band.min <= band.max, `归一化后的配置总能产出合法带宽（输入 ${String(raw)}）`)
}

/* ============================================================
   9. 入参与 DTO 清洗
   ============================================================ */

assertEqual(normalizeCompanyName('  星辰 工作室  '), '星辰 工作室', '首尾空白去掉、内部连续空白压成一个空格')
assertEqual(normalizeCompanyName('A\u3000\u3000B'), 'A B', '全角空格也算空白')
assertEqual(normalizeCompanyName(123 as unknown), '', '非字符串输入返回空')
assertEqual(normalizeCompanyName('合法有限公司有限公司有限').length, 12, '恰好 12 字')
assertEqual(validateCompanyName('有'), '公司名至少 2 个字符', '1 字拒绝')
assertEqual(validateCompanyName(''), '公司名至少 2 个字符', '空名拒绝')
assert(validateCompanyName('一二三四五六七八九十一二三') !== null, '13 字拒绝')
assertEqual(validateCompanyName('有限公司'), null, '4 字合法')
assert(validateCompanyName('····') !== null, '只含符号的名字拒绝')
assertEqual(validateCompanyName('LW 公司'), null, '中英混合合法')
assert(validateCompanyName(normalizeCompanyName('  a  ')) !== null, '清洗后再校验：1 字仍然拒绝')
assertEqual(sanitizeEmoji(undefined), '📦', '缺 emoji 兜底 📦')
assertEqual(sanitizeEmoji('   '), '📦', '纯空白 emoji 兜底 📦')
assertEqual(sanitizeEmoji('🪐'), '🪐', '单字符 emoji 原样保留')
assertEqual([...sanitizeEmoji('abcdefghij')].length, 4, '超长 emoji 截到 4 个字符')
assertEqual(sanitizeItemName('  废金属块  ', '兜底'), '废金属块', '物品名去空白')
assertEqual(sanitizeItemName(null, '兜底名'), '兜底名', '脏物品名走兜底')
assertEqual(sanitizeItemName('', '兜底名'), '兜底名', '空物品名走兜底')
assertEqual([...sanitizeItemName('x'.repeat(100), '兜底')].length, 40, '超长物品名截断')

const nowMs = Date.UTC(2026, 10, 10, 0, 0, 0)
const loanDto = buildLoanDto({
  id: 7,
  companyId: 3,
  companyName: '星辰工作室',
  principal: 1000,
  dueAmount: computeLoanDue(1000, 5),
  repaid: 0,
  ratePct: 5,
  dueDays: 7,
  status: 'open',
  borrowedAtMs: nowMs,
  dueAtMs: nowMs + 7 * DAY,
  nowMs,
})
assertEqual(loanDto.remaining, 1050, 'DTO 带剩余应还')
assertEqual(loanDto.status, 'open', '未到期显示 open')
assert(loanDto.msUntilDue === 7 * DAY && loanDto.overdueMs === 0, 'DTO 倒计时按到期时刻')
const lateDto = buildLoanDto({ ...loanDtoInputOf(loanDto), dueAtMs: nowMs - 1000, nowMs })
assertEqual(lateDto.status, 'overdue', '逾期行还没被惰性翻过时，DTO 出口也按 overdue 展示')
assert(lateDto.overdueMs > 0 && lateDto.msUntilDue === 0, '逾期后倒计时归零、逾期时长为正')
const paidDto = buildLoanDto({ ...loanDtoInputOf(loanDto), repaid: 1050, nowMs: nowMs + 30 * DAY })
assertEqual(paidDto.remaining, 0, '还清后剩余 0')
assertEqual(paidDto.status, 'open', '已结清不再被兜底翻成 overdue')
assert(paidDto.overdueMs === 0, '已结清不显示逾期时长')
assert(typeof loanDto.borrowedAt === 'string' && loanDto.borrowedAt.endsWith('Z'), 'DTO 时间是 ISO 字符串')
// DTO 不允许出现负数字段（前端拿到的每个金额都是纯数字）
for (const key of ['principal', 'dueAmount', 'repaid', 'remaining', 'msUntilDue', 'overdueMs'] as const) {
  assert(loanDto[key] >= 0 && Number.isFinite(loanDto[key]), `DTO 字段 ${key} 非负且有限`)
}

/* ============================================================
   10. 分页与市场排序
   ============================================================ */

const page = normalizePageQuery(undefined, undefined)
assertEqual(page.page, 1, '缺省第 1 页')
assertEqual(page.pageSize, 20, '缺省每页 20 条')
assertEqual(normalizePageQuery('3', '10').page, 3, '字符串数字被接住')
assertEqual(normalizePageQuery(-5, 999).page, 1, '非法页码夹回 1')
assertEqual(normalizePageQuery(2, 999).pageSize, COMPANY_PAGE_SIZE_MAX, '每页条数封顶')
assertEqual(normalizePageQuery(NaN, NaN).pageSize, 20, '脏参数回退默认')
assert(isMarketSort('price_asc') && isMarketSort('rarity') && !isMarketSort('hot'), '排序白名单')
assert(rarityWeight('mythic') > rarityWeight('legendary') && rarityWeight('common') === 0, '稀有度权重单调')
assert(rarityWeight('bogus') > rarityWeight('mythic'), '未知稀有度排最后，不插到队首')

/* ============================================================
   11. 关键不变量汇总
   ============================================================ */

assert(loanCapForLevel(1) > 0, '跨过第一档（营业额 1 万）后立刻有借款额度，等级 0 才是 0')
assert(COMPANY_LOAN_CAPS[3] > COMPANY_LOAN_CAPS[0], '顶档额度高于起步档（等级确实带来更大额度）')
assert(COMPANY_REVENUE_TIERS.every((entry) => entry.reductionPct > 0 && entry.reductionPct <= 100), '减免百分比落在 0–100 之间')
assert(COMPANY_RARITIES.every((rarity) => COMPANY_DONATION_CAPS[rarity] > 0), '每档都有非零捐入上限')
assert(COMPANY_RARITIES.every((rarity) => COMPANY_RESTOCK_CAPS[rarity] > 0), '每档都有非零补货上限')

function loanDtoInputOf(dto: typeof loanDto) {
  return {
    id: dto.id,
    companyId: dto.companyId,
    companyName: dto.companyName,
    principal: dto.principal,
    dueAmount: dto.dueAmount,
    repaid: dto.repaid,
    ratePct: dto.ratePct,
    dueDays: dto.dueDays,
    status: dto.status,
    borrowedAtMs: Date.parse(dto.borrowedAt),
    dueAtMs: Date.parse(dto.dueAt),
  }
}

console.log(`✅ verify-company：${passed} 条断言全部通过`)
