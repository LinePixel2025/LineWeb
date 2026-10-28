import { Router, type Request, type Response } from 'express'
import { Readable } from 'stream'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { config, proxySiteCreateSchema, proxySiteUpdateSchema } from '../config/index.js'
import { AppError } from '../middleware/errorHandler.js'
import {
  cookieHeaderForUrl,
  countSessionCookies,
  mergeCookieHeaders,
  mergeCookieJar,
  parseSetCookie,
  readCookieJar,
  sanitizeClientCookies,
  serializeCookieJar,
} from '../services/proxyCookies.js'
import { PROXY_SESSION_COOKIE, resolveProxyUserId } from '../services/proxySession.js'
import {
  assertPublicHost,
  buildProxyErrorPage,
  buildProxyLoginPage,
  initialVisibleCookies,
  normalizeSiteOrigin,
  prettySiteName,
  proxyUrlToUpstream,
  rewriteCss,
  rewriteHtml,
} from '../services/webProxyService.js'

/**
 * 网页反代路由
 *
 * 两套入口共用同一个 Router 文件：
 *   - `/api/proxy/*`：站点管理（Bearer 账号令牌），负责签发反代会话 Cookie
 *   - `/proxy/<siteId>/*`：真正的 HTTP 反向代理（同源 Cookie 认证，供 iframe 使用）
 *   - `/proxy-ws/<siteId>/*`：WebSocket 中继（见 services/webProxyWs.ts）
 *
 * 为什么不直接用 iframe 指向目标站：跨域会让 X-Frame-Options / 第三方 Cookie /
 * 换设备登录全部失效；这里由服务端持 Cookie 罐，浏览器只和 LineWeb 同源交互。
 */

/** 反代会话 Cookie 有效期（与账号登录令牌一致，7 天） */
const PROXY_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_UPSTREAM_BODY = 10 * 1024 * 1024
const MAX_UPSTREAM_TIMEOUT_MS = 30 * 1000
const MAX_REWRITE_BYTES = 12 * 1024 * 1024
const MAX_SITES_PER_USER = 60

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
  'cookie',
  'origin',
  'referer',
  'x-lw-cookie',
])

const PASS_RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  'expires',
  'last-modified',
  'etag',
  'accept-ranges',
  'content-range',
  'content-disposition',
  'content-language',
  'vary',
  'x-content-type-options',
]

const DROP_RESPONSE_HEADERS = [
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
  'set-cookie',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'strict-transport-security',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'clear-site-data',
  'report-to',
  'reporting-endpoints',
  'expect-ct',
  'alt-svc',
  'www-authenticate',
]

function getSetCookies(headers: Headers): string[] {
  const withGetter = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetter.getSetCookie === 'function') {
    try {
      const list = withGetter.getSetCookie()
      if (Array.isArray(list) && list.length > 0) return list
    } catch {
      /* fall through */
    }
  }
  const raw = headers.get('set-cookie')
  if (!raw) return []
  // 兼容没有 getSetCookie 的运行时：按 Expires 里的逗号做粗略切分
  return raw.split(/,(?=\s*[^;,=]+=[^;,]*)/).map((s) => s.trim()).filter(Boolean)
}

function siteDto(site: { id: number; name: string; origin: string; cookies: string; lastVisitedAt: Date | null; createdAt: Date; updatedAt: Date }) {
  const jar = readCookieJar(site.cookies)
  return {
    id: site.id,
    name: site.name,
    origin: site.origin,
    host: prettySiteName(site.origin),
    cookieCount: countSessionCookies(jar),
    lastVisitedAt: site.lastVisitedAt,
    createdAt: site.createdAt,
    updatedAt: site.updatedAt,
  }
}

// ============================================================
// /api/proxy —— 站点管理（全局认证中间件已保证 req.user 存在）
// ============================================================

export const proxyApiRouter = Router()

