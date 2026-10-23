import { z } from 'zod'
import { USER_ROLES } from '../lib/permissions.js'
import { APP_SCOPES } from '../lib/appScopes.js'

function parseCorsOrigins(raw: string | undefined): string | string[] | boolean {
  if (!raw) return 'http://localhost:5173'
  if (raw === '*') return true  // 允许任意源（生产环境慎用）
  const origins = raw.split(',').map(s => s.trim()).filter(Boolean)
  return origins.length === 1 ? origins[0] : origins
}

/**
 * 要求环境变量必须存在
 * 生产环境：缺失时直接抛错，防止使用不安全的默认值
 * 开发环境：允许使用 fallback 默认值
 */
function requireEnv(key: string, fallback?: string): string {
  const value = process.env[key] || fallback
  if (!value) {
    throw new Error(`环境变量 ${key} 未设置，请检查 .env 或 Railway 配置`)
  }
  return value
}

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: requireEnv('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'lineweb-dev-secret'),
  jwtExpiresIn: '7d' as const,
  downloadTicketExpiresIn: '5m' as const,
  // === 第三方应用授权（OAuth 2.0 授权码 + PKCE）时效 ===
  oauthCodeTtlMs: 5 * 60 * 1000,           // 授权码 5 分钟有效，且只能使用一次
  oauthAccessTokenTtl: '1h' as const,      // 应用访问令牌 1 小时（短期，靠刷新令牌续期）
  oauthAccessTokenTtlSeconds: 3600,
  oauthRefreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000, // 刷新令牌 30 天
  oauthRefreshTokenTtlSeconds: 2592000,
  oauthAccessTokenType: 'app' as const,    // 应用令牌的 type claim，用于与下载票据区分
  corsOrigin: parseCorsOrigins(process.env.CORS_ORIGIN),
  storageNodeToken: requireEnv('STORAGE_NODE_TOKEN', process.env.NODE_ENV === 'production' ? undefined : 'lineweb-storage-node-secret'),
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
  uploadChunkKB: parseInt(process.env.UPLOAD_CHUNK_KB || '64', 10),
  downloadChunkKB: parseInt(process.env.DOWNLOAD_CHUNK_KB || '256', 10),
  streamChunkKB: parseInt(process.env.STREAM_CHUNK_KB || '4096', 10),
  driveSyncIntervalMs: parseInt(process.env.DRIVE_SYNC_INTERVAL_MS || '300000', 10),
}

export const registerSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email().max(100),
  password: z.string().min(6).max(100),
})

export const loginSchema = z.object({
  identifier: z.string().min(1).max(100).optional(),
  email: z.string().email().optional(),
  username: z.string().min(1).max(50).optional(),
  password: z.string().min(1).max(100),
  // 设备长期登录：第三方脚本/桌面应用可申请更长的令牌有效期（仍是同一个账号登录令牌）
  rememberDays: z.number().int().min(1).max(90).optional(),
}).refine((d) => d.identifier || d.email || d.username, {
  message: '请输入邮箱或用户名',
})

export const postSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  summary: z.string().max(500).optional(),
  slug: z.string().min(1).max(255),
  published: z.boolean().optional().default(false),
})

export const postUpdateSchema = postSchema.partial()

export const pageSchema = z.object({
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(255),
  schema: z.string().min(1, '页面 Schema 不能为空'),
  published: z.boolean().optional().default(false),
  featured: z.boolean().optional().default(false),
  featureEmoji: z.string().max(10).nullish(),
  featureDesc: z.string().max(200).nullish(),
})

export const pageUpdateSchema = pageSchema.partial()

export const updateSettingsSchema = z.object({
  settings: z.string().min(1, '设置不能为空'),
})

export const updateProfileSchema = z.object({
  username: z.string().min(2).max(50).optional(),
  currentPassword: z.string().min(1).max(100).optional(),
  newPassword: z.string().min(6).max(100).optional(),
}).refine((d) => d.username || d.newPassword, {
  message: '请提供要修改的用户名或新密码',
})

export const commentSchema = z.object({
  content: z.string().min(1, '评论不能为空').max(2000, '评论过长'),
  postId: z.number().int().positive(),
  parentId: z.number().int().positive().optional(),
})

export const commentUpdateSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(2000, '评论过长'),
})

export const updateUserSchema = z.object({
  role: z.enum(USER_ROLES).optional(),
  password: z.string().min(6).max(100).optional(),
})

export const pushScreenTimeSchema = z.object({
  totalSeconds: z.number().int().min(0).max(86400),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const setDailyGoalSchema = z.object({
  goalSeconds: z.number().int().min(0).max(86400).nullable(),
})

export const screenTimeRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).refine(({ from, to }) => to >= from, {
  message: '结束日期不能早于起始日期',
  path: ['to'],
}).refine(({ from, to }) => {
  const spanDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400000)
  return spanDays <= 62
}, {
  message: '查询跨度不能超过 62 天',
  path: ['to'],
})

