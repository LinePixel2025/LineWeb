# 网盘文件同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现定时同步机制，使数据库内的文件记录与存储节点（Storage Node）磁盘上的实际文件保持一致。

**架构：** 利用存储节点已有的 `list_dir` 命令递归获取文件列表，与服务端数据库记录对比，清理/修复不一致的记录。通过 `setInterval` 在服务端定期触发。

**Tech Stack:** Express 4 + Prisma 6 + WebSocket (storageTunnel) + Node.js

## Global Constraints

- 不修改 storage-node Python 代码（改用递归调用 `list_dir` 遍历）
- 不修改 Prisma schema
- 不引入新 npm 依赖
- 默认同步间隔 5 分钟，可通过环境变量 `DRIVE_SYNC_INTERVAL_MS` 配置

---

### 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| Create | `server/src/services/storageSync.ts` | 同步服务 — 递归遍历 + DB 对比 + 清理修复 |
| Modify | `server/src/services/storageTunnel.ts` | 添加 `listDirRecursive()` 函数 |
| Modify | `server/src/index.ts` | 启动时注册同步定时器 |
| Modify | `server/src/config/index.ts` | 添加 `driveSyncIntervalMs` 配置项 |

---

### Task 1: 添加递归列出存储节点文件功能

**Files:**
- Modify: `server/src/services/storageTunnel.ts`

**Interfaces:**
- Produces: `listDirRecursive(rootPath: string): Promise<string[]>` — 递归遍历存储节点文件路径列表

- [ ] **Step 1: 添加 listDirRecursive 函数**

在 `server/src/services/storageTunnel.ts` 末尾、`export function isNodeConnected` 之前插入：

```typescript
/**
 * 递归列出存储节点上所有文件路径（不包含文件夹路径）
 * 通过逐层调用 list_dir 实现
 */
export async function listDirRecursive(rootPath: string = ''): Promise<string[]> {
  const result: string[] = []
  const pending = [rootPath]

  while (pending.length > 0) {
    const dir = pending.pop()!
    const resp = await sendCommand({ type: 'list_dir', path: dir || '.' })

    if (!resp.success || !Array.isArray(resp.data)) {
      console.warn(`listDirRecursive: 无法列出 ${dir}: ${resp.error}`)
      continue
    }

    for (const item of resp.data) {
      const itemPath = dir ? `${dir}/${item.name}` : item.name
      if (item.isFolder) {
        pending.push(itemPath)
      } else {
        result.push(itemPath)
      }
    }
  }

  return result
}
```

- [ ] **Step 2: 验证编译**

Run: `cd server && npx tsc --noEmit --pretty 2>&1 | tail -10`
Expected: Exit 0, no errors

- [ ] **Step 3: Commit**

```bash
git add server/src/services/storageTunnel.ts
git commit -m "feat(drive): 添加 listDirRecursive 递归列出存储节点文件"
```

---

### Task 2: 创建同步服务

**Files:**
- Create: `server/src/services/storageSync.ts`

**Interfaces:**
- Consumes: `prisma` (from `lib/prisma.js`), `listDirRecursive`, `sendCommand`, `isNodeConnected` (from `storageTunnel.js`)
- Produces: `syncDriveFiles(): Promise<SyncReport>` — 执行一次同步，返回报告

- [ ] **Step 1: 创建 storageSync.ts**

