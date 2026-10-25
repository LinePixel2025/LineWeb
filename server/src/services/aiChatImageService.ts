import crypto from 'crypto'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { AppError } from '../middleware/errorHandler.js'
import { isNodeConnected, sendCommand, streamReadBinary, streamWriteBinary } from './storageTunnel.js'
import {
  CHAT_IMAGE_MAX_BYTES,
  CHAT_IMAGE_MAX_PROCESSED_BYTES,
  CHAT_IMAGE_MIME_TYPES,
  ChatImageLimitError,
  processChatImage,
} from './chatImageService.js'
import { getDriveUsage, type DriveQuotaInfo } from './driveQuota.js'

/**
 * AI 对话图片附件服务
 *
 * 职责（路由只做 busboy 解析与 HTTP 响应，解析逻辑复用 chat.ts 的 receiveMultipartImage）：
 *   1. 校验输入类型与大小（与聊天图片同一套上限：原始 10 MiB、WebP 4 MiB）
 *   2. sharp 归一化（复用 chatImageService.processChatImage）：EXIF 方向 → 最长边 2048 → WebP(q82)
 *   3. 写入存储节点 _ai/<userId>/<uuid>.webp（storageSync 已把 _ai 列为系统目录，不进网盘）
 *   4. 写后复核网盘配额（AI 对话图片与聊天图片口径一致，计入发送者的已用空间）
 *   5. 落库为待发送附件（messageId = null），随消息发送时认领（claimAiChatImages）
 *
 * 孤儿附件自愈：每次上传前顺带清理本人超过 24 小时仍未随消息发送的附件。
 */

/** AI 对话图片在存储节点上的系统目录（storageSync 会排除） */
export const AI_IMAGE_DIR = '_ai'

/** 单张原始图片上限：10 MiB（与聊天图片一致） */
export const AI_IMAGE_MAX_BYTES = CHAT_IMAGE_MAX_BYTES

/** 处理后（WebP）上限：4 MiB（与聊天图片一致） */
export const AI_IMAGE_MAX_PROCESSED_BYTES = CHAT_IMAGE_MAX_PROCESSED_BYTES

/** 允许的输入 MIME 类型（与聊天图片一致） */
export const AI_IMAGE_MIME_TYPES = CHAT_IMAGE_MIME_TYPES

/** 每条消息最多携带的图片数 */
export const AI_IMAGE_MAX_PER_MESSAGE = 4

/** 待发送附件的保留时长：超过后视为孤儿，上传新附件时顺带清理 */
const ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** 读取图片字节并转 base64（供模型调用的 data URL 使用） */
export async function readAiImageBase64(imagePath: string): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of streamReadBinary(imagePath)) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('base64')
}

export interface UploadAiChatImageParams {
  /** 上传者（图片文件归属与配额都记在其名下） */
  userId: number
  /** busboy 收齐的原始文件内容 */
  buffer: Buffer
  /** 原始文件 MIME 类型 */
  mimeType: string
  /** 上传前的配额快照（剩余空间已用于 busboy 截断） */
  quota: DriveQuotaInfo
}

/**
 * 处理并保存一张 AI 对话图片附件，返回落库后的附件行。
 *
 * 调用前路由已完成：配额预检（remaining > 0）与 busboy 截断。
 * 节点未连接时 503；处理失败/处理后超 4 MiB 时 400；写后复核超配额时 413（并清理节点文件）。
 */
