/**
 * 公共银行官方贷款服务：放款（CAS 扣池）→ 还款（本息全额回流）→ 逾期惰性翻转。
 *
 * 算式与额度口径全部在 lib/crisisRules.ts（OFFICIAL_LOAN_* 常量 + officialLoanRateOf /
 * officialLoanBaseRateOf），本文件只做数据库编排。三个不变量：
 * 1. **资金来源是 CrisisPool**：放款必须在事务内 CAS 扣池（余额不足 409），还款本息全额
 *    increment 回池——「放出去的每一分都来自池子，还回来的每一分都回到池子」；
 * 2. **同一时间每人仅一笔未结清贷款**（open | overdue 都挡新借）：靠借款前先查实现，
 *    不做 DB 唯一约束（repaid 的历史行必须保留在列表里，且翻转窗口内并发双借的最坏结果
 *    只是池子多放一笔，扣池 CAS 保证不透支）；
 * 3. **利率在放款时快照冻结**：基准利率每次现读 CompanyConfig（官方利率 = 全站最差民间
 *    利率 + 溢价），存量贷款不受之后调率影响。
 */
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { awardPointsTx, spendPointsTx } from './pointsService.js'
import { COMPANY_LOAN_RATE_PCT, computeLoanDue, loanDueAtOf, loanRemaining } from '../lib/companyRules.js'
import {
  OFFICIAL_LOAN_BORROW_REASON,
  OFFICIAL_LOAN_DUE_DAYS,
  OFFICIAL_LOAN_MAX,
  OFFICIAL_LOAN_MIN,
  OFFICIAL_LOAN_REPAY_REASON,
  OFFICIAL_RATE_PREMIUM_PCT,
  officialLoanBaseRateOf,
  officialLoanRateOf,
} from '../lib/crisisRules.js'
import type { Prisma } from '@prisma/client'

export interface OfficialLoanDto {
  id: number
  principal: number
  dueAmount: number
  ratePct: number
  dueDays: number
  repaid: number
  remaining: number
  status: 'open' | 'repaid' | 'overdue'
  borrowedAt: string
  dueAt: string
  settledAt: string | null
}

/** 池子行必须先存在，否则 CAS 扣池 / 回流会因 where 匹配不到恒为 count=0（crisisService.ensurePoolRow 同款做法，就地内联避免跨服务耦合） */
async function ensurePoolRowTx(tx: Prisma.TransactionClient): Promise<void> {
  await tx.crisisPool.upsert({
    where: { id: 1 },
    create: { id: 1, total: BigInt(0) },
    update: {},
  })
}

async function readPoolAvailable(): Promise<string> {
  const row = await prisma.crisisPool.findUnique({ where: { id: 1 }, select: { total: true } })
  return (row?.total ?? BigInt(0)).toString()
}

function toDto(row: {
  id: number
  principal: number
  dueAmount: number
  repaid: number
  ratePct: number
  dueDays: number
  status: string
  borrowedAt: Date
  dueAt: Date
  settledAt: Date | null
  nowMs: number
}): OfficialLoanDto {
  // DTO 出口兜底一次：逾期行还没被惰性翻过时也按 overdue 展示（与 companyRules.buildLoanDto 同思路）
  const status: OfficialLoanDto['status'] =
    row.status === 'open' && row.dueAt.getTime() <= row.nowMs ? 'overdue' : (row.status as OfficialLoanDto['status'])
  return {
    id: row.id,
    principal: row.principal,
    dueAmount: row.dueAmount,
    ratePct: row.ratePct,
    dueDays: row.dueDays,
    repaid: row.repaid,
    remaining: loanRemaining(row.dueAmount, row.repaid),
    status,
    borrowedAt: row.borrowedAt.toISOString(),
    dueAt: row.dueAt.toISOString(),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
  }
}

/** 惰性逾期翻转：到期未还的 open 行就地翻成 overdue（读写前都先执行，无定时器） */
async function flipOverdueFor(userId: number): Promise<void> {
  await prisma.officialLoan.updateMany({
    where: { userId, status: 'open', dueAt: { lt: new Date() } },
    data: { status: 'overdue' },
  })
}

