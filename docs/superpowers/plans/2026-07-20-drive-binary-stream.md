# 网盘二进制流式传输 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将网盘上传/下载从 JSON+base64 串行分块改为 WebSocket 二进制帧流式传输，消除 RTT 串行等待和 base64 膨胀开销，下载速度提升 3-4 倍，上传提升约 25%。

**Architecture:** 在 `storageTunnel.ts` 新增 `PendingStream` 多路复用类 + `streamReadBinary`/`streamWriteBinary` 函数，WebSocket message handler 增加二进制帧路由。Python 节点新增 `handle_read_file_stream`/`handle_write_file_stream`/`handle_stream_eof`。下载路由增加 HTTP Range 支持。协议格式：[4B streamId big-endian][原始数据]。

**Tech Stack:** TypeScript (tsx/Node) + Python 3 (websockets + hashlib) + Express 4 + Nginx

## Global Constraints

- 所有文件（不限大小）统一走新协议，旧 `streamRead`/`streamWrite` 保留但不被路由调用
- 下载分块 2MB（`STREAM_CHUNK_KB=2048`），上传缓冲 2MB 一批发送
- WebSocket buffer 背压保持 1MB high water mark
- streamId 为 u32 大端，递增生成，溢出回绕冲突跳过
- SHA-256 校验双向：下载时存储节点计算，上传时服务端+节点双向比对
- 不修改前端代码（除硬编码文件大小文案）
- 保留旧函数不动，仅路由切换调用

---

### Task 1: 添加配置项与类型定义

**Files:**
- Modify: `server/src/config/index.ts:30-31`
- Modify: `server/src/services/storageTunnel.ts:8-31`

**Interfaces:**
- Produces: `config.streamChunkKB` (number, default 2048)
- Produces: `NodeCommand` type 新增 `'read_file_stream' | 'write_file_stream' | 'stream_eof'`
- Produces: `NodeCommand` 新增可选字段 `streamId?: number`, `length?: number`, `sha256?: string`, `bytesWritten?: number`

- [ ] **Step 1: 修改 config/index.ts 添加 streamChunkKB**

在 `config/index.ts:31` 的 `downloadChunkKB` 之后添加：

```typescript
streamChunkKB: parseInt(process.env.STREAM_CHUNK_KB || '2048', 10),
```

- [ ] **Step 2: 修改 storageTunnel.ts 的 NodeCommand 类型**

将 `NodeCommand` 的 `type` 联合类型从：

```typescript
type: 'write_file' | 'write_file_data' | 'write_file_end'
     | 'read_file'
     | 'delete_file' | 'mkdir'
     | 'move' | 'stat' | 'list_dir' | 'rename'
```

改为：

```typescript
type: 'write_file' | 'write_file_data' | 'write_file_end'
     | 'read_file' | 'read_file_stream' | 'write_file_stream' | 'stream_eof'
     | 'delete_file' | 'mkdir'
     | 'move' | 'stat' | 'list_dir' | 'rename'
```

在 `NodeCommand` 接口中添加可选字段：

```typescript
interface NodeCommand {
  id: string
  type: 'write_file' | 'write_file_data' | 'write_file_end'
       | 'read_file' | 'read_file_stream' | 'write_file_stream' | 'stream_eof'
       | 'delete_file' | 'mkdir'
       | 'move' | 'stat' | 'list_dir' | 'rename'
  path: string
  data?: string
  newPath?: string
  newName?: string
  totalSize?: number
  isLast?: boolean
  offset?: number
  length?: number
  streamId?: number
  sha256?: string
  bytesWritten?: number
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```bash
git add server/src/config/index.ts server/src/services/storageTunnel.ts
git commit -m "feat: 添加 streamChunkKB 配置和二进制流命令类型"
```

---

### Task 2: PendingStream 多路复用类 + WebSocket 二进制帧路由

**Files:**
- Modify: `server/src/services/storageTunnel.ts` (在 generateId 函数之后插入新代码，在 initStorageTunnel 的 ws.on('message') 中修改)

**Interfaces:**
- Produces: `streamRegistry: Map<number, PendingStream>` (模块级)
- Produces: `nextStreamId(): number` (模块级)
- Produces: `class PendingStream` (exported)
- Produces: 修改后的 `ws.on('message')` 处理二进制帧

- [ ] **Step 1: 添加 streamRegistry 和 nextStreamId**

在 `generateId()` 函数之后，`sendCommandWithRetry` 之前插入：

```typescript
const streamRegistry = new Map<number, PendingStream>()

