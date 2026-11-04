/**
 * 银行系统服务：活期 / 定期存款与基金投资，全部走统一积分。
 *
 * 口径：
 * - 活期利息在读时惰性结算（无定时器）：每次进事务先 settle，把利息发进积分余额
 *   并把结算水位推进到今天；水位落后超 365 天按 365 封顶（防补天量利息）；
 * - 活期存取用条件更新防并发（withdraw 需 demandBalance ≥ amount，count=0 报余额不足）；
 * - 定期存单开单锁定利率，到期全额计息、提前支取按活期计息，支取用条件更新防重复支取；
 * - 基金 NAV 当日确定（bankRules.fundNavOn），买入 / 卖出各收 0.25% 手续费，
 *   卖出份额用条件更新防并发超卖，成本按比例分摊；
 * - 所有积分变动写 PointsLedger（reason = bank_* / fund_*，game = null 不占游戏日上限），
 *   基金成交另写 FundTrade（append-only，含 NAV / 份额 / 手续费，对账用）。
 *
 * 锁序统一：BankAccount（settle）→ User（spend/award）→ 业务行 → 流水表（append）。
 */

import prisma from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'
import { AppError } from '../middleware/errorHandler.js'
import { getTodayDateKey } from '../lib/pointsRules.js'
import {
  BANK_FUNDS,
  BANK_MAX_AMOUNT,
  BANK_MIN_AMOUNT,
  DEMAND_ANNUAL_RATE,
  FUND_FEE_RATE,
  FIXED_TERMS,
  bankFixedTermOf,
  bankFundOf,
  calcDemandSettlement,
  calcEarlyWithdrawInterest,
  calcFixedInterest,
  clampBankAmount,
  fundNavOn,
  fundNavSeries,
  quoteFundBuy,
  quoteFundSell,
  roundNav,
  shiftDateKey,
  splitFundCost,
} from '../lib/bankRules.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'

type Db = Prisma.TransactionClient

/** 一天的毫秒数（定期起止时刻按自然日推算） */
const DAY_MS = 86_400_000

/* ============================================================
   账户与利息结算
   ============================================================ */

/** 取（或惰性建）银行账户行；水位初始为建行当天（首日不计息） */
export async function ensureBankAccountTx(tx: Db, userId: number) {
  return tx.bankAccount.upsert({
    where: { userId },
    update: {},
    create: { userId, demandBalance: 0, lastInterestDateKey: getTodayDateKey() },
  })
}

/**
 * 活期利息惰性结算（必须在事务内调用）：
 * - 利息 > 0 → awardPointsTx(reason=bank_interest, game=null) 并推进水位；
 * - 利息 = 0（无余额 / 已结到今天 / 水位无效）→ 只推进水位（无效水位重置为今天）。
 * 返回本次结算出的利息（用于 DTO 展示「今日利息」）。
 */
export async function settleDemandInterestTx(tx: Db, userId: number): Promise<number> {
  const account = await ensureBankAccountTx(tx, userId)
  const today = getTodayDateKey()
  if (account.lastInterestDateKey === today) return 0

  const settlement = calcDemandSettlement(account.demandBalance, account.lastInterestDateKey, today)
  if (settlement.interest > 0) {
    await awardPointsTx(tx, userId, {
      amount: settlement.interest,
      reason: 'bank_interest',
      game: null,
      note: `活期利息（${settlement.days} 天，年化 ${Math.round(DEMAND_ANNUAL_RATE * 1000) / 10}%）`,
    })
  }
  await tx.bankAccount.update({
    where: { userId },
    data: { lastInterestDateKey: today },
  })
  return settlement.interest
}

/* ============================================================
   DTO 组装
   ============================================================ */

export interface BankDemandDto {
  balance: number
  annualRate: number
  /** 本次读取时刚结算的利息（0 表示本次无利息入账） */
  interestToday: number
}

export interface BankFixedTermDto {
  key: string
  label: string
  days: number
  annualRate: number
  /** 当前持有该档的 active 存单数 */
  holdings: number
}

export interface BankDepositDto {
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
  /** 是否已到到期时刻 */
  matured: boolean
  /** 到期可得利息（floor(本金 × 年化 × 期限天数/365)） */
  matureInterest: number
  /** 现在支取的预估利息（到期 = 全额；未到期 = 按活期） */
  currentInterestEstimate: number
}

