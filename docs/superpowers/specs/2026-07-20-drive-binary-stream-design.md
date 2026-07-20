# 网盘二进制流式传输 — 设计文档

**日期：** 2026-07-20  
**状态：** 待审核  

## 1. 问题

当前生产环境网盘下载采用拉模式（pull-based）：服务端每次向存储节点请求 256KB 分块，收到响应后才请求下一块。上传则将 busboy 流出的数据 base64 编码后通过 WebSocket JSON 逐帧发送。在公网高延迟场景下性能很差——每 256KB 就一次 RTT，加上 base64 膨胀约 33%，理论吞吐量受限于 `chunkSize / RTT`。

## 2. 目标

- 下载速度提升 3-4 倍（消除 RTT 串行等待 + 去除 base64 编码）
- 上传速度提升约 25%（去除 base64 编码/解码开销）
- 支持 HTTP Range 断点续传
- 双向 SHA-256 校验保证数据完整性
- 向后兼容，不破坏现有协议

## 3. 二进制流协议

### 3.1 下载流

```
Server → Node:  {"type":"read_file_stream", "streamId":<u32>, "path":"...", "offset":0, "length":null}
Node → Server:  [4字节大端streamId][原始文件数据]          ← WebSocket binary frame
Node → Server:  [4字节大端streamId][数据]                  ← 持续推送
Node → Server:  [4字节大端streamId][数据]                  ← 每帧 2MB
Node → Server:  {"type":"stream_end", "streamId":<u32>, "sha256":"...", "bytesRead":<u64>, "success":true}
```

- `streamId`：4 字节无符号大端整数，同一 WebSocket 连接支持并发多流
- `length`：null 表示读到文件末尾；指定值则读到 offset+length 处停止
- 数据帧：WebSocket binary opcode，每帧 payload 大小由节点控制（2MB），不保证对齐
- `stream_end`：JSON text frame，携带增量 SHA-256 校验和

### 3.2 上传流

```
Server → Node:  {"type":"write_file_stream", "streamId":<u32>, "path":"...", "totalSize":<u64>}
Server → Node:  [4字节大端streamId][原始文件数据]          ← busboy 流出即封帧
Server → Node:  [4字节大端streamId][数据]
Server → Node:  {"type":"stream_eof", "streamId":<u32>, "sha256":"..."}
Node → Server:  {"type":"stream_end", "streamId":<u32>, "sha256":"...", "bytesWritten":<u64>, "success":true}
```

- 服务端从 busboy 流 `on('data')` 中立即封装二进制帧发送
- 2MB 缓冲满一批发一批，WebSocket buffer 背压（1MB high water mark）照常工作
- `stream_eof` 告知节点流结束并携带服务端计算的 SHA-256
- 节点关闭文件后比对 SHA-256 并返回 `stream_end`

### 3.3 分帧格式

所有二进制帧统一格式：

```
[0..3]  streamId  uint32  big-endian
[4..]   data      bytes   文件原始内容
```

服务端和节点端均需实现流多路复用：按 `streamId` 路由到对应的 `PendingStream` 对象。`streamId` 生成规则：递增计数器，溢出回绕，冲突时跳过。

## 4. 服务端改动

### 4.1 `server/src/services/storageTunnel.ts`

**新增 — `streamReadBinary(path, offset?, length?) → AsyncGenerator<Buffer>`**

```typescript
async function* streamReadBinary(
  path: string,
  offset = 0,
  length?: number
): AsyncGenerator<Buffer> {
  const streamId = nextStreamId()
  const stream = new PendingStream(streamId)
  streamRegistry.set(streamId, stream)

  await sendCommand({ type: 'read_file_stream', streamId, path, offset, length })

  const timeout = setTimeout(() => {
    stream.reject(new Error('下载流超时 (120s)'))
    streamRegistry.delete(streamId)
  }, 120_000)

  try {
    for await (const chunk of stream) {
      clearTimeout(timeout)
      yield chunk
      // 重置超时，120s 无新数据即断开
    }
    // 校验 SHA-256
    await stream.checksumPromise
  } finally {
    clearTimeout(timeout)
    streamRegistry.delete(streamId)
  }
}
```

**修改 — WebSocket message handler（二进制帧路由）**

```typescript
ws.on('message', (data, isBinary) => {
  if (isBinary) {
    // 解析前 4 字节 streamId
    const streamId = data.readUInt32BE(0)
    const payload = data.subarray(4)
    const stream = streamRegistry.get(streamId)
    if (stream) stream.push(payload)
    return
  }
  // 现有 JSON 处理逻辑不变
  const msg = JSON.parse(data.toString())
  if (msg.type === 'stream_end') {
    const stream = streamRegistry.get(msg.streamId)
    if (stream) stream.end(msg)
    return
  }
  // ...原有 JSON 响应路由
})
```

**新增 — `streamWriteBinary(path, chunks, totalSize?) → Promise<{ sha256, bytesWritten }>`**

