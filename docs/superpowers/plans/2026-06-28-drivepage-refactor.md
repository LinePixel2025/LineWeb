# DrivePage 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 703 行的单文件 DrivePage 拆分为 `components/drive/` 下的专注组件，新增列表/网格双视图，统一 Liquid Glass 设计风格。

**架构：** DrivePage 精简为状态容器，子组件通过 props 接收数据 + 回调。所有 CSS 写入 `globals.css`，零 inline style。后端 API 不修改。

**Tech Stack:** React 19 + TypeScript 5 + Liquid Glass CSS 设计系统

## Global Constraints

- 所有 CSS 只改 `client/src/styles/globals.css` 一个文件
- 按钮使用 `LiquidButton` 组件，variant: `primary` / `glass` / `ghost` / `danger`
- 玻璃容器使用 `LiquidGlass` 组件
- 输入框使用 `lg-input` CSS 类
- 使用项目已有的 `api.get<T>()` / `api.post<T>()` / `api.put<T>()` / `api.delete<T>()` 封装（`client/src/lib/api.ts`）
- 不引入新 npm 依赖
- 不修改后端 API / 数据库
- 深色/亮色主题跟随系统 CSS 变量

---

### 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| Create | `client/src/types/drive.ts` | DriveItem + DriveBreadcrumb 类型定义 |
| Create | `client/src/components/drive/DriveToolbar.tsx` | 标题 + 搜索 + 视图切换 + 面包屑 + 操作按钮 |
| Create | `client/src/components/drive/DriveListView.tsx` | 列表视图（三列：名称/大小/日期） |
| Create | `client/src/components/drive/DriveGridView.tsx` | 网格卡片视图 |
| Create | `client/src/components/drive/UploadZone.tsx` | 拖拽上传区域 |
| Create | `client/src/components/drive/DriveDialogs.tsx` | 新建文件夹/重命名/删除弹窗 |
| Create | `client/src/components/drive/DrivePreview.tsx` | 图片/视频预览 Lightbox |
| Modify | `client/src/pages/DrivePage.tsx` | 精简为状态容器 |
| Modify | `client/src/styles/globals.css` | 清理旧 drive-* 类，添加新 CSS |

---

### Task 1: 提取类型定义和辅助函数

**Files:**
- Create: `client/src/types/drive.ts`

**Interfaces:**
- Consumes: none
- Produces: `DriveItem`, `Breadcrumb`, `formatFileSize()`, `getFileIcon()`, `formatDate()`, `getMimeDisplay()` — 被所有后续任务使用

- [ ] **Step 1: 创建类型文件**

```typescript
// client/src/types/drive.ts

export interface DriveItem {
  id: number
  name: string
  isFolder: boolean
  parentId: number | null
  size: number
  mimeType: string | null
  createdAt: string
  updatedAt: string
  uploadedBy?: { id: number; username: string }
}

export interface Breadcrumb {
  id: number | null
  name: string
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function getFileIcon(item: DriveItem): string {
  if (item.isFolder) return '📁'
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
  const mime = (item.mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️'
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return '🎬'
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵'
  if (mime.includes('pdf') || ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext)) return '📑'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️'
  if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) return '💻'
  return '📄'
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function getMimeDisplay(mimeType: string | null, isFolder: boolean): string {
  if (isFolder) return '文件夹'
  if (!mimeType) return '文件'
  const parts = mimeType.split('/')
  return parts[1]?.toUpperCase() || '文件'
}
```

- [ ] **Step 2: 验证文件语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0, no errors

- [ ] **Step 3: Commit**

```bash
git add client/src/types/drive.ts
git commit -m "refactor(drive): 提取 DriveItem 类型定义和辅助函数"
```

---

### Task 2: 实现 DriveToolbar

**Files:**
- Create: `client/src/components/drive/DriveToolbar.tsx`

**Interfaces:**
- Consumes: `Breadcrumb` (from `types/drive.ts`)
- Produces: `DriveToolbarProps`

```typescript
export interface DriveToolbarProps {
  breadcrumbs: Breadcrumb[]
  searchQuery: string
  searching: boolean
  searchResultCount: number | null  // null if not searching
  viewMode: 'list' | 'grid'
  onSearch: (query: string) => void
  onNavigate: (index: number) => void
  onToggleView: () => void
  onNewFolder: () => void
  onUpload: () => void
}
```

- [ ] **Step 1: 创建 DriveToolbar 组件文件**