export interface BankFundDto {
  code: string
  name: string
  emoji: string
  color: string
  /** 今日净值（4 位小数） */
  nav: number
  /** 昨日净值（4 位小数） */
  prevNav: number
  /** 今日涨跌幅（百分比数值，1.23 表示 +1.23%） */
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
export interface BankLedgerEntryDto {
  id: number
  amount: number
  balance: number
  reason: string
  note: string | null
  createdAt: string
}

export interface BankOverviewDto {
  dateKey: string
  /** 可用积分余额（可用于存入 / 买入） */
  balance: number
  demand: BankDemandDto
  fixedTerms: BankFixedTermDto[]
  deposits: BankDepositDto[]
  funds: BankFundDto[]
  trades: BankLedgerEntryDto[]
  rules: {
    minAmount: number
    maxAmount: number
    fundFeeRate: number
  }
}

/** 银行 / 基金 / 公司信贷相关积分流水 reason（与 schema 注释枚举一致）；银行页有「贷款」区，公司借款与资金池投资流水也在这里展示 */
const BANK_LEDGER_REASONS = [
  'bank_deposit_in',
  'bank_demand_withdraw',
  'bank_fixed_open',
  'bank_fixed_redeem',
  'bank_interest',
  'fund_buy',
  'fund_sell',
  'company_loan_borrow',
  'company_loan_repay',
  'company_pool_invest',
  'company_pool_redeem',
]

function depositDtoOf(
  row: {
    id: number
    termKey: string
    principal: number
    annualRate: number
    startAt: Date
    maturityAt: Date
    status: string
  },
  now: number,
): BankDepositDto {
  const term = bankFixedTermOf(row.termKey)
  // 目录里没有该档时（后期改目录）用起止时刻推算全额天数兜底
  const termDays = term?.days ?? Math.max(1, Math.round((row.maturityAt.getTime() - row.startAt.getTime()) / DAY_MS))
  const matured = now >= row.maturityAt.getTime()
  const elapsedDays = Math.max(0, Math.floor((now - row.startAt.getTime()) / DAY_MS))
  const matureInterest = calcFixedInterest(row.principal, row.annualRate, termDays)
  return {
    id: row.id,
    termKey: row.termKey,
    termLabel: term?.label ?? row.termKey,
    principal: row.principal,
    annualRate: row.annualRate,
    startAt: row.startAt.toISOString(),
    maturityAt: row.maturityAt.toISOString(),
    status: row.status === 'active' ? 'active' : 'redeemed',
    remainingDays: matured ? 0 : Math.max(1, Math.ceil((row.maturityAt.getTime() - now) / DAY_MS)),
    matured,
    matureInterest,
    currentInterestEstimate: matured
      ? matureInterest
      : calcEarlyWithdrawInterest(row.principal, elapsedDays),
  }
}

/** 总览（先惰性结息再读全量），一次事务保证利息与读取一致 */
export async function getBankOverview(userId: number): Promise<BankOverviewDto> {
  const today = getTodayDateKey()
  const now = Date.now()

  const data = await prisma.$transaction(async (tx) => {
    const interestToday = await settleDemandInterestTx(tx, userId)
    const account = await tx.bankAccount.findUnique({ where: { userId } })
    const [user, deposits, holdings, ledger] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { points: true } }),
      tx.bankDeposit.findMany({
        // 总览只下发未支取的存单（redeemed 行保留在库里作对账）
        where: { userId, status: 'active' },
        orderBy: [{ maturityAt: 'asc' }, { id: 'desc' }],
        take: 50,
      }),
      tx.fundHolding.findMany({ where: { userId } }),
      tx.pointsLedger.findMany({
        where: { userId, reason: { in: BANK_LEDGER_REASONS } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 30,
      }),
    ])
    return { interestToday, account, user, deposits, holdings, ledger }
  })

  const demandBalance = data.account?.demandBalance ?? 0

  // 定期档：目录 + 每档当前持有单数
  const activeDeposits = data.deposits.filter((row) => row.status === 'active')
  const fixedTerms: BankFixedTermDto[] = FIXED_TERMS.map((term) => ({
    key: term.key,
    label: term.label,
    days: term.days,
    annualRate: term.annualRate,
    holdings: activeDeposits.filter((row) => row.termKey === term.key).length,
  }))

  // 基金：NAV / 涨跌 / 近 14 日序列 / 持仓
  const yesterdayKey = shiftDateKey(today, -1)
  const funds: BankFundDto[] = BANK_FUNDS.map((fund) => {
    const nav = roundNav(fundNavOn(fund.code, today))
    const prevNav = roundNav(fundNavOn(fund.code, yesterdayKey))
    const changePct = prevNav > 0 ? Math.round(((nav - prevNav) / prevNav) * 10_000) / 100 : 0
    const holding = data.holdings.find((row) => row.fundCode === fund.code)
    const shares = holding?.shares ?? 0
    return {
      code: fund.code,
      name: fund.name,
      emoji: fund.emoji,
      color: fund.color,
      nav,
      prevNav,
      changePct,
      navSeries: fundNavSeries(fund.code, shiftDateKey(today, -13), today),
      holding: {
        shares: Math.round(shares * 10_000) / 10_000,
        costPoints: holding?.costPoints ?? 0,
        value: Math.max(0, Math.round(shares * nav)),
      },
    }
  })

  return {
    dateKey: today,
    balance: data.user?.points ?? 0,
    demand: {
      balance: demandBalance,
      annualRate: DEMAND_ANNUAL_RATE,
      interestToday: data.interestToday,
    },
    fixedTerms,
    deposits: data.deposits.map((row) => depositDtoOf(row, now)),
    funds,
    trades: data.ledger.map((row) => ({
      id: row.id,
      amount: row.amount,
      balance: row.balance,
      reason: row.reason,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    })),
    rules: {
      minAmount: BANK_MIN_AMOUNT,
      maxAmount: BANK_MAX_AMOUNT,
      fundFeeRate: FUND_FEE_RATE,
    },
  }
}

