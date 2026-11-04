import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import {
  companyConfigShape,
  disbandCompany,
  getCompanyAdminOverview,
  getCompanyConfig,
  saveCompanyConfig,
} from '../services/companyService.js'

/**
 * 公司管理端（管理员）。
 *
 * 复用 `points:manage` 能力而不新增 capability：公司本质是积分的组织化流通
 * （捐货 / 成交 / 放贷都走统一台账），而且新增能力要同时改前后端两份
 * CAPABILITIES 清单（有跨端一致性测试守着），收益不大 —— 与危机管理端同一选择。
 */
const router = Router()
router.use(authenticate, requireCapability('points:manage'))

function currentAdminId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

/** 总览：公司数量与状态分布、资金池与营业额合计、贷款敞口、营业额榜 */
router.get('/overview', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getCompanyAdminOverview())
}))

/** 当前参数 + 可调范围 + 固定阈值（前端不复制数值） */
router.get('/config', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ config: await getCompanyConfig(true), shape: companyConfigShape() })
}))

/**
 * 调参数（读旧 → 深合并 → normalize → 保存）。
 * 只在这里做「形状」校验，具体上下界与 0 值保护全在 lib/companyRules.ts 的 normalize 里。
 */
router.put('/config', asyncHandler(async (req: Request, res: Response) => {
  const parsed = z
    .object({
      priceBandMin: z.coerce.number().int().min(1).max(500).optional(),
      priceBandMax: z.coerce.number().int().min(1).max(2000).optional(),
      loanTierCaps: z.array(z.coerce.number().int().min(0).max(10_000_000)).max(8).optional(),
      loanRatePct: z.array(z.coerce.number().int().min(0).max(100)).max(8).optional(),
      loanDueDays: z.coerce.number().int().min(1).max(365).optional(),
      donationCaps: z.record(z.string(), z.coerce.number().int().min(0).max(100_000)).optional(),
      restockCaps: z.record(z.string(), z.coerce.number().int().min(0).max(100_000)).optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) {
    throw new AppError('参数无效：带宽须为正整数，利率须在 0–100，期限须为 1–365 天', 400)
  }
  res.json({ config: await saveCompanyConfig(parsed.data, currentAdminId(req)) })
}))

/**
 * 强制解散某家公司。
 * 与用户端同一约束：只要还有未结清贷款就拒绝（CompanyLoan 是 Cascade，
 * 解散会连带删掉债务行、把账抹平），所以管理员也不能绕过这条 ——
 * 正确做法是先让借款人还清，或把借款人账号删除（那时贷款行随之 cascade）。
 */
router.post('/:id/disband', asyncHandler(async (req: Request, res: Response) => {
  const id = Number.parseInt(req.params.id ?? '', 10)
  if (!Number.isFinite(id) || id <= 0) throw new AppError('公司不存在', 404, 'COMPANY_NOT_FOUND')
  const adminId = currentAdminId(req)
  console.log(`[company] 管理员 ${adminId} 强制解散公司 ${id}`)
  res.json(await disbandCompany(adminId, id, true))
}))

export default router
