import dns from 'dns/promises'
import net from 'net'
import { AppError } from '../middleware/errorHandler.js'
import { buildBootstrapScript } from './webProxyBootstrap.js'
import { publicCookiesForUrl, type ProxyCookie } from './proxyCookies.js'

/**
 * 网页反代核心（纯函数 + 少量网络探测）
 *
 * 反代形态：`/proxy/<siteId>/<上游路径>`。
 *  - 所有子资源、根路径请求都由 HTML/CSS 重写 + 注入脚本落回这个前缀
 *  - 登录态由服务端 Cookie 罐持有（见 proxyCookies.ts），浏览器不接触上游 Cookie
 */

const HOST_CHECK_TTL_MS = 5 * 60 * 1000

export interface RewriteContext {
  siteId: number
  /** 站点源站（用户创建时录入），用于判断「同站」绝对 URL */
  siteOrigin: string
  /** 本次响应实际来源（跨域跳转时可能不同于 siteOrigin） */
  activeOrigin: string
}

/** 把用户输入规范化为 origin（协议 + 主机 + 端口），非法输入抛 AppError */
export function normalizeSiteOrigin(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) throw new AppError('请输入网站域名或地址', 400)
  let candidate = raw
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new AppError('网址格式不正确，请形如 example.com 或 https://example.com', 400)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('只支持 http / https 网站', 400)
  }
  if (url.username || url.password) throw new AppError('网址不能包含账号密码', 400)
  // origin 会自动去掉路径、查询串与末尾斜杠
  return url.origin
}

export function prettySiteName(origin: string): string {
  try {
    return new URL(origin).hostname
  } catch {
    return origin
  }
}

/** IPv4 私有 / 保留地址判断 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number.parseInt(n, 10))
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true
  const [a, b] = parts
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a === 169 && b === 254) return true // link-local / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  if (a === 198 && b === 51 && parts[2] === 100) return true
  if (a === 203 && b === 0 && parts[2] === 113) return true
  if (a >= 224) return true // 组播 / 保留
  return false
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower === '::' || lower === '::1') return true
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true // fe80::/10
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true // fc00::/7
  if (lower.startsWith('2001:db8')) return true
  // IPv4-mapped（::ffff:127.0.0.1）
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (mapped) return isPrivateIPv4(mapped[1])
  return false
}

function isPrivateIp(ip: string): boolean {
  const family = net.isIP(ip)
  if (family === 4) return isPrivateIPv4(ip)
  if (family === 6) return isPrivateIPv6(ip)
  return true
}

const hostCheckCache = new Map<string, { ok: boolean; expires: number }>()

/**
 * SSRF 防护：拒绝 localhost / 内网 / 云元数据地址。
 * 每次请求都会校验（带 5 分钟缓存），避免把反代变成内网探针。
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.toLowerCase()
  if (!host) throw new AppError('网址缺少主机名', 400)
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new AppError('不允许反代本机或内网地址', 400)
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new AppError('不允许反代本机或内网地址', 400)
    return
  }
  const cached = hostCheckCache.get(host)
  if (cached && cached.expires > Date.now()) {
    if (!cached.ok) throw new AppError('该域名解析到内网地址，已拒绝', 400)
    return
  }
  let addresses: Array<{ address: string }>
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true })
  } catch {
    throw new AppError('域名解析失败，请确认网站地址是否正确', 400)
  }
  const ok = addresses.length > 0 && addresses.every((item) => !isPrivateIp(item.address))
  hostCheckCache.set(host, { ok, expires: Date.now() + HOST_CHECK_TTL_MS })
  if (!ok) throw new AppError('该域名解析到内网地址，已拒绝', 400)
}

function isProxyableHost(host: string, ctx: RewriteContext): boolean {
  try {
    if (host === new URL(ctx.siteOrigin).host) return true
    if (host === new URL(ctx.activeOrigin).host) return true
  } catch {
    /* ignore */
  }
  return false
}

/**
 * 把 HTML/CSS 中的一个 URL 映射到反代路径。
 *
 * 只改写三类：根路径、与站点同源的绝对 URL、协议相对且同源的 URL。
 * 外部域名原样保留（脚本、字体、CDN 直连，避免代理一切流量）。
 */
