# 大文件传输内存优化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 1GB 服务端内存限制下，使任意大小文件的上传/下载不产生 OOM

**Architecture:** 下载改为拉模式（请求-响应逐个获取 chunk，消除推送堆积）；上传在 Storage Node 侧改为 .tmp 增量追加写入（消除全量拼接缓冲）。两端内存峰值始终 ≤ 单个 chunk 大小（~256KB）。

**Tech Stack:** Express 4 / ws (TypeScript), Python 3.10+ / websockets (Storage Node)

## 全局约束

- 下载 chunk 大小由 `config.downloadChunkKB` 控制（默认 256KB，即 262144 字节）
- 上传 chunk 大小由 `config.uploadChunkKB` 控制（默认 64KB，即 65536 字节）
- 协议基于 JSON-over-WebSocket，命令通过 `{ type, id, path, ... }` 格式
- `read_file` 命令新增 `offset`（字节偏移）和 `length`（读取长度）参数
- `read_file_data` 响应新增 `bytesRead`（实际读取字节数）和 `isEOF`（是否末尾）字段
- 上传流程沿用现有 `write_file`(init) + `write_file_data`(分块) + `isLast` 协议，仅改造 Storage Node 侧写入方式
- 删除 Storage Node 侧的 `CHUNK_WRITE_BUFFERS` 全量收集和 `send_remaining_chunks` 异步推送

---

### Task 1: Storage Node — 下载改为 os.pread 逐块读取

**Files:**
- Modify: `storage-node/main.py:127-152`（重写 `handle_read_file`）
- Modify: `storage-node/main.py:230-306`（重写 `handle_command` 中的 read_file 处理分支）

**Interfaces:**
- Consumes: `cmd.offset` (int), `cmd.length` (int) — 来自 Express 的 `read_file` 命令
- Produces: `{ id, type: 'read_file_data', success, data: base64, bytesRead: int, isEOF: bool }` — 新响应格式

该任务不修改写相关逻辑，只改读。注意读取界外的 offset 处理：`os.pread` 在 `offset >= file_size` 时返回空 bytes，此时 `isEOF=true, data=''`。

- [ ] **Step 1: 修改 `handle_read_file()` 实现**

将原来 `abs_path.read_bytes()` 全量读取 + base64 编码，改为用 `os.pread(fd, length, offset)` 只读一个 chunk。

替换 `handle_read_file` 函数：

```python
def handle_read_file(cmd: dict) -> dict:
    """按 offset + length 读取文件的一个分块。"""
    path = cmd.get("path", "")
    offset = cmd.get("offset", 0)
    length = cmd.get("length", 0)

    abs_path = ROOT / path
    if not abs_path.exists():
        return {"success": False, "error": "文件不存在"}

    fd = os.open(str(abs_path), os.O_RDONLY)
    try:
        raw = os.pread(fd, length, offset)
    finally:
        os.close(fd)

    b64 = base64.b64encode(raw).decode()
    bytes_read = len(raw)
    is_eof = bytes_read < length

    return {
        "success": True,
        "data": b64,
        "bytesRead": bytes_read,
        "isEOF": is_eof,
    }
```

- [ ] **Step 2: 修改 `handle_command()` 中的 read_file 分支**

`handle_command` 中 `cmd_type == "read_file"` 的分支，改为直接调用新 `handle_read_file` 并返回单块响应（不再有分块逻辑和异步 `send_remaining_chunks`）。

```python
# 在 handle_command 函数内部，替换
elif cmd_type == "read_file":
    result = handle_read_file(cmd)
    if result.get("success"):
        return {
            "id": cmd_id,
            "type": "read_file_data",
            "success": True,
            "data": result.get("data", ""),
            "bytesRead": result.get("bytesRead", 0),
            "isEOF": result.get("isEOF", True),
        }
    return {"id": cmd_id, "success": False, "error": result.get("error", "读取失败")}
```

删除不再使用的函数：
- 删除 `send_remaining_chunks` 整个函数
- 删除 `CHUNK_SIZE = 65536` 常量（写操作也不再需要，见 Task 2）

- [ ] **Step 3: 验证语法正确**

```bash
cd D:\aicop\工程\LineWeb\storage-node
python -c "import py_compile; py_compile.compile('main.py', doraise=True)"
```

预期：无输出（编译成功）

- [ ] **Step 4: 提交**

