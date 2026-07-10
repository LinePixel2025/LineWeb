# User Avatar 功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为用户添加头像功能，存储在存储节点 `_avatars/` 隐藏路径，不显示在网盘界面

**Architecture:** Sharp 服务端处理图片（resize 256×256, 转 webp），通过 storageTunnel 直接读写存储节点，不走 DriveFile 记录。User 表新增 `avatarPath` 字段。Drive API 无影响，storageSync 跳过 `_avatars/` 路径。

**Tech Stack:** Express, Prisma, Sharp, busboy, React 19

## Global Constraints

- 头像路径统一 `_avatars/{userId}.webp`
- 最大 2MB，仅允许 image/jpeg, image/png, image/webp, image/gif
- Sharp 处理：256×256 cover, quality 80, 转 webp
- 所有 `res.json()` 后必须 `return`
- 新文件创建在已有目录结构下

---

### Task 1: 数据库 Schema + 依赖安装

**Files:**
- Modify: `server/prisma/schema.prisma` (User 模型新增 avatarPath)
- Modify: `server/package.json` (添加 sharp 依赖)
- Execute: `cd server && npm install && npx prisma db push`

**Interfaces:**
- Produces: `User.avatarPath: String?` — 存储节点路径（如 `_avatars/1.webp`）

- [ ] **Step 1: 修改 Prisma Schema**

User 模型新增 `avatarPath` 字段：

```prisma
model User {
  id               Int       @id @default(autoincrement())
  username         String    @unique
  email            String    @unique
  password         String
  role             String    @default("user")
  settings         String?
  canAccessDrive   Boolean   @default(false)
  avatarPath       String?   @map("avatar_path") // 存储节点路径，如 _avatars/1.webp
  tokenValidAfter  DateTime  @default(now()) @map("token_valid_after")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")
  posts            Post[]
  comments         Comment[]
  driveFiles       DriveFile[]
  apiKeys          ApiKey[]

  @@map("users")
}
```

- [ ] **Step 2: 安装 sharp 依赖**

Run:
```bash
cd server
npm install sharp
npm install -D @types/sharp
```

- [ ] **Step 3: 同步数据库**

Run:
```bash
cd server
npx prisma db push
```

Expected output: `Your database is now in sync with your Prisma schema.`

---

### Task 2: Avatar Service 层

**Files:**
- Create: `server/src/services/avatarService.ts`

**Interfaces:**
- Consumes: `sendCommand`, `streamWrite`, `streamRead`, `isNodeConnected` from `storageTunnel.ts`
- Produces:
  - `uploadAvatar(userId: number, buffer: Buffer): Promise<string>` — 返回 `_avatars/{userId}.webp`
  - `getAvatarPath(userId: number): Promise<string | null>` — 返回用户的 avatarPath
  - `deleteAvatar(userId: number): Promise<void>` — 删除头像文件并清空 avatarPath
  - `adminSetAvatar(userId: number, buffer: Buffer): Promise<string>` — 管理员设置任意用户头像

- [ ] **Step 1: 安装 sharp 类型声明**

Run:
```bash
cd server
npm install -D @types/sharp
```

- [ ] **Step 2: 创建 avatarService.ts**

```typescript
import sharp from 'sharp'
import prisma from '../lib/prisma.js'
import { streamWrite, streamRead, sendCommand, isNodeConnected } from './storageTunnel.js'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 2 * 1024 * 1024 // 2MB
const AVATAR_DIR = '_avatars'

function getAvatarPath(userId: number): string {
  return `${AVATAR_DIR}/${userId}.webp`
}

/**
 * 校验图片并处理（resize + 转 webp）
 */
async function processAvatar(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(256, 256, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer()
}

/**
 * 上传/更新头像
 */
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

  // 写入存储节点
  const chunks = (async function* () {
    yield processed
  })()
  const resp = await streamWrite(avatarPath, chunks, processed.length)
  if (!resp.success) {
    throw Object.assign(new Error('头像上传失败'), { status: 500 })
  }

  // 更新 DB
  await prisma.user.update({
    where: { id: userId },
    data: { avatarPath },
  })

  return avatarPath
}

/**
 * 获取用户的 avatarPath
 */
export async function getAvatarPathByUserId(userId: number): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarPath: true },
  })
  return user?.avatarPath || null
}

/**
 * 流式读取头像
 */
export async function getAvatarStream(avatarPath: string): Promise<AsyncGenerator<Buffer>> {
  if (!isNodeConnected()) {
    throw Object.assign(new Error('存储节点不可用'), { status: 503 })
  }
  return streamRead(avatarPath)
}

/**
 * 删除头像
 */
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

/**
 * 管理员设置任意用户头像
 */
export async function adminSetAvatar(userId: number, buffer: Buffer, mimeType: string): Promise<string> {
  return uploadAvatar(userId, buffer, mimeType)
}
```