let _nextStreamId = 0
function nextStreamId(): number {
  // 递增，溢出回绕，跳过 0（0 保留给控制帧），跳过冲突
  do {
    _nextStreamId = (_nextStreamId + 1) & 0xFFFFFFFF
  } while (_nextStreamId === 0 || streamRegistry.has(_nextStreamId))
  return _nextStreamId
}
```

- [ ] **Step 2: 添加 PendingStream 类**

在 `nextStreamId()` 之后插入：

```typescript
class PendingStream {
  private chunks: Buffer[] = []
  private done = false
  private error: Error | null = null
  private endData: NodeResponse | null = null
  private pushResolve: (() => void) | null = null
  private checksumResolve: ((value: void) => void) | null = null
  private checksumReject: ((err: Error) => void) | null = null

  constructor(readonly streamId: number) {}

  push(data: Buffer): void {
    this.chunks.push(data)
    this.pushResolve?.()
    this.pushResolve = null
  }

  end(resp: NodeResponse): void {
    this.endData = resp
    this.done = true
    this.pushResolve?.()
    this.pushResolve = null
    if (resp.success && resp.sha256) {
      this.checksumResolve?.()
    } else if (!resp.success) {
      this.error = new Error(resp.error || '流传输失败')
      this.checksumReject?.(this.error)
    } else {
      this.checksumResolve?.()
    }
  }

  fail(err: Error): void {
    this.error = err
    this.done = true
    this.pushResolve?.()
    this.pushResolve = null
    this.checksumReject?.(err)
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    let i = 0
    while (!this.done || i < this.chunks.length) {
      if (i < this.chunks.length) {
        yield this.chunks[i++]
      } else if (!this.done) {
        await new Promise<void>(r => { this.pushResolve = r })
      } else {
        break
      }
    }
    if (this.error) throw this.error
  }

