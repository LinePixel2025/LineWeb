import { Router, type Request, type Response } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import prisma from '../lib/prisma.js'
import type { PersonalSpace } from '@prisma/client'

const router = Router()
// 仅管理员可进：admin 自动拥有全部能力（ALL_CAPABILITIES），应用令牌不在
// appScopes 白名单内天然 403，这里只需按能力守卫即可。
router.use(authenticate, requireCapability('personal:manage'))

const SPACE_NAME_MAX = 30
const RUSTDESK_FIELD_MAX = 200
/** 空间名默认后缀：首次访问自动创建「<用户名> 的私人空间」 */
const DEFAULT_SPACE_NAME_SUFFIX = ' 的私人空间'

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

const spaceNameSchema = z.string()
  .trim()
  .min(1, '空间名不能为空')
  .max(SPACE_NAME_MAX, `空间名最长 ${SPACE_NAME_MAX} 个字符`)

const rustdeskFieldSchema = z.string()
  .trim()
  .max(RUSTDESK_FIELD_MAX, `RustDesk 配置项最长 ${RUSTDESK_FIELD_MAX} 个字符`)
  .optional()

const updateSchema = z.object({
  spaceName: spaceNameSchema,
  rustdeskIdServer: rustdeskFieldSchema,
  rustdeskRelayServer: rustdeskFieldSchema,
  rustdeskKey: rustdeskFieldSchema,
  // Web 客户端地址会以 window.open 打开，限定 http/https 防止 javascript: 等注入
  rustdeskWebClient: rustdeskFieldSchema.refine(
    (value) => value === undefined || value === '' || /^https?:\/\//i.test(value),
    { message: 'Web 客户端地址必须以 http:// 或 https:// 开头' },
  ),
})

/** DTO：未配置的项统一输出为空字符串，前端输入框可直接绑定 */
function toDto(space: PersonalSpace) {
  return {
    id: space.id,
    spaceName: space.spaceName,
    rustdeskIdServer: space.rustdeskIdServer ?? '',
    rustdeskRelayServer: space.rustdeskRelayServer ?? '',
    rustdeskKey: space.rustdeskKey ?? '',
    rustdeskWebClient: space.rustdeskWebClient ?? '',
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  }
}

/** 取当前管理员的个人空间；不存在则用「<用户名> 的私人空间」创建默认行（upsert 兜并发首访） */
async function ensureSpace(userId: number) {
  const existing = await prisma.personalSpace.findUnique({ where: { userId } })
  if (existing) return existing

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { username: true },
  })
  if (!user) throw new AppError('登录账号不存在或已注销，请重新登录', 401)

  // 用户名允许 ≤50 字而 PUT 校验空间名 ≤30 字：超长时按后缀实际长度截断用户名，
  // 保证自动创建的默认名本身就能通过 PUT 校验，否则改名前写不回、改名后又回不去
  const maxNameLength = Math.max(0, SPACE_NAME_MAX - DEFAULT_SPACE_NAME_SUFFIX.length)
  const defaultName = `${user.username.slice(0, maxNameLength)}${DEFAULT_SPACE_NAME_SUFFIX}`

  return prisma.personalSpace.upsert({
    where: { userId },
    update: {},
    create: { userId, spaceName: defaultName },
  })
}

// GET /api/personal-space — 当前管理员的个人空间（不存在时自动创建默认空间）
router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const space = await ensureSpace(currentUserId(req))
  res.json(toDto(space))
}))

// PUT /api/personal-space — 更新空间名与 RustDesk 配置
router.put('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const input = parseInput(updateSchema, req.body ?? {})
  const data = {
    spaceName: input.spaceName,
    rustdeskIdServer: input.rustdeskIdServer || null,
    rustdeskRelayServer: input.rustdeskRelayServer || null,
    rustdeskKey: input.rustdeskKey || null,
    rustdeskWebClient: input.rustdeskWebClient || null,
  }
  const space = await prisma.personalSpace.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  })
  res.json(toDto(space))
}))

export default router