/** 全局版翻转：列表页在跨用户读取前调用（走 [status, dueAt] 索引，一次 updateMany） */
export async function flipOverdueAll(): Promise<void> {
  await prisma.officialLoan.updateMany({
    where: { status: 'open', dueAt: { lt: new Date() } },
    data: { status: 'overdue' },
  })
}

/**
 * 官方贷款基准利率（%）：全站最差民间利率。
 * 读 CompanyConfig 单行 JSON 的 loanRatePct 数组；行缺失 / JSON 脏 / 字段缺失一律回退
 * 代码默认档位表（与 companyService 的 normalize 回退口径一致，宁可保守也不让放贷失败）。
 */
export async function getOfficialLoanBaseRatePct(): Promise<number> {
  try {
    const row = await prisma.companyConfig.findUnique({ where: { id: 1 } })
    if (row?.config) {
      try {
        const parsed: unknown = JSON.parse(row.config)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const rates = (parsed as Record<string, unknown>).loanRatePct
          if (Array.isArray(rates)) {
            return officialLoanBaseRateOf(rates.filter((value): value is number => typeof value === 'number'))
          }
        }
      } catch {
        // JSON 脏数据 → 落到下面的默认档位表
      }
    }
  } catch (err) {
    console.warn('[officialLoan] 读取公司利率配置失败，按默认档位表处理：', err instanceof Error ? err.message : err)
  }
  return officialLoanBaseRateOf(COMPANY_LOAN_RATE_PCT)
}

export interface OfficialLoanBorrowResult {
  loan: OfficialLoanDto
  /** 放款后公共银行可贷余额（BigInt 字符串出口） */
  poolAvailable: string
}

export async function borrowOfficialLoan(userId: number, requestedAmount: number): Promise<OfficialLoanBorrowResult> {
  // 非整数直接拒绝（悄悄 floor 会把 100.5 变成 100 的贷款）；NaN / 越界一并挡在 400
  const amount = Math.trunc(requestedAmount)
  if (!Number.isFinite(requestedAmount) || !Number.isInteger(requestedAmount) || amount < OFFICIAL_LOAN_MIN || amount > OFFICIAL_LOAN_MAX) {
    throw new AppError(`官方贷款金额须为 ${OFFICIAL_LOAN_MIN}–${OFFICIAL_LOAN_MAX} 的整数`, 400, 'OFFICIAL_LOAN_AMOUNT_INVALID')
  }

  // 读写前先翻逾期：查「未结清」前必须让状态机先走到位
  await flipOverdueFor(userId)
  const unsettled = await prisma.officialLoan.findFirst({
    where: { userId, status: { in: ['open', 'overdue'] } },
    select: { id: true },
  })
  if (unsettled) {
    throw new AppError('您还有一笔官方贷款未结清，还清后才能再次借款', 409, 'OFFICIAL_LOAN_UNSETTLED')
  }

  // 基准利率在事务外现读（只读、失败有回退）；利率与期限在放款瞬间快照进贷款行
  const baseRatePct = await getOfficialLoanBaseRatePct()
  const ratePct = officialLoanRateOf(baseRatePct)
  const dueAmount = computeLoanDue(amount, ratePct)
  const nowMs = Date.now()

  const created = await prisma.$transaction(async (tx) => {
    await ensurePoolRowTx(tx)
    // CAS 扣公共银行：余额不足（或并发被抢先）count !== 1 → 409，事务整体回滚不留半笔账
    const deducted = await tx.crisisPool.updateMany({
      where: { id: 1, total: { gte: BigInt(amount) } },
      data: { total: { decrement: BigInt(amount) } },
    })
    if (deducted.count !== 1) {
      throw new AppError('公共银行可贷余额不足，请稍后再试', 409, 'OFFICIAL_LOAN_POOL_INSUFFICIENT')
    }
    const loan = await tx.officialLoan.create({
      data: {
        userId,
        principal: amount,
        dueAmount,
        ratePct,
        dueDays: OFFICIAL_LOAN_DUE_DAYS,
        status: 'open',
        borrowedAt: new Date(nowMs),
        dueAt: new Date(loanDueAtOf(nowMs, OFFICIAL_LOAN_DUE_DAYS)),
      },
    })
    // 放款到账走统一台账；awardPointsTx 不抽税（加分不是消费），reason 供积分流水页映射
    await awardPointsTx(tx, userId, {
      amount,
      reason: OFFICIAL_LOAN_BORROW_REASON,
      game: null,
      note: `官方贷款（${OFFICIAL_LOAN_DUE_DAYS} 天，年息 ${ratePct}%）`,
    })
    return loan
  })

  return { loan: toDto({ ...created, nowMs }), poolAvailable: await readPoolAvailable() }
}

