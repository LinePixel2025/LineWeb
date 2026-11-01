import { Router, type Request, type Response } from 'express'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import { z } from 'zod'
import { asyncHandler } from '../lib/asyncHandler.js'
import { AppError } from '../middleware/errorHandler.js'
import { authenticate } from '../middleware/auth.js'
import { receiveMultipartFile } from '../lib/multipartImage.js'
import { formatQuotaSize, getDriveQuota } from '../services/driveQuota.js'
import { isNodeConnected, streamRead } from '../services/storageTunnel.js'
import {
  BOOK_MAX_BYTES,
  deleteBook,
  getBookSource,
  listBooks,
  saveBookProgress,
  uploadBook,
} from '../services/readerService.js'

/**
 * 小说阅读器路由（挂载于 /api/reader，受 reader 功能开关控制）
 *
 * 全部端点要求账号登录令牌：
 *   - 本路由不在 index.ts 的 publicApiPaths 白名单，全局 authenticate 中间件已兜底，
 *     router 内再声明一次以保证独立于挂载方式
 *   - 不加入 appScopes 端点白名单，第三方应用令牌一律 403
 *
 * 配额：书籍文件计入网盘已用空间（driveQuota.getDriveUsage 的 Book 聚合），
 * 三段式强制 = 配额预检（413）→ busboy 按 min(50MiB, 剩余) 截断 → 写后复核并回滚。
 * 书籍与封面内容不可变，file/cover 直链覆盖为 private + immutable 缓存。
 */
const router = Router()
router.use(authenticate)

function limitFor(max: number, message: string) {
  return rateLimit({
    windowMs: 5 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => String(req.user?.userId ?? ipKeyGenerator(req.ip ?? '')),
    message: { error: message },
    skip: (req) => req.user?.role === 'admin',
  })
}

const uploadLimiter = limitFor(20, '上传太频繁，请稍后再试')
const actionLimiter = limitFor(120, '操作太频繁，请稍后再试')

function currentUserId(req: Request): number {
  const userId = req.user?.userId
  if (!userId) throw new AppError('未登录', 401)
  return userId
}

function parseInput<S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const parsed = schema.safeParse(data)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AppError(issue?.message ? `输入数据无效：${issue.message}` : '输入数据无效', 400)
  }
  return parsed.data as z.infer<S>
}

/** 解析正整数路径参数 */
function parseIdParam(raw: string | undefined, name: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) throw new AppError(`无效的${name}`, 400)
  return value
}

const progressSchema = z.object({
  // epub 为 foliate CFI；txt 为 {chapter,offset} JSON 字符串。CFI 可能很长，放宽到 4096
  location: z.string().max(4096).default(''),
  // 全书进度 0–1（列表页「继续阅读」展示）
  percent: z.number().min(0).max(1),
})

// GET /api/reader/books — 书架（含阅读进度，最近在读在前）
router.get('/books', asyncHandler(async (_req: Request, res: Response) => {
  res.json({ books: await listBooks(currentUserId(_req)) })
}))

