/**
 * 第三方应用授权服务 —— OAuth 2.0 授权码 + PKCE
 *
 * 安全要点：
 *   1. 授权码与刷新令牌只存 sha256 哈希，明文仅在签发那一刻返回给应用；
 *   2. 授权码一次性核销（updateMany where usedAt = null 的原子更新），杜绝重放；
 *   3. 刷新令牌轮换：每次刷新换发新令牌并作废旧的；若旧令牌被再次使用（疑似泄露），
 *      直接吊销整个授权，强制应用重新走授权流程；
 *   4. client_secret 用 bcrypt 存储；回调地址必须与注册值精确匹配，不支持通配。
 */

import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  isAppScope,
  parseStoredScopes,
  type AppScope,
} from '../lib/appScopes.js'

// === 基础工具 ===

/** 令牌 / 授权码哈希 —— 数据库里不存明文 */
function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function generateClientId(): string {
  return `lw_${crypto.randomBytes(12).toString('hex')}`
}

function generateClientSecret(): string {
  return `lws_${crypto.randomBytes(24).toString('hex')}`
}

/** 不透明随机令牌（授权码 / 刷新令牌），无任何可推断信息 */
function generateOpaqueToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

function normalizeRedirectUris(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

/** 对外返回的应用信息（永不含密钥） */
function serializeClient(client: {
  id: number
  clientId: string
  clientType: string
  name: string
  description: string | null
  homepage: string | null
  redirectUris: string
  allowedScopes: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  _count?: { grants: number }
}) {
  return {
    id: client.id,
    clientId: client.clientId,
    clientType: client.clientType,
    name: client.name,
    description: client.description,
    homepage: client.homepage,
    redirectUris: normalizeRedirectUris(client.redirectUris),
    allowedScopes: parseStoredScopes(client.allowedScopes),
    isActive: client.isActive,
    createdAt: client.createdAt,
    updatedAt: client.updatedAt,
    grantCount: client._count?.grants ?? 0,
  }
}

// === 应用注册（管理员） ===

export async function listClients() {
  const clients = await prisma.oAuthClient.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { grants: true } } },
  })
  return clients.map(serializeClient)
}

export interface CreateClientInput {
  name: string
  description?: string
  homepage?: string
  redirectUris: string[]
  allowedScopes: AppScope[]
  clientType: 'confidential' | 'public'
}

/** 创建应用 —— 机密客户端的明文密钥只在此处返回一次，之后无法再次获取 */
export async function createClient(input: CreateClientInput, createdById: number) {
  const isPublic = input.clientType === 'public'
  const plainSecret = isPublic ? null : generateClientSecret()

  const client = await prisma.oAuthClient.create({
    data: {
      clientId: generateClientId(),
      clientSecret: plainSecret ? await bcrypt.hash(plainSecret, 10) : null,
      clientType: input.clientType,
      name: input.name,
      description: input.description ?? null,
      homepage: input.homepage ?? null,
      redirectUris: JSON.stringify(input.redirectUris),
      allowedScopes: JSON.stringify(input.allowedScopes),
      createdById,
    },
    include: { _count: { select: { grants: true } } },
  })

  return { client: serializeClient(client), clientSecret: plainSecret ?? undefined }
}

export interface UpdateClientInput {
  name?: string
  description?: string
  homepage?: string
  redirectUris?: string[]
  allowedScopes?: AppScope[]
  clientType?: 'confidential' | 'public'
  isActive?: boolean
}

export async function updateClient(id: number, input: UpdateClientInput) {
  const data: Record<string, unknown> = {}
  if (input.name !== undefined) data.name = input.name
  if (input.description !== undefined) data.description = input.description
  if (input.homepage !== undefined) data.homepage = input.homepage
  if (input.redirectUris !== undefined) data.redirectUris = JSON.stringify(input.redirectUris)
  if (input.allowedScopes !== undefined) data.allowedScopes = JSON.stringify(input.allowedScopes)
  if (input.clientType !== undefined) data.clientType = input.clientType
  if (input.isActive !== undefined) data.isActive = input.isActive

  try {
    const client = await prisma.oAuthClient.update({
      where: { id },
      data,
      include: { _count: { select: { grants: true } } },
    })
    return serializeClient(client)
  } catch {
    throw new AppError('应用不存在', 404)
  }
}

