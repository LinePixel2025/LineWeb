/**
 * 网页反代 — 同源静态资源代理
 *
 * 反代只改写同源地址；大量站点把 CSS / JS / 字体 / 图片挂在独立 CDN 上
 * （`https://cdn.xxx.com/app.css`），一旦该 CDN 校验 Referer 或 CORS，
 * 浏览器直连就会被挡，页面就退化成「只有文字」。这里把这些**静态资源**也改写到
 * LineWeb 同源路径，由服务端带着正确的 Referer 去取：
 *
 *   https://cdn.example.com/a/b.css?v=1
 *   → /proxy/7/__lw_res__/https/cdn.example.com/a/b.css?v=1
 *
 * 与媒体代理的区别：
 *   - 媒体代理只放行音视频（HTML/CSS/JS 一律 415，防止变成同源 XSS）
 *   - 资源代理放行 CSS / JS / JSON / 图片 / 字体，但**明确拒绝 HTML 与 SVG**
 *     （这两类在同源下会被当作页面/脚本执行，是明确的 XSS 入口）
 *
 * 路径与查询串原样保留，CSS 里的相对 url() 解析结果仍落在同一目录，无需额外改写。
 */

/** 静态资源代理路径中固定的一段（HTML 重写 / 引导脚本 / 路由三处共用） */
export const RES_SEGMENT = '__lw_res__'

export function resPathPrefix(siteId: number): string {
  return `/proxy/${siteId}/${RES_SEGMENT}/`
}

/** 上游 URL → 同源静态资源代理路径 */
export function buildResProxyPath(url: URL, siteId: number): string {
  const scheme = url.protocol === 'http:' ? 'http' : 'https'
  const pathname = url.pathname && url.pathname !== '' ? url.pathname : '/'
  return `${resPathPrefix(siteId)}${scheme}/${url.host}${pathname}${url.search}`
}

export function isResProxyPath(value: string, siteId: number): boolean {
  return typeof value === 'string' && value.startsWith(resPathPrefix(siteId))
}

/** 反代路径 → 上游资源 URL；格式非法返回 null */
export function parseResTarget(siteId: number, pathname: string, search = ''): URL | null {
  if (typeof pathname !== 'string') return null
  const fullPrefix = resPathPrefix(siteId)
  const relativePrefix = `/${RES_SEGMENT}/`
  let restPath = pathname
  if (restPath.startsWith(fullPrefix)) restPath = `${relativePrefix}${restPath.slice(fullPrefix.length)}`
  if (!restPath.startsWith(relativePrefix)) return null
  const match = /^(https?)\/([^/]+)(\/.*)?$/.exec(restPath.slice(relativePrefix.length))
  if (!match) return null
  const host = match[2]
  if (!host || host.includes('@') || host.startsWith('.') || host === 'localhost') return null
  const path = match[3] && match[3].startsWith('/') ? match[3] : '/'
  let url: URL
  try {
    url = new URL(`${match[1]}://${host}${path}${search}`)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  return url
}

export type ResContentKind = 'css' | 'text' | 'binary' | 'blocked'

/**
 * 资源代理的类型白名单。
 *
 * 拒绝：HTML / XHTML / SVG / XML（同源下可执行脚本）。
 * 其余（CSS / JS / JSON / 图片 / 字体 / 音视频）按二进制或文本回传。
 */
export function classifyResContentType(raw: string | null | undefined): ResContentKind {
  const type = String(raw || '').split(';')[0].trim().toLowerCase()
  if (!type) return 'binary'
  if (type === 'text/css') return 'css'
  if (type === 'text/html' || type === 'application/xhtml+xml') return 'blocked'
  if (type === 'image/svg+xml' || type === 'application/svg+xml') return 'blocked'
  if (type === 'application/xml' || type === 'text/xml' || type === 'application/xhtml') return 'blocked'
  if (
    type === 'application/javascript'
    || type === 'text/javascript'
    || type === 'application/x-javascript'
    || type === 'application/ecmascript'
    || type === 'text/ecmascript'
  ) {
    return 'text'
  }
  if (type === 'application/json' || type === 'text/json') return 'text'
  if (type.startsWith('text/')) return 'text'
  if (type.startsWith('image/') || type.startsWith('font/') || type.startsWith('audio/') || type.startsWith('video/')) {
    return 'binary'
  }
  if (
    type === 'application/font-woff'
    || type === 'application/font-woff2'
    || type === 'application/x-font-woff'
    || type === 'application/x-font-ttf'
    || type === 'application/x-font-opentype'
    || type === 'application/vnd.ms-fontobject'
    || type === 'application/font-sfnt'
  ) {
    return 'binary'
  }
  // CDN 常把字体/图片标成 octet-stream
  if (type === 'application/octet-stream') return 'binary'
  return 'blocked'
}

/** 根据扩展名推断上游可能返回的资源类型（用于「没有 content-type」的兜底） */
export function guessResourceKindFromPath(pathname: string): ResContentKind {
  const path = String(pathname || '').toLowerCase().split('?')[0]
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'text'
  if (path.endsWith('.json') || path.endsWith('.map')) return 'text'
  if (/\.(png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot)$/.test(path)) return 'binary'
  return 'blocked'
}