  awaitChecksum(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.checksumResolve = resolve
      this.checksumReject = reject
    })
  }
}
```

- [ ] **Step 3: 修改 WebSocket message handler 支持二进制帧**

在 `initStorageTunnel` 的 `ws.on('message', (raw: Buffer) => {` 处，将原有处理改为先判断 `isBinary`。但 `ws` 库的 message 事件回调格式需要改为带第二个参数的模式。实际上 `ws` v8+ 支持 `ws.on('message', (data, isBinary) => ...)`。

将 `ws.on('message', (raw: Buffer) => {` 改为：

```typescript
ws.on('message', (raw: Buffer, isBinary: boolean) => {
  try {
    // 二进制帧：路由到 PendingStream
    if (isBinary) {
      if (raw.length < 4) return
      const streamId = raw.readUInt32BE(0)
      const payload = raw.subarray(4)
      const stream = streamRegistry.get(streamId)
      if (stream) {
        stream.push(payload)
      }
      return
    }

    const msg = JSON.parse(raw.toString())

    if (!authenticated) {
      // ... 认证逻辑不变 ...
      return
    }

    // 处理 stream_end 控制帧
    if (msg.type === 'stream_end') {
      const stream = streamRegistry.get(msg.streamId)
      if (stream) {
        const response: NodeResponse = msg
        stream.end(response)
      }
      return
    }

    // 处理命令响应（不变）
    const response: NodeResponse = msg
    if (response.id && pendingCommands.has(response.id)) {
      const pending = pendingCommands.get(response.id)!
      clearTimeout(pending.timer)
      pendingCommands.delete(response.id)
      pending.resolve(response)
    }
  } catch (err) {
    console.error('Storage message error:', err)
  }
})
```

- [ ] **Step 4: 连接断开时清理 streamRegistry**

在 `ws.on('close', () => {` 的处理器中，除现有清理 pendingCommands 外，增加：

```typescript
// 清理 streamRegistry
for (const [id, stream] of streamRegistry) {
  stream.fail(new Error('存储节点已断开'))
  streamRegistry.delete(id)
}
```

- [ ] **Step 5: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 6: Commit**

```bash
git add server/src/services/storageTunnel.ts
git commit -m "feat: 添加 PendingStream 多路复用类和 WebSocket 二进制帧路由"
```

---

### Task 3: streamReadBinary 函数

**Files:**
- Modify: `server/src/services/storageTunnel.ts` (在 streamRead 之后插入)

**Interfaces:**
- Produces: `streamReadBinary(path: string, offset?: number, length?: number): AsyncGenerator<Buffer>`
- Consumes: `config.streamChunkKB`, `sendCommand`, `streamRegistry`, `nextStreamId`, `PendingStream`

- [ ] **Step 1: 在 streamRead 函数之后添加 streamReadBinary**

```typescript
/**
 * 二进制流式读取 — 发送一次 read_file_stream 命令，存储节点持续推送二进制帧
 * 每个二进制帧前 4 字节为 streamId，后接文件原始数据（无 base64）。
 */
export async function* streamReadBinary(
  path: string,
  offset = 0,
  length?: number,
): AsyncGenerator<Buffer> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const streamId = nextStreamId()
  const stream = new PendingStream(streamId)
  streamRegistry.set(streamId, stream)

  const timeoutMs = 120_000
  let timeout: ReturnType<typeof setTimeout>

  const resetTimeout = () => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      stream.fail(new Error('下载流超时 (120s)'))
      streamRegistry.delete(streamId)
    }, timeoutMs)
  }
  resetTimeout()

  try {
    await sendCommand({
      type: 'read_file_stream',
      path,
      streamId,
      offset,
      length,
    })

    for await (const chunk of stream) {
      resetTimeout()
      yield chunk
    }

    await stream.awaitChecksum()
  } finally {
    clearTimeout(timeout)
    streamRegistry.delete(streamId)
  }
}
```

- [ ] **Step 2: 导出 streamReadBinary**

在 `storageTunnel.ts` 文件末尾确认 `streamReadBinary` 未与现有名称冲突，它和 `streamRead` 并存。

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```bash
git add server/src/services/storageTunnel.ts
git commit -m "feat: 添加 streamReadBinary 二进制流式下载函数"
```

---

### Task 4: streamWriteBinary 函数

**Files:**
- Modify: `server/src/services/storageTunnel.ts` (在 streamReadBinary 之后插入)

**Interfaces:**
- Produces: `streamWriteBinary(path: string, chunks: AsyncIterable<Buffer>, totalSize?: number): Promise<{ sha256: string; bytesWritten: number }>`
- Consumes: `config.streamChunkKB`, `sendCommand`, `activeNode`, `waitForDrain`, `nextStreamId`, `streamRegistry`, Node.js `crypto.createHash('sha256')`

- [ ] **Step 1: 提取 waitForDrain 到模块级并添加 crypto import**

`waitForDrain` 当前定义在 `streamWrite` 函数内部（约第 129 行），需要提取到模块级使其可被 `streamWriteBinary` 复用。

在文件顶部 import 区添加 `crypto`：

```typescript
import { createHash } from 'crypto'
```

然后将 `streamWrite` 函数内部的 `MAX_BUFFER` 和 `waitForDrain` 提取到模块级（在 `generateId()` 之后）：

```typescript
const WS_MAX_BUFFER = 1024 * 1024  // 1MB high water mark

function waitForDrain(maxBuffer: number): Promise<void> {
  if (!activeNode) return Promise.resolve()
  return new Promise<void>(resolve => {
    if ((activeNode!.bufferedAmount ?? 0) <= maxBuffer) {
      resolve()
      return
    }
    const check = () => {
      if ((activeNode!.bufferedAmount ?? 0) <= maxBuffer) {
        activeNode!.removeListener('drain', check)
        resolve()
      }
    }
    activeNode!.on('drain', check)
  })
}
```

然后删除 `streamWrite` 函数内部的 `MAX_BUFFER` 常量和 `waitForDrain` 函数定义（约第 127-141 行），并将 `streamWrite` 中调用 `waitForDrain(activeNode, MAX_BUFFER)` 的地方改为 `waitForDrain(WS_MAX_BUFFER)`。

- [ ] **Step 2: 在 streamReadBinary 之后添加 streamWriteBinary**

```typescript
/**
 * 二进制流式上传 — busboy 流出的 Buffer 直接封装为 WebSocket 二进制帧，
 * 无 base64 编码开销。每 2MB 累积一批发送。
 */
export async function streamWriteBinary(
  path: string,
  chunks: AsyncIterable<Buffer>,
  totalSize?: number,
): Promise<{ sha256: string; bytesWritten: number }> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const streamId = nextStreamId()
  const sha256 = createHash('sha256')
  const CHUNK = config.streamChunkKB * 1024  // 2MB
  let buffered = Buffer.alloc(0)
  let totalBytes = 0

  // 初始化写入流
  const initResp = await sendCommand({
    type: 'write_file_stream',
    path,
    streamId,
    totalSize,
  })
  if (!initResp.success) {
    throw new Error(`初始化写入流失败: ${initResp.error || '未知错误'}`)
  }

  try {
    for await (const chunk of chunks) {
      sha256.update(chunk)
      buffered = Buffer.concat([buffered, chunk])

      while (buffered.length >= CHUNK) {
        const frame = Buffer.concat([
          createStreamHeader(streamId),
          buffered.subarray(0, CHUNK),
        ])
        buffered = buffered.subarray(CHUNK)
        totalBytes += CHUNK
        await waitForDrain(WS_MAX_BUFFER)
        activeNode.send(frame)
      }
    }

    // 发送剩余数据
    if (buffered.length > 0) {
      totalBytes += buffered.length
      await waitForDrain(activeNode, 1024 * 1024)
      activeNode.send(Buffer.concat([createStreamHeader(streamId), buffered]))
    }

    // 发送 EOF
    const digest = sha256.digest('hex')
    const streamEndResp = await sendCommand({
      type: 'stream_eof',
      path,
      streamId,
      sha256: digest,
    })

    if (!streamEndResp.success) {
      throw new Error(`上传完成确认失败: ${streamEndResp.error || 'SHA-256 校验不匹配'}`)
    }

    return {
      sha256: digest,
      bytesWritten: totalBytes,
    }
  } catch (err) {
    // 写入失败：通知节点删除残片
    try {
      await sendCommand({ type: 'delete_file', path: path + '.tmp' })
    } catch { /* ignore */ }
    throw err
  }
}

/** 生成 4 字节大端 streamId 头 */
function createStreamHeader(streamId: number): Buffer {
  const buf = Buffer.alloc(4)
  buf.writeUInt32BE(streamId, 0)
  return buf
}
```

- [ ] **Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 4: Commit**

```bash
git add server/src/services/storageTunnel.ts
git commit -m "feat: 添加 streamWriteBinary 二进制流式上传函数"
```

---

### Task 5: 修改下载路由 — 切换 streamReadBinary + HTTP Range

**Files:**
- Modify: `server/src/routes/drive.ts:525-580`

**Interfaces:**
- Consumes: `streamReadBinary` from `../services/storageTunnel.js`
- Produces: `handleDownload` 支持 HTTP Range (206 Partial Content)

- [ ] **Step 1: 修改 import 添加 streamReadBinary**

将 `drive.ts:6` 的 import 从：

```typescript
import { sendCommand, streamRead, streamWrite, isNodeConnected } from '../services/storageTunnel.js'
```

改为：

```typescript
import { sendCommand, streamRead, streamWrite, streamReadBinary, streamWriteBinary, isNodeConnected } from '../services/storageTunnel.js'
```

- [ ] **Step 2: 添加 parseRange 辅助函数**

在 `fixMojibake` 函数之后，`transformSize` 之前插入：

```typescript
function parseRange(header: string, totalSize: number): { start: number; end?: number } | null {
  const match = header.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return null
  const start = parseInt(match[1], 10)
  if (start >= totalSize) return null
  if (match[2] !== '') {
    const end = parseInt(match[2], 10)
    if (end >= totalSize) return { start, end: totalSize - 1 }
    return { start, end }
  }
  return { start }
}
```

- [ ] **Step 3: 修改 handleDownload 支持 Range 并使用 streamReadBinary**

将 `handleDownload` 函数体（`drive.ts:525-574`）替换为：

```typescript
async function handleDownload(req: Request, res: Response): Promise<void> {
  try {
    const id = parseId(req.params.id)
    if (id === null) {
      res.status(400).json({ error: '无效的文件 ID' })
      return
    }

    const file = await assertFileOwnership(id, req.user!)
    if (!file || file.isFolder) {
      res.status(404).json({ error: '文件不存在或无权访问' })
      return
    }

    if (!isNodeConnected()) {
      res.status(503).json({ error: '存储节点未连接' })
      return
    }

    const mimeType = file.mimeType || 'application/octet-stream'
    const encodedName = encodeURIComponent(file.name)
    const contentLength = Number(file.size)

    const rangeHeader = req.headers.range

    if (rangeHeader) {
      const parsed = parseRange(rangeHeader, contentLength)
      if (!parsed) {
        res.status(416).setHeader('Content-Range', `bytes */${contentLength}`).end()
        return
      }

      const { start, end } = parsed
      const len = end !== undefined ? end - start + 1 : contentLength - start

      res.status(206)
      res.setHeader('Content-Type', mimeType)
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
      res.setHeader('Content-Range', `bytes ${start}-${end ?? contentLength - 1}/${contentLength}`)
      res.setHeader('Content-Length', len)
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('X-Content-Length', String(contentLength))
      res.setHeader('Accept-Ranges', 'bytes')

      try {
        for await (const chunk of streamReadBinary(file.storagePath, start, len)) {
          res.write(chunk)
        }
        res.end()
      } catch (streamErr: unknown) {
        console.error('下载流中断:', streamErr)
        if (!res.writableEnded) res.end()
      }
      return
    }

    // 全量下载
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
    res.setHeader('Content-Length', contentLength)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('X-Content-Length', String(contentLength))
    res.setHeader('Accept-Ranges', 'bytes')

    try {
      for await (const chunk of streamReadBinary(file.storagePath)) {
        res.write(chunk)
      }
      res.end()
    } catch (streamErr: unknown) {
      console.error('下载流中断:', streamErr)
      if (!res.writableEnded) res.end()
    }
  } catch (err) {
    console.error('下载文件失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: '下载文件失败' })
    }
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/drive.ts
git commit -m "feat: 下载路由切换 streamReadBinary + HTTP Range 支持"
```

---

### Task 6: 修改上传路由 — 切换 streamWriteBinary

**Files:**
- Modify: `server/src/routes/drive.ts:438-496`

**Interfaces:**
- Consumes: `streamWriteBinary` from `../services/storageTunnel.js`

- [ ] **Step 1: 修改 upload 路由中的写入调用**

在 `drive.ts` 的上传路由 `POST /upload` 的 `bb.on('file', ...)` 回调中，找到以下代码块（约第 438-469 行）：

```typescript
// 流式转发到存储节点 — 边收边发，无需全量缓冲
let totalSize = 0

async function* streamToAsyncIterable(stream: AsyncIterable<Buffer>) {
  for await (const chunk of stream) {
    totalSize += chunk.length
    yield chunk
  }
}

// ...
const file = await prisma.driveFile.create({
  data: {
    name: finalName,
    isFolder: false,
    parentId: parentId || null,
    size: BigInt(totalSize),  // 此时为 0n
    mimeType,
    storagePath,
    uploadedById: req.user!.userId,
  },
  // ...
})

let writeSucceeded = false
try {
  const writeResult = await streamWrite(storagePath, streamToAsyncIterable(stream), 0)
  if (!writeResult.success) {
    throw new Error(`存储节点写入失败: ${writeResult.error}`)
  }
  writeSucceeded = true

  // 写入节点成功后更新实际大小
  if (totalSize > 0) {
    await prisma.driveFile.update({
      where: { id: file.id },
      data: { size: BigInt(totalSize) },
    })
  }

  res.status(201).json(transformSize(file))
} catch (writeErr) {
  // 存储节点写入失败 → 回滚：删除 DB 记录 + 清理节点残片
  await prisma.driveFile.delete({ where: { id: file.id } }).catch(() => {})
  // ...
  throw writeErr
}
```

替换为：

```typescript
// busboy stream 本身是 AsyncIterable<Buffer>，可直接传入
// DB 先创建 size=0 占位，写入成功后更新真实大小
const file = await prisma.driveFile.create({
  data: {
    name: finalName,
    isFolder: false,
    parentId: parentId || null,
    size: 0n,
    mimeType,
    storagePath,
    uploadedById: req.user!.userId,
  },
  select: {
    id: true, name: true, size: true, mimeType: true, createdAt: true,
  },
})

let writeSucceeded = false
try {
  const { bytesWritten } = await streamWriteBinary(storagePath, stream)
  writeSucceeded = true

  // 写入成功后用真实字节数更新 DB
  await prisma.driveFile.update({
    where: { id: file.id },
    data: { size: BigInt(bytesWritten) },
  })

  res.status(201).json(transformSize(file))
} catch (writeErr) {
  await prisma.driveFile.delete({ where: { id: file.id } }).catch(() => {})
  if (writeSucceeded) {
    try {
      if (isNodeConnected()) {
        await sendCommand({ type: 'delete_file', path: storagePath })
      }
    } catch { /* 节点清理失败则留待后续处理 */ }
  }
  throw writeErr
}
```

注意：删除了 `totalSize` 变量、`streamToAsyncIterable` 包装函数、以及 `if (totalSize > 0)` 条件（`streamWriteBinary` 总是返回 `bytesWritten ≥ 0`，直接更新）。

- [ ] **Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无类型错误。

- [ ] **Step 3: Commit**

```bash
git add server/src/routes/drive.ts
git commit -m "feat: 上传路由切换 streamWriteBinary 二进制流式上传"
```

---

### Task 7: 存储节点 — 下载流处理器

**Files:**
- Modify: `storage-node/main.py`

**Interfaces:**
- Produces: `handle_read_file_stream(ws, cmd)` — 异步函数，持续推送二进制帧
- Consumes: `struct`, `hashlib`, `ROOT`, `json`

- [ ] **Step 1: 添加 import**

在 `main.py` 顶部添加：

```python
import struct
import hashlib
```

- [ ] **Step 2: 添加 handle_read_file_stream 函数**

在 `handle_read_file` 函数之后，`handle_delete_file` 之前插入：

```python
async def handle_read_file_stream(ws, cmd):
    """二进制流式读取 — 发送一次命令，持续推送二进制帧直到读完或 length 耗尽。"""
    stream_id = cmd.get("streamId", 0)
    path = cmd.get("path", "")
    offset = cmd.get("offset", 0)
    length = cmd.get("length")  # None = 读到文件末尾

    abs_path = ROOT / path
    if not abs_path.exists():
        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": "文件不存在",
        }))
        return

    h = hashlib.sha256()
    bytes_read = 0
    CHUNK = 2 * 1024 * 1024  # 2MB

    try:
        with open(str(abs_path), "rb") as f:
            f.seek(offset)
            remaining = length
            while True:
                read_size = CHUNK if remaining is None else min(CHUNK, remaining)
                chunk = f.read(read_size)
                if not chunk:
                    break
                h.update(chunk)
                bytes_read += len(chunk)
                frame = struct.pack(">I", stream_id) + chunk
                await ws.send(frame)  # websockets library: bytes → binary frame
                if remaining is not None:
                    remaining -= len(chunk)
                    if remaining <= 0:
                        break

        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "sha256": h.hexdigest(),
            "bytesRead": bytes_read,
            "success": True,
        }))
    except Exception as e:
        log.error(f"read_file_stream 失败 ({path}): {e}")
        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": str(e),
        }))