```tsx
// client/src/components/drive/DriveToolbar.tsx

import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { Breadcrumb } from '../../types/drive'

export interface DriveToolbarProps {
  breadcrumbs: Breadcrumb[]
  searchQuery: string
  searching: boolean
  searchResultCount: number | null
  viewMode: 'list' | 'grid'
  onSearch: (query: string) => void
  onNavigate: (index: number) => void
  onToggleView: () => void
  onNewFolder: () => void
  onUpload: () => void
}

const DriveToolbar = memo(function DriveToolbar({
  breadcrumbs,
  searchQuery,
  searching,
  searchResultCount,
  viewMode,
  onSearch,
  onNavigate,
  onToggleView,
  onNewFolder,
  onUpload,
}: DriveToolbarProps) {
  return (
    <div className="drive-toolbar">
      {/* Row 1: Title + Action buttons */}
      <div className="drive-toolbar-top">
        <h1 className="drive-toolbar-title">☁️ 网盘</h1>
        <div className="drive-toolbar-actions">
          <LiquidButton size="sm" variant="glass" onClick={onNewFolder}>
            📁 新建文件夹
          </LiquidButton>
          <LiquidButton size="sm" variant="primary" onClick={onUpload}>
            ⬆ 上传文件
          </LiquidButton>
        </div>
      </div>

      {/* Row 2: Search + View toggle */}
      <div className="drive-toolbar-middle">
        <div className="drive-toolbar-search">
          <input
            className="lg-input drive-toolbar-search-input"
            type="text"
            placeholder="🔍 搜索文件..."
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
          />
          {searchQuery && (
            <span className="drive-toolbar-search-hint">
              {searching
                ? '搜索中...'
                : searchResultCount !== null
                  ? `找到 ${searchResultCount} 项`
                  : ''}
            </span>
          )}
        </div>
        <button
          className={`drive-view-toggle ${viewMode === 'grid' ? 'drive-view-toggle--active' : ''}`}
          onClick={onToggleView}
          title={viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
        >
          {viewMode === 'list' ? '☰' : '▦'}
        </button>
      </div>

      {/* Row 3: Breadcrumbs */}
      <nav className="drive-toolbar-breadcrumbs">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="drive-breadcrumb-item">
            {i > 0 && <span className="drive-breadcrumb-sep">›</span>}
            {i === breadcrumbs.length - 1 ? (
              <span className="drive-breadcrumb-current">{crumb.name}</span>
            ) : (
              <button
                className="drive-breadcrumb-btn"
                onClick={() => onNavigate(i)}
              >
                {crumb.name}
              </button>
            )}
          </span>
        ))}
      </nav>
    </div>
  )
})

export default DriveToolbar
```

- [ ] **Step 2: 验证文件语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/components/drive/DriveToolbar.tsx
git commit -m "refactor(drive): 创建 DriveToolbar 组件"
```

---

### Task 3: 实现 DriveListView

**Files:**
- Create: `client/src/components/drive/DriveListView.tsx`

**Interfaces:**
- Consumes: `DriveItem`, `formatFileSize()`, `getFileIcon()`, `formatDate()`, `getMimeDisplay()` (from `types/drive.ts`)
- Produces: `DriveListViewProps`

```typescript
export interface DriveListViewProps {
  items: DriveItem[]
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}
```

- [ ] **Step 1: 创建 DriveListView 组件文件**

```tsx
// client/src/components/drive/DriveListView.tsx

import { memo, useState, useRef, useCallback } from 'react'
import LiquidButton from '../glass/LiquidButton'
import type { DriveItem } from '../../types/drive'
import { getFileIcon, formatFileSize, formatDate } from '../../types/drive'

export interface DriveListViewProps {
  items: DriveItem[]
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}

function DriveRow({
  item,
  index,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: {
  item: DriveItem
  index: number
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}) {
  return (
    <tr
      className="drive-row fade-in"
      style={{ animationDelay: `${index * 0.04}s` }}
    >
      <td className="drive-cell drive-cell--name">
        <span className="drive-cell-file">
          <span className="drive-cell-icon">{getFileIcon(item)}</span>
          {item.isFolder ? (
            <button
              className="drive-name-btn drive-name-btn--folder"
              onClick={() => onFolderClick(item)}
            >
              {item.name}
            </button>
          ) : (
            <button
              className="drive-name-btn"
              onClick={() => onRename(item)}
              title="点击重命名"
            >
              {item.name}
            </button>
          )}
        </span>
      </td>
      <td className="drive-cell drive-cell--size">
        {formatFileSize(Number(item.size))}
      </td>
      <td className="drive-cell drive-cell--date">
        {formatDate(item.updatedAt)}
      </td>
      <td className="drive-cell drive-cell--actions">
        <div className="drive-row-actions">
          {!item.isFolder && (
            <>
              <LiquidButton size="sm" variant="ghost" onClick={() => onPreview(item)}>
                预览
              </LiquidButton>
              <LiquidButton size="sm" variant="ghost" onClick={() => onDownload(item)}>
                下载
              </LiquidButton>
            </>
          )}
          <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}>
            删除
          </LiquidButton>
        </div>
      </td>
    </tr>
  )
}