/* ============================================================
   活期存取
   ============================================================ */

export interface BankDemandResult {
  balance: number
  demandBalance: number
}

function parseAmount(amount: unknown, action: string): number {
  const value = clampBankAmount(amount)
  if (Number.isNaN(value)) {
    throw new AppError(
      `${action}金额需为 ${BANK_MIN_AMOUNT}–${BANK_MAX_AMOUNT} 之间的整数积分`,
      400,
      'BANK_AMOUNT_INVALID',
    )
  }
  return value
}

/** 活期存入：可用积分 → 活期本金（先结息再存，保证余额与水位一致） */
export async function depositDemand(userId: number, amount: unknown): Promise<BankDemandResult> {
  const value = parseAmount(amount, '存入')
  return prisma.$transaction(async (tx) => {
    await settleDemandInterestTx(tx, userId)
    const spend = await spendPointsTx(tx, userId, value, {
      reason: 'bank_deposit_in',
      note: '活期存入',
    })
    const account = await tx.bankAccount.update({
      where: { userId },
      data: { demandBalance: { increment: value } },
      select: { demandBalance: true },
    })
    return { balance: spend.balance, demandBalance: account.demandBalance }
  })
}

/** 活期取出：条件更新防并发超取（余额不足 400） */
export async function withdrawDemand(userId: number, amount: unknown): Promise<BankDemandResult> {
  const value = parseAmount(amount, '取出')
  return prisma.$transaction(async (tx) => {
    await settleDemandInterestTx(tx, userId)
    const updated = await tx.bankAccount.updateMany({
      where: { userId, demandBalance: { gte: value } },
      data: { demandBalance: { decrement: value } },
    })
    if (updated.count === 0) {
      throw new AppError('活期余额不足', 400, 'BANK_BALANCE_INSUFFICIENT')
    }
    const award = await awardPointsTx(tx, userId, {
      amount: value,
      reason: 'bank_demand_withdraw',
      note: '活期取出',
    })
    const account = await tx.bankAccount.findUnique({
      where: { userId },
      select: { demandBalance: true },
    })
    return { balance: award.balance, demandBalance: account?.demandBalance ?? 0 }
  })
}

/* ============================================================
   定期存款
   ============================================================ */

export interface BankFixedOpenResult {
  balance: number
  deposit: BankDepositDto
}

