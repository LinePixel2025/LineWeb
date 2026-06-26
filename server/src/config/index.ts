import { z } from 'zod'

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'lineweb-dev-secret-change-in-production',
  jwtExpiresIn: '7d' as const,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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
