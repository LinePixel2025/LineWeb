# Task 2: Avatar Service Layer

## Files:
- Create: `server/src/services/avatarService.ts`

## Interfaces:
- Consumes: `sendCommand`, `streamWrite`, `streamRead`, `isNodeConnected` from `../services/storageTunnel.js`
- Produces:
  - `uploadAvatar(userId: number, buffer: Buffer, mimeType: string): Promise<string>` — 返回 `_avatars/{userId}.webp`
  - `getAvatarPathByUserId(userId: number): Promise<string | null>` — 返回用户的 avatarPath
  - `getAvatarStream(avatarPath: string): Promise<AsyncGenerator<Buffer>>` — 返回可读流
  - `deleteAvatar(userId: number): Promise<void>` — 删除头像文件并清空 DB

## Steps

### Step 1: 创建 avatarService.ts

```typescript
import sharp from 'sharp'
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
```

### Step 2: TypeScript compile check

Run: `cd server && npx tsc --noEmit`
Expected: No errors

### Step 3: 提交

```bash
git add server/src/services/avatarService.ts
git commit -m "feat: add avatar service (upload, get, delete)"
```