```typescript
async function streamWriteBinary(
  path: string,
  chunks: AsyncIterable<Buffer>,
  totalSize?: number
): Promise<{ sha256: string; bytesWritten: number }> {
  const streamId = nextStreamId()
  await sendCommand({ type: 'write_file_stream', streamId, path, totalSize })

  const sha256 = createHash('sha256')
  let buffered = Buffer.alloc(0)

  for await (const chunk of chunks) {
    sha256.update(chunk)
    buffered = Buffer.concat([buffered, chunk])

    while (buffered.length >= 2 * 1024 * 1024) {
      const frame = Buffer.concat([
        createStreamHeader(streamId),
        buffered.subarray(0, 2 * 1024 * 1024),
      ])
      buffered = buffered.subarray(2 * 1024 * 1024)
      await wsSendWithBackpressure(frame)
    }
  }
  // 发送剩余数据
  if (buffered.length > 0) {
    await wsSendWithBackpressure(Buffer.concat([createStreamHeader(streamId), buffered]))
  }
  // 发送 EOF
  await sendCommand({ type: 'stream_eof', streamId, sha256: sha256.digest('hex') })

  // 等待节点确认
  return await waitForStreamEnd(streamId)
}
```

### 4.2 `server/src/routes/drive.ts`

**下载路由** — 增加 HTTP Range 支持

```typescript
// GET /api/drive/download/:id  或  /api/drive/files/:id/download
const range = req.headers.range
if (range && file.storagePath) {
  const parsed = parseRange(range, file.fileSize)
  if (!parsed) { res.status(416).end(); return }

  const { start, end } = parsed
  const len = end ? end - start + 1 : undefined
  res.status(206)
  res.setHeader('Content-Range', `bytes ${start}-${end ?? file.fileSize - 1}/${file.fileSize}`)
  res.setHeader('Content-Length', String(len ?? file.fileSize - start))

  for await (const chunk of streamReadBinary(file.storagePath, start, len)) {
    res.write(chunk)
  }
  res.end()
  return
}

// 全量下载（改为 streamReadBinary）
res.setHeader('Content-Length', contentLength)
for await (const chunk of streamReadBinary(file.storagePath)) {
  res.write(chunk)
}
res.end()
```

**上传路由** — 改为 `streamWriteBinary()` 替代现有 `streamWrite()`

```typescript
// busboy on('file') 回调中
const { sha256, bytesWritten } = await streamWriteBinary(
  storagePath,
  fileStream,  // busboy 提供的 AsyncIterable<Buffer>
  fileSize
)
```

### 4.3 辅助 — Range 解析

```typescript
function parseRange(header: string, totalSize: number): { start: number; end?: number } | null {
  const match = header.match(/^bytes=(\d+)-(\d*)$/)
  if (!match) return null
  const start = parseInt(match[1])
  const end = match[2] ? parseInt(match[2]) : undefined
  if (start >= totalSize) return null
  if (end !== undefined && end >= totalSize) return { start, end: totalSize - 1 }
  return { start, end }
}
```

### 4.4 流多路复用 — PendingStream 类

```typescript
class PendingStream {
  private chunks: Buffer[] = []
  private resolveNext: (() => void) | null = null
  private finished = false
  private endData: NodeResponse | null = null
  private rejectFn: ((err: Error) => void) | null = null

  constructor(public streamId: number) {}

  push(data: Buffer) {
    this.chunks.push(data)
    this.resolveNext?.()
    this.resolveNext = null
  }

  end(data: NodeResponse) {
    this.endData = data
    this.finished = true
    this.resolveNext?.()
  }

  async *[Symbol.asyncIterator]() {
    let i = 0
    while (!this.finished || i < this.chunks.length) {
      if (i < this.chunks.length) {
        yield this.chunks[i++]
      } else {
        await new Promise<void>((resolve) => { this.resolveNext = resolve })
      }
    }
  }

  get checksumPromise(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (this.endData) {
          resolve() // SHA-256 校验在上层做
        } else {
          setTimeout(check, 10)
        }
      }
      check()
    })
  }

  reject(err: Error) { this.rejectFn?.(err) }
}
```

## 5. 存储节点改动

### 5.1 `storage-node/main.py`

**消息路由新增 binary frame 处理**

```python
async def handle_message(ws, data, is_binary):
    if is_binary:
        stream_id = struct.unpack(">I", data[:4])[0]
        payload = data[4:]
        stream = active_streams.get(stream_id)
        if stream and stream["type"] == "write":
            stream["file"].write(payload)
            stream["sha256"].update(payload)
            stream["bytes_written"] += len(payload)
        return

    msg = json.loads(data)
    msg_type = msg.get("type")

    if msg_type == "read_file":
        response = handle_read_file(msg)
        await ws.send(json.dumps(response))
    elif msg_type == "read_file_stream":
        await handle_read_file_stream(ws, msg)
    elif msg_type == "write_file":
        response = handle_write_file(msg)
        await ws.send(json.dumps(response))
    elif msg_type == "write_file_stream":
        handle_write_file_stream(msg)
    elif msg_type == "stream_eof":
        await handle_stream_eof(ws, msg)
    # ...其他命令
```

**新增 — `handle_read_file_stream()`**