```bash
git add storage-node/main.py
git commit -m "fix(drive): Storage Node 改为 os.pread 逐块读取，消除下载全量缓冲"
```

---

### Task 2: Storage Node — 上传改为 .tmp 增量追加写入

**Files:**
- Modify: `storage-node/main.py:28-31`（删除 `CHUNK_WRITE_BUFFERS`）
- Modify: `storage-node/main.py:36-125`（重写 `handle_write_file` + `handle_write_file_data`）
- Modify: `storage-node/main.py:217-227`（更新 `HANDLERS` 字典）

**Interfaces:**
- Consumes: 现有 `write_file`(init) + `write_file_data`(chunk) 协议
- Produces: `.tmp` 文件增量写入，最后一块时 `rename` 为最终文件名
- 内部状态：`active_write_file: str | None`（当前正在写入的 .tmp 文件路径）

**设计细节：**
- `write_file`(init)：在最终路径旁创建 `path.tmp` 文件，以 `wb` 模式打开
- `write_file_data`(chunk)：base64 解码 → 立即追加写入文件
- 最后一块（`isLast=true` 或 `chunkIndex == totalChunks-1`）：关闭文件 → `os.rename(path.tmp → path)`
- 流异常中断：.tmp 文件残留，功能正常（后续覆盖或手动清理）
- 性能：每次 `f.write()` 后调用 `f.flush()` 确保数据落盘（用户期望每个 chunk 确认后数据安全）

- [ ] **Step 1: 实现增量写入文件管理**

在文件顶部添加一个简单的文件句柄缓存（仅跟踪当前正写入的文件，避免全局字典）：

```python
# 当前活跃的写入临时文件（单线程缓存，同一时间只处理一个上传）
_active_write_file: dict = {}  # { "path": ..., "fd": ..., "tmp_path": ... }
```

在 `handle_write_file` init 时打开文件，在数据写入完成后关闭。

- [ ] **Step 2: 重写 `handle_write_file()`**

```python
# 删除原有的 CHUNK_WRITE_BUFFERS 相关代码，替换 handle_write_file：

def handle_write_file(cmd: dict) -> dict:
    """初始化分块写入 — 打开 .tmp 文件准备接收数据。"""
    global _active_write_file
    path = cmd.get("path", "")
    total_size = cmd.get("totalSize", 0)

    # 单块模式（兼容现有上传逻辑）
    data_b64 = cmd.get("data", "")
    if data_b64:
        data = base64.b64decode(data_b64)
        abs_path = ROOT / path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        # 直接写最终文件，无需 .tmp（单块即已完成）
        abs_path.write_bytes(data)
        log.info(f"Wrote {len(data)} bytes to {path} (single chunk)")
        return {"success": True, "data": {"size": len(data)}}

    # 多块模式 — 打开 .tmp
    tmp_path = ROOT / (path + ".tmp")
    tmp_path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(str(tmp_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC)

    # 关闭之前的活跃句柄（异常情况保护）
    if _active_write_file.get("fd") is not None:
        try:
            os.close(_active_write_file["fd"])
        except OSError:
            pass

    _active_write_file = {
        "path": path,
        "fd": fd,
        "tmp_path": tmp_path,
    }

    log.info(f"Start chunked write: {path} ({total_size} bytes)")
    return {"success": True}
```

- [ ] **Step 3: 重写 `handle_write_file_data()`**

```python
def handle_write_file_data(cmd: dict) -> dict:
    """每个分块到达时立即追加写入 .tmp 文件。"""
    global _active_write_file
    path = cmd.get("path", "")
    data_b64 = cmd.get("data", "")
    is_last = cmd.get("isLast", False)

    # 检查活跃文件是否匹配
    if _active_write_file.get("path") != path or _active_write_file.get("fd") is None:
        log.warning(f"write_file_data: 未找到活跃写入文件 (path={path})")
        return {"success": False, "error": "未找到活跃写入文件"}

    fd = _active_write_file["fd"]
    try:
        data = base64.b64decode(data_b64)
        os.write(fd, data)
        os.fsync(fd)  # 强制落盘，确保每次 chunk 确认时数据已持久化

        if is_last:
            os.close(fd)
            final_path = ROOT / path
            os.rename(str(_active_write_file["tmp_path"]), str(final_path))
            _active_write_file = {}
            log.info(f"Wrote {len(data)} bytes final chunk to {path}, file complete")
        else:
            log.info(f"Wrote {len(data)} bytes chunk to {path}.tmp")

        return {"success": True}
    except Exception as e:
        log.error(f"写入分块失败: {e}")
        # 异常时尝试关闭句柄
        try:
            os.close(fd)
        except OSError:
            pass
        _active_write_file = {}
        return {"success": False, "error": str(e)}
```

