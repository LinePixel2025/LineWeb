import crypto from 'crypto'
import JSZip from 'jszip'
import sharp from 'sharp'
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { isNodeConnected, sendCommand, streamWriteBinary } from './storageTunnel.js'
import { getDriveUsage, formatQuotaSize, type DriveQuotaInfo } from './driveQuota.js'

/**
 * 小说阅读器服务
 *
 * 职责（路由只做 busboy 解析与 HTTP 响应，解析复用 lib/multipartImage.ts）：
 *   1. 校验文件类型（EPUB / TXT）与大小（单本上限 50 MiB）
 *   2. EPUB 用 jszip 解析 container.xml → OPF 元数据（标题/作者/内嵌封面），失败不阻断上传（回退文件名）
 *   3. 写入存储节点系统目录 _books/<userId>/<uuid>.<ext>（storageSync 已把 _books 列为系统目录，不进网盘）
 *   4. 封面经 sharp 缩到宽 300 的 WebP 一并入库；封面体积小、不计网盘配额
 *   5. 先落库后复核网盘配额（与聊天图片/AI 对话图片口径一致），超限回滚行 + 删节点文件
 *
 * 删除书时行删除（进度级联）与节点文件删除是对偶操作（全部 best-effort）。
 */

/** 书籍在存储节点上的系统目录（storageSync 会排除） */
export const BOOK_DIR = '_books'

/** 单本文件上限：50 MiB（EPUB 一般 <20MB，超长 TXT 也够用） */
export const BOOK_MAX_BYTES = 50 * 1024 * 1024

/** 标题/作者入库上限（超长截断） */
const TITLE_MAX_LENGTH = 120

// ============================================================
// EPUB 元数据解析（纯字符串函数，供 verify:reader 覆盖）
// ============================================================

export interface EpubMetadata {
  title: string
  author: string
  /** 封面在 zip 内的完整路径（相对 OPF 目录解析后）；无封面时为 null */
  coverPath: string | null
}

/** 解码 XML 实体（OPF 元数据文本常用） */
export function decodeXmlEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** 取第一个 XML 元素文本（容忍属性与命名空间前缀，如 <dc:title id="t1">） */
function firstElementText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i')
  const match = xml.match(re)
  if (!match) return null
  const text = decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim()
  return text.length > 0 ? text : null
}

/** 从 META-INF/container.xml 提取 OPF 文件路径 */
export function extractOpfPathFromContainer(containerXml: string): string | null {
  const match = containerXml.match(/<rootfile[^>]*full-path="([^"]+)"/i)
    ?? containerXml.match(/full-path='([^']+)'/i)
  return match ? match[1] : null
}

/**
 * 解析 OPF 元数据（标题/作者/封面 zip 路径）。
 * 封面兼容两种约定：EPUB3 的 manifest item properties 含 cover-image；
 * EPUB2 的 <meta name="cover" content="<itemId>"> 指向 manifest item。
 */
export function parseOpfMetadata(opfXml: string, opfDir: string): EpubMetadata | null {
  const title = firstElementText(opfXml, 'dc:title')
  const author = firstElementText(opfXml, 'dc:creator')
  if (!title && !author) return null

  const items = new Map<string, { href: string; properties: string }>()
  const itemRe = /<item\s[^>]*>/gi
  for (const raw of opfXml.match(itemRe) ?? []) {
    const id = raw.match(/\sid="([^"]+)"/i)?.[1]
    const href = raw.match(/\shref="([^"]+)"/i)?.[1]
    if (!id || !href) continue
    items.set(id, { href, properties: raw.match(/\sproperties="([^"]*)"/i)?.[1] ?? '' })
  }

  let coverHref: string | null = null
  // EPUB3：properties 含 cover-image
  for (const item of items.values()) {
    if (item.properties.split(/\s+/).includes('cover-image')) {
      coverHref = item.href
      break
    }
  }
  // EPUB2：<meta name="cover" content="itemId">
  if (!coverHref) {
    const coverId = opfXml.match(/<meta\s[^>]*name="cover"[^>]*content="([^"]+)"/i)?.[1]
      ?? opfXml.match(/<meta\s[^>]*content="([^"]+)"[^>]*name="cover"/i)?.[1]
    if (coverId && items.has(coverId)) coverHref = items.get(coverId)!.href
  }

  return {
    title: (title ?? '').slice(0, TITLE_MAX_LENGTH),
    author: (author ?? '').slice(0, TITLE_MAX_LENGTH),
    coverPath: coverHref ? resolveZipPath(opfDir, coverHref) : null,
  }
}