```

- [ ] **Step 3: 修改 handle_command 以支持 read_file_stream**

在 `handle_command` 函数的 `if cmd_type == "read_file":` 块（约第 234 行）之后添加：

```python
elif cmd_type == "read_file_stream":
    await handle_read_file_stream(ws, cmd)
    return None  # 异步处理，不返回同步响应
```

- [ ] **Step 4: 修改消息接收循环以处理二进制帧**

将 `connect()` 函数中的主循环从：

```python
async for message in ws:
    cmd = json.loads(message)
    response = await handle_command(cmd, ws)
    if response is not None:
        await ws.send(json.dumps(response))
```

改为：

```python
async for message in ws:
    if isinstance(message, bytes):
        # 二进制帧：处理写入流数据
        await handle_binary_frame(ws, message)
    else:
        cmd = json.loads(message)
        response = await handle_command(cmd, ws)
        if response is not None:
            await ws.send(json.dumps(response))
```

- [ ] **Step 5: 添加 handle_binary_frame 占位函数**

在文件顶部（handle_read_file_stream 前）添加占位，Task 8 会补充完整实现：

```python
async def handle_binary_frame(ws, data: bytes):
    """处理二进制帧 — 路由到写入流。Task 8 实现。"""
    pass
```

- [ ] **Step 6: 验证语法**

```bash
python -m py_compile storage-node/main.py
```

Expected: 无错误输出。

- [ ] **Step 7: Commit**

```bash
git add storage-node/main.py storage-node/requirements.txt
git commit -m "feat: 存储节点添加 handle_read_file_stream 二进制流下载"
```

---

### Task 8: 存储节点 — 上传流处理器

**Files:**
- Modify: `storage-node/main.py`

**Interfaces:**
- Produces: `handle_write_file_stream(cmd)` — 初始化写入流，打开文件句柄
- Produces: `handle_stream_eof(ws, cmd)` — 关闭文件，比对 SHA-256，发送确认
- Produces: 完整的 `handle_binary_frame` — 将二进制帧数据写入活跃流文件
- Consumes: `_active_write_file` 替代为 `active_streams: dict`

- [ ] **Step 1: 添加 active_streams 全局字典**

在文件顶部 `_active_write_file` 之后添加：

```python
active_streams: dict = {}  # { stream_id: { "type": "write", "file": f, "sha256": h, "bytes_written": int } }
```

- [ ] **Step 2: 添加 handle_write_file_stream**

在 `handle_read_file_stream` 之后插入：

```python
def handle_write_file_stream(cmd):
    """初始化二进制流写入 — 打开 .tmp 文件准备接收数据。"""
    stream_id = cmd.get("streamId", 0)
    path = cmd.get("path", "")
    total_size = cmd.get("totalSize", 0)

    tmp_path = ROOT / (path + ".tmp")
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    f = open(str(tmp_path), "wb")

    active_streams[stream_id] = {
        "type": "write",
        "path": path,
        "tmp_path": str(tmp_path),
        "file": f,
        "sha256": hashlib.sha256(),
        "bytes_written": 0,
        "total_size": total_size,
    }

    log.info(f"Start binary stream write: {path} (stream {stream_id})")
    return {"success": True}
