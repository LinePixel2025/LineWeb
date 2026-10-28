/**
 * 网页反代 — 服务端 Cookie 罐
 *
 * 反代站点的一切登录态都以「服务端 Cookie 罐」为真相源：
 *   - 上游 `Set-Cookie` 被浏览器隔离，全部落库到 ProxySite.cookies（按 userId 归属）
 *   - 因此换设备 / 换浏览器后，只要登录同一个 LineWeb 账号，站点登录态原样恢复
 *
 * 这里只做纯函数（解析 / 合并 / 匹配 / 序列化），方便自检脚本直接断言。
 */

export interface ProxyCookie {
  name: string
  value: string
  /** 规范化后的域名（不带前导点），hostOnly=true 时要求精确匹配 */
  domain: string
  path: string
  /** epoch ms；缺省表示会话 Cookie（进程内不过期，落库后长期有效） */
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: string
  /** 上游未给 Domain 属性时为 true（只回传给同一主机） */
  hostOnly?: boolean
}

const MAX_COOKIES = 200
const MAX_VALUE_LENGTH = 4096

/** 默认 Path：RFC 6265 的「目录部分」，例如 /a/b/c → /a/b */
export function defaultCookiePath(pathname: string): string {
  if (!pathname || pathname[0] !== '/') return '/'
  const idx = pathname.lastIndexOf('/')
  if (idx <= 0) return '/'
  return pathname.slice(0, idx)
}

/** 解析单条 Set-Cookie（不做 URL 之外的外部依赖） */
export function parseSetCookie(header: string, requestUrl: URL): ProxyCookie | null {
  if (!header) return null
  const parts = header.split(';')
  const first = parts.shift()?.trim() ?? ''
  const eq = first.indexOf('=')
  if (eq <= 0) return null

  const name = first.slice(0, eq).trim()
  if (!name || /[\s;,=]/.test(name)) return null
  let value = first.slice(eq + 1).trim()
  if (value.length > MAX_VALUE_LENGTH) value = value.slice(0, MAX_VALUE_LENGTH)
  // 值里可能带引号，保留原始值即可（转发时按原样回写）
  if (!value) value = ''

  const host = requestUrl.hostname.toLowerCase()
  let domain = host
  let hostOnly = true
  let path = ''
  let expires: number | undefined
  let maxAge: number | undefined
  let httpOnly = false
  let secure = false
  let sameSite: string | undefined

  for (const raw of parts) {
    const attr = raw.trim()
    if (!attr) continue
    const idx = attr.indexOf('=')
    const key = (idx < 0 ? attr : attr.slice(0, idx)).trim().toLowerCase()
    const val = idx < 0 ? '' : attr.slice(idx + 1).trim()
    switch (key) {
      case 'domain': {
        const d = val.replace(/^\./, '').toLowerCase()
        // 只接受当前主机或其父域，防止上游把 Cookie 写到无关域名
        if (d && (host === d || host.endsWith('.' + d))) {
          domain = d
          hostOnly = false
        }
        break
      }
      case 'path':
        if (val.startsWith('/')) path = val
        break
      case 'expires': {
        const ts = Date.parse(val)
        if (!Number.isNaN(ts)) expires = ts
        break
      }
      case 'max-age': {
        const seconds = Number.parseInt(val, 10)
        if (Number.isFinite(seconds)) maxAge = seconds
        break
      }
      case 'httponly':
        httpOnly = true
        break
      case 'secure':
        secure = true
        break
      case 'samesite':
        sameSite = val.toLowerCase()
        break
      default:
        break
    }
  }

  // Max-Age 优先于 Expires（RFC 6265）
  if (maxAge !== undefined) {
    expires = maxAge <= 0 ? 0 : Date.now() + maxAge * 1000
  }
  if (!path) path = defaultCookiePath(requestUrl.pathname)

  return {
    name,
    value,
    domain,
    path,
    expires,
    httpOnly,
    secure,
    sameSite,
    hostOnly,
  }
}

/** 解析 ProxySite.cookies 字段；异常一律按空罐处理 */
export function readCookieJar(raw: string | null | undefined, now = Date.now()): ProxyCookie[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((c): c is ProxyCookie => !!c && typeof c.name === 'string' && typeof c.value === 'string')
      .filter((c) => c.expires === undefined || c.expires === 0 || c.expires > now)
      .slice(-MAX_COOKIES)
  } catch {
    return []
  }
}