/** 以 OPF 所在目录为基准解析 manifest href（处理 ../ 与百分号编码） */
export function resolveZipPath(baseDir: string, href: string): string {
  let decoded = href
  try {
    decoded = decodeURIComponent(href)
  } catch {
    // 保留原值（非法百分号序列）
  }
  const segments: string[] = []
  for (const part of `${baseDir ? `${baseDir}/` : ''}${decoded}`.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}

/** 用 jszip 读取 EPUB 的元数据与封面字节；任何解析失败都返回 null（不阻断上传） */
export async function readEpubMeta(
  buffer: Buffer,
): Promise<{ metadata: EpubMetadata; cover: Buffer | null } | null> {
  try {
    const zip = await JSZip.loadAsync(buffer)
    const containerFile = zip.file('META-INF/container.xml')
    if (!containerFile) return null
    const containerXml = await containerFile.async('string')
    const opfPath = extractOpfPathFromContainer(containerXml)
    if (!opfPath) return null
    const opfFile = zip.file(opfPath)
    if (!opfFile) return null
    const opfXml = await opfFile.async('string')
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : ''
    const metadata = parseOpfMetadata(opfXml, opfDir)
    if (!metadata) return null

    let cover: Buffer | null = null
    if (metadata.coverPath) {
      const coverFile = zip.file(metadata.coverPath)
      if (coverFile) {
        cover = await coverFile.async('nodebuffer').catch(() => null)
      }
    }
    return { metadata, cover }
  } catch {
    return null
  }
}

// ============================================================
// 书籍 CRUD 与进度
// ============================================================

function fallbackTitleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(epub|txt)$/i, '').trim()
  const cleaned = base.length > 0 ? base : '未命名书籍'
  return cleaned.slice(0, TITLE_MAX_LENGTH)
}

/** 按扩展名识别格式；无扩展名时 EPUB 用 ZIP 魔数（PK\x03\x04）兜底 */
function detectBookFormat(fileName: string, buffer: Buffer): 'epub' | 'txt' | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.txt')) return 'txt'
  if (buffer.length >= 4
    && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'epub'
  }
  return null
}

/** 仅供 verify:reader 覆盖格式识别（detectBookFormat 的导出别名） */
export const detectBookFormatForTest = detectBookFormat

export interface UploadBookParams {
  /** 上传者（文件归属与配额都记在其名下） */
  userId: number
  /** busboy 收齐的原始文件内容 */
  buffer: Buffer
  /** 原始文件名（用于识别格式与回退标题） */
  fileName: string
  /** 上传前的配额快照（剩余空间已用于 busboy 截断） */
  quota: DriveQuotaInfo
}

/**
 * 保存一本书：解析元数据 → 写节点 → 落库 → 配额复核（超限回滚）。
 * 调用前路由已完成：节点连接预检、配额预检、busboy 按 min(上限, 剩余) 截断。
 */
