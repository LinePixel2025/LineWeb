import { Router, Request, Response } from 'express'
import busboy from 'busboy'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import prisma from '../lib/prisma.js'
import { parseId, parsePagination } from '../lib/utils.js'
import { authenticate, requireCapability } from '../middleware/auth.js'
import { roleHasCapability } from '../lib/permissions.js'
import { sendCommand, streamRead, streamReadBinary, streamWriteBinary, isNodeConnected } from '../services/storageTunnel.js'
import { syncDriveFiles, SYSTEM_DIRECTORIES } from '../services/storageSync.js'
import { getDriveQuota, getDriveUsage, formatQuotaSize } from '../services/driveQuota.js'
import { config } from '../config/index.js'
import { searchFTS, syncFTSIndex, deleteFTSIndex } from '../services/ftsSearch.js'

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

/**
 * mimeType 缺失（如经同步入库的文件）时按扩展名兜底推断，
 * 覆盖预览功能依赖的常见类型；推断不出仍回退 application/octet-stream
 */
const EXT_MIME_TYPES: Record<string, string> = {
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
  pdf: 'application/pdf',
  txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', log: 'text/plain', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
  zip: 'application/zip',
}

function resolveMimeType(fileName: string, storedMime: string | null): string {
  if (storedMime) return storedMime
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
  return EXT_MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * 是否允许以 Content-Disposition: inline（浏览器内直接渲染）方式下发。
 * 仅限无脚本执行风险的类型：视频/音频/PDF/纯文本/JSON。
 * text/html、text/javascript、SVG 等可携带脚本的类型一律排除，
 * 防止 ?disposition=inline 被拼在同源 iframe 上造成 XSS。
 */
const INLINE_MIME_EXACT = new Set(['application/pdf', 'application/json'])
const INLINE_MIME_BLOCKED = new Set(['text/html', 'text/javascript', 'image/svg+xml'])
const INLINE_MIME_PREFIXES = ['video/', 'audio/', 'text/']

function canServeInline(mimeType: string): boolean {
  const lower = mimeType.toLowerCase()
  if (INLINE_MIME_BLOCKED.has(lower)) return false
  return INLINE_MIME_EXACT.has(lower) || INLINE_MIME_PREFIXES.some(prefix => lower.startsWith(prefix))
}

// === BigInt 序列化 — 显式转换 size 为字符串，避免全局原型污染 ===
type WithSize<T extends { size: bigint }> = Omit<T, 'size'> & { size: string }

function transformSize<T extends { size: bigint }>(file: T): WithSize<T> {
  return { ...file, size: file.size.toString() }
}

function transformSizeList<T extends { size: bigint }>(files: T[]): WithSize<T>[] {
  return files.map(transformSize)
}

/* ---------- 上传大小 / 空间配额限制错误（统一映射为 413） ---------- */
class UploadLimitError extends Error {
  readonly code: 'QUOTA_EXCEEDED' | 'FILE_TOO_LARGE'
  readonly quota: string | null
  readonly used: string | null
  readonly remaining: string | null

  constructor(
    message: string,
    code: 'QUOTA_EXCEEDED' | 'FILE_TOO_LARGE',
    detail?: { quota?: bigint; used?: bigint; remaining?: bigint },
  ) {
    super(message)
    this.name = 'UploadLimitError'
    this.code = code
    this.quota = detail?.quota !== undefined ? detail.quota.toString() : null
    this.used = detail?.used !== undefined ? detail.used.toString() : null
    this.remaining = detail?.remaining !== undefined ? detail.remaining.toString() : null
  }
}

/**
 * 413 响应体（客户端 UploadZone 直接展示 error 文案）：
 *   - QUOTA_EXCEEDED：附带 quota / used / remaining（字符串形式的字节数）
 *   - FILE_TOO_LARGE：保持原有单文件超限文案，客户端行为不变
 */
function sendUploadLimitError(res: Response, err: UploadLimitError): void {
  if (res.headersSent) return
  res.status(413).json({
    error: err.message,
    code: err.code,
    ...(err.code === 'QUOTA_EXCEEDED'
      ? { quota: err.quota, used: err.used, remaining: err.remaining ?? '0' }
      : {}),
  })
}

// === 网盘访问权限 ===
// canAccessDrive 开关由管理员在用户管理页控制；具备 drive:all 能力的角色（admin）自动通过。
// 权限值随每次认证从数据库解析（见 middleware/auth.ts），因此变更即时生效，无需缓存。
function hasDriveAccess(user: { role: string; canAccessDrive: boolean }): boolean {
  return user.canAccessDrive || roleHasCapability(user.role, 'drive:all')
}

// === 公共网盘 ===
// 公共根条目的 storagePath 前缀（子级自然继承父 storagePath）；私有根保持现状（裸文件名）。
// 存储同步器把 _public 视为系统目录跳过（见 storageSync.ts SYSTEM_DIRECTORIES），
// 公共文件只能经本路由由 drive:all 管理员创建。
const PUBLIC_STORAGE_PREFIX = '_public'

/**
 * 根级条目保留名校验（大小写不敏感——存储节点可能是 Windows 文件系统，`_Public` 与 `_public` 同目录）。
 * 根级条目占用系统目录名（_public/_avatars/_chat/_ai）后，其 storagePath 会被同步器的
 * isSystemPath 从节点扫描中剔除，进而被孤儿清理周期性误删 DB 记录，必须从入口拦截。
 */
function isReservedRootName(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return SYSTEM_DIRECTORIES.some(dir => dir.toLowerCase() === normalized)
}

type DriveScope = 'private' | 'public'

function parseScope(raw: unknown): DriveScope {
  return raw === 'public' ? 'public' : 'private'
}

function scopeOf(isPublic: boolean): DriveScope {
  return isPublic ? 'public' : 'private'
}

// === 文件访问校验 — 防止用户越权操作他人/公共文件 ===
/**
 * 校验当前用户对指定文件的访问权限。
 * - mode='read'：drive:all 全通过；公共文件对所有已过路由守卫的用户（必然有网盘权限）开放；否则须为上传者。
 * - mode='write'：drive:all 全通过；公共文件仅 drive:all 可写（普通用户即便非 owner 也不允许，
 *   公共区由管理员统一维护）；私有文件仍须为上传者。
 * 返回文件记录（含 storagePath / isFolder / isPublic 等），或 null 表示无权访问/不存在。
 */
async function assertFileAccess(
  fileId: number,
  user: { userId: number; role: string },
  mode: 'read' | 'write',
): Promise<{
  id: number
  name: string
  isFolder: boolean
  parentId: number | null
  storagePath: string
  size: bigint
  mimeType: string | null
  uploadedById: number | null
  isPublic: boolean
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
      isPublic: true,
    },
  })
  if (!file) return null
  const isManager = roleHasCapability(user.role, 'drive:all')
  // 具备 drive:all 能力者豁免
  if (isManager) return file
  // 公共文件对普通用户永远不可写
  if (mode === 'write' && file.isPublic) return null
  // 公共文件对所有有网盘权限的用户可读（能到达此处均已通过路由级守卫）
  if (file.isPublic) return file
  // 私有文件必须为上传者
  if (file.uploadedById !== user.userId) return null
  return file
}

