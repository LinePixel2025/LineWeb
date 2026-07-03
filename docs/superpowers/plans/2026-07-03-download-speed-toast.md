# 网盘下载速度优化 + 下载进度弹窗

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提升网盘大文件下载速度（通过合并 WS 小块→更大 HTTP 块），并在前端添加 Liquid Glass 风格的顶部下载进度弹窗（实时速度/进度/ETA）。

**Architecture:** 当前下载链路为 Storage Node → WS (32KB base64块) → LineWeb Server (streamRead AsyncGenerator) → HTTP (res.write逐块) → 前端 (ReadableStream). 速度瓶颈在于 WS 块太小导致高频 context switch。优化策略：服务器端将多个 WS 小块合并为 256KB Buffer 再写入 HTTP 响应，减少 write() 调用次数。前端新增全局 DownloadToast 弹窗组件。

**Tech Stack:** React 19, Express 4, WebSocket, ReadableStream

---

## Global Constraints

- 前端 CSS 只改 `client/src/styles/globals.css` 一个文件
- 后端 WS 协议消息格式不变（`read_file` / `read_file_data`），不修改存储节点
- 后端 `streamRead()` 接口签名不变（AsyncGenerator<Buffer>）
- 新组件采用 Liquid Glass 设计语言（`lg-surface-strong-blur` + 现有 CSS 变量）
- 下载进度弹窗定位在页面顶部，z-index 高于页面内容但不覆盖 modal/dialog（现有 dialog z-index: 1000，toast 用 900）

---

## File Map

| 文件 | 操作 | 职责 |
|------|------|------|
| `server/src/services/storageTunnel.ts` | **修改** | `streamRead()` 增加 WS 块合并缓冲逻辑 |
| `server/src/config/index.ts` | **修改** | 新增 `downloadChunkKB`、`wsBufferKB` 配置项 |
| `client/src/components/drive/DownloadToast.tsx` | **创建** | 顶部液态玻璃进度弹窗 |
| `client/src/types/drive.ts` | **修改** | 添加 `DownloadTask` 类型 |
| `client/src/pages/DrivePage.tsx` | **修改** | 集成 DownloadToast，替换 console.log 下载状态 |
| `client/src/styles/globals.css` | **修改** | 添加 DownloadToast 样式 |
| `server/src/routes/drive.ts` | **修改** | 下载路由添加 `X-Chunk-Size` 响应头 |

---

### Task 1: 服务器端 WS 读块合并缓冲

**Files:**
- Modify: `server/src/services/storageTunnel.ts:269-340` — streamRead 内增加缓冲逻辑
- Modify: `server/src/config/index.ts` — 新增 `downloadChunkKB`

**Interfaces:**
- Consumes: `CHUNK_SIZE` (已有, 32768), `config.downloadChunkKB` (新增)
- Produces: `streamRead(path)` 行为改变——内部缓冲多个 WS 块，合并后 yield

- [ ] **Step 1: 添加配置项**

```typescript
// server/src/config/index.ts
export const config = {
  // ... 现有配置 ...
  maxFileSizeMB: parseInt(process.env.MAX_FILE_SIZE_MB || '10240', 10),
  uploadChunkKB: parseInt(process.env.UPLOAD_CHUNK_KB || '64', 10),
  downloadChunkKB: parseInt(process.env.DOWNLOAD_CHUNK_KB || '256', 10), // 新增：下载合并块大小 (KB)
  driveSyncIntervalMs: parseInt(process.env.DRIVE_SYNC_INTERVAL_MS || '300000', 10),
}
```

- [ ] **Step 2: 修改 streamRead 增加缓冲合并**

```typescript
// server/src/services/storageTunnel.ts — 在文件头部导入 config
// 已有: import { config } from '../config/index.js' (检查是否已导入)
// 若未导入则添加

// streamRead 内部 — 将 yield 前的小块合并为 config.downloadChunkKB 大小

// 在 streamRead 函数内，构造 read_file 命令时加入期望块大小提示
const cmd = {
  id, type: 'read_file' as const, path,
  chunkSize: config.downloadChunkKB * 1024,  // 提示节点用此大小
}

// 在 yield 循环中，合并小块以减少 HTTP write 次数
const READ_BUFFER_SIZE = config.downloadChunkKB * 1024

// 修改 try 块内的 yield 逻辑：
let buffer: Buffer | null = null

for (let i = 0; ; i++) {
  const chunk = await waitForChunk(id, i)
  if (chunk === null) {
    // 流结束，flush 剩余 buffer
    if (buffer && buffer.length > 0) {
      yield buffer
    }
    break
  }

  if (buffer === null) {
    buffer = chunk
  } else {
    buffer = Buffer.concat([buffer, chunk])
  }

  // 当累积到目标大小时 yield
  if (buffer.length >= READ_BUFFER_SIZE) {
    yield buffer
    buffer = null
  }
}
```

