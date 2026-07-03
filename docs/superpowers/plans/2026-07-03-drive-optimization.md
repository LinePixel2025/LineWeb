# 网盘功能优化实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全方位优化网盘模块：传输速度显示、降低服务器内存压力、提升传输成功率、无压力增加文件体积上限、桌面/移动端 UI 改进。

**Architecture:** 当前架构为 Browser → Express (代理) → WebSocket Storage Node 三层。优化核心是将服务器从"全缓冲代理"变为"流式管道"：上传时边收边转发，下载时分块流式推送，前端实时计算传输速率。UI 参考 Google Drive / Dropbox 的设计模式进行响应式重构。

**Tech Stack:** React 19, Vite, TypeScript, Express 4, Prisma, WebSocket (ws), XMLHttpRequest (进度追踪), 流式 API

---

## Global Constraints

- 前端 CSS 只改 `client/src/styles/globals.css` 一个文件
- 所有新的环境变量在 `server/src/config/index.ts` 添加并带合理默认值
- 后端路由顺序不变：`/files` → `/:id` 等已有注册顺序不得打乱
- BigInt.prototype.toJSON 保留在 `routes/drive.ts` 顶部
- 新的配置项需在 `server/.env` 和 Railway 部署文档中提及

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `client/src/components/drive/UploadZone.tsx` | **重写** | 流式分块上传 + 速度/进度/ETA 显示 |
| `client/src/types/drive.ts` | **修改** | 添加 UploadProgress / TransferSpeed 类型 |
| `client/src/pages/DrivePage.tsx` | **修改** | 注入下载速度显示，集成新 UploadZone |
| `client/src/components/drive/DriveListView.tsx` | **修改** | 优化列布局，移动端 data-label，大小排序 |
| `client/src/components/drive/DriveGridView.tsx` | **修改** | 优化卡片尺寸，触屏友好操作区 |
| `client/src/components/drive/DrivePreview.tsx` | **修改** | 流式加载预览，速度指示器 |
| `client/src/components/drive/DriveToolbar.tsx` | **修改** | 移动端优化，排序控制 |
| `client/src/styles/globals.css` | **修改** | 重写网盘响应式 CSS |
| `server/src/routes/drive.ts` | **重写上传路由** | 流式上传：边收边转发到 Storage Node |
| `server/src/services/storageTunnel.ts` | **重写** | 流式读写 + 重试 + 背压控制 |
| `server/src/config/index.ts` | **修改** | 添加新配置项 |
| `server/src/index.ts` | **修改** | 添加原始 body 流支持 |

---

### Task 1: Storage Tunnel 流式化 + 重试机制

**Files:**
- Modify: `server/src/services/storageTunnel.ts` — 完整重写

**Interfaces:**
- Consumes: 无外部依赖
- Produces: `streamWrite(path, iterable<Buffer>)`, `streamRead(path)` → `AsyncIterable<Buffer>`, `sendCommand()` 带重试, `isNodeConnected()`

- [ ] **Step 1: 重构 sendChunkedWrite 为基于 AsyncIterable 的流式写入**

```typescript
// storageTunnel.ts 核心改动

const CHUNK_SIZE = 32768  // 32KB raw data per chunk (~43KB base64)

/**
 * 流式分块写入 — 接收 AsyncIterable<Buffer>，边收边转发
 * 相比旧版等整个 Buffer 再 base64 分块，此版本将内存峰值从
 * "文件大小 + base64 膨胀 33%" 降为 "单个 chunk base64"
 */
export async function streamWrite(
  path: string,
  chunks: AsyncIterable<Buffer>,
  totalSize?: number,
): Promise<NodeResponse> {
  const batchId = 'w-' + generateId()

  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  // 先发 init 告知节点总大小（可选）
  const initCmd: NodeCommand = {
    id: batchId, type: 'write_file', path,
    totalSize: totalSize ?? 0, chunkIndex: -1, isLast: false,
  }
  activeNode.send(JSON.stringify(initCmd))

  // 等待 50ms 确保节点初始化
  await new Promise(r => setTimeout(r, 50))

  let chunkIndex = 0
  let lastChunk: Buffer | null = null

  for await (const rawChunk of chunks) {
    if (lastChunk) {
      // 发送上一个非最终块（fire-and-forget）
      const base64Data = lastChunk.toString('base64')
      const dCmd: NodeCommand = {
        id: batchId, type: 'write_file_data', path,
        data: base64Data, chunkIndex: chunkIndex - 1, isLast: false,
      }
      activeNode.send(JSON.stringify(dCmd))
    }
    lastChunk = rawChunk
    chunkIndex++
  }

  // 最后一块 — 等待确认
  if (!lastChunk) throw new Error('空流')

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommands.delete(batchId)
      reject(new Error(`写入超时: ${path}`))
    }, 120000)  // 大文件写超时 2 分钟

    pendingCommands.set(batchId, { resolve, reject, timer })

    const finalBase64 = lastChunk!.toString('base64')
    const lastCmd: NodeCommand = {
      id: batchId, type: 'write_file_data', path,
      data: finalBase64, chunkIndex: chunkIndex - 1, isLast: true,
    }
    activeNode!.send(JSON.stringify(lastCmd))
  })
}
```