```

- [ ] **Step 3: 添加 handle_stream_eof**

在 `handle_write_file_stream` 之后插入：

```python
async def handle_stream_eof(ws, cmd):
    """流结束 — fsync + close + rename + SHA-256 校验。"""
    stream_id = cmd.get("streamId", 0)
    expected_sha256 = cmd.get("sha256", "")

    stream = active_streams.pop(stream_id, None)
    if not stream:
        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": "无效的 streamId",
        }))
        return

    try:
        f = stream["file"]
        f.flush()
        os.fsync(f.fileno())
        f.close()

        actual_sha256 = stream["sha256"].hexdigest()
        match = actual_sha256 == expected_sha256

        if match:
            final_path = str(ROOT / stream["path"])
            os.rename(stream["tmp_path"], final_path)
            log.info(f"Binary stream write complete: {stream['path']} ({stream['bytes_written']} bytes)")
        else:
            # 校验失败 → 删除 tmp
            os.unlink(stream["tmp_path"])
            log.error(f"Binary stream SHA-256 mismatch: {stream['path']} (expected={expected_sha256[:8]}..., actual={actual_sha256[:8]}...)")

        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "sha256": actual_sha256,
            "bytesWritten": stream["bytes_written"],
            "success": match,
            "checksumMatch": match,
            "error": None if match else "SHA-256 校验不匹配",
        }))
    except Exception as e:
        log.error(f"stream_eof 失败 (stream {stream_id}): {e}")
        try:
            stream["file"].close()
        except:
            pass
        await ws.send(json.dumps({
            "type": "stream_end",
            "streamId": stream_id,
            "success": False,
            "error": str(e),
        }))
