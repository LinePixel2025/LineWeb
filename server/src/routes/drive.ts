import { Router, Request, Response } from 'express'
import multer from 'multer'
import prisma from '../lib/prisma.js'
import { parseId, parsePagination } from '../lib/utils.js'
import { authenticate } from '../middleware/auth.js'
import { sendCommand, sendChunkedWrite, sendChunkedRead, isNodeConnected } from '../services/storageTunnel.js'
import { syncDriveFiles } from '../services/storageSync.js'
import { config } from '../config/index.js'

// JSON 序列化 BigInt
BigInt.prototype.toJSON = function () {
  return Number(this)
}

export {} // 确保模块导出使上述 BigInt.prototype 生效

declare global {
  interface BigInt {
    toJSON(): number
  }
}

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxFileSizeMB * 1024 * 1024 },
})

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

    const where: any = { parentId }

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

/* ---------- 上传文件 ---------- */
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: '请选择文件' })
      return
    }

    const parentIdStr = req.body.parentId as string | undefined
    const parentId = parentIdStr ? parseId(parentIdStr) : null

    let parentPath = ''
    if (parentId) {
      const parent = await prisma.driveFile.findUnique({ where: { id: parentId } })
      if (!parent || !parent.isFolder) {
        res.status(404).json({ error: '父文件夹不存在' })
        return
      }
      parentPath = parent.storagePath + '/'
    }

    // 生成唯一文件名
    const ext = req.file.originalname.includes('.')
      ? req.file.originalname.slice(req.file.originalname.lastIndexOf('.'))
      : ''
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
    const storagePath = `${parentPath}${uniqueName}`

    // 同级同名检查（可选：保留原始文件名时启用）
    // 这里存储路径用唯一名，所以不会冲突

    // 通知存储节点写入文件
    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接，请稍后再试' })
      return
    }

    const fileBuffer = req.file.buffer

    let writeResult
    try {
      writeResult = await sendChunkedWrite(storagePath, fileBuffer)
    } catch (wsErr: any) {
      console.error('存储节点写入失败:', wsErr)
      res.status(502).json({ error: `存储节点写入失败: ${wsErr.message}` })
      return
    }

    if (!writeResult.success) {
      res.status(502).json({ error: `存储节点写入失败: ${writeResult.error}` })
      return
    }

    // DB 记录
    const file = await prisma.driveFile.create({
      data: {
        name: req.file.originalname,
        isFolder: false,
        parentId: parentId || null,
        size: BigInt(fileBuffer.length),
        mimeType: req.file.mimetype,
        storagePath,
        uploadedById: req.user!.userId,
      },
      select: {
        id: true,
        name: true,
        size: true,
        mimeType: true,
        createdAt: true,
      },
    })

    res.status(201).json(file)
  } catch (err) {
    console.error('上传文件失败:', err)
    res.status(500).json({ error: '上传文件失败' })
  }
})

/* ---------- 下载文件 ---------- */
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

    let readResult
    try {
      readResult = await sendChunkedRead(file.storagePath)
    } catch (wsErr: any) {
      console.error('存储节点读取失败:', wsErr)
      res.status(502).json({ error: `存储节点读取失败: ${wsErr.message}` })
      return
    }

    if (!readResult.success) {
      res.status(502).json({ error: `存储节点读取失败: ${readResult.error}` })
      return
    }

    const fileBuffer = Buffer.from(readResult.data as string, 'base64')
    const mimeType = file.mimeType || 'application/octet-stream'
    const encodedName = encodeURIComponent(file.name)

    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    res.setHeader('Content-Length', fileBuffer.length)
    res.send(fileBuffer)
  } catch (err) {
    console.error('下载文件失败:', err)
    res.status(500).json({ error: '下载文件失败' })
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

      // 同级同名检查
      const existing = await prisma.driveFile.findFirst({
        where: {
          name: name.trim(),
          parentId: file.parentId,
          id: { not: id },
        },
      })
      if (existing) {
        res.status(409).json({ error: '同级已存在同名文件或文件夹' })
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
      const oldParentId = file.parentId

      if (newParentId === oldParentId) {
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

/* ---------- 删除文件 ---------- */
async function deleteFileRecursive(id: number): Promise<void> {
  const file = await prisma.driveFile.findUnique({ where: { id } })

  if (!file) return

  if (file.isFolder) {
    // 递归删除子文件
    const children = await prisma.driveFile.findMany({
      where: { parentId: id },
    })
    for (const child of children) {
      await deleteFileRecursive(child.id)
    }
  }

  // 通知存储节点删除
  if (isNodeConnected()) {
    try {
      await sendCommand({
        type: file.isFolder ? 'delete_file' : 'delete_file',
        path: file.storagePath,
      })
    } catch (wsErr) {
      console.error(`存储节点删除 ${file.storagePath} 失败:`, wsErr)
    }
  }

  await prisma.driveFile.delete({ where: { id } })
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
  } catch (err: any) {
    console.error('手动同步失败:', err)
    res.status(500).json({ error: `同步失败: ${err.message}` })
  }
})

export default router
