import { Router, Request, Response } from 'express'
import busboy from 'busboy'
import prisma from '../lib/prisma.js'
import { parseId, parsePagination } from '../lib/utils.js'
import { authenticate } from '../middleware/auth.js'
import { sendCommand, streamRead, streamWrite, isNodeConnected } from '../services/storageTunnel.js'
import { syncDriveFiles } from '../services/storageSync.js'
import { config } from '../config/index.js'

const router = Router()

// 所有路由需要登录 + canAccessDrive
router.use(authenticate, (req: Request, res: Response, next) => {
  // 从数据库检查 canAccessDrive（每请求校验，确保权限变更即时生效）
  prisma.user.findUnique({
    where: { id: req.user!.userId },
    select: { canAccessDrive: true },
  }).then(user => {
    if (!user?.canAccessDrive) {
      res.status(403).json({ error: '无网盘访问权限' })
      return
    }
    next()
  }).catch(() => {
    res.status(500).json({ error: '权限校验失败' })
  })
})

/* ---------- 获取文件列表（支持分页） ---------- */
router.get('/files', async (req: Request, res: Response) => {
  try {
    const parentIdStr = req.query.parentId as string | undefined
    const parentId = parentIdStr ? parseId(parentIdStr) : null
    const { page, limit, skip } = parsePagination(req.query)

    const where: { parentId: number | null } = { parentId }

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

    res.json({ data, total, page, pageCount: Math.ceil(total / limit) })
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

    const file = await prisma.driveFile.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isFolder: true,
        parentId: true,
        size: true,
        mimeType: true,
        storagePath: true,
        createdAt: true,
        updatedAt: true,
        uploadedBy: { select: { id: true, username: true } },
      },
    })

    if (!file) {
      res.status(404).json({ error: '文件不存在' })
      return
    }

    res.json(file)
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

    const files = await prisma.driveFile.findMany({
      where: {
        name: { contains: q },
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
      orderBy: [{ isFolder: 'desc' }, { name: 'asc' }],
      take: 50,
    })

    res.json(files)
  } catch (err) {
    console.error('搜索文件失败:', err)
    res.status(500).json({ error: '搜索失败' })
  }
})

/* ---------- 创建文件夹 ---------- */
router.post('/folders', async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body
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

    // 如果指定了 parentId，验证父文件夹存在
    let storagePath = name.trim()
    if (parentId) {
      const pid = parseId(parentId)
      if (pid === null) {
        res.status(400).json({ error: '无效的父文件夹 ID' })
        return
      }
      const parent = await prisma.driveFile.findUnique({ where: { id: pid } })
      if (!parent || !parent.isFolder) {
        res.status(404).json({ error: '父文件夹不存在' })
        return
      }
      storagePath = `${parent.storagePath}/${name.trim()}`
    }

    // 同级同名检查
    const existing = await prisma.driveFile.findFirst({
      where: { name: name.trim(), parentId: parentId || null },
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
        parentId: parentId || null,
        storagePath,
        size: 0n,
        uploadedById: req.user!.userId,
      },
      select: {
        id: true,
        name: true,
        isFolder: true,
        parentId: true,
        storagePath: true,
        createdAt: true,
      },
    })

    res.status(201).json(folder)
  } catch (err) {
    console.error('创建文件夹失败:', err)
    res.status(500).json({ error: '创建文件夹失败' })
  }
})