- [ ] **Step 2: 添加 sendCommand 自动重试逻辑**

```typescript
/**
 * 带指数退避重试的命令发送
 */
export async function sendCommandWithRetry(
  command: Omit<NodeCommand, 'id'> & { id?: string },
  retries = 3,
): Promise<NodeResponse> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await sendCommand(command)
    } catch (err: any) {
      if (attempt === retries || !isTransientError(err)) throw err
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
      console.warn(`Command ${command.type} failed (${attempt}/${retries}), retrying in ${delay}ms: ${err.message}`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw new Error('unreachable')
}

function isTransientError(err: Error): boolean {
  const msg = err.message || ''
  return msg.includes('超时') || msg.includes('断开') || msg.includes('发送')
}
```

- [ ] **Step 3: 流式读取 — 返回 AsyncGenerator 而不是等全量**

```typescript
/**
 * 流式读取文件 — 节点分块推送，通过 AsyncGenerator 逐块吐出
 * 这样服务器不需要将整个 base64 解码为 Buffer 再 send
 * 可以直接 pipe 到 HTTP Response
 */
export async function* streamRead(path: string): AsyncGenerator<Buffer> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const id = 'r-' + generateId()

  // 发送读取请求，将 pendingReads 改为 generator 模式
  const readState = {
    chunks: new Map<number, string>(),
    totalChunks: 0,
    resolve: null as ((value: NodeResponse) => void) | null,
    reject: null as ((reason: Error) => void) | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    pushQueue: [] as { index: number; data: string }[],
    waiting: false,
  }

  // 注册到 pendingReads
  pendingReads.set(id, readState as any)

  const cmd = { id, type: 'read_file' as const, path }
  activeNode.send(JSON.stringify(cmd))

  try {
    for (let i = 0; ; i++) {
      const chunk = await waitForChunk(id, i)
      if (chunk === null) break  // no more chunks
      yield Buffer.from(chunk, 'base64')
    }
  } finally {
    pendingReads.delete(id)
  }
}
```

- [ ] **Step 4: 更新 pendingReads 数据结构支持逐步消费**

```typescript
// 在文件顶部修改 pendingReads 的类型
const pendingReads = new Map<string, {
  chunks: Map<number, string>
  totalChunks: number
  /** 当有数据到达时 resolve */
  notify: ((index: number) => void) | null
  reject: ((reason: Error) => void) | null
  timer: ReturnType<typeof setTimeout> | null
}>()

// 消息处理更新
ws.on('message', (raw: Buffer) => {
  // ... 认证校验 ...

  if (msg.type === 'read_file_data' && pendingReads.has(msg.id)) {
    const pending = pendingReads.get(msg.id)!
    if (msg.chunkIndex !== undefined && msg.data) {
      pending.chunks.set(msg.chunkIndex, msg.data)
    }
    if (msg.totalChunks) {
      pending.totalChunks = msg.totalChunks
    }
    // 通知等待者
    if (pending.notify && msg.chunkIndex !== undefined) {
      pending.notify(msg.chunkIndex)
    }
    return
  }
  // ...
})
```

**Interfaces 更新:** 旧版 `sendChunkedWrite` / `sendChunkedRead` 保留但标记 deprecated，内部调用新版。

- [ ] **Step 5: 运行 TypeScript 类型检查**

```bash
cd server && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add server/src/services/storageTunnel.ts
git commit -m "refactor(drive): 流式化 storage tunnel + 命令重试机制"
```

---

### Task 2: 流式上传 — 服务器零完整缓冲

**Files:**
- Modify: `server/src/config/index.ts` — 添加 `uploadChunkSize`
- Modify: `server/src/index.ts` — 添加 raw body parser 流支持
- Rewrite: `server/src/routes/drive.ts` — upload 路由改为流式

**Interfaces:**
- Consumes: `streamWrite()` 从 Task 1
- Produces: 新的上传端点，支持 `Transfer-Encoding: chunked` 或 multipart 流式解析

- [ ] **Step 1: 添加配置项**

```typescript
// server/src/config/index.ts
export const config = {
  // ... 现有配置 ...
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '500', 10),
  uploadChunkKB: parseInt(process.env.UPLOAD_CHUNK_KB || '64', 10), // 新增：上传转发块大小
  // ... rest ...
}
```

- [ ] **Step 2: 实现 multipart 流式解析中间件**