/** 合并 Set-Cookie：同名 + 同域 + 同路径覆盖；Max-Age=0 / 过期即删除 */
export function mergeCookieJar(existing: ProxyCookie[], incoming: ProxyCookie[], now = Date.now()): ProxyCookie[] {
  const keyOf = (c: ProxyCookie) => `${c.name}\n${c.domain}\n${c.path}`
  const map = new Map<string, ProxyCookie>()
  for (const c of existing) {
    if (c.expires !== undefined && c.expires !== 0 && c.expires <= now) continue
    map.set(keyOf(c), c)
  }
  for (const c of incoming) {
    const key = keyOf(c)
    if (c.expires === 0 || (c.expires !== undefined && c.expires <= now)) {
      map.delete(key)
      continue
    }
    // 同名同路径、域名从 hostOnly 升级为 Domain 的情况也视为覆盖
    map.delete(key)
    map.set(key, c)
  }
  return Array.from(map.values()).slice(-MAX_COOKIES)
}

function domainMatches(cookie: ProxyCookie, hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (cookie.hostOnly) return host === cookie.domain
  return host === cookie.domain || host.endsWith('.' + cookie.domain)
}

function pathMatches(cookiePath: string, pathname: string): boolean {
  if (cookiePath === '/' || cookiePath === '') return true
  if (pathname === cookiePath) return true
  if (!pathname.startsWith(cookiePath)) return false
  // /foo 不应匹配 /foobar
  return cookiePath.endsWith('/') || pathname.charAt(cookiePath.length) === '/'
}

/** 生成发往上游的 Cookie 请求头（不含过期 Cookie） */
export function cookieHeaderForUrl(jar: ProxyCookie[], url: URL, now = Date.now()): string {
  const pathname = url.pathname || '/'
  const pairs: string[] = []
  for (const c of jar) {
    if (c.expires !== undefined && c.expires !== 0 && c.expires <= now) continue
    if (c.secure && url.protocol !== 'https:') continue
    if (!domainMatches(c, url.hostname)) continue
    if (!pathMatches(c.path, pathname)) continue
    pairs.push(`${c.name}=${c.value}`)
  }
  return pairs.join('; ')
}

/** 前端 document.cookie 虚拟罐里允许回传的 Cookie（只回非 HttpOnly 的，避免越权） */
export function sanitizeClientCookies(raw: string | undefined): string {
  if (!raw) return ''
  const pairs: string[] = []
  for (const segment of raw.split(';')) {
    const item = segment.trim()
    if (!item) continue
    const eq = item.indexOf('=')
    if (eq <= 0) continue
    const name = item.slice(0, eq).trim()
    if (!name || /[\s,;]/.test(name)) continue
    if (pairs.length >= 100) break
    pairs.push(item)
  }
  return pairs.join('; ')
}

/** 合并「服务端罐」与「页面 JS 写入的 Cookie」：JS 写入的覆盖同名项 */
export function mergeCookieHeaders(serverHeader: string, clientHeader: string): string {
  if (!clientHeader) return serverHeader
  if (!serverHeader) return clientHeader
  const order: string[] = []
  const map = new Map<string, string>()
  for (const header of [serverHeader, clientHeader]) {
    for (const segment of header.split(';')) {
      const item = segment.trim()
      if (!item) continue
      const eq = item.indexOf('=')
      if (eq <= 0) continue
      const name = item.slice(0, eq).trim()
      if (!map.has(name)) order.push(name)
      map.set(name, item)
    }
  }
  return order.map((name) => map.get(name) ?? '').filter(Boolean).join('; ')
}

/** 交给页面内 bootstrap 的初始值：只暴露非 HttpOnly Cookie（等价浏览器可见范围） */
export function publicCookiesForUrl(jar: ProxyCookie[], url: URL, now = Date.now()): Array<{ name: string; value: string }> {
  return jar
    .filter((c) => !c.httpOnly)
    .filter((c) => c.expires === undefined || c.expires === 0 || c.expires > now)
    .filter((c) => !c.secure || url.protocol === 'https:')
    .filter((c) => domainMatches(c, url.hostname) && pathMatches(c.path, url.pathname || '/'))
    .slice(0, 100)
    .map((c) => ({ name: c.name, value: c.value }))
}

/** 落库前的序列化（控制体积，防止恶意站点把库撑爆） */
export function serializeCookieJar(jar: ProxyCookie[]): string {
  return JSON.stringify(jar.slice(-MAX_COOKIES))
}

/** 统计「登录态」数量：仅用于前端展示，不参与鉴权 */
export function countSessionCookies(jar: ProxyCookie[], now = Date.now()): number {
  return jar.filter((c) => c.expires === undefined || c.expires === 0 || c.expires > now).length
}
