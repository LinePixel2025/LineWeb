import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import prisma from '../lib/prisma.js'
import { config } from '../config/index.js'

export interface AuthPayload {
  userId: number
  role: string
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthPayload
    }
  }
}

// === JWT 失效校验缓存 ===
// 避免每请求查 DB：缓存 user.tokenValidAfter，60s TTL
const tokenValidAfterCache = new Map<number, { value: Date; expireAt: number }>()
const TOKEN_VALID_AFTER_TTL_MS = 60 * 1000

/** 清除指定用户的 tokenValidAfter 缓存（登出/改密时调用） */
export function clearTokenValidAfterCache(userId: number): void {
  tokenValidAfterCache.delete(userId)
}

async function getTokenValidAfter(userId: number): Promise<Date> {
  const cached = tokenValidAfterCache.get(userId)
  if (cached && Date.now() < cached.expireAt) {
    return cached.value
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { tokenValidAfter: true },
  })
  if (!user) {
    // 用户不存在 — 返回当前时间使所有 token 失效
    return new Date()
  }
  const value = user.tokenValidAfter
  tokenValidAfterCache.set(userId, { value, expireAt: Date.now() + TOKEN_VALID_AFTER_TTL_MS })
  return value
}

/** 计算 API Key 的 sha256 哈希 */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex')
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization

  if (header?.startsWith('Bearer ')) {
    try {
      const token = header.slice(7)
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload & { iat?: number }

      // JWT 失效校验：token 签发时间必须 >= user.tokenValidAfter
      if (payload.iat && payload.userId) {
        const validAfter = await getTokenValidAfter(payload.userId)
        if (payload.iat * 1000 < validAfter.getTime()) {
          res.status(401).json({ error: 'Token 已失效，请重新登录' })
          return
        }
      }

      req.user = payload
      next()
      return
    } catch {
      // JWT 无效，尝试 API Key
    }
  }

  const apiKey = req.headers['x-api-key'] as string | undefined
  if (apiKey) {
    authenticateWithApiKeyAndSetUser(req, res, next, apiKey)
    return
  }

  res.status(401).json({ error: '未登录' })
}

async function authenticateWithApiKeyAndSetUser(
  req: Request,
  res: Response,
  next: NextFunction,
  apiKey: string,
) {
  try {
    // 用 sha256 哈希查询 — DB 不存明文 key
    const keyRecord = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(apiKey) },
      select: {
        id: true,
        userId: true,
        active: true,
        expiresAt: true,
        user: { select: { role: true } },
      },
    })

    if (!keyRecord || !keyRecord.active) {
      res.status(401).json({ error: 'API Key 无效或已禁用' })
      return
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      res.status(401).json({ error: 'API Key 已过期' })
      return
    }

    req.user = { userId: keyRecord.userId, role: keyRecord.user.role }

    prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() },
    }).catch(() => {})

    next()
  } catch (err) {
    console.error('[Auth] API Key 验证错误:', err)
    res.status(500).json({ error: '认证服务异常' })
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: '需要管理员权限' })
    return
  }
  next()
}
