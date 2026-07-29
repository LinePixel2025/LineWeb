import { Router, Request, Response } from 'express'
import busboy from 'busboy'
import { authenticate } from '../middleware/auth.js'
import { uploadAvatar, getAvatarPathByUserId, getAvatarStream, deleteAvatar } from '../services/avatarService.js'
import { getErrorMessage, getErrorStatus } from '../lib/utils.js'

const router = Router()

// 上传和删除需要认证
router.post('/', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId

  let fileBuffer: Buffer | null = null
  let fileMimeType = ''

  try {
    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers: req.headers })
      bb.on('file', (_fieldname, stream, info) => {
        fileMimeType = info.mimeType
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => { fileBuffer = Buffer.concat(chunks) })
        stream.on('error', (err: Error) => reject(err))
      })
      bb.on('finish', () => {
        if (!fileBuffer) {
          reject(new Error('请提供头像文件'))
          return
        }
        resolve()
      })
      bb.on('error', (err: Error) => reject(err))
      req.pipe(bb)
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    res.status(400).json({ error: msg || '文件解析失败' })
    return
  }

  if (!fileBuffer) {
    res.status(400).json({ error: '请提供头像文件' })
    return
  }

  try {
    const avatarPath = await uploadAvatar(userId, fileBuffer, fileMimeType)
    res.json({ avatarPath })
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
    return
  }
})

router.get('/', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId
  try {
    const avatarPath = await getAvatarPathByUserId(userId)
    if (!avatarPath) {
      res.status(204).end()
      return
    }
    const stream = await getAvatarStream(avatarPath)
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    for await (const chunk of stream) {
      res.write(chunk)
    }
    res.end()
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
    return
  }
})

router.get('/:userId', async (req: Request, res: Response) => {
  const targetId = parseInt(req.params.userId, 10)
  if (isNaN(targetId) || targetId < 1) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }
  try {
    const avatarPath = await getAvatarPathByUserId(targetId)
    if (!avatarPath) {
      res.status(204).end()
      return
    }
    const stream = await getAvatarStream(avatarPath)
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    for await (const chunk of stream) {
      res.write(chunk)
    }
    res.end()
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
    return
  }
})

router.delete('/', authenticate, async (req: Request, res: Response) => {
  const userId = req.user!.userId
  try {
    await deleteAvatar(userId)
    res.json({ message: '头像已删除' })
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
    return
  }
})

export default router
