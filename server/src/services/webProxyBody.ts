/**
 * 网页反代 — 响应体 URL 改写（纯函数）
 *
 * HTML/CSS 的属性重写之外，站点还把大量上游绝对地址藏在：
 *   - API 的 JSON 响应（B 站 playurl 的 baseUrl/backupUrl、抖音信息流的 play_addr）；
 *   - JSONP 回调包裹的 JSON；
 *   - 内联状态脚本（B 站 window.__playinfo__ / __INITIAL_STATE__）；
 *   - 抖音 RENDER_DATA（URL-encoded JSON，站点 JS 用 decodeURIComponent 读取）。
 *
 * 这些地址若不改写，播放器 / 风控脚本会带着 LineWeb 的 Referer 直连上游 CDN → 403 / CORS。
 * 这里只改「响应体」，不触碰请求参数与签名（WBI / a_bogus 仍在请求侧原样生效）。
 *
 * 所有函数都接受一个 `mapUrl` 映射器（由路由用 mapUrlToProxy + ctx 绑定），
 * 不依赖 webProxyService，避免循环引用；未知主机 / 伪协议 / 相对地址原样保留。
 */

/** 字符串值改写：整串是 URL 就整体映射；否则替换其中出现的绝对 URL */
function mapStringValue(value: string, mapUrl: (v: string) => string): string {
  const trimmed = value.trim()
  if (!trimmed) return value
  const lower = trimmed.toLowerCase()
  if (
    lower.startsWith('data:') || lower.startsWith('blob:') || lower.startsWith('javascript:')
    || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('#')
  ) {
    return value
  }
  // 整串就是一个 URL（绝对 / 协议相对 / 根相对）
  if (/^(https?:)?\/\//i.test(trimmed) || (trimmed.charAt(0) === '/' && trimmed.charAt(1) !== '/')) {
    const mapped = mapUrl(trimmed)
    return mapped === trimmed ? value : mapped
  }
  // 混合文本：仅替换其中的绝对 http(s) URL（mapUrl 对未知主机返回原值）
  if (!/https?:\/\//i.test(value)) return value
  return value.replace(/https?:\/\/[^\s"'<>\\]+/gi, (url) => {
    const mapped = mapUrl(url)
    return mapped === url ? url : mapped
  })
}

/** 递归改写 JSON 中所有字符串值（键不动）；解析失败原样返回 */
export function rewriteJsonBody(text: string, mapUrl: (v: string) => string): string {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return text
  }
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return mapStringValue(node, mapUrl)
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(node as Record<string, unknown>)) {
        out[key] = walk((node as Record<string, unknown>)[key])
      }
      return out
    }
    return node
  }
  try {
    return JSON.stringify(walk(data))
  } catch {
    return text
  }
}

/** JSONP：callback({...}) 包裹识别 → 内部按 JSON 改写 → 重包；非 JSONP 原样返回 */
export function rewriteJsonpBody(text: string, mapUrl: (v: string) => string): string {
  const trimmed = text.trim()
  const match = /^([\w$.]+\s*\()\s*([\s\S]*?)\s*\)\s*;?\s*$/.exec(trimmed)
  if (!match) return text
  const inner = match[2]
  const rewritten = rewriteJsonBody(inner, mapUrl)
  if (rewritten === inner) return text
  return `${match[1]}${rewritten})`
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
const ABS_URL_RE = /https?:\/\/[^\s"'<>\\)]+/gi

/**
 * 内联脚本 URL 改写：
 *   - 跳过外链（有 src）、引导脚本自身、polyfill、RENDER_DATA（单独处理）；
 *   - application/json 类型按 JSON 改写；
 *   - 其余（含 window.__playinfo__ = {...}）替换其中已知主机的绝对 URL。
 */
export function rewriteInlineScripts(html: string, mapUrl: (v: string) => string): string {
  return html.replace(SCRIPT_RE, (match, attrs: string, body: string) => {
    if (/\bsrc\s*=/i.test(attrs)) return match
    if (/data-lineweb-proxy/i.test(attrs) || /data-lw-polyfill/i.test(attrs)) return match
    if (/\bid\s*=\s*["']?RENDER_DATA["']?/i.test(attrs)) return match
    if (!body.trim()) return match
    const typeMatch = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)
    const type = (typeMatch?.[1] || '').toLowerCase()
    if (type === 'application/json' || type === 'application/ld+json') {
      const rewritten = rewriteJsonBody(body, mapUrl)
      return rewritten === body ? match : `<script${attrs}>${rewritten}</script>`
    }
    const rewritten = body.replace(ABS_URL_RE, (url) => {
      const mapped = mapUrl(url)
      return mapped === url ? url : mapped
    })
    return rewritten === body ? match : `<script${attrs}>${rewritten}</script>`
  })
}

/**
 * legacy 模式：把内联脚本转译成 ES5（transpile 回调由路由注入 Babel）。
 * 跳过外链、引导脚本、polyfill、JSON 类型与 RENDER_DATA（数据不是可执行代码）。
 */
export function transpileInlineScripts(html: string, transpile: (code: string) => string): string {
  return html.replace(SCRIPT_RE, (match, attrs: string, body: string) => {
    if (/\bsrc\s*=/i.test(attrs)) return match
    if (/data-lineweb-proxy/i.test(attrs) || /data-lw-polyfill/i.test(attrs)) return match
    if (/\bid\s*=\s*["']?RENDER_DATA["']?/i.test(attrs)) return match
    if (!body.trim()) return match
    const typeMatch = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)
    const type = (typeMatch?.[1] || '').toLowerCase()
    if (type === 'application/json' || type === 'application/ld+json' || type === 'application/importmap+json') return match
    const out = transpile(body)
    return out === body ? match : `<script${attrs}>${out}</script>`
  })
}

/**
 * 抖音 RENDER_DATA：URL-encoded JSON。
 * decodeURIComponent → JSON 改写 → encodeURIComponent 回填（站点按 decodeURIComponent 消费，往返安全）。
 */
export function rewriteRenderData(html: string, mapUrl: (v: string) => string): string {
  return html.replace(
    /(<script\b[^>]*\bid\s*=\s*["']?RENDER_DATA["']?[^>]*>)([\s\S]*?)(<\/script>)/gi,
    (match, open: string, body: string, close: string) => {
      let decoded: string
      try {
        decoded = decodeURIComponent(body.trim())
      } catch {
        return match
      }
      const rewritten = rewriteJsonBody(decoded, mapUrl)
      if (rewritten === decoded) return match
      let encoded: string
      try {
        encoded = encodeURIComponent(rewritten)
      } catch {
        return match
      }
      return `${open}${encoded}${close}`
    },
  )
}
