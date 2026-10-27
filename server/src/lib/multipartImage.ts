import type { Request } from 'express'
import busboy from 'busboy'
import { AppError } from '../middleware/errorHandler.js'

/**
 * multipart 单图片解析（聊天图片 / AI 对话图片共用）
 *
 * 历史背景：本函数原本导出在 routes/chat.ts 内部，AI 对话路由直接 import 复用。
 * 聊天迁移到 neko XMPP 后旧聊天路由收窄为 410，因此把解析逻辑迁到 lib/ 下，
 * 避免 AI 对话模块依赖已退役的路由文件。
 */

export interface MultipartImageFile {
  buffer: Buffer
  mimeType: string
  /** busboy 的 fileSize 上限被触发（文件流已被截断） */
  limitHit: boolean
}

/**
 * 用 busboy 解析 multipart 中的单个图片字段（字段名必须为 `file`），收齐到内存。
 *
 * 原始上限只有 10 MiB，直接缓冲可接受；触发 fileSize 上限时返回 limitHit=true，
 * 由调用方区分「配额不足」（QUOTA_EXCEEDED）与「单张超限」（IMAGE_TOO_LARGE）。
 */
export function receiveMultipartImage(req: Request, fileSizeLimit: number): Promise<MultipartImageFile> {
  return new Promise((resolve, reject) => {
    let bb: ReturnType<typeof busboy>
    try {
      bb = busboy({ headers: req.headers, limits: { fileSize: fileSizeLimit, files: 1 } })
    } catch {
      reject(new AppError('请使用 multipart/form-data 上传图片', 400))
      return
    }

    const chunks: Buffer[] = []
    let fileSeen = false
    let limitHit = false
    let mimeType = ''
    let settled = false

    const finish = (err: Error | null, result?: MultipartImageFile): void => {
      if (settled) return
      settled = true
      if (err) reject(err)
      else if (result) resolve(result)
    }

    bb.on('file', (fieldname: string, stream: NodeJS.ReadableStream, info: { mimeType: string }) => {
      // 只接受字段名 file；多余文件直接丢弃，避免阻塞解析
      if (fieldname !== 'file' || fileSeen) {
        stream.resume()
        return
      }
      fileSeen = true
      mimeType = info.mimeType
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('limit', () => { limitHit = true })
      stream.on('error', (err: Error) => finish(err))
    })
    bb.on('error', (err: Error) => finish(err))
    bb.on('close', () => {
      if (!fileSeen) {
        finish(new AppError('请选择要发送的图片', 400))
        return
      }
      finish(null, { buffer: Buffer.concat(chunks), mimeType, limitHit })
    })
    req.on('aborted', () => finish(new AppError('图片上传已中断', 400)))
    req.pipe(bb)
  })
}