// POST /api/reader/books — 上传书籍（multipart/form-data，字段名 file）
router.post('/books', uploadLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)

  if (!isNodeConnected()) {
    throw new AppError('存储节点未接入，暂时无法上传书籍', 503)
  }

  // === 配额预检：空间已满直接 413（drive:all 不受限） ===
  const quota = await getDriveQuota(req.user!)
  if (!quota.unlimited && quota.remaining !== null && quota.remaining <= 0n) {
    throw new AppError('网盘空间不足，无法上传书籍', 413)
  }

  // 单本允许的上限 = min(50 MiB, 剩余空间)；配额更小时以配额为准
  const hardLimitBytes = BOOK_MAX_BYTES
  const remainingBytes = quota.unlimited ? null : quota.remaining
  const quotaLimited = remainingBytes !== null && remainingBytes < BigInt(hardLimitBytes)
  const effectiveLimitBytes = quotaLimited && remainingBytes !== null
    ? Number(remainingBytes)
    : hardLimitBytes

  const file = await receiveMultipartFile(req, effectiveLimitBytes, { requiredMessage: '请选择要上传的书籍文件' })
  if (file.limitHit) {
    if (quotaLimited && remainingBytes !== null) {
      throw new AppError(`网盘空间不足（剩余 ${formatQuotaSize(remainingBytes)}）`, 413)
    }
    throw new AppError(`书籍大小超过限制（${formatQuotaSize(BigInt(hardLimitBytes))}）`, 413)
  }
  if (file.buffer.length === 0) {
    throw new AppError('文件内容为空', 400)
  }

  const book = await uploadBook({
    userId,
    buffer: file.buffer,
    fileName: file.fileName,
    quota,
  })

  res.status(201).json({
    book: {
      id: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      size: book.size,
      hasCover: Boolean(book.coverPath),
      createdAt: book.createdAt.toISOString(),
      updatedAt: book.updatedAt.toISOString(),
      progress: null,
    },
  })
}))

// PUT /api/reader/books/:id/progress — 保存阅读进度（阅读页防抖调用）
router.put('/books/:id/progress', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const bookId = parseIdParam(req.params.id, '书籍 ID')
  const { location, percent } = parseInput(progressSchema, req.body)
  await saveBookProgress(userId, bookId, location, percent)
  res.json({ ok: true })
}))

// DELETE /api/reader/books/:id — 删除书籍（行 + 进度级联 + 节点文件）
router.delete('/books/:id', actionLimiter, asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const bookId = parseIdParam(req.params.id, '书籍 ID')
  await deleteBook(userId, bookId)
  res.json({ ok: true })
}))

// GET /api/reader/books/:id/file — 书籍文件（仅属主；支持 ?token= 直链）
router.get('/books/:id/file', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const bookId = parseIdParam(req.params.id, '书籍 ID')
  const book = await getBookSource(userId, bookId)
  if (!book) throw new AppError('书籍不存在', 404)

  if (!isNodeConnected()) {
    throw new AppError('存储节点未接入，暂时无法读取书籍', 503)
  }

  // 覆盖全局认证中间件的 no-store —— 书籍内容不可变，可长期缓存
  res.setHeader('Content-Type', book.format === 'epub' ? 'application/epub+zip' : 'application/octet-stream')
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`${book.title}.${book.format}`)}`)
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.setHeader('Content-Length', book.size.toString())

  try {
    for await (const chunk of streamRead(book.storagePath)) {
      if (!res.write(chunk)) {
        await new Promise<void>(resolve => res.once('drain', resolve))
      }
    }
    res.end()
  } catch (err) {
    console.error('[Reader] 读取书籍文件失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '读取书籍失败' })
      return
    }
    if (!res.writableEnded) res.destroy(err instanceof Error ? err : undefined)
  }
}))

// GET /api/reader/books/:id/cover — 封面缩略图（仅属主；支持 ?token= 直链）
router.get('/books/:id/cover', asyncHandler(async (req: Request, res: Response) => {
  const userId = currentUserId(req)
  const bookId = parseIdParam(req.params.id, '书籍 ID')
  const book = await getBookSource(userId, bookId)
  if (!book || !book.coverPath) throw new AppError('封面不存在', 404)

  if (!isNodeConnected()) {
    throw new AppError('存储节点未接入，暂时无法读取封面', 503)
  }

  res.setHeader('Content-Type', 'image/webp')
  res.setHeader('Content-Disposition', 'inline')
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')

  try {
    for await (const chunk of streamRead(book.coverPath)) {
      if (!res.write(chunk)) {
        await new Promise<void>(resolve => res.once('drain', resolve))
      }
    }
    res.end()
  } catch (err) {
    console.error('[Reader] 读取封面失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '读取封面失败' })
      return
    }
    if (!res.writableEnded) res.destroy(err instanceof Error ? err : undefined)
  }
}))

export default router
