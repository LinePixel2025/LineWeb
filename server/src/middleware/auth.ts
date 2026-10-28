import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import {
  capabilitiesForRole,
  roleHasCapability,
  type Capability,
} from '../lib/permissions.js'
import {
  isAppScope,
  parseStoredScopes,
  requiredScopeForEndpoint,
  scopeRequiresCapability,
  type AppScope,
} from '../lib/appScopes.js'

/**
 * 认证上下文 — 挂载到 req.user
 *
 * 注意：JWT 只签 `{ userId, role }`，能力（capabilities）与 canAccessDrive
 * 每次请求都从数据库解析，因此角色调整即时生效，且无法通过伪造令牌获得能力。
 *
 * 第三方应用令牌（type === 'app'）是同一密钥签发的「作用域令牌」：
 *   - role 固定为 'app'，属于未知角色 → 所有基于角色的管理检查自动为假；
 *   - capabilities 只包含该应用被授予的能力派生 scope；
 *   - 可访问的端点被 APP_ENDPOINT_RULES 白名单严格限制。
 */
export interface AuthPayload {
  userId: number
  role: string
  capabilities: Capability[]
  canAccessDrive: boolean
  /** 网盘空间上限（字节）；应用令牌使用所属账号的配额 */
  storageQuota: bigint
  // 下载票据相关（由 /api/drive/download-ticket/:id 签发）
  type?: string
  downloadFileId?: number
  downloadNonce?: string
  // 第三方应用令牌相关
  scopes?: AppScope[]
  clientId?: string
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
  /** 应用令牌：授权给哪个应用、被授予的 scope 清单 */
  clientId?: string
  scopes?: AppScope[]
}

/**
 * 解析「第三方应用令牌」的认证上下文
 *
 * 与账号令牌的区别：除了 tokenValidAfter 失效校验外，还必须
 *   1. 授权记录仍然存在且未被撤销（用户撤销 / 重新授权都会反映在这里）
 *   2. 应用未被停用
 *   3. 能力派生 scope 与账号「当前」能力取交集 —— 账号被降权后应用立即失去写权限
 *
 * 任何异常都按失败处理（fail closed），不放过任何一个可疑请求。
 */
async function resolveAppAuthContext(
  claims: TokenClaims,
): Promise<{ ok: true; user: AuthPayload } | { ok: false; reason: string }> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: claims.userId },
      select: { tokenValidAfter: true, role: true, canAccessDrive: true, storageQuota: true },
    })
    if (!user) return { ok: false, reason: '账号不存在或已注销，请重新登录' }

    const issuedAtMs = typeof claims.ts === 'number' ? claims.ts : (claims.iat ?? 0) * 1000
    if (issuedAtMs < user.tokenValidAfter.getTime()) {
      return { ok: false, reason: 'Token 已失效，请重新登录' }
    }

    const clientId = typeof claims.clientId === 'string' ? claims.clientId : ''
    if (!clientId) return { ok: false, reason: 'Token 无效' }

    const grant = await prisma.oAuthGrant.findFirst({
      where: { userId: claims.userId, client: { clientId } },
      include: { client: { select: { isActive: true } } },
    })
    if (!grant || grant.revokedAt) return { ok: false, reason: '授权已被撤销，请重新授权' }
    if (!grant.client.isActive) return { ok: false, reason: '应用已被停用' }

    // 以数据库中的授权记录为准，而不是令牌里的 scopes
    const granted = parseStoredScopes(grant.scopes)
    const currentCapabilities = capabilitiesForRole(user.role)
    const tokenScopes = Array.isArray(claims.scopes) ? claims.scopes.filter(isAppScope) : granted
    const effectiveScopes = granted
      .filter((scope) => tokenScopes.includes(scope))
      .filter((scope) => {
        // 能力派生 scope 需账号当前仍具备对应能力，否则立即剥除
        const required = scopeRequiresCapability(scope)
        return required === null || currentCapabilities.includes(required)
      })

    const capabilityScopes = effectiveScopes.filter((scope) => {
      const required = scopeRequiresCapability(scope)
      return required !== null && currentCapabilities.includes(required)
    })

    return {
      ok: true,
      user: {
        userId: claims.userId,
        role: 'app',
        capabilities: capabilityScopes as Capability[],
        canAccessDrive: !!user.canAccessDrive,
        storageQuota: user.storageQuota,
        type: config.oauthAccessTokenType,
        clientId,
        scopes: effectiveScopes,
      },
    }
  } catch (err) {
    console.error('[Auth] 应用令牌解析失败（按失败处理）:', err)
    return { ok: false, reason: 'Token 无效' }
  }
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
export async function resolveAuthContext(token: string): Promise<
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

  // 第三方应用令牌走单独的解析分支（授权记录 + 能力交集）
  if (claims.type === config.oauthAccessTokenType) {
    return resolveAppAuthContext(claims)
  }

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: { tokenValidAfter: true, role: true, canAccessDrive: true, storageQuota: true },
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
      storageQuota: user.storageQuota,
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