```

- [ ] **Step 4: 实现 handle_binary_frame**

将 Task 7 中创建的占位 `handle_binary_frame` 替换为：

```python
async def handle_binary_frame(ws, data: bytes):
    """处理二进制帧 — 按 streamId 路由到写入流。"""
    if len(data) < 4:
        return
    stream_id = struct.unpack(">I", data[:4])[0]
    payload = data[4:]

    stream = active_streams.get(stream_id)
    if not stream or stream.get("type") != "write":
        log.warning(f"收到未知流 streamId={stream_id} 的二进制帧")
        return

    try:
        f = stream["file"]
        f.write(payload)
        stream["sha256"].update(payload)
        stream["bytes_written"] += len(payload)
    except Exception as e:
        log.error(f"写入流 streamId={stream_id} 失败: {e}")
        try:
            stream["file"].close()
        except:
            pass
        active_streams.pop(stream_id, None)
```

- [ ] **Step 5: 在 handle_command 中添加 write_file_stream 和 stream_eof 分支**

在 `handle_command` 函数中，`elif cmd_type == "read_file_stream":` 块之后添加：

```python
elif cmd_type == "write_file_stream":
    result = handle_write_file_stream(cmd)
    return {"id": cmd_id, **result}
elif cmd_type == "stream_eof":
    await handle_stream_eof(ws, cmd)
    return None
