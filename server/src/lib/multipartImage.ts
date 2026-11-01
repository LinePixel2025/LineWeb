import type { Request } from 'express'
import busboy from 'busboy'
import { AppError } from '../middleware/errorHandler.js'

/**
 * multipart 单文件解析（聊天图片 / AI 对话图片 / 小说上传共用）
 *
 * 历史背景：本函数原本导出在 routes/chat.ts 内部，AI 对话路由直接 import 复用。
 * 聊天迁移到 neko XMPP 后旧聊天路由收窄为 410，因此把解析逻辑迁到 lib/ 下，
 * 避免 AI 对话模块依赖已退役的路由文件。
 */

export interface MultipartFile {
  buffer: Buffer
  mimeType: string
  /** 原始文件名（busboy 解析；defParamCharset utf8 保证中文文件名正确） */
  fileName: string
  /** busboy 的 fileSize 上限被触发（文件流已被截断） */
  limitHit: boolean
}

export interface MultipartFileOptions {
  /** 没有携带 file 字段时的报错文案（按调用方语境定制，如「请选择要上传的书籍」） */
  requiredMessage?: string
}

/**
 * 用 busboy 解析 multipart 中的单个文件字段（字段名必须为 `file`），收齐到内存。
 *
 * 触发 fileSize 上限时返回 limitHit=true，由调用方区分「配额不足」（QUOTA_EXCEEDED）
 * 与「单文件超限」。调用方自行做 MIME/扩展名校验（本函数不限制文件类型）。
 */
export function receiveMultipartFile(
  req: Request,
  fileSizeLimit: number,
  options: MultipartFileOptions = {},
): Promise<MultipartFile> {
  const requiredMessage = options.requiredMessage ?? '请选择要上传的文件'
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof busboy>
    try {
      bb = busboy({
        headers: req.headers,
        limits: { fileSize: fileSizeLimit, files: 1 },
        // 浏览器按 UTF-8 发送 filename；busboy 默认 latin1 会让中文文件名乱码
        defParamCharset: 'utf8',
      })
    } catch {
      reject(new AppError('请使用 multipart/form-data 上传文件', 400))
      return
    }

    // 预分配目标缓冲：content-length 是文件大小的上界（含极小的 multipart 头尾开销），
    // 一次性分配再逐块拷入，避免「chunks 数组 + Buffer.concat」造成 2 倍内存峰值
    // （50MiB 的 EPUB 原本在 512MB 容器里要占 100MB，很容易触发 OOM）。
    const contentLength = Number(req.headers['content-length'] ?? 0)
    const allocation = Number.isFinite(contentLength) && contentLength > 0
      ? Math.min(contentLength, fileSizeLimit + 64 * 1024)
      : 0
    let target: Buffer | null = allocation > 0 ? Buffer.allocUnsafe(allocation) : null
    let targetLength = 0
    /** 超出预分配容量后的溢出块（chunked 传输无法预知大小、或估算偏小） */
    const overflow: Buffer[] = []

    const appendChunk = (chunk: Buffer): void => {
      if (target) {
        if (targetLength + chunk.length <= target.length) {
          chunk.copy(target, targetLength)
          targetLength += chunk.length
          return
        }
        // 估算偏小：已写部分转为溢出块，之后一律追加
        if (targetLength > 0) overflow.push(target.subarray(0, targetLength))
        target = null
        targetLength = 0
      }
      overflow.push(chunk)
    }

    const collect = (): Buffer => target
      ? target.subarray(0, targetLength)
      : Buffer.concat(overflow)

    let fileSeen = false
    let limitHit = false
    let mimeType = ''
    let fileName = ''
    let settled = false

    const finish = (err: Error | null, result?: MultipartFile): void => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else if (result) resolve(result)
    }

    bb.on('file', (fieldname: string, stream: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => {
      // 只接受字段名 file；多余文件直接丢弃，避免阻塞解析
      if (fieldname !== 'file' || fileSeen) {
        stream.resume()
        return
      }
      fileSeen = true
      mimeType = info.mimeType
      fileName = info.filename
      stream.on('data', (chunk: Buffer) => appendChunk(chunk))
      stream.on('limit', () => { limitHit = true })
      stream.on('error', (err: Error) => finish(err))
    })
    bb.on('error', (err: Error) => finish(err))
    bb.on('close', () => {
      if (!fileSeen) {
        finish(new AppError(requiredMessage, 400))
        return
      }
      finish(null, { buffer: collect(), mimeType, fileName, limitHit })
    })
    req.on('aborted', () => finish(new AppError('上传已中断', 400)))
    req.pipe(bb)
  })
}

/**
 * 用 busboy 解析 multipart 中的单个图片字段（字段名必须为 `file`），收齐到内存。
 *
 * 原始上限只有 10 MiB，直接缓冲可接受；图片类调用方沿用此语义化入口，
 * 任意文件类型（如小说 EPUB/TXT）请改用 receiveMultipartFile。
 */
export function receiveMultipartImage(req: Request, fileSizeLimit: number): Promise<MultipartFile> {
  return receiveMultipartFile(req, fileSizeLimit, { requiredMessage: '请选择要发送的图片' })
}