---

### Task 3: Avatar 路由（自服务）

**Files:**
- Create: `server/src/routes/avatar.ts`
- Modify: `server/src/index.ts` (注册路由 + API 自描述)

**Interfaces:**
- Consumes: `authenticate` from `middleware/auth.ts`, avatar service functions
- Produces: `GET /api/auth/avatar`, `GET /api/auth/avatar/:userId`, `POST /api/auth/avatar`, `DELETE /api/auth/avatar`

- [ ] **Step 1: 创建 avatar.ts 路由文件**

```typescript
import { Router, Request, Response } from 'express'
import busboy from 'busboy'
import { authenticate } from '../middleware/auth.js'
import { uploadAvatar, getAvatarPathByUserId, getAvatarStream, deleteAvatar } from '../services/avatarService.js'
import { getErrorMessage, getErrorStatus } from '../lib/utils.js'

const router = Router()

// 所有路由需要登录
router.use(authenticate)

// POST /api/auth/avatar — 上传/更新当前用户头像
router.post('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId

  let fileBuffer: Buffer | null = null
  let fileMimeType = ''

  try {
    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers: req.headers })

      bb.on('file', (_fieldname: string, stream: NodeJS.ReadableStream, info: { filename: string; encoding: string; mimeType: string }) => {
        fileMimeType = info.mimeType
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => {
          fileBuffer = Buffer.concat(chunks)
        })
      })

      bb.on('finish', () => resolve())
      bb.on('error', (err: Error) => reject(err))
      req.pipe(bb)
    })
  } catch (err) {
    res.status(400).json({ error: '文件解析失败' })
    return
  }

  if (!fileBuffer) {
    res.status(400).json({ error: '请提供头像文件' })
    return
  }

  try {
    const avatarPath = await uploadAvatar(userId, fileBuffer, fileMimeType)
    res.json({ avatarPath })
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
  }
})

// GET /api/auth/avatar — 获取当前用户头像
router.get('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId

  try {
    const avatarPath = await getAvatarPathByUserId(userId)
    if (!avatarPath) {
      res.status(204).end()
      return
    }

    const stream = await getAvatarStream(avatarPath)
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=86400')

    for await (const chunk of stream) {
      res.write(chunk)
    }
    res.end()
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
  }
})

// GET /api/auth/avatar/:userId — 获取指定用户头像
router.get('/:userId', async (req: Request, res: Response) => {
  const targetId = parseInt(req.params.userId, 10)
  if (isNaN(targetId) || targetId < 1) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  try {
    const avatarPath = await getAvatarPathByUserId(targetId)
    if (!avatarPath) {
      res.status(204).end()
      return
    }

    const stream = await getAvatarStream(avatarPath)
    res.setHeader('Content-Type', 'image/webp')
    res.setHeader('Cache-Control', 'public, max-age=86400')

    for await (const chunk of stream) {
      res.write(chunk)
    }
    res.end()
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
  }
})

// DELETE /api/auth/avatar — 删除当前用户头像
router.delete('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId

  try {
    await deleteAvatar(userId)
    res.json({ message: '头像已删除' })
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
  }
})

export default router
```

- [ ] **Step 2: 注册路由到 index.ts**

在 index.ts 中添加导入和路由（在 `app.use('/api/auth', authRoutes)` 之后）：

```typescript
// 在文件顶部添加导入（按字母顺序排放）
import avatarRoutes from './routes/avatar.js'

// 在 app.use('/api/auth', authRoutes) 之后添加
app.use('/api/auth/avatar', avatarRoutes)
```

注意：Express 按注册顺序匹配路由。`/api/auth/avatar` 请求会首先匹配到 `app.use('/api/auth', authRoutes)`，但 authRoutes 中没有 `/avatar` 路由，所以请求会 fall through 到下一个匹配的中间件。`app.use('/api/auth/avatar', avatarRoutes)` 会捕获并处理该请求。另外，index.ts 中的全局 `authenticate` 中间件已在 `/api` 层级对非公开路径执行认证，因此无需担心认证问题。

- [ ] **Step 3: 更新 API 自描述端点**

在 index.ts 的 `/api` 端点中，在 auth 部分添加 avatar 端点：

```typescript
auth: {
  // ... existing ...
  avatarUpload: { method: 'POST', path: '/api/auth/avatar', auth: true, description: '上传/更新头像 (multipart/form-data)' },
  avatarGet: { method: 'GET', path: '/api/auth/avatar', auth: true, description: '获取当前用户头像' },
  avatarGetById: { method: 'GET', path: '/api/auth/avatar/:userId', auth: true, description: '获取指定用户头像' },
  avatarDelete: { method: 'DELETE', path: '/api/auth/avatar', auth: true, description: '删除头像' },
},
```

---

### Task 4: 管理员头像端点

