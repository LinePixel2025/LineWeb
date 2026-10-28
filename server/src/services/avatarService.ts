import sharp from 'sharp'
import { Readable } from 'stream'
import prisma from '../lib/prisma.js'
import { streamWriteBinary, streamRead, sendCommand, isNodeConnected } from './storageTunnel.js'
import {
  ensureAccount,
  fetchAvatar,
  isNekoChatEnabled,
  syncAvatarToNeko,
  toNekoId,
} from './nekoChat.js'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 2 * 1024 * 1024
const AVATAR_DIR = '_avatars'

function getAvatarPath(userId: number): string {
  return `${AVATAR_DIR}/${userId}.webp`
}

/**
 * 把 LineWeb 头像推给 neko（best-effort）。
 *
 * neko 的 `/internal/avatar` 要求账号已存在，因此先幂等同步账号；
 * 用户可能在还没打开过聊天时就上传头像，这一步不能省。
 */
async function pushAvatarToNeko(userId: number, buffer: Buffer | null): Promise<void> {
  if (!isNekoChatEnabled()) return
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    })
    if (!user) return
    await ensureAccount(user)
    await syncAvatarToNeko(userId, buffer)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    console.warn(`[avatarService] 同步聊天头像失败（user=${userId}）：${detail}`)
  }
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
  await streamWriteBinary(avatarPath, chunks, processed.length)
  await prisma.user.update({
    where: { id: userId },
    data: { avatarPath },
  })
  // 聊天头像以 neko 为准：上传后后台同步一份（失败只记日志，不拖慢头像上传）
  void pushAvatarToNeko(userId, processed)
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

/**
 * 补齐历史头像：老用户在这个功能上线前上传的头像只存在 LineWeb 存储节点。
 *
 * 聊天页 bootstrap 时调用一次（best-effort）：neko 侧没有头像才读取存储节点并同步，
 * 已有头像直接跳过，避免每次登录都重置版本号导致缓存失效。
 */
export async function ensureAvatarSyncedToNeko(user: {
  id: number
  username: string
}): Promise<void> {
  if (!isNekoChatEnabled() || !isNodeConnected()) return
  const avatarPath = await getAvatarPathByUserId(user.id)
  if (!avatarPath) return
  const existing = await fetchAvatar(toNekoId(user.id), {
    id: user.id,
    username: user.username,
  }).catch(() => null)
  if (existing) return
  const chunks: Buffer[] = []
  for await (const chunk of await getAvatarStream(avatarPath)) chunks.push(chunk)
  await pushAvatarToNeko(user.id, Buffer.concat(chunks))
}

export async function deleteAvatar(userId: number): Promise<void> {
  const avatarPath = await getAvatarPathByUserId(userId)
  if (avatarPath && isNodeConnected()) {
    await sendCommand({ type: 'delete_file', path: avatarPath }).catch(() => {})
  }
  await prisma.user.update({
    where: { id: userId },
    data: { avatarPath: null },
  })
  // 聊天侧头像一并清除（best-effort；即使 LineWeb 侧没有头像也清一次，
  // 避免历史遗留的 neko 头像继续显示）
  void pushAvatarToNeko(userId, null)
}
