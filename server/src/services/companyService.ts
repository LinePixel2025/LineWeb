/**
 * 公司服务：创建与成员、货栈捐入/下架、市场成交、资金池放贷、解散清算。
 *
 * 判定与算式全部在 lib/companyRules.ts（纯函数、可自检），本文件只做数据库编排。
 *
 * 三条必须守住的实现口径：
 * 1. **托管即物理扣除**：捐入时真的从捐入者的搜打撤仓库 / 农场种子里减掉，
 *    下架只退回「未售出」的那部分（amount − soldAmount），沿用 farmSeedMarketService 的做法；
 * 2. **一切并发都靠 CAS**：超卖（soldAmount 上界）、当日补货（units 上界）、
 *    资金池偿付能力（poolBalance gte 本金）、抬档（tierMask 等值）全部走条件更新，
 *    绝不 read-modify-write；抢不到行就抛错，整个事务回滚（托管原样退回）；
 * 3. **无定时器**：founding 作废、贷款逾期翻转都是惰性结算（与危机 / 银行 / 宠物 / 红包同一口径），
 *    所以任何读写入口的第一步都是 settle*，任何读公司状态前先 voidFoundingIfNeeded。
 *
 * 解散口径（重要，schema 里 CompanyLoan.company 是 Cascade）：
 * 解散会连带删除贷款行、把债务静默抹掉，因此**只要还有未结清的贷款就一律禁止解散**，
 * 不做「强制收回」也不做「坏账核销」——管理员端点同样受这条约束。
 */

import prisma from '../lib/prisma.js'
import type { CompanyListing, Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import { storageLevelInfo } from '../lib/raidStorage.js'
import { ensureRaidStorageTx } from './raidCommon.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'
import { listFriends } from './chatService.js'
// 危机侧提供：公司跨过新档位后把减免发给全体成员（CrisisWaiver 的 [userId,tier] 唯一键保证幂等）。
import { applyCompanyWaiversForCompany } from './crisisService.js'
import {
  COMPANY_LIMITS,
  COMPANY_LISTING_SOURCE_RAID,
  COMPANY_LISTING_SOURCE_SEED,
  COMPANY_MAX_MEMBERS,
  COMPANY_MIN_MEMBERS,
  COMPANY_RARITIES,
  COMPANY_RARITY_LABELS,
  COMPANY_REVENUE_TIERS,
  COMPANY_STATUS_ACTIVE,
  COMPANY_STATUS_DISBANDED,
  COMPANY_STATUS_FOUNDING,
  buildLoanDto,
  companyLevelOf,
  companyTierProgress,
  companyTierMaskForRevenue,
  computeLoanDue,
  crossedTiers,
  donationCapOf,
  foundingExpiresAtOf,
  foundingRemainingMs,
  isCompanyListingSource,
  isFoundingExpired,
  isLoanUnsettled,
  isMarketSort,
  isPriceInBand,
  loanCapFromConfig,
  loanDueAtOf,
  loanRateFromConfig,
  loanRemaining,
  normalizeCompanyName,
  normalizeCompanyConfig,
  normalizePageQuery,
  priceBandMessage,
  priceBandOf,
  rarityWeight,
  resolveCatalog,
  restockCapOf,
  shouldActivateCompany,
  validateCompanyName,
  type CompanyConfig as CompanyConfigValues,
  type CompanyLoanDto,
  type CompanyListingSource,
  type PriceBand,
} from '../lib/companyRules.js'

type Db = Prisma.TransactionClient
const userSelect = { id: true, username: true } as const

type CompanyRow = Prisma.CompanyGetPayload<{ include: { owner: { select: typeof userSelect } } }>
type ListingRow = CompanyListing & {
  company: { name: string; status: string }
  donor: { id: number; username: string }
}

/* ============================================================
   参数（单行 JSON：读旧 → 深合并 → normalize → 保存）
   ============================================================ */

/** 每个写操作都要问一次上限，不能每次都查库（与 getCrisisRules / featureService 同一口径） */
const CONFIG_CACHE_MS = 5000
let configCache: { config: CompanyConfigValues; at: number } | null = null

export async function getCompanyConfig(force = false): Promise<CompanyConfigValues> {
  if (!force && configCache && Date.now() - configCache.at < CONFIG_CACHE_MS) return configCache.config
  let config: CompanyConfigValues | null = null
  try {
    const row = await prisma.companyConfig.findUnique({ where: { id: 1 } })
    if (row?.config) config = normalizeCompanyConfig(JSON.parse(row.config))
  } catch (err) {
    console.warn('[company] 读取公司参数失败，按默认值处理：', err instanceof Error ? err.message : err)
  }
  if (!config) {
    // 库里脏到 normalize 都拿不出值时兜底为「归一化后的默认值」，保证下游拿到的永远是合法配置
    config = normalizeCompanyConfig(null)
  }
  configCache = { config, at: Date.now() }
  return config
}

export async function saveCompanyConfig(raw: unknown, updatedBy: number): Promise<CompanyConfigValues> {
  const existing = await prisma.companyConfig.findUnique({ where: { id: 1 } })
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
  const config = normalizeCompanyConfig(merged)
  const payload = JSON.stringify(config)
  await prisma.companyConfig.upsert({
    where: { id: 1 },
    create: { id: 1, config: payload, updatedBy },
    update: { config: payload, updatedBy },
  })
  configCache = { config, at: Date.now() }
  return config
}

/** 管理页要的可调范围与固定阈值：前端不复制数值，只渲染这份下发 */
export function companyConfigShape() {
  return {
    limits: COMPANY_LIMITS,
    rarities: COMPANY_RARITIES.map((rarity) => ({ key: rarity, label: COMPANY_RARITY_LABELS[rarity] })),
    revenueTiers: COMPANY_REVENUE_TIERS,
    minMembers: COMPANY_MIN_MEMBERS,
    maxMembers: COMPANY_MAX_MEMBERS,
  }
}

/* ============================================================
   DTO
   ============================================================ */

export interface CompanyUserDto {
  id: number
  username: string
}

export interface CompanyMemberDto extends CompanyUserDto {
  role: string
  joinedAt: string
  isMe: boolean
  /** 该成员在本公司仍未结清的本金（被踢/退司后照样有效，所以按贷款表统计） */
  outstanding: number
}

export interface CompanyDto {
  id: number
  name: string
  status: string
  owner: CompanyUserDto
  level: number
  tierMask: number
  poolBalance: number
  revenue: number
  memberCount: number
  maxMembers: number
  foundingExpiresAt: string | null
  foundingRemainingMs: number
  createdAt: string
  tier: ReturnType<typeof companyTierProgress>
  members: CompanyMemberDto[]
}

export interface CompanyListingDto {
  id: number
  companyId: number
  companyName: string
  companyStatus: string
  source: string
  itemKey: string
  itemName: string
  emoji: string
  rarity: string
  rarityLabel: string
  unitPrice: number
  amount: number
  soldAmount: number
  available: number
  status: string
  donor: CompanyUserDto
  isMine: boolean
  createdAt: string
}

export interface CompanyOrderDto {
  id: number
  companyId: number
  companyName: string
  buyer: CompanyUserDto
  itemName: string
  amount: number
  unitPrice: number
  total: number
  createdAt: string
}

export interface CompanyInviteDto {
  id: number
  companyId: number
  companyName: string
  target: CompanyUserDto
  inviter: CompanyUserDto
  status: string
  createdAt: string
}

export interface CompanyDonateOptionDto {
  source: CompanyListingSource
  itemKey: string
  itemName: string
  emoji: string
  rarity: string
  rarityLabel: string
  capRarity: string
  owned: number
  referencePrice: number
  band: PriceBand | null
  /** 单条捐入上限 / 每日补货上限 / 今日剩余：把规则直接摆到对话框，不让用户试错 */
  donationCap: number
  restockCap: number
  restockLeft: number
}

export interface CompanyLoanSummaryDto {
  level: number
  cap: number
  ratePct: number
  dueDays: number
  outstanding: number
  remaining: number
  blockedByOverdue: boolean
}

export interface CompanyMeDto {
  company: CompanyDto | null
  myRole: string | null
  invitesReceived: CompanyInviteDto[]
  invitesSent: CompanyInviteDto[]
  listings: CompanyListingDto[]
  myDonations: CompanyListingDto[]
  loans: CompanyLoanDto[]
  loanSummary: CompanyLoanSummaryDto | null
  donateOptions: CompanyDonateOptionDto[]
  rules: CompanyConfigValues
  limits: { minMembers: number; maxMembers: number }
}

export interface CompanyMarketDto {
  listings: CompanyListingDto[]
  total: number
  page: number
  pageSize: number
  recentOrders: CompanyOrderDto[]
  rules: CompanyConfigValues
}

export interface CompanyDetailDto {
  company: CompanyDto
  listings: CompanyListingDto[]
  recentOrders: CompanyOrderDto[]
  isMember: boolean
  myRole: string | null
}

/* ============================================================
   内部工具
   ============================================================ */

function iso(date: Date): string {
  return date.toISOString()
}

function rarityLabelOf(rarity: string): string {
  return COMPANY_RARITY_LABELS[rarity as (typeof COMPANY_RARITIES)[number]] ?? rarity
}

function listingRemaining(row: Pick<CompanyListing, 'amount' | 'soldAmount'>): number {
  return Math.max(0, Math.trunc(row.amount) - Math.max(0, Math.trunc(row.soldAmount)))
}

/** 我在的「未解散」公司（一人至多一司由 service 在事务内保证，库里故意不建唯一约束） */
async function findMyMembership(client: Db, userId: number) {
  return client.companyMember.findFirst({
    where: { userId, company: { status: { not: COMPANY_STATUS_DISBANDED } } },
    include: { company: { include: { owner: { select: userSelect } } } },
  })
}

async function requireMembership(client: Db, userId: number) {
  const membership = await findMyMembership(client, userId)
  if (!membership) throw new AppError('你还没有加入任何公司', 404, 'COMPANY_NOT_FOUND')
  return membership
}

const listingInclude = {
  company: { select: { name: true, status: true } },
  donor: { select: userSelect },
} as const

function toListingDto(row: ListingRow, viewerId: number): CompanyListingDto {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    companyStatus: row.company.status,
    source: row.source,
    itemKey: row.itemKey,
    itemName: row.itemName,
    emoji: row.emoji,
    rarity: row.rarity,
    rarityLabel: rarityLabelOf(row.rarity),
    unitPrice: row.unitPrice,
    amount: row.amount,
    soldAmount: row.soldAmount,
    available: listingRemaining(row),
    status: row.status,
    // 捐入者只出 id + 用户名，不外泄任何内部字段
    donor: { id: row.donor.id, username: row.donor.username },
    isMine: row.donorId === viewerId,
    createdAt: iso(row.createdAt),
  }
}