/** 重置密钥 —— 同样是最后一次可见 */
export async function resetClientSecret(id: number) {
  const client = await prisma.oAuthClient.findUnique({ where: { id } })
  if (!client) throw new AppError('应用不存在', 404)
  if (client.clientType === 'public') throw new AppError('公开客户端没有密钥', 400)

  const plainSecret = generateClientSecret()
  await prisma.oAuthClient.update({
    where: { id },
    data: { clientSecret: await bcrypt.hash(plainSecret, 10) },
  })
  return { clientId: client.clientId, clientSecret: plainSecret }
}

export async function deleteClient(id: number) {
  try {
    // 关联的授权 / 授权码 / 刷新令牌由外键级联删除
    await prisma.oAuthClient.delete({ where: { id } })
  } catch {
    throw new AppError('应用不存在', 404)
  }
}

// === 授权流程 ===

/** 取启用中的应用；不存在或已停用一律按「应用不可用」拒绝 */
export async function requireActiveClient(clientId: string) {
  const client = await prisma.oAuthClient.findUnique({ where: { clientId } })
  if (!client) throw new AppError('应用不存在或未通过审核', 400)
  if (!client.isActive) throw new AppError('应用已被停用', 403)
  return client
}

/** 回调地址必须与注册值精确一致 —— 防止开放重定向 */
export function assertRegisteredRedirectUri(
  client: { redirectUris: string; name: string },
  redirectUri: string,
) {
  const registered = normalizeRedirectUris(client.redirectUris)
  if (!registered.includes(redirectUri)) {
    throw new AppError('回调地址未在应用中注册，已阻止跳转', 400)
  }
}

/** 校验申请 scope：必须是已知 scope，且在该应用被允许的范围内 */
export function resolveRequestedScopes(
  client: { allowedScopes: string; name: string },
  requested: string[],
): AppScope[] {
  const allowed = parseStoredScopes(client.allowedScopes)
  const invalid = requested.filter((scope) => !isAppScope(scope) || !allowed.includes(scope as AppScope))
  if (invalid.length > 0) {
    throw new AppError(`以下权限未被允许：${invalid.join('、')}`, 400)
  }
  if (requested.length === 0) throw new AppError('请至少申请一项权限', 400)
  return requested as AppScope[]
}

/**
 * 建立 / 更新用户对该应用的授权
 *
 * 仅当 scope 集合发生变化时才清空旧的授权码与刷新令牌（凭证轮换）；
 * 用户在授权页重复确认同一组权限不应导致应用现有令牌失效。
 */
export async function ensureGrant(userId: number, clientRecordId: number, scopes: AppScope[]) {
  const existing = await prisma.oAuthGrant.findUnique({
    where: { userId_clientId: { userId, clientId: clientRecordId } },
  })

  const previousScopes = existing ? parseStoredScopes(existing.scopes) : []
  const scopesChanged = !existing
    || previousScopes.length !== scopes.length
    || scopes.some((scope) => !previousScopes.includes(scope))

  const grant = await prisma.oAuthGrant.upsert({
    where: { userId_clientId: { userId, clientId: clientRecordId } },
    create: { userId, clientId: clientRecordId, scopes: JSON.stringify(scopes) },
    update: { scopes: JSON.stringify(scopes), revokedAt: null },
  })

  if (scopesChanged) {
    await prisma.oAuthCode.deleteMany({ where: { grantId: grant.id } })
    await prisma.oAuthRefreshToken.deleteMany({ where: { grantId: grant.id } })
  }

  return grant
}

export async function issueAuthorizationCode(input: {
  grantId: number
  clientRecordId: number
  userId: number
  redirectUri: string
  scopes: AppScope[]
  codeChallenge: string
  codeChallengeMethod: string
}) {
  const code = generateOpaqueToken()
  await prisma.oAuthCode.create({
    data: {
      codeHash: sha256Hex(code),
      grantId: input.grantId,
      clientId: input.clientRecordId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scopes: JSON.stringify(input.scopes),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt: new Date(Date.now() + config.oauthCodeTtlMs),
    },
  })
  return code
}

