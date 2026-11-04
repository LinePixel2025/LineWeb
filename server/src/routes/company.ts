import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { COMPANY_MAX_MEMBERS, COMPANY_MIN_MEMBERS, COMPANY_LIMITS } from '../lib/companyRules.js'
import {
  borrowLoan,
  buyListing,
  disbandCompany,
  donateItem,
  foundCompany,
  getCompanyDetail,
  getInviteCandidates,
  getLoanOffers,
  getMarketView,
  getMyCompanyView,
  getMyLoans,
  getMyPoolInvestments,
  inviteMember,
  investPool,
  kickMember,
  leaveCompany,
  redeemPool,
  repayLoan,
  respondInvite,
  updateLoanSettings,
  withdrawListing,
} from '../services/companyService.js'

/**
 * 公司（成员组织 + 货栈 + 资金池 + 放贷 + 危机减免）。
 *
 * 全部需登录；开关关闭时由外层 requireFeature('company') 拦截。
 * 任何能被购买 / 捐赠 / 借款的入口都只收 id 与数量，价格与额度一律服务端重算。
 */
const router = Router()
router.use(authenticate)

/** limitFor 与 routes/pets.ts 同口径：按用户计、5 分钟窗口、管理员豁免 */
function limitFor(max: number, message: string) {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
    message: { error: message },
    skip: (req) => req.user?.role === 'admin',
  })
}

const readLimiter = limitFor(600, '公司相关请求太频繁，先歇一会儿再看吧')
const writeLimiter = limitFor(60, '操作太频繁啦，公司的事情慢慢谈')

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

/* ---------- 入参 schema ---------- */

const foundSchema = z.object({
  // 名称只做长度粗筛（2–12 字与字符构成的语义校验在 companyRules 里，唯一性在事务里）
  name: z.string().min(1).max(30),
  invitees: z.array(z.coerce.number().int().positive()).length(COMPANY_MIN_MEMBERS - 1),
})

const inviteSchema = z.object({
  userId: z.coerce.number().int().positive(),
})

const respondSchema = z.object({
  inviteId: z.coerce.number().int().positive(),
  accept: z.boolean(),
})

const kickSchema = z.object({
  userId: z.coerce.number().int().positive(),
})

const donateSchema = z.object({
  source: z.enum(['farm_seed', 'raid_item']),
  itemKey: z.string().trim().min(1).max(48),
  amount: z.coerce.number().int().min(1).max(10_000),
  // 定价上限给足空间，真正的带宽校验按参考价在 service 里做
  unitPrice: z.coerce.number().int().min(1).max(1_000_000),
})

const listingIdSchema = z.object({
  listingId: z.coerce.number().int().positive(),
})

const buySchema = z.object({
  listingId: z.coerce.number().int().positive(),
  amount: z.coerce.number().int().min(1).max(10_000),
})

const borrowSchema = z.object({
  /** 兼容两种字段名：amount 为公司页旧字段，principal 为银行页新字段；二者取一，都传时以 principal 为准 */
  amount: z.coerce.number().int().min(1).max(1_000_000).optional(),
  principal: z.coerce.number().int().min(1).max(1_000_000).optional(),
  /** 缺省 = 向自己公司借；显式传 = 跨公司借款（对方 membersOnly 时要求是成员） */
  companyId: z.coerce.number().int().positive().optional(),
}).refine((input) => (input.principal ?? input.amount) !== undefined, { message: '请输入借款金额' })

const repaySchema = z.object({
  loanId: z.coerce.number().int().positive(),
  /** 缺省 = 一次还清；带 amount = 部分还款（利息先冲、再冲本金） */
  amount: z.coerce.number().int().min(1).max(1_000_000).optional(),
})

const disbandSchema = z.object({
  /** 缺省 = 解散我自己的公司；显式传 id 也只允许我是该公司的 CEO */
  companyId: z.coerce.number().int().positive().optional(),
})

const poolAmountSchema = z.object({
  amount: z.coerce.number().int().min(1).max(COMPANY_LIMITS.loanAmountMax),
})

/** CEO 放贷设置整体保存：数值上限与服务端 normalize 口径一致（0 = 跟随全站） */
const loanSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  ratePct: z.coerce.number().min(0).max(COMPANY_LIMITS.loanSettingsRateMax).optional(),
  maxPrincipal: z.coerce.number().int().min(0).max(COMPANY_LIMITS.loanAmountMax).optional(),
  dueDays: z.coerce.number().int().min(0).max(COMPANY_LIMITS.loanSettingsDueMax).optional(),
  membersOnly: z.boolean().optional(),
})

/* ---------- 读（字面量路径必须注册在 /:id 之前，否则 /me 会被当成公司 id） ---------- */

// GET /api/company/me — 我的公司全景（成员/货栈/邀请/贷款/可捐清单）
router.get('/me', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getMyCompanyView(currentUserId(req)))
}))

// GET /api/company/market?page=&pageSize=&sort=&source=&q= — 全站在售货栈（任何人可买）
router.get('/market', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getMarketView(currentUserId(req), {
    page: req.query.page,
    pageSize: req.query.pageSize ?? req.query.take,
    sort: req.query.sort,
    source: req.query.source,
    q: req.query.q,
  }))
}))