/** 开定期存单：校验期限档 → 扣积分（锁定）→ 建单（maturityAt = startAt + 期限天数） */
export async function openFixedDeposit(
  userId: number,
  termKey: string,
  amount: unknown,
): Promise<BankFixedOpenResult> {
  const term = bankFixedTermOf(termKey)
  if (!term) {
    throw new AppError('期限档不存在', 400, 'BANK_TERM_INVALID')
  }
  const value = parseAmount(amount, '存入')
  const now = new Date()
  const maturityAt = new Date(now.getTime() + term.days * DAY_MS)

  return prisma.$transaction(async (tx) => {
    await settleDemandInterestTx(tx, userId)
    const spend = await spendPointsTx(tx, userId, value, {
      reason: 'bank_fixed_open',
      note: `定期存入（${term.label}，年化 ${Math.round(term.annualRate * 1000) / 10}%）`,
    })
    const deposit = await tx.bankDeposit.create({
      data: {
        userId,
        termKey: term.key,
        principal: value,
        annualRate: term.annualRate,
        startAt: now,
        maturityAt,
      },
    })
    return {
      balance: spend.balance,
      deposit: depositDtoOf(deposit, now.getTime()),
    }
  })
}

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

/** 支取定期存单（到期全额计息 / 提前按活期计息）；条件更新防并发重复支取 */
export async function redeemFixedDeposit(userId: number, depositId: number): Promise<BankFixedRedeemResult> {
  const id = Math.trunc(depositId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new AppError('存单不存在', 404, 'BANK_DEPOSIT_NOT_FOUND')
  }
  return prisma.$transaction(async (tx) => {
    const deposit = await tx.bankDeposit.findFirst({ where: { id, userId } })
    if (!deposit) throw new AppError('存单不存在', 404, 'BANK_DEPOSIT_NOT_FOUND')
    if (deposit.status !== 'active') {
      throw new AppError('该存单已支取', 400, 'BANK_DEPOSIT_REDEEMED')
    }

    const now = Date.now()
    const matured = now >= deposit.maturityAt.getTime()
    const term = bankFixedTermOf(deposit.termKey)
    const termDays = term?.days
      ?? Math.max(1, Math.round((deposit.maturityAt.getTime() - deposit.startAt.getTime()) / DAY_MS))
    const elapsedDays = Math.max(0, Math.floor((now - deposit.startAt.getTime()) / DAY_MS))
    const interest = matured
      ? calcFixedInterest(deposit.principal, deposit.annualRate, termDays)
      : calcEarlyWithdrawInterest(deposit.principal, elapsedDays)
    const total = deposit.principal + interest

    const award = await awardPointsTx(tx, userId, {
      amount: total,
      reason: 'bank_fixed_redeem',
      note: matured
        ? `定期到期支取（本金 ${deposit.principal} + 利息 ${interest}）`
        : `定期提前支取（已过 ${elapsedDays} 天，按活期计息 ${interest}）`,
    })
    const updated = await tx.bankDeposit.updateMany({
      where: { id: deposit.id, status: 'active' },
      data: { status: 'redeemed', interestPaid: interest, redeemedAt: new Date() },
    })
    if (updated.count === 0) {
      throw new AppError('存单已变化，请刷新后重试', 409, 'BANK_DEPOSIT_CONFLICT')
    }

    return {
      balance: award.balance,
      depositId: deposit.id,
      principal: deposit.principal,
      interest,
      total,
      matured,
      elapsedDays,
    }
  })
}

/* ============================================================
   基金申赎
   ============================================================ */

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