/** 校验机密客户端的 client_secret（公开客户端跳过） */
async function assertClientSecret(
  client: { clientType: string; clientSecret: string | null; clientId: string },
  providedSecret: string | undefined,
) {
  if (client.clientType === 'public') return true
  if (!providedSecret || !client.clientSecret) return false
  return bcrypt.compare(providedSecret, client.clientSecret)
}

/**
 * 授权码换令牌 —— PKCE 校验 + 一次性核销
 * 返回可继续签发令牌所需的上下文
 */
export async function exchangeAuthorizationCode(input: {
  code: string
  clientId: string
  clientSecret?: string
  redirectUri?: string
  codeVerifier?: string
}) {
  const record = await prisma.oAuthCode.findUnique({
    where: { codeHash: sha256Hex(input.code) },
    include: { client: true, grant: true },
  })
  if (!record) throw new AppError('授权码无效', 400)
  if (record.client.clientId !== input.clientId) throw new AppError('授权码无效', 400)
  if (record.expiresAt.getTime() < Date.now()) throw new AppError('授权码已过期，请重新授权', 400)

  if (!(await assertClientSecret(record.client, input.clientSecret))) {
    throw new AppError('客户端密钥无效', 401)
  }

  // 回调地址必须与签发授权码时一致（RFC 6749 要求）
  if (input.redirectUri !== record.redirectUri) throw new AppError('回调地址与授权时不一致', 400)

  // PKCE：只支持 S256，严禁 plain
  if (record.codeChallengeMethod !== 'S256') throw new AppError('不支持的 PKCE 校验方式', 400)
  if (!input.codeVerifier) throw new AppError('缺少 code_verifier', 400)
  const computed = crypto.createHash('sha256').update(input.codeVerifier).digest('base64url')
  const expected = record.codeChallenge
  const computedBuf = Buffer.from(computed)
  const expectedBuf = Buffer.from(expected)
  const pkceOk = computedBuf.length === expectedBuf.length
    && crypto.timingSafeEqual(computedBuf, expectedBuf)
  if (!pkceOk) throw new AppError('PKCE 校验失败', 400)

  // 原子核销：并发重放时只有一个请求能把 usedAt 从 null 改掉
  const consumed = await prisma.oAuthCode.updateMany({
    where: { id: record.id, usedAt: null },
    data: { usedAt: new Date() },
  })
  if (consumed.count !== 1) throw new AppError('授权码已被使用', 400)

  if (record.grant.revokedAt) throw new AppError('授权已被撤销，请重新授权', 400)
  if (!record.client.isActive) throw new AppError('应用已被停用', 403)

  return {
    userId: record.userId,
    clientRecordId: record.clientId,
    clientId: record.client.clientId,
    grantId: record.grantId,
    scopes: parseStoredScopes(record.scopes),
  }
}

/**
 * 签发应用令牌与刷新令牌
 * 访问令牌是同一个 JWT_SECRET 签名、带 type:'app' 判别标记的作用域令牌；
 * role 固定为 'app'，使所有基于角色的管理端点自动拒绝（未知角色无任何能力）。
 */
export async function mintAppTokens(input: {
  userId: number
  clientRecordId: number
  clientId: string
  grantId: number
  scopes: AppScope[]
}) {
  const accessToken = jwtSign({
    userId: input.userId,
    role: 'app',
    ts: Date.now(),
    type: config.oauthAccessTokenType,
    clientId: input.clientId,
    scopes: input.scopes,
  })

  const refreshToken = generateOpaqueToken()
  await prisma.oAuthRefreshToken.create({
    data: {
      tokenHash: sha256Hex(refreshToken),
      grantId: input.grantId,
      clientId: input.clientRecordId,
      userId: input.userId,
      scopes: JSON.stringify(input.scopes),
      expiresAt: new Date(Date.now() + config.oauthRefreshTokenTtlMs),
    },
  })

  await prisma.oAuthGrant.update({
    where: { id: input.grantId },
    data: { lastUsedAt: new Date() },
  })

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: config.oauthAccessTokenTtlSeconds,
    scope: input.scopes.join(' '),
    refresh_token: refreshToken,
    refresh_expires_in: config.oauthRefreshTokenTtlSeconds,
  }
}