/* ---------- 创建文件夹（HarmonyOS 兼容：POST /drive/files） ---------- */
router.post('/files', async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body as { name?: string; parentId?: unknown }
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: '文件夹名称不能为空' })
      return
    }
    if (name.length > 255) {
      res.status(400).json({ error: '文件夹名称过长' })
      return
    }
    if (/[<>:"/\\|?*]/.test(name)) {
      res.status(400).json({ error: '文件夹名称包含非法字符' })
      return
    }

    let storagePath = name.trim()
    let resolvedParentId: number | null = null
    if (parentId != null) {
      const pid = parseId(String(parentId))
      if (pid === null) {
        res.status(400).json({ error: '无效的父文件夹 ID' })
        return
      }
      resolvedParentId = pid
      const parent = await prisma.driveFile.findUnique({ where: { id: pid } })
      if (!parent || !parent.isFolder) {
        res.status(404).json({ error: '父文件夹不存在' })
        return
      }
      storagePath = `${parent.storagePath}/${name.trim()}`
    }

    const existing = await prisma.driveFile.findFirst({
      where: { name: name.trim(), parentId: resolvedParentId },
    })
    if (existing) {
      res.status(409).json({ error: '同级已存在同名文件或文件夹' })
      return
    }

    if (isNodeConnected()) {
      try {
        await sendCommand({ type: 'mkdir', path: storagePath })
      } catch (wsErr) {
        console.error('存储节点创建目录失败:', wsErr)
      }
    }

    const folder = await prisma.driveFile.create({
      data: {
        name: name.trim(),
        isFolder: true,
        parentId: resolvedParentId,
        storagePath,
        size: 0n,
        uploadedById: req.user!.userId,
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

    res.status(201).json(folder)
  } catch (err) {
    console.error('创建文件夹失败:', err)
    res.status(500).json({ error: '创建文件夹失败' })
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
    let parentId: number | null = null

    bb.on('field', (name, val) => {
      if (name === 'parentId') parentId = val ? parseInt(val, 10) || null : null
    })

    bb.on('file', async (_fieldname, stream, info) => {
      if (fileProcessed) return
      fileProcessed = true
      originalName = info.filename
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

        // 生成唯一存储路径
        const ext = originalName.includes('.')
          ? originalName.slice(originalName.lastIndexOf('.'))
          : ''
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
        const storagePath = `${parentPath}${uniqueName}`

        // 流式转发到存储节点 — 边收边发，无需全量缓冲
        let totalSize = 0

        async function* streamToAsyncIterable(stream: AsyncIterable<Buffer>) {
          for await (const chunk of stream) {
            totalSize += chunk.length
            yield chunk
          }
        }

        // === 先创建 DB 记录（唯一约束可防止重复），再写入存储节点 ===
        // 这样即使后续写入失败，也不会出现「节点有文件但 DB 缺失」的不一致状态
        const file = await prisma.driveFile.create({
          data: {
            name: originalName,
            isFolder: false,
            parentId: parentId || null,
            size: BigInt(totalSize),
            mimeType,
            storagePath,
            uploadedById: req.user!.userId,
          },
          select: {
            id: true, name: true, size: true, mimeType: true, createdAt: true,
          },
        })

        try {
          const writeResult = await streamWrite(storagePath, streamToAsyncIterable(stream), 0)
          if (!writeResult.success) {
            throw new Error(`存储节点写入失败: ${writeResult.error}`)
          }

          // 写入节点成功后更新实际大小
          if (totalSize > 0) {
            await prisma.driveFile.update({
              where: { id: file.id },
              data: { size: BigInt(totalSize) },
            })
          }

          res.status(201).json(file)
        } catch (writeErr) {
          // 存储节点写入失败 → 回滚：删除 DB 记录 + 清理节点残片
          await prisma.driveFile.delete({ where: { id: file.id } }).catch(() => {})
          try {
            if (isNodeConnected()) {
              await sendCommand({ type: 'delete_file', path: storagePath })
            }
          } catch { /* 节点清理失败则留待后续处理 */ }
          throw writeErr
        }
      } catch (err: unknown) {
        fileError = err instanceof Error ? err : new Error(String(err))
        // 耗尽流防止内存泄漏
        stream.resume()
      }
    })

    bb.on('close', () => {
      if (fileError) {
        if (!res.headersSent) {
          res.status(502).json({ error: fileError.message })
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

/* ---------- 下载文件（流式分块推送，HarmonyOS 兼容路径） ---------- */
router.get('/files/:id/download', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await prisma.driveFile.findUnique({ where: { id } })
    if (!file || file.isFolder) {
      res.status(404).json({ error: '文件不存在' })
      return
    }

    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接' })
      return
    }

    const mimeType = file.mimeType || 'application/octet-stream'
    const encodedName = encodeURIComponent(file.name)
    const contentLength = Number(file.size)

    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Length', String(contentLength))
    res.setHeader('X-Chunk-Size', String(config.downloadChunkKB * 1024))

    try {
      for await (const chunk of streamRead(file.storagePath)) {
        res.write(chunk)
      }
      res.end()
    } catch (streamErr: unknown) {
      console.error('下载流中断:', streamErr)
      if (!res.writableEnded) {
        res.end()
      }
    }
  } catch (err) {
    console.error('下载文件失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '下载文件失败' })
    }
  }
})

/* ---------- 下载文件（流式分块推送） ---------- */
router.get('/download/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await prisma.driveFile.findUnique({ where: { id } })
    if (!file || file.isFolder) {
      res.status(404).json({ error: '文件不存在' })
      return
    }

    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接' })
      return
    }

    const mimeType = file.mimeType || 'application/octet-stream'
    const encodedName = encodeURIComponent(file.name)
    const contentLength = Number(file.size)

    // 设置响应头
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Length', String(contentLength))  // 前端获取总大小
    res.setHeader('X-Chunk-Size', String(config.downloadChunkKB * 1024))  // 下载块大小提示

    try {
      // 从存储节点流式读取，逐块直接写入 HTTP 响应
      for await (const chunk of streamRead(file.storagePath)) {
        res.write(chunk)
      }
      res.end()
    } catch (streamErr: unknown) {
      console.error('下载流中断:', streamErr)
      if (!res.writableEnded) {
        res.end()  // 优雅关闭，前端已收到部分数据
      }
    }
  } catch (err) {
    console.error('下载文件失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '下载文件失败' })
    }
  }
})

/* ---------- 重命名/移动文件 ---------- */
router.put('/files/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await prisma.driveFile.findUnique({ where: { id } })
    if (!file) {
      res.status(404).json({ error: '文件不存在' })
      return
    }

    const { name, parentId } = req.body as { name?: string; parentId?: number | null }

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

      // 更新 storagePath（保留父路径，仅改文件名部分）
      const parentParts = file.storagePath.split('/')
      parentParts[parentParts.length - 1] = name.trim()
      const newStoragePath = parentParts.join('/')

      // 如果是文件夹，需要更新所有子文件的 storagePath（递归）
      if (file.isFolder) {
        const oldPrefix = file.storagePath + '/'
        const newPrefix = newStoragePath + '/'
        const children = await prisma.driveFile.findMany({
          where: {
            storagePath: { startsWith: oldPrefix },
          },
        })
        await Promise.all(
          children.map(child =>
            prisma.driveFile.update({
              where: { id: child.id },
              data: {
                storagePath: child.storagePath.replace(oldPrefix, newPrefix),
              },
            })
          )
        )
      }

      await prisma.driveFile.update({
        where: { id },
        data: {
          name: name.trim(),
          storagePath: newStoragePath,
        },
      })
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
          let checkParent: typeof newParent | null = newParent
          while (checkParent) {
            if (checkParent.id === id) {
              res.status(400).json({ error: '不能移动到自身或子文件夹中' })
              return
            }
            checkParent = checkParent.parentId
              ? await prisma.driveFile.findUnique({ where: { id: checkParent.parentId } })
              : null
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

        await prisma.driveFile.update({
          where: { id },
          data: {
            parentId: newParentId,
            storagePath: newStoragePath,
          },
        })
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

        await prisma.driveFile.update({
          where: { id },
          data: {
            parentId: null,
            storagePath: newStoragePath,
          },
        })
      }
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

    res.json(updated)
  } catch (err) {
    console.error('更新文件失败:', err)
    res.status(500).json({ error: '更新文件失败' })
  }
})

