import dns from 'dns/promises'
import net from 'net'
import { AppError } from '../middleware/errorHandler.js'
import { buildBootstrapScript } from './webProxyBootstrap.js'
import { publicCookiesForUrl, type ProxyCookie } from './proxyCookies.js'
import { buildMediaProxyPath, isMediaProxyPath } from './webProxyMedia.js'
import { buildResProxyPath, isResProxyPath } from './webProxyRes.js'
import { rewriteInlineScripts, rewriteRenderData, transpileInlineScripts } from './webProxyBody.js'
import { transpileToEs5 } from './webProxyTranspile.js'
import { polyfillPath } from './webProxyPolyfills.js'
import { RESOURCE_CDN_SUFFIXES, hostMatchesSuffix, isResourceCdnHost } from './webProxyHosts.js'
import { isProxyHostBlacklisted } from './proxyBlacklist.js'
import {
  classifyProfileHost,
  isProfileMediaPath,
  profileForOrigin,
  type ProfileHostClass,
  type SiteProfile,
} from './webProxyProfiles.js'

/**
 * 网页反代核心（纯函数 + 少量网络探测）
 *
 * 反代形态：
 *  - `/proxy/<siteId>/<上游路径>`：站点 origin 的页面与接口；
 *  - `/proxy/<siteId>/<scheme>/<host>/<path>`：同注册域兄弟子域（站点族），
 *    例如站点是 www.bilibili.com 时，passport.bilibili.com / api.bilibili.com
 *    的登录与数据接口会改写成这种「内嵌主机」形态；
 *  - 所有子资源、根路径请求都由 HTML/CSS 重写 + 注入脚本落回这个前缀；
 *  - 登录态由服务端 Cookie 罐持有（见 proxyCookies.ts），浏览器不接触上游 Cookie。
 */

// ============================================================
// 站点族（同注册域子域）
// ============================================================

/**
 * 常见多段公共后缀（轻量 PSL）：命中时注册域取倒数第三段。
 * 只收确定的三段式后缀；表外的多段后缀一律视为「无法可靠判断」→ 不启用同族改写。
 */
const MULTIPART_PUBLIC_SUFFIXES = new Set([
  // 中国大陆 / 港澳台
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn', 'mil.cn',
  'com.hk', 'org.hk', 'edu.hk', 'gov.hk', 'idv.hk',
  'com.tw', 'org.tw', 'edu.tw', 'gov.tw', 'idv.tw', 'net.tw',
  'com.mo', 'org.mo', 'edu.mo', 'gov.mo',
  // 日韩
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp', 'ad.jp', 'ed.jp', 'gr.jp', 'lg.jp',
  'co.kr', 'or.kr', 'ne.kr', 're.kr', 'pe.kr', 'go.kr', 'mil.kr', 'ac.kr',
  // 东南亚 / 南亚
  'com.sg', 'net.sg', 'org.sg', 'edu.sg', 'gov.sg', 'per.sg',
  'com.my', 'net.my', 'org.my', 'edu.my', 'gov.my',
  'com.th', 'net.th', 'org.th', 'ac.th', 'go.th', 'in.th',
  'com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn',
  'com.ph', 'net.ph', 'org.ph', 'edu.ph', 'gov.ph',
  'com.id', 'net.id', 'or.id', 'web.id', 'ac.id', 'go.id', 'sch.id',
  'co.in', 'net.in', 'org.in', 'firm.in', 'gen.in', 'ind.in', 'ac.in', 'edu.in', 'res.in', 'gov.in', 'mil.in',
  // 大洋洲 / 英国
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz', 'gen.nz', 'geek.nz', 'maori.nz',
  'co.uk', 'org.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'ac.uk', 'gov.uk',
  // 美洲
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
  'com.mx', 'net.mx', 'org.mx', 'edu.mx', 'gob.mx',
  'com.ar', 'net.ar', 'org.ar', 'edu.ar', 'gob.ar',
  'com.co', 'net.co', 'org.co', 'edu.co', 'gov.co',
  'com.pe', 'com.ve', 'com.ec', 'com.uy', 'com.py', 'com.bo',
  // 其他常见
  'co.za', 'org.za', 'net.za', 'web.za', 'gov.za', 'ac.za',
  'com.tr', 'net.tr', 'org.tr', 'edu.tr', 'gov.tr',
  'com.sa', 'net.sa', 'org.sa', 'edu.sa', 'gov.sa',
  'com.eg', 'com.pk', 'com.bd', 'com.ng', 'com.gh',
  'com.ua', 'net.ua', 'org.ua', 'edu.ua', 'gov.ua', 'in.ua',
  'co.il', 'org.il', 'net.il', 'ac.il', 'gov.il',
  'co.ae', 'net.ae', 'org.ae', 'ac.ae', 'gov.ae',
  'com.pl', 'net.pl', 'org.pl', 'edu.pl', 'gov.pl', 'prv.pl',
  'co.ke',
])