proxyApiRouter.get('/sites', async (req, res) => {
  const userId = req.user!.userId
  const sites = await prisma.proxySite.findMany({
    where: { userId },
    orderBy: [{ lastVisitedAt: 'desc' }, { createdAt: 'desc' }],
  })
  res.json({ sites: sites.map(siteDto) })
})

proxyApiRouter.post('/sites', async (req, res) => {
  const userId = req.user!.userId
  const data = proxySiteCreateSchema.parse(req.body ?? {})
  const origin = normalizeSiteOrigin(data.url)
  await assertPublicHost(new URL(origin).hostname)

  const existing = await prisma.proxySite.findUnique({ where: { userId_origin: { userId, origin } } })
  if (existing) {
    res.status(409).json({ error: '这个网站已经在反代列表里了', site: siteDto(existing) })
    return
  }
  const total = await prisma.proxySite.count({ where: { userId } })
  if (total >= MAX_SITES_PER_USER) {
    res.status(400).json({ error: `最多只能保存 ${MAX_SITES_PER_USER} 个反代站点` })
    return
  }

  const site = await prisma.proxySite.create({
    data: {
      userId,
      origin,
      name: data.name?.trim() || prettySiteName(origin),
    },
  })
  res.status(201).json({ site: siteDto(site) })
})

proxyApiRouter.patch('/sites/:id', async (req, res) => {
  const userId = req.user!.userId
  const siteId = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(siteId)) throw new AppError('站点不存在', 404)
  const data = proxySiteUpdateSchema.parse(req.body ?? {})
  const site = await prisma.proxySite.findFirst({ where: { id: siteId, userId } })
  if (!site) throw new AppError('站点不存在', 404)
  const updated = await prisma.proxySite.update({ where: { id: site.id }, data: { name: data.name.trim() } })
  res.json({ site: siteDto(updated) })
})

proxyApiRouter.delete('/sites/:id', async (req, res) => {
  const userId = req.user!.userId
  const siteId = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(siteId)) throw new AppError('站点不存在', 404)
  const site = await prisma.proxySite.findFirst({ where: { id: siteId, userId } })
  if (!site) throw new AppError('站点不存在', 404)
  await prisma.proxySite.delete({ where: { id: site.id } })
  res.status(204).end()
})

/** 清除该站点在服务端保存的登录态（换设备前/退出登录用） */
proxyApiRouter.delete('/sites/:id/cookies', async (req, res) => {
  const userId = req.user!.userId
  const siteId = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(siteId)) throw new AppError('站点不存在', 404)
  const site = await prisma.proxySite.findFirst({ where: { id: siteId, userId } })
  if (!site) throw new AppError('站点不存在', 404)
  await prisma.proxySite.update({ where: { id: site.id }, data: { cookies: '[]' } })
  res.json({ ok: true })
})

/**
 * 打开站点：签发反代会话 Cookie（httpOnly，7 天），返回 iframe 地址
 *
 * Cookie 里只放 `{userId, type:'proxy'}`，与账号令牌同密钥但 type 不同；
 * 全局 authenticate() 会明确拒绝 proxy 类型，因此它不能被当作 API 令牌使用。
 */
proxyApiRouter.post('/sites/:id/open', async (req, res) => {
  const userId = req.user!.userId
  const siteId = Number.parseInt(req.params.id, 10)
  if (!Number.isFinite(siteId)) throw new AppError('站点不存在', 404)
  const site = await prisma.proxySite.findFirst({ where: { id: siteId, userId } })
  if (!site) throw new AppError('站点不存在', 404)

  const token = jwt.sign(
    { userId, type: 'proxy', ts: Date.now() },
    config.jwtSecret,
    { expiresIn: '7d' },
  )
  res.cookie(PROXY_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    path: '/',
    maxAge: PROXY_SESSION_MAX_AGE_MS,
  })
  await prisma.proxySite.update({ where: { id: site.id }, data: { lastVisitedAt: new Date() } })
  res.json({ url: `/proxy/${site.id}/`, site: siteDto({ ...site, lastVisitedAt: new Date() }) })
})

