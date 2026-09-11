import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import {
  capabilitiesForRole,
  roleHasCapability,
  type Capability,
} from '../lib/permissions.js'

/**
 * 认证上下文 — 挂载到 req.user
 *
 * 注意：JWT 只签 `{ userId, role }`，能力（capabilities）与 canAccessDrive
 * 每次请求都从数据库解析，因此角色调整即时生效，且无法通过伪造令牌获得能力。
 */
export interface AuthPayload {
  userId: number
  role: string
  capabilities: Capability[]
  canAccessDrive: boolean
  // 下载票据相关（由 /api/drive/download-ticket/:id 签发）
  type?: string
  downloadFileId?: number
  downloadNonce?: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

interface TokenClaims {
  userId: number
  role: string
  iat?: number
  /** 毫秒级签发时间（自签 claim）——用于与 tokenValidAfter 精确比较，避免同秒宽限 */
  ts?: number
  type?: string
  downloadFileId?: number
  downloadNonce?: string
}

/**
 * 解析令牌 → 认证上下文
 *
 * 单次数据库查询同时完成三件事：
 *   1. tokenValidAfter 失效校验（登出 / 改密后旧令牌立即失效）
 *   2. 取角色并展开为能力矩阵
 *   3. 取网盘权限开关
 *
 * 返回 null 表示令牌无效（用户不存在 / 已失效 / 签名错误）。
 */
async function resolveAuthContext(token: string): Promise<
  | { ok: true; user: AuthPayload }
  | { ok: false; reason: string }
> {
  let claims: TokenClaims
  try {
    claims = jwt.verify(token, config.jwtSecret) as TokenClaims
  } catch {
    return { ok: false, reason: 'Token 无效' }
  }

  if (!claims?.userId) return { ok: false, reason: 'Token 无效' }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { tokenValidAfter: true, role: true, canAccessDrive: true },
  })
  if (!user) return { ok: false, reason: '账号不存在或已注销，请重新登录' }

  // 失效校验：优先用毫秒级 ts claim（登出/改密后同一秒内也能立即失效）；
  // 旧令牌没有 ts 时回退到 iat（秒级），与 tokenValidAfter 同粒度比较
  const issuedAtMs = typeof claims.ts === 'number'
    ? claims.ts
    : (claims.iat ?? 0) * 1000
  if (issuedAtMs < user.tokenValidAfter.getTime()) {
    return { ok: false, reason: 'Token 已失效，请重新登录' }
  }

  return {
    ok: true,
    user: {
      userId: claims.userId,
      role: user.role,
      capabilities: capabilitiesForRole(user.role),
      canAccessDrive: !!user.canAccessDrive,
      type: claims.type,
      downloadFileId: claims.downloadFileId,
      downloadNonce: claims.downloadNonce,
    },
  }
}

/**
 * 下载票据只对文件下载端点有效。
 * 票据用同一 secret 签发且常见于 URL / 浏览器历史 / 访问日志，
 * 因此不能被当作通用账号令牌去访问其它 API（越权面收口）。
 */
const DOWNLOAD_ENDPOINT_PATTERNS = [
  /^\/api\/drive\/download\/\d+$/,
  /^\/api\/drive\/files\/\d+\/download$/,
]

/** baseUrl + path 拼出完整路径（全局中间件与路由内中间件看到的 req.path 粒度不同） */
function isDownloadEndpoint(req: Request): boolean {
  const fullPath = `${req.baseUrl ?? ''}${req.path ?? ''}`
  return DOWNLOAD_ENDPOINT_PATTERNS.some((pattern) => pattern.test(fullPath))
}

/**
 * 全局认证中间件 — 仅接受账号登录令牌
 *
 * 凭证来源（都是同一个登录 JWT）：
 *   1. `Authorization: Bearer <jwt>`
 *   2. `?token=<jwt>`（下载直链，浏览器无法设置请求头）
 *
 * 幂等：全局中间件已解析过时，路由内再次调用 authenticate 直接放行。
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  if (req.user) {
    next()
    return
  }

  const header = req.headers.authorization
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  const queryToken = typeof req.query.token === 'string' ? req.query.token : ''
  const token = bearer || queryToken

  if (!token) {
    res.status(401).json({ error: '未登录' })
    return
  }

  try {
    const result = await resolveAuthContext(token)
    if (!result.ok) {
      res.status(401).json({ error: queryToken && !bearer ? 'Token 无效' : result.reason })
      return
    }
    // 下载票据仅限下载端点使用（403 而非 401，避免前端把它当成登录失效而登出）
    if (result.user.type === 'download' && !isDownloadEndpoint(req)) {
      res.status(403).json({ error: '下载票据仅可用于文件下载' })
      return
    }
    req.user = result.user
    next()
  } catch (err) {
    console.error('[Auth] 认证失败:', err)
    res.status(500).json({ error: '认证服务异常' })
  }
}

/**
 * 能力守卫 — 需要指定能力之一（admin 拥有全部能力，因此自动通过）
 * 用法：router.use(authenticate, requireCapability('user:manage'))
 */
export function requireCapability(...required: Capability[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role
    if (!role || !required.some((cap) => roleHasCapability(role, cap))) {
      res.status(403).json({ error: '权限不足', required })
      return
    }
    next()
  }
}

/**
 * 可选认证中间件：解析登录令牌，成功时挂载 req.user，失败时不拦截（游客照常放行）
 * 用于 /api/ai/chat 等公开端点——登录用户可获得额外上下文（如屏幕使用时间）
 */
export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ') || req.user) {
    next()
    return
  }

  try {
    const result = await resolveAuthContext(header.slice(7).trim())
    // 下载票据只表达「下载某个文件」，在公开端点上按游客处理
    if (result.ok && result.user.type !== 'download') req.user = result.user
  } catch (err) {
    console.error('[Auth] 可选认证解析失败（按游客处理）:', err)
  }
  next()
}

/** 角色是否具备能力（供路由内部做数据范围判断，如网盘越权豁免） */
export function currentUserHasCapability(req: Request, capability: Capability): boolean {
  const role = req.user?.role
  return !!role && roleHasCapability(role, capability)
}
