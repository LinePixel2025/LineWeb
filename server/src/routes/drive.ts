import { Router, Request, Response } from 'express'
import busboy from 'busboy'
import prisma from '../lib/prisma.js'
import { parseId, parsePagination } from '../lib/utils.js'
import { authenticate } from '../middleware/auth.js'
import { sendCommand, streamRead, streamReadBinary, streamWriteBinary, isNodeConnected } from '../services/storageTunnel.js'
import { syncDriveFiles } from '../services/storageSync.js'
import { config } from '../config/index.js'

const router = Router()

// P23: In-memory cache for resolve-path to avoid repeated N+1 queries per segment
class PathCache {
  private cache = new Map<string, { value: number; expiresAt: number }>()
  private maxSize = 500
  private ttlMs = 5 * 60 * 1000

  get(key: string): number | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() >= entry.expiresAt) { this.cache.delete(key); return undefined }
    return entry.value
  }

  set(key: string, value: number): void {
    if (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest) this.cache.delete(oldest)
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }
}

const pathCache = new PathCache()

/**
 * 修复 busboy 对中文文件名的 mojibake 损坏。
 * busboy v1.6.0 在解析 Content-Disposition 时，可能将 UTF-8 字节
 * 逐字节当作 Latin-1 字符解码，导致中文变成如 "ä¸åäº" 的乱码。
 * 此函数将每个 Latin-1 字符转回其原始字节值，再重新用 UTF-8 解码。
 */
function fixMojibake(name: string): string {
  // 仅对包含高字节（>0x7F）的字符串尝试修复
  if (!/[^\0-\x7f]/.test(name)) return name
  try {
    const bytes = new Uint8Array(name.length)
    for (let i = 0; i < name.length; i++) {
      bytes[i] = name.charCodeAt(i) & 0xff
    }
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return name // 解码失败则返回原值
  }
}

function parseRange(header: string, totalSize: number): { start: number; end?: number } | null {
  const match = header.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return null
  const start = parseInt(match[1], 10)
  if (start >= totalSize) return null
  if (match[2] !== '') {
    const end = parseInt(match[2], 10)
    if (end >= totalSize) return { start, end: totalSize - 1 }
    return { start, end }
  }
  return { start }
}

// === BigInt 序列化 — 显式转换 size 为字符串，避免全局原型污染 ===
type WithSize<T extends { size: bigint }> = Omit<T, 'size'> & { size: string }

function transformSize<T extends { size: bigint }>(file: T): WithSize<T> {
  return { ...file, size: file.size.toString() }
}

function transformSizeList<T extends { size: bigint }>(files: T[]): WithSize<T>[] {
  return files.map(transformSize)
}

// === canAccessDrive 内存缓存（60s TTL，避免每请求查 DB） ===
const driveAccessCache = new Map<number, { value: boolean; expireAt: number }>()
const DRIVE_ACCESS_TTL_MS = 60 * 1000

// 定期清理过期缓存条目
const driveAccessCleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of driveAccessCache.entries()) {
    if (now >= entry.expireAt) driveAccessCache.delete(key)
  }
}, 60_000)
driveAccessCleanupInterval.unref()

/** 清除指定用户的 canAccessDrive 缓存（权限变更时调用） */
export function clearDriveAccessCache(userId: number): void {
  driveAccessCache.delete(userId)
}

async function checkDriveAccess(userId: number): Promise<boolean> {
  const cached = driveAccessCache.get(userId)
  if (cached && Date.now() < cached.expireAt) {
    return cached.value
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canAccessDrive: true },
  })
  const value = !!user?.canAccessDrive
  driveAccessCache.set(userId, { value, expireAt: Date.now() + DRIVE_ACCESS_TTL_MS })
  return value
}

// === 文件所有权校验 — 防止用户越权操作他人文件 ===
/**
 * 校验当前用户是否拥有指定文件的操作权限。
 * 管理员豁免；普通用户仅能操作自己上传的文件。
 * 返回文件记录（含 storagePath / isFolder 等），或 null 表示无权访问/不存在。
 */
async function assertFileOwnership(
  fileId: number,
  user: { userId: number; role: string },
): Promise<{
  id: number
  name: string
  isFolder: boolean
  parentId: number | null
  storagePath: string
  size: bigint
  mimeType: string | null
  uploadedById: number | null
} | null> {
  const file = await prisma.driveFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      name: true,
      isFolder: true,
      parentId: true,
      storagePath: true,
      size: true,
      mimeType: true,
      uploadedById: true,
    },
  })
  if (!file) return null
  // 管理员豁免
  if (user.role === 'admin') return file
  // 普通用户必须为上传者
  if (file.uploadedById !== user.userId) return null
  return file
}

