import { Request, Response, NextFunction } from 'express'
import { verifyScreenTimeToken } from '../services/screenTimeService.js'

declare global {
  namespace Express {
    interface Request {
      screenTimeToken?: { userId: number }
    }
  }
}

export async function authenticateScreenTimeToken(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers['x-screen-time-token'] || req.headers.authorization
  const token = typeof header === 'string'
    ? (header.startsWith('Bearer ') ? header.slice(7) : header)
    : undefined

  if (!token) {
    return next({ status: 401, message: '缺少屏幕时间 Token' })
  }

  const record = await verifyScreenTimeToken(token)
  if (!record) {
    return next({ status: 401, message: 'Token 无效或已过期' })
  }

  req.screenTimeToken = { userId: record.userId }
  next()
}