// === AI 助手 Schemas ===

export const aiChatSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(2000, '消息过长'),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).max(20).optional().default([]),
})

export const aiConfigUpdateSchema = z.object({
  provider: z.string().min(1).max(50).optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().max(200).optional(),
  baseUrl: z.string().max(500).nullable().optional(),
  systemPrompt: z.string().max(3000).optional(),
  isEnabled: z.boolean().optional(),
})

// === AI 写作辅助 Schemas（/ai/write/*，管理端专用） ===

export const aiWriteSummarySchema = z.object({
  content: z.string().min(1, '正文不能为空').max(20000, '正文过长，请缩减后重试'),
})

export const aiWritePolishSchema = z.object({
  text: z.string().min(1, '请先选中要处理的文字').max(6000, '选中文字过长'),
  action: z.enum(['polish', 'expand', 'fix']).optional().default('polish'),
})

export const aiWriteTitlesSchema = z.object({
  content: z.string().min(1, '正文不能为空').max(20000, '正文过长，请缩减后重试'),
  summary: z.string().max(500).optional(),
})

export const aiWriteDraftSchema = z.object({
  prompt: z.string().min(1, '请输入主题或要求').max(2000, '描述过长'),
  outline: z.string().max(2000).optional(),
  tone: z.enum(['formal', 'casual', 'tech', 'story']).optional(),
  length: z.enum(['short', 'medium', 'long']).optional(),
})

// === 第三方应用授权 Schemas（/oauth/*） ===

/** 授权页参数：应用名下的 client_id + 回调地址 + 申请的 scope + 防 CSRF 的 state */
export const oauthAuthorizeQuerySchema = z.object({
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().min(1).max(500),
  scope: z.string().min(1).max(500),
  state: z.string().max(200).optional(),
})

/** 用户在授权页的最终决定 */
export const oauthAuthorizeDecisionSchema = oauthAuthorizeQuerySchema.extend({
  decision: z.enum(['approve', 'deny']),
})

/** 令牌端点：授权码换令牌 / 刷新令牌轮换，字段按 grant_type 在路由内分别校验 */
export const oauthTokenSchema = z.object({
  grant_type: z.enum(['authorization_code', 'refresh_token']),
  client_id: z.string().min(1).max(100),
  client_secret: z.string().max(200).optional(),
  code: z.string().max(200).optional(),
  redirect_uri: z.string().max(500).optional(),
  code_verifier: z.string().max(200).optional(),
  refresh_token: z.string().max(200).optional(),
})

/** 撤销端点 */
export const oauthRevokeSchema = z.object({
  client_id: z.string().min(1).max(100),
  client_secret: z.string().max(200).optional(),
  token: z.string().min(1).max(200),
})

/** 管理员注册应用 */
export const oauthClientCreateSchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).optional(),
  homepage: z.string().max(300).optional(),
  redirectUris: z.array(z.string().min(1).max(500)).min(1).max(20),
  allowedScopes: z.array(z.enum(APP_SCOPES)).min(1),
  clientType: z.enum(['confidential', 'public']).default('confidential'),
})

/** 管理员更新应用（可停用 / 启用） */
export const oauthClientUpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  description: z.string().max(200).optional(),
  homepage: z.string().max(300).optional(),
  redirectUris: z.array(z.string().min(1).max(500)).min(1).max(20).optional(),
  allowedScopes: z.array(z.enum(APP_SCOPES)).min(1).optional(),
  clientType: z.enum(['confidential', 'public']).optional(),
  isActive: z.boolean().optional(),
})

// === 好友 / 聊天 Schemas ===

export const chatUserTargetSchema = z.object({
  userId: z.number().int().positive(),
})

export const chatMessageSchema = z.object({
  content: z.string().trim().min(1, '消息不能为空').max(2000, '消息过长'),
})

export const chatReadSchema = z.object({
  lastMessageId: z.number().int().nonnegative(),
})

export const chatGroupCreateSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(60, '群名过长'),
  memberIds: z.array(z.number().int().positive()).min(1, '至少选择一位好友').max(49),
})

export const chatGroupUpdateSchema = z.object({
  name: z.string().trim().min(1, '群名不能为空').max(60, '群名过长'),
})

export const chatGroupMembersSchema = z.object({
  userIds: z.array(z.number().int().positive()).min(1).max(49),
})

export const chatSearchSchema = z.object({
  q: z.string().trim().min(1).max(50),
})

// === 网盘空间配额 Schema ===

export const updateUserQuotaSchema = z.object({
  // 用纯数字字符串传输，避免 JS number 在超大字节数上的精度问题
  storageQuotaBytes: z.string().regex(/^\d{1,16}$/, '请提供字节数（字符串）'),
})
