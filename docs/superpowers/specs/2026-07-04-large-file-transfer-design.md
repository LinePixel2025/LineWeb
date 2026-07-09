# 大文件传输内存优化设计

> **目标：** 在 1GB 服务端运行内存限制下，实现任意大小的大文件上传/下载不产生 OOM 崩溃
>
> **架构原则：** 端到端峰值内存 < 256KB（不依赖文件大小），所有缓冲必须是定长的

---

## 问题分析

当前系统的内存溢出点共有三个：

### 1. Storage Node 下载时全量读入内存（内存峰值 ≈ 文件大小 × 1.33× base64 膨胀）

`storage-node/main.py` 的 `handle_read_file()` 执行 `abs_path.read_bytes()` 将整个文件读入 Python 内存，然后对整个二进制数据做 `base64.b64encode()` 产生 4/3 膨胀的 base64 字符串。对于 500MB 文件，峰值 ≈ 500MB + 667MB base64 = **~1.2GB**。

随后 `send_remaining_chunks()` 异步将所有分块逐个推送给 Express 服务端，推完即释放——但推的过程中整块 base64 仍在内存中。

### 2. Express `streamRead` 侧异步分块堆积（内存峰值 ≈ 文件大小 × 1.33×）

`storageTunnel.ts` 在 WebSocket `message` handler 中接受到的所有 `read_file_data` 消息都会被存入 `pendingReads Map`（`chunks: Map<number, string>`）。`streamRead` 虽然以 AsyncGenerator 方式依次 yield，但如果 Node 推送速度 > Express 消费速度（WAN 延迟、CPU 负载等），所有未消费的 chunk 全部堆积在内存 Map 中。500MB / 32KB = 16000 个 base64 chunk，每个 ~43KB → **~670MB**。

### 3. Storage Node 上传时全量分块缓冲（内存峰值 ≈ 文件大小 × 1.33×）

`CHUNK_WRITE_BUFFERS` 收集所有分块的 base64 字符串，最后一块到达后才拼接 `full_b64 += c` 并写盘。500MB 文件 = 所有 base64 chunk 在字典中 + 拼接字符串 = **> 700MB**。

---

## 方案选择：拉模式（Pull-Based）下载 + 流式增量写入

### 下载改造：拉模式取消推送

**当前**：Storage Node 一次性读完整文件 → 并行推送所有 chunk → Express 堆积在 Map 中。

**改造后**：`read_file` 命令增加 `offset`（字节偏移）和 `length`（读取长度）参数。Express 按需逐个请求 chunk，每个请求-响应循环 yield 一个 Buffer。这从根本上消除了"推送方速度快于消费方"导致的堆积问题——Express 永远只持有 1 个正在发送的请求和 1 个正被 yield 的 Buffer。

```
for each chunk:
  response = await sendCommand({ type: 'read_file', path, offset, length: CK })
  yield Buffer.from(response.data, 'base64')
  offset += CK
```

Storage Node 侧用 `pread()`（Python `os.pread`）**只读一个 chunk**到内存，base64 编码后返回。不再读整个文件。

### 上传改造：流式增量写入

**当前**：各 chunk 存入 `CHUNK_WRITE_BUFFERS` 字典，最后一块才拼接写盘。

**改造后**：每个 chunk 到达后立即 base64 解码，追加写入 `.tmp` 临时文件。最后一块到达后关闭文件并重命名为最终文件名。

```
收到 write_file (init):
  → 打开 path.tmp 文件，记文件对象

收到 write_file_data (chunk):
  → base64decode → f.write(decoded) 立即落盘
  → 如果 isLast → f.close() → os.rename(.tmp → 最终文件)
```

如任务中途中断（流异常关闭），.tmp 残留可手动清理。

---

## 详细协议变更

### `read_file` 命令新增参数

```diff
 {
   type: 'read_file'
   path: string
+  offset: number    // 字节偏移量（从 0 开始）
+  length: number    // 需要读取的字节数（== downloadChunkKB * 1024）
 }
```

### `read_file` 响应简化

```diff
 {
   id: string
   type: 'read_file_data'
   success: boolean
   data: string       // base64 编码的文件数据（单块，非全量）
-  chunkIndex: number
-  totalChunks: number
-  totalSize: number
+  bytesRead: number  // 实际读取的字节数（0 表示 EOF）
+  isEOF: boolean     // 是否已到文件末尾
 }
```

### 上传协议不变

利用现有的 `write_file`（init）+ `write_file_data`（分块）+ `isLast` 机制，但 Storage Node 侧改为流式增量写入。

---

## 文件改动清单