/** 买入基金（可分批加仓）：当日净值成交，0.25% 手续费，持仓 upsert */
export async function buyFund(userId: number, code: string, points: unknown): Promise<FundBuyResult> {
  const fund = bankFundOf(code)
  if (!fund) throw new AppError('没有这只基金', 404, 'BANK_FUND_NOT_FOUND')
  const value = parseAmount(points, '买入')
  const nav = roundNav(fundNavOn(fund.code, getTodayDateKey()))
  const quoted = quoteFundBuy(value, nav)
  if (quoted.shares <= 0) {
    throw new AppError('投入积分不足以买入任何份额', 400, 'BANK_FUND_SHARES_ZERO')
  }

  return prisma.$transaction(async (tx) => {
    await settleDemandInterestTx(tx, userId)
    const spend = await spendPointsTx(tx, userId, quoted.points, {
      reason: 'fund_buy',
      note: `${fund.name} 买入 ${quoted.shares.toFixed(2)} 份（净值 ${quoted.nav}）`,
    })
    const holding = await tx.fundHolding.upsert({
      where: { userId_fundCode: { userId, fundCode: fund.code } },
      create: { userId, fundCode: fund.code, shares: quoted.shares, costPoints: quoted.points },
      update: { shares: { increment: quoted.shares }, costPoints: { increment: quoted.points } },
    })
    await tx.fundTrade.create({
      data: {
        userId,
        fundCode: fund.code,
        type: 'buy',
        nav: quoted.nav,
        shares: quoted.shares,
        points: quoted.points,
        fee: quoted.fee,
      },
    })
    return {
      balance: spend.balance,
      fundCode: fund.code,
      fundName: fund.name,
      nav: quoted.nav,
      points: quoted.points,
      fee: quoted.fee,
      shares: Math.round(quoted.shares * 10_000) / 10_000,
      holding: {
        shares: Math.round(holding.shares * 10_000) / 10_000,
        costPoints: holding.costPoints,
        value: Math.max(0, Math.round(holding.shares * quoted.nav)),
      },
    }
  })
}

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
  /** 卖出后剩余份额（整仓为 0） */
  remainingShares: number
  closed: boolean
}

/** 卖出基金：当日净值成交、0.25% 手续费；条件更新防并发超卖，成本等比分摊 */
export async function sellFund(userId: number, code: string, shares: number): Promise<FundSellResult> {
  const fund = bankFundOf(code)
  if (!fund) throw new AppError('没有这只基金', 404, 'BANK_FUND_NOT_FOUND')
  if (!Number.isFinite(shares) || shares <= 0) {
    throw new AppError('卖出份额必须大于 0', 400, 'BANK_FUND_SHARES_INVALID')
  }

  return prisma.$transaction(async (tx) => {
    const holding = await tx.fundHolding.findUnique({
      where: { userId_fundCode: { userId, fundCode: fund.code } },
    })
    if (!holding) throw new AppError('你没有这只基金的持仓', 400, 'BANK_FUND_NO_HOLDING')
    const sellShares = Math.min(shares, holding.shares)

    const nav = roundNav(fundNavOn(fund.code, getTodayDateKey()))
    const quoted = quoteFundSell(sellShares, nav)
    const costPortion = splitFundCost(holding.costPoints, sellShares, holding.shares)

    let remainingShares = 0
    let closed = true
    if (holding.shares - sellShares <= 1e-9) {
      const deleted = await tx.fundHolding.deleteMany({
        where: { id: holding.id, shares: { gte: sellShares } },
      })
      if (deleted.count === 0) throw new AppError('持仓已变化，请刷新后重试', 409, 'BANK_FUND_CONFLICT')
    } else {
      const updated = await tx.fundHolding.updateMany({
        where: { id: holding.id, shares: { gte: sellShares } },
        data: {
          shares: { decrement: sellShares },
          costPoints: { decrement: costPortion },
        },
      })
      if (updated.count === 0) throw new AppError('持仓已变化，请刷新后重试', 409, 'BANK_FUND_CONFLICT')
      const refreshed = await tx.fundHolding.findUnique({
        where: { id: holding.id },
        select: { shares: true },
      })
      remainingShares = Math.max(0, refreshed?.shares ?? 0)
      closed = remainingShares <= 1e-9
    }

    const award = quoted.proceeds > 0
      ? await awardPointsTx(tx, userId, {
        amount: quoted.proceeds,
        reason: 'fund_sell',
        note: `${fund.name} 卖出 ${sellShares.toFixed(2)} 份（净值 ${quoted.nav}）`,
      })
      : { delta: 0, balance: (await tx.user.findUnique({ where: { id: userId }, select: { points: true } }))?.points ?? 0 }

    await tx.fundTrade.create({
      data: {
        userId,
        fundCode: fund.code,
        type: 'sell',
        nav: quoted.nav,
        shares: sellShares,
        points: quoted.proceeds,
        fee: quoted.fee,
      },
    })

    return {
      balance: award.balance,
      fundCode: fund.code,
      fundName: fund.name,
      nav: quoted.nav,
      shares: Math.round(sellShares * 10_000) / 10_000,
      gross: quoted.gross,
      fee: quoted.fee,
      proceeds: quoted.proceeds,
      costPoints: costPortion,
      remainingShares: Math.round(remainingShares * 10_000) / 10_000,
      closed,
    }
  })
}
