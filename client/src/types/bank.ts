/**
 * 银行系统（GET /api/bank 总览 + 存取 / 申赎动作）的前端类型。
 * 与 server/src/services/bankService.ts 的 DTO 字段一致：
 * 金额一律是整数积分；净值保留 4 位小数；涨跌幅是「百分比数值」（1.23 表示 +1.23%）。
 */

/** 活期账户（年化 2%，利息按日惰性结算） */
export interface BankDemand {
  balance: number
  annualRate: number
  /** 本次读取时刚结算的利息（0 表示本次无利息入账） */
  interestToday: number
}

/** 定期期限档（含当前持有该档的 active 存单数） */
export interface BankFixedTerm {
  key: string
  label: string
  days: number
  annualRate: number
  holdings: number
}

/** 定期存单（总览只下发最近 50 张，active 在前） */
export interface BankDeposit {
  id: number
  termKey: string
  termLabel: string
  principal: number
  annualRate: number
  startAt: string
  maturityAt: string
  status: 'active' | 'redeemed'
  /** 距到期剩余天数（向上取整；已到期为 0） */
  remainingDays: number
  matured: boolean
  /** 到期可得利息 */
  matureInterest: number
  /** 现在支取的预估利息（到期 = 全额；未到期 = 按活期） */
  currentInterestEstimate: number
}

/** 基金行情 + 我的持仓 */
export interface BankFund {
  code: string
  name: string
  emoji: string
  color: string
  /** 今日净值（4 位小数） */
  nav: number
  /** 昨日净值（4 位小数） */
  prevNav: number
  /** 今日涨跌幅（百分比数值） */
  changePct: number
  /** 近 14 日净值序列（画迷你走势） */
  navSeries: { date: string; nav: number }[]
  holding: {
    shares: number
    costPoints: number
    /** 按今日净值估算的市值（整数积分） */
    value: number
  }
}

/** 最近积分流水（只含银行 / 基金相关 reason，倒序） */
export interface BankLedgerEntry {
  id: number
  amount: number
  balance: number
  reason: string
  note: string | null
  createdAt: string
}

/** 总览（GET /api/bank） */
export interface BankOverview {
  dateKey: string
  /** 可用积分余额（可用于存入 / 买入） */
  balance: number
  demand: BankDemand
  fixedTerms: BankFixedTerm[]
  deposits: BankDeposit[]
  funds: BankFund[]
  trades: BankLedgerEntry[]
  rules: {
    minAmount: number
    maxAmount: number
    fundFeeRate: number
  }
}

/** 活期存入 / 取出结果 */
export interface BankDemandResult {
  balance: number
  demandBalance: number
}

/** 开定期存单结果 */
export interface BankFixedOpenResult {
  balance: number
  deposit: BankDeposit
}

/** 支取存单结果 */
export interface BankFixedRedeemResult {
  balance: number
  depositId: number
  principal: number
  /** 实付利息（到期 = 全额；提前 = 活期） */
  interest: number
  total: number
  matured: boolean
  elapsedDays: number
}

/** 买入基金结果 */
export interface FundBuyResult {
  balance: number
  fundCode: string
  fundName: string
  nav: number
  points: number
  fee: number
  shares: number
  holding: { shares: number; costPoints: number; value: number }
}

/** 卖出基金结果 */
export interface FundSellResult {
  balance: number
  fundCode: string
  fundName: string
  nav: number
  shares: number
  gross: number
  fee: number
  proceeds: number
  /** 本次卖出分摊的成本（整仓 = 全部成本） */
  costPoints: number
  remainingShares: number
  closed: boolean
}