interface OrderRow {
  id: number
  companyId: number
  itemName: string
  source: string
  amount: number
  unitPrice: number
  total: number
  createdAt: Date
  company: { name: string }
  buyer: { id: number; username: string }
}

function toOrderDto(row: OrderRow): CompanyOrderDto {
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    buyer: { id: row.buyer.id, username: row.buyer.username },
    itemName: row.itemName,
    amount: row.amount,
    unitPrice: row.unitPrice,
    total: row.total,
    createdAt: iso(row.createdAt),
  }
}

const orderSelect = {
  id: true,
  companyId: true,
  itemName: true,
  source: true,
  amount: true,
  unitPrice: true,
  total: true,
  createdAt: true,
  company: { select: { name: true } },
  buyer: { select: userSelect },
} as const

/* ============================================================
   惰性结算：founding 作废 / 贷款逾期
   ============================================================ */

/**
 * 逾期翻转：`status='open' && dueAt < now` 一律 CAS 成 overdue（幂等，翻不到就是没到期）。
 * 按人翻而不是只按公司翻——被踢的人带着逾期时，那个状态还要能挡住他在别的公司再借。
 */
export async function settleLoansForUser(client: Db, userId: number, now = new Date()): Promise<number> {
  const result = await client.companyLoan.updateMany({
    where: { userId, status: 'open', dueAt: { lt: now } },
    data: { status: 'overdue' },
  })
  return result.count
}

/** 公司维度的逾期扫描（公开页与解散前用） */
async function settleLoansForCompany(client: Db, companyId: number, now = new Date()): Promise<number> {
  const result = await client.companyLoan.updateMany({
    where: { companyId, status: 'open', dueAt: { lt: now } },
    data: { status: 'overdue' },
  })
  return result.count
}

/**
 * founding 到期处理：满 3 人就转 active，没满就作废（解散 + 退回托管 + 分光资金池）。
 * 返回 true 表示这家公司刚刚被作废，调用方要把视图重取一次。
 */
async function settleFoundingCompany(companyId: number, nowMs: number): Promise<boolean> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, status: true, foundingExpiresAt: true },
  })
  if (!company || company.status !== COMPANY_STATUS_FOUNDING) return false
  const memberCount = await prisma.companyMember.count({ where: { companyId } })
  // 满员优先：哪怕已经过了截止时刻，只要人凑齐了就正常开张（邀请可能只是回得慢了一步）
  if (shouldActivateCompany(memberCount)) {
    await prisma.company.updateMany({
      where: { id: companyId, status: COMPANY_STATUS_FOUNDING },
      data: { status: COMPANY_STATUS_ACTIVE, foundingExpiresAt: null },
    })
    return false
  }
  if (!isFoundingExpired(company.foundingExpiresAt?.getTime() ?? null, nowMs)) return false
  // 有未结清贷款就不作废：Cascade 会把债务一起删掉（理论上等级 0 借不到，防御性检查）
  const unsettled = await prisma.companyLoan.count({ where: { companyId, status: { not: 'repaid' } } })
  if (unsettled > 0) return false

  return prisma.$transaction(async (tx) => {
    const claimed = await tx.company.updateMany({
      where: { id: companyId, status: COMPANY_STATUS_FOUNDING },
      data: { status: COMPANY_STATUS_DISBANDED, disbandedAt: new Date(nowMs), foundingExpiresAt: null },
    })
    if (claimed.count !== 1) return false
    await tx.companyInvite.updateMany({ where: { companyId, status: 'pending' }, data: { status: 'expired' } })
    await liquidateTx(tx, companyId)
    return true
  })
}

/**
 * 清算：所有未售条目原路退回捐入者 + 资金池按成员均分（余数归发起人）。
 * 幂等由调用方的 status CAS 占位保证（只有翻到 1 行才会走到这里）。
 */
async function liquidateTx(tx: Db, companyId: number): Promise<void> {
  await returnAllEscrowTx(tx, companyId)
  const company = await tx.company.findUnique({ where: { id: companyId }, select: { ownerId: true, poolBalance: true } })
  if (!company || company.poolBalance <= 0) return
  const members = await tx.companyMember.findMany({
    where: { companyId },
    select: { userId: true },
    orderBy: { userId: 'asc' },
  })
  if (members.length === 0) return
  const share = Math.floor(company.poolBalance / members.length)
  let handed = 0
  if (share > 0) {
    for (const member of members) {
      if (member.userId === company.ownerId) continue
      await awardPointsTx(tx, member.userId, { amount: share, reason: 'company_liquidate', note: '公司解散清算' })
      handed += share
    }
  }
  // 余数留给发起人：留在池里就等于消失了（公司已解散，没人再能认领它）
  await awardPointsTx(tx, company.ownerId, {
    amount: Math.max(0, company.poolBalance - handed),
    reason: 'company_liquidate',
    note: '公司解散清算',
  })
  await tx.company.updateMany({ where: { id: companyId }, data: { poolBalance: 0 } })
}

/** 把该公司全部 active 条目的未售量退回捐入者，并整体翻成 withdrawn */
async function returnAllEscrowTx(tx: Db, companyId: number): Promise<void> {
  const rows = await tx.companyListing.findMany({ where: { companyId, status: 'active' } })
  for (const row of rows) {
    const back = listingRemaining(row)
    if (back > 0) await deliverTx(tx, row.source, row.itemKey, row.donorId, back)
    await tx.companyListing.updateMany({ where: { id: row.id, status: 'active' }, data: { status: 'withdrawn' } })
  }
}

/* ============================================================
   托管 / 交割（搜打撤仓库 + 农场种子）
   ============================================================ */