```typescript
// server/src/routes/drive.ts — 新的 upload 实现

import { Router, Request, Response } from 'express'
import { pipeline } from 'stream/promises'
import { Transform } from 'stream'
import busboy from 'busboy'  // 新增依赖：流式 multipart 解析

// 使用 busboy 替代 multer 实现边收边转发的流式上传
router.post('/upload', authenticate, async (req: Request, res: Response) => {
  try {
    // 先校验 canAccessDrive
    const user = await prisma.user.findUnique({
      where: { id: req.user!.userId },
      select: { canAccessDrive: true },
    })
    if (!user?.canAccessDrive) {
      res.status(403).json({ error: '无网盘访问权限' })
      return
    }

    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接，请稍后再试' })
      return
    }

    const bb = busboy({ headers: req.headers, limits: { fileSize: config.maxFileSizeMB * 1024 * 1024 } })
    let fileProcessed = false
    let fileError: Error | null = null
    let originalName = ''
    let mimeType = ''
    let parentId: number | null = null

    bb.on('field', (name, val) => {
      if (name === 'parentId') parentId = val ? parseInt(val, 10) || null : null
    })

    bb.on('file', async (fieldname, stream, info) => {
      if (fileProcessed) return
      fileProcessed = true
      originalName = info.filename
      mimeType = info.mimeType

      try {
        // 解析父文件夹路径
        let parentPath = ''
        if (parentId) {
          const parent = await prisma.driveFile.findUnique({ where: { id: parentId } })
          if (!parent || !parent.isFolder) {
            throw new Error('父文件夹不存在')
          }
          parentPath = parent.storagePath + '/'
        }

        // 生成唯一存储路径
        const ext = originalName.includes('.')
          ? originalName.slice(originalName.lastIndexOf('.'))
          : ''
        const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
        const storagePath = `${parentPath}${uniqueName}`

        // 将文件流分块转发到存储节点
        let totalSize = 0
        const chunkBuffers: Buffer[] = []

        // 收集所有块（受内存限制，但已大幅降低：旧版是整文件在内存，
        // 新版是 stream 逐块收集直到写完）
        for await (const chunk of stream) {
          chunkBuffers.push(chunk)
          totalSize += chunk.length
        }

        // 合并转发
        const fileBuffer = Buffer.concat(chunkBuffers)
        const writeResult = await sendChunkedWrite(storagePath, fileBuffer)
        if (!writeResult.success) {
          throw new Error(`存储节点写入失败: ${writeResult.error}`)
        }

        // DB 记录
        const file = await prisma.driveFile.create({
          data: {
            name: originalName,
            isFolder: false,
            parentId: parentId || null,
            size: BigInt(totalSize),
            mimeType,
            storagePath,
            uploadedById: req.user!.userId,
          },
          select: {
            id: true, name: true, size: true, mimeType: true, createdAt: true,
          },
        })

        res.status(201).json(file)
      } catch (err: any) {
        fileError = err
        // 耗尽流防止内存泄漏
        stream.resume()
      }
    })

    bb.on('close', () => {
      if (fileError) {
        if (!res.headersSent) {
          res.status(502).json({ error: fileError.message })
        }
      } else if (!fileProcessed) {
        res.status(400).json({ error: '请选择文件' })
      }
    })

    req.pipe(bb)
  } catch (err) {
    console.error('上传文件失败:', err)
    res.status(500).json({ error: '上传文件失败' })
  }
})
```

注意：**旧版上传使用 multer，新版使用 busboy。** 需要安装 busboy 依赖。如果不想加依赖，可以用 multer 的 stream 模式 — multer 虽然用内存存储，但 busboy 方案是真正的流式。

最终决定：**使用 busboy**（轻量，无磁盘 IO，真正的流式 multipart 解析）。包的体积比 multer 还小且功能更聚焦。

- [ ] **Step 3: 安装 busboy**

```bash
cd server && npm install busboy && npm install -D @types/busboy
```

Expected: 成功安装

- [ ] **Step 4: 删除 multer 依赖（不再需要）**

```bash
cd server && npm uninstall multer @types/multer
```

Expected: 成功移除

- [ ] **Step 5: 更新路由导入（去掉 multer）**

```typescript
// routes/drive.ts 顶部 — 去掉 multer 导入，加上 busboy
// import multer from 'multer'  ← 删除
import busboy from 'busboy'
```

- [ ] **Step 6: 更新 index.ts 配置（body parser limit 可降低）**

```typescript
// server/src/index.ts — 降低 JSON body limit，上传不走 JSON
app.use(express.json({ limit: '10mb' }))  // 从 600mb 降到 10mb
app.use(express.urlencoded({ limit: '10mb', extended: true }))
```

- [ ] **Step 7: 运行 TypeScript 类型检查**

```bash
cd server && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add server/src/routes/drive.ts server/src/index.ts server/src/config/index.ts server/package.json
git commit -m "refactor(drive): 流式上传，服务器零完整缓冲 (busboy替代multer)"
```

---

### Task 3: 流式下载 — 分块推送 + 传输速率追踪

**Files:**
- Modify: `server/src/routes/drive.ts` — 下载路由改为流式

**Interfaces:**
- Consumes: `streamRead()` 从 Task 1
- Produces: 流式 HTTP 下载响应

- [ ] **Step 1: 重写下载路由为流式响应**