// 所有路由需要登录 + canAccessDrive
router.use(authenticate, async (req: Request, res: Response, next) => {
  try {
    const hasAccess = await checkDriveAccess(req.user!.userId)
    if (!hasAccess) {
      res.status(403).json({ error: '无网盘访问权限' })
      return
    }
    next()
  } catch {
    res.status(500).json({ error: '权限校验失败' })
  }
})

/* ---------- 获取文件列表（支持分页） ---------- */
router.get('/files', async (req: Request, res: Response) => {
  try {
    const parentIdStr = req.query.parentId as string | undefined
    const parentId = parentIdStr ? parseId(parentIdStr) : null
    const { page, limit, skip } = parsePagination(req.query)

    // 所有权过滤：管理员看全部，普通用户仅看自己上传的文件
    const isAdmin = req.user!.role === 'admin'
    const where: { parentId: number | null; uploadedById?: number } = { parentId }
    if (!isAdmin) {
      where.uploadedById = req.user!.userId
    }

    const [data, total] = await Promise.all([
      prisma.driveFile.findMany({
        where,
        select: {
          id: true,
          name: true,
          isFolder: true,
          parentId: true,
          size: true,
          mimeType: true,
          createdAt: true,
          updatedAt: true,
          uploadedBy: { select: { id: true, username: true } },
        },
        orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      prisma.driveFile.count({ where }),
    ])

    res.json({ data: transformSizeList(data), total, page, pageCount: Math.ceil(total / limit) })
  } catch (err) {
    console.error('获取文件列表失败:', err)
    res.status(500).json({ error: '获取文件列表失败' })
  }
})

/* ---------- 获取单个文件/文件夹信息 ---------- */
router.get('/files/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    // 所有权校验：非上传者/非管理员返回 404（不暴露文件存在性）
    const file = await assertFileOwnership(id, req.user!)
    if (!file) {
      res.status(404).json({ error: '文件不存在或无权访问' })
      return
    }

    res.json(transformSize(file))
  } catch (err) {
    console.error('获取文件信息失败:', err)
    res.status(500).json({ error: '获取文件信息失败' })
  }
})

/* ---------- 搜索文件 ---------- */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim()
    if (!q) {
      res.json([])
      return
    }

    // 所有权过滤：管理员搜全部，普通用户仅搜自己的文件
    const isAdmin = req.user!.role === 'admin'
    const where: { name: { contains: string }; uploadedById?: number } = {
      name: { contains: q },
    }
    if (!isAdmin) {
      where.uploadedById = req.user!.userId
    }

    const files = await prisma.driveFile.findMany({
      where,
      select: {
        id: true,
        name: true,
        isFolder: true,
        parentId: true,
        size: true,
        mimeType: true,
        createdAt: true,
        updatedAt: true,
        uploadedBy: { select: { id: true, username: true } },
      },
      orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
      // SQLite LIKE '%query%' cannot use index; limited to 50 results
      take: 50,
    })

    res.json(transformSizeList(files))
  } catch (err) {
    console.error('搜索文件失败:', err)
    res.status(500).json({ error: '搜索失败' })
  }
})

/**
 * 创建文件夹共用逻辑
 * 提取自 /folders 和 /files 路由，避免代码重复
 */