- [ ] **Step 4: 更新 `HANDLERS` 字典引用**

确认 `HANDLERS` 中 `handle_write_file_data` 的引用指向新函数。无需修改字典内容，因为函数名不变。

- [ ] **Step 5: 删除不再使用的全局变量和函数**

删除文件顶部的：
```python
# 删除这两行
CHUNK_WRITE_BUFFERS: dict[str, dict] = {}
CHUNK_SIZE = 65536
```

同时删除 `send_remaining_chunks` 函数（如果上一步已删除，确认不存在即可）。

- [ ] **Step 6: 验证语法正确**

```bash
cd D:\aicop\工程\LineWeb\storage-node
python -c "import py_compile; py_compile.compile('main.py', doraise=True)"
```

预期：无输出（编译成功）

- [ ] **Step 7: 提交**

```bash
git add storage-node/main.py
git commit -m "fix(drive): Storage Node 改为 .tmp 增量写入，消除上传全量缓冲"
```

---

### Task 3: Express — 重写 streamRead 为拉模式，删除 pendingReads

**Files:**
- Modify: `server/src/services/storageTunnel.ts`（多处修改，见分步）

**Interfaces:**
- Modifies: `streamRead(path: string): AsyncGenerator<Buffer>` — 接口签名不变，内部实现改为 pull-based
- Consumes: `NodeCommand.type = 'read_file'` 新参数 `offset` + `length`
- Produces: `NodeResponse` 新字段 `bytesRead` + `isEOF`
- Removes: `PendingReadState`, `pendingReads`, `waitForChunk`, `sendChunkedRead`, `sendChunkedWrite`

- [ ] **Step 1: 删除废弃的类型定义和变量**

删除 `storageTunnel.ts` 中以下定义：
- `PendingReadState` 接口（第 46-55 行）
- `pendingReads` 变量（第 58 行）
- `waitForChunk` 函数（第 228-263 行）
- `sendChunkedRead` 函数（第 357-368 行）
- `sendChunkedWrite` 函数（第 216-223 行）

同时删除 `NodeCommand` 中与分块相关的已废弃字段类型（`chunkIndex`, `totalChunks`, `chunkSize`）：

```typescript
interface NodeCommand {
  id: string
  type: 'write_file' | 'write_file_data' | 'write_file_end'
       | 'read_file' | 'read_file_data'
       | 'delete_file' | 'mkdir'
       | 'move' | 'stat' | 'list_dir' | 'rename'
  path: string
  data?: string
  newPath?: string
  newName?: string
  // 删除以下字段（旧的 push 分块协议，不再使用）：
  // chunkIndex?: number
  // totalChunks?: number
  // isLast?: boolean
  // chunkSize?: number
}
```

**注意：** `isLast` 在 `write_file_data` 中仍有使用，在 upload 的 `streamWrite` 中有发送——保留 `isLast` 字段。精确点，从 `NodeCommand` 中只删除 `chunkIndex`, `totalChunks`, `chunkSize`。

- [ ] **Step 2: 重写 `streamRead()` 为拉模式**

```typescript
export async function* streamRead(path: string): AsyncGenerator<Buffer> {
  if (!activeNode || !nodeConnected) {
    throw new Error('存储节点未连接')
  }

  const READ_SIZE = config.downloadChunkKB * 1024
  let offset = 0

  while (true) {
    const response = await sendCommand({
      type: 'read_file',
      path,
      offset,
      length: READ_SIZE,
    })

    if (!response.success) {
      throw new Error(`读取文件失败: ${response.error}`)
    }

    const data = response.data as string
    const isEOF = response.isEOF as boolean
    const bytesRead = response.bytesRead as number

    if (!data || bytesRead === 0) {
      // 空数据或 EOF
      break
    }

    const buffer = Buffer.from(data, 'base64')
    yield buffer

    if (isEOF) {
      break
    }

    offset += bytesRead
  }
}
```

