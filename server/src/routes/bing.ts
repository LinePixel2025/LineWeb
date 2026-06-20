import { Router, Request, Response } from 'express'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    // picsum.photos 每次请求返回随机高清壁纸
    const seed = Date.now()
    res.json({
      url: `https://picsum.photos/seed/wallpaper${seed}/1920/1080`,
      copyright: 'picsum.photos',
    })
  } catch {
    res.status(500).json({ error: '获取壁纸失败' })
  }
})

export default router
