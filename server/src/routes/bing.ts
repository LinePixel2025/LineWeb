import { Router, Request, Response } from 'express'

const router = Router()

interface BingImage {
  url: string
  copyright: string
  title?: string
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const resp = await fetch(
      'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&mkt=zh-CN',
      { signal: AbortSignal.timeout(5000) },
    )
    const data = await resp.json() as { images: BingImage[] }
    if (!data.images?.[0]) {
      res.status(500).json({ error: '无法获取壁纸信息' })
      return
    }
    const img = data.images[0]
    res.json({
      url: `https://www.bing.com${img.url}`,
      copyright: img.copyright,
    })
  } catch {
    res.status(500).json({ error: '获取壁纸失败' })
  }
})

export default router
