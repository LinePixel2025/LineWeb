import { Router, Request, Response } from 'express'
import prisma from '../lib/prisma.js'
import { authenticate } from '../middleware/auth.js'

const router = Router()
router.use(authenticate)

// 获取当前用户所有收藏
router.get('/', async (req: Request, res: Response) => {
  try {
    const favorites = await prisma.driveFavorite.findMany({
      where: { userId: req.user!.userId },
      orderBy: { order: 'asc' },
    })
    res.json(favorites)
  } catch (err) {
    console.error('获取收藏失败:', err)
    res.status(500).json({ error: '获取收藏失败' })
  }
})

// 添加收藏
router.post('/', async (req: Request, res: Response) => {
  try {
    const { folderId, folderName } = req.body as { folderId?: number; folderName?: string }
    if (!folderId || !folderName) {
      res.status(400).json({ error: '缺少必要参数' })
      return
    }
    const existing = await prisma.driveFavorite.findUnique({
      where: { userId_folderId: { userId: req.user!.userId, folderId } },
    })
    if (existing) {
      res.json(existing)
      return
    }
    const maxOrder = await prisma.driveFavorite.aggregate({
      where: { userId: req.user!.userId },
      _max: { order: true },
    })
    const favorite = await prisma.driveFavorite.create({
      data: {
        userId: req.user!.userId,
        folderId,
        folderName,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    })
    res.status(201).json(favorite)
  } catch (err) {
    console.error('添加收藏失败:', err)
    res.status(500).json({ error: '添加收藏失败' })
  }
})

// 移除收藏
router.delete('/:folderId', async (req: Request, res: Response) => {
  try {
    const folderId = parseInt(req.params.folderId, 10)
    if (isNaN(folderId)) {
      res.status(400).json({ error: '无效的 folderId' })
      return
    }
    await prisma.driveFavorite.deleteMany({
      where: { userId: req.user!.userId, folderId },
    })
    res.json({ message: '已移除收藏' })
  } catch (err) {
    console.error('移除收藏失败:', err)
    res.status(500).json({ error: '移除收藏失败' })
  }
})

// 重排序
router.put('/reorder', async (req: Request, res: Response) => {
  try {
    const { favorites } = req.body as { favorites?: { id: number; order: number }[] }
    if (!Array.isArray(favorites)) {
      res.status(400).json({ error: '无效的 favorites 参数' })
      return
    }
    await prisma.$transaction(
      favorites.map(f =>
        prisma.driveFavorite.update({
          where: { id: f.id, userId: req.user!.userId },
          data: { order: f.order },
        })
      )
    )
    res.json({ message: '排序已更新' })
  } catch (err) {
    console.error('排序失败:', err)
    res.status(500).json({ error: '排序失败' })
  }
})

export default router
