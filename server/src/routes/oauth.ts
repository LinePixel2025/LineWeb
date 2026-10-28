import { Router, Request, Response } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticate } from '../middleware/auth.js'
import { requireCapability } from '../middleware/auth.js'
import { requireFeature } from '../middleware/featureGuard.js'
import { AppError } from '../middleware/errorHandler.js'
import { asyncHandler } from '../lib/asyncHandler.js'
import { getErrorMessage, getErrorStatus, parseId } from '../lib/utils.js'
import {
  oauthAuthorizeQuerySchema,
  oauthAuthorizeDecisionSchema,
  oauthTokenSchema,
  oauthRevokeSchema,
  oauthClientCreateSchema,
  oauthClientUpdateSchema,
} from '../config/index.js'
import {
  APP_SCOPE_DESCRIPTIONS,
  APP_SCOPE_LABELS,
  HIGH_RISK_APP_SCOPES,
  scopesRequiringUnmetCapabilities,
  type AppScope,
} from '../lib/appScopes.js'
import { capabilitiesForRole } from '../lib/permissions.js'
import prisma from '../lib/prisma.js'
import {
  listClients,
  createClient,
  updateClient,
  resetClientSecret,
  deleteClient,
  requireActiveClient,
  assertRegisteredRedirectUri,
  resolveRequestedScopes,
  ensureGrant,
  issueAuthorizationCode,
  exchangeAuthorizationCode,
  mintAppTokens,
  rotateRefreshToken,
  revokeRefreshToken,
  listUserGrants,
  revokeGrant,
} from '../services/oauthService.js'

const router = Router()

// 令牌端点与撤销端点是匿名入口，单独限流防止暴力枚举授权码
const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false,
})

/** 以「用户拒绝授权」的方式回到应用 */
function buildDeniedRedirect(redirectUri: string, state: string | undefined) {
  const url = new URL(redirectUri)
  url.searchParams.set('error', 'access_denied')
  url.searchParams.set('error_description', '用户拒绝了授权')
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

/** 以「授权成功」的方式回到应用，携带一次性授权码 */
function buildGrantedRedirect(redirectUri: string, code: string, state: string | undefined) {
  const url = new URL(redirectUri)
  url.searchParams.set('code', code)
  if (state) url.searchParams.set('state', state)
  return url.toString()
}

/** scope 参数允许空格或逗号分隔；去重后保持顺序 */
function parseScopeParam(raw: string): string[] {
  const parts = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
  return [...new Set(parts)]
}

/**
 * 校验授权请求的公共部分（client / redirect_uri / scope / 账号能力）
 * 授权页展示与最终批准都调用它 —— 不信任前端传来的任何字段。
 */
async function resolveAuthorizeRequest(input: {
  clientId: string
  redirectUri: string
  scope: string
  userId: number
}) {
  const client = await requireActiveClient(input.clientId)
  assertRegisteredRedirectUri(client, input.redirectUri)

  const requested = parseScopeParam(input.scope)
  if (requested.length === 0) throw new AppError('请至少申请一项权限', 400)
  const scopes = resolveRequestedScopes(client, requested)

  // 能力派生 scope 需账号当前具备对应能力，否则直接拒绝授权
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { role: true },
  })
  if (!user) throw new AppError('用户不存在', 404)
  const capabilities = capabilitiesForRole(user.role)
  const unmet = scopesRequiringUnmetCapabilities(scopes, capabilities)
  if (unmet.length > 0) {
    throw new AppError(`当前账号不具备以下权限，无法授权：${unmet.join('、')}`, 400)
  }

  return { client, scopes }
}

// === 公开端点：应用侧调用 ===

/**
 * 令牌端点 —— 授权码换令牌 / 刷新令牌轮换
 * 支持 application/json 与 application/x-www-form-urlencoded（RFC 6749 要求后者）
 * 错误按 RFC 6749 返回 { error, error_description }
 */
router.post('/token', oauthLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthTokenSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', error_description: '请求参数无效' })
    return
  }

  const body = parsed.data
  try {
    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.code_verifier || !body.redirect_uri) {
        res.status(400).json({ error: 'invalid_request', error_description: '缺少 code、code_verifier 或 redirect_uri' })
        return
      }
      const context = await exchangeAuthorizationCode({
        code: body.code,
        clientId: body.client_id,
        clientSecret: body.client_secret,
        redirectUri: body.redirect_uri,
        codeVerifier: body.code_verifier,
      })
      const tokens = await mintAppTokens(context)
      res.json(tokens)
      return
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) {
        res.status(400).json({ error: 'invalid_request', error_description: '缺少 refresh_token' })
        return
      }
      const tokens = await rotateRefreshToken({
        refreshToken: body.refresh_token,
        clientId: body.client_id,
        clientSecret: body.client_secret,
      })
      res.json(tokens)
      return
    }

    res.status(400).json({ error: 'unsupported_grant_type', error_description: '不支持的授权类型' })
  } catch (err) {
    const status = getErrorStatus(err, 400)
    console.error('[OAuth] 令牌端点失败:', getErrorMessage(err))
    res.status(status).json({
      error: status === 401 ? 'invalid_client' : 'invalid_grant',
      error_description: getErrorMessage(err, '令牌请求失败'),
    })
  }
}))

/** 撤销端点 —— 应用主动失效自己的刷新令牌 */
router.post('/revoke', oauthLimiter, asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthRevokeSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid_request', error_description: '请求参数无效' })
    return
  }

  try {
    await revokeRefreshToken({
      token: parsed.data.token,
      clientId: parsed.data.client_id,
      clientSecret: parsed.data.client_secret,
    })
    // 令牌不存在也返回成功，避免泄露其是否存在
    res.json({ message: 'ok' })
  } catch (err) {
    const status = getErrorStatus(err, 400)
    res.status(status).json({
      error: status === 401 ? 'invalid_client' : 'invalid_grant',
      error_description: getErrorMessage(err, '撤销失败'),
    })
  }
}))