async function handleCreateFolder(
  name: string | undefined,
  parentIdRaw: unknown,
  userId: number,
  res: Response,
): Promise<void> {
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: '文件夹名称不能为空' })
    return
  }
  if (name.length > 255) {
    res.status(400).json({ error: '文件夹名称过长' })
    return
  }
  // 禁止特殊字符
  if (/[<>:"/\\|?*]/.test(name)) {
    res.status(400).json({ error: '文件夹名称包含非法字符' })
    return
  }

  // 解析 parentId
  let resolvedParentId: number | null = null
  if (parentIdRaw != null) {
    const pid = typeof parentIdRaw === 'number' ? parentIdRaw : parseId(String(parentIdRaw))
    if (pid === null) {
      res.status(400).json({ error: '无效的父文件夹 ID' })
      return
    }
    resolvedParentId = pid
  }

  // 如果指定了 parentId，验证父文件夹存在
  let storagePath = name.trim()
  if (resolvedParentId) {
    const parent = await prisma.driveFile.findUnique({ where: { id: resolvedParentId } })
    if (!parent || !parent.isFolder) {
      res.status(404).json({ error: '父文件夹不存在' })
      return
    }
    storagePath = `${parent.storagePath}/${name.trim()}`
  }

  // 同级同名检查
  const existing = await prisma.driveFile.findFirst({
    where: { name: name.trim(), parentId: resolvedParentId },
  })
  if (existing) {
    res.status(409).json({ error: '同级已存在同名文件或文件夹' })
    return
  }

  // 通知存储节点创建目录
  if (isNodeConnected()) {
    try {
      await sendCommand({ type: 'mkdir', path: storagePath })
    } catch (wsErr) {
      console.error('存储节点创建目录失败:', wsErr)
      // 即使节点未响应也继续（目录仅DB记录不强制节点存在）
    }
  }

  const folder = await prisma.driveFile.create({
    data: {
      name: name.trim(),
      isFolder: true,
      parentId: resolvedParentId,
      storagePath,
      size: 0n,
      uploadedById: userId,
    },
    select: {
      id: true,
      name: true,
      isFolder: true,
      parentId: true,
      size: true,
      mimeType: true,
      createdAt: true,
      updatedAt: true,
      uploadedBy: { select: { id: true, username: true } },
    },
  })

  res.status(201).json(transformSize(folder))
}

/* ---------- 创建文件夹 ---------- */
router.post('/folders', async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body
    await handleCreateFolder(name, parentId, req.user!.userId, res)
  } catch (err) {
    console.error('创建文件夹失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '创建文件夹失败' })
    }
  }
})

/* ---------- 创建文件夹（HarmonyOS 兼容：POST /drive/files） ---------- */
router.post('/files', async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body as { name?: string; parentId?: unknown }
    await handleCreateFolder(name, parentId, req.user!.userId, res)
  } catch (err) {
    console.error('创建文件夹失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '创建文件夹失败' })
    }
  }
})

