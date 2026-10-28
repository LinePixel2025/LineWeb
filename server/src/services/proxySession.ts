import type { IncomingHttpHeaders } from 'http'
import { resolveAuthContext } from '../middleware/auth.js'

/**
 * 反代会话 Cookie 的解析与鉴权
 *
 * `/proxy/*`（iframe 导航、子资源）与 `/proxy-ws/*`（WebSocket 升级）都不走
 * `/api` 的全局认证中间件，因为浏览器无法在 iframe 里附带 Bearer 头。
 * 因此改用 httpOnly Cookie：`lw_proxy`，令牌 type=proxy，由 /api/proxy/sites/:id/open 签发。
 *
 * 该令牌与账号令牌同密钥但类型不同，authenticate() 明确拒绝 type=proxy，
 * 所以即使泄漏也不能调用任何 API。
 */

export const PROXY_SESSION_COOKIE = 'lw_proxy'

export function readCookieValue(headers: IncomingHttpHeaders, name: string): string {
  const raw = headers.cookie
  if (!raw) return ''
  for (const segment of raw.split(';')) {
    const item = segment.trim()
    const eq = item.indexOf('=')
    if (eq <= 0) continue
    if (item.slice(0, eq).trim() !== name) continue
    const value = item.slice(eq + 1).trim()
    try {
      return decodeURIComponent(value)
    } catch {
      return value
    }
  }
  return ''
}

/** 解析反代会话 → userId；无效 / 类型不符 / 账号失效均返回 null */
export async function resolveProxyUserId(headers: IncomingHttpHeaders): Promise<number | null> {
  const token = readCookieValue(headers, PROXY_SESSION_COOKIE)
  if (!token) return null
  const result = await resolveAuthContext(token)
  if (!result.ok) return null
  if (result.user.type !== 'proxy') return null
  return result.user.userId
}