**变更说明：** 原 `streamRead` 每收到一个 WS chunk（~32KB）就 yield 一次。修改后，内部缓冲至 `downloadChunkKB`（默认 256KB）再 yield，减少 HTTP `res.write()` 调用约 8 倍。同时 `read_file` 命令附带 `chunkSize` 提示，存储节点可以据此调整发送块大小（不强制，节点仍可发小块，服务器端自行合并）。

- [ ] **Step 3: 确保 `config` 在 storageTunnel.ts 中已导入**

```typescript
// server/src/services/storageTunnel.ts — 顶部，检查现有导入
// 如无则添加:
import { config } from '../config/index.js'
```

注意：现有代码中 `storageTunnel.ts` 已在第 4 行 `import { config } from '../config/index.js'`，确认即可。

- [ ] **Step 4: TypeScript 类型检查**

```bash
cd server && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add server/src/config/index.ts server/src/services/storageTunnel.ts
git commit -m "perf(drive): streamRead WS 块合并缓冲，减少 HTTP write 次数"
```

---

### Task 2: 添加下载块大小响应头

**Files:**
- Modify: `server/src/routes/drive.ts:349-358` — 添加 X-Chunk-Size 头

**Interfaces:**
- Consumes: `config.downloadChunkKB` (Task 1)
- Produces: 前端可通过 `X-Chunk-Size` 头预估进度更新频率

- [ ] **Step 1: 添加 `X-Chunk-Size` 响应头**

```typescript
// server/src/routes/drive.ts — download 路由，已有响应头设置区

// 已有:
res.setHeader('Content-Type', mimeType)
res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`)
res.setHeader('Content-Length', contentLength)
res.setHeader('Cache-Control', 'no-cache')
res.setHeader('X-Content-Length', String(contentLength))

// 新增:
res.setHeader('X-Chunk-Size', String(config.downloadChunkKB * 1024))
```

- [ ] **Step 2: TypeScript 类型检查**

```bash
cd server && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add server/src/routes/drive.ts
git commit -m "feat(drive): 添加 X-Chunk-Size 响应头供前端参考"
```

---

### Task 3: 创建 DownloadToast 组件

**Files:**
- Create: `client/src/components/drive/DownloadToast.tsx`
- Modify: `client/src/types/drive.ts` — 添加 `DownloadTask` 类型
- Modify: `client/src/styles/globals.css` — 添加 toast 样式

**Interfaces:**
- Produces: `<DownloadToast tasks={...} onCancel={...} />` — 页面级下载进度弹窗

- [ ] **Step 1: 添加 DownloadTask 类型**

```typescript
// client/src/types/drive.ts — 追加

export interface DownloadTask {
  id: string            // 唯一标识，用于取消
  fileName: string
  loaded: number
  total: number
  speed: number         // bytes/s
  status: 'downloading' | 'complete' | 'cancelled' | 'error'
  error?: string
}
```

- [ ] **Step 2: 实现 DownloadToast 组件**

```tsx
// client/src/components/drive/DownloadToast.tsx

import { memo } from 'react'
import type { DownloadTask } from '../../types/drive'

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—'
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s']
  let i = 0
  let speed = bytesPerSec
  while (speed >= 1024 && i < units.length - 1) { speed /= 1024; i++ }
  return `${speed.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatETA(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`
  return `${(seconds / 3600).toFixed(1)}h`
}

export interface DownloadToastProps {
  tasks: DownloadTask[]
  onCancel: (id: string) => void
  /** 点击后是否只保留最快的 x 个任务 */
  maxVisible?: number
}