/* ---------- 上传文件 (busboy 流式解析) ---------- */
router.post('/upload', async (req: Request, res: Response) => {
  try {
    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接，请稍后再试' })
      return
    }

    const bb = busboy({ headers: req.headers, limits: { fileSize: config.maxFileSizeMB * 1024 * 1024 } })
    let fileProcessed = false
    let fileError: Error | null = null
    let originalName = ''
    let mimeType = ''
    // 优先从 URL 查询参数读取（可靠），回退到 multipart field（兼容旧客户端）
    let parentId: number | null = (req.query.parentId as string | undefined)
      ? parseInt(req.query.parentId as string, 10) || null
      : null

    bb.on('field', (name, val) => {
      if (name === 'parentId' && parentId === null) {
        parentId = val ? parseInt(val, 10) || null : null
      }
    })

    bb.on('file', async (_fieldname, stream, info) => {
      if (fileProcessed) return
      fileProcessed = true
      originalName = fixMojibake(info.filename)
      mimeType = info.mimeType

      try {
        // 解析父文件夹路径
        let parentPath = ''
        if (parentId) {
          const parent = await prisma.driveFile.findUnique({ where: { id: parentId } })
          if (!parent || !parent.isFolder) {
            throw new Error('父文件夹不存在')
          }
          parentPath = parent.storagePath + '/'
        }

        // 生成存储路径 — 使用原始文件名，冲突时自动追加计数器后缀
        const safeName = originalName.replace(/[<>:"/\\|?*]/g, '_')
        let storagePath = `${parentPath}${safeName}`
        let finalName = originalName  // 显示名保留原始文件名
        // 同级同名检查 + 自动去重
        const existing = await prisma.driveFile.findFirst({
          where: { storagePath },
          select: { id: true },
        })
        if (existing) {
          const dotIdx = safeName.lastIndexOf('.')
          const base = dotIdx > 0 ? safeName.slice(0, dotIdx) : safeName
          const ext = dotIdx > 0 ? safeName.slice(dotIdx) : ''
          const origDotIdx = originalName.lastIndexOf('.')
          const origBase = origDotIdx > 0 ? originalName.slice(0, origDotIdx) : originalName
          const origExt = origDotIdx > 0 ? originalName.slice(origDotIdx) : ''
          // 生成 99 个候选路径，单次 IN 查询利用 @unique 索引
          const candidates: string[] = []
          for (let i = 1; i <= 99; i++) {
            candidates.push(`${parentPath}${base}(${i})${ext}`)
          }
          const existingDups = await prisma.driveFile.findMany({
            where: { storagePath: { in: candidates } },
            select: { storagePath: true },
          })
          const taken = new Set(existingDups.map(d => d.storagePath))
          for (let i = 1; i <= 99; i++) {
            const candidate = `${parentPath}${base}(${i})${ext}`
            if (!taken.has(candidate)) {
              storagePath = candidate
              finalName = `${origBase}(${i})${origExt}`
              break
            }
          }

        // === 先创建 DB 记录，再流式写入存储节点 ===
        }
        const file = await prisma.driveFile.create({
          data: {
            name: finalName,
            isFolder: false,
            parentId: parentId || null,
            size: 0n,
            mimeType,
            storagePath,
            uploadedById: req.user!.userId,
          },
          select: {
            id: true, name: true, size: true, mimeType: true, createdAt: true,
          },
        })

        let writeSucceeded = false
        try {
          const { bytesWritten } = await streamWriteBinary(storagePath, stream)
          writeSucceeded = true

          await prisma.driveFile.update({
            where: { id: file.id },
            data: { size: BigInt(bytesWritten) },
          })

          res.status(201).json(transformSize(file))
        } catch (writeErr) {
          await prisma.driveFile.delete({ where: { id: file.id } }).catch(() => {})
          if (writeSucceeded) {
            try {
              if (isNodeConnected()) {
                await sendCommand({ type: 'delete_file', path: storagePath })
              }
            } catch { /* ignore */ }
          }
          throw writeErr
        }
      } catch (err: unknown) {
        fileError = err instanceof Error ? err : new Error(String(err))
        // 耗尽流防止内存泄漏
        stream.resume()
      }
    })

    bb.on('limit', () => {
      if (!fileError) {
        fileError = new Error(`文件大小超过限制 (${config.maxFileSizeMB}MB)`)
      }
    })

    bb.on('close', () => {
      if (fileError) {
        if (!res.headersSent) {
          const isSizeLimit = fileError.message.includes('限制')
          res.status(isSizeLimit ? 413 : 502).json({ error: fileError.message })
        }
      } else if (!fileProcessed) {
        res.status(400).json({ error: '请选择文件' })
      }
    })

    req.pipe(bb)
  } catch (err) {
    console.error('上传文件失败:', err)
    res.status(500).json({ error: '上传文件失败' })
  }
})

/**
 * 下载文件共用逻辑
 * 提取自 /files/:id/download 和 /download/:id 路由，避免代码重复
 */
async function handleDownload(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await assertFileOwnership(id, req.user!)
    if (!file || file.isFolder) {
      res.status(404).json({ error: '文件不存在或无权访问' })
      return
    }

    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接' })
      return
    }

    const mimeType = file.mimeType || 'application/octet-stream'
    const encodedName = encodeURIComponent(file.name)
    const contentLength = Number(file.size)

    const rangeHeader = req.headers.range

    if (rangeHeader) {
      const parsed = parseRange(rangeHeader, contentLength)
      if (!parsed) {
        res.status(416).setHeader('Content-Range', `bytes */${contentLength}`).end()
        return
      }

      const { start, end } = parsed
      const len = end !== undefined ? end - start + 1 : contentLength - start

      res.status(206)
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
      res.setHeader('Content-Range', `bytes ${start}-${end ?? contentLength - 1}/${contentLength}`)
      res.setHeader('Content-Length', len)
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Content-Length', String(contentLength))
      res.setHeader('Accept-Ranges', 'bytes')

      try {
        for await (const chunk of streamReadBinary(file.storagePath, start, len)) {
          res.write(chunk)
        }
        res.end()
      } catch (streamErr: unknown) {
        console.error('下载流中断:', streamErr)
        if (!res.writableEnded) res.end()
      }
      return
    }

    // 全量下载
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Length', String(contentLength))
    res.setHeader('Accept-Ranges', 'bytes')

    try {
      for await (const chunk of streamReadBinary(file.storagePath)) {
        res.write(chunk)
      }
      res.end()
    } catch (streamErr: unknown) {
      console.error('下载流中断:', streamErr)
      if (!res.writableEnded) res.end()
    }
  } catch (err) {
    console.error('下载文件失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '下载文件失败' })
    }
  }
}