const DriveListView = memo(function DriveListView({
  items,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: DriveListViewProps) {
  return (
    <div className="drive-table-wrap">
      <table className="drive-table">
        <thead>
          <tr>
            <th className="col-name">名称</th>
            <th className="col-size">大小</th>
            <th className="col-date">修改时间</th>
            <th className="col-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <DriveRow
              key={item.id}
              item={item}
              index={i}
              onFolderClick={onFolderClick}
              onPreview={onPreview}
              onDownload={onDownload}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
      <div className="drive-count">共 {items.length} 项</div>
    </div>
  )
})

export default DriveListView
```

- [ ] **Step 2: 验证文件语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/components/drive/DriveListView.tsx
git commit -m "refactor(drive): 创建 DriveListView 组件"
```

---

### Task 4: 实现 DriveGridView

**Files:**
- Create: `client/src/components/drive/DriveGridView.tsx`

**Interfaces:**
- Consumes: `DriveItem`, `getFileIcon()`, `formatFileSize()`, `formatDate()`
- Produces: `DriveGridViewProps` (same callbacks as DriveListViewProps)

- [ ] **Step 1: 创建 DriveGridView 组件文件**

```tsx
// client/src/components/drive/DriveGridView.tsx

import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { DriveItem } from '../../types/drive'
import { getFileIcon, formatFileSize, formatDate } from '../../types/drive'

export interface DriveGridViewProps {
  items: DriveItem[]
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}

const DriveGridView = memo(function DriveGridView({
  items,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: DriveGridViewProps) {
  return (
    <div className="drive-grid">
      {items.map((item, i) => (
        <LiquidGlass
          key={item.id}
          variant="strong"
          chromatic={false}
          className="drive-grid-card"
          style={{ animation: `fadeIn 0.35s ease-out ${i * 0.04}s both` }}
        >
          {/* Main click area */}
          <button
            className="drive-grid-card-body"
            onClick={() => item.isFolder ? onFolderClick(item) : onPreview(item)}
          >
            <span className="drive-grid-card-icon">
              {getFileIcon(item)}
            </span>
            <span className="drive-grid-card-name">{item.name}</span>
            <span className="drive-grid-card-meta">
              {formatFileSize(Number(item.size))}
            </span>
            <span className="drive-grid-card-date">
              {formatDate(item.updatedAt)}
            </span>
          </button>

          {/* Actions — shows on hover desktop, always on mobile */}
          <div className="drive-grid-card-actions">
            {!item.isFolder && (
              <>
                <LiquidButton size="sm" variant="ghost" onClick={() => onDownload(item)}>
                  下载
                </LiquidButton>
                <LiquidButton size="sm" variant="ghost" onClick={(e: React.MouseEvent) => {
                  e.stopPropagation()
                  onRename(item)
                }}>
                  重命名
                </LiquidButton>
              </>
            )}
            <LiquidButton size="sm" variant="danger" onClick={(e: React.MouseEvent) => {
              e.stopPropagation()
              onDelete(item)
            }}>
              删除
            </LiquidButton>
          </div>
        </LiquidGlass>
      ))}
    </div>
  )
})

export default DriveGridView
```

- [ ] **Step 2: 验证文件语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/components/drive/DriveGridView.tsx
git commit -m "refactor(drive): 创建 DriveGridView 组件"
```

---

### Task 5: 实现 UploadZone

**Files:**
- Create: `client/src/components/drive/UploadZone.tsx`

**Interfaces:**
- Consumes: `parentId: number | null`, `onUploaded: () => void`
- Produces: `UploadZoneProps`

- [ ] **Step 1: 创建 UploadZone 组件文件**

```tsx
// client/src/components/drive/UploadZone.tsx

import { useState, useRef, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'

export interface UploadZoneProps {
  parentId: number | null
  onUploaded: () => void
  onClose: () => void
}

const UploadZone = memo(function UploadZone({
  parentId,
  onUploaded,
  onClose,
}: UploadZoneProps) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true)
    const fileArray = Array.from(files)
    setProgress({ current: 0, total: fileArray.length })

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      const formData = new FormData()
      formData.append('file', file)
      if (parentId !== null) {
        formData.append('parentId', String(parentId))
      }

      try {
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
      } catch (err: any) {
        alert(`上传失败: ${file.name}\n${err.message}`)
      }
      setProgress({ current: i + 1, total: fileArray.length })
    }

    setUploading(false)
    setProgress(null)
    onUploaded()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files)
    }
  }

  return (
    <div className="upload-zone-wrapper">
      <div className="upload-zone-header">
        <LiquidButton size="sm" variant="primary" onClick={() => fileInputRef.current?.click()}>
          ⬆ 选择文件
        </LiquidButton>
        <LiquidButton size="sm" variant="ghost" onClick={onClose}>
          取消
        </LiquidButton>
      </div>
      {!uploading && (
        <div
          className={`upload-zone-drop ${dragOver ? 'upload-zone-drop--drag' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <span className="upload-zone-drop-icon">📂</span>
          <span className="upload-zone-drop-text">拖拽文件到此处或点击选择</span>
          <span className="upload-zone-drop-hint">支持多文件上传，单个文件最大 500MB</span>
        </div>
      )}
      {uploading && progress && (
        <div className="upload-zone-progress">
          <span className="upload-zone-progress-text">
            ⏳ 上传中... {progress.current}/{progress.total}
          </span>
          <div className="upload-zone-progress-bar">
            <div
              className="upload-zone-progress-fill"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="upload-zone-hidden-input"
        onChange={handleFileSelect}
      />
    </div>
  )
})

export default UploadZone
```

- [ ] **Step 2: 验证文件语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/components/drive/UploadZone.tsx
git commit -m "refactor(drive): 创建 UploadZone 组件"
```

---

### Task 6: 实现 DriveDialogs

**Files:**
- Create: `client/src/components/drive/DriveDialogs.tsx`

**Interfaces:**
- Consumes: `DriveItem` (from `types/drive.ts`)

- [ ] **Step 1: 创建 DriveDialogs 组件文件**

```tsx
// client/src/components/drive/DriveDialogs.tsx

import { useState, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import api from '../../lib/api'
import type { DriveItem } from '../../types/drive'

/* ---------- New Folder Dialog ---------- */

export interface NewFolderDialogProps {
  parentId: number | null
  onCreated: () => void
  onClose: () => void
}

export const NewFolderDialog = memo(function NewFolderDialog({
  parentId,
  onCreated,
  onClose,
}: NewFolderDialogProps) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/drive/folders', { name: name.trim(), parentId })
      onCreated()
    } catch (err: any) {
      setError(err.message || '创建失败')
      setLoading(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3 className="dialog-title">新建文件夹</h3>
        {error && <p className="dialog-error">{error}</p>}
        <input
          className="lg-input dialog-input"
          type="text"
          placeholder="文件夹名称"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          autoFocus
        />
        <div className="dialog-actions">
          <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
          <LiquidButton size="sm" variant="primary" onClick={handleCreate} disabled={loading || !name.trim()}>
            {loading ? '创建中...' : '创建'}
          </LiquidButton>
        </div>
      </div>
    </div>
  )
})

/* ---------- Rename Dialog ---------- */

export interface RenameDialogProps {
  item: DriveItem
  onRenamed: () => void
  onClose: () => void
}

export const RenameDialog = memo(function RenameDialog({
  item,
  onRenamed,
  onClose,
}: RenameDialogProps) {
  const [name, setName] = useState(item.name)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRename = async () => {
    if (!name.trim() || name.trim() === item.name) {
      onClose()
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.put(`/drive/files/${item.id}`, { name: name.trim() })
      onRenamed()
    } catch (err: any) {
      setError(err.message || '重命名失败')
      setLoading(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3 className="dialog-title">重命名</h3>
        {error && <p className="dialog-error">{error}</p>}
        <input
          className="lg-input dialog-input"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRename()}
          autoFocus
        />
        <div className="dialog-actions">
          <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
          <LiquidButton size="sm" variant="primary" onClick={handleRename} disabled={loading || !name.trim()}>
            {loading ? '保存中...' : '保存'}
          </LiquidButton>
        </div>
      </div>
    </div>
  )
})

/* ---------- Delete Dialog ---------- */

export interface DeleteDialogProps {
  item: DriveItem
  onDeleted: () => void
  onClose: () => void
}

export const DeleteDialog = memo(function DeleteDialog({
  item,
  onDeleted,
  onClose,
}: DeleteDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setLoading(true)
    setError('')
    try {
      await api.delete(`/drive/files/${item.id}`)
      onDeleted()
    } catch (err: any) {
      setError(err.message || '删除失败')
      setLoading(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={e => e.stopPropagation()}>
        <h3 className="dialog-title">确认删除</h3>
        {error && <p className="dialog-error">{error}</p>}
        <p className="dialog-desc">
          确定要删除 {item.isFolder ? '文件夹' : '文件'} <strong>{item.name}</strong> 吗？
          {item.isFolder && <><br/>文件夹内的所有内容将一并删除。</>}
        </p>
        <p className="dialog-warn">此操作不可撤销。</p>
        <div className="dialog-actions">
          <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
          <LiquidButton size="sm" variant="danger" onClick={handleDelete} disabled={loading}>
            {loading ? '删除中...' : '确认删除'}
          </LiquidButton>
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 2: 验证文件语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/components/drive/DriveDialogs.tsx
git commit -m "refactor(drive): 创建 DriveDialogs 组件"
```

---

### Task 7: 实现 DrivePreview

**Files:**
- Create: `client/src/components/drive/DrivePreview.tsx`

**Interfaces:**
- Consumes: `DriveItem`

- [ ] **Step 1: 创建 DrivePreview 组件文件**

```tsx
// client/src/components/drive/DrivePreview.tsx

import { useState, useEffect, memo } from 'react'
import type { DriveItem } from '../../types/drive'

export interface DrivePreviewProps {
  item: DriveItem
  onClose: () => void
}

/* ---------- Image Preview ---------- */

const ImagePreview = memo(function ImagePreview({ item, onClose }: DrivePreviewProps) {
  const [loading, setLoading] = useState(true)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl: string | null = null
    const fetchImage = async () => {
      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch(`/api/drive/download/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('加载失败')
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchImage()
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item.id])

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container" onClick={e => e.stopPropagation()}>
        {loading && <div className="spinner" />}
        {error && <p className="preview-error">{error}</p>}
        {src && (
          <img
            src={src}
            alt={item.name}
            className="preview-image"
          />
        )}
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>
  )
})

/* ---------- Video Preview ---------- */

const VideoPreview = memo(function VideoPreview({ item, onClose }: DrivePreviewProps) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl: string | null = null
    const loadVideo = async () => {
      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch(`/api/drive/download/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('加载失败')
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (err: any) {
        setError(err.message)
      }
    }
    loadVideo()
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item.id])

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container preview-container--video" onClick={e => e.stopPropagation()}>
        {error ? (
          <p className="preview-error">{error}</p>
        ) : src ? (
          <video controls autoPlay className="preview-video" src={src} />
        ) : (
          <div className="spinner" />
        )}
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>
  )
})

/* ---------- DrivePreview Router ---------- */

const DrivePreview = memo(function DrivePreview({ item, onClose }: DrivePreviewProps) {
  const mime = (item.mimeType || '').toLowerCase()
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return <ImagePreview item={item} onClose={onClose} />
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
    return <VideoPreview item={item} onClose={onClose} />
  }
  return null
})

export default DrivePreview
```

- [ ] **Step 2: 验证文件语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0

- [ ] **Step 3: Commit**

```bash
git add client/src/components/drive/DrivePreview.tsx
git commit -m "refactor(drive): 创建 DrivePreview 组件"
```

---

### Task 8: 重写 DrivePage 为主状态容器

**Files:**
- Rewrite: `client/src/pages/DrivePage.tsx`

**Interfaces:**
- Consumes: all components from Tasks 2-7
- Produces: the main DrivePage component

- [ ] **Step 1: 重写 DrivePage.tsx**

```tsx
import { useState, useEffect, useCallback, useRef } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import DriveToolbar from '../components/drive/DriveToolbar'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import { NewFolderDialog, RenameDialog, DeleteDialog } from '../components/drive/DriveDialogs'
import api, { ApiError } from '../lib/api'
import type { DriveItem, Breadcrumb } from '../types/drive'

export default function DrivePage() {
  const [items, setItems] = useState<DriveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DriveItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: null, name: '根目录' }])
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null

  // Modal states
  const [showUpload, setShowUpload] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<DriveItem | null>(null)
  const [renameItem, setRenameItem] = useState<DriveItem | null>(null)

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetchItems = useCallback(async (parentId: number | null) => {
    setLoading(true)
    setError('')
    try {
      const params = parentId !== null ? `?parentId=${parentId}` : ''
      const data = await api.get<DriveItem[]>(`/drive/files${params}`)
      setItems(data)
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems(currentParentId)
  }, [currentParentId, fetchItems])

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      setSearching(false)
      return
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await api.get<DriveItem[]>(`/drive/search?q=${encodeURIComponent(searchQuery)}`)
        setSearchResults(data)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery])

  const navigateToFolder = (item: DriveItem) => {
    if (!item.isFolder) return
    setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])
    setSearchQuery('')
    setSearchResults(null)
  }

  const navigateToBreadcrumb = (index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1))
    setSearchQuery('')
    setSearchResults(null)
  }

  const handleDownload = async (item: DriveItem) => {
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
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || '下载失败')
    }
  }

  const handlePreview = (item: DriveItem) => {
    if (item.isFolder) return
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ||
        mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      setPreviewItem(item)
    } else {
      handleDownload(item)
    }
  }

  const displayItems = searchResults !== null ? searchResults : items
  const isSearching = searchResults !== null
  const refresh = () => fetchItems(currentParentId)

  return (
    <div className="page container drive-page">
      <LiquidGlass variant="blur" className="page-card" style={{ padding: '24px' }}>
        <DriveToolbar
          breadcrumbs={breadcrumbs}
          searchQuery={searchQuery}
          searching={searching}
          searchResultCount={searchResults?.length ?? null}
          viewMode={viewMode}
          onSearch={setSearchQuery}
          onNavigate={navigateToBreadcrumb}
          onToggleView={() => setViewMode(v => v === 'list' ? 'grid' : 'list')}
          onNewFolder={() => setShowNewFolder(true)}
          onUpload={() => setShowUpload(true)}
        />

        {/* Upload Zone */}
        {showUpload && (
          <UploadZone
            parentId={currentParentId}
            onUploaded={() => { refresh(); setShowUpload(false) }}
            onClose={() => setShowUpload(false)}
          />
        )}

        {/* Content */}
        {loading ? (
          <div className="drive-loading"><div className="spinner" /></div>
        ) : error ? (
          <LiquidGlass variant="blur" className="drive-state-card">
            <p className="drive-state-text">⚠️ {error}</p>
            <LiquidButton size="sm" variant="glass" onClick={refresh}>重试</LiquidButton>
          </LiquidGlass>
        ) : displayItems.length === 0 ? (
          <LiquidGlass variant="blur" className="drive-state-card">
            <span className="drive-state-icon">☁️</span>
            <p className="drive-state-text">
              {isSearching ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
            </p>
          </LiquidGlass>
        ) : viewMode === 'list' ? (
          <DriveListView
            items={displayItems}
            onFolderClick={navigateToFolder}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onRename={setRenameItem}
            onDelete={setDeleteItem}
          />
        ) : (
          <DriveGridView
            items={displayItems}
            onFolderClick={navigateToFolder}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onRename={setRenameItem}
            onDelete={setDeleteItem}
          />
        )}
      </LiquidGlass>

      {/* Modal overlays */}
      {previewItem && (
        <DrivePreview item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
      {showNewFolder && (
        <NewFolderDialog
          parentId={currentParentId}
          onCreated={() => { refresh(); setShowNewFolder(false) }}
          onClose={() => setShowNewFolder(false)}
        />
      )}
      {renameItem && (
        <RenameDialog
          item={renameItem}
          onRenamed={() => { setRenameItem(null); refresh() }}
          onClose={() => setRenameItem(null)}
        />
      )}
      {deleteItem && (
        <DeleteDialog
          item={deleteItem}
          onDeleted={() => { setDeleteItem(null); refresh() }}
          onClose={() => setDeleteItem(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证语法**

Run: `npx tsc --noEmit --pretty`
Expected: Exit 0

- [ ] **Step 3: 验证 app 路由仍能解析 DrivePage 导出**

```bash
cd client && npx vite build --logLevel error 2>&1 | tail -5
```
Expected: `✓ built in X.XXs`

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/DrivePage.tsx
git commit -m "refactor(drive): 重写 DrivePage 为主状态容器"
```

---

### Task 9: 更新 CSS

**Files:**
- Modify: `client/src/styles/globals.css`

**Changes:**
- 删除旧的 `.drive-*` 类
- 添加新的 `.drive-toolbar*`、`.drive-grid*`、`.drive-row-actions`、`.upload-zone*`、`.dialog*`、`.preview*`、`.drive-state*` 等类
- 添加移动端响应式规则

- [ ] **Step 1: 删除旧 CSS (globals.css 中 drive- 相关)**

找到并删除以下范围的 CSS（约 3256 行到 3611 行之间的全部 `.drive-*` 和 `.dialog-overlay` 规则）：

替换范围：
```
.drive-page {
  animation: glassRise 0.6s cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
...
@media (max-width: 480px) {
  .drive-table th.col-size,
  .drive-cell--size {
    display: none;
  }
}
```
替换为下方的新 CSS（见 Step 2）。

- [ ] **Step 2: 添加新 CSS**

在之前旧 CSS 的位置替换为：

```css
/* ============================================================
   Drive — File Manager
   ============================================================ */

.drive-page {
  animation: glassRise 0.6s cubic-bezier(0.25, 0.1, 0.25, 1) both;
}
.drive-page .page-card {
  min-height: 360px;
}

/* Toolbar */
.drive-toolbar {
  margin-bottom: 20px;
}
.drive-toolbar-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.drive-toolbar-title {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 600;
}
.drive-toolbar-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.drive-toolbar-middle {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.drive-toolbar-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}
.drive-toolbar-search-input {
  max-width: 400px;
  box-sizing: border-box;
}
.drive-toolbar-search-hint {
  font-size: 0.8rem;
  color: var(--lg-text-tertiary);
  white-space: nowrap;
}

/* View toggle */
.drive-view-toggle {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--lg-glass-border);
  border-radius: var(--lg-radius-sm);
  background: rgba(255,255,255,0.04);
  color: var(--lg-text-secondary);
  cursor: pointer;
  font-size: 1rem;
  transition: all 0.15s;
  flex-shrink: 0;
}
.drive-view-toggle:hover {
  background: rgba(255,255,255,0.08);
  color: var(--lg-text-primary);
}
.drive-view-toggle--active {
  background: var(--lg-accent-soft);
  color: var(--lg-accent);
  border-color: var(--lg-accent);
}

/* Breadcrumbs */
.drive-toolbar-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: wrap;
  font-size: 0.875rem;
  color: var(--lg-text-secondary);
}
.drive-breadcrumb-item {
  display: flex;
  align-items: center;
  gap: 0;
}
.drive-breadcrumb-sep {
  opacity: 0.4;
  margin: 0 4px;
  user-select: none;
}
.drive-breadcrumb-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--lg-text-secondary);
  padding: 2px 4px;
  font-size: inherit;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
  font-family: var(--lg-font);
}
.drive-breadcrumb-btn:hover {
  color: var(--lg-accent);
  background: rgba(255,255,255,0.04);
}
.drive-breadcrumb-current {
  color: var(--lg-text);
  font-weight: 500;
  padding: 2px 4px;
}

/* Table view */
.drive-table-wrap {
  margin: 0 -24px;
  padding: 0 24px;
  overflow-x: auto;
}
.drive-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.drive-table thead {
  border-bottom: 1px solid var(--lg-border);
}
.drive-table th {
  text-align: left;
  padding: 10px 12px;
  font-weight: 500;
  font-size: 0.78rem;
  color: var(--lg-text-tertiary);
  white-space: nowrap;
}
.drive-table th.col-name { width: auto; min-width: 160px; }
.drive-table th.col-size { width: 100px; text-align: right; }
.drive-table th.col-date { width: 130px; }
.drive-table th.col-actions { width: 160px; text-align: right; }

.drive-row {
  border-bottom: 1px solid var(--lg-glass-border);
  transition: background 0.15s;
}
.drive-row:last-child {
  border-bottom: none;
}
.drive-row:hover {
  background: rgba(255,255,255,0.03);
}
.drive-cell {
  padding: 10px 12px;
  vertical-align: middle;
}
.drive-cell--name {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.drive-cell-file {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}
.drive-cell-icon {
  flex-shrink: 0;
  font-size: 1.1rem;
}
.drive-cell--size {
  text-align: right;
  color: var(--lg-text-secondary);
  font-size: 0.85rem;
  white-space: nowrap;
}
.drive-cell--date {
  color: var(--lg-text-secondary);
  font-size: 0.85rem;
  white-space: nowrap;
}
.drive-cell--actions {
  text-align: right;
}

/* Row actions — hidden by default, show on hover (desktop) */
.drive-row-actions {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  opacity: 0;
  transition: opacity 0.15s;
}
.drive-row:hover .drive-row-actions {
  opacity: 1;
}

/* File name button */
.drive-name-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  font-size: inherit;
  font-family: var(--lg-font);
  padding: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}
.drive-name-btn:hover {
  color: var(--lg-accent);
}
.drive-name-btn--folder {
  font-weight: 500;
}

/* Count */
.drive-count {
  padding: 10px 12px 4px;
  font-size: 0.8rem;
  color: var(--lg-text-tertiary);
}

/* Grid view */
.drive-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 14px;
}
.drive-grid-card {
  border-radius: var(--lg-radius-md) !important;
  overflow: hidden;
}
.drive-grid-card-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  padding: 24px 16px 16px;
  width: 100%;
  border: none;
  background: none;
  color: inherit;
  cursor: pointer;
  font-family: var(--lg-font);
}
.drive-grid-card-icon {
  font-size: 2.5rem;
  line-height: 1;
  margin-bottom: 6px;
}
.drive-grid-card-name {
  font-size: 0.85rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.drive-grid-card-meta {
  font-size: 0.75rem;
  color: var(--lg-text-secondary);
}
.drive-grid-card-date {
  font-size: 0.7rem;
  color: var(--lg-text-tertiary);
}

/* Grid card actions — hidden by default */
.drive-grid-card-actions {
  display: flex;
  gap: 4px;
  padding: 8px 12px 12px;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.drive-grid-card:hover .drive-grid-card-actions {
  opacity: 1;
}

/* State cards (empty/error) */
.drive-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 60px 0;
}
.drive-state-card {
  padding: 48px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--lg-text-tertiary);
}
.drive-state-icon {
  font-size: 2.5rem;
}
.drive-state-text {
  font-size: 0.9rem;
  margin: 0;
}

/* Upload zone */
.upload-zone-wrapper {
  margin-bottom: 16px;
}
.upload-zone-header {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.upload-zone-drop {
  border: 2px dashed var(--lg-glass-border);
  border-radius: var(--lg-radius-md);
  padding: 36px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--lg-text-tertiary);
}
.upload-zone-drop:hover {
  border-color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
.upload-zone-drop--drag {
  border-color: var(--lg-accent);
  background: var(--lg-accent-soft);
}
.upload-zone-drop-icon {
  font-size: 2rem;
}
.upload-zone-drop-text {
  font-size: 0.9rem;
  color: var(--lg-text-secondary);
}
.upload-zone-drop-hint {
  font-size: 0.75rem;
}
.upload-zone-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}
.upload-zone-progress-text {
  font-size: 0.85rem;
  color: var(--lg-text-secondary);
}
.upload-zone-progress-bar {
  height: 6px;
  background: var(--lg-glass-bg);
  border-radius: 9999px;
  overflow: hidden;
}
.upload-zone-progress-fill {
  height: 100%;
  background: var(--lg-accent);
  border-radius: 9999px;
  transition: width 0.3s;
}
.upload-zone-hidden-input {
  display: none;
}

/* Dialogs */
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  animation: fadeIn 0.15s ease-out;
}
.dialog {
  background: var(--lg-glass-bg);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--lg-glass-border);
  border-radius: var(--lg-radius-md);
  padding: 28px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.dialog-title {
  margin: 0 0 16px;
  font-size: 1.1rem;
  font-weight: 600;
}
.dialog-error {
  color: var(--lg-danger);
  font-size: 0.85rem;
  margin: 0 0 12px;
}
.dialog-input {
  width: 100%;
  box-sizing: border-box;
  margin-bottom: 16px;
}
.dialog-desc {
  font-size: 0.9rem;
  color: var(--lg-text-secondary);
  margin: 0 0 8px;
  line-height: 1.5;
}
.dialog-warn {
  font-size: 0.8rem;
  color: var(--lg-danger);
  margin: 0 0 20px;
}
.dialog-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

/* Preview overlay */
.preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.85);
  animation: fadeIn 0.15s ease-out;
  cursor: zoom-out;
}
.preview-container {
  position: relative;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}