**Files:**
- Modify: `server/src/routes/users.ts` (新增 PUT /:id/avatar 端点)

**Interfaces:**
- Consumes: `adminSetAvatar`, `getAvatarPathByUserId`, `deleteAvatar` from avatarService
- Produces: `PUT /api/users/:id/avatar` 管理员设置头像

- [ ] **Step 1: 添加 adminSetAvatar 导入和端点**

在 `users.ts` 中导入：

```typescript
import busboy from 'busboy'
import { adminSetAvatar, getAvatarPathByUserId, deleteAvatar } from '../services/avatarService.js'
```

在删除用户路由 `delete('/:id')` 之前添加：

```typescript
// 管理员设置用户头像
router.put('/:id/avatar', async (req: Request, res: Response) => {
  const id = parseId(req.params.id)
  if (id === null) {
    res.status(400).json({ error: '无效的用户 ID' })
    return
  }

  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) {
    res.status(404).json({ error: '用户不存在' })
    return
  }

  let fileBuffer: Buffer | null = null
  let fileMimeType = ''

  try {
    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers: req.headers })
      bb.on('file', (_fieldname, stream, info) => {
        fileMimeType = info.mimeType
        const chunks: Buffer[] = []
        stream.on('data', (chunk: Buffer) => chunks.push(chunk))
        stream.on('end', () => { fileBuffer = Buffer.concat(chunks) })
      })
      bb.on('finish', () => resolve())
      bb.on('error', (err: Error) => reject(err))
      req.pipe(bb)
    })
  } catch {
    res.status(400).json({ error: '文件解析失败' })
    return
  }

  if (!fileBuffer) {
    res.status(400).json({ error: '请提供头像文件' })
    return
  }

  try {
    const avatarPath = await adminSetAvatar(id, fileBuffer, fileMimeType)
    res.json({ avatarPath })
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
  }
})
```

需要额外导入 `getErrorStatus` 和 `getErrorMessage`：

```typescript
import { parsePagination, parseId, getErrorMessage, getErrorStatus } from '../lib/utils.js'
```

以及更新 API 自描述：

```typescript
// 在 users 部分添加
avatarSet: { method: 'PUT', path: '/api/users/:id/avatar', auth: 'admin', description: '管理员设置用户头像 (multipart/form-data)' },
```

---

### Task 5: 存储同步排除 _avatars/

**Files:**
- Modify: `server/src/services/storageSync.ts` (跳过 `_avatars/` 路径)

- [ ] **Step 1: 在 syncDriveFiles 中过滤 `_avatars/` 路径**

在 `syncDriveFiles` 函数中，获取 `nodePaths` 后立即过滤：

在 `report.scanned = nodePaths.length` 之后添加：

```typescript
// 排除隐藏的系统目录（如 _avatars/）
const filteredPaths = nodePaths.filter(p => !p.startsWith('_avatars/'))
report.scanned = filteredPaths.length
```

然后修改后续的 nodePathSet 和迭代：

```typescript
const nodePathSet = new Set(filteredPaths)

// 修复缺失记录
for (const nodePath of filteredPaths) {
  // ... 原有逻辑不变
}
```

确保 `report.scanned` 反映的是过滤后的数量。

---

### Task 6: 前端 UserAvatar 组件

**Files:**
- Create: `client/src/components/UserAvatar.tsx`

- [ ] **Step 1: 创建 UserAvatar 组件**

```tsx
import { useState, useEffect } from 'react'

interface UserAvatarProps {
  userId: number
  username: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const SIZE_MAP = { sm: 24, md: 32, lg: 48, xl: 80 } as const

function getInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  // 取第一个字符（中文或英文字母）
  const first = trimmed.charAt(0)
  // 如果第一个字符不是英文字母，直接用
  if (/[a-zA-Z]/.test(first)) {
    return first.toUpperCase()
  }
  return first
}

function getColor(userId: number): string {
  const hue = (userId * 137.508) % 360
  return `hsl(${hue}, 50%, 50%)`
}

export default function UserAvatar({ userId, username, size = 'md' }: UserAvatarProps) {
  const px = SIZE_MAP[size]
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setImgSrc(null)
    setFailed(false)
    const controller = new AbortController()

    fetch(`/api/auth/avatar/${userId}`, {
      headers: { 'Authorization': `Bearer ${localStorage.getItem('lineweb_token')}` },
      signal: controller.signal,
    })
      .then(res => {
        if (res.ok && res.status !== 204) {
          return res.blob().then(blob => {
            setImgSrc(URL.createObjectURL(blob))
          })
        }
        setFailed(true)
      })
      .catch(() => setFailed(true))

    return () => controller.abort()
  }, [userId])

  useEffect(() => {
    return () => {
      if (imgSrc) URL.revokeObjectURL(imgSrc)
    }
  }, [imgSrc])

  if (imgSrc && !failed) {
    return (
      <img
        src={imgSrc}
        alt={username}
        style={{
          width: px,
          height: px,
          borderRadius: '50%',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  }

  // Default avatar with initials
  return (
    <div
      style={{
        width: px,
        height: px,
        borderRadius: '50%',
        background: getColor(userId),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        fontSize: px * 0.4,
        fontWeight: 600,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      {getInitials(username)}
    </div>
  )
}
```