// === 需登录端点：授权页与用户侧授权管理 ===

/**
 * 授权页上下文 —— 授权页据此渲染「应用信息 + 权限清单」
 * 回调地址非法或 scope 超范围时返回 400，前端只展示错误、绝不做任何跳转
 */
router.get('/authorize-context', authenticate, requireFeature('oauthApps'), asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthAuthorizeQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    res.status(400).json({ error: '授权请求参数无效', details: parsed.error.flatten() })
    return
  }

  const { client, scopes } = await resolveAuthorizeRequest({
    clientId: parsed.data.client_id,
    redirectUri: parsed.data.redirect_uri,
    scope: parsed.data.scope,
    userId: req.user!.userId,
  })

  // 高危权限排在最后，避免用户略过
  const ordered = [...scopes].sort((a, b) => {
    const aRisk = HIGH_RISK_APP_SCOPES.includes(a) ? 1 : 0
    const bRisk = HIGH_RISK_APP_SCOPES.includes(b) ? 1 : 0
    return aRisk - bRisk
  })

  res.json({
    client: {
      name: client.name,
      description: client.description,
      homepage: client.homepage,
    },
    scopes: ordered.map((scope) => ({
      scope,
      label: APP_SCOPE_LABELS[scope],
      description: APP_SCOPE_DESCRIPTIONS[scope],
      highRisk: HIGH_RISK_APP_SCOPES.includes(scope),
    })),
    state: parsed.data.state ?? null,
  })
}))

/**
 * 授权决定 —— 同意则签发一次性授权码并返回跳转地址，拒绝则返回错误跳转
 * 跳转地址由服务端拼装（回调地址必须精确匹配已注册值），前端不得自行构造
 */
router.post('/authorize', authenticate, requireFeature('oauthApps'), asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthAuthorizeDecisionSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '授权请求参数无效', details: parsed.error.flatten() })
    return
  }

  const { client_id: clientId, redirect_uri: redirectUri, scope, state, decision } = parsed.data
  // 再次完整校验：不信任前端提交的任何内容
  const { client, scopes } = await resolveAuthorizeRequest({
    clientId,
    redirectUri,
    scope,
    userId: req.user!.userId,
  })

  if (decision === 'deny') {
    res.json({ redirect: buildDeniedRedirect(redirectUri, state) })
    return
  }

  const codeChallenge = typeof (req.body as Record<string, unknown>)?.code_challenge === 'string'
    ? (req.body as Record<string, string>).code_challenge
    : ''
  const codeChallengeMethod = typeof (req.body as Record<string, unknown>)?.code_challenge_method === 'string'
    ? (req.body as Record<string, string>).code_challenge_method
    : 'S256'
  if (!codeChallenge) throw new AppError('缺少 code_challenge，请使用 PKCE', 400)
  // S256 的 code_challenge 是 43 字符的 base64url（sha256 长度固定），做长度下限校验
  if (codeChallenge.length < 43 || codeChallenge.length > 128) {
    throw new AppError('code_challenge 长度不合法', 400)
  }
  if (codeChallengeMethod !== 'S256') throw new AppError('仅支持 S256 的 PKCE 校验方式', 400)

  const grant = await ensureGrant(req.user!.userId, client.id, scopes)
  const code = await issueAuthorizationCode({
    grantId: grant.id,
    clientRecordId: client.id,
    userId: req.user!.userId,
    redirectUri,
    scopes,
    codeChallenge,
    codeChallengeMethod,
  })

  res.json({ redirect: buildGrantedRedirect(redirectUri, code, state) })
}))

/** 当前用户已授权的应用列表 */
router.get('/grants', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const grants = await listUserGrants(req.user!.userId)
  res.json({ grants })
}))

/** 撤销某应用的授权 —— 该应用的访问令牌与刷新令牌随即全部失效 */
router.delete('/grants/:id', authenticate, asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的授权 ID' })
    return
  }
  await revokeGrant(req.user!.userId, id)
  res.json({ message: '已撤销授权' })
}))

// === 管理端端点：应用注册与维护 ===

const requireAppManage = [authenticate, requireCapability('app:manage')]

/** 应用列表（不含密钥） */
router.get('/clients', ...requireAppManage, asyncHandler(async (_req: Request, res: Response) => {
  res.json({ clients: await listClients() })
}))

/** 注册应用 —— 机密客户端的明文密钥仅在此响应中出现一次 */
router.post('/clients', ...requireAppManage, asyncHandler(async (req: Request, res: Response) => {
  const parsed = oauthClientCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }
  const result = await createClient(parsed.data, req.user!.userId)
  res.status(201).json(result)
}))

router.put('/clients/:id', ...requireAppManage, asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的应用 ID' })
    return
  }
  const parsed = oauthClientUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: '输入数据无效', details: parsed.error.flatten() })
    return
  }
  res.json({ client: await updateClient(id, parsed.data) })
}))

/** 重置密钥 —— 同样只展示一次 */
router.post('/clients/:id/secret', ...requireAppManage, asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的应用 ID' })
    return
  }
  res.json(await resetClientSecret(id))
}))

router.delete('/clients/:id', ...requireAppManage, asyncHandler(async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的应用 ID' })
    return
  }
  await deleteClient(id)
  res.json({ message: '已删除应用' })
}))

export default router