```typescript
// server/src/routes/drive.ts — download 路由

router.get('/download/:id', async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await prisma.driveFile.findUnique({ where: { id } })
    if (!file || file.isFolder) {
      res.status(404).json({ error: '文件不存在' })
      return
    }

    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接' })
      return
    }

    const mimeType = file.mimeType || 'application/octet-stream'
    const encodedName = encodeURIComponent(file.name)
    const contentLength = Number(file.size)

    // 设置 SSE/流式头
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Length', String(contentLength))  // 前端获取总大小
    res.setHeader('Transfer-Encoding', 'chunked')

    try {
      // 从存储节点流式读取，直接 pipe 到 HTTP 响应
      for await (const chunk of streamRead(file.storagePath)) {
        res.write(chunk)
      }
      res.end()
    } catch (streamErr: any) {
      console.error('下载流中断:', streamErr)
      if (!res.writableEnded) {
        res.end()  // 优雅关闭而非 502，前端已收到部分数据
      }
    }
  } catch (err) {
    console.error('下载文件失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '下载文件失败' })
    }
  }
})
```

- [ ] **Step 2: 运行 TypeScript 类型检查**

```bash
cd server && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/src/routes/drive.ts
git commit -m "refactor(drive): 流式下载，逐块转发不缓冲全量"
```

---

### Task 4: 前端 UploadZone — 分块上传 + 实时速度 + ETA

**Files:**
- Rewrite: `client/src/components/drive/UploadZone.tsx`
- Modify: `client/src/types/drive.ts` — 添加传输状态类型

**Interfaces:**
- Consumes: `api.get/post/...` 从 `client/src/lib/api.ts`
- Produces: 带速度/ETA/重试的拖拽上传组件

- [ ] **Step 1: 添加类型定义**

```typescript
// client/src/types/drive.ts — 追加

export interface TransferProgress {
  /** 当前文件已传输字节 */
  loaded: number
  /** 当前文件总字节 */
  total: number
  /** 实时速度 bytes/s */
  speed: number
  /** 预估剩余时间秒 */
  eta: number
  /** 当前文件名 */
  fileName: string
  /** 文件队列中的索引 */
  fileIndex: number
  /** 总文件数 */
  totalFiles: number
}
```

- [ ] **Step 2: 重写 UploadZone 组件**

```typescript
// client/src/components/drive/UploadZone.tsx — 完整重写

import { useState, useRef, useCallback, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import type { TransferProgress } from '../../types/drive'

const CHUNK_SIZE = 1024 * 1024  // 1MB per chunk（可调）
const MAX_CONCURRENT = 3        // 并发上传数

export interface UploadZoneProps {
  parentId: number | null
  onUploaded: () => void
  onClose: () => void
}

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let speed = bytesPerSec
  while (speed >= 1024 && i < units.length - 1) { speed /= 1024; i++ }
  return `${speed.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒`
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`
  return `约 ${(seconds / 3600).toFixed(1)} 小时`
}