export function mapUrlToProxy(value: string, ctx: RewriteContext): string {
  const prefix = `/proxy/${ctx.siteId}`
  if (typeof value !== 'string') return value
  const raw = value
  const trimmed = value.trim()
  if (!trimmed) return raw
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('javascript:')
    || lower.startsWith('data:')
    || lower.startsWith('blob:')
    || lower.startsWith('mailto:')
    || lower.startsWith('tel:')
    || lower.startsWith('about:')
    || lower.startsWith('file:')
    || lower.startsWith('#')
  ) {
    return raw
  }
  if (trimmed === '/') return `${prefix}/`
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    if (trimmed === prefix || trimmed.startsWith(`${prefix}/`)) return raw
    return `${prefix}${trimmed}`
  }
  if (trimmed.startsWith('//')) {
    try {
      const url = new URL(`https:${trimmed}`)
      if (isProxyableHost(url.host, ctx)) return `${prefix}${url.pathname}${url.search}${url.hash}`
    } catch {
      /* ignore */
    }
    return raw
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (isProxyableHost(url.host, ctx)) return `${prefix}${url.pathname}${url.search}${url.hash}`
    } catch {
      /* ignore */
    }
  }
  return raw
}

/** WebSocket URL → 反代 WS 路径（页面脚本里的 WebSocket 构造函数会调用同名逻辑） */
export function mapWsUrlToProxy(value: string, ctx: RewriteContext, pageHost: string, secure: boolean): string {
  const scheme = secure ? 'wss://' : 'ws://'
  const prefix = `/proxy-ws/${ctx.siteId}`
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (trimmed.startsWith(prefix)) return value
  if (trimmed.startsWith('/')) return `${scheme}${pageHost}${prefix}${trimmed}`
  if (/^wss?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (isProxyableHost(url.host, ctx)) {
        return `${scheme}${pageHost}${prefix}${url.pathname}${url.search}${url.hash}`
      }
    } catch {
      /* ignore */
    }
  }
  return value
}

/** 把反代 URL 还原成上游 URL（用于 Referer / Origin 透传） */
export function proxyUrlToUpstream(referer: string | undefined, ctx: RewriteContext): string | undefined {
  if (!referer) return referer
  try {
    const url = new URL(referer, ctx.siteOrigin)
    const prefix = `/proxy/${ctx.siteId}`
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      const rest = url.pathname.slice(prefix.length) || '/'
      const origin = ctx.activeOrigin || ctx.siteOrigin
      return `${origin}${rest}${url.search}`
    }
  } catch {
    /* ignore */
  }
  return referer
}

const ATTR_RE = /(\s(?:href|src|action|poster|formaction|data-src|data-href|data-action|xlink:href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const SRCSET_RE = /(\ssrcset\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi

function rewriteSrcset(value: string, ctx: RewriteContext): string {
  return value
    .split(',')
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return ''
      const space = trimmed.search(/\s/)
      const url = space < 0 ? trimmed : trimmed.slice(0, space)
      const descriptor = space < 0 ? '' : trimmed.slice(space)
      // data: URL 里可能含逗号，原样保留
      if (/^data:/i.test(url)) return trimmed
      return `${mapUrlToProxy(url, ctx)}${descriptor}`
    })
    .filter(Boolean)
    .join(', ')
}

/** 重写 CSS 文本里的 url(...) 与 @import */
export function rewriteCss(css: string, ctx: RewriteContext): string {
  let out = css
  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, url: string) => {
    const mapped = mapUrlToProxy(url, ctx)
    return mapped === url ? match : `url(${quote}${mapped}${quote})`
  })
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, url: string) => {
    const mapped = mapUrlToProxy(url, ctx)
    return mapped === url ? match : `@import ${quote}${mapped}${quote}`
  })
  return out
}

function rewriteAttributes(html: string, ctx: RewriteContext): string {
  let out = html.replace(ATTR_RE, (match, head: string, dq?: string, sq?: string, bare?: string) => {
    const value = dq ?? sq ?? bare ?? ''
    const mapped = mapUrlToProxy(value, ctx)
    if (mapped === value) return match
    return `${head}"${mapped}"`
  })
  out = out.replace(SRCSET_RE, (match, head: string, dq?: string, sq?: string) => {
    const value = dq ?? sq ?? ''
    const mapped = rewriteSrcset(value, ctx)
    return mapped === value ? match : `${head}"${mapped}"`
  })
  return out
}

