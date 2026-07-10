# Task 4: Admin Avatar Endpoint

## Files:
- Modify: `server/src/routes/users.ts` (新增 PUT /:id/avatar 端点)
- Modify: `server/src/index.ts` (更新 API 自描述)

## Interfaces:
- Consumes: `adminSetAvatar` from `../services/avatarService.js`, `getErrorStatus`, `getErrorMessage` from `../lib/utils.js`
- Produces: `PUT /api/users/:id/avatar` 管理员为任意用户设置头像

## Steps

### Step 1: 在 users.ts 中添加头像端点

在文件顶部添加导入（与现有 busboy 导入合并）：
```typescript
import busboy from 'busboy'
```

新增头像相关的导入：
```typescript
import { adminSetAvatar } from '../services/avatarService.js'
import { parsePagination, parseId, getErrorMessage, getErrorStatus } from '../lib/utils.js'
```

注意：`parsePagination` 和 `parseId` 已导入，只需要添加 `getErrorMessage` 和 `getErrorStatus`。

在 `delete('/:id')` 路由之前添加 PUT `/:id/avatar` 路由：

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

### Step 2: 更新 API 自描述

在 index.ts 的 users 部分添加：
```typescript
avatarSet: { method: 'PUT', path: '/api/users/:id/avatar', auth: 'admin', description: '管理员设置用户头像 (multipart/form-data)' },
```

### Step 3: 验证

Run: `cd server && npx tsc --noEmit`
Expected: No errors

### Step 4: 提交

```bash
git add server/src/routes/users.ts server/src/index.ts
git commit -m "feat: add admin avatar set endpoint"
```