// ============================================================
// /proxy/<siteId>/* —— HTTP 反向代理（同源 Cookie 认证）
// ============================================================

/** 解析反代会话 Cookie → userId（只接受 type=proxy 的令牌） */
export async function resolveProxySession(req: Request): Promise<number | null> {
  return resolveProxyUserId(req.headers)
}

function readRequestBody(req: Request): Promise<{ body: Buffer | null; tooLarge: boolean }> {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve({ body: null, tooLarge: false })
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let tooLarge = false
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      total += chunk.length
      if (total > MAX_UPSTREAM_BODY) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve({ body: tooLarge ? null : (chunks.length ? Buffer.concat(chunks) : null), tooLarge }))
    req.on('error', reject)
  })
}

function charsetOf(contentType: string, sample: Buffer): string {
  const match = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)
  if (match) return match[1].toLowerCase()
  const head = sample.subarray(0, 2048).toString('latin1')
  const meta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)
  if (meta) return meta[1].toLowerCase()
  return 'utf-8'
}

function decodeBody(buffer: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  }
}

/** Buffer → 独立的 ArrayBuffer（fetch BodyInit 只接受后者，避免共享底层内存） */
function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  const copy = new Uint8Array(buffer.byteLength)
  copy.set(buffer)
  return copy.buffer
}

function isDocumentRequest(req: Request): boolean {
  const dest = req.headers['sec-fetch-dest']
  if (typeof dest === 'string' && dest) return dest === 'document' || dest === 'iframe' || dest === 'frame'
  const accept = req.headers.accept
  return typeof accept === 'string' && accept.includes('text/html')
}

async function persistCookies(siteId: number, previous: string, jar: ReturnType<typeof readCookieJar>): Promise<void> {
  const next = serializeCookieJar(jar)
  if (next === previous) return
  try {
    await prisma.proxySite.update({ where: { id: siteId }, data: { cookies: next } })
  } catch (err) {
    console.warn('[proxy] Cookie 落库失败:', err instanceof Error ? err.message : err)
  }
}

export const proxyHttpRouter = Router()

proxyHttpRouter.use((req, res) => {
  handleProxyRequest(req, res).catch((err) => {
    console.warn('[proxy] 请求处理异常:', err instanceof Error ? err.message : err)
    if (!res.headersSent) {
      res.removeHeader('Content-Security-Policy')
      res.removeHeader('X-Frame-Options')
      res.status(502).type('html').send(buildProxyErrorPage('反代请求失败', '反代服务暂时不可用，请稍后重试。', { retry: true }))
    } else {
      res.end()
    }
  })
})

