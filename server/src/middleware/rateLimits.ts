import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import jwt from 'jsonwebtoken'
import { config } from '../config/index.js'
import type { Request } from 'express'

/**
 * 高频路径豁免全局限流 —— 由路由内的按用户限流接管。
 * 注意：这两个 limiter 都挂在 /api 上，req.path 不含 /api 前缀。
 */
export const apiLimiterSkipPaths = [
  /^\/games\/2048\/matches\/\d+\/moves\/?$/,
  /^\/games\/2048\/sync\/?$/,
  /^\/games\/2048\/presence\/?$/,
  /^\/games\/doudizhu\/matches\/\d+\/actions\/?$/,
  /^\/games\/doudizhu\/sync\/?$/,
  /^\/games\/doudizhu\/presence\/?$/,
  /^\/games\/snake\/matches\/\d+\/actions\/?$/,
  /^\/games\/snake\/sync\/?$/,
  /^\/games\/snake\/presence\/?$/,
  /^\/games\/minesweeper\/matches\/\d+\/actions\/?$/,
  /^\/games\/minesweeper\/sync\/?$/,
  /^\/games\/minesweeper\/presence\/?$/,
  /^\/games\/jump\/matches\/\d+\/actions\/?$/,
  /^\/games\/jump\/sync\/?$/,
  /^\/games\/jump\/presence\/?$/,
  /^\/games\/minecraft\/matches\/\d+\/actions\/?$/,
  /^\/games\/minecraft\/sync\/?$/,
  /^\/games\/minecraft\/presence\/?$/,
  /^\/games\/gomoku\/matches\/\d+\/actions\/?$/,
  /^\/games\/gomoku\/sync\/?$/,
  /^\/games\/gomoku\/presence\/?$/,
  /^\/games\/liar\/matches\/\d+\/actions\/?$/,
  /^\/games\/liar\/sync\/?$/,
  /^\/games\/liar\/presence\/?$/,
  /^\/games\/uno\/matches\/\d+\/actions\/?$/,
  /^\/games\/uno\/sync\/?$/,
  /^\/games\/uno\/presence\/?$/,
  /^\/games\/xiangqi\/matches\/\d+\/actions\/?$/,
  /^\/games\/xiangqi\/sync\/?$/,
  /^\/games\/xiangqi\/presence\/?$/,
  /^\/games\/parkour\/matches\/\d+\/actions\/?$/,
  /^\/games\/parkour\/sync\/?$/,
  /^\/games\/parkour\/presence\/?$/,
  // 聊天 XMPP 长轮询（25s 挂起）由路由内按用户限流接管
  /^\/chat\/xmpp\/http-/,
]

export function isHighFrequencyPath(req: Request): boolean {
  return apiLimiterSkipPaths.some((pattern) => pattern.test(req.path))
}

/**
 * 认证前的 IP 防滥用硬上限。
 *
 * 这里只信任 JWT 中的 role claim 来放行管理员（不查库）：管理员豁免只是放宽
 * 请求频率，真实权限仍由认证中间件按数据库角色解析。即使管理员被降权，
 * 旧 token 最多只能绕过这一层硬上限，仍需通过按用户限流与路由鉴权。
 */
function hasAdminRoleClaim(req: Request): boolean {
  const header = req.headers.authorization
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!bearer) return false
  try {
    const claims = jwt.verify(bearer, config.jwtSecret) as { role?: unknown; type?: unknown }
    return claims.role === 'admin' && !claims.type
  } catch {
    return false
  }
}

const fifteenMinutes = 15 * 60 * 1000

/** 认证前 IP 硬上限：默认 3000 次/15min，可通过环境变量调整 */
export const ipHardLimiter = rateLimit({
  windowMs: fifteenMinutes,
  limit: Math.max(100, Number.parseInt(process.env.API_IP_HARD_LIMIT || '3000', 10) || 3000),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isHighFrequencyPath(req) || hasAdminRoleClaim(req),
  message: { error: '请求过于频繁，请稍后再试' },
})

/**
 * 认证后的按用户业务限额。
 *
 * - 默认 600 次/15min，管理员可逐个用户在管理端调整；
 * - 0 = 不限业务配额（仍受 IP 硬上限约束）；
 * - 管理员恒不触发（角色来自数据库，降权后立即恢复受限）；
 * - 公开路径没有 req.user，跳过并交给登录/OAuth 自己的限流。
 */
export const userApiLimiter = rateLimit({
  windowMs: fifteenMinutes,
  limit: (req) => req.user?.apiRateLimit ?? 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
  skip: (req) => {
    if (!req.user) return true
    if (req.user.role === 'admin') return true
    if (req.user.apiRateLimit === 0) return true
    return isHighFrequencyPath(req)
  },
  message: { error: '请求过于频繁，请稍后再试' },
})
