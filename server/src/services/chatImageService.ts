import sharp from 'sharp'
import { AppError } from '../middleware/errorHandler.js'

/**
 * 聊天图片处理（自建聊天 2026-10 起：上传 / 处理在 routes/chatXmpp.ts 内完成）
 *
 * 本文件保留两个被 AI 对话模块（routes/aiChat.ts、aiChatImageService.ts）复用的导出：
 *   - processChatImage：sharp 归一化（EXIF rotate → ≤2048 → WebP q82）
 *   - ChatImageLimitError / chatImageLimitBody：413 响应体协议（与 drive.ts 对齐）
 * 聊天本体上传链路的配额按「上传」计费（ChatUpload.size，见 driveQuota.ts）。
 */

/** 单张原始图片上限：10 MiB（AI 对话附件沿用该口径） */
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
/** 处理后（WebP）上限：4 MiB */
export const CHAT_IMAGE_MAX_PROCESSED_BYTES = 4 * 1024 * 1024
/** 允许的输入 MIME 类型 */
export const CHAT_IMAGE_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

/** 上传/处理阶段的大小类错误 —— 由路由映射为 413（响应体对齐 drive.ts） */
export class ChatImageLimitError extends Error {
  readonly code: 'QUOTA_EXCEEDED' | 'IMAGE_TOO_LARGE'
  readonly quota: string | null
  readonly used: string | null
  readonly remaining: string | null

  constructor(
    message: string,
    code: 'QUOTA_EXCEEDED' | 'IMAGE_TOO_LARGE',
    detail?: { quota?: bigint; used?: bigint; remaining?: bigint },
  ) {
    super(message)
    this.name = 'ChatImageLimitError'
    this.code = code
    this.quota = detail?.quota !== undefined ? detail.quota.toString() : null
    this.used = detail?.used !== undefined ? detail.used.toString() : null
    this.remaining = detail?.remaining !== undefined ? detail.remaining.toString() : null
  }
}

/**
 * 413 响应体（与 drive.ts 的上传错误保持一致）：
 *   - QUOTA_EXCEEDED：附带 quota / used / remaining（字符串字节数）
 *   - IMAGE_TOO_LARGE：仅错误文案与 code
 */
export function chatImageLimitBody(err: ChatImageLimitError): Record<string, unknown> {
  return {
    error: err.message,
    code: err.code,
    ...(err.code === 'QUOTA_EXCEEDED'
      ? { quota: err.quota, used: err.used, remaining: err.remaining ?? '0' }
      : {}),
  }
}

/** 统一转为 WebP：EXIF 方向校正 → 最长边 2048 内等比缩放 → WebP(q82) */
export async function processChatImage(input: Buffer): Promise<{ buffer: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(input)
    .rotate() // 按 EXIF 方向校正，避免手机照片横竖颠倒
    .resize(2048, 2048, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true })
    .catch((err: unknown) => {
      console.warn('[ChatImage] 图片处理失败:', err)
      throw new AppError('图片处理失败，请换一张图片重试', 400)
    })

  if (data.length > CHAT_IMAGE_MAX_PROCESSED_BYTES) {
    throw new AppError('图片处理失败，请换一张图片重试', 400)
  }

  return { buffer: data, width: info.width, height: info.height }
}
