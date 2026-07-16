import { z } from 'zod'

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
  corsOrigin: parseCorsOrigins(process.env.CORS_ORIGIN),
  storageNodeToken: requireEnv('STORAGE_NODE_TOKEN', process.env.NODE_ENV === 'production' ? undefined : 'lineweb-storage-node-secret'),
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
  uploadChunkKB: parseInt(process.env.UPLOAD_CHUNK_KB || '64', 10),
  downloadChunkKB: parseInt(process.env.DOWNLOAD_CHUNK_KB || '256', 10),
  driveSyncIntervalMs: parseInt(process.env.DRIVE_SYNC_INTERVAL_MS || '300000', 10),
  apiKeyPrefix: 'lw_',
  apiKeyLength: 48,
}

export const registerSchema = z.object({
  username: z.string().min(2).max(50),
  email: z.string().email().max(100),
  password: z.string().min(6).max(100),
})

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
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

export const commentSchema = z.object({
  content: z.string().min(1, '评论不能为空').max(2000, '评论过长'),
  postId: z.number().int().positive(),
  parentId: z.number().int().positive().optional(),
})

export const commentUpdateSchema = z.object({
  content: z.string().min(1, '评论内容不能为空').max(2000, '评论过长'),
})

export const updateUserSchema = z.object({
  role: z.enum(['user', 'admin']).optional(),
  password: z.string().min(6).max(100).optional(),
})

export const createApiKeySchema = z.object({
  name: z.string().min(1, '名称不能为空').max(100),
  expiresAt: z.string().optional(),
})

export const updateApiKeySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  active: z.boolean().optional(),
  expiresAt: z.string().nullable().optional(),
})

export const createScreenTimeTokenSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  expiresAt: z.string().optional(),
})

export const pushScreenTimeSchema = z.object({
  totalSeconds: z.number().int().min(0).max(86400),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const setDailyGoalSchema = z.object({
  goalSeconds: z.number().int().min(0).max(86400).nullable(),
})
