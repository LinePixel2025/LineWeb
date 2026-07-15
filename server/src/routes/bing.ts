import { Router, Request, Response } from 'express'

const router = Router()

const UAPIS_BASE = 'https://uapis.cn/api/v1/image/bing-daily'

// === SSRF 防护：允许代理的域名白名单 ===
const ALLOWED_HOSTS = new Set([
  'uapis.cn',
  's.cn.bing.net',
  'cn.bing.com',
  'bing.com',
  'www.bing.com',
  'picsum.photos',
  'fastly.picsum.photos',
])

function isAllowedHost(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    // 仅允许 https（防内网 http 探测）
    if (url.protocol !== 'https:') return false
    // 精确匹配或子域名匹配
    const host = url.hostname.toLowerCase()
    if (ALLOWED_HOSTS.has(host)) return true
    for (const allowed of ALLOWED_HOSTS) {
      if (host.endsWith('.' + allowed)) return true
    }
    return false
  } catch {
    return false
  }
}

// === 简单内存缓存（带 TTL） ===
interface CacheEntry<T> {
  data: T
  expireAt: number
}

const metadataCache = new Map<string, CacheEntry<unknown>>()
const METADATA_TTL_MS = 60 * 60 * 1000  // 1 小时

function getCached<T>(key: string): T | null {
  const entry = metadataCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expireAt) {
    metadataCache.delete(key)
    return null
  }
  return entry.data as T
}

function setCached<T>(key: string, data: T, ttlMs: number = METADATA_TTL_MS): void {
  metadataCache.set(key, { data, expireAt: Date.now() + ttlMs })
}

// 定期清理过期缓存（每 10 分钟）
const cacheCleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of metadataCache.entries()) {
    if (now > entry.expireAt) metadataCache.delete(key)
  }
}, 10 * 60 * 1000)
cacheCleanupInterval.unref()

/**
 * GET /api/bing-wallpaper/proxy
 *
 * 代理壁纸图片文件，解决前端 Canvas getImageData CORS 限制。
 * 安全限制：仅允许白名单域名（Bing / uapis.cn / picsum.photos），必须 https。
 */
router.get('/proxy', async (req: Request, res: Response) => {
  const imageUrl = req.query.url as string
  if (!imageUrl) {
    res.status(400).json({ error: 'Missing url query param' })
    return
  }

  // SSRF 防护 — 拒绝非白名单 URL
  if (!isAllowedHost(imageUrl)) {
    res.status(400).json({ error: '该 URL 域名不在允许列表中' })
    return
  }

  try {
    const response = await fetch(imageUrl)
    if (!response.ok) {
      res.status(502).json({ error: '上游图片服务暂时不可用' })
      return
    }

    // 透传 Content-Type 和缓存头
    const contentType = response.headers.get('content-type') || 'image/jpeg'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'public, max-age=86400')

    // 流式 pipe — 避免大图全量进内存
    if (response.body) {
      const reader = response.body.getReader()
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read()
        if (done) {
          res.end()
          return
        }
        if (!res.writableEnded) {
          res.write(value)
          return pump()
        }
      }
      await pump()
    } else {
      // 兜底：body 不可流式时回退到 buffer
      const buffer = await response.arrayBuffer()
      res.send(Buffer.from(buffer))
    }
  } catch {
    if (!res.headersSent) {
      res.status(502).json({ error: '图片代理请求失败' })
    } else {
      res.end()
    }
  }
})

/**
 * GET /api/bing-wallpaper
 *
 * Query params (all optional):
 *   mode    — "latest" (default) | "random" | "date"
 *   date    — YYYY-MM-DD (used when mode=date)
 *   history — "true" — fetch recent wallpaper list instead of a single image
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const mode = (req.query.mode as string) || 'latest'
    const date = req.query.date as string | undefined
    const fetchHistory = req.query.history === 'true'

    // 简单校验 date 格式（防 URL 注入）
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'date 参数格式应为 YYYY-MM-DD' })
      return
    }

    // 缓存 key
    const cacheKey = fetchHistory
      ? `history`
      : `single:${mode}:${date || ''}`

    // 历史列表模式
    if (fetchHistory) {
      const cached = getCached<unknown>(cacheKey)
      if (cached) {
        res.json(cached)
        return
      }

      const historyRes = await fetch(`${UAPIS_BASE}/history?resolution=1080p&page_size=30`)
      if (!historyRes.ok) {
        res.status(502).json({ error: '上游壁纸服务暂时不可用' })
        return
      }
      const data = await historyRes.json()
      setCached(cacheKey, data)
      res.json(data)
      return
    }

    // 单张壁纸模式 — 先查缓存
    const cached = getCached<{ url: string; copyright: string; title?: string; headline?: string; date?: string; mode: string }>(cacheKey)
    if (cached) {
      res.json(cached)
      return
    }

    let apiUrl = `${UAPIS_BASE}?format=json&resolution=1080p`

    if (mode === 'random') {
      apiUrl += '&random=true'
    } else if (mode === 'date' && date) {
      apiUrl += `&date=${encodeURIComponent(date)}`
    }

    const apiRes = await fetch(apiUrl)

    if (!apiRes.ok) {
      // 降级：用 picsum 随机图
      const seed = Date.now()
      const fallback = {
        url: `https://picsum.photos/seed/wallpaper${seed}/1920/1080`,
        copyright: 'picsum.photos',
        mode,
      }
      // 降级结果不缓存（seed 每次不同）
      res.json(fallback)
      return
    }

    const data = await apiRes.json()
    const result = {
      url: data.image_url_4k || data.image_url,
      copyright: data.copyright || 'Bing',
      title: data.title || '',
      headline: data.headline || '',
      date: data.date || '',
      mode,
    }

    // 缓存 1 小时（Bing 壁纸按天变化，1 小时内复用足够）
    setCached(cacheKey, result)

    res.json(result)
  } catch {
    // 兜底降级
    const seed = Date.now()
    res.json({
      url: `https://picsum.photos/seed/wallpaper${seed}/1920/1080`,
      copyright: 'picsum.photos',
    })
  }
})

export default router
