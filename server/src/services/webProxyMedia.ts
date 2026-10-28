/**
 * 网页反代 — 同源媒体代理（视频 / 音频 / HLS）
 *
 * 视频站点的媒体文件通常挂在跨域 CDN 上，且带热链校验 / CORS 限制。
 * 直接由浏览器去拉会暴露 LineWeb 的 Referer，也可能因 CORS 失败。
 * 这里把跨域媒体地址改写成 LineWeb 同源路径：
 *
 *   https://cdn.example.com/hls/index.m3u8?token=x
 *   → /proxy/7/__lw_media__/https/cdn.example.com/hls/index.m3u8?token=x
 *
 * 关键点：**路径与查询串原样保留**，只把 scheme/host 塞进前缀。
 * 这样播放列表里的相对 URI（segment.ts、../key.bin）解析后仍落在媒体代理下，
 * 无需改动；只有根路径 / 绝对地址 / 协议相对地址需要改写。
 *
 * 该模块只做纯函数（解析路径、判定类型、改写播放列表），网络请求在 routes/webProxy.ts。
 */

/** 媒体代理路径中固定的一段，HTML 重写 / 引导脚本 / 路由三处共用 */
export const MEDIA_SEGMENT = '__lw_media__'

export function mediaPathPrefix(siteId: number): string {
  return `/proxy/${siteId}/${MEDIA_SEGMENT}/`
}

/** 上游 URL → 同源媒体代理路径（保留 pathname 与 query，便于相对 URI 解析） */
export function buildMediaProxyPath(url: URL, siteId: number): string {
  const scheme = url.protocol === 'http:' ? 'http' : 'https'
  const pathname = url.pathname && url.pathname !== '' ? url.pathname : '/'
  return `${mediaPathPrefix(siteId)}${scheme}/${url.host}${pathname}${url.search}`
}

export function isMediaProxyPath(value: string, siteId: number): boolean {
  return typeof value === 'string' && value.startsWith(mediaPathPrefix(siteId))
}

/** 反代路径 → 上游媒体 URL；格式非法返回 null */
export function parseMediaTarget(siteId: number, pathname: string, search = ''): URL | null {
  if (typeof pathname !== 'string') return null
  const fullPrefix = mediaPathPrefix(siteId)
  const relativePrefix = `/${MEDIA_SEGMENT}/`
  // 允许两种形态：完整反代路径（/proxy/7/__lw_media__/...）与已剥掉站点前缀的路径（/__lw_media__/...）
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

export type MediaContentKind = 'stream' | 'playlist' | 'manifest' | 'text' | 'blocked'

/**
 * 媒体代理只放行「不会被当作同源页面执行」的类型。
 * HTML / XHTML / XML / CSS / JS / SVG 一律拒绝，避免把反代变成同源 XSS 入口。
 */
export function classifyMediaContentType(raw: string | null | undefined): MediaContentKind {
  const type = String(raw || '').split(';')[0].trim().toLowerCase()
  if (!type || type === 'application/octet-stream') return 'stream'
  if (type.startsWith('video/') || type.startsWith('audio/')) return 'stream'
  if (type === 'application/mp4' || type === 'application/f4v' || type === 'application/x-flv') return 'stream'
  if (
    type === 'application/vnd.apple.mpegurl'
    || type === 'application/x-mpegurl'
    || type === 'application/mpegurl'
    || type === 'audio/mpegurl'
    || type === 'audio/x-mpegurl'
  ) {
    return 'playlist'
  }
  // DASH / Smooth Streaming 清单：结构复杂，原样透传（资源地址改写交给页面脚本）
  if (type === 'application/dash+xml' || type === 'application/vnd.ms-sstr+xml') return 'manifest'
  // WebVTT / SRT 字幕与部分 CDN 的纯文本清单
  if (type === 'text/plain' || type === 'text/vtt' || type === 'application/x-subrip') return 'text'
  return 'blocked'
}

/** 嗅探前几个字节，判断是否是 HLS 播放列表（可能与 Content-Type 不一致） */
export function looksLikePlaylist(head: Buffer): boolean {
  if (!head || head.length === 0) return false
  // 用 utf8 解码才能正确去掉 BOM（EF BB BF → \uFEFF）
  const text = head.subarray(0, 64).toString('utf8').replace(/^\uFEFF/, '').replace(/^\s+/, '')
  return text.startsWith('#EXTM3U')
}

function mapPlaylistUri(value: string, baseUrl: URL, siteId: number): string {
  const raw = value.trim()
  if (!raw) return value
  const lower = raw.toLowerCase()
  if (lower.startsWith('data:') || lower.startsWith('blob:')) return value
  if (isMediaProxyPath(raw, siteId)) return value
  // 相对 URI 原样保留：媒体路径已带上游目录，解析结果天然正确
  if (!raw.startsWith('/') && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) return value
  let abs: URL
  try {
    abs = new URL(raw, baseUrl)
  } catch {
    return value
  }
  if (abs.protocol !== 'http:' && abs.protocol !== 'https:') return value
  return buildMediaProxyPath(abs, siteId)
}

/**
 * 改写 HLS 播放列表：
 *  - 普通行就是分片地址，根路径 / 绝对地址改写到媒体代理
 *  - `#EXT-X-KEY` / `#EXT-X-MAP` / `#EXT-X-MEDIA` 等标签里的 URI="..." 同样处理
 *  - 相对地址保持原样（解析基准就是本播放列表的媒体路径）
 */
export function rewritePlaylist(text: string, baseUrl: URL, siteId: number): string {
  const lines = String(text || '').split(/\r?\n/)
  return lines
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) {
        return line.replace(
          /(URI\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^,\s]+))/gi,
          (match, head: string, dq?: string, sq?: string, bare?: string) => {
            const value = dq ?? sq ?? bare ?? ''
            const mapped = mapPlaylistUri(value, baseUrl, siteId)
            return mapped === value ? match : `${head}"${mapped}"`
          },
        )
      }
      return mapPlaylistUri(trimmed, baseUrl, siteId)
    })
    .join('\n')
}

/** 媒体请求的 Referer：页面地址还原成上游地址；媒体路径本身则退回站点根 */
export function mediaReferer(referer: string | undefined, siteOrigin: string, siteId: number): string {
  const prefix = `/proxy/${siteId}`
  if (referer) {
    try {
      const url = new URL(referer)
      if (url.pathname === prefix || url.pathname.startsWith(`${prefix}/`)) {
        const rest = url.pathname.slice(prefix.length) || '/'
        if (!rest.startsWith(`/${MEDIA_SEGMENT}/`)) return `${siteOrigin}${rest}${url.search}`
      }
    } catch {
      /* ignore */
    }
  }
  return `${siteOrigin}/`
}