```python
async def handle_read_file_stream(ws, cmd):
    stream_id = cmd["streamId"]
    path = cmd["path"]
    offset = cmd.get("offset", 0)
    length = cmd.get("length")  # None = 读到底

    abs_path = ROOT / path
    if not abs_path.exists():
        await ws.send(json.dumps({
            "type": "stream_end", "streamId": stream_id,
            "success": False, "error": "文件不存在"
        }))
        return

    h = hashlib.sha256()
    bytes_read = 0
    CHUNK = 2 * 1024 * 1024  # 2MB

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
            await ws.send(frame)  # 默认 binary=True for bytes
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
```

**新增 — `handle_write_file_stream()`**

```python
def handle_write_file_stream(cmd):
    stream_id = cmd["streamId"]
    path = cmd["path"]
    total_size = cmd.get("totalSize")
    abs_path = ROOT / path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    f = open(str(abs_path), "wb")
    active_streams[stream_id] = {
        "type": "write",
        "file": f,
        "sha256": hashlib.sha256(),
        "bytes_written": 0,
        "total_size": total_size,
    }
```

**新增 — `handle_stream_eof()`**

```python
async def handle_stream_eof(ws, cmd):
    stream_id = cmd["streamId"]
    expected_sha256 = cmd["sha256"]
    stream = active_streams.pop(stream_id, None)

    if not stream:
        await ws.send(json.dumps({
            "type": "stream_end", "streamId": stream_id,
            "success": False, "error": "无效的 streamId"
        }))
        return

    stream["file"].close()
    actual_sha256 = stream["sha256"].hexdigest()
    match = actual_sha256 == expected_sha256

    await ws.send(json.dumps({
        "type": "stream_end",
        "streamId": stream_id,
        "sha256": actual_sha256,
        "bytesWritten": stream["bytes_written"],
        "success": match,
        "checksumMatch": match,
        "error": None if match else "SHA-256 校验不匹配",
    }))
```

## 6. 错误处理

| 场景 | 服务端行为 | 客户端看到 |
|------|-----------|-----------|
| 流中途 WebSocket 断开 | `stream_end` 永不到达，120s 超时 | HTTP 500 / 连接中断 |
| SHA-256 不匹配 | 抛出 `ChecksumMismatchError` | HTTP 500，前端可重试 |
| streamId 冲突 | `streamRegistry` Map 已存在则等待或报错 | 系统级错误，概率极低 |
| 文件不存在（下载） | 节点立即返回 `stream_end` error | HTTP 404 |
| 写入磁盘满 | 节点 `f.write()` 抛异常，关闭流返回 error | HTTP 500 |
| 120s 无新数据 | 超时关闭流 | HTTP 500 |
| Nginx 120s proxy 超时 | 下载大文件的非 Range 请求可能被截断 | 连接断开 |

**注意：** 第 6 项需要在 Nginx 配置中为下载路径增加更长的 `proxy_read_timeout`（如 3600s），或客户端总是使用 Range 请求。

## 7. 向后兼容

- 旧的 `streamRead()` / `streamWrite()` 函数保留不动（代码保留以防回退，但不被路由调用）
- 下载和上传路由全部切换到 `streamReadBinary()` / `streamWriteBinary()`
- 无文件大小阈值，所有文件走新协议

## 8. 前端

`DownloadContext.tsx` 和 `UploadZone.tsx` 无需任何改动——它们只与 HTTP 交互，后端协议变化对其透明。

## 9. Nginx 配置

```nginx
# 下载路径增加超时
location ~ ^/(api/drive/download|api/drive/files/.+/download) {
    proxy_pass http://serve:3001;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}

# client_max_body_size 与后端配置对齐
client_max_body_size 10240m;
```

## 10. 文件清单

| 文件 | 改动类型 | 说明 |
|------|---------|------|
| `server/src/services/storageTunnel.ts` | 修改 | 新增 `streamReadBinary`、`streamWriteBinary`、`PendingStream`、二进制帧路由 |
| `server/src/routes/drive.ts` | 修改 | 下载路由使用 `streamReadBinary` + Range 支持；上传路由使用 `streamWriteBinary` |
| `server/src/config/index.ts` | 修改 | 新增 `STREAM_CHUNK_KB` 配置项（默认 2048） |
| `server/src/types/storage.ts` | 修改 | 新增 `read_file_stream`、`write_file_stream`、`stream_eof`、`stream_end` 命令类型 |
| `storage-node/main.py` | 修改 | 新增 `handle_read_file_stream`、`handle_write_file_stream`、`handle_stream_eof`；binary frame 路由 |
| `nginx.conf` | 修改 | 下载路径 proxy 超时 + client_max_body_size |
| `client/src/components/drive/UploadZone.tsx` | 修改 | hardcoded 最大文件大小改为动态读取或对齐实际配置 |

## 11. 不进此设计的

- CDN 加速（需要额外基础设施）
- 文件分片并行下载（按 Range 切分，但需要多个 WebSocket 连接或 streamId 多路复用，复杂度大增）
- 客户端 WebSocket 直连存储节点（安全/NAT 问题）
- 存储节点改为 HTTP 服务（理由见讨论）