/**
 * 放心启用「同族」扩展的单段 TLD：注册域取倒数第二段。
 * 表外 TLD（含冷门多段后缀体系）返回 null → 不启用同族改写，行为回退旧版，宁可错过不误判。
 */
const FAMILY_TLDS = new Set([
  // 通用 gTLD
  'com', 'net', 'org', 'info', 'biz', 'name', 'pro', 'xyz', 'top', 'vip', 'club', 'shop', 'site',
  'online', 'tech', 'store', 'fun', 'space', 'website', 'live', 'cloud', 'icu', 'app', 'dev', 'page',
  'art', 'design', 'studio', 'media', 'news', 'blog', 'wiki', 'games', 'game', 'video', 'social',
  'network', 'world', 'today', 'life', 'link', 'work', 'zone', 'cool', 'run', 'gold', 'pink', 'love',
  'city', 'plus', 'team', 'group', 'ltd', 'pub', 'tips', 'tools', 'systems', 'solutions', 'email',
  'care', 'fund', 'press', 'mobi', 'tel', 'cat', 'asia', 'fans', 'mom', 'luxe', 'cash', 'auto',
  'cars', 'pet', 'yoga', 'cafe', 'bar', 'rest', 'menu', 'house', 'home', 'estate', 'farm', 'garden',
  'rent', 'repair', 'health', 'fitness', 'careers', 'jobs', 'education', 'school', 'academy',
  'college', 'institute', 'training', 'lawyer', 'legal', 'tax', 'finance', 'money', 'bank',
  'capital', 'ventures', 'agency', 'company', 'digital', 'software', 'technology', 'expert',
  'services', 'support', 'help', 'guide', 'directory', 'domains',
  // 常见 ccTLD（注册域 = 两段；多段公共后缀已在上面列出）
  'cn', 'hk', 'mo', 'tw', 'jp', 'kr', 'sg', 'my', 'th', 'vn', 'ph', 'id', 'in', 'au', 'nz', 'us',
  'uk', 'de', 'fr', 'it', 'es', 'nl', 'be', 'se', 'no', 'fi', 'dk', 'pl', 'cz', 'pt', 'gr', 'ch',
  'at', 'ie', 'ru', 'ua', 'tr', 'io', 'tv', 'cc', 'me', 'sh', 'to', 'gg', 'fm', 'am', 'gs', 'im',
  'is', 'ai', 'co', 'mx', 'br', 'ar', 'cl', 'pe', 've', 'ec', 'uy', 'py', 'bo', 'za', 'eu', 'il',
  'sa', 'ae', 'eg', 'ng', 'ke', 'gh',
])

const familyCache = new Map<string, string | null>()

/**
 * 计算注册域（eTLD+1，轻量表）。
 * IP 直连 / 单标签 / 表外 TLD 一律返回 null（不启用同族改写）。
 */
export function registrableDomainOf(hostname: string): string | null {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '')
  if (!host || net.isIP(host)) return null
  const cached = familyCache.get(host)
  if (cached !== undefined) return cached
  let result: string | null = null
  const labels = host.split('.').filter(Boolean)
  if (labels.length >= 2) {
    const lastTwo = labels.slice(-2).join('.')
    if (MULTIPART_PUBLIC_SUFFIXES.has(lastTwo)) {
      result = labels.length >= 3 ? labels.slice(-3).join('.') : null
    } else if (FAMILY_TLDS.has(labels[labels.length - 1])) {
      result = lastTwo
    }
  }
  if (familyCache.size > 2000) familyCache.clear()
  familyCache.set(host, result)
  return result
}

