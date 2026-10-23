import crypto from 'crypto'
import sharp from 'sharp'
import { AppError } from '../middleware/errorHandler.js'
import prisma from '../lib/prisma.js'
import { createImageMessage, type ChatMessageDto } from './chatService.js'
import { getDriveUsage, type DriveQuotaInfo } from './driveQuota.js'
import { isNodeConnected, sendCommand, streamWriteBinary } from './storageTunnel.js'

/**
 * 聊天图片消息服务
 *
 * 职责（路由只做 busboy 解析与 HTTP 响应）：
 *   1. 校验输入类型与大小
 *   2. sharp 归一化：EXIF 方向 → 最长边 2048 内等比缩放 → WebP(q82)
 *   3. 写入存储节点 _chat/<conversationId>/<uuid>.webp（不计入网盘文件表）
 *   4. 写后复核网盘配额（图片同样占用发送者的网盘空间）
 *   5. 落库为图片消息（content 空串、type='image'）
 *
 * 配额口径与网盘一致（见 driveQuota.getDriveUsage）：聊天图片的 imageSize 计入已用空间，
 * 撤回后 recalledAt 非空即释放。
 */

/** 单张原始图片上限：10 MiB */
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
/** 处理后（WebP）上限：4 MiB */
export const CHAT_IMAGE_MAX_PROCESSED_BYTES = 4 * 1024 * 1024
/** 允许的输入 MIME 类型 */
export const CHAT_IMAGE_MIME_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
/** 聊天图片在存储节点上的系统目录（storageSync 会排除） */
export const CHAT_IMAGE_DIR = '_chat'

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

interface ProcessedChatImage {
  buffer: Buffer
  width: number
  height: number
}

/** 统一转为 WebP：EXIF 方向校正 → 最长边 2048 内等比缩放 → WebP(q82) */
export async function processChatImage(input: Buffer): Promise<ProcessedChatImage> {
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

export interface UploadChatImageParams {
  /** 发送者（图片文件归属与配额都记在发送者名下） */
  userId: number
  conversationId: number
  /** busboy 收齐的原始文件内容 */
  buffer: Buffer
  /** 原始文件 MIME 类型 */
  mimeType: string
  /** 发送前的配额快照（剩余空间已用于 busboy 截断） */
  quota: DriveQuotaInfo
}

/**
 * 处理并保存一张聊天图片，返回落库后的消息 DTO。
 *
 * 调用前路由已完成：成员校验、direct 会话好友校验、配额预检（remaining > 0）。
 * 节点未连接时 503；处理失败/处理后超 4 MiB 时 400；写后复核超配额时 413（并清理节点文件）。
 */
export async function uploadChatImage(params: UploadChatImageParams): Promise<ChatMessageDto> {
  const { userId, conversationId, buffer, mimeType, quota } = params

  if (!isNodeConnected()) {
    throw new AppError('存储节点未接入，暂时无法发送图片', 503)
  }
  if (!CHAT_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new AppError('仅支持图片格式（JPEG/PNG/WebP/GIF）', 400)
  }

  const processed = await processChatImage(buffer)
  const imagePath = `${CHAT_IMAGE_DIR}/${conversationId}/${crypto.randomUUID()}.webp`

  try {
    const chunks = (async function* () { yield processed.buffer })()
    await streamWriteBinary(imagePath, chunks, processed.buffer.length)
  } catch (err) {
    console.error('[ChatImage] 写入存储节点失败:', err)
    throw new AppError('图片保存失败，请稍后重试', 502)
  }

  // === 写后复核配额（先落库，保证复核能看到本张图） ===
  // 并发上传可能同时看到「剩余空间充足」，或管理员中途下调了配额；
  // 因此先 createImageMessage 落库，再统计「含本图」的已用空间，超限则回滚
  // 消息行 + 节点文件并返回 413（与 drive.ts 写后复核并清理的口径一致）。
  const message = await createImageMessage(userId, conversationId, {
    imagePath,
    imageWidth: processed.width,
    imageHeight: processed.height,
    imageSize: processed.buffer.length,
  })

  if (!quota.unlimited && quota.quota !== null) {
    const usedAfter = await getDriveUsage(userId)
    if (usedAfter > quota.quota) {
      await prisma.message.delete({ where: { id: message.id } }).catch(() => {})
      if (isNodeConnected()) {
        await sendCommand({ type: 'delete_file', path: imagePath }).catch(() => {})
      }
      throw new ChatImageLimitError('网盘空间不足', 'QUOTA_EXCEEDED', {
        quota: quota.quota,
        used: usedAfter,
        remaining: 0n,
      })
    }
  }

  return message
}