export async function uploadBook(params: UploadBookParams) {
  const { userId, buffer, fileName, quota } = params

  const format = detectBookFormat(fileName, buffer)
  if (!format) {
    throw new AppError('仅支持 EPUB 与 TXT 文件', 400)
  }

  let title = fallbackTitleFromFileName(fileName)
  let author = ''
  let coverBytes: Buffer | null = null

  if (format === 'epub') {
    // 元数据解析失败不阻断上传（书照样能读，标题回退文件名）
    const meta = await readEpubMeta(buffer).catch(() => null)
    if (meta) {
      if (meta.metadata.title) title = meta.metadata.title
      if (meta.metadata.author) author = meta.metadata.author
      if (meta.cover && meta.cover.length > 0) {
        try {
          coverBytes = await sharp(meta.cover)
            .resize({ width: 300, withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer()
        } catch {
          coverBytes = null // 封面处理失败不阻断上传
        }
      }
    }
  }

  const uuid = crypto.randomUUID()
  const storagePath = `${BOOK_DIR}/${userId}/${uuid}.${format}`
  let coverStoragePath: string | null = coverBytes ? `${BOOK_DIR}/${userId}/${uuid}-cover.webp` : null

  if (!isNodeConnected()) {
    throw new AppError('存储节点未接入，暂时无法上传书籍', 503)
  }
  try {
    const chunks = (async function* () { yield buffer })()
    await streamWriteBinary(storagePath, chunks, buffer.length)
  } catch (err) {
    console.error('[Reader] 写入存储节点失败:', err)
    throw new AppError('书籍保存失败，请稍后重试', 502)
  }
  if (coverBytes && coverStoragePath) {
    try {
      const coverChunks = (async function* () { yield coverBytes })()
      await streamWriteBinary(coverStoragePath, coverChunks, coverBytes.length)
    } catch (err) {
      // 封面写失败只影响封面展示：置空并尽力清理可能的半成品文件
      console.warn('[Reader] 封面写入存储节点失败:', err)
      await sendCommand({ type: 'delete_file', path: coverStoragePath }).catch(() => {})
      coverStoragePath = null
    }
  }

  let book
  try {
    book = await prisma.book.create({
      data: {
        userId,
        title,
        author,
        format,
        size: buffer.length,
        storagePath,
        coverPath: coverStoragePath,
      },
    })
  } catch (err) {
    // 落库失败：节点文件成为真孤儿，尽力删除
    await sendCommand({ type: 'delete_file', path: storagePath }).catch(() => {})
    if (coverStoragePath) {
      await sendCommand({ type: 'delete_file', path: coverStoragePath }).catch(() => {})
    }
    throw err
  }

  // 写后复核配额（先落库保证复核能看到本本书；与聊天图片口径一致）
  if (!quota.unlimited && quota.quota !== null) {
    const usedAfter = await getDriveUsage(userId)
    if (usedAfter > quota.quota) {
      await prisma.book.delete({ where: { id: book.id } }).catch(() => {})
      await deleteBookNodeFiles(storagePath, coverStoragePath)
      throw new AppError(`网盘空间不足（剩余 ${formatQuotaSize(quota.quota - (usedAfter - BigInt(buffer.length)))}）`, 413)
    }
  }

  return book
}

async function deleteBookNodeFiles(storagePath: string, coverPath: string | null): Promise<void> {
  if (!isNodeConnected()) return
  await sendCommand({ type: 'delete_file', path: storagePath }).catch(() => {})
  if (coverPath) {
    await sendCommand({ type: 'delete_file', path: coverPath }).catch(() => {})
  }
}

/** 读取书籍（仅属主可见；非本人/不存在返回 null，由路由 404 且不泄露存在性） */
export function getBookSource(userId: number, bookId: number) {
  return prisma.book.findFirst({
    where: { id: bookId, userId },
  })
}

/** 保存阅读进度（upsert；书必须属于本人） */
export async function saveBookProgress(
  userId: number,
  bookId: number,
  location: string,
  percent: number,
): Promise<void> {
  const book = await prisma.book.findFirst({
    where: { id: bookId, userId },
    select: { id: true },
  })
  if (!book) throw new AppError('书籍不存在', 404)

  await prisma.bookProgress.upsert({
    where: { bookId_userId: { bookId, userId } },
    update: { location, percent },
    create: { bookId, userId, location, percent },
  })
}

export interface BookListItem {
  id: number
  title: string
  author: string
  format: string
  size: number
  hasCover: boolean
  createdAt: string
  updatedAt: string
  progress: {
    location: string
    percent: number
    updatedAt: string
  } | null
}

/** 书架列表（合并本人进度，最近在读的排前面） */
export async function listBooks(userId: number): Promise<BookListItem[]> {
  const [books, progresses] = await Promise.all([
    prisma.book.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.bookProgress.findMany({ where: { userId } }),
  ])

  const progressByBook = new Map(progresses.map(p => [p.bookId, p]))
  const items = books.map((book) => {
    const progress = progressByBook.get(book.id) ?? null
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      format: book.format,
      size: book.size,
      hasCover: Boolean(book.coverPath),
      createdAt: book.createdAt.toISOString(),
      updatedAt: book.updatedAt.toISOString(),
      progress: progress
        ? { location: progress.location, percent: progress.percent, updatedAt: progress.updatedAt.toISOString() }
        : null,
    }
  })
  items.sort((a, b) => {
    const aTime = a.progress?.updatedAt ?? a.createdAt
    const bTime = b.progress?.updatedAt ?? b.createdAt
    return bTime < aTime ? -1 : bTime > aTime ? 1 : 0
  })
  return items
}

/** 删除书籍（行删除 + 进度级联 + 节点文件对偶清理） */
export async function deleteBook(userId: number, bookId: number): Promise<void> {
  const book = await prisma.book.findFirst({
    where: { id: bookId, userId },
    select: { id: true, storagePath: true, coverPath: true },
  })
  if (!book) throw new AppError('书籍不存在', 404)

  await prisma.book.delete({ where: { id: book.id } })
  await deleteBookNodeFiles(book.storagePath, book.coverPath)
}