/** 交割：把 n 件货交给用户（raid_item 进仓库、farm_seed 进农场仓库） */
async function deliverTx(tx: Db, source: string, itemKey: string, userId: number, amount: number): Promise<void> {
  if (amount <= 0) return
  if (source === COMPANY_LISTING_SOURCE_RAID) {
    await tx.raidInventoryItem.upsert({
      where: { userId_itemKey: { userId, itemKey } },
      create: { userId, itemKey, amount },
      update: { amount: { increment: amount } },
    })
    return
  }
  if (source === COMPANY_LISTING_SOURCE_SEED) {
    const farm = await tx.farm.findUnique({ where: { userId }, select: { id: true } })
    if (!farm) throw new AppError('买家还没有农场，先开一块地吧', 400, 'FARM_NOT_FOUND')
    await tx.farmItem.upsert({
      where: { farmId_kind_itemKey: { farmId: farm.id, kind: 'seed', itemKey } },
      create: { farmId: farm.id, kind: 'seed', itemKey, count: amount },
      update: { count: { increment: amount } },
    })
    return
  }
  throw new AppError('未知的货物来源', 500)
}

/** 托管：从用户手里物理扣走 n 件（不足即抛错 → 整个事务回滚） */
async function escrowTx(tx: Db, source: CompanyListingSource, itemKey: string, userId: number, amount: number): Promise<void> {
  if (amount <= 0) return
  if (source === COMPANY_LISTING_SOURCE_RAID) {
    const row = await tx.raidInventoryItem.findUnique({ where: { userId_itemKey: { userId, itemKey } } })
    if (!row || row.amount < amount) throw new AppError(`仓库里的这件物品不够（现有 ${row?.amount ?? 0} 件）`, 400)
    const left = row.amount - amount
    if (left <= 0) await tx.raidInventoryItem.delete({ where: { id: row.id } })
    else await tx.raidInventoryItem.update({ where: { id: row.id }, data: { amount: left } })
    return
  }
  const farm = await tx.farm.findUnique({ where: { userId }, select: { id: true } })
  if (!farm) throw new AppError('还没有农场，先开一块地吧', 404)
  const row = await tx.farmItem.findUnique({ where: { farmId_kind_itemKey: { farmId: farm.id, kind: 'seed', itemKey } } })
  if (!row || row.count < amount) throw new AppError(`种子不够（现有 ${row?.count ?? 0} 颗）`, 400)
  const left = row.count - amount
  if (left <= 0) await tx.farmItem.delete({ where: { id: row.id } })
  else await tx.farmItem.update({ where: { id: row.id }, data: { count: left } })
}

/** 买家仓库剩余件数（raid_item 交割前的硬门：装不下就整笔失败，绝不自动出售） */
async function warehouseRoomTx(tx: Db, userId: number): Promise<number> {
  const storage = await ensureRaidStorageTx(tx, userId)
  const rows = await tx.raidInventoryItem.findMany({ where: { userId }, select: { amount: true } })
  const used = rows.reduce((sum, row) => sum + Math.max(0, row.amount), 0)
  return Math.max(0, storageLevelInfo(storage.level).capacity - used)
}

/* ============================================================
   公司 DTO 装配
   ============================================================ */