/** 站点 origin 的注册域；无法解析时 null */
export function siteFamilyOf(origin: string): string | null {
  try {
    return registrableDomainOf(new URL(origin).hostname)
  } catch {
    return null
  }
}

const HOST_CHECK_TTL_MS = 5 * 60 * 1000

/** 强制桌面模式时使用的 UA（与 Chrome Windows 桌面版一致） */
export const DESKTOP_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface RewriteContext {
  siteId: number
  /** 站点源站（用户创建时录入），用于判断「同站」绝对 URL */
  siteOrigin: string
  /** 本次响应实际来源（跨域跳转时可能不同于 siteOrigin） */
  activeOrigin: string
  /** 该站点是否强制桌面模式（UA 与 navigator 伪装） */
  forceDesktop?: boolean
  /** 本次文档的实际地址（用于解析相对媒体地址，如 media/rabbit.mp4） */
  pageUrl?: string
  /** 站点档案（抖音 / B 站等多域名生态）；通用站点为 null */
  profile?: SiteProfile | null
  /** 有效兼容模式：legacy 注入 polyfill + 转译内联脚本 */
  compat?: 'modern' | 'legacy'
}

/** 主机在档案中的类别（无档案返回 null） */
function profileHostClass(host: string, ctx: RewriteContext): ProfileHostClass | null {
  if (!ctx.profile) return null
  return classifyProfileHost(ctx.profile, host)
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
  // 管理员黑名单优先：HTTP / 媒体 / WebSocket 三个入口都经过这里
  if (await isProxyHostBlacklisted(host)) {
    throw new AppError(`该网站（${host}）已被管理员加入反代黑名单`, 403)
  }
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

/** 站点 origin 的主机（与站点 origin 一致的地址走普通反代前缀） */
function siteHostOf(ctx: RewriteContext): string | null {
  try {
    return new URL(ctx.siteOrigin).host
  } catch {
    return null
  }
}

/** 本次文档实际来源主机；与站点 origin 同主机时返回 null（保持旧映射语义） */
function activeHostOf(ctx: RewriteContext): string | null {
  try {
    const host = new URL(ctx.activeOrigin).host
    return host === siteHostOf(ctx) ? null : host
  } catch {
    return null
  }
}

/** 主机是否与站点 origin 同注册域（站点族） */
function isFamilyHost(host: string, ctx: RewriteContext): boolean {
  const family = siteFamilyOf(ctx.siteOrigin)
  if (!family) return false
  return hostMatchesSuffix(String(host || '').toLowerCase(), family)
}

/**
 * 内嵌主机反代路径：`/proxy/<siteId>/<scheme>/<host><path><search><hash>`。
 * 兄弟子域（passport.bilibili.com 等）的页面与接口都落回这个形态，
 * 服务端解析后按内嵌主机作为上游。
 */
function embeddedProxyPath(url: URL, siteId: number): string {
  const scheme = url.protocol === 'http:' ? 'http' : 'https'
  return `/proxy/${siteId}/${scheme}/${url.host}${url.pathname || '/'}${url.search}${url.hash}`
}

/** 根相对 URL 所属主机：文档来自兄弟子域时根相对属于活动主机 */
function activeEmbeddedPrefix(ctx: RewriteContext): string | null {
  const activeHost = activeHostOf(ctx)
  if (!activeHost) return null
  let scheme = 'https'
  try {
    scheme = new URL(ctx.activeOrigin).protocol === 'http:' ? 'http' : 'https'
  } catch {
    /* ignore */
  }
  return `/proxy/${ctx.siteId}/${scheme}/${activeHost}`
}

/**
 * 绝对 / 协议相对 URL 的统一映射（档案优先）。
 * 顺序：档案媒体路径 → 站点主机 → 同族子域 → 档案主机类别 → 已知 CDN。
 * 都不命中返回 null（族外第三方保持直连）。通用站点（无档案）行为与旧版一致。
 */
function mapAbsoluteUrl(url: URL, ctx: RewriteContext): string | null {
  const prefix = `/proxy/${ctx.siteId}`
  if (ctx.profile && isProfileMediaPath(ctx.profile, url)) return buildMediaProxyPath(url, ctx.siteId)
  if (url.host === siteHostOf(ctx)) return `${prefix}${url.pathname}${url.search}${url.hash}`
  if (isFamilyHost(url.host, ctx)) return embeddedProxyPath(url, ctx.siteId)
  const cls = profileHostClass(url.host, ctx)
  if (cls === 'page') return embeddedProxyPath(url, ctx.siteId)
  if (cls === 'resource') return buildResProxyPath(url, ctx.siteId)
  if (cls === 'media') return buildMediaProxyPath(url, ctx.siteId)
  if (isResourceCdnHost(url.host)) return buildResProxyPath(url, ctx.siteId)
  return null
}

/**
 * 把 HTML/CSS 中的一个 URL 映射到反代路径。
 *
 * 改写四类：根路径、与站点 origin 同主机的绝对 URL、同注册域的兄弟子域（内嵌主机形态）、
 * 协议相对且同源的 URL。文档来自兄弟子域时，根相对 URL 与活动主机绝对 URL 也映射到
 * 内嵌主机形态（根相对属于活动主机，而不是站点 origin）。
 * 族外域名原样保留（脚本、字体、CDN 直连，避免代理一切流量）；
 * 站点档案（抖音 / B 站）会把其多域名生态按类别落回反代。
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
    // 文档来自兄弟子域（如登录页在 passport.bilibili.com）时，根相对地址属于活动主机
    const activePrefix = activeEmbeddedPrefix(ctx)
    return activePrefix ? `${activePrefix}${trimmed}` : `${prefix}${trimmed}`
  }
  if (trimmed.startsWith('//')) {
    try {
      // 懒加载属性（data-src / data-original 等）里的已知 CDN / 档案资源同样走同源代理，
      // 否则脚本把原地址写回 src 后，浏览器仍会带 LineWeb 的 Referer 直连 CDN
      const mapped = mapAbsoluteUrl(new URL(`https:${trimmed}`), ctx)
      if (mapped !== null) return mapped
    } catch {
      /* ignore */
    }
    return raw
  }
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const mapped = mapAbsoluteUrl(new URL(trimmed), ctx)
      if (mapped !== null) return mapped
    } catch {
      /* ignore */
    }
  }
  return raw
}