const DownloadToast = memo(function DownloadToast({
  tasks,
  onCancel,
  maxVisible = 3,
}: DownloadToastProps) {
  if (tasks.length === 0) return null

  // 只显示进行中的任务
  const activeTasks = tasks.filter(t => t.status === 'downloading')
  const displayTasks = activeTasks.length > 0 ? activeTasks : tasks.slice(-3)
  const visibleTasks = displayTasks.slice(0, maxVisible)
  const overflow = displayTasks.length - maxVisible

  return (
    <div className="download-toast">
      <div className="download-toast-header">
        <span className="download-toast-title">
          ⬇ 下载 {tasks.filter(t => t.status === 'downloading').length > 0
            ? `${tasks.filter(t => t.status === 'downloading').length} 个文件`
            : '已完成'}
        </span>
        {tasks.some(t => t.status === 'downloading') && (
          <span className="download-toast-hint">点击 × 取消单个</span>
        )}
      </div>
      <div className="download-toast-list">
        {visibleTasks.map(task => (
          <div key={task.id} className={`download-toast-item download-toast-item--${task.status}`}>
            <div className="download-toast-item-top">
              <span className="download-toast-item-name" title={task.fileName}>
                {task.fileName}
              </span>
              {task.status === 'downloading' && (
                <button
                  className="download-toast-cancel"
                  onClick={() => onCancel(task.id)}
                  aria-label="取消下载"
                >
                  ✕
                </button>
              )}
              {task.status === 'complete' && <span className="download-toast-badge">✅</span>}
              {task.status === 'error' && <span className="download-toast-badge">❌</span>}
            </div>
            {task.status === 'downloading' && task.total > 0 && (
              <>
                <div className="download-toast-progress-bar">
                  <div
                    className="download-toast-progress-fill"
                    style={{ width: `${(task.loaded / task.total) * 100}%` }}
                  />
                </div>
                <div className="download-toast-stats">
                  <span>⬇ {formatSpeed(task.speed)}</span>
                  <span>
                    {(task.loaded / 1024 / 1024).toFixed(1)}MB / {(task.total / 1024 / 1024).toFixed(1)}MB
                  </span>
                  <span>⏱ {formatETA((task.total - task.loaded) / (task.speed || 1))}</span>
                </div>
              </>
            )}
            {task.status === 'complete' && (
              <div className="download-toast-done-text">下载完成</div>
            )}
            {task.status === 'error' && (
              <div className="download-toast-error-text">{task.error || '下载失败'}</div>
            )}
          </div>
        ))}
        {overflow > 0 && (
          <div className="download-toast-overflow">还有 {overflow} 个文件...</div>
        )}
      </div>
    </div>
  )
})

export default DownloadToast
```

- [ ] **Step 3: 添加 CSS**

```css
/* client/src/styles/globals.css — 追加在 app-actions 相关样式后 */

/* ========== Download Toast ========== */
.download-toast {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 900;
  width: 360px;
  max-width: calc(100vw - 24px);
  background: var(--lg-glass-bg, rgba(255,255,255,0.08));
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--lg-glass-border, rgba(255,255,255,0.15));
  border-radius: var(--lg-radius-md, 12px);
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  padding: 12px 16px;
  animation: toastSlideIn 0.3s cubic-bezier(0.25, 0.1, 0.25, 1) both;
  overflow: hidden;
}

@keyframes toastSlideIn {
  from { opacity: 0; transform: translateY(-24px) scale(0.95); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

/* Dark mode fallback for non-CSS-var */
[data-theme="dark"] .download-toast {
  background: rgba(30, 30, 35, 0.85);
}
[data-theme="light"] .download-toast {
  background: rgba(255, 255, 255, 0.85);
  border-color: rgba(0,0,0,0.1);
  box-shadow: 0 8px 32px rgba(0,0,0,0.10);
}

.download-toast-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--lg-glass-border, rgba(255,255,255,0.1));
}
.download-toast-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--lg-text, #fff);
}
.download-toast-hint {
  font-size: 0.7rem;
  color: var(--lg-text-tertiary, rgba(255,255,255,0.45));
}

.download-toast-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.download-toast-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.download-toast-item-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}
.download-toast-item-name {
  font-size: 0.8rem;
  color: var(--lg-text-secondary, rgba(255,255,255,0.7));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}