/**
 * baseUrl + path 拼出完整路径（全局中间件与路由内中间件看到的 req.path 粒度不同）
 *
 * 归一化末尾斜杠：挂在 /api/posts 的 router 处理 POST /api/posts 时
 * req.path 是 '/'，拼出来会是 '/api/posts/'，与白名单的精确匹配对不上。
 */
function fullRequestPath(req: Request): string {
  const fullPath = `${req.baseUrl ?? ''}${req.path ?? ''}`
  return fullPath.length > 1 && fullPath.endsWith('/') ? fullPath.slice(0, -1) : fullPath
}

function isDownloadEndpoint(req: Request): boolean {
  const fullPath = fullRequestPath(req)
  return DOWNLOAD_ENDPOINT_PATTERNS.some((pattern) => pattern.test(fullPath))
}

/**
 * 第三方应用令牌的端点白名单校验
 *
 * 应用令牌只被允许访问 APP_ENDPOINT_RULES 中列出的端点（最小权限）：未列出 → 403，
 * 已列出但未获对应 scope → 403。因此用户管理、设备监控、站点统计、AI 配置、
 * 网盘同步、授权管理自身等端点对应用完全不可达。
 *
 * 返回 null 表示通过；否则返回应发送的错误响应。
 */
function checkAppTokenAccess(req: Request, user: AuthPayload): { status: number; error: string; required?: AppScope } | null {
  const required = requiredScopeForEndpoint(req.method, fullRequestPath(req))
  if (!required) {
    return { status: 403, error: '该端点不允许第三方应用访问' }
  }
  if (!user.scopes?.includes(required)) {
    return { status: 403, error: `应用未获得「${required}」权限`, required }
  }
  return null
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
    // 反代会话令牌（/proxy 用）不是账号令牌，禁止访问任何 /api 端点
    if (result.user.type === 'proxy') {
      res.status(403).json({ error: '反代会话令牌仅可用于网页反代' })
      return
    }
    // 第三方应用令牌仅限白名单端点使用，且需持有对应 scope
    if (result.user.type === config.oauthAccessTokenType) {
      const denied = checkAppTokenAccess(req, result.user)
      if (denied) {
        res.status(denied.status).json(denied.required
          ? { error: denied.error, required: denied.required }
          : { error: denied.error })
        return
      }
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
 *
 * 判断依据是认证阶段已解析好的 req.user.capabilities：
 * 对账号登录令牌等价于按角色展开的能力矩阵；对第三方应用令牌则是
 * 该应用被授予的 scope 所对应的能力，因此应用无法借能力派生 scope 越权。
 */
export function requireCapability(...required: Capability[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const capabilities = req.user?.capabilities
    if (!capabilities || !required.some((cap) => capabilities.includes(cap))) {
      res.status(403).json({ error: '权限不足', required })
      return
    }
    next()
  }
}

/**
 * 可选认证中间件：解析登录令牌，成功时挂载 req.user，失败时不拦截（游客照常放行）
 * 用于 /api/ai/chat 等公开端点——登录用户可获得额外上下文（如屏幕使用时间）
 *
 * 下载票据与应用令牌都按游客处理：它们只表达「下载某个文件」/「以应用身份访问白名单端点」，
 * 不应在公开端点上获得登录用户的额外上下文。
 */
export async function optionalAuthenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ') || req.user) {
    next()
    return
  }

  try {
    const result = await resolveAuthContext(header.slice(7).trim())
    const excluded = result.ok && (
      result.user.type === 'download'
      || result.user.type === config.oauthAccessTokenType
      || result.user.type === 'proxy'
    )
    if (result.ok && !excluded) req.user = result.user
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