export interface OfficialLoanRepayResult {
  loan: OfficialLoanDto
  /** 还款后公共银行可贷余额（BigInt 字符串出口） */
  poolAvailable: string
}

export async function repayOfficialLoan(userId: number, loanId: number): Promise<OfficialLoanRepayResult> {
  await flipOverdueFor(userId)
  const row = await prisma.officialLoan.findFirst({ where: { id: loanId, userId } })
  if (!row) throw new AppError('贷款不存在', 404)
  if (row.status === 'repaid') throw new AppError('该贷款已经还清', 409, 'OFFICIAL_LOAN_ALREADY_REPAID')
  // 全额还清：open 行的 repaid 恒为 0，这里统一按「应还 - 已还」算，脏数据也夹得住
  const remaining = loanRemaining(row.dueAmount, row.repaid)
  if (remaining <= 0) throw new AppError('该贷款没有待还金额', 409, 'OFFICIAL_LOAN_ALREADY_REPAID')

  const now = new Date()
  const loan = await prisma.$transaction(async (tx) => {
    // 先扣款：余额不足由 spendPointsTx 抛 400「积分不足」，透传给前端即可
    await spendPointsTx(tx, userId, remaining, {
      reason: OFFICIAL_LOAN_REPAY_REASON,
      game: null,
      note: `官方贷款还款（${OFFICIAL_LOAN_DUE_DAYS} 天，年息 ${row.ratePct}%）`,
    })
    // CAS 钉结清：并发双击还款只有一笔能把 open/overdue 翻成 repaid，输家整事务回滚（含扣款）
    const settled = await tx.officialLoan.updateMany({
      where: { id: row.id, userId, status: { in: ['open', 'overdue'] } },
      data: { status: 'repaid', repaid: row.dueAmount, settledAt: now },
    })
    if (settled.count !== 1) {
      throw new AppError('贷款状态已变化，请刷新后重试', 409, 'OFFICIAL_LOAN_STALE')
    }
    // 本金 + 利息全额回流公共银行（放款时已确保池子行存在，这里再兜一次防脏数据）
    await ensurePoolRowTx(tx)
    await tx.crisisPool.update({ where: { id: 1 }, data: { total: { increment: BigInt(row.dueAmount) } } })
    return tx.officialLoan.findUnique({ where: { id: row.id } })
  })

  if (!loan) throw new AppError('贷款不存在', 404)
  return { loan: toDto({ ...loan, nowMs: now.getTime() }), poolAvailable: await readPoolAvailable() }
}

export interface OfficialLoanListResult {
  ratePct: number
  baseRatePct: number
  premiumPct: number
  dueDays: number
  /** 公共银行可贷余额（BigInt 字符串出口） */
  poolAvailable: string
  minAmount: number
  maxAmount: number
  loans: OfficialLoanDto[]
}

export async function listOfficialLoans(userId: number): Promise<OfficialLoanListResult> {
  // 列表页用全局翻转（顺手把所有人的逾期也翻掉，走 [status, dueAt] 索引）
  await flipOverdueAll()
  const nowMs = Date.now()
  const [rows, baseRatePct, poolAvailable] = await Promise.all([
    // 模型没有 createdAt 列：借出顺序用 borrowedAt 表达（同一毫秒按 id 兜底，id 单调递增）
    prisma.officialLoan.findMany({ where: { userId }, orderBy: [{ borrowedAt: 'desc' }, { id: 'desc' }] }),
    getOfficialLoanBaseRatePct(),
    readPoolAvailable(),
  ])
  return {
    baseRatePct,
    ratePct: officialLoanRateOf(baseRatePct),
    premiumPct: OFFICIAL_RATE_PREMIUM_PCT,
    dueDays: OFFICIAL_LOAN_DUE_DAYS,
    poolAvailable,
    minAmount: OFFICIAL_LOAN_MIN,
    maxAmount: OFFICIAL_LOAN_MAX,
    loans: rows.map((row) => toDto({ ...row, nowMs })),
  }
}