// GET /api/company/candidates — 可以邀请的好友（active、未加入其他公司、没有待处理邀请）
router.get('/candidates', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await getInviteCandidates(currentUserId(req)))
}))

// GET /api/company/loans — 我的全部贷款（跨公司，读取时惰性翻逾期）
router.get('/loans', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getMyLoans(currentUserId(req)) })
}))

// GET /api/company/loan/offers — 可借公司列表（active 且未关闸；maxPrincipal=0 表示按公司等级上限）
router.get('/loan/offers', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getLoanOffers() })
}))

// GET /api/company/pool/investments — 我的资金池投资份额（跨公司；已解散公司的份额在清算时已发还）
router.get('/pool/investments', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json({ items: await getMyPoolInvestments(currentUserId(req)) })
}))

// GET /api/company/:id — 某家公司的公开页（成员、在售、最近成交）
router.get('/:id', readLimiter, asyncHandler(async (req: Request, res: Response) => {
  const id = Number.parseInt(req.params.id ?? '', 10)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('公司不存在', 404, 'COMPANY_NOT_FOUND')
  res.json(await getCompanyDetail(id, currentUserId(req)))
}))

/* ---------- 写 ---------- */

// POST /api/company — 发起公司（恰好 2 位好友，7 天内凑不满 3 人自动作废）
router.post('/', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(foundSchema, req.body ?? {})
  res.status(201).json(await foundCompany(currentUserId(req), input.name, input.invitees))
}))

// POST /api/company/invite — 邀请好友（满编 7 人）
router.post('/invite', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(inviteSchema, req.body ?? {})
  res.json(await inviteMember(currentUserId(req), input.userId))
}))

// POST /api/company/invite/respond — { inviteId, accept } 接受 / 拒绝入司邀请
router.post('/invite/respond', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(respondSchema, req.body ?? {})
  res.json(await respondInvite(currentUserId(req), input.inviteId, input.accept))
}))

// POST /api/company/leave — 退司（发起人不能退；有未还清贷款则挡住）
router.post('/leave', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  res.json(await leaveCompany(currentUserId(req)))
}))

// POST /api/company/kick — 踢人（仅发起人；被踢者欠款仍然要还）
router.post('/kick', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(kickSchema, req.body ?? {})
  res.json(await kickMember(currentUserId(req), input.userId))
}))

// POST /api/company/donate — 捐入货栈（物理托管 + 单条上限 + 每日按稀有度补货上限）
router.post('/donate', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(donateSchema, req.body ?? {})
  res.json(await donateItem(currentUserId(req), input))
}))

// POST /api/company/listing/withdraw — 下架条目（仅发起人，未售部分原路退回捐入者）
router.post('/listing/withdraw', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(listingIdSchema, req.body ?? {})
  res.json(await withdrawListing(currentUserId(req), input.listingId))
}))

// POST /api/company/market/buy — 购买（CAS 防超卖；全额进公司资金池）
router.post('/market/buy', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(buySchema, req.body ?? {})
  res.json(await buyListing(currentUserId(req), input.listingId, input.amount))
}))

// POST /api/company/loan/borrow — 从资金池借款（可跨公司：body 带 companyId；按公司设置/等级限额）
router.post('/loan/borrow', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(borrowSchema, req.body ?? {})
  res.json(await borrowLoan(currentUserId(req), input.principal ?? input.amount ?? 0, input.companyId))
}))

// POST /api/company/loan/repay — 还款（缺省一次还清；本金与利息都回流资金池，结清时利息按份额分给投资人）
router.post('/loan/repay', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(repaySchema, req.body ?? {})
  res.json(await repayLoan(currentUserId(req), input.loanId, input.amount))
}))

// POST /api/company/pool/invest — 投入公司资金池（成员专属；单次 ≥100 积分）
router.post('/pool/invest', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(poolAmountSchema, req.body ?? {})
  res.json(await investPool(currentUserId(req), input.amount))
}))

// POST /api/company/pool/redeem — 赎回资金池份额（双 CAS：份额够扣 + 池子够付）
router.post('/pool/redeem', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(poolAmountSchema, req.body ?? {})
  res.json(await redeemPool(currentUserId(req), input.amount))
}))

// PUT /api/company/loan/settings — CEO 放贷设置（整体保存；0 = 跟随全站档位）
router.put('/loan/settings', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(loanSettingsSchema, req.body ?? {})
  res.json(await updateLoanSettings(currentUserId(req), null, input))
}))

// POST /api/company/disband — 解散（仅发起人；有未结清贷款时一律拒绝，见 companyService 顶部说明）
router.post('/disband', writeLimiter, asyncHandler(async (req: Request, res: Response) => {
  const input = parseInput(disbandSchema, req.body ?? {})
  res.json(await disbandCompany(currentUserId(req), input.companyId ?? null))
}))

/** 成员上限常量下发给前端（前端不复制数值，规则变了自动跟上） */
export const COMPANY_ROUTE_LIMITS = { minMembers: COMPANY_MIN_MEMBERS, maxMembers: COMPANY_MAX_MEMBERS }

export default router
