import { z } from 'zod'

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'lineweb-dev-secret-change-in-production',
  jwtExpiresIn: '7d' as const,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  storageNodeToken: process.env.STORAGE_NODE_TOKEN || 'lineweb-storage-node-secret-change-in-production',
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
  uploadChunkKB: parseInt(process.env.UPLOAD_CHUNK_KB || '64', 10), // 上传转发块大小 (KB)
  downloadChunkKB: parseInt(process.env.DOWNLOAD_CHUNK_KB || '256', 10), // 下载合并块大小 (KB)
  driveSyncIntervalMs: parseInt(process.env.DRIVE_SYNC_INTERVAL_MS || '300000', 10), // 默认 5 分钟
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
  featureEmoji: z.string().max(10).optional(),
  featureDesc: z.string().max(200).optional(),
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