async function handleProxyRequest(req: Request, res: Response): Promise<void> {
  // helmet 默认会给所有响应加 CSP / X-Frame-Options；反代页面必须去掉，否则无法被 iframe 承载
  res.removeHeader('Content-Security-Policy')
  res.removeHeader('Content-Security-Policy-Report-Only')
  res.removeHeader('X-Frame-Options')
  res.removeHeader('Cross-Origin-Opener-Policy')
  res.removeHeader('Cross-Origin-Embedder-Policy')
  res.removeHeader('Cross-Origin-Resource-Policy')

  const original = req.originalUrl || req.url
  const pathAndQuery = original.startsWith('/proxy') ? original.slice('/proxy'.length) : original
  let parsed: URL
  try {
    parsed = new URL(pathAndQuery, 'http://lineweb.local')
  } catch {
    res.status(400).type('html').send(buildProxyErrorPage('地址无效', '无法解析反代地址。'))
    return
  }
  const match = /^\/(\d+)(\/.*)?$/.exec(parsed.pathname)
  if (!match) {
    res.status(404).type('html').send(buildProxyErrorPage('页面不存在', '反代地址缺少站点编号，请从 LineWeb 的「网页反代」重新打开。'))
    return
  }
  const siteId = Number.parseInt(match[1], 10)
  if (parsed.pathname === `/${siteId}`) {
    // 补末尾斜杠，保证页面里的相对 URL 解析到 /proxy/<id>/ 下
    res.redirect(302, `/proxy/${siteId}/${parsed.search}`)
    return
  }

  const userId = await resolveProxySession(req)
  if (!userId) {
    res.status(401).type('html').send(buildProxyLoginPage('反代会话已失效（可能登出或更换了账号），请回到 LineWeb 的「网页反代」重新打开目标网站。'))
    return
  }

  const site = await prisma.proxySite.findFirst({ where: { id: siteId, userId } })
  if (!site) {
    res.status(404).type('html').send(buildProxyErrorPage('站点不存在', '这个反代站点不存在，或不属于当前账号。'))
    return
  }

  const upstreamPath = parsed.pathname.slice(`/${siteId}`.length) || '/'
  const target = new URL(`${site.origin}${upstreamPath}${parsed.search}`)
  const ctx = { siteId: site.id, siteOrigin: site.origin, activeOrigin: target.origin }

  const cookiesBefore = site.cookies
  let jar = readCookieJar(site.cookies)
  const clientCookies = sanitizeClientCookies(req.headers['x-lw-cookie'] as string | undefined)

  const { body, tooLarge } = await readRequestBody(req)
  if (tooLarge) {
    res.status(413).type('html').send(buildProxyErrorPage('请求体过大', '反代模式下单次上传不能超过 10MB。'))
    return
  }

  if (isDocumentRequest(req)) {
    prisma.proxySite.update({ where: { id: site.id }, data: { lastVisitedAt: new Date() } }).catch(() => {})
  }

  const buildHeaders = (url: URL): Headers => {
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value !== 'string') continue
      if (HOP_BY_HOP.has(name.toLowerCase())) continue
      if (name.toLowerCase().startsWith('sec-') && name.toLowerCase() !== 'sec-ch-ua') continue
      headers.set(name, value)
    }
    // 让 undici 自动协商压缩并解压；下游由我们自己决定是否压缩（/proxy 已在 compression 过滤器里跳过）
    headers.set('accept-encoding', 'gzip, deflate, br')
    const serverCookie = cookieHeaderForUrl(jar, url)
    const merged = mergeCookieHeaders(serverCookie, clientCookies)
    if (merged) headers.set('cookie', merged)
    const referer = proxyUrlToUpstream(req.headers.referer, ctx)
    if (referer) headers.set('referer', referer)
    if (req.headers.origin) headers.set('origin', ctx.activeOrigin)
    const forwardedFor = req.headers['x-forwarded-for']
    const clientIp = req.ip || ''
    headers.set('x-forwarded-for', forwardedFor ? `${forwardedFor}, ${clientIp}` : clientIp)
    headers.set('x-forwarded-proto', req.protocol)
    headers.set('x-forwarded-host', req.headers.host || '')
    return headers
  }

  const method = req.method.toUpperCase()
  let currentUrl = target
  let upstream: globalThis.Response | null = null
  let hops = 0

  while (hops <= 5) {
    await assertPublicHost(currentUrl.hostname)
    let response: globalThis.Response
    try {
      response = await fetch(currentUrl, {
        method,
        headers: buildHeaders(currentUrl),
        body: body ? toArrayBuffer(body) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(MAX_UPSTREAM_TIMEOUT_MS),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const timedOut = /abort|timeout/i.test(message)
      res.status(timedOut ? 504 : 502).type('html').send(buildProxyErrorPage(
        timedOut ? '上游响应超时' : '无法连接目标网站',
        timedOut ? '目标网站在 30 秒内没有响应，请稍后重试。' : '反代服务无法访问该网站，请确认地址是否可正常打开。',
        { retry: true },
      ))
      await persistCookies(site.id, cookiesBefore, jar)
      return
    }

    const setCookies = getSetCookies(response.headers)
    if (setCookies.length > 0) {
      const parsedCookies = setCookies
        .map((header) => parseSetCookie(header, currentUrl))
        .filter((item): item is NonNullable<typeof item> => !!item)
      if (parsedCookies.length > 0) jar = mergeCookieJar(jar, parsedCookies)
    }
    // 每次拿到新响应都落库（跨域跳转时 Cookie 可能来自不同域）
    await persistCookies(site.id, cookiesBefore, jar)

    const location = response.headers.get('location')
    if (response.status >= 300 && response.status < 400 && location) {
      let next: URL
      try {
        next = new URL(location, currentUrl)
      } catch {
        upstream = response
        break
      }
      if (next.origin === currentUrl.origin) {
        // 同源跳转：交回浏览器，让 iframe 地址栏与相对路径跟着更新
        res.status(response.status)
        res.setHeader('location', `/proxy/${site.id}${next.pathname}${next.search}`)
        res.setHeader('cache-control', 'no-store')
        res.setHeader('X-LineWeb-Proxy', '1')
        res.end()
        return
      }
      if (hops >= 5) {
        res.status(508).type('html').send(buildProxyErrorPage('重定向次数过多', '目标网站的重定向链路过长，已停止跟随。'))
        return
      }
      hops += 1
      currentUrl = next
      continue
    }

    upstream = response
    break
  }

  if (!upstream) {
    res.status(502).type('html').send(buildProxyErrorPage('无法完成反代', '上游没有返回可用响应。', { retry: true }))
    return
  }

  ctx.activeOrigin = currentUrl.origin
  const contentType = upstream.headers.get('content-type') || 'application/octet-stream'
  const lowerType = contentType.toLowerCase()
  const isHtml = lowerType.includes('text/html') || lowerType.includes('application/xhtml+xml')
  const isCss = lowerType.includes('text/css')
  const headers: Record<string, string> = {}
  for (const name of PASS_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) headers[name] = value
  }
  for (const name of DROP_RESPONSE_HEADERS) {
    delete headers[name]
    res.removeHeader(name)
  }
  headers['X-LineWeb-Proxy'] = '1'

  res.status(upstream.status)
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)

  if (method === 'HEAD') {
    res.end()
    return
  }

  if (isHtml || isCss) {
    let buffer: Buffer
    try {
      buffer = Buffer.from(await upstream.arrayBuffer())
    } catch {
      res.end()
      return
    }
    if (buffer.byteLength > MAX_REWRITE_BYTES) {
      // 超大文档不重写，直接原样回传（至少保证能打开）
      res.setHeader('content-type', contentType)
      res.end(buffer)
      return
    }
    const charset = charsetOf(contentType, buffer)
    const text = decodeBody(buffer, charset)
    const rewritten = isHtml
      ? rewriteHtml(text, ctx, { cookies: initialVisibleCookies(jar, currentUrl), charset })
      : rewriteCss(text, ctx)
    const output = Buffer.from(rewritten, 'utf8')
    res.setHeader('content-type', isHtml ? 'text/html; charset=utf-8' : 'text/css; charset=utf-8')
    if (isHtml) res.setHeader('cache-control', 'no-store')
    res.setHeader('content-length', String(output.byteLength))
    res.end(output)
    return
  }

  // 二进制 / JSON / JS 等：原样流式回传（不压缩，/proxy 已被 compression 过滤器排除）
  res.setHeader('content-type', contentType)
  if (!upstream.body) {
    res.end()
    return
  }
  const stream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0])
  stream.on('error', () => {
    if (!res.headersSent) res.status(502).end()
    else res.end()
  })
  res.on('close', () => {
    stream.destroy()
  })
  stream.pipe(res)
}
