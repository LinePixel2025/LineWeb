import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { authenticate } from '../middleware/auth.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  getBankOverview,
  depositDemand,
  withdrawDemand,
  openFixedDeposit,
  redeemFixedDeposit,
  buyFund,
  sellFund,
} from '../services/bankService.js'
import {
  borrowOfficialLoan,
  listOfficialLoans,
  repayOfficialLoan,
} from '../services/officialLoanService.js'

/**
 * 银行系统：活期 / 定期存款（利息按日惰性结算）与基金投资（当日净值申赎），
 * 以及公共银行官方贷款（放款扣 CrisisPool、还款本息回流，资金来源 = 危机缴款池）。
 * 全部需登录；开关关闭时由 /api/bank 外层 requireFeature('bank') 拦截。
 */
const router = Router()
router.use(authenticate)

/** 读取（总览轮询）按用户限流（前端 15 秒/次；管理员豁免） */
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '请求过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

/** 存取 / 申赎写入按用户限流（管理员豁免，与股市交易口径一致） */
const writeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  message: { error: '操作过于频繁，请稍后再试' },
  skip: (req) => req.user?.role === 'admin',
})

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

const amountSchema = z.object({
  /** 存入 / 取出积分（service 层钳制到 100–100000 的整数） */
  amount: z.coerce.number(),
})

const depositOpenSchema = z.object({
  /** 期限档（7d / 30d / 90d） */
  termKey: z.string().trim().min(1).max(8),
  amount: z.coerce.number(),
})

const depositIdSchema = z.object({ id: z.coerce.number().int().positive() })

const fundCodeSchema = z.object({
  code: z.string().trim().min(1).max(16),
})

const fundBuySchema = fundCodeSchema.extend({
  /** 投入积分（service 层钳制到 100–100000 的整数） */
  points: z.coerce.number(),
})

const fundSellSchema = fundCodeSchema.extend({
  shares: z.coerce.number().min(0.0001).max(1e12),
})

/** 官方贷款借款金额（service 层钳制到 100–20000 的整数） */
const officialLoanAmountSchema = z.object({
  amount: z.coerce.number(),
})

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

// GET /api/bank — 总览：活期 / 定期 / 基金行情与持仓 / 最近流水（读取时惰性结息）
router.get('/', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getBankOverview(currentUserId(req)))
}))

// POST /api/bank/demand/deposit — { amount } 活期存入（可用积分 → 活期本金）
router.post('/demand/deposit', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(amountSchema, req.body ?? {})
  res.json(await depositDemand(currentUserId(req), input.amount))
}))

// POST /api/bank/demand/withdraw — { amount } 活期取出（余额不足 400）
router.post('/demand/withdraw', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(amountSchema, req.body ?? {})
  res.json(await withdrawDemand(currentUserId(req), input.amount))
}))

// POST /api/bank/deposits — { termKey, amount } 开定期存单（开单锁定年化利率）
router.post('/deposits', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(depositOpenSchema, req.body ?? {})
  res.status(201).json(await openFixedDeposit(currentUserId(req), input.termKey, input.amount))
}))

// POST /api/bank/deposits/:id/redeem — 支取存单（到期全额计息 / 提前按活期计息）
router.post('/deposits/:id/redeem', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(depositIdSchema, req.params)
  res.json(await redeemFixedDeposit(currentUserId(req), id))
}))

// POST /api/bank/funds/buy — { code, points } 按当日净值买入（0.25% 手续费）
router.post('/funds/buy', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(fundBuySchema, req.body ?? {})
  res.json(await buyFund(currentUserId(req), input.code, input.points))
}))

// POST /api/bank/funds/sell — { code, shares } 按当日净值卖出（支持部分卖出）
router.post('/funds/sell', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(fundSellSchema, req.body ?? {})
  res.json(await sellFund(currentUserId(req), input.code, input.shares))
}))

// GET /api/bank/loans/official — 官方贷款：利率（基准 + 溢价）/ 期限 / 限额 / 公共银行可贷余额 / 本人贷款列表
router.get('/loans/official', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await listOfficialLoans(currentUserId(req)))
}))

// POST /api/bank/loans/official — { amount } 借款（资金来源 = 公共银行，CAS 扣池；同一时间仅一笔未结清）
router.post('/loans/official', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(officialLoanAmountSchema, req.body ?? {})
  res.status(201).json(await borrowOfficialLoan(currentUserId(req), input.amount))
}))

// POST /api/bank/loans/official/:id/repay — 全额还清（本息回流公共银行）
router.post('/loans/official/:id/repay', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const { id } = parseInput(depositIdSchema, req.params)
  res.json(await repayOfficialLoan(currentUserId(req), id))
}))

export default router
