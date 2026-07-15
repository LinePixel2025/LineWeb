import sharp from 'sharp'
import { Readable } from 'stream'
import prisma from '../lib/prisma.js'
import { streamWrite, streamRead, sendCommand, isNodeConnected } from './storageTunnel.js'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 2 * 1024 * 1024
const AVATAR_DIR = '_avatars'

function getAvatarPath(userId: number): string {
  return `${AVATAR_DIR}/${userId}.webp`
}

async function processAvatar(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(256, 256, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer()
}

export async function processAvatarStream(
  inputStream: Readable,
  maxSizeBytes: number = 2 * 1024 * 1024
): Promise<{ buffer: Buffer; webpSize: number }> {
  const chunks: Buffer[] = []
  let totalSize = 0
  let resolved = false

  const transform = sharp()
    .resize(256, 256, { fit: 'cover', position: 'center' })
    .webp({ quality: 80 })

  return new Promise((resolve, reject) => {
    inputStream
      .pipe(transform)
      .on('data', (chunk: Buffer) => {
        totalSize += chunk.length
        if (totalSize > maxSizeBytes) {
          inputStream.destroy()
          transform.destroy()
          if (!resolved) {
            resolved = true
            reject(new Error('处理后图片过大'))
          }
          return
        }
        chunks.push(chunk)
      })
      .on('end', () => {
        if (resolved) return
        resolved = true
        const buffer = Buffer.concat(chunks)
        resolve({ buffer, webpSize: buffer.length })
      })
      .on('error', (err: Error) => {
        if (resolved) return
        resolved = true
        reject(err)
      })
  })
}

export async function uploadAvatar(userId: number, buffer: Buffer, mimeType: string): Promise<string> {
  if (!isNodeConnected()) {
    throw Object.assign(new Error('存储节点不可用'), { status: 503 })
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw Object.assign(new Error('仅支持图片格式 (JPEG/PNG/WebP/GIF)'), { status: 400 })
  }
  if (buffer.length > MAX_FILE_SIZE) {
    throw Object.assign(new Error('文件大小不能超过 2MB'), { status: 400 })
  }
  const processed = await processAvatar(buffer)
  const avatarPath = getAvatarPath(userId)
  const chunks = (async function* () { yield processed })()
  const resp = await streamWrite(avatarPath, chunks, processed.length)
  if (!resp.success) {
    throw Object.assign(new Error('头像上传失败'), { status: 500 })
  }
  await prisma.user.update({
    where: { id: userId },
    data: { avatarPath },
  })
  return avatarPath
}

export async function getAvatarPathByUserId(userId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarPath: true },
  })
  return user?.avatarPath || null
}

export async function getAvatarStream(avatarPath: string): Promise<AsyncGenerator<Buffer>> {
  if (!isNodeConnected()) {
    throw Object.assign(new Error('存储节点不可用'), { status: 503 })
  }
  return streamRead(avatarPath)
}

export async function adminSetAvatar(userId: number, buffer: Buffer, mimeType: string): Promise<string> {
  return uploadAvatar(userId, buffer, mimeType)
}

export async function deleteAvatar(userId: number): Promise<void> {
  const avatarPath = await getAvatarPathByUserId(userId)
  if (!avatarPath) return
  if (isNodeConnected()) {
    await sendCommand({ type: 'delete_file', path: avatarPath }).catch(() => {})
  }
  await prisma.user.update({
    where: { id: userId },
    data: { avatarPath: null },
  })
}