.preview-container--video {
  max-width: 85vw;
  max-height: 85vh;
}
.preview-image {
  max-width: 100%;
  max-height: 85vh;
  border-radius: var(--lg-radius-md);
  object-fit: contain;
}
.preview-video {
  max-width: 100%;
  max-height: 80vh;
  border-radius: var(--lg-radius-md);
}
.preview-close {
  position: absolute;
  top: -40px;
  right: 0;
  background: none;
  border: none;
  color: #fff;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 4px 8px;
  opacity: 0.7;
  transition: opacity 0.15s;
}
.preview-close:hover {
  opacity: 1;
}
.preview-error {
  color: #fff;
  font-size: 1rem;
}

/* Mobile responsive */
@media (max-width: 768px) {
  .drive-toolbar-top {
    flex-direction: column;
    align-items: stretch;
  }
  .drive-toolbar-actions {
    justify-content: stretch;
  }
  .drive-toolbar-actions .liquid-btn {
    flex: 1;
    justify-content: center;
  }
  .drive-toolbar-search-input {
    max-width: 100%;
  }
  .drive-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }

  /* Actions always visible on mobile */
  .drive-row-actions {
    opacity: 1;
    flex-direction: column;
    gap: 4px;
  }
  .drive-row-actions .liquid-btn {
    width: 100%;
    justify-content: center;
  }
  .drive-grid-card-actions {
    opacity: 1;
  }

  /* Hide date on narrow mobile */
  .drive-table th.col-date,
  .drive-cell--date {
    display: none;
  }
}

@media (max-width: 480px) {
  .drive-table th.col-size,
  .drive-cell--size {
    display: none;
  }
  .drive-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
}
```

- [ ] **Step 3: 验证构建**

```bash
cd client && npx vite build --logLevel error 2>&1 | tail -5
```
Expected: `✓ built in X.XXs`

- [ ] **Step 4: Commit**

```bash
git add client/src/styles/globals.css
git commit -m "refactor(drive): 更新网盘 CSS — 新组件样式 + 响应式"
```

---

- [ ] **Final step: 完整构建验证**

```bash
cd client && npx tsc --noEmit --pretty 2>&1 | tail -20
```
Expected: Exit 0, no errors

```bash
cd client && npx vite build 2>&1 | tail -10
```
Expected: `✓ built in X.XXs`