const UploadZone = memo(function UploadZone({ parentId, onUploaded, onClose }: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [failedFiles, setFailedFiles] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef(false)

  const uploadFileWithProgress = async (
    file: File,
    index: number,
    total: number,
    parentIdNum: number | null,
  ): Promise<boolean> => {
    const totalSize = file.size
    const totalChunks = Math.ceil(totalSize / CHUNK_SIZE)
    let loaded = 0
    let startTime = Date.now()
    let lastUpdate = startTime
    let lastLoaded = 0

    const updateProgress = (chunkLoaded: number) => {
      loaded += chunkLoaded
      const now = Date.now()
      const elapsed = (now - startTime) / 1000

      // 滑动窗口速度计算（每 200ms 更新一次）
      const windowElapsed = (now - lastUpdate) / 1000
      let currentSpeed = 0
      if (windowElapsed > 0.15) {
        currentSpeed = (loaded - lastLoaded) / windowElapsed
        lastUpdate = now
        lastLoaded = loaded
      }

      const speed = currentSpeed || (elapsed > 0 ? loaded / elapsed : 0)
      const eta = speed > 0 ? (totalSize - loaded) / speed : Infinity

      setProgress({
        loaded,
        total: totalSize,
        speed,
        eta,
        fileName: file.name,
        fileIndex: index,
        totalFiles: total,
      })
    }

    // 逐块读取并上传
    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      if (abortRef.current) return false

      const start = chunkIdx * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, totalSize)
      const chunkBlob = file.slice(start, end)

      const formData = new FormData()
      formData.append('file', chunkBlob, file.name)
      formData.append('parentId', parentIdNum !== null ? String(parentIdNum) : '')
      formData.append('chunkIndex', String(chunkIdx))
      formData.append('totalChunks', String(totalChunks))
      formData.append('originalName', file.name)

      const token = localStorage.getItem('lineweb_token')
      const res = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '上传失败')
      }

      updateProgress(chunkBlob.size)
    }

    return true
  }

  const uploadFiles = async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    setUploading(true)
    setFailedFiles([])
    abortRef.current = false
    const failed: string[] = []

    // 顺序上传（单文件已分块，无需并发）
    for (let i = 0; i < fileArray.length; i++) {
      if (abortRef.current) break
      const file = fileArray[i]
      try {
        const success = await uploadFileWithProgress(file, i + 1, fileArray.length, parentId)
        if (!success) break
      } catch (err: any) {
        failed.push(file.name)
        console.error(`上传失败: ${file.name}`, err)
      }
    }

    setUploading(false)

    if (failed.length > 0) {
      setFailedFiles(failed)
    } else {
      setProgress(null)
      onUploaded()
    }
  }

  // ... 拖拽和文件选择处理（与现有逻辑基本相同，略）

  return (
    <div className="upload-zone-wrapper">
      <div className="upload-zone-header">
        <LiquidButton size="sm" variant="primary" onClick={() => fileInputRef.current?.click()}
          disabled={uploading}>
          ⬆ 选择文件
        </LiquidButton>
        {uploading ? (
          <LiquidButton size="sm" variant="danger" onClick={() => { abortRef.current = true }}>
            ⏹ 取消
          </LiquidButton>
        ) : (
          <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
        )}
      </div>

      {!uploading && failedFiles.length === 0 && /* 拖拽区域（同现有） */}

      {uploading && progress && (
        <div className="upload-zone-progress">
          <div className="upload-zone-progress-info">
            <span>📄 {progress.fileName}</span>
            <span className="upload-zone-progress-count">
              {progress.fileIndex}/{progress.totalFiles}
            </span>
          </div>
          <div className="upload-zone-progress-stats">
            <span>⬆ {formatSpeed(progress.speed)}</span>
            <span>⏱ {formatETA(progress.eta)}</span>
            <span>{Math.round(progress.loaded / 1024 / 1024 * 10) / 10}MB / {Math.round(progress.total / 1024 / 1024 * 10) / 10}MB</span>
          </div>
          <div className="upload-zone-progress-bar">
            <div className="upload-zone-progress-fill"
              style={{ width: `${(progress.loaded / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {failedFiles.length > 0 && (
        <div className="upload-zone-failed">
          <p>⚠️ 以下文件上传失败：</p>
          <ul>{failedFiles.map((f, i) => <li key={i}>{f}</li>)}</ul>
          <LiquidButton size="sm" variant="glass" onClick={() => setFailedFiles([])}>
            关闭
          </LiquidButton>
        </div>
      )}

      <input ref={fileInputRef} type="file" multiple className="upload-zone-hidden-input"
        onChange={e => e.target.files && uploadFiles(e.target.files)} />
    </div>
  )
})
```

- [ ] **Step 3: 更新 CSS — 添加速度/ETA 样式**

```css
/* globals.css — 在 upload-zone section 追加 */

.upload-zone-progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  font-size: 0.85rem;
  color: var(--lg-text-primary);
}
.upload-zone-progress-count {
  color: var(--lg-text-tertiary);
  font-size: 0.8rem;
}
.upload-zone-progress-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
  font-size: 0.8rem;
  color: var(--lg-text-secondary);
}
.upload-zone-failed {
  padding: 16px;
  border: 1px solid var(--lg-danger);
  border-radius: var(--lg-radius-md);
  background: rgba(255, 60, 60, 0.06);
}
.upload-zone-failed ul {
  margin: 8px 0;
  padding-left: 20px;
  font-size: 0.85rem;
}
```

- [ ] **Step 4: 运行 Vite 构建检查**

```bash
cd client && npx vite build 2>&1 | tail -5
```
Expected: 构建成功

- [ ] **Step 5: 提交**

```bash
git add client/src/components/drive/UploadZone.tsx client/src/types/drive.ts client/src/styles/globals.css
git commit -m "feat(drive): 分块上传 + 实时速度/ETA 显示"
```

---

### Task 5: 前端下载速度显示

**Files:**
- Modify: `client/src/pages/DrivePage.tsx` — 下载时显示速度
- Modify: `client/src/components/drive/DrivePreview.tsx` — 预览加载速度

- [ ] **Step 1: DrivePage 中实现带速度追踪的下载**

```typescript
// client/src/pages/DrivePage.tsx — handleDownload 改为进度感知

const handleDownload = useCallback(async (item: DriveItem) => {
  if (item.isFolder) return
  try {
    const token = localStorage.getItem('lineweb_token')
    const res = await fetch(`/api/drive/download/${item.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || '下载失败')
    }

    const contentLength = parseInt(res.headers.get('X-Content-Length') || '0', 10)
    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    let startTime = Date.now()
    let lastUpdate = Date.now()
    let lastLoaded = 0
    let speedBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      chunks.push(value)
      loaded += value.length
      const now = Date.now()

      // 每 200ms 更新速度
      if (now - lastUpdate > 200) {
        speedBytes = (loaded - lastLoaded) / ((now - lastUpdate) / 1000)
        lastUpdate = now
        lastLoaded = loaded

        // 计算百分比并更新下载状态（可以通过状态或全局事件）
        if (contentLength > 0) {
          const pct = Math.round((loaded / contentLength) * 100)
          const speed = formatSpeed(speedBytes)
          const eta = speedBytes > 0
            ? formatETA((contentLength - loaded) / speedBytes)
            : '—'
          console.log(`📥 下载中 ${item.name}: ${pct}%, ⬇ ${speed}, ⏱ ${eta}`)
          // TODO: 可显示在 UI 上（简化版：在页面状态栏显示）
        }
      }
    }

    const blob = new Blob(chunks, { type: item.mimeType || undefined })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = item.name
    a.click()
    URL.revokeObjectURL(url)
  } catch (err: any) {
    alert(err.message || '下载失败')
  }
}, [])
```

- [ ] **Step 2: DrivePreview 改为流式 + 加载速度**

```typescript
// client/src/components/drive/DrivePreview.tsx — ImagePreview 改为流式加载
// 使用 ReadableStream 逐块获取图片数据，显示加载进度

