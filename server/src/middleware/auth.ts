import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
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

export function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization

  if (header?.startsWith('Bearer ')) {
    try {
      const token = header.slice(7)
      const payload = jwt.verify(token, config.jwtSecret) as AuthPayload
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
    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
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
