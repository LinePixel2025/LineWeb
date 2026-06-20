import { z } from 'zod'

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'lineweb-dev-secret-change-in-production',
  jwtExpiresIn: '7d',
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