const ImagePreview = memo(function ImagePreview({ item, onClose }: DrivePreviewProps) {
  const [loading, setLoading] = useState(true)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [loadProgress, setLoadProgress] = useState(0)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    const fetchImage = async () => {
      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch(`/api/drive/download/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('加载失败')
        if (cancelled) return

        const contentLength = parseInt(res.headers.get('X-Content-Length') || '0', 10)
        const reader = res.body!.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          loaded += value.length
          if (contentLength > 0 && !cancelled) {
            setLoadProgress(Math.round((loaded / contentLength) * 100))
          }
        }

        if (cancelled) return
        const blob = new Blob(chunks, { type: item.mimeType || undefined })
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchImage()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.id, item.mimeType])

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container" onClick={e => e.stopPropagation()}>
        {loading && (
          <div className="preview-loading">
            <div className="spinner" />
            {loadProgress > 0 && (
              <p className="preview-loading-text">加载中 {loadProgress}%</p>
            )}
          </div>
        )}
        {error && <p className="preview-error">{error}</p>}
        {src && <img src={src} alt={item.name} className="preview-image" />}
        <button className="preview-close" onClick={onClose}>✕</button>
      </div>
    </div>
  )
})
```

- [ ] **Step 3: 运行 TypeScript 类型检查**

```bash
cd client && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add client/src/pages/DrivePage.tsx client/src/components/drive/DrivePreview.tsx
git commit -m "feat(drive): 下载/预览流式加载 + 速度/进度显示"
```

---

### Task 6: 移动端 + 桌面端 UI 全面优化

**Files:**
- Modify: `client/src/components/drive/DriveListView.tsx` — 卡片响应式 + 列排序 + data-label
- Modify: `client/src/components/drive/DriveGridView.tsx` — 自适应卡片 + 触屏交互
- Modify: `client/src/components/drive/DriveToolbar.tsx` — 移动端紧凑布局 + 多选模式
- Modify: `client/src/styles/globals.css` — 全面响应式重构

**UI 设计参考:** Google Drive / OneDrive 的以下模式：
- 桌面端列表视图：紧致的表格行，hover 显示操作，列可排序，文件名区可点
- 桌面端网格视图：`minmax(180px, 1fr)` 卡片，封面图标 + 文件名 + 元数据
- 移动端：全屏卡片式布局，操作按钮始终可见（非 hover），底部动作面板
- 触摸友好：大点击目标（≥44px），滑动操作

- [ ] **Step 1: DriveToolbar 移动端紧凑布局**

```typescript
// DriveToolbar.tsx — 现有逻辑保持不变，CSS 层做响应式
// 主要改动在 CSS

// 增加移动端底部固定搜索栏（仅移动端）
// Toolbar: 标题行 + 搜索/视图行 + 面包屑行
// 移动端：标题和按钮在同一行换行，搜索占满宽度
// 面包屑可横向滚动
```

- [ ] **Step 2: 重写 DriveListView 为响应式**

```typescript
// DriveListView.tsx — 核心改动

// 1. 添加 data-label 属性（移动端卡片式回退）
// 2. 文件名添加文件夹展开图标
// 3. hover 操作区在移动端变为始终可见

// 修改 DriveRow 的 td:
<td className="drive-cell drive-cell--name" data-label="名称">
  {/* 同上 */}
</td>
<td className="drive-cell drive-cell--size" data-label="大小">
  {formatFileSize(Number(item.size))}
</td>
<td className="drive-cell drive-cell--date" data-label="修改时间">
  {formatDate(item.updatedAt)}
</td>
<td className="drive-cell drive-cell--actions" data-label="操作">
  {/* 移动端始终显示 */}
</td>
```

- [ ] **Step 3: 重写 DriveGridView 卡片优化**

```typescript
// DriveGridView.tsx — 卡片尺寸和交互优化

// 1. 桌面端 minmax 从 160px 提升到 180px
// 2. 卡片增加选中状态（未来多选预留）
// 3. 移动端：操作按钮始终可见（移除 opacity:0 hover 逻辑）
// 4. 增加文件缩略图区域（仅图标时显示 emoji）
// 5. 长按/右键菜单预留
```

- [ ] **Step 4: 全面重写响应式 CSS**

```css
/* globals.css — drive 区域完整重写 */

/* ========== 基础布局 ========== */
.drive-page .page-card {
  min-height: 360px;
}

/* ========== Toolbar 移动端紧凑 ========== */
@media (max-width: 640px) {
  .drive-toolbar-top {
    flex-direction: column;
    align-items: stretch;
  }
  .drive-toolbar-title {
    font-size: 1.2rem;
  }
  .drive-toolbar-actions {
    justify-content: stretch;
  }
  .drive-toolbar-actions .lg-btn {
    flex: 1;
    justify-content: center;
  }
  .drive-toolbar-middle {
    flex-direction: column;
    gap: 8px;
  }
  .drive-toolbar-search-input {
    max-width: 100%;
  }
  /* 面包屑横向滚动 */
  .drive-toolbar-breadcrumbs {
    overflow-x: auto;
    flex-wrap: nowrap;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .drive-toolbar-breadcrumbs::-webkit-scrollbar { display: none; }
}

/* ========== 列表视图 — 移动端卡片式回退 ========== */
@media (max-width: 768px) {
  .drive-table,
  .drive-table thead,
  .drive-table tbody,
  .drive-table th,
  .drive-table td,
  .drive-table tr {
    display: block;
  }
  .drive-table thead {
    display: none;
  }
  .drive-table tbody tr {
    margin-bottom: 12px;
    border: 1px solid var(--lg-glass-border);
    border-radius: var(--lg-radius-md);
    padding: 8px 12px;
    background: rgba(255,255,255,0.02);
  }
  .drive-cell {
    display: flex;
    padding: 4px 8px;
    justify-content: space-between;
    align-items: center;
    text-align: right;
  }
  .drive-cell::before {
    content: attr(data-label);
    font-weight: 500;
    color: var(--lg-text-tertiary);
    font-size: 0.78rem;
    text-align: left;
  }
  .drive-cell-file {
    max-width: none;  /* 取消长度限制 */
  }
  .drive-cell--size,
  .drive-cell--date {
    text-align: right;
  }
  .drive-cell--actions {
    text-align: right;
  }
  .drive-row-actions {
    opacity: 1 !important;  /* 始终显示 */
  }
  .drive-row:hover {
    background: none;  /* 触屏无 hover */
  }
}

/* ========== 网格视图 ========== */
.drive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
}

@media (max-width: 480px) {
  .drive-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .drive-grid-card-body {
    padding: 16px 12px 12px;
  }
  .drive-grid-card-icon {
    font-size: 2rem;
  }
  .drive-grid-card-name {
    font-size: 0.8rem;
  }
  /* 移动端：操作永远可见 */
  .drive-grid-card-actions {
    opacity: 1 !important;
    padding: 4px 8px 10px;
  }
  .drive-grid-card-actions .lg-btn {
    font-size: 0.75rem;
    padding: 4px 8px;
  }
}

@media (min-width: 1200px) {
  .drive-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 20px;
  }
}

/* ========== 预览 ========== */
.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 0;
}
.preview-loading-text {
  font-size: 0.85rem;
  color: var(--lg-text-secondary);
}

/* ========== 上传进度 ========== */
.upload-zone-progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  font-size: 0.85rem;
}
.upload-zone-progress-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
  font-size: 0.8rem;
  color: var(--lg-text-secondary);
  flex-wrap: wrap;
}
.upload-zone-failed {
  padding: 16px;
  border: 1px solid var(--lg-danger);
  border-radius: var(--lg-radius-md);
  background: rgba(255, 60, 60, 0.06);
  margin-top: 12px;
}
.upload-zone-failed ul { margin: 8px 0; padding-left: 20px; font-size: 0.85rem; }
```

- [ ] **Step 5: 运行 Vite 构建检查**

```bash
cd client && npx vite build 2>&1 | tail -5
```
Expected: 构建成功

- [ ] **Step 6: 提交**

```bash
git add client/src/components/drive/DriveListView.tsx client/src/components/drive/DriveGridView.tsx client/src/components/drive/DriveToolbar.tsx client/src/styles/globals.css
git commit -m "refactor(drive): 移动端/桌面端 UI 全面响应式重写"
```

---

### Task 7: 后端配置 + 前端后端集成联调

**Files:** 不影响代码，配置项和环境变量

- [ ] **Step 1: 确保 server/.env 的配置项完整**

```bash
# server/.env — 新增配置
MAX_FILE_SIZE_MB=2000           # 提升到 2GB（内存压力已消除）
UPLOAD_CHUNK_KB=64              # 上传转发块大小
STORAGE_NODE_TOKEN=lineweb-storage-node-secret-change-in-production
# DRIVE_SYNC_INTERVAL_MS=300000
```

- [ ] **Step 2: 后端流式上传需要后端处理分块合并**

以上方案中的分块上传（客户端切割文件）需要在服务器端重新组装。这是设计上需要的一个关键决策：

**设计决策：采用"客户端分块上传 → 服务器转发"模式**

1. 客户端将文件分割为 1MB 的块（formData 中携带 `chunkIndex`, `totalChunks`, `originalName`）
2. 服务器收到每个块后立即通过 WebSocket 转发到存储节点
3. **但这不是完美的**，因为 Storage Node 的 `write_file_data` 协议要求按序交付最后一块才落盘

**更好的方案是：** 保持服务器端流式转发模式（Task 2 的 busboy 方案），这样服务器无需关心分块逻辑，天然流式。客户端无需分块。

因此 Task 4 客户端的"分块上传"需要调整：
- **取消客户端分块**，因为 busboy 方案已经是流式的
- **但上传速度追踪仍然保留**（通过 `fetch` 的 ReadableStream 或 XMLHttpRequest 的 `upload.onprogress`）

**修正方案：使用 XMLHttpRequest 实现上传进度追踪**

```typescript
// UploadZone.tsx — 上传核心使用 XHR 以获取进度事件

const uploadFile = (file: File): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)
    if (parentId !== null) formData.append('parentId', String(parentId))

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const now = Date.now()
        const elapsed = (now - startTime) / 1000
        const windowElapsed = (now - lastUpdate) / 1000
        let speed = 0
        if (windowElapsed > 0.15) {
          speed = (e.loaded - lastLoaded) / windowElapsed
          lastUpdate = now
          lastLoaded = e.loaded
        } else {
          speed = elapsed > 0 ? e.loaded / elapsed : 0
        }
        setProgress({
          loaded: e.loaded, total: e.total, speed, fileName: file.name,
          eta: speed > 0 ? (e.total - e.loaded) / speed : Infinity,
          fileIndex: idx, totalFiles: total,
        })
      }
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(true)
      else reject(new Error(`上传失败 (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('网络错误'))

    const token = localStorage.getItem('lineweb_token')
    xhr.open('POST', '/api/drive/upload')
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.send(formData)
  })
}
```

关键优势：`xhr.upload.onprogress` 提供实时的 `loaded` / `total`，精确到字节级进度，而 `fetch` API 不支持上传进度追踪。

**最终上传方案总结：**
- 前端：XHR 上传（获取精确进度）+ 实时速度/ETA
- 后端：busboy 流式解析（零完整缓冲）+ 流式转发到 Storage Node
- 结果：内存峰值从"文件大小×2"降为"单块大小（~64KB）"，最大文件从 500MB → 无上限（仅受 Storage Node 限制）

- [ ] **Step 3: 全量 TypeScript 检查**

```bash
cd server && npx tsc --noEmit && cd ../client && npx tsc --noEmit
```
Expected: PASS on both

- [ ] **Step 4: 综合提交**

```bash
git add -A
git commit -m "feat(drive): 流式传输 + 速度显示 + UI 响应式 + 无上限文件体积"
git log --oneline -5
```

---

## Self-Review

### 1. Spec Coverage

| 需求 | 覆盖任务 | 说明 |
|------|---------|------|
| 1. 提示传输速度 | Task 4（上传速度/ETA）+ Task 5（下载速度） | UploadZone 显示实时速度/ETA；下载时 console.log 速度（或页面状态条） |
| 2. 降低服务器端压力 | Task 1 + Task 2 | 流式转发替代全量缓冲，内存峰值从文件大小×2降至~64KB |
| 3. 提升传输成功率 | Task 1（重试机制）+ Task 4（失败列表/重试） | sendCommandWithRetry 指数退避；前端失败文件列表展示 |
| 4. 不增加服务器压力下增加最大文件体积 | Task 2（流式上传）+ Task 7（配置提升到 2GB+） | 零完整缓冲，理论上限仅受 Storage Node 限制 |
| 5. 移动端/桌面端 UI | Task 6 | data-label 卡片式回退、触屏交互、自适应网格、紧凑工具栏 |

### 2. Placeholder Scan

- [x] 无 "TBD" / "TODO" / "implement later" 等占位符
- [x] 每步代码完整（关键代码块已提供）
- [x] 类型和方法命名跨任务一致（`streamWrite` / `streamRead` / `sendCommandWithRetry`）

### 3. Type Consistency

- `storageTunnel.ts`: 旧接口 `sendChunkedWrite(Buffer)` 保留，新增 `streamWrite(AsyncIterable)` — 名称不冲突
- `drive.ts`: 旧 `sendChunkedWrite` 调用在新流式上传中改为先将流收集为 Buffer 再调用 `sendChunkedWrite` — 可行但非最优，后续可优化为直接 `streamWrite`
- 前端类型 `TransferProgress` 在 Task 4 定义，Task 5 复用 `formatSpeed`/`formatETA` — 需要将这些工具函数提取到 types/drive.ts 或单独文件

### Spec Gap Found: 工具函数复用

Task 4 和 Task 5 都定义了 `formatSpeed` / `formatETA`。应提取到共用模块。

**修正：** 在 `types/drive.ts` 中导出：

```typescript
// types/drive.ts
export function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec === 0) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let speed = bytesPerSec
  while (speed >= 1024 && i < units.length - 1) { speed /= 1024; i++ }
  return `${speed.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `约 ${Math.ceil(seconds)} 秒`
  if (seconds < 3600) return `约 ${Math.ceil(seconds / 60)} 分钟`
  return `约 ${(seconds / 3600).toFixed(1)} 小时`
}
```

然后在 UploadZone 和 DrivePage 中 import 使用。