async function buildCompanyDto(company: CompanyRow, nowMs: number, viewerId: number): Promise<CompanyDto> {
  const [members, loanGroups] = await Promise.all([
    prisma.companyMember.findMany({
      where: { companyId: company.id },
      select: { userId: true, role: true, joinedAt: true, user: { select: userSelect } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    }),
    // 未结清本金按人汇总：被踢出去的人仍可能欠着，所以直接扫贷款表而不是成员表
    prisma.companyLoan.groupBy({
      by: ['userId'],
      where: { companyId: company.id, status: { not: 'repaid' } },
      _sum: { principal: true },
    }),
  ])
  const outstandingByUser = new Map<number, number>()
  for (const group of loanGroups) outstandingByUser.set(group.userId, Math.max(0, group._sum.principal ?? 0))
  return {
    id: company.id,
    name: company.name,
    status: company.status,
    owner: { id: company.owner.id, username: company.owner.username },
    level: companyLevelOf(company.tierMask),
    tierMask: company.tierMask,
    poolBalance: company.poolBalance,
    revenue: company.revenue,
    memberCount: members.length,
    maxMembers: COMPANY_MAX_MEMBERS,
    foundingExpiresAt: company.foundingExpiresAt ? iso(company.foundingExpiresAt) : null,
    foundingRemainingMs: company.status === COMPANY_STATUS_FOUNDING
      ? foundingRemainingMs(company.foundingExpiresAt?.getTime() ?? null, nowMs)
      : 0,
    createdAt: iso(company.createdAt),
    tier: companyTierProgress(company.revenue, company.tierMask),
    members: members.map((member) => ({
      id: member.user.id,
      username: member.user.username,
      role: member.role,
      joinedAt: iso(member.joinedAt),
      isMe: member.userId === viewerId,
      outstanding: outstandingByUser.get(member.userId) ?? 0,
    })),
  }
}

/* ============================================================
   GET /me
   ============================================================ */

export async function getMyCompanyView(userId: number, nowMs = Date.now()): Promise<CompanyMeDto> {
  const rules = await getCompanyConfig()
  const membership = await findMyMembership(prisma, userId)
  const invitesReceived = await prisma.companyInvite.findMany({
    where: { targetUserId: userId, status: 'pending' },
    select: {
      id: true,
      companyId: true,
      status: true,
      createdAt: true,
      company: { select: { name: true, status: true, foundingExpiresAt: true } },
      inviter: { select: userSelect },
      target: { select: userSelect },
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })

  const receivedDtos: CompanyInviteDto[] = []
  for (const invite of invitesReceived) {
    // 指向过期 founding 的邀请：先结算，作废了就剔掉（否则用户看到一堆点不动的按钮）
    if (invite.company.status === COMPANY_STATUS_FOUNDING && isFoundingExpired(invite.company.foundingExpiresAt?.getTime() ?? null, nowMs)) {
      await settleFoundingCompany(invite.companyId, nowMs)
      continue
    }
    if (invite.company.status === COMPANY_STATUS_DISBANDED) continue
    receivedDtos.push({
      id: invite.id,
      companyId: invite.companyId,
      companyName: invite.company.name,
      target: { id: invite.target.id, username: invite.target.username },
      inviter: { id: invite.inviter.id, username: invite.inviter.username },
      status: invite.status,
      createdAt: iso(invite.createdAt),
    })
  }

  if (!membership) {
    return {
      company: null,
      myRole: null,
      invitesReceived: receivedDtos,
      invitesSent: [],
      listings: [],
      myDonations: [],
      loans: [],
      loanSummary: null,
      donateOptions: [],
      rules,
      limits: { minMembers: COMPANY_MIN_MEMBERS, maxMembers: COMPANY_MAX_MEMBERS },
    }
  }

  // 惰性结算两件事：过期 founding 作废、逾期贷款翻状态
  if (membership.company.status === COMPANY_STATUS_FOUNDING && await settleFoundingCompany(membership.companyId, nowMs)) {
    return getMyCompanyView(userId, nowMs)
  }
  await settleLoansForUser(prisma, userId, new Date(nowMs))
  await settleLoansForCompany(prisma, membership.companyId, new Date(nowMs))

  const company = await prisma.company.findUnique({ where: { id: membership.companyId }, include: { owner: { select: userSelect } } })
  if (!company) {
    // 公司行不见了（管理员刚删号之类）：按无公司返回，不让页面白屏
    return { company: null, myRole: null, invitesReceived: receivedDtos, invitesSent: [], listings: [], myDonations: [], loans: [], loanSummary: null, donateOptions: [], rules, limits: { minMembers: COMPANY_MIN_MEMBERS, maxMembers: COMPANY_MAX_MEMBERS } }
  }

  const [listings, myDonations, loans, invitesSent] = await Promise.all([
    prisma.companyListing.findMany({ where: { companyId: company.id, status: 'active' }, include: listingInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.companyListing.findMany({ where: { donorId: userId, status: 'active' }, include: listingInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.companyLoan.findMany({ where: { companyId: company.id }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] }),
    prisma.companyInvite.findMany({
      where: { companyId: company.id, invitedBy: userId, status: 'pending' },
      select: {
        id: true, companyId: true, status: true, createdAt: true,
        company: { select: { name: true } },
        target: { select: userSelect },
        inviter: { select: userSelect },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const level = companyLevelOf(company.tierMask)
  const cap = loanCapFromConfig(rules, level)
  const myLoans = loans.filter((loan) => loan.userId === userId)
  // 占用额度 = 未结清贷款的「已还到本金上」以外的部分（还的钱先冲利息再冲本金）
  const outstanding = myLoans
    .filter((loan) => isLoanUnsettled(loan.status, loan.repaid, loan.dueAmount))
    .reduce((sum, loan) => sum + (loan.principal - repaidPrincipalOf(loan)), 0)

  return {
    company: await buildCompanyDto(company, nowMs, userId),
    myRole: membership.role,
    invitesReceived: receivedDtos,
    invitesSent: invitesSent.map((invite) => ({
      id: invite.id,
      companyId: invite.companyId,
      companyName: invite.company.name,
      target: { id: invite.target.id, username: invite.target.username },
      inviter: { id: invite.inviter.id, username: invite.inviter.username },
      status: invite.status,
      createdAt: iso(invite.createdAt),
    })),
    listings: listings.map((row) => toListingDto(row as ListingRow, userId)),
    myDonations: myDonations.map((row) => toListingDto(row as ListingRow, userId)),
    loans: myLoans.map((loan) => buildLoanDto({
      id: loan.id,
      companyId: loan.companyId,
      companyName: company.name,
      principal: loan.principal,
      dueAmount: loan.dueAmount,
      repaid: loan.repaid,
      ratePct: loan.ratePct,
      dueDays: loan.dueDays,
      status: loan.status,
      borrowedAtMs: loan.borrowedAt.getTime(),
      dueAtMs: loan.dueAt.getTime(),
      nowMs,
    })),
    loanSummary: {
      level,
      cap,
      ratePct: loanRateFromConfig(rules, level),
      dueDays: rules.loanDueDays,
      outstanding,
      remaining: Math.max(0, cap - outstanding),
      blockedByOverdue: myLoans.some((loan) => loan.status === 'overdue' && isLoanUnsettled(loan.status, loan.repaid, loan.dueAmount)),
    },
    donateOptions: await buildDonateOptions(userId, company.id, rules),
    rules,
    limits: { minMembers: COMPANY_MIN_MEMBERS, maxMembers: COMPANY_MAX_MEMBERS },
  }
}

/**
 * 已还进去的钱先冲利息、再冲本金（dueAmount = 本金 + 利息，放款时钉死），
 * 所以「还占用的额度」要按落在本金上的那部分扣减：还满 dueAmount 时占用归零。
 */
function repaidPrincipalOf(loan: { principal: number; dueAmount: number; repaid: number }): number {
  const interest = Math.max(0, loan.dueAmount - loan.principal)
  return Math.max(0, Math.min(loan.principal, Math.trunc(loan.repaid) - interest))
}

async function buildDonateOptions(userId: number, companyId: number, rules: CompanyConfigValues): Promise<CompanyDonateOptionDto[]> {
  const dateKey = getTodayDateKey()
  const [raidRows, farm, restocks] = await Promise.all([
    prisma.raidInventoryItem.findMany({ where: { userId } }),
    prisma.farm.findUnique({ where: { userId }, select: { items: true } }),
    prisma.companyRestock.findMany({ where: { companyId, dateKey } }),
  ])
  const usedByRarity = new Map<string, number>()
  for (const row of restocks) usedByRarity.set(row.rarity, row.units)

  const options: CompanyDonateOptionDto[] = []
  const push = (source: CompanyListingSource, itemKey: string, owned: number) => {
    const entry = resolveCatalog(source, itemKey)
    if (!entry || owned <= 0) return
    const cap = restockCapOf(entry.capRarity)
    options.push({
      source,
      itemKey: entry.itemKey,
      itemName: entry.itemName,
      emoji: entry.emoji,
      rarity: entry.rarity,
      rarityLabel: rarityLabelOf(entry.rarity),
      capRarity: entry.capRarity,
      owned,
      referencePrice: entry.referencePrice,
      band: priceBandOf(entry.referencePrice, rules.priceBandMin, rules.priceBandMax),
      donationCap: donationCapOf(entry.capRarity),
      restockCap: cap,
      restockLeft: Math.max(0, cap - (usedByRarity.get(entry.capRarity) ?? 0)),
    })
  }
  for (const row of raidRows) push(COMPANY_LISTING_SOURCE_RAID, row.itemKey, row.amount)
  for (const item of farm?.items ?? []) {
    if (item.kind === 'seed') push(COMPANY_LISTING_SOURCE_SEED, item.itemKey, item.count)
  }
  // 稀有度高的排前面：一件传说比二十块废铁值钱，先让用户看到值钱货
  options.sort((a, b) => rarityWeight(b.rarity) - rarityWeight(a.rarity) || b.owned - a.owned)
  return options
}

/* ============================================================
   GET /market · GET /:id · GET /candidates · GET /loans
   ============================================================ */

/** 稀有度排序要在内存里按权重排（SQL 没有这一列），一次取满上限再切片 */
const MARKET_SCAN_LIMIT = 400

export async function getMarketView(
  userId: number,
  query: { page?: unknown; pageSize?: unknown; sort?: unknown; source?: unknown; q?: unknown },
): Promise<CompanyMarketDto> {
  const rules = await getCompanyConfig()
  const { page, pageSize } = normalizePageQuery(query.page, query.pageSize)
  const sort = isMarketSort(query.sort) ? query.sort : 'newest'
  const keyword = typeof query.q === 'string' ? query.q.trim().slice(0, 24) : ''
  const sourceFilter = isCompanyListingSource(query.source) ? query.source : undefined

  const where = {
    status: 'active',
    // 已解散公司的残留条目不该出现在市场上（正常流程里解散会把它们全部退回）
    company: { status: { not: COMPANY_STATUS_DISBANDED } },
    amount: { gt: 0 },
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(keyword ? { itemName: { contains: keyword } } : {}),
  }
  // 显式标注 Prisma 参数类型：orderBy / take / skip 用三元拼出来的联合字面量
  // 会让 TS 选错重载（报「not assignable to ... | undefined」），标一次就干净了。
  const listingArgs: Prisma.CompanyListingFindManyArgs = {
    where,
    include: listingInclude,
    orderBy: sort === 'price_asc'
      ? [{ unitPrice: 'asc' }, { id: 'asc' }]
      : sort === 'price_desc'
        ? [{ unitPrice: 'desc' }, { id: 'desc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],
    // 价格/时间排序交给 SQL（带 skip/take）；稀有度排序需要全量扫描后内存切片
    ...(sort === 'rarity' ? { take: MARKET_SCAN_LIMIT } : { skip: (page - 1) * pageSize, take: pageSize }),
  }
  const [total, rows, orders] = await Promise.all([
    prisma.companyListing.count({ where }),
    prisma.companyListing.findMany(listingArgs),
    prisma.companyOrder.findMany({
      where: { company: { status: { not: COMPANY_STATUS_DISBANDED } } },
      select: orderSelect,
      orderBy: { createdAt: 'desc' },
      take: 12,
    }),
  ])

  let listings = rows.map((row) => toListingDto(row as ListingRow, userId))
  if (sort === 'rarity') {
    listings = listings
      .sort((a, b) => rarityWeight(b.rarity) - rarityWeight(a.rarity) || b.createdAt.localeCompare(a.createdAt))
      .slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize)
  }

  return {
    listings,
    total,
    page,
    pageSize,
    recentOrders: orders.map((order) => toOrderDto(order as unknown as OrderRow)),
    rules,
  }
}

export async function getCompanyDetail(companyId: number, viewerId: number, nowMs = Date.now()): Promise<CompanyDetailDto> {
  await settleFoundingCompany(companyId, nowMs)
  const company = await prisma.company.findUnique({ where: { id: companyId }, include: { owner: { select: userSelect } } })
  if (!company || company.status === COMPANY_STATUS_DISBANDED) throw new AppError('公司不存在或已解散', 404, 'COMPANY_NOT_FOUND')
  await settleLoansForCompany(prisma, companyId, new Date(nowMs))
  const [listings, orders, membership] = await Promise.all([
    prisma.companyListing.findMany({ where: { companyId, status: 'active' }, include: listingInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }),
    prisma.companyOrder.findMany({ where: { companyId }, select: orderSelect, orderBy: { createdAt: 'desc' }, take: 12 }),
    prisma.companyMember.findFirst({ where: { companyId, userId: viewerId }, select: { role: true } }),
  ])
  return {
    company: await buildCompanyDto(company, nowMs, viewerId),
    listings: listings.map((row) => toListingDto(row as ListingRow, viewerId)),
    recentOrders: orders.map((order) => toOrderDto(order as unknown as OrderRow)),
    isMember: !!membership,
    myRole: membership?.role ?? null,
  }
}

/** 可邀请的好友：active 用户、不在任何未解散公司里、本公司没有他的待处理邀请 */
export async function getInviteCandidates(userId: number, nowMs = Date.now()) {
  const membership = await findMyMembership(prisma, userId)
  if (membership && membership.company.status === COMPANY_STATUS_FOUNDING) {
    await settleFoundingCompany(membership.companyId, nowMs)
  }
  const { friends } = await listFriends(userId)
  const ids = friends.map((friend) => friend.id)
  if (ids.length === 0) {
    return { candidates: [] as CompanyUserDto[], companyId: membership?.companyId ?? null, memberCount: membership ? 1 : 0, maxMembers: COMPANY_MAX_MEMBERS }
  }
  const [busy, pending, users] = await Promise.all([
    prisma.companyMember.findMany({
      where: { userId: { in: ids }, company: { status: { not: COMPANY_STATUS_DISBANDED } } },
      select: { userId: true },
    }),
    membership
      ? prisma.companyInvite.findMany({
        where: { companyId: membership.companyId, targetUserId: { in: ids }, status: 'pending' },
        select: { targetUserId: true },
      })
      : Promise.resolve([] as Array<{ targetUserId: number }>),
    prisma.user.findMany({ where: { id: { in: ids }, status: 'active' }, select: userSelect, orderBy: { username: 'asc' } }),
  ])
  const taken = new Set(busy.map((row) => row.userId))
  const invited = new Set(pending.map((row) => row.targetUserId))
  const memberCount = membership ? await prisma.companyMember.count({ where: { companyId: membership.companyId } }) : 0
  return {
    candidates: users.filter((user) => !taken.has(user.id) && !invited.has(user.id)),
    companyId: membership?.companyId ?? null,
    memberCount,
    maxMembers: COMPANY_MAX_MEMBERS,
  }
}

export async function getMyLoans(userId: number, nowMs = Date.now()): Promise<CompanyLoanDto[]> {
  await settleLoansForUser(prisma, userId, new Date(nowMs))
  const rows = await prisma.companyLoan.findMany({
    where: { userId },
    include: { company: { select: { name: true } } },
    orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
  })
  return rows.map((row) => buildLoanDto({
    id: row.id,
    companyId: row.companyId,
    companyName: row.company.name,
    principal: row.principal,
    dueAmount: row.dueAmount,
    repaid: row.repaid,
    ratePct: row.ratePct,
    dueDays: row.dueDays,
    status: row.status,
    borrowedAtMs: row.borrowedAt.getTime(),
    dueAtMs: row.dueAt.getTime(),
    nowMs,
  }))
}

/* ============================================================
   创建 / 邀请 / 响应 / 退司 / 踢人
   ============================================================ */

export async function foundCompany(userId: number, rawName: unknown, inviteeIds: unknown, nowMs = Date.now()) {
  const name = normalizeCompanyName(rawName)
  const nameError = validateCompanyName(name)
  if (nameError) throw new AppError(nameError, 400, 'COMPANY_NAME_INVALID')
  // 「恰好 2 位受邀好友」= 3 人成司：不多不少，避免先建空壳再拉人
  if (!Array.isArray(inviteeIds) || inviteeIds.length !== COMPANY_MIN_MEMBERS - 1) {
    throw new AppError(`创建公司需要邀请恰好 ${COMPANY_MIN_MEMBERS - 1} 位好友`, 400, 'COMPANY_INVITEES_INVALID')
  }
  const targets = [...new Set(inviteeIds.map((value) => Math.trunc(Number(value))))].filter((value) => Number.isFinite(value) && value > 0)
  if (targets.length !== COMPANY_MIN_MEMBERS - 1) throw new AppError('受邀好友无效或重复', 400, 'COMPANY_INVITEES_INVALID')
  if (targets.includes(userId)) throw new AppError('不能邀请自己', 400)

  const { friends } = await listFriends(userId)
  const friendIds = new Set(friends.map((friend) => friend.id))
  for (const target of targets) {
    if (!friendIds.has(target)) throw new AppError('只能邀请你的好友', 403, 'COMPANY_NOT_FRIEND')
  }

  const companyId = await prisma.$transaction(async (tx) => {
    const clash = await tx.companyMember.findFirst({
      where: { userId, company: { status: { not: COMPANY_STATUS_DISBANDED } } },
      select: { companyId: true },
    })
    if (clash) throw new AppError('你已经在一个公司里了，先退出再发起', 409, 'COMPANY_ALREADY_MEMBER')
    const duplicate = await tx.company.findUnique({ where: { name }, select: { id: true } })
    if (duplicate) throw new AppError('这个公司名已经被用了', 409, 'COMPANY_NAME_TAKEN')
    const usable = await tx.user.count({ where: { id: { in: targets }, status: 'active' } })
    if (usable !== targets.length) throw new AppError('受邀好友里有不可用的账号', 400)

    const company = await tx.company.create({
      data: {
        name,
        ownerId: userId,
        status: COMPANY_STATUS_FOUNDING,
        // 唯一约束是同名并发的最后防线：撞键就翻译成可读的 409
        foundingExpiresAt: new Date(foundingExpiresAtOf(nowMs)),
      },
    })
    // 发起人写死 ceo：此后既不转让也不降级，解散权永远在他手里
    await tx.companyMember.create({ data: { companyId: company.id, userId, role: 'ceo' } })
    for (const target of targets) {
      await tx.companyInvite.upsert({
        where: { companyId_targetUserId: { companyId: company.id, targetUserId: target } },
        create: { companyId: company.id, targetUserId: target, invitedBy: userId },
        update: { status: 'pending', invitedBy: userId },
      })
    }
    return company.id
  })

  const fresh = await prisma.company.findUnique({ where: { id: companyId }, include: { owner: { select: userSelect } } })
  if (!fresh) throw new AppError('公司创建失败', 500)
  return { company: await buildCompanyDto(fresh, nowMs, userId) }
}

export async function inviteMember(userId: number, targetUserId: number, nowMs = Date.now()) {
  const target = Math.trunc(Number(targetUserId))
  if (!Number.isFinite(target) || target <= 0) throw new AppError('受邀用户无效', 400)
  if (target === userId) throw new AppError('不能邀请自己', 400)
  const membership = await requireMembership(prisma, userId)
  if (membership.company.status === COMPANY_STATUS_DISBANDED) throw new AppError('公司已解散', 409)
  if (membership.company.status === COMPANY_STATUS_FOUNDING && await settleFoundingCompany(membership.companyId, nowMs)) {
    throw new AppError('这家公司创立期已过、已作废', 410, 'COMPANY_VOIDED')
  }

  const { friends } = await listFriends(userId)
  if (!friends.some((friend) => friend.id === target)) throw new AppError('只能邀请你的好友', 403, 'COMPANY_NOT_FRIEND')

  await prisma.$transaction(async (tx) => {
    const memberCount = await tx.companyMember.count({ where: { companyId: membership.companyId } })
    if (memberCount >= COMPANY_MAX_MEMBERS) throw new AppError(`公司最多 ${COMPANY_MAX_MEMBERS} 人`, 409, 'COMPANY_FULL')
    const already = await tx.companyMember.findFirst({
      where: { userId: target, company: { status: { not: COMPANY_STATUS_DISBANDED } } },
      select: { companyId: true },
    })
    if (already) throw new AppError('对方已经在一家公司里了', 409, 'COMPANY_TARGET_BUSY')
    const user = await tx.user.findUnique({ where: { id: target }, select: { status: true } })
    if (!user || user.status !== 'active') throw new AppError('受邀用户不可用', 400)
    await tx.companyInvite.upsert({
      where: { companyId_targetUserId: { companyId: membership.companyId, targetUserId: target } },
      create: { companyId: membership.companyId, targetUserId: target, invitedBy: userId },
      update: { status: 'pending', invitedBy: userId },
    })
  })
  return getMyCompanyView(userId, nowMs)
}

export async function respondInvite(userId: number, inviteId: number, accept: boolean, nowMs = Date.now()) {
  const id = Math.trunc(inviteId)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('邀请不存在', 404, 'COMPANY_INVITE_NOT_FOUND')
  const invite = await prisma.companyInvite.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true, status: true, foundingExpiresAt: true } } },
  })
  if (!invite || invite.targetUserId !== userId) throw new AppError('邀请不存在', 404, 'COMPANY_INVITE_NOT_FOUND')
  if (invite.status !== 'pending') throw new AppError('这条邀请已经处理过了', 409, 'COMPANY_INVITE_DONE')

  if (!accept) {
    await prisma.companyInvite.updateMany({ where: { id: invite.id, status: 'pending' }, data: { status: 'rejected' } })
    return getMyCompanyView(userId, nowMs)
  }
  if (invite.company.status === COMPANY_STATUS_DISBANDED) throw new AppError('这家公司已经解散了', 409, 'COMPANY_VOIDED')
  if (invite.company.status === COMPANY_STATUS_FOUNDING) {
    const voided = await settleFoundingCompany(invite.company.id, nowMs)
    if (voided) throw new AppError('这家公司创立期已过、已作废', 410, 'COMPANY_VOIDED')
  }

  await prisma.$transaction(async (tx) => {
    const clash = await tx.companyMember.findFirst({
      where: { userId, company: { status: { not: COMPANY_STATUS_DISBANDED } } },
      select: { companyId: true },
    })
    if (clash) throw new AppError('你已经在一个公司里了', 409, 'COMPANY_ALREADY_MEMBER')
    // 邀请行的 CAS 是唯一入口：抢不到就说明同一刻有第二次点击 / 另一个响应，成员行不会重复
    const claimed = await tx.companyInvite.updateMany({
      where: { id: invite.id, status: 'pending' },
      data: { status: 'accepted' },
    })
    if (claimed.count !== 1) throw new AppError('这条邀请刚刚被处理过了', 409, 'COMPANY_INVITE_DONE')
    const memberCount = await tx.companyMember.count({ where: { companyId: invite.companyId } })
    if (memberCount >= COMPANY_MAX_MEMBERS) throw new AppError(`公司最多 ${COMPANY_MAX_MEMBERS} 人`, 409, 'COMPANY_FULL')
    await tx.companyMember.create({ data: { companyId: invite.companyId, userId, role: 'member' } })
    if (invite.company.status === COMPANY_STATUS_FOUNDING && shouldActivateCompany(memberCount + 1)) {
      await tx.company.updateMany({
        where: { id: invite.companyId, status: COMPANY_STATUS_FOUNDING },
        data: { status: COMPANY_STATUS_ACTIVE, foundingExpiresAt: null },
      })
    }
  })
  return getMyCompanyView(userId, nowMs)
}

export async function leaveCompany(userId: number, nowMs = Date.now()) {
  const membership = await requireMembership(prisma, userId)
  if (membership.role === 'ceo') throw new AppError('发起人不能退出自己的公司，只能解散', 400, 'COMPANY_OWNER_CANNOT_LEAVE')
  await settleLoansForUser(prisma, userId, new Date(nowMs))
  const loans = await prisma.companyLoan.findMany({
    where: { userId, companyId: membership.companyId, status: { not: 'repaid' } },
    select: { principal: true, dueAmount: true, repaid: true, status: true },
  })
  if (loans.some((loan) => isLoanUnsettled(loan.status, loan.repaid, loan.dueAmount))) {
    throw new AppError('你还欠着公司的钱，先还清再退出', 409, 'COMPANY_LOAN_OUTSTANDING')
  }
  await prisma.companyMember.deleteMany({ where: { companyId: membership.companyId, userId } })
  // 待处理邀请翻 expired：唯一键 [companyId,targetUserId] 会挡住重复邀请，
  // 留成 pending 的话这个人以后再也请不回来了
  await prisma.companyInvite.updateMany({
    where: { companyId: membership.companyId, targetUserId: userId, status: 'pending' },
    data: { status: 'expired' },
  })
  return getMyCompanyView(userId, nowMs)
}

export async function kickMember(operatorId: number, targetUserId: number, nowMs = Date.now()) {
  const membership = await requireMembership(prisma, operatorId)
  if (membership.role !== 'ceo') throw new AppError('只有发起人能踢人', 403, 'COMPANY_NOT_CEO')
  const target = Math.trunc(Number(targetUserId))
  if (!Number.isFinite(target) || target <= 0) throw new AppError('成员无效', 400)
  if (target === operatorId) throw new AppError('不能踢自己', 400)
  const row = await prisma.companyMember.findUnique({
    where: { companyId_userId: { companyId: membership.companyId, userId: target } },
    select: { id: true, role: true },
  })
  if (!row) throw new AppError('这个人不在你的公司里', 404)
  if (row.role === 'ceo') throw new AppError('发起人不能被踢出', 400)

  await prisma.$transaction(async (tx) => {
    await tx.companyMember.deleteMany({ where: { companyId: membership.companyId, userId: target } })
    await tx.companyInvite.updateMany({
      where: { companyId: membership.companyId, targetUserId: target, status: 'pending' },
      data: { status: 'expired' },
    })
    // 贷款一行都不动：被踢的人欠公司的钱仍然有效，还回来的是公司的资金池
  })
  return getMyCompanyView(operatorId, nowMs)
}

/* ============================================================
   货栈：捐入 / 下架
   ============================================================ */

export interface DonateInput {
  source: string
  itemKey: string
  amount: number
  unitPrice: number
}

export async function donateItem(userId: number, input: DonateInput, nowMs = Date.now()) {
  const rules = await getCompanyConfig()
  if (!isCompanyListingSource(input.source)) throw new AppError('未知的货物来源', 400)
  const source: CompanyListingSource = input.source
  const itemKey = typeof input.itemKey === 'string' ? input.itemKey.trim() : ''
  const entry = resolveCatalog(source, itemKey)
  if (!entry) throw new AppError('目录里没有这件物品', 404, 'COMPANY_ITEM_UNKNOWN')

  const amount = Math.trunc(input.amount)
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('捐入数量必须是正整数', 400)
  const cap = donationCapOf(entry.capRarity)
  if (amount > cap) throw new AppError(`单条捐入最多 ${cap} 件（${rarityLabelOf(entry.capRarity)}档）`, 400, 'COMPANY_DONATION_CAP')

  const band = priceBandOf(entry.referencePrice, rules.priceBandMin, rules.priceBandMax)
  const unitPrice = Math.trunc(input.unitPrice)
  if (!Number.isInteger(unitPrice) || unitPrice <= 0) throw new AppError('定价必须是正整数', 400)
  if (!isPriceInBand(unitPrice, band)) throw new AppError(priceBandMessage(band), 400, 'COMPANY_PRICE_OUT_OF_BAND')

  const membership = await requireMembership(prisma, userId)
  if (membership.company.status === COMPANY_STATUS_DISBANDED) throw new AppError('公司已解散', 409)
  if (membership.company.status === COMPANY_STATUS_FOUNDING && await settleFoundingCompany(membership.companyId, nowMs)) {
    throw new AppError('这家公司创立期已过、已作废', 410, 'COMPANY_VOIDED')
  }

  const dateKey = getTodayDateKey(nowMs)
  const restockCap = restockCapOf(entry.capRarity)

  await prisma.$transaction(async (tx) => {
    // 每日补货额度先占位（条件递增），占不到就抛错回滚 —— 此时托管还没扣，什么都没发生
    await tx.companyRestock.upsert({
      where: { companyId_dateKey_rarity: { companyId: membership.companyId, dateKey, rarity: entry.capRarity } },
      create: { companyId: membership.companyId, dateKey, rarity: entry.capRarity, units: 0 },
      // 空 update 只保证「行存在」；units 的增减一律走下面带条件的 updateMany
      update: {},
    })
    const claimed = await tx.companyRestock.updateMany({
      where: { companyId: membership.companyId, dateKey, rarity: entry.capRarity, units: { lte: restockCap - amount } },
      data: { units: { increment: amount } },
    })
    if (claimed.count === 0) {
      throw new AppError(`今日「${rarityLabelOf(entry.capRarity)}」档最多补 ${restockCap} 件，明天再来吧`, 409, 'COMPANY_RESTOCK_CAP')
    }
    // 托管：真的从捐入者手里扣走（不足即抛错，上面的补货占位随事务一起回滚）
    await escrowTx(tx, source, entry.itemKey, userId, amount)
    await tx.companyListing.create({
      data: {
        companyId: membership.companyId,
        donorId: userId,
        source,
        itemKey: entry.itemKey,
        itemName: entry.itemName,
        emoji: entry.emoji,
        // 稀有度落的是「计上限用的那一档」：种子归 rare、搜打撤按目录档，市场筛选与上限同口径
        rarity: entry.capRarity,
        unitPrice,
        amount,
      },
    })
  })
  return getMyCompanyView(userId, nowMs)
}

export async function withdrawListing(userId: number, listingId: number, nowMs = Date.now()) {
  const membership = await requireMembership(prisma, userId)
  if (membership.role !== 'ceo') throw new AppError('只有发起人能下架条目', 403, 'COMPANY_NOT_CEO')
  const id = Math.trunc(listingId)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('条目不存在', 404)

  await prisma.$transaction(async (tx) => {
    const listing = await tx.companyListing.findUnique({ where: { id } })
    if (!listing) throw new AppError('条目不存在', 404)
    // 跨公司按 404 处理：不暴露「别家有这条」
    if (listing.companyId !== membership.companyId) throw new AppError('条目不存在', 404)
    if (listing.status !== 'active') throw new AppError('这条已经不在了', 409)

    // 乐观锁钉在 soldAmount 上：值没变才说明「amount − soldAmount」就是此刻能退回的量。
    // 期间被买走一批就抢不到行 → 409 重试，绝不会多退一件（托管泄漏就出在这种地方）。
    const claimed = await tx.companyListing.updateMany({
      where: { id: listing.id, status: 'active', soldAmount: listing.soldAmount },
      data: { status: 'withdrawn' },
    })
    if (claimed.count !== 1) throw new AppError('这条刚刚被买走了一批，请刷新后再下架', 409, 'COMPANY_LISTING_CHANGED')
    const back = listingRemaining(listing)
    if (back > 0) await deliverTx(tx, listing.source, listing.itemKey, listing.donorId, back)
    // 注意：今日补货计数不回退。否则「捐满 → 下架 → 再捐」能把每日上限刷穿。
  })
  return getMyCompanyView(userId, nowMs)
}

/* ============================================================
   市场成交
   ============================================================ */

export interface BuyResult {
  balance: number
  total: number
  amount: number
  itemName: string
  crossedTiers: number[]
}

export async function buyListing(userId: number, listingId: number, wanted: number): Promise<BuyResult> {
  const id = Math.trunc(listingId)
  const quantity = Math.trunc(wanted)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('条目不存在', 404)
  if (!Number.isInteger(quantity) || quantity <= 0) throw new AppError('购买数量必须是正整数', 400)

  const outcome = await prisma.$transaction(async (tx) => {
    const listing = await tx.companyListing.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true, status: true } } },
    })
    if (!listing) throw new AppError('条目不存在', 404)
    if (listing.status !== 'active') throw new AppError('这条货已经不卖了', 409, 'COMPANY_LISTING_GONE')
    if (listing.company.status === COMPANY_STATUS_DISBANDED) throw new AppError('这家公司已经解散了', 409)
    if (listing.donorId === userId) throw new AppError('不能买自己捐的货', 400)
    const available = listingRemaining(listing)
    if (available < quantity) throw new AppError(`只剩 ${available} 件了`, 409, 'COMPANY_NOT_ENOUGH_STOCK')

    // 价格一律服务端重算：客户端只传数量
    const total = listing.unitPrice * quantity

    // 防超卖的唯一守卫：soldAmount 只有在「加完不越过 amount」时才落账。
    // Postgres 在读已提交下会对被别的事务改过的行重算 WHERE，所以并发两个买家合计不会超过 amount。
    const claimed = await tx.companyListing.updateMany({
      where: { id: listing.id, status: 'active', soldAmount: { lte: listing.amount - quantity } },
      data: { soldAmount: { increment: quantity } },
    })
    if (claimed.count === 0) throw new AppError('这一批刚刚被别人抢走了，请调整数量重试', 409, 'COMPANY_SOLD_OUT')

    // 钱先落定：买家积分 → 公司资金池（公司卖自己的货不抽手续费，全额入池）
    const spend = await spendPointsTx(tx, userId, total, {
      reason: 'company_purchase',
      note: `在公司「${listing.company.name}」货栈购入 ${listing.itemName} ×${quantity}`,
    })
    await tx.company.updateMany({
      where: { id: listing.companyId },
      data: { poolBalance: { increment: total }, revenue: { increment: total } },
    })
    // 抬档：上面的 UPDATE 已经锁住这一行，重读拿到的是权威值，等值 CAS 必定命中
    const refreshed = await tx.company.findUnique({ where: { id: listing.companyId }, select: { id: true, revenue: true, tierMask: true } })
    const prevMask = refreshed?.tierMask ?? 0
    const nextMask = companyTierMaskForRevenue(refreshed?.revenue ?? 0)
    if (refreshed && nextMask !== prevMask) {
      const raised = await tx.company.updateMany({ where: { id: refreshed.id, tierMask: prevMask }, data: { tierMask: nextMask } })
      if (raised.count !== 1) throw new AppError('公司档位状态异常，请重试', 409, 'COMPANY_TIER_CONFLICT')
    }

    // 交割：搜打撤物品要先看买家仓库余量，装不下就整笔失败（积分一并回滚）
    if (listing.source === COMPANY_LISTING_SOURCE_RAID) {
      const room = await warehouseRoomTx(tx, userId)
      if (room < quantity) throw new AppError(`搜打撤仓库只剩 ${room} 件位置，先清理或升级仓库吧`, 400, 'COMPANY_NO_WAREHOUSE_ROOM')
    }
    await deliverTx(tx, listing.source, listing.itemKey, userId, quantity)

    await tx.companyOrder.create({
      data: {
        companyId: listing.companyId,
        listingId: listing.id,
        buyerId: userId,
        itemKey: listing.itemKey,
        itemName: listing.itemName,
        source: listing.source,
        amount: quantity,
        unitPrice: listing.unitPrice,
        total,
      },
    })
    // 卖光的条目直接收摊，市场里不留 0 库存的僵尸行
    await tx.companyListing.updateMany({
      where: { id: listing.id, status: 'active', soldAmount: listing.amount },
      data: { status: 'sold_out' },
    })

    return {
      balance: spend.balance,
      total,
      itemName: listing.itemName,
      companyId: listing.companyId,
      crossed: crossedTiers(prevMask, nextMask),
    }
  })

  // 减免发放放在事务提交之后：钱已经结清，绝不能因为危机侧出错而回滚一笔成功的销售。
  // 幂等在 CrisisWaiver 的 [userId, tier] 唯一键上，所以只按「本次新越过的档位」调一次即可。
  // 失败只记日志：危机侧下次开轮时会按公司 tierMask 再对账补发。
  if (outcome.crossed.length > 0) {
    applyCompanyWaiversForCompany(outcome.companyId).catch((err: unknown) => {
      console.error('[company] 危机减免发放失败（由危机侧对账补发）：', err instanceof Error ? err.message : err)
    })
  }
  return {
    balance: outcome.balance,
    total: outcome.total,
    amount: quantity,
    itemName: outcome.itemName,
    crossedTiers: outcome.crossed,
  }
}

/* ============================================================
   贷款
   ============================================================ */

export async function borrowLoan(userId: number, requestedPrincipal: number, nowMs = Date.now()) {
  const rules = await getCompanyConfig()
  const membership = await requireMembership(prisma, userId)
  if (membership.company.status === COMPANY_STATUS_DISBANDED) throw new AppError('公司已解散', 409)
  await settleLoansForUser(prisma, userId, new Date(nowMs))

  const principal = Math.trunc(requestedPrincipal)
  if (!Number.isInteger(principal) || principal <= 0) throw new AppError('借款积分必须是正整数', 400)

  const level = companyLevelOf(membership.company.tierMask)
  const cap = loanCapFromConfig(rules, level)
  if (cap <= 0) {
    const first = COMPANY_REVENUE_TIERS[0]
    throw new AppError(`公司还没有借款额度：营业额做到 ${first.threshold} 积分解锁（当前 ${membership.company.revenue}）`, 409, 'COMPANY_LOAN_NO_CAP')
  }
  const openLoans = await prisma.companyLoan.findMany({
    where: { userId, companyId: membership.companyId, status: { not: 'repaid' } },
    select: { principal: true, dueAmount: true, repaid: true, status: true },
  })
  if (openLoans.some((loan) => loan.status === 'overdue')) {
    throw new AppError('你有逾期未还的贷款，先还清才能再借', 409, 'COMPANY_LOAN_OVERDUE')
  }
  const outstanding = openLoans.reduce((sum, loan) => sum + (loan.principal - repaidPrincipalOf(loan)), 0)
  const remaining = Math.max(0, cap - outstanding)
  if (principal > remaining) throw new AppError(`本次最多还能借 ${remaining} 积分（等级 ${level} 累计上限 ${cap}，已借 ${outstanding}）`, 400, 'COMPANY_LOAN_CAP')

  const ratePct = loanRateFromConfig(rules, level)
  const dueAmount = computeLoanDue(principal, ratePct)
  const dueAt = new Date(loanDueAtOf(nowMs, rules.loanDueDays))

  const created = await prisma.$transaction(async (tx) => {
    // 资金池偿付能力：条件更新（gte 本金），绝不 read-modify-write
    const drained = await tx.company.updateMany({
      where: { id: membership.companyId, poolBalance: { gte: principal } },
      data: { poolBalance: { decrement: principal } },
    })
    if (drained.count !== 1) throw new AppError('公司资金池不够了，多卖些货再来借', 409, 'COMPANY_POOL_TOO_LOW')
    const loan = await tx.companyLoan.create({
      data: {
        companyId: membership.companyId,
        userId,
        principal,
        dueAmount,
        ratePct,
        dueDays: rules.loanDueDays,
        dueAt,
      },
    })
    const award = await awardPointsTx(tx, userId, {
      amount: principal,
      reason: 'company_loan_borrow',
      note: `向公司「${membership.company.name}」借款 ${principal} 积分（${rules.loanDueDays} 天内应还 ${dueAmount}）`,
    })
    return { loan, balance: award.balance }
  })

  return {
    balance: created.balance,
    loan: buildLoanDto({
      id: created.loan.id,
      companyId: created.loan.companyId,
      companyName: membership.company.name,
      principal: created.loan.principal,
      dueAmount: created.loan.dueAmount,
      repaid: created.loan.repaid,
      ratePct: created.loan.ratePct,
      dueDays: created.loan.dueDays,
      status: created.loan.status,
      borrowedAtMs: created.loan.borrowedAt.getTime(),
      dueAtMs: created.loan.dueAt.getTime(),
      nowMs,
    }),
  }
}

export interface RepayResult {
  balance: number
  paid: number
  remaining: number
  settled: boolean
  companyName: string
}

export async function repayLoan(userId: number, loanId: number, requested: number | undefined, nowMs = Date.now()): Promise<RepayResult> {
  const id = Math.trunc(loanId)
  if (!Number.isInteger(id) || id <= 0) throw new AppError('贷款不存在', 404, 'COMPANY_LOAN_NOT_FOUND')
  await settleLoansForUser(prisma, userId, new Date(nowMs))

  // 还款不要求还在公司里：被踢 / 已退司的人欠的钱照样要还，还进去的是那家公司的池子
  return prisma.$transaction(async (tx) => {
    const loan = await tx.companyLoan.findUnique({
      where: { id },
      include: { company: { select: { id: true, name: true } }, },
    })
    if (!loan || loan.userId !== userId) throw new AppError('贷款不存在', 404, 'COMPANY_LOAN_NOT_FOUND')
    const remaining = loanRemaining(loan.dueAmount, loan.repaid)
    if (remaining <= 0) throw new AppError('这笔贷款已经还清了', 409, 'COMPANY_LOAN_SETTLED')
    const want = requested === undefined || Number.isNaN(requested) ? remaining : Math.trunc(requested)
    if (!Number.isFinite(want) || want <= 0) throw new AppError('还款积分必须是正整数', 400)
    // 多还自动截到剩余应还：信贷不该出现「存钱进去」这种状态
    const pay = Math.min(want, remaining)

    const spend = await spendPointsTx(tx, userId, pay, {
      reason: 'company_loan_repay',
      note: `归还公司「${loan.company.name}」贷款 ${pay} 积分`,
    })
    const settledNow = loan.repaid + pay >= loan.dueAmount
    // CAS 钉在 repaid 上：并发两笔部分还款只有一笔能落，绝不双重记账
    const updated = await tx.companyLoan.updateMany({
      where: { id: loan.id, userId, status: { not: 'repaid' }, repaid: loan.repaid },
      data: {
        repaid: loan.repaid + pay,
        status: settledNow ? 'repaid' : loan.status,
        settledAt: settledNow ? new Date(nowMs) : loan.settledAt,
      },
    })
    if (updated.count !== 1) throw new AppError('贷款状态刚有变化，请刷新后重试', 409, 'COMPANY_LOAN_CONFLICT')
    // 本金 + 利息一起回流资金池；利息不计入营业额（那是卖货的口径，不能靠放贷刷减免档）
    await tx.company.updateMany({ where: { id: loan.companyId }, data: { poolBalance: { increment: pay } } })
    return { balance: spend.balance, paid: pay, remaining: Math.max(0, remaining - pay), settled: settledNow, companyName: loan.company.name }
  })
}

/* ============================================================
   解散
   ============================================================ */

export async function disbandCompany(actorId: number, companyId: number | null, byAdmin = false, nowMs = Date.now()) {
  const target = companyId ?? (await requireMembership(prisma, actorId)).companyId
  if (!byAdmin) {
    const row = await prisma.companyMember.findUnique({
      where: { companyId_userId: { companyId: target, userId: actorId } },
      select: { role: true },
    })
    if (!row) throw new AppError('你不在这家公司里', 404)
    // 「仅发起人能解散」：解散会把池子分掉，这个权力必须钉死在 CEO 上
    if (row.role !== 'ceo') throw new AppError('只有发起人能解散公司', 403, 'COMPANY_NOT_CEO')
  }
  const company = await prisma.company.findUnique({ where: { id: target }, include: { owner: { select: userSelect } } })
  if (!company) throw new AppError('公司不存在', 404, 'COMPANY_NOT_FOUND')
  if (company.status === COMPANY_STATUS_DISBANDED) throw new AppError('这家公司已经解散了', 409)

  await settleLoansForCompany(prisma, company.id, new Date(nowMs))
  const loans = await prisma.companyLoan.findMany({
    where: { companyId: company.id, status: { not: 'repaid' } },
    select: { principal: true, dueAmount: true, repaid: true, status: true },
  })
  const unsettled = loans.filter((loan) => isLoanUnsettled(loan.status, loan.repaid, loan.dueAmount)).length
  if (unsettled > 0) {
    throw new AppError(`还有 ${unsettled} 笔贷款没有结清，全部还清后才能解散`, 409, 'COMPANY_LOANS_OPEN')
  }

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.company.updateMany({
      where: { id: company.id, status: { not: COMPANY_STATUS_DISBANDED } },
      data: { status: COMPANY_STATUS_DISBANDED, disbandedAt: new Date(nowMs), foundingExpiresAt: null },
    })
    if (claimed.count !== 1) throw new AppError('公司状态已变化，请刷新后重试', 409, 'COMPANY_STATE_CHANGED')
    await tx.companyInvite.updateMany({ where: { companyId: company.id, status: 'pending' }, data: { status: 'expired' } })
    await liquidateTx(tx, company.id)
  })
  return { disbanded: true, companyId: company.id }
}

