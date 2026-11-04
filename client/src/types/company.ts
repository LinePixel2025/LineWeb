/**
 * 公司（2026-11-04）：与 server/src/services/companyService.ts 的 DTO 一一对应。
 * 数值一律以服务端为准（价格 / 额度 / 减免比例都在服务端重算，前端只负责展示与提交 id + 数量）。
 */

export interface CompanyUser {
  id: number
  username: string
}

export interface CompanyMember extends CompanyUser {
  role: string
  joinedAt: string
  isMe: boolean
  outstanding: number
}

export interface CompanyTierProgress {
  level: number
  next: { tier: number; threshold: number; reductionPct: number; remaining: number } | null
  reductionPct: number
}

/**
 * 公司放贷设置出口口径：ratePct/maxPrincipal/dueDays 为「生效值」
 * （公司设置非 0 优先，0 = 跟随全站档位，服务端已合并好）；
 * enabled/membersOnly 取公司自身设置。
 */
export interface CompanyLoanSettingsView {
  enabled: boolean
  ratePct: number
  maxPrincipal: number
  dueDays: number
  membersOnly: boolean
}

/** 本人在这家公司的资金池投资份额（未投资过为 null） */
export interface CompanyPoolShare {
  amount: number
  earned: number
}

export interface Company {
  id: number
  name: string
  status: string
  owner: CompanyUser
  level: number
  tierMask: number
  poolBalance: number
  revenue: number
  memberCount: number
  maxMembers: number
  foundingExpiresAt: string | null
  foundingRemainingMs: number
  createdAt: string
  tier: CompanyTierProgress
  loanSettings: CompanyLoanSettingsView
  myPoolInvestment: CompanyPoolShare | null
  members: CompanyMember[]
}

export interface CompanyListing {
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
  donor: CompanyUser
  isMine: boolean
  createdAt: string
}

export interface CompanyOrder {
  id: number
  companyId: number
  companyName: string
  buyer: CompanyUser
  itemName: string
  amount: number
  unitPrice: number
  total: number
  createdAt: string
}

export interface CompanyInvite {
  id: number
  companyId: number
  companyName: string
  target: CompanyUser
  inviter: CompanyUser
  status: string
  createdAt: string
}

export interface CompanyDonateOption {
  source: 'farm_seed' | 'raid_item'
  itemKey: string
  itemName: string
  emoji: string
  rarity: string
  rarityLabel: string
  capRarity: string
  owned: number
  referencePrice: number
  band: { min: number; max: number } | null
  donationCap: number
  restockCap: number
  restockLeft: number
}

export interface CompanyLoanSummary {
  level: number
  cap: number
  ratePct: number
  dueDays: number
  outstanding: number
  remaining: number
  blockedByOverdue: boolean
}

export interface CompanyLoan {
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
  msUntilDue: number
  overdueMs: number
}

export interface CompanyRules {
  priceBandMin: number
  priceBandMax: number
  loanDueDays: number
  [key: string]: unknown
}

export interface CompanyMe {
  company: Company | null
  myRole: string | null
  invitesReceived: CompanyInvite[]
  invitesSent: CompanyInvite[]
  listings: CompanyListing[]
  myDonations: CompanyListing[]
  loans: CompanyLoan[]
  loanSummary: CompanyLoanSummary | null
  donateOptions: CompanyDonateOption[]
  rules: CompanyRules
  limits: { minMembers: number; maxMembers: number }
}

export interface CompanyMarket {
  listings: CompanyListing[]
  total: number
  page: number
  pageSize: number
  recentOrders?: CompanyOrder[]
}

export interface CompanyDetail {
  company: Company
  listings: CompanyListing[]
  recentOrders: CompanyOrder[]
}

/** 可借公司（GET /api/company/loan/offers） */
export interface CompanyLoanOffer {
  companyId: number
  name: string
  poolBalance: number
  level: number
  ratePct: number
  dueDays: number
  /** 0 = 按公司等级上限（前端显示「按公司等级」） */
  maxPrincipal: number
  membersOnly: boolean
}

/** 我的资金池投资份额（GET /api/company/pool/investments，跨公司） */
export interface CompanyPoolInvestment {
  companyId: number
  companyName: string
  amount: number
  earned: number
}