const META_CSP_RE = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi
const BASE_TAG_RE = /<base\b[^>]*>/gi
const INTEGRITY_RE = /\s+integrity\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const META_REFRESH_RE = /(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'])([^"']*)(["'][^>]*>)/gi

/**
 * 重写整个 HTML 文档并注入引导脚本。
 *
 * 注意 CSP / X-Frame-Options 已在响应头里剥掉；这里的 meta CSP 也必须删掉，
 * 否则内联引导脚本会被上游的旧策略拦掉。
 */
export function rewriteHtml(
  html: string,
  ctx: RewriteContext,
  options: { cookies: Array<{ name: string; value: string }>; charset?: string },
): string {
  let out = html
  out = out.replace(META_CSP_RE, '')
  out = out.replace(BASE_TAG_RE, '')
  out = out.replace(INTEGRITY_RE, '')
  out = out.replace(META_REFRESH_RE, (match, head: string, content: string, tail: string) => {
    const idx = content.toLowerCase().indexOf('url=')
    if (idx < 0) return match
    const prefix = content.slice(0, idx + 4)
    const url = content.slice(idx + 4).trim()
    return `${head}${prefix}${mapUrlToProxy(url, ctx)}${tail}`
  })
  out = rewriteAttributes(out, ctx)
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (match, open: string, body: string, close: string) => {
    const mapped = rewriteCss(body, ctx)
    return mapped === body ? match : `${open}${mapped}${close}`
  })
  out = out.replace(/(<[^>]+\sstyle\s*=\s*")([^"]*)(")/gi, (match, head: string, body: string, tail: string) => {
    const mapped = rewriteCss(body, ctx)
    return mapped === body ? match : `${head}${mapped}${tail}`
  })
  out = out.replace(/(<[^>]+\sstyle\s*=\s*')([^']*)(')/gi, (match, head: string, body: string, tail: string) => {
    const mapped = rewriteCss(body, ctx)
    return mapped === body ? match : `${head}${mapped}${tail}`
  })

  const script = `<script data-lineweb-proxy="${ctx.siteId}">${buildBootstrapScript({
    siteId: ctx.siteId,
    origin: ctx.siteOrigin,
    cookies: options.cookies,
  })}</script>`
  const headMatch = /<head\b[^>]*>/i.exec(out)
  if (headMatch) {
    const at = (headMatch.index ?? 0) + headMatch[0].length
    out = `${out.slice(0, at)}${script}${out.slice(at)}`
  } else {
    const htmlMatch = /<html\b[^>]*>/i.exec(out)
    if (htmlMatch) {
      const at = (htmlMatch.index ?? 0) + htmlMatch[0].length
      out = `${out.slice(0, at)}${script}${out.slice(at)}`
    } else {
      out = `${script}${out}`
    }
  }
  return out
}

/** 从 Cookie 罐取出「页面可见」的初始 Cookie，供 bootstrap 建立 document.cookie 虚拟罐 */
export function initialVisibleCookies(jar: ProxyCookie[], url: URL): Array<{ name: string; value: string }> {
  return publicCookiesForUrl(jar, url)
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 反代错误页（上游不可达 / 超时 / 被拦截） */
export function buildProxyErrorPage(title: string, detail: string, options: { retry?: boolean; login?: boolean } = {}): string {
  const safeTitle = escapeHtml(title)
  const safeDetail = escapeHtml(detail)
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle} · LineWeb 反代</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;
    background:#f6f8fa;color:#1f2328}
  @media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3} .card{background:#161b22;border-color:#30363d} .muted{color:#8b949e} .btn{background:#21262d;border-color:#30363d;color:#e6edf3}}
  .card{max-width:460px;width:calc(100% - 48px);padding:28px;border:1px solid #d0d7de;border-radius:12px;background:#fff;box-shadow:0 8px 24px rgba(31,35,40,.08)}
  .mark{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;margin-bottom:18px}
  .mark span.dot{width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#2f81f7,#8250df);display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:13px}
  h1{font-size:18px;margin:0 0 8px}
  p{margin:0 0 18px;line-height:1.6;font-size:14px}
  .muted{color:#59636e;font-size:13px}
  .actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
  .btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:7px;border:1px solid #d0d7de;background:#f6f8fa;color:#1f2328;font-size:13px;text-decoration:none;cursor:pointer}
</style></head>
<body><div class="card">
  <div class="mark"><span class="dot">LW</span>LineWeb · 网页反代</div>
  <h1>${safeTitle}</h1>
  <p>${safeDetail}</p>
  <div class="actions">
    ${options.retry ? '<a class="btn" href="javascript:location.reload()">重新加载</a>' : ''}
    <a class="btn" href="/webproxy" target="_top">返回 LineWeb</a>
    ${options.login ? '' : '<a class="btn" href="javascript:history.back()">返回上一页</a>'}
  </div>
  <p class="muted" style="margin-top:20px">反代会改写页面资源路径；若目标站点依赖特殊跨域接口，部分功能可能不可用。</p>
</div></body></html>`
}

/** 未登录 / 会话失效页（iframe 内显示） */
export function buildProxyLoginPage(message: string): string {
  return buildProxyErrorPage('需要重新登录 LineWeb', message, { login: true })
}