/**
 * 校验目标父文件夹的写入权限。
 * @param scope 期望的写入区域：父文件夹的 isPublic 必须与之一致（不一致返回 null，防参数伪造跨区写入）。
 *   根目录（parentId=null）时返回的 isPublic 标识该虚拟根的区域。
 * public 区域仅 drive:all 可写；private 区域 drive:all 或 owner 可写。
 */
async function assertParentFolderAccess(
  parentId: number | null,
  user: { userId: number; role: string },
  scope: DriveScope = 'private',
): Promise<{ id: number; storagePath: string; isPublic: boolean } | null> {
  if (parentId === null) return { id: 0, storagePath: '', isPublic: scope === 'public' }
  const parent = await prisma.driveFile.findUnique({
    where: { id: parentId },
    select: { id: true, isFolder: true, storagePath: true, uploadedById: true, isPublic: true },
  })
  if (!parent || !parent.isFolder) return null
  if (scopeOf(parent.isPublic) !== scope) return null
  const isManager = roleHasCapability(user.role, 'drive:all')
  if (scope === 'public') {
    // 公共区只允许 drive:all 管理员写入
    if (!isManager) return null
    return { id: parent.id, storagePath: parent.storagePath, isPublic: true }
  }
  if (!isManager && parent.uploadedById !== user.userId) return null
  return { id: parent.id, storagePath: parent.storagePath, isPublic: false }
}