```

- [ ] **Step 6: 验证语法**

```bash
python -m py_compile storage-node/main.py
```

Expected: 无错误输出。

- [ ] **Step 7: Commit**

```bash
git add storage-node/main.py
git commit -m "feat: 存储节点添加二进制流上传处理器 (write_file_stream + stream_eof + binary_frame)"
```

---

### Task 9: Nginx 配置优化

**Files:**
- Modify: `nginx.conf`

**Interfaces:** None (infrastructure config)

- [ ] **Step 1: 修改 nginx.conf**

在 `/ws/` location 块之前添加下载路径专用 location，并修改 `client_max_body_size`：

```nginx
    # 大文件上传支持（网盘功能）— 对齐服务端 10GB 配置
    client_max_body_size 10240m;

    # ---- 下载路径 — 大文件需要更长超时 ----
    location ~ ^/api/drive/(download|files/.+/download) {
        proxy_pass http://lineweb_server;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
```

（替换原有的 `client_max_body_size 100m;` 为 `10240m;`，并在 `/ws/` location 之前插入下载 location。）

- [ ] **Step 2: 验证 Nginx 配置语法**

```bash
nginx -t -c nginx.conf
```

如果本地没有 Nginx，可以跳过此验证。

- [ ] **Step 3: Commit**

```bash
git add nginx.conf
git commit -m "feat: Nginx 下载超时 3600s + client_max_body_size 对齐 10GB"
```

---

### Task 10: 修复 UploadZone 硬编码大小

**Files:**
- Modify: `client/src/components/drive/UploadZone.tsx:184`

**Interfaces:** None (string change)

- [ ] **Step 1: 修改提示文案**

将第 184 行：

```tsx
<span className="upload-zone-drop-hint">支持多文件上传，单个文件最大 10GB</span>
```

改为：

```tsx
<span className="upload-zone-drop-hint">支持多文件上传</span>
```

去掉具体的文件大小数字，避免与服务端配置不同步。

- [ ] **Step 2: Commit**

```bash
git add client/src/components/drive/UploadZone.tsx
git commit -m "fix: 移除 UploadZone 硬编码 10GB 提示"
```

---

### Task 11: 集成验证 — 本地测试

**Files:** None (manual test)

- [ ] **Step 1: 启动开发环境**

```bash
npm run dev
```

Expected: server 和 client 均正常启动，无编译/启动错误。

- [ ] **Step 2: 启动存储节点**

```bash
cd storage-node && python main.py
```

Expected: 存储节点成功认证并显示 "已连接到服务器"。

- [ ] **Step 3: 上传测试文件**

通过网盘界面上传一个 >10MB 的文件，确认：
- 上传进度条正常显示
- 上传完成后文件出现在文件列表中
- 下载该文件，确认内容完整（与原始文件一致）

- [ ] **Step 4: HTTP Range 测试**

```bash
curl -H "Authorization: Bearer <token>" -H "Range: bytes=0-1023" http://localhost:3001/api/drive/download/<fileId> -o partial.bin
```

Expected: 响应状态 206，Content-Range 头正确，下载文件大小为 1024 字节。

```bash
curl -H "Authorization: Bearer <token>" -H "Range: bytes=1024-" http://localhost:3001/api/drive/download/<fileId> -o rest.bin
```

Expected: 响应状态 206，下载文件剩余部分。

```bash
# 拼接验证
copy /b partial.bin + rest.bin merged.bin
fc merged.bin <original_file>
```

Expected: 文件完全一致（fc 无输出）。

- [ ] **Step 5: 提交最终验证结果**

如果全部通过，记录验证结果。