/* ============================================================
   管理端
   ============================================================ */

export interface CompanyAdminOverview {
  counts: { total: number; founding: number; active: number; disbanded: number }
  pools: { poolBalance: number; revenue: number; loansOpen: number; loansOverdue: number }
  topRevenue: Array<{ id: number; name: string; revenue: number; poolBalance: number; level: number; members: number }>
  rules: CompanyConfigValues
  shape: ReturnType<typeof companyConfigShape>
}

export async function getCompanyAdminOverview(topLimit = 10): Promise<CompanyAdminOverview> {
  const rules = await getCompanyConfig()
  const [total, founding, active, disbanded, agg, loansOpen, loansOverdue, top] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { status: COMPANY_STATUS_FOUNDING } }),
    prisma.company.count({ where: { status: COMPANY_STATUS_ACTIVE } }),
    prisma.company.count({ where: { status: COMPANY_STATUS_DISBANDED } }),
    prisma.company.aggregate({ _sum: { poolBalance: true, revenue: true } }),
    prisma.companyLoan.count({ where: { status: 'open' } }),
    prisma.companyLoan.count({ where: { status: 'overdue' } }),
    prisma.company.findMany({
      where: { status: { not: COMPANY_STATUS_DISBANDED } },
      select: { id: true, name: true, revenue: true, poolBalance: true, tierMask: true, _count: { select: { members: true } } },
      orderBy: { revenue: 'desc' },
      take: Math.max(1, Math.trunc(topLimit)),
    }),
  ])
  return {
    counts: { total, founding, active, disbanded },
    pools: {
      poolBalance: agg._sum.poolBalance ?? 0,
      revenue: agg._sum.revenue ?? 0,
      loansOpen,
      loansOverdue,
    },
    topRevenue: top.map((row) => ({
      id: row.id,
      name: row.name,
      revenue: row.revenue,
      poolBalance: row.poolBalance,
      level: companyLevelOf(row.tierMask),
      members: row._count.members,
    })),
    rules,
    shape: companyConfigShape(),
  }
}