.download-toast-cancel {
  background: none;
  border: none;
  color: var(--lg-text-tertiary, rgba(255,255,255,0.45));
  cursor: pointer;
  font-size: 0.85rem;
  padding: 0 2px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}
.download-toast-cancel:hover {
  color: var(--lg-danger, #ff3b3b);
}
.download-toast-badge {
  font-size: 0.85rem;
  flex-shrink: 0;
}

.download-toast-progress-bar {
  height: 4px;
  background: var(--lg-glass-bg, rgba(255,255,255,0.08));
  border-radius: 9999px;
  overflow: hidden;
}
.download-toast-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--lg-accent, #5e9cff), var(--lg-accent-soft, #7ab3ff));
  border-radius: 9999px;
  transition: width 0.25s ease-out;
}

.download-toast-stats {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: var(--lg-text-tertiary, rgba(255,255,255,0.45));
}

.download-toast-done-text {
  font-size: 0.75rem;
  color: var(--lg-success, #4caf50);
}
.download-toast-error-text {
  font-size: 0.75rem;
  color: var(--lg-danger, #ff3b3b);
}
.download-toast-overflow {
  text-align: center;
  font-size: 0.75rem;
  color: var(--lg-text-tertiary, rgba(255,255,255,0.45));
  padding: 4px 0;
}

/* 移动端 toast 全宽 */
@media (max-width: 480px) {
  .download-toast {
    left: 8px;
    right: 8px;
    top: 8px;
    width: auto;
    max-width: none;
  }
}
```

- [ ] **Step 4: 验证编译**

```bash
cd client && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add client/src/components/drive/DownloadToast.tsx client/src/types/drive.ts client/src/styles/globals.css
git commit -m "feat(drive): 新增 DownloadToast 下载进度弹窗组件"
```

---

### Task 4: DrivePage 集成 DownloadToast

**Files:**
- Modify: `client/src/pages/DrivePage.tsx` — handleDownload 改为向 DownloadTask 状态推数据

**Interfaces:**
- Consumes: `DownloadTask` (Task 3), `DownloadToast` 组件

- [ ] **Step 1: 引入 DownloadTask 状态和 DownloadToast 组件**

```typescript
// client/src/pages/DrivePage.tsx — 顶部新增导入
import DownloadToast from '../components/drive/DownloadToast'
import type { DownloadTask } from '../types/drive'

// 在组件内新增 state
const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([])
const downloadIdRef = useRef(0)  // 自增 ID 生成
const abortControllersRef = useRef<Map<string, AbortController>>(new Map())
```

- [ ] **Step 2: 重写 handleDownload**

```typescript
// client/src/pages/DrivePage.tsx — 替换 handleDownload

const handleDownload = useCallback(async (item: DriveItem) => {
  if (item.isFolder) return

  const id = `dl-${++downloadIdRef.current}`
  const abortController = new AbortController()
  abortControllersRef.current.set(id, abortController)

  // 初始化下载任务
  setDownloadTasks(prev => [...prev, {
    id,
    fileName: item.name,
    loaded: 0,
    total: 0,
    speed: 0,
    status: 'downloading',
  }])

  try {
    const token = localStorage.getItem('lineweb_token')
    const res = await fetch(`/api/drive/download/${item.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: abortController.signal,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || '下载失败')
    }

    const contentLength = parseInt(res.headers.get('X-Content-Length') || '0', 10)
    const reader = res.body!.getReader()
    const chunks: Uint8Array[] = []
    let loaded = 0
    const startTime = Date.now()
    let lastUpdate = startTime
    let lastLoaded = 0
    let bytesSinceLastProgress = 0

    // 计算进度更新阈值（至少 256KB 或 2%）
    const minProgressDelta = contentLength > 0
      ? Math.max(256 * 1024, Math.round(contentLength * 0.02))
      : 256 * 1024

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      chunks.push(value)
      loaded += value.length
      bytesSinceLastProgress += value.length
      const now = Date.now()

      // 每 200ms 或每积累足够数据更新一次
      if (now - lastUpdate > 200 || bytesSinceLastProgress >= minProgressDelta) {
        const windowSpeed = (loaded - lastLoaded) / ((now - lastUpdate) / 1000)
        lastUpdate = now
        lastLoaded = loaded
        bytesSinceLastProgress = 0

        setDownloadTasks(prev =>
          prev.map(t => t.id === id ? {
            ...t,
            loaded,
            total: contentLength || loaded,
            speed: windowSpeed,
          } : t)
        )
      }
    }

    // 下载完成 — 创建 Blob 并触发浏览器下载
    const blob = new Blob(chunks as BlobPart[], { type: item.mimeType || undefined })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = item.name
    a.click()
    URL.revokeObjectURL(url)

    // 标记完成
    setDownloadTasks(prev =>
      prev.map(t => t.id === id ? { ...t, status: 'complete', loaded, total: contentLength || loaded } : t)
    )

    // 3 秒后自动移除已完成任务
    setTimeout(() => {
      setDownloadTasks(prev => prev.filter(t => t.id !== id))
    }, 3000)
  } catch (err: any) {
    if (err.name === 'AbortError') {
      setDownloadTasks(prev =>
        prev.map(t => t.id === id ? { ...t, status: 'cancelled' } : t)
      )
    } else {
      setDownloadTasks(prev =>
        prev.map(t => t.id === id ? { ...t, status: 'error', error: err.message } : t)
      )
    }
    // 错误状态 5 秒后移除
    setTimeout(() => {
      setDownloadTasks(prev => prev.filter(t => t.id !== id))
    }, 5000)
  } finally {
    abortControllersRef.current.delete(id)
  }
}, [])
```

- [ ] **Step 3: 处理取消回调**

```typescript
// client/src/pages/DrivePage.tsx — 添加取消处理

const handleCancelDownload = useCallback((id: string) => {
  abortControllersRef.current.get(id)?.abort()
  abortControllersRef.current.delete(id)
}, [])
```

- [ ] **Step 4: 在 JSX 中渲染 DownloadToast**

```tsx
// client/src/pages/DrivePage.tsx — 在 </div> 闭合前添加

      {/* 下载进度弹窗 */}
      <DownloadToast
        tasks={downloadTasks}
        onCancel={handleCancelDownload}
      />
    </div>
  )
}
```

完整 JSX 位置：在现有 `</LiquidGlass>` 关闭后，`</div>` 之前。即第 309 行 `</LiquidGlass>` 之后、第 336 行 `</div>` 之前。

- [ ] **Step 5: 清理已完成的下载任务（优化内存）**

注意：`completed` 和 `error` 状态的任务会在 3-5 秒后自动从数组中移除，Toast 自动隐藏。

- [ ] **Step 6: 验证编译**

```bash
cd client && npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add client/src/pages/DrivePage.tsx
git commit -m "feat(drive): 集成 DownloadToast 下载进度弹窗，替换 console.log"
```

---

## Self-Review

### 1. Spec Coverage

| 需求 | 覆盖任务 | 说明 |
|------|---------|------|
| 下载速度优化（服务器端） | Task 1 | WS 块合并缓冲，减少 HTTP write 次数 |
| 下载速度优化（协议侧） | Task 1 + 2 | `read_file` 命令附带 `chunkSize` 提示节点；`X-Chunk-Size` 响应头 |
| 前端下载进度弹窗 | Task 3 + 4 | DownloadToast 组件，Liquid Glass 风格，实时速度/进度/ETA/取消 |
| 液态玻璃效果 | Task 3 | CSS `backdrop-filter: blur(20px) saturate(180%)` + `lg-glass-*` 变量 |

### 2. Placeholder Scan

- [x] 无 "TBD" / "TODO" / "implement later" 等占位符
- [x] 每步代码完整
- [x] 所有类型和方法命名跨任务一致

### 3. Type Consistency

- `DownloadTask` 在 `types/drive.ts` 定义，Task 3 和 Task 4 共用
- `DownloadToastProps` 在 `DownloadToast.tsx` 定义
- `handleDownload` 签名不变（`(item: DriveItem) => void`），仅内部实现改变
- `streamRead` 返回类型不变（`AsyncGenerator<Buffer>`）

### 4. 边界情况

- 页面卸载时未完成的下载会被 `AbortController` 自动取消
- 完成/错误/取消状态的任务在超时后自动移除，避免内存泄漏
- 移动端 toast 自适应全宽
- 并发下载：每个下载独立 id + AbortController，互不干扰
