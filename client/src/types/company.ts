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