/* ---------- 下载文件（流式分块推送，HarmonyOS 兼容路径） ---------- */
router.get('/files/:id/download', handleDownload)

/* ---------- 下载文件（流式分块推送） ---------- */
router.get('/download/:id', handleDownload)

/* ---------- 重命名/移动文件 ---------- */
router.put('/files/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await assertFileOwnership(id, req.user!)
    if (!file) {
      res.status(404).json({ error: '文件不存在或无权访问' })
      return
    }

    const { name, parentId } = req.body as { name?: string; parentId?: number | null }

    // 收集所有 DB 变更，通过事务原子执行
    const updates: any[] = []

    // 重命名
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: '名称不能为空' })
        return
      }
      if (name.length > 255 || /[<>:"/\\|?*]/.test(name)) {
        res.status(400).json({ error: '名称包含非法字符或过长' })
        return
      }

      // 通知存储节点重命名
      if (isNodeConnected()) {
        try {
          await sendCommand({
            type: 'rename',
            path: file.storagePath,
            newName: name.trim(),
          })
        } catch (wsErr) {
          console.error('存储节点重命名失败:', wsErr)
          // 继续更新 DB
        }
      }

      // 计算新 storagePath
      const parentParts = file.storagePath.split('/')
      parentParts[parentParts.length - 1] = name.trim()
      const newStoragePath = parentParts.join('/')

      // 收集父记录更新
      updates.push(
        prisma.driveFile.update({
          where: { id },
          data: {
            name: name.trim(),
            storagePath: newStoragePath,
          },
        })
      )

      // 如果是文件夹，收集子文件 storagePath 更新
      if (file.isFolder) {
        const oldPrefix = file.storagePath + '/'
        const newPrefix = newStoragePath + '/'
        updates.push(
          prisma.$executeRawUnsafe(
            `UPDATE drive_files SET storagePath = REPLACE(storagePath, ?, ?) WHERE storagePath LIKE ?`,
            oldPrefix, newPrefix, `${oldPrefix}%`
          )
        )
      }
    }

    // 移动（更改父文件夹）
    if (parentId !== undefined) {
      const newParentId = parentId

      if (newParentId === file.parentId) {
        res.json({ message: '无需移动' })
        return
      }

      if (newParentId !== null) {
        const newParent = await prisma.driveFile.findUnique({ where: { id: newParentId } })
        if (!newParent || !newParent.isFolder) {
          res.status(404).json({ error: '目标文件夹不存在' })
          return
        }

        // 不能移动到自身或子文件夹下
        if (file.isFolder) {
          if (newParent.id === id || newParent.storagePath.startsWith(file.storagePath + '/')) {
            res.status(400).json({ error: '不能移动到自身或子文件夹中' })
            return
          }
        }

        const newStoragePath = `${newParent.storagePath}/${file.name}`

        // 通知存储节点移动
        if (isNodeConnected()) {
          try {
            await sendCommand({
              type: 'move',
              path: file.storagePath,
              newPath: newStoragePath,
            })
          } catch (wsErr) {
            console.error('存储节点移动失败:', wsErr)
          }
        }

        // 收集父记录更新
        updates.push(
          prisma.driveFile.update({
            where: { id },
            data: {
              parentId: newParentId,
              storagePath: newStoragePath,
            },
          })
        )

        // 如果是文件夹，收集子文件 storagePath 更新
        if (file.isFolder) {
          const oldPrefix = file.storagePath + '/'
          const newPrefix = newStoragePath + '/'
          updates.push(
            prisma.$executeRawUnsafe(
              `UPDATE drive_files SET storagePath = REPLACE(storagePath, ?, ?) WHERE storagePath LIKE ?`,
              oldPrefix, newPrefix, `${oldPrefix}%`
            )
          )
        }
      } else {
        // 移动到根目录
        const newStoragePath = file.name

        if (isNodeConnected()) {
          try {
            await sendCommand({
              type: 'move',
              path: file.storagePath,
              newPath: newStoragePath,
            })
          } catch (wsErr) {
            console.error('存储节点移动失败:', wsErr)
          }
        }

        // 收集父记录更新
        updates.push(
          prisma.driveFile.update({
            where: { id },
            data: {
              parentId: null,
              storagePath: newStoragePath,
            },
          })
        )

        // 如果是文件夹，收集子文件 storagePath 更新
        if (file.isFolder) {
          const oldPrefix = file.storagePath + '/'
          const newPrefix = newStoragePath + '/'
          updates.push(
            prisma.$executeRawUnsafe(
              `UPDATE drive_files SET storagePath = REPLACE(storagePath, ?, ?) WHERE storagePath LIKE ?`,
              oldPrefix, newPrefix, `${oldPrefix}%`
            )
          )
        }
      }
    }

    // 原子执行所有 DB 变更
    if (updates.length > 0) {
      await prisma.$transaction(updates)
    }
    const updated = await prisma.driveFile.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isFolder: true,
        parentId: true,
        size: true,
        mimeType: true,
        storagePath: true,
        updatedAt: true,
      },
    })

    res.json(updated ? transformSize(updated) : null)
  } catch (err) {
    console.error('更新文件失败:', err)
    res.status(500).json({ error: '更新文件失败' })
  }
})

