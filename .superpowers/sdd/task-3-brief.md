# Task 3: Avatar Routes (Self-Service)

## Files:
- Create: `server/src/routes/avatar.ts`
- Modify: `server/src/index.ts` (注册路由 + API 自描述)

## Interfaces:
- Consumes: `authenticate` from `../middleware/auth.js`, avatar service functions from `../services/avatarService.js`
- Produces: `POST /api/auth/avatar`, `GET /api/auth/avatar`, `GET /api/auth/avatar/:userId`, `DELETE /api/auth/avatar`

## Steps

### Step 1: 创建 avatar.ts 路由文件

```typescript
import { Router, Request, Response } from 'express'
import busboy from 'busboy'
import { authenticate } from '../middleware/auth.js'
import { uploadAvatar, getAvatarPathByUserId, getAvatarStream, deleteAvatar } from '../services/avatarService.js'
import { getErrorMessage, getErrorStatus } from '../lib/utils.js'

const router = Router()

router.use(authenticate)

router.post('/', async (req: Request, res: Response) => {
  const userId = req.user!.userId

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
    const avatarPath = await uploadAvatar(userId, fileBuffer, fileMimeType)
    res.json({ avatarPath })
  } catch (err: unknown) {
    const status = getErrorStatus(err)
    res.status(status).json({ error: getErrorMessage(err) })
  }
})

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

### Step 2: 注册路由到 index.ts

在 index.ts 中添加导入：
```typescript
import avatarRoutes from './routes/avatar.js'
```

在 `app.use('/api/auth', authRoutes)` 之后添加：
```typescript
app.use('/api/auth/avatar', avatarRoutes)
```

### Step 3: 更新 API 自描述端点

在 index.ts 的 `/api` 端点中，auth 部分添加：
```typescript
avatarUpload: { method: 'POST', path: '/api/auth/avatar', auth: true, description: '上传/更新头像 (multipart/form-data)' },
avatarGet: { method: 'GET', path: '/api/auth/avatar', auth: true, description: '获取当前用户头像' },
avatarGetById: { method: 'GET', path: '/api/auth/avatar/:userId', auth: true, description: '获取指定用户头像' },
avatarDelete: { method: 'DELETE', path: '/api/auth/avatar', auth: true, description: '删除头像' },
```

### Step 4: 验证

Run: `cd server && npx tsc --noEmit`
Expected: No errors

### Step 5: 提交

```bash
git add server/src/routes/avatar.ts server/src/index.ts
git commit -m "feat: add avatar routes (upload, get, delete)"
```