/**
 * 媒体 URL 重写（只用于 <video>/<audio>/<source> 这类媒体标签）。
 *
 * 同站与跨站资源都改走同源媒体代理：该分支有独立超时（只等响应头）、
 * 保留 Content-Length / Range，长视频不会被普通反代的整体超时掐断；
 * 跨站资源还顺带绕开 CDN 热链校验（Referer 变成 LineWeb）与跨域限制。
 */
export function mapMediaUrl(value: string, ctx: RewriteContext): string {
  if (typeof value !== 'string') return value
  const raw = value
  const trimmed = value.trim()
  if (!trimmed) return raw
  if (isMediaProxyPath(trimmed, ctx.siteId)) return raw
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
  try {
    if (trimmed.startsWith('//')) return buildMediaProxyPath(new URL(`https:${trimmed}`), ctx.siteId)
    if (trimmed.startsWith('/')) {
      const url = new URL(trimmed, ctx.activeOrigin)
      return url.protocol === 'http:' || url.protocol === 'https:' ? buildMediaProxyPath(url, ctx.siteId) : raw
    }
    if (/^https?:\/\//i.test(trimmed)) return buildMediaProxyPath(new URL(trimmed), ctx.siteId)
    // 纯相对路径：只有知道页面地址、且看起来是媒体文件时才改写
    if (!ctx.pageUrl) return raw
    const resolved = new URL(trimmed, ctx.pageUrl)
    if (!MEDIA_FILE_RE.test(resolved.pathname)) return raw
    return buildMediaProxyPath(resolved, ctx.siteId)
  } catch {
    return raw
  }
}

/**
 * 静态资源 URL 重写（用于 <link>/<script>/<img> 与 CSS 里的 url()）。
 *
 * 与 mapUrlToProxy 的区别：**族外跨站资源也改写到同源资源代理**
 * （CDN 上的 CSS / JS / 字体 / 图片常常校验 Referer 或限制 CORS，浏览器直连会失败）。
 * 站点主机与族内兄弟子域仍走普通反代 / 内嵌主机形态（带 Cookie、可改写）。
 */
export function mapResourceUrl(value: string, ctx: RewriteContext): string {
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
  if (isResProxyPath(trimmed, ctx.siteId) || isMediaProxyPath(trimmed, ctx.siteId)) return raw
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return mapUrlToProxy(trimmed, ctx)
  let url: URL
  try {
    if (trimmed.startsWith('//')) url = new URL(`https:${trimmed}`)
    else if (/^https?:\/\//i.test(trimmed)) url = new URL(trimmed)
    else {
      // 纯相对路径：必须知道页面地址才能解析；解析后同源仍保持相对（浏览器自己会带上前缀）
      if (!ctx.pageUrl) return mapUrlToProxy(trimmed, ctx)
      url = new URL(trimmed, ctx.pageUrl)
    }
  } catch {
    return raw
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return raw
  if (url.host === siteHostOf(ctx)) return mapUrlToProxy(trimmed, ctx)
  // 族内兄弟子域（含文档所在的活动主机）：走内嵌主机反代（与页面同一条链路）
  if (isFamilyHost(url.host, ctx)) return embeddedProxyPath(url, ctx.siteId)
  // 档案主机：视频 CDN 走媒体代理，接口域走内嵌主机，其余（静态）走资源代理
  const cls = profileHostClass(url.host, ctx)
  if (cls === 'media') return buildMediaProxyPath(url, ctx.siteId)
  if (cls === 'page') return embeddedProxyPath(url, ctx.siteId)
  // 族外静态资源：交给同源资源代理
  return buildResProxyPath(url, ctx.siteId)
}

/** WebSocket URL → 反代 WS 路径（页面脚本里的 WebSocket 构造函数会调用同名逻辑） */
export function mapWsUrlToProxy(value: string, ctx: RewriteContext, pageHost: string, secure: boolean): string {
  const scheme = secure ? 'wss://' : 'ws://'
  const prefix = `/proxy-ws/${ctx.siteId}`
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed) return value
  if (trimmed.startsWith(prefix)) return value
  if (trimmed.startsWith('/')) {
    // 文档来自兄弟子域时，根相对 WS 地址属于活动主机 → 内嵌主机形态
    const activeHost = activeHostOf(ctx)
    if (activeHost) {
      let activeScheme = 'https'
      try {
        activeScheme = new URL(ctx.activeOrigin).protocol === 'http:' ? 'http' : 'https'
      } catch {
        /* ignore */
      }
      return `${scheme}${pageHost}${prefix}/${activeScheme}/${activeHost}${trimmed}`
    }
    return `${scheme}${pageHost}${prefix}${trimmed}`
  }
  if (/^wss?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      if (isProxyableHost(url.host, ctx)) {
        return `${scheme}${pageHost}${prefix}${url.pathname}${url.search}${url.hash}`
      }
      // 族内兄弟子域的 WS（如 broadcast-msg.bilibili.com）也走中继
      if (isFamilyHost(url.host, ctx)) {
        const marker = url.protocol === 'ws:' ? 'http' : 'https'
        return `${scheme}${pageHost}${prefix}/${marker}/${url.host}${url.pathname}${url.search}${url.hash}`
      }
      // 档案 page 主机（如抖音 frontier.snssdk.com / webcast.amemv.com）的 WS 也走中继
      if (profileHostClass(url.host, ctx) === 'page') {
        const marker = url.protocol === 'ws:' ? 'http' : 'https'
        return `${scheme}${pageHost}${prefix}/${marker}/${url.host}${url.pathname}${url.search}${url.hash}`
      }
    } catch {
      /* ignore */
    }
  }
  return value
}

/**
 * 把反代 URL 还原成上游 URL（用于 Referer / Origin 透传）。
 * 两种形态都能还原：普通前缀 → 活动/站点 origin；内嵌主机形态 → 内嵌 origin。
 */
export function proxyUrlToUpstream(referer: string | undefined, ctx: RewriteContext): string | undefined {
  if (!referer) return referer
  try {
    const url = new URL(referer, ctx.siteOrigin)
    const prefix = `/proxy/${ctx.siteId}`
    if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
      const rest = url.pathname.slice(prefix.length) || '/'
      // 内嵌主机形态：/https/<host>/<path>
      const embedded = /^\/(https?)\/([^/?#]+)(\/.*)?$/i.exec(rest)
      if (embedded) {
        return `${embedded[1].toLowerCase()}://${embedded[2].toLowerCase()}${embedded[3] || '/'}${url.search}`
      }
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
const MEDIA_TAG_RE = /<(video|audio|source)\b[^>]*>/gi
const MEDIA_ATTR_RE = /(\s(?:src|data-src|data-lazy-src|data-original)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
/** 相对媒体地址的扩展名判断（只用于把相对路径也纳入媒体代理） */
const MEDIA_FILE_RE = /\.(m3u8|mpd|ts|m4s|mp4|m4v|webm|flv|mp3|m4a|aac|ogg|oga|opus|vtt|srt)$/i

function rewriteSrcset(value: string, ctx: RewriteContext, mapper: (url: string, ctx: RewriteContext) => string = mapUrlToProxy): string {
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
      return `${mapper(url, ctx)}${descriptor}`
    })
    .filter(Boolean)
    .join(', ')
}

/** 重写 CSS 文本里的 url(...) 与 @import（跨站字体/图片同样交给资源代理） */
export function rewriteCss(css: string, ctx: RewriteContext): string {
  let out = css
  out = out.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote: string, url: string) => {
    const mapped = mapResourceUrl(url, ctx)
    return mapped === url ? match : `url(${quote}${mapped}${quote})`
  })
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (match, quote: string, url: string) => {
    const mapped = mapResourceUrl(url, ctx)
    return mapped === url ? match : `@import ${quote}${mapped}${quote}`
  })
  return out
}

function rewriteAttributes(html: string, ctx: RewriteContext): string {
  // 媒体标签先扫：同站/跨站媒体都改写成媒体代理路径，之后通用重写会把这些地址视为已反代
  let out = rewriteMediaTags(html, ctx)
  // 外链样式 / 脚本 / 图片：跨站地址改写到同源资源代理（解决 CDN 防盗链导致的「只有文字」）
  out = rewriteResourceTags(out, ctx)
  out = out.replace(ATTR_RE, (match, head: string, dq?: string, sq?: string, bare?: string) => {
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

/** 媒体标签单独扫一遍：<video>/<audio>/<source> 的 src 交给媒体代理 */
function rewriteMediaTags(html: string, ctx: RewriteContext): string {
  return html.replace(MEDIA_TAG_RE, (tag) => tag.replace(
    MEDIA_ATTR_RE,
    (match, head: string, dq?: string, sq?: string, bare?: string) => {
      const value = dq ?? sq ?? bare ?? ''
      const mapped = mapMediaUrl(value, ctx)
      if (mapped === value) return match
      return `${head}"${mapped}"`
    },
  ))
}

const RESOURCE_TAG_RE = /<(link|script|img)\b[^>]*>/gi
const RESOURCE_ATTR_RE = /(\s(?:href|src)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi
const IMG_SRCSET_RE = /(\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/i
/** <link rel> 里属于「可代理资源」的类型；canonical / alternate 等保持原样 */
const RESOURCE_LINK_RELS = /(stylesheet|icon|shortcut|preload|prefetch|modulepreload|manifest|apple-touch-icon|mask-icon)/

/**
 * 外链样式 / 脚本 / 图片单独扫一遍：跨站地址改写到同源资源代理。
 *
 * 这一步解决的是「CDN 防盗链 / CORS 导致整站只剩文字」：
 * 服务端带着上游 Referer 去取，浏览器只看到 LineWeb 同源地址。
 */
function rewriteResourceTags(html: string, ctx: RewriteContext): string {
  return html.replace(RESOURCE_TAG_RE, (tag) => {
    const isLink = /^<link\b/i.test(tag)
    if (isLink) {
      const relMatch = /\srel\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
      const rel = (relMatch?.[1] ?? relMatch?.[2] ?? relMatch?.[3] ?? '').toLowerCase()
      if (rel && !RESOURCE_LINK_RELS.test(rel)) return tag
    }
    let out = tag.replace(RESOURCE_ATTR_RE, (match, head: string, dq?: string, sq?: string, bare?: string) => {
      const value = dq ?? sq ?? bare ?? ''
      const mapped = mapResourceUrl(value, ctx)
      if (mapped === value) return match
      return `${head}"${mapped}"`
    })
    if (/^<img\b/i.test(tag)) {
      out = out.replace(IMG_SRCSET_RE, (match, head: string, dq: string, dqValue?: string, sqValue?: string) => {
        const value = dqValue ?? sqValue ?? ''
        const mapped = rewriteSrcset(value, ctx, mapResourceUrl)
        return mapped === value ? match : `${head}"${mapped}"`
      })
    }
    return out
  })
}

/**
 * <base> 标签改写。
 *
 * 原来直接删掉 <base>：依赖 base 定位相对资源的站点会整站失联。
 * 现在改为「同源 → 反代前缀」「跨站 CDN → 资源代理」；
 * 无法映射（相对 base / 非 http）时才移除。
 */
function rewriteBaseTag(tag: string, ctx: RewriteContext): string {
  const match = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
  const href = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').trim()
  if (!href) return ''
  let url: URL
  try {
    url = new URL(href, ctx.activeOrigin)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  if (url.host === siteHostOf(ctx)) {
    const mapped = mapUrlToProxy(href, ctx)
    return mapped === href ? '' : `<base href="${mapped}">`
  }
  // 族内兄弟子域 base：指向内嵌主机前缀，保证相对资源落在同一链路上
  if (isFamilyHost(url.host, ctx)) {
    return `<base href="${embeddedProxyPath(url, ctx.siteId)}">`
  }
  // 族外 base（常见于把静态资源放在 CDN 的站点）：指向资源代理目录
  return `<base href="${buildResProxyPath(url, ctx.siteId)}">`
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
  out = out.replace(BASE_TAG_RE, (tag) => rewriteBaseTag(tag, ctx))
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

  // 内联状态脚本（__playinfo__ / __INITIAL_STATE__）与抖音 RENDER_DATA 里的上游绝对地址
  const mapUrl = (value: string) => mapUrlToProxy(value, ctx)
  out = rewriteInlineScripts(out, mapUrl)
  out = rewriteRenderData(out, mapUrl)
  // legacy：内联脚本转译成 ES5（老引擎跑不动站点自身的 ES2017+ 代码）
  if (ctx.compat === 'legacy') {
    out = transpileInlineScripts(out, transpileToEs5)
  }

  const script = `<script data-lineweb-proxy="${ctx.siteId}">${buildBootstrapScript({
    siteId: ctx.siteId,
    origin: ctx.siteOrigin,
    // 文档实际来自的主机（兄弟子域登录页等）：引导脚本按它解释根相对地址
    pageOrigin: ctx.activeOrigin || ctx.siteOrigin,
    family: siteFamilyOf(ctx.siteOrigin) || '',
    cookies: options.cookies,
    forceDesktop: !!ctx.forceDesktop,
    desktopUserAgent: DESKTOP_USER_AGENT,
    cdnHosts: RESOURCE_CDN_SUFFIXES,
    hostRules: ctx.profile
      ? { page: ctx.profile.pageHosts, res: ctx.profile.resourceHosts, media: ctx.profile.mediaHosts }
      : undefined,
    mediaPatterns: ctx.profile ? ctx.profile.mediaPathPatterns.map((re) => re.source) : undefined,
    compat: ctx.compat === 'legacy' ? 'legacy' : 'modern',
    profileId: ctx.profile?.id || '',
  })}</script>`
  // legacy：polyfill 必须先于引导脚本与站点脚本加载
  const polyfill = ctx.compat === 'legacy'
    ? `<script src="${polyfillPath(ctx.siteId)}" data-lw-polyfill="1"></script>`
    : ''
  const inject = `${polyfill}${script}`
  const headMatch = /<head\b[^>]*>/i.exec(out)
  if (headMatch) {
    const at = (headMatch.index ?? 0) + headMatch[0].length
    out = `${out.slice(0, at)}${inject}${out.slice(at)}`
  } else {
    const htmlMatch = /<html\b[^>]*>/i.exec(out)
    if (htmlMatch) {
      const at = (htmlMatch.index ?? 0) + htmlMatch[0].length
      out = `${out.slice(0, at)}${inject}${out.slice(at)}`
    } else {
      out = `${inject}${out}`
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