export async function uploadAiChatImage(params: UploadAiChatImageParams) {
  const { userId, buffer, mimeType, quota } = params

  if (!isNodeConnected()) {
    throw new AppError('存储节点未接入，暂时无法上传图片', 503)
  }
  if (!AI_IMAGE_MIME_TYPES.includes(mimeType)) {
    throw new AppError('仅支持图片格式（JPEG/PNG/WebP/GIF）', 400)
  }

  // 自愈：清理本人超过 24h 仍未发送的附件（行 + 节点文件）
  await cleanupStaleOrphans(userId)

  const processed = await processChatImage(buffer)
  const imagePath = `${AI_IMAGE_DIR}/${userId}/${crypto.randomUUID()}.webp`

  try {
    const chunks = (async function* () { yield processed.buffer })()
    await streamWriteBinary(imagePath, chunks, processed.buffer.length)
  } catch (err) {
    console.error('[AiChatImage] 写入存储节点失败:', err)
    throw new AppError('图片保存失败，请稍后重试', 502)
  }

  // 先落库（保证写后复核能看到本张图），超限再回滚 —— 与聊天图片的口径一致
  let image
  try {
    image = await prisma.aiChatImage.create({
      data: {
        userId,
        imagePath,
        width: processed.width,
        height: processed.height,
        size: processed.buffer.length,
      },
    })
  } catch (err) {
    // 落库失败：节点文件成为真孤儿，尽力删除
    await sendCommand({ type: 'delete_file', path: imagePath }).catch(() => {})
    throw err
  }

  if (!quota.unlimited && quota.quota !== null) {
    const usedAfter = await getDriveUsage(userId)
    if (usedAfter > quota.quota) {
      await prisma.aiChatImage.delete({ where: { id: image.id } }).catch(() => {})
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

  return image
}

/** 删除本人超过 24h 仍未随消息发送的附件（行 + 节点文件，全部 best-effort） */
async function cleanupStaleOrphans(userId: number): Promise<void> {
  try {
    const stale = await prisma.aiChatImage.findMany({
      where: {
        userId,
        messageId: null,
        createdAt: { lt: new Date(Date.now() - ORPHAN_MAX_AGE_MS) },
      },
      select: { id: true, imagePath: true },
    })
    if (stale.length === 0) return

    await prisma.aiChatImage.deleteMany({
      where: { id: { in: stale.map(i => i.id) } },
    })
    if (isNodeConnected()) {
      for (const item of stale) {
        await sendCommand({ type: 'delete_file', path: item.imagePath }).catch(() => {})
      }
    }
  } catch (err) {
    // 自愈逻辑失败不阻断上传
    console.warn('[AiChatImage] 清理孤儿附件失败:', err)
  }
}

/**
 * 删除一个未发送的附件（撤销用）。
 * 已随消息发送（messageId 非空）的附件随消息/会话删除，不走这里。
 */
export async function deleteAiChatImage(userId: number, imageId: number): Promise<void> {
  const image = await prisma.aiChatImage.findFirst({
    where: { id: imageId, userId },
  })
  if (!image) throw new AppError('图片不存在', 404)
  if (image.messageId !== null) {
    throw new AppError('图片已随消息发送，无法单独删除', 400)
  }

  await prisma.aiChatImage.delete({ where: { id: image.id } })
  if (isNodeConnected()) {
    await sendCommand({ type: 'delete_file', path: image.imagePath }).catch(() => {})
  }
}

/**
 * 读取图片附件（仅属主可见；非本人/不存在返回 null，由路由 404 且不泄露存在性）
 */
export async function getAiChatImageSource(userId: number, imageId: number) {
  return prisma.aiChatImage.findFirst({
    where: { id: imageId, userId },
  })
}

/**
 * 在事务内把附件认领到消息上（updateMany 原子限定「本人 + 未认领」）。
 * 返回实际认领数，调用方比对 imageIds.length 不一致时回滚事务。
 */
export function claimAiChatImages(
  tx: Prisma.TransactionClient,
  userId: number,
  imageIds: number[],
  messageId: number,
): Promise<number> {
  return tx.aiChatImage.updateMany({
    where: { id: { in: imageIds }, userId, messageId: null },
    data: { messageId },
  }).then(r => r.count)
}

/** 收集会话内全部图片的节点路径（删除会话前调用，级联删除后逐个清理节点文件） */
export async function collectConversationImagePaths(conversationId: number): Promise<string[]> {
  const images = await prisma.aiChatImage.findMany({
    where: { message: { conversationId } },
    select: { imagePath: true },
  })
  return images.map(i => i.imagePath)
}