/* ---------- 删除文件（先删 DB 再删节点，防止同步复活） ---------- */
async function deleteFileRecursive(id: number): Promise<void> {
  const file = await prisma.driveFile.findUnique({ where: { id } })
  if (!file) return

  // 先收集所有子文件的 storagePath（递归）
  const pathsToDelete: string[] = []
  async function collectPaths(f: NonNullable<typeof file>) {
    pathsToDelete.push(f.storagePath)
    if (f.isFolder) {
      const children = await prisma.driveFile.findMany({
        where: { parentId: f.id },
      })
      for (const child of children) {
        await collectPaths(child)
      }
    }
  }
  await collectPaths(file)

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

    const file = await prisma.driveFile.findUnique({ where: { id } })
    if (!file) {
      res.status(404).json({ error: '文件不存在' })
      return
    }

    await deleteFileRecursive(id)
    res.json({ message: '已删除' })
  } catch (err) {
    console.error('删除文件失败:', err)
    res.status(500).json({ error: '删除文件失败' })
  }
})

/* ---------- 手动触发文件同步 ---------- */
router.post('/sync', async (_req: Request, res: Response) => {
  try {
    const report = await syncDriveFiles()
    res.json(report)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '同步失败'
    console.error('手动同步失败:', err)
    res.status(500).json({ error: `同步失败: ${message}` })
  }
})

export default router