- [ ] **Step 3: 更新 `NodeResponse` 接口**

在 `NodeResponse` 接口中添加新字段：

```typescript
interface NodeResponse {
  id: string
  success: boolean
  data?: unknown
  error?: string
  bytesRead?: number   // 新增：实际读取字节数
  isEOF?: boolean      // 新增：是否到文件末尾
}
```

- [ ] **Step 4: 清理 `initStorageTunnel` 中的废弃逻辑**

在 `initStorageTunnel()` 的 `ws.on('message')` handler 中，删除处理 `read_file_data` 消息的整个分支（当前第 420-453 行）。

删除后保留的 message 分支应该只剩：
1. 认证处理（`msg.type === 'auth'`）
2. 命令响应处理（`response.id && pendingCommands.has(response.id)`）

```typescript
ws.on('message', (raw: Buffer) => {
  try {
    const msg = JSON.parse(raw.toString())

    if (!authenticated) {
      if (msg.type === 'auth' && msg.token === config.storageNodeToken) {
        authenticated = true
        if (authTimer) clearTimeout(authTimer)
        activeNode = ws
        nodeConnected = true
        nodeConnectTime = new Date()
        console.log('✅ Storage node authenticated')
        ws.send(JSON.stringify({ type: 'auth_ok' }))
      } else {
        console.log('❌ Storage node auth failed')
        ws.send(JSON.stringify({ type: 'auth_error', error: '认证失败' }))
        ws.close(4002, '认证失败')
      }
      return
    }

    // === 删除：read_file_data 处理分支（不再需要） ===

    // 处理命令响应
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

- [ ] **Step 5: 更新 `ws.on('close')` 逻辑**

删除 `close` 事件中清理 `pendingReads` 的部分（当前第 482-489 行）：

```typescript
// 从
for (const [id, pending] of pendingReads) {
  if (pending.timer) clearTimeout(pending.timer)
  if (pending.reject) pending.reject(new Error('存储节点已断开'))
  pendingReads.delete(id)
}

// 变为（完全删除上述循环，不再需要）
```

- [ ] **Step 6: 验证 TypeScript 编译**

```bash
cd D:\aicop\工程\LineWeb\server
npx tsc --noEmit --pretty 2>&1 | head -50
```

预期：无错误输出

- [ ] **Step 7: 整体验证完整流程**

```bash
# 1. 启动 Storage Node（确保存储节点目录存在）
cd D:\aicop\工程\LineWeb\storage-node
python main.py &
# 等待显示 "认证成功"

# 2. 启动后端服务
cd D:\aicop\工程\LineWeb\server
npx tsx src/index.ts &

# 3. 生成测试文件（先测试 1MB）
cd /tmp
dd if=/dev/urandom of=test_1mb.bin bs=1M count=1

# 4. 获取 token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@lineweb.dev","password":"admin123"}' | \
  python -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 5. 上传
curl -s -X POST http://localhost:3001/api/drive/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@test_1mb.bin"

# 6. 下载（记录文件 ID，替换下面 ID）
FILE_ID=1
curl -s -o downloaded.bin \
  -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/drive/download/$FILE_ID"

# 7. 校验
md5sum test_1mb.bin downloaded.bin
# 预期：两个哈希值相同

# 8. 清理后台进程
kill %1 %2
```

- [ ] **Step 8: 提交**

```bash
git add server/src/services/storageTunnel.ts
git commit -m "fix(drive): Express streamRead 改为拉模式轮询，消除下载内存堆积"
```

---

## Spec Coverage Check

| Spec 需求 | 对应 Task |
|-----------|-----------|
| Storage Node 下载用 os.pread 逐块读取 | Task 1 |
| 删除 `send_remaining_chunks` 异步推送 | Task 1 |
| 删除 `CHUNK_WRITE_BUFFERS` 全量收集 | Task 2 |
| Storage Node 上传用 .tmp 增量追加写入 | Task 2 |
| Express streamRead 改为 offset 循环拉模式 | Task 3 |
| 删除 pendingReads / waitForChunk | Task 3 |
| 删除废弃的 sendChunkedRead / sendChunkedWrite | Task 3 |
| 清理 initStorageTunnel 中 read_file_data 分支 | Task 3 |
| 端到端验证流程 | Task 3 Step 7 |

所有 spec 需求均已覆盖。