---

### Task 7: 前端集成 — 评论、导航栏、个人设置页、管理后台

**Files:**
- Modify: `client/src/components/comments/CommentSection.tsx` (评论者头像)
- Modify: `client/src/components/Navbar.tsx` (当前用户头像)
- Modify: `client/src/pages/ProfilePage.tsx` (头像上传)
- Modify: `client/src/pages/admin/UserAdminPage.tsx` (用户列表头像)

- [ ] **Step 1: 评论 card 添加 UserAvatar**

在 `CommentSection.tsx` 中导入 UserAvatar：

```tsx
import UserAvatar from '../UserAvatar'
```

在 `CommentCard` 组件的 comment-meta div 中，在作者名前添加：

```tsx
<div className="comment-meta">
  <UserAvatar userId={comment.author.id} username={comment.author.username} size="sm" />
  <span className="comment-author">{comment.author.username}</span>
  <span className="comment-time">{new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
</div>
```

同样在 reply-item 的 comment-meta 中添加：

```tsx
<div className="comment-meta">
  <UserAvatar userId={reply.author.id} username={reply.author.username} size="sm" />
  <span className="comment-author">{reply.author.username}</span>
  <span className="comment-time">{new Date(reply.createdAt).toLocaleString('zh-CN')}</span>
</div>
```

- [ ] **Step 2: 导航栏添加用户头像**

在 `Navbar.tsx` 中导入 UserAvatar：

```tsx
import UserAvatar from './UserAvatar'
```

将用户名的 Link 替换为：

```tsx
<Link
  to="/profile"
  className={`navbar-link ${location.pathname === '/profile' ? 'active' : ''}`}
  onClick={closeMenu}
  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
>
  <UserAvatar userId={user.id} username={user.username} size="sm" />
  {user.username}
</Link>
```

- [ ] **Step 3: 个人设置页添加头像上传**

在 `ProfilePage.tsx` 中导入：

```tsx
import UserAvatar from '../components/UserAvatar'
import api from '../lib/api'
```

在资料卡片 (profile-card) 的"角色"显示之后、"退出登录"按钮之前添加头像区域：

```tsx
<div style={{ marginBottom: '22px', display: 'flex', alignItems: 'center', gap: '16px' }}>
  <UserAvatar userId={user!.id} username={user!.username} size="xl" />
  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
    <label className="liquid-btn glass sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 16px' }}>
      上传头像
      <input
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return
          if (file.size > 2 * 1024 * 1024) {
            alert('文件大小不能超过 2MB')
            return
          }
          const formData = new FormData()
          formData.append('avatar', file)
          try {
            await fetch('/api/auth/avatar', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${localStorage.getItem('lineweb_token')}` },
              body: formData,
            })
            // 强制刷新组件
            window.location.reload()
          } catch {
            alert('上传失败')
          }
        }}
      />
    </label>
    <LiquidButton size="sm" variant="ghost" onClick={async () => {
      try {
        await api.delete('/auth/avatar')
        window.location.reload()
      } catch {
        alert('删除失败')
      }
    }}>
      移除头像
    </LiquidButton>
  </div>
</div>
```

- [ ] **Step 4: 管理后台用户列表添加头像**

在 `UserAdminPage.tsx` 中导入：

```tsx
import UserAvatar from '../../components/UserAvatar'
```

在用户列表的 `<td className="admin-cell admin-cell--title" data-label="用户名">` 中，将用户名显示改为：

```tsx
<td className="admin-cell admin-cell--title" data-label="用户名">
  <div className="admin-post-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <UserAvatar userId={u.id} username={u.username} size="sm" />
    {u.username}
  </div>
</td>
```

---

## 验证步骤

完成所有任务后：

1. **后端**：`cd server && npx tsc --noEmit` — TypeScript 编译无错误
2. **前端**：`cd client && npx tsc --noEmit` — TypeScript 编译无错误
3. **API 测试**：`curl -X POST http://localhost:3001/api/auth/avatar -H "Authorization: Bearer $TOKEN" -F "avatar=@test.jpg"` — 返回 200
4. **头像读取**：`curl http://localhost:3001/api/auth/avatar -H "Authorization: Bearer $TOKEN"` — 返回 200 图片流
5. **网盘验证**：`curl http://localhost:3001/api/drive/files -H "Authorization: Bearer $TOKEN"` — 不包含 `_avatars` 相关的文件