```typescript
// server/src/services/storageSync.ts

import prisma from '../lib/prisma.js'
import { listDirRecursive, sendCommand, isNodeConnected } from './storageTunnel.js'

export interface SyncReport {
  scanned: number        // 存储节点文件数
  dbRecords: number      // 同步前数据库记录数
  orphansRemoved: number // DB 中有但节点上已不存在的文件记录数
  missingCreated: number // 节点中有但 DB 缺少的记录数（已修复）
  errors: string[]       // 同步过程中的错误
  durationMs: number
}

/**
 * 执行一次网盘文件同步：
 * 1. 检查存储节点连接
 * 2. 递归列出节点上的所有文件
 * 3. 对比数据库记录
 * 4. 清理孤立的数据库记录（节点上已不存在的文件）
 * 5. 为节点上存在但数据库缺失的文件创建记录
 */
export async function syncDriveFiles(): Promise<SyncReport> {
  const start = Date.now()
  const report: SyncReport = {
    scanned: 0,
    dbRecords: 0,
    orphansRemoved: 0,
    missingCreated: 0,
    errors: [],
    durationMs: 0,
  }

  if (!isNodeConnected()) {
    report.errors.push('存储节点未连接，跳过同步')
    report.durationMs = Date.now() - start
    return report
  }

  try {
    // 1. 递归列出存储节点所有文件路径
    const nodePaths = await listDirRecursive('')
    report.scanned = nodePaths.length

    // 2. 获取数据库所有非文件夹记录
    const dbFiles = await prisma.driveFile.findMany({
      where: { isFolder: false },
      select: { id: true, storagePath: true, name: true },
    })
    report.dbRecords = dbFiles.length

    // 建立 storagePath → dbFile 映射（便于查找）
    const dbPathMap = new Map(dbFiles.map(f => [f.storagePath, f]))

    // 3. 找出节点上已有的路径集合
    const nodePathSet = new Set(nodePaths)

    // 4. 清理孤立记录：DB 有但节点上没有的文件
    const orphans = dbFiles.filter(f => !nodePathSet.has(f.storagePath))
    for (const orphan of orphans) {
      try {
        await prisma.driveFile.delete({ where: { id: orphan.id } })
        report.orphansRemoved++
        console.log(`[Sync] 删除孤立记录: ${orphan.name} (${orphan.storagePath})`)
      } catch (err: any) {
        report.errors.push(`删除孤立记录失败: ${orphan.storagePath} — ${err.message}`)
      }
    }

    // 5. 修复缺失记录：节点上有但 DB 中没有的文件（仅修复非文件夹文件）
    //    通过 sendCommand({ type: 'stat' }) 获取文件信息
    for (const nodePath of nodePaths) {
      if (dbPathMap.has(nodePath)) continue

      try {
        const statResp = await sendCommand({ type: 'stat', path: nodePath })
        if (!statResp.success || !statResp.data) continue

        const info = statResp.data
        // 从路径中推断父文件夹路径和文件名
        const parts = nodePath.split('/')
        const fileName = parts.pop() || nodePath

        // 查找或创建父文件夹路径对应的 DB parentId
        let parentId: number | null = null
        if (parts.length > 0) {
          const parentPath = parts.join('/')
          const parentFolder = await prisma.driveFile.findFirst({
            where: { storagePath: parentPath, isFolder: true },
          })
          if (parentFolder) {
            parentId = parentFolder.id
          } else {
            // 父文件夹在 DB 中也缺失，跳过（由用户手动重新上传恢复）
            report.errors.push(`跳过 ${nodePath}: 父文件夹在数据库中不存在`)
            continue
          }
        }

        // 尝试找上传者（默认用第一个有网盘权限的用户）
        const uploader = await prisma.user.findFirst({
          where: { canAccessDrive: true },
          orderBy: { id: 'asc' },
          select: { id: true },
        })
        if (!uploader) {
          report.errors.push(`跳过 ${nodePath}: 未找到可用的上传者`)
          continue
        }

        await prisma.driveFile.create({
          data: {
            name: fileName,
            isFolder: false,
            parentId,
            size: BigInt(info.size || 0),
            mimeType: guessMimeType(fileName),
            storagePath: nodePath,
            uploadedById: uploader.id,
          },
        })
        report.missingCreated++
        console.log(`[Sync] 创建缺失记录: ${fileName} (${nodePath})`)
      } catch (err: any) {
        report.errors.push(`修复缺失记录失败: ${nodePath} — ${err.message}`)
      }
    }
  } catch (err: any) {
    report.errors.push(`同步失败: ${err.message}`)
  }

  report.durationMs = Date.now() - start
  console.log(`[Sync] 完成: 扫描 ${report.scanned} 项, `
    + `删除 ${report.orphansRemoved} 孤立记录, `
    + `创建 ${report.missingCreated} 缺失记录, `
    + `${report.errors.length} 错误, 耗时 ${report.durationMs}ms`)

  return report
}

/** 根据文件扩展名猜测 MIME 类型 */
function guessMimeType(name: string): string {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    bmp: 'image/bmp', mp4: 'video/mp4', webm: 'video/webm',
    avi: 'video/x-msvideo', mov: 'video/quicktime', mkv: 'video/x-matroska',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    flac: 'audio/flac', pdf: 'application/pdf',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    zip: 'application/zip', rar: 'application/vnd.rar',
    '7z': 'application/x-7z-compressed', tar: 'application/x-tar',
    gz: 'application/gzip', js: 'text/javascript',
    ts: 'text/typescript', py: 'text/x-python',
    html: 'text/html', css: 'text/css',
    json: 'application/json', txt: 'text/plain',
    md: 'text/markdown',
  }
  return mimeMap[ext] || 'application/octet-stream'
}
```

