import { Router, Request, Response } from 'express'

const router = Router()

const UAPIS_BASE = 'https://uapis.cn/api/v1/image/bing-daily'

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

    // --- 历史列表模式 ---
    if (fetchHistory) {
      const historyRes = await fetch(`${UAPIS_BASE}/history?resolution=4k&page_size=30`)
      if (!historyRes.ok) {
        res.status(502).json({ error: '上游壁纸服务暂时不可用' })
        return
      }
      const data = await historyRes.json()
      // data.items: Array<{ date, title, copyright, image_url, image_url_4k, image_url_1080, … }>
      res.json(data)
      return
    }

    // --- 单张壁纸模式 ---
    let apiUrl = `${UAPIS_BASE}?format=json&resolution=4k`

    if (mode === 'random') {
      apiUrl += '&random=true'
    } else if (mode === 'date' && date) {
      apiUrl += `&date=${date}`
    }

    const apiRes = await fetch(apiUrl)

    if (!apiRes.ok) {
      // 降级：用 picsum 随机图
      const seed = Date.now()
      res.json({
        url: `https://picsum.photos/seed/wallpaper${seed}/1920/1080`,
        copyright: 'picsum.photos',
        mode,
      })
      return
    }

    const data = await apiRes.json()

    res.json({
      url: data.image_url_4k || data.image_url,
      copyright: data.copyright || 'Bing',
      title: data.title || '',
      headline: data.headline || '',
      date: data.date || '',
      mode,
    })
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