// 所有路由需要登录 + 网盘访问权限（canAccessDrive 开关或 drive:all 能力）
router.use(authenticate, (req: Request, res: Response, next) => {
  if (!req.user || !hasDriveAccess(req.user)) {
    res.status(403).json({ error: '无网盘访问权限' })
    return
  }
  next()
})

/* ---------- 查询当前用户的空间配额 ---------- */
router.get('/quota', async (req: Request, res: Response) => {
  try {
    const quota = await getDriveQuota(req.user!)
    // BigInt → 字符串：BigInt 不能直接 JSON 序列化
    res.json({
      unlimited: quota.unlimited,
      quota: quota.quota === null ? null : quota.quota.toString(),
      used: quota.used.toString(),
      remaining: quota.remaining === null ? null : quota.remaining.toString(),
    })
  } catch (err) {
    console.error('获取网盘配额失败:', err)
    res.status(500).json({ error: '获取网盘配额失败' })
  }
})

router.post('/download-ticket/:id', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的文件 ID' })
    return
  }
  const file = await assertFileAccess(id, req.user!, 'read')
  if (!file || file.isFolder) {
    res.status(404).json({ error: '文件不存在或无权访问' })
    return
  }
  // ts 为毫秒级签发时间：与 user.tokenValidAfter 精确比较，
  // 否则同秒内（如刚改完密码）签发的票据会被认证中间件误判为失效
  const ticket = jwt.sign({
    type: 'download',
    userId: req.user!.userId,
    role: req.user!.role,
    ts: Date.now(),
    downloadFileId: id,
    downloadNonce: crypto.randomBytes(16).toString('hex'),
  }, config.jwtSecret, { expiresIn: config.downloadTicketExpiresIn })
  res.json({ ticket, expiresIn: 300 })
})