### `server/src/services/storageTunnel.ts`

**删除：**
- `PendingReadState` 接口及 `pendingReads` Map（不再需要）
- `waitForChunk()` 函数
- `sendChunkedRead()` 函数（之前标记为 `@deprecated`）
- `sendChunkedWrite()` 函数（之前标记为 `@deprecated`）
- `initStorageTunnel` 中处理 `read_file_data` 消息的逻辑（约 40 行）

**重写：**
- `streamRead()` — 从 AsyncGenerator 改为逐个 `sendCommand` 循环

**保持不变：**
- `sendCommand` / `sendCommandWithRetry`
- `streamWrite()` — 上传流式转发逻辑不变
- `initStorageTunnel()` — WebSocket 服务器初始化逻辑
- `isNodeConnected` / `getNodeStatus`

### `storage-node/main.py`

**重写：**
- `handle_read_file()` — 用 `os.pread` 替代 `read_bytes`，只读一个 chunk
- `handle_write_file()` — 初始化 `.tmp` 文件写入
- `handle_write_file_data()` — 每个 chunk 追加写入 `.tmp`，最后一块 `rename`

**删除：**
- `CHUNK_WRITE_BUFFERS` 字典及所有相关逻辑
- `send_remaining_chunks()` 异步函数
- `CHUNK_SIZE` 常量（改为从命令的 `length` 参数获取）

### `server/src/routes/drive.ts`

**无需改动。** 下载路由中 `streamRead` 接口不变（仍然是 `AsyncGenerator<Buffer>`），路由代码不感知内部实现变化。

---

## 数据流和内存峰值分析

### 下载 500MB 文件（Express 服务端 1GB 内存）

```
1. 请求 chunk 0（offset=0, length=256KB）
   → 请求在飞行中：4KB（JSON 字符串）
   → Storage Node 处理：写入 256KB Buffer + base64 编码（341KB）
   → 响应在飞行中：341KB（base64 字符串）

2. Express 收到响应
   → Buffer.from(data, 'base64')：256KB
   → yield 给 HTTP 响应
   → res.write(chunk) → 底层释放
   → 循环请求下一个

峰值内存 = 256KB（当前 chunk）+ 341KB（飞行中响应）+ 4KB（请求）
         ≈ 600KB  （总内存，不随文件大小变化）
```

### 上传 500MB 文件（Storage Node 侧）

```
每个 64KB chunk 到达：
  → JSON parse：~85KB（base64 膨胀）
  → base64decode：64KB
  → f.write(64KB) → 缓冲区落盘
  → 释放前 3 个对象

峰值内存 = 85KB（incoming JSON）+ 64KB（decoded buffer）
         ≈ 150KB  （不随文件大小变化）

磁盘 IO：顺序追加写入，现代 HDD ~150MB/s，SSD ~500MB/s+
写入 500MB 的时间 ≈ 1-3 秒
```

---

## 错误处理

### 下载中断
- Express HTTP 响应中断（`res.writableEnded`）→ 停止循环，不再请求更多 chunk
- Storage Node 侧无状态残留（每次 `pread` 都是独立系统调用）

### 上传中断
- Express `busboy stream` 触发 `'error'` 或 `'close'` → Storage Node 不会收到 `isLast`
- Storage Node 侧 `.tmp` 文件残留 → 需要手动清理，或实现定时清理机制

### 断线重连
- Storage Node 断线时，Express `sendCommand` 失败 → 路由层 `catch` 并返回 502
- .tmp 残留问题：Storage Node 重连后不做自动清理（防误删），但有已知副作用

---

## 后续优化方向（本设计不做）

1. **下载预取（prefetch）**：为减少 WAN 场景下的 RTT 开销，后续可改为滑动窗口模式——同时发出 N 个 `read_file` 请求（offset 递增），N 个响应窗口允许无序返回。这需要引入序列号排序。当前单请求-响应模式足够本地使用，且内存峰值不变。
2. **.tmp 自动清理**：Storage Node 启动时扫描存储目录，清理超过 24 小时的 .tmp 文件。
3. **上传确认优化**：当前每个 chunk fire-and-forget，只有最后一块等待回复。如果中间丢失，整个文件重传。可改每个 chunk 都确认，但会增加上传时间。

---

## 验证方法

1. **单元测试**：模拟 100MB 文件的 streamRead，确认每次 `sendCommand` 的 offset 递增正确
2. **手动测试**：在开发环境上传/下载 100MB、500MB、1GB 文件
3. **内存监控**：使用 `process.memoryUsage()` 在 Express 路由层打印每次下载的内存峰值