/* ---------- 删除文件（先删 DB 再删节点，防止同步复活） ---------- */
async function deleteFileRecursive(id: number): Promise<void> {
  const file = await prisma.driveFile.findUnique({ where: { id } })
  if (!file) return

  // P33: Single query collects all descendant storagePaths via unique index prefix scan
  // (replaces recursive N+1 parentId walk)
  const descendants = await prisma.driveFile.findMany({
    where: { storagePath: { startsWith: file.storagePath + '/' } },
    select: { storagePath: true },
  })
  const pathsToDelete = [file.storagePath, ...descendants.map(d => d.storagePath)]

  // 先删除 DB 记录（级联 CASCADE 会自动处理子记录）
  await prisma.driveFile.delete({ where: { id } })

  // 再通知存储节点删除实际文件（删除失败不影响 DB 一致性）
  if (isNodeConnected()) {
    for (const sp of pathsToDelete) {
      try {
        await sendCommand({ type: 'delete_file', path: sp })
      } catch (wsErr) {
        console.error(`存储节点删除 ${sp} 失败:`, wsErr)
      }
    }
  }
}

router.delete('/files/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await assertFileOwnership(id, req.user!)
    if (!file) {
      res.status(404).json({ error: '文件不存在或无权访问' })
      return
    }

    await deleteFileRecursive(id)
    res.json({ message: '已删除' })
  } catch (err) {
    console.error('删除文件失败:', err)
    res.status(500).json({ error: '删除文件失败' })
  }
})

/* ---------- 解析路径字符串为面包屑 ---------- */
router.get('/resolve-path', async (req: Request, res: Response) => {
  try {
    const pathStr = (req.query.path as string || '').trim()
    if (!pathStr) {
      res.json([{ id: null, name: '根目录' }])
      return
    }

    const segments = pathStr.split('/').filter(s => s.length > 0)
    const breadcrumbs: { id: number | null; name: string }[] = [{ id: null, name: '根目录' }]

    let currentParentId: number | null = null
    for (const segment of segments) {
      // P23: Check cache before querying DB for each path segment
      const cacheKey = `${currentParentId ?? 'root'}:${segment}`
      const cachedId = pathCache.get(cacheKey)
      let folder: { id: number; name: string } | null = null

      if (cachedId !== undefined) {
        folder = await prisma.driveFile.findUnique({
          where: { id: cachedId },
          select: { id: true, name: true },
        })
      }

      if (!folder) {
        folder = await prisma.driveFile.findFirst({
          where: {
            name: segment,
            isFolder: true,
            parentId: currentParentId,
          },
          select: { id: true, name: true },
        })
        if (folder) {
          pathCache.set(cacheKey, folder.id)
        }
      }

      if (!folder) {
        res.status(404).json({ error: `文件夹 "${segment}" 不存在` })
        return
      }
      breadcrumbs.push({ id: folder.id, name: folder.name })
      currentParentId = folder.id
    }

    res.json(breadcrumbs)
  } catch (err) {
    console.error('解析路径失败:', err)
    res.status(500).json({ error: '解析路径失败' })
  }
})

/* ---------- 手动触发文件同步 ---------- */
router.post('/sync', async (req: Request, res: Response) => {
  try {
    const report = await syncDriveFiles(req.user!.userId)
    res.json(report)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '同步失败'
    console.error('手动同步失败:', err)
    res.status(500).json({ error: `同步失败: ${message}` })
  }
})

export default router