- [ ] **Step 2: 验证编译**

Run: `cd server && npx tsc --noEmit --pretty 2>&1 | tail -10`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add server/src/services/storageSync.ts
git commit -m "feat(drive): 创建 storageSync 同步服务"
```

---

### Task 3: 集成同步定时器到服务启动

**Files:**
- Modify: `server/src/config/index.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: 添加配置项**

在 `server/src/config/index.ts` 的 config 对象中添加：

```typescript
driveSyncIntervalMs: parseInt(process.env.DRIVE_SYNC_INTERVAL_MS || '300000', 10), // 默认 5 分钟
```

- [ ] **Step 2: 在 index.ts 中启动同步定时器**

在 `server/src/index.ts` 中，`initStorageTunnel(server)` 之后、`server.listen()` 之前，以及文件顶部导入：

```typescript
import { syncDriveFiles } from './services/storageSync.js'

// ... (existing code)
initStorageTunnel(server)

// 网盘文件定期同步
const syncInterval = setInterval(() => {
  syncDriveFiles().catch(err => console.error('[Sync] 定时同步失败:', err))
}, config.driveSyncIntervalMs)

// 启动后立即执行一次同步（延迟 10 秒等节点连接）
setTimeout(() => {
  console.log(`[Sync] 首次同步 (间隔: ${config.driveSyncIntervalMs}ms)`)
  syncDriveFiles().catch(err => console.error('[Sync] 首次同步失败:', err))
}, 10000)

// 在进程退出时清理定时器
process.on('SIGTERM', () => clearInterval(syncInterval))
process.on('SIGINT', () => clearInterval(syncInterval))
```

- [ ] **Step 3: 暴露健康检查端点返回同步状态（可选）**

在 `server/src/index.ts` 的 `/api/health` 端点中添加同步状态信息：

```typescript
import { getSyncStatus } from './services/storageSync.js'

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    drive: getSyncStatus ? undefined : undefined,  // 将在 Task 2 中添加
  })
})
```

实际上，在上面的 health 端点中简化为：

```typescript
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})
```

不需要修改 health 端点以免引入耦合。

- [ ] **Step 4: 验证编译 + 启动测试**

```bash
cd server && npx tsc --noEmit --pretty 2>&1
```
Expected: Exit 0

手动验证服务启动后控制台输出包含 `[Sync] 首次同步` 日志。

- [ ] **Step 5: Commit**

```bash
git add server/src/config/index.ts server/src/index.ts
git commit -m "feat(drive): 集成文件同步定时器 — 启动后每 5 分钟同步一次"
```

---

### Task 4: 全量验证

- [ ] **Step 1: 完整 TypeScript 检查**

```bash
cd server && npx tsc --noEmit --pretty 2>&1
```
Expected: Exit 0

- [ ] **Step 2: 启动服务验证同步日志**

```bash
cd server && npm run dev
```
Expected: 10 秒后看到 `[Sync] 首次同步` 日志

- [ ] **Step 3: 推送 GitHub**

```bash
git push origin master
```