/** 吊销整个授权（含其授权码与刷新令牌） —— 用于检测到刷新令牌重放时 */
async function revokeGrantCascade(grantId: number) {
  await prisma.oAuthGrant.update({
    where: { id: grantId },
    data: { revokedAt: new Date() },
  })
  await prisma.oAuthRefreshToken.deleteMany({ where: { grantId } })
  await prisma.oAuthCode.deleteMany({ where: { grantId } })
}

/**
 * 刷新令牌轮换
 * 旧的刷新令牌立即作废并记录继任者；若已作废的令牌被再次使用，
 * 视为凭证泄露，直接吊销整条授权（RFC 6749 §10.4 的建议做法）。
 */
export async function rotateRefreshToken(input: {
  refreshToken: string
  clientId: string
  clientSecret?: string
}) {
  const record = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash: sha256Hex(input.refreshToken) },
    include: { client: true, grant: true },
  })
  if (!record) throw new AppError('刷新令牌无效', 400)
  if (record.client.clientId !== input.clientId) throw new AppError('刷新令牌无效', 400)

  if (!(await assertClientSecret(record.client, input.clientSecret))) {
    throw new AppError('客户端密钥无效', 401)
  }

  // 重放已轮换的令牌 → 视为泄露，整条授权吊销
  if (record.revokedAt) {
    if (!record.grant.revokedAt) await revokeGrantCascade(record.grantId)
    throw new AppError('检测到刷新令牌重复使用，授权已被撤销，请重新授权', 400)
  }

  if (record.expiresAt.getTime() < Date.now()) throw new AppError('刷新令牌已过期，请重新授权', 400)
  if (record.grant.revokedAt) throw new AppError('授权已被撤销，请重新授权', 400)
  if (!record.client.isActive) throw new AppError('应用已被停用', 403)

  const scopes = parseStoredScopes(record.scopes)
  const tokens = await mintAppTokens({
    userId: record.userId,
    clientRecordId: record.clientId,
    clientId: record.client.clientId,
    grantId: record.grantId,
    scopes,
  })

  const now = new Date()
  await prisma.oAuthRefreshToken.update({
    where: { id: record.id },
    data: {
      revokedAt: now,
      lastUsedAt: now,
      replacedByHash: sha256Hex(tokens.refresh_token),
    },
  })

  return tokens
}

/** 撤销刷新令牌（应用主动登出）。令牌不存在时不报错，避免泄露其是否存在 */
export async function revokeRefreshToken(input: {
  token: string
  clientId: string
  clientSecret?: string
}) {
  const record = await prisma.oAuthRefreshToken.findUnique({
    where: { tokenHash: sha256Hex(input.token) },
    include: { client: true },
  })
  if (!record) return
  if (record.client.clientId !== input.clientId) return
  if (!(await assertClientSecret(record.client, input.clientSecret))) {
    throw new AppError('客户端密钥无效', 401)
  }
  if (record.revokedAt) return
  await prisma.oAuthRefreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date() },
  })
}

// === 用户侧授权管理 ===

export async function listUserGrants(userId: number) {
  const grants = await prisma.oAuthGrant.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    include: { client: true },
  })

  return grants.map((grant) => ({
    id: grant.id,
    scopes: parseStoredScopes(grant.scopes),
    createdAt: grant.createdAt,
    lastUsedAt: grant.lastUsedAt,
    client: {
      name: grant.client.name,
      description: grant.client.description,
      homepage: grant.client.homepage,
    },
  }))
}

/** 撤销授权 —— 仅限本人的授权记录 */
export async function revokeGrant(userId: number, grantId: number) {
  const grant = await prisma.oAuthGrant.findFirst({ where: { id: grantId, userId } })
  if (!grant) throw new AppError('授权不存在', 404)
  if (grant.revokedAt) return
  await revokeGrantCascade(grantId)
}

// === 应用令牌签发 ===

/** 与账号登录令牌使用同一密钥与算法，靠 type:'app' claim 区分 */
function jwtSign(payload: Record<string, unknown>): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: config.oauthAccessTokenTtl })
}