/* ---------- 获取文件列表（支持分页；scope=public 查看公共网盘） ---------- */
router.get('/files', async (req: Request, res: Response) => {
  try {
    const parentIdStr = req.query.parentId as string | undefined
    const parentId = parentIdStr ? parseId(parentIdStr) : null
    const { page, limit, skip } = parsePagination(req.query)
    const scope = parseScope(req.query.scope)

    // 区域过滤：public 只看公共文件（人人可看）；private 只看私有文件，
    // 其中具备 drive:all 能力者看全部私有，普通用户仅看自己上传的文件
    const isAdmin = roleHasCapability(req.user!.role, 'drive:all')
    const where: { parentId: number | null; uploadedById?: number; isPublic: boolean } = {
      parentId,
      isPublic: scope === 'public',
    }
    if (scope === 'private' && !isAdmin) {
      where.uploadedById = req.user!.userId
    }

    const [data, total] = await Promise.all([
      prisma.driveFile.findMany({
        where,
        select: {
          id: true,
          name: true,
          isFolder: true,
          isPublic: true,
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

    // 访问校验：无权访问（非上传者的私有文件）/不存在返回 404（不暴露文件存在性）
    const file = await assertFileAccess(id, req.user!, 'read')
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

/* ---------- 搜索文件（scope=public 只搜公共网盘） ---------- */
router.get('/search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim()
    if (!q) {
      res.json([])
      return
    }
    const scope = parseScope(req.query.scope)

    // 所有权过滤：public 只搜公共文件；private 管理员搜全部私有，普通用户仅搜自己的文件
    const isAdmin = roleHasCapability(req.user!.role, 'drive:all')
    const where: { name: { contains: string }; uploadedById?: number; isPublic: boolean } = {
      name: { contains: q },
      isPublic: scope === 'public',
    }
    if (scope === 'private' && !isAdmin) {
      where.uploadedById = req.user!.userId
    }

    const files = await prisma.driveFile.findMany({
      where,
      select: {
        id: true,
        name: true,
        isFolder: true,
        isPublic: true,
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

/* ---------- FTS5 全文搜索 ---------- */
router.get('/fts-search', async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim()
    if (!q) {
      res.json([])
      return
    }

    const isAdmin = roleHasCapability(req.user!.role, 'drive:all')
    const scope = parseScope(req.query.scope)
    const results = await searchFTS(q, isAdmin, req.user!.userId, 50, scope)

    // 查询完整文件信息（回表时再按 scope 过滤一次，兜底 FTS 索引与主表状态不一致的情况）
    if (results.length === 0) {
      res.json([])
      return
    }
    const fileIds = results.map(r => r.id)
    const files = await prisma.driveFile.findMany({
      where: { id: { in: fileIds }, isPublic: scope === 'public' },
      select: {
        id: true, name: true, isFolder: true, isPublic: true, parentId: true,
        size: true, mimeType: true, createdAt: true, updatedAt: true,
        uploadedBy: { select: { id: true, username: true } },
      },
    })
    // 按搜索结果顺序排序
    const fileMap = new Map(files.map(f => [f.id, f]))
    const ordered = fileIds.map(id => fileMap.get(id)).filter(Boolean)

    res.json(transformSizeList(ordered as any[]))
  } catch (err) {
    console.error('FTS搜索失败:', err)
    res.status(500).json({ error: '搜索失败' })
  }
})

/**
 * 创建文件夹共用逻辑
 * 提取自 /folders 和 /files 路由，避免代码重复
 * @param requestedScope 请求声明的区域（仅根级创建时采信；有父文件夹时以父的 isPublic 为准，防参数伪造）
 */
async function handleCreateFolder(
  name: string | undefined,
  parentIdRaw: unknown,
  user: { userId: number; role: string },
  res: Response,
  requestedScope: DriveScope = 'private',
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

  // 根级条目占用系统保留名会被存储同步器误判孤儿并周期性删除 DB 记录（见 storageSync.isSystemPath）
  if (resolvedParentId === null && isReservedRootName(name)) {
    res.status(400).json({ error: '该名称为系统保留，请更换' })
    return
  }

  // 实际区域：有父文件夹时以父的 isPublic 为准；根级才信请求参数
  let actualScope = requestedScope
  if (resolvedParentId !== null) {
    const parentRow = await prisma.driveFile.findUnique({
      where: { id: resolvedParentId },
      select: { isFolder: true, isPublic: true },
    })
    if (!parentRow || !parentRow.isFolder) {
      res.status(403).json({ error: '无权写入目标文件夹' })
      return
    }
    actualScope = scopeOf(parentRow.isPublic)
  }
  // 公共网盘仅 drive:all 管理员可维护
  if (actualScope === 'public' && !roleHasCapability(user.role, 'drive:all')) {
    res.status(403).json({ error: '公共网盘仅管理员可维护' })
    return
  }

  // 如果指定了 parentId，验证父文件夹存在（并确保区域一致）
  let storagePath: string
  if (resolvedParentId) {
    const parent = await assertParentFolderAccess(resolvedParentId, user, actualScope)
    if (!parent) {
      res.status(403).json({ error: '无权写入目标文件夹' })
      return
    }
    storagePath = `${parent.storagePath}/${name.trim()}`
  } else {
    // 公共根条目统一放在 _public/ 前缀下，与私有根（裸文件名）隔离
    storagePath = actualScope === 'public'
      ? `${PUBLIC_STORAGE_PREFIX}/${name.trim()}`
      : name.trim()
  }

  // 同级同名检查（按区域隔离：公共盘与私有盘允许同名）
  const existing = await prisma.driveFile.findFirst({
    where: { name: name.trim(), parentId: resolvedParentId, isPublic: actualScope === 'public' },
  })
  if (existing) {
    res.status(409).json({ error: '同级已存在同名文件或文件夹' })
    return
  }

  // 通知存储节点创建目录
  if (!isNodeConnected()) {
    res.status(503).json({ error: '存储节点未连接' })
    return
  }
  try {
    const mkdirResp = await sendCommand({ type: 'mkdir', path: storagePath })
    if (!mkdirResp.success) throw new Error(mkdirResp.error || 'mkdir failed')
  } catch (wsErr) {
    console.error('存储节点创建目录失败:', wsErr)
    res.status(502).json({ error: '存储节点创建目录失败' })
    return
  }

  const folder = await prisma.driveFile.create({
    data: {
      name: name.trim(),
      isFolder: true,
      parentId: resolvedParentId,
      storagePath,
      size: 0n,
      isPublic: actualScope === 'public',
      uploadedById: user.userId,
    },
    select: {
      id: true,
      name: true,
      isFolder: true,
      isPublic: true,
      parentId: true,
      size: true,
      mimeType: true,
      createdAt: true,
      updatedAt: true,
      uploadedBy: { select: { id: true, username: true } },
    },
  })

  // P25: 同步 FTS 索引
  syncFTSIndex([folder.id]).catch(() => {})
  res.status(201).json(transformSize(folder))
}

/* ---------- 创建文件夹（scope=public 在公共网盘创建，仅 drive:all） ---------- */
router.post('/folders', async (req: Request, res: Response) => {
  try {
    const { name, parentId } = req.body
    const scope = parseScope(req.body?.scope ?? req.query.scope)
    await handleCreateFolder(name, parentId, req.user!, res, scope)
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
    const scope = parseScope(req.body?.scope ?? req.query.scope)
    await handleCreateFolder(name, parentId, req.user!, res, scope)
  } catch (err) {
    console.error('创建文件夹失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '创建文件夹失败' })
    }
  }
})

/* ---------- 上传文件 (busboy 流式解析 + 空间配额强制；scope=public 上传到公共网盘，仅 drive:all) ---------- */
router.post('/upload', async (req: Request, res: Response) => {
  try {
    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接，请稍后再试' })
      return
    }

    const requestedScope = parseScope(req.query.scope)
    const isManager = roleHasCapability(req.user!.role, 'drive:all')
    // 公共网盘仅 drive:all 可上传；提前拒绝，避免非管理员白白消耗上传流量
    if (requestedScope === 'public' && !isManager) {
      res.status(403).json({ error: '公共网盘仅管理员可维护' })
      req.resume()
      return
    }

    // === 配额预检：解析 multipart 之前先判断剩余空间 ===
    // 已用满时直接 413，避免白白把整个请求体读进来再丢弃。
    const quota = await getDriveQuota(req.user!)
    if (!quota.unlimited && quota.quota !== null && quota.remaining !== null && quota.remaining <= 0n) {
      sendUploadLimitError(res, new UploadLimitError('网盘空间不足', 'QUOTA_EXCEEDED', {
        quota: quota.quota,
        used: quota.used,
        remaining: 0n,
      }))
      // 响应已发出：继续消费请求体（丢弃），避免连接被重置导致前端只看到「网络错误」
      req.resume()
      return
    }

    // 单个文件允许的上限 = min(单文件大小上限, 剩余空间)
    // busboy 触发上限时流会被截断，因此记录「限制是否由配额决定」以区分 413 文案。
    const fileSizeHardLimit = BigInt(config.maxFileSizeMB) * 1024n * 1024n
    const remainingBytes = quota.unlimited ? null : quota.remaining
    const quotaLimited = remainingBytes !== null && remainingBytes < fileSizeHardLimit
    const effectiveLimitBytes = quotaLimited && remainingBytes !== null ? remainingBytes : fileSizeHardLimit
    // 配额上限最大 10 TiB，Number 转换在安全整数范围内
    const effectiveLimit = Number(effectiveLimitBytes)

    const bb = busboy({ headers: req.headers, limits: { fileSize: effectiveLimit } })
    let fileProcessed = false
    let fileError: Error | null = null
    let bbClosed = false
    let originalName = ''
    let mimeType = ''
    // 错误响应统一出口：busboy close 与异步写失败是竞态（小文件时 close 可能先触发，
    // 此时 fileError 还是 null），必须允许后到的一方补发响应，否则请求永久挂起
    const respondErrorIfSettled = () => {
      if (!bbClosed || !fileError || res.headersSent) return
      if (fileError instanceof UploadLimitError) {
        sendUploadLimitError(res, fileError)
      } else if (fileError.message.includes('限制')) {
        res.status(413).json({ error: fileError.message })
      } else if (fileError.message.includes('无权') || fileError.message.includes('公共网盘')) {
        // 流中段的权限/区域校验失败（如借私有区参数伪造上传公共夹）→ 403 而非 502
        res.status(403).json({ error: fileError.message })
      } else if (fileError.message.includes('系统保留')) {
        // 根级上传占用保留名 → 400
        res.status(400).json({ error: fileError.message })
      } else {
        res.status(502).json({ error: fileError.message })
      }
    }
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

      // busboy 的文件大小上限触发的是「文件流」的 limit 事件（不是 multipart 实例），
      // 触发后文件流会被截断，必须主动清理并返回 413，否则会静默写入半截文件。
      let sizeLimitHit = false
      stream.on('limit', () => { sizeLimitHit = true })

      try {
        // 解析父文件夹路径与实际区域：有父文件夹时以父的 isPublic 为准（防参数伪造），根级才信请求参数
        let parentPath = ''
        let actualScope: DriveScope = requestedScope
        if (parentId) {
          const parentRow = await prisma.driveFile.findUnique({
            where: { id: parentId },
            select: { isFolder: true, isPublic: true },
          })
          if (!parentRow || !parentRow.isFolder) throw new Error('无权写入目标文件夹')
          const parentScope = scopeOf(parentRow.isPublic)
          if (parentScope === 'public' && !isManager) throw new Error('公共网盘仅管理员可维护')
          const parent = await assertParentFolderAccess(parentId, req.user!, parentScope)
          if (!parent) throw new Error('无权写入目标文件夹')
          actualScope = parentScope
          parentPath = parent.storagePath + '/'
        } else if (actualScope === 'public') {
          // 公共根：所有根级公共文件放在 _public/ 前缀下
          parentPath = `${PUBLIC_STORAGE_PREFIX}/`
        }

        // 生成存储路径 — 使用原始文件名，冲突时自动追加计数器后缀
        const safeName = originalName.replace(/[<>:"/\\|?*]/g, '_')
        // 根级上传不可占用系统保留名（同建夹校验，防同步器误删）
        if (parentId === null && isReservedRootName(safeName)) {
          throw new Error('文件名「_public」「_avatars」「_chat」「_ai」「_books」为系统保留，请重命名后上传')
        }
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
            isPublic: actualScope === 'public',
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

          // 触达大小上限：文件流已被截断，清理掉半截文件与 DB 行，再按原因返回 413
          if (sizeLimitHit) {
            if (quotaLimited && remainingBytes !== null) {
              throw new UploadLimitError(
                `网盘空间不足（剩余 ${formatQuotaSize(remainingBytes)}）`,
                'QUOTA_EXCEEDED',
                { quota: quota.quota ?? undefined, used: quota.used, remaining: 0n },
              )
            }
            throw new UploadLimitError(`文件大小超过限制 (${config.maxFileSizeMB}MB)`, 'FILE_TOO_LARGE')
          }

          const updatedFile = await prisma.driveFile.update({
            where: { id: file.id },
            data: { size: BigInt(bytesWritten) },
            select: {
              id: true, name: true, size: true, mimeType: true, createdAt: true,
            },
          })

          // === 写入完成后复核 ===
          // 并发上传可能让多个请求同时看到「剩余空间充足」，或管理员中途下调了配额；
          // 落库后重新统计，确认超限则清理本次上传（DB 行 + 节点文件）并返回 413。
          if (!quota.unlimited && quota.quota !== null) {
            const usedAfter = await getDriveUsage(req.user!.userId)
            if (usedAfter > quota.quota) {
              throw new UploadLimitError('网盘空间不足', 'QUOTA_EXCEEDED', {
                quota: quota.quota,
                used: usedAfter,
                remaining: 0n,
              })
            }
          }

          res.status(201).json(transformSize(updatedFile))

          // 异步更新 FTS 索引
          syncFTSIndex([file.id]).catch(() => {})
        } catch (writeErr) {
          // 失败 / 超限清理：删 DB 行 + 删节点文件 + 清 FTS，确保 413 后无残留
          await prisma.driveFile.delete({ where: { id: file.id } }).catch(() => {})
          deleteFTSIndex([file.id]).catch(() => {})
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
        // 限制类错误立即响应：busboy 的 close 事件可能先于此异步流程触发，
        // 若等到 close 再响应会漏掉 413
        if (fileError instanceof UploadLimitError) {
          sendUploadLimitError(res, fileError)
        } else {
          // 非限制类错误（节点写入失败等）：close 可能已先触发（fileError 当时还是 null），
          // 由 respondErrorIfSettled 立即补发；close 未触发则等 close 时统一响应
          respondErrorIfSettled()
        }
        // 耗尽流防止内存泄漏
        stream.resume()
      }
    })

    bb.on('close', () => {
      bbClosed = true
      if (fileError) {
        respondErrorIfSettled()
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

    const file = await assertFileAccess(id, req.user!, 'read')
    if (!file || file.isFolder) {
      res.status(404).json({ error: '文件不存在或无权访问' })
      return
    }

    if (req.user!.type === 'download') {
      if (req.user!.downloadFileId !== id || !req.user!.downloadNonce) {
        res.status(403).json({ error: '下载票据与文件不匹配' })
        return
      }
    }

    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接' })
      return
    }

    const mimeType = resolveMimeType(file.name, file.mimeType)
    const encodedName = encodeURIComponent(file.name)
    const contentLength = Number(file.size)
    // 预览（PDF iframe / 文本抓取）请求 inline；仅对安全类型生效，其余一律强制 attachment
    const disposition = req.query.disposition === 'inline' && canServeInline(mimeType)
      ? 'inline'
      : 'attachment'

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
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedName}`)
      res.setHeader('Content-Range', `bytes ${start}-${end ?? contentLength - 1}/${contentLength}`)
      res.setHeader('Content-Length', len)
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Content-Length', String(contentLength))
      res.setHeader('Accept-Ranges', 'bytes')

      try {
        let streamedBytes = 0
        for await (const chunk of streamReadBinary(file.storagePath, start, len)) {
          streamedBytes += chunk.length
          const canContinue = res.write(chunk)
          if (!canContinue) {
            await new Promise<void>(resolve => res.once('drain', resolve))
          }
        }
        if (streamedBytes !== len) {
          throw new Error(`下载长度不完整: expected=${len}, actual=${streamedBytes}`)
        }
        res.end()
      } catch (streamErr: unknown) {
        console.error('下载流中断:', streamErr)
        if (!res.writableEnded) res.destroy(streamErr instanceof Error ? streamErr : undefined)
      }
      return
    }

    // 全量下载
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodedName}`)
    res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Length', String(contentLength))
    res.setHeader('Accept-Ranges', 'bytes')

    try {
      let streamedBytes = 0
      for await (const chunk of streamReadBinary(file.storagePath)) {
        streamedBytes += chunk.length
        const canContinue = res.write(chunk)
        if (!canContinue) {
          await new Promise<void>(resolve => res.once('drain', resolve))
        }
      }
      if (streamedBytes !== contentLength) {
        throw new Error(`下载长度不完整: expected=${contentLength}, actual=${streamedBytes}`)
      }
      res.end()
    } catch (streamErr: unknown) {
      console.error('下载流中断:', streamErr)
      if (!res.writableEnded) res.destroy(streamErr instanceof Error ? streamErr : undefined)
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

    const file = await assertFileAccess(id, req.user!, 'write')
    if (!file) {
      res.status(404).json({ error: '文件不存在或无权访问' })
      return
    }

    const { name, parentId } = req.body as { name?: string; parentId?: number | null }

    if (name !== undefined && parentId !== undefined) {
      res.status(400).json({ error: '重命名和移动请分开操作' })
      return
    }

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
      // 根级条目不可重命名为系统保留名（同建夹校验，防同步器误删）
      if (!file.parentId && isReservedRootName(name)) {
        res.status(400).json({ error: '该名称为系统保留，请更换' })
        return
      }

      // 通知存储节点重命名
      if (!isNodeConnected()) {
        res.status(503).json({ error: '存储节点未连接' })
        return
      }
      try {
        const renameResp = await sendCommand({
          type: 'rename',
          path: file.storagePath,
          newName: name.trim(),
        })
        if (!renameResp.success) throw new Error(renameResp.error || 'rename failed')
      } catch (wsErr) {
        console.error('存储节点重命名失败:', wsErr)
        res.status(502).json({ error: '存储节点重命名失败' })
        return
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
        // 目标区域 = 目标父文件夹的 isPublic；与文件自身区域不一致即为跨区移动，直接拒绝
        const targetRow = await prisma.driveFile.findUnique({
          where: { id: newParentId },
          select: { isFolder: true, isPublic: true },
        })
        if (!targetRow || !targetRow.isFolder) {
          res.status(403).json({ error: '无权移动到目标文件夹' })
          return
        }
        const targetScope = scopeOf(targetRow.isPublic)
        if (targetScope !== scopeOf(file.isPublic)) {
          res.status(400).json({ error: '不能在公共网盘与我的网盘之间移动文件' })
          return
        }
        const newParent = await assertParentFolderAccess(newParentId, req.user!, targetScope)
        if (!newParent) {
          res.status(403).json({ error: '无权移动到目标文件夹' })
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
            const moveResp = await sendCommand({
              type: 'move',
              path: file.storagePath,
              newPath: newStoragePath,
            })
            if (!moveResp.success) throw new Error(moveResp.error || 'move failed')
          } catch (wsErr) {
            console.error('存储节点移动失败:', wsErr)
            res.status(502).json({ error: '存储节点移动失败' })
            return
          }
        } else {
          res.status(503).json({ error: '存储节点未连接' })
          return
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
        // 移动到根目录：保持文件自身区域（公共文件落公共根 _public/，私有文件落私有根）
        const newStoragePath = file.isPublic ? `${PUBLIC_STORAGE_PREFIX}/${file.name}` : file.name

        if (isNodeConnected()) {
          try {
            const moveResp = await sendCommand({
              type: 'move',
              path: file.storagePath,
              newPath: newStoragePath,
            })
            if (!moveResp.success) throw new Error(moveResp.error || 'move failed')
          } catch (wsErr) {
            console.error('存储节点移动失败:', wsErr)
            res.status(502).json({ error: '存储节点移动失败' })
            return
          }
        } else {
          res.status(503).json({ error: '存储节点未连接' })
          return
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

    // 异步更新 FTS 索引（重命名/移动后名称或路径可能变化）
    syncFTSIndex([id]).catch(() => {})

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
    select: { id: true, storagePath: true },
  })
  const pathsToDelete = [file.storagePath, ...descendants.map(d => d.storagePath)]

  // 收集所有被删除文件的 ID，异步删除 FTS 索引
  const allIds = [file.id, ...descendants.map(d => d.id)]
  deleteFTSIndex(allIds).catch(() => {})

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

    const file = await assertFileAccess(id, req.user!, 'write')
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

/* ---------- 解析路径字符串为面包屑（scope=public 解析公共网盘路径） ---------- */
router.get('/resolve-path', async (req: Request, res: Response) => {
  try {
    const pathStr = (req.query.path as string || '').trim()
    const scope = parseScope(req.query.scope)
    const rootName = scope === 'public' ? '公共网盘' : '根目录'
    if (!pathStr) {
      res.json([{ id: null, name: rootName }])
      return
    }

    let segments = pathStr.split('/').filter(s => s.length > 0)
    // 公共网盘的虚拟根不参与真实路径解析（前端面包屑根名为「公共网盘」，存储前缀为 _public）
    if (scope === 'public' && segments.length > 0 &&
      (segments[0] === '公共网盘' || segments[0] === PUBLIC_STORAGE_PREFIX)) {
      segments = segments.slice(1)
    }
    const breadcrumbs: { id: number | null; name: string }[] = [{ id: null, name: rootName }]
    if (segments.length === 0) {
      res.json(breadcrumbs)
      return
    }

    let currentParentId: number | null = null
    for (const segment of segments) {
      // P23: Check cache before querying DB for each path segment（缓存键含 scope，公共/私有同名文件夹互不串用）
      const cacheKey = `${scope}:${currentParentId ?? 'root'}:${segment}`
      const cachedId = pathCache.get(cacheKey)
      let folder: { id: number; name: string } | null = null

      if (cachedId !== undefined) {
        const cached = await prisma.driveFile.findUnique({
          where: { id: cachedId },
          select: { id: true, name: true, isPublic: true },
        })
        // 缓存命中但文件的区域标记已变化（被移出/改公共状态）时按未命中处理
        if (cached && scopeOf(cached.isPublic) === scope) {
          folder = { id: cached.id, name: cached.name }
        }
      }

      if (!folder) {
        folder = await prisma.driveFile.findFirst({
          where: {
            name: segment,
            isFolder: true,
            parentId: currentParentId,
            isPublic: scope === 'public',
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

/* ---------- 手动触发文件同步（仅具备 drive:all 能力的管理员） ---------- */
router.post('/sync', requireCapability('drive:all'), async (req: Request, res: Response) => {
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
