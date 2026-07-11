# Task 12: 实现缩略图支持

## 项目上下文
这是网盘前端界面重构项目的第十二步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-11已完成基础架构和UI组件。

## 任务目标
实现缩略图支持，为图片和视频文件显示缩略图预览。

## 文件列表
- Create: `client/src/hooks/useThumbnails.ts`
- Create: `client/src/components/drive/ThumbnailGrid.tsx`
- Modify: `client/src/components/drive/DriveGridView.tsx`
- Test: `client/src/hooks/__tests__/useThumbnails.test.ts`

## 接口定义
- Consumes: `api` - 获取缩略图数据
- Produces: `useThumbnails` hook - 缩略图加载逻辑

## 详细步骤

### Step 1: 创建useThumbnails.ts

创建 `client/src/hooks/useThumbnails.ts` 文件：

```typescript
import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../lib/api'

export interface ThumbnailOptions {
  size?: 'small' | 'medium' | 'large'
  quality?: number
}

export interface ThumbnailState {
  url: string | null
  loading: boolean
  error: boolean
}

export function useThumbnails(fileIds: number[], options: ThumbnailOptions = {}) {
  const { size = 'medium', quality = 0.8 } = options
  const [thumbnails, setThumbnails] = useState<Map<number, ThumbnailState>>(new Map())
  const cacheRef = useRef<Map<number, string>>(new Map())

  const loadThumbnail = useCallback(async (fileId: number) => {
    // 检查缓存
    const cached = cacheRef.current.get(fileId)
    if (cached) {
      setThumbnails(prev => new Map(prev).set(fileId, {
        url: cached,
        loading: false,
        error: false
      }))
      return
    }

    // 设置加载状态
    setThumbnails(prev => new Map(prev).set(fileId, {
      url: null,
      loading: true,
      error: false
    }))

    try {
      const response = await api.get<{ url: string }>(`/drive/thumbnails/${fileId}?size=${size}&quality=${quality}`)
      
      // 缓存结果
      cacheRef.current.set(fileId, response.url)
      
      setThumbnails(prev => new Map(prev).set(fileId, {
        url: response.url,
        loading: false,
        error: false
      }))
    } catch (error) {
      console.error(`Failed to load thumbnail for file ${fileId}:`, error)
      setThumbnails(prev => new Map(prev).set(fileId, {
        url: null,
        loading: false,
        error: true
      }))
    }
  }, [size, quality])

  useEffect(() => {
    // 加载所有文件的缩略图
    fileIds.forEach(fileId => {
      if (!thumbnails.has(fileId)) {
        loadThumbnail(fileId)
      }
    })
  }, [fileIds, loadThumbnail])

  const getThumbnail = useCallback((fileId: number): ThumbnailState => {
    return thumbnails.get(fileId) || { url: null, loading: false, error: false }
  }, [thumbnails])

  const clearCache = useCallback(() => {
    cacheRef.current.clear()
  }, [])

  return {
    getThumbnail,
    clearCache
  }
}
```

### Step 2: 创建ThumbnailGrid.tsx

创建 `client/src/components/drive/ThumbnailGrid.tsx` 文件：

```typescript
import { memo } from 'react'
import { useThumbnails } from '../../hooks/useThumbnails'
import type { DriveItem } from '../../types/drive'

export interface ThumbnailGridProps {
  items: DriveItem[]
  size?: 'small' | 'medium' | 'large'
}

const ThumbnailGrid = memo(function ThumbnailGrid({ items, size = 'medium' }: ThumbnailGridProps) {
  // 只为图片和视频文件加载缩略图
  const fileIds = items
    .filter(item => {
      if (item.isFolder) return false
      const mime = (item.mimeType || '').toLowerCase()
      const ext = item.name.split('.').pop()?.toLowerCase() || ''
      return mime.startsWith('image/') || mime.startsWith('video/') ||
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm'].includes(ext)
    })
    .map(item => item.id)

  const { getThumbnail } = useThumbnails(fileIds, { size })

  return (
    <div className="thumbnail-grid">
      {items.map(item => {
        if (item.isFolder) {
          return (
            <div key={item.id} className="thumbnail-item thumbnail-item--folder">
              <span className="thumbnail-icon">📁</span>
            </div>
          )
        }

        const thumbnail = getThumbnail(item.id)
        const mime = (item.mimeType || '').toLowerCase()
        const isVideo = mime.startsWith('video/')

        return (
          <div key={item.id} className="thumbnail-item">
            {thumbnail.loading ? (
              <div className="thumbnail-loading">
                <div className="thumbnail-spinner" />
              </div>
            ) : thumbnail.url ? (
              <div className="thumbnail-preview">
                <img
                  src={thumbnail.url}
                  alt={item.name}
                  className="thumbnail-image"
                  loading="lazy"
                />
                {isVideo && (
                  <div className="thumbnail-video-badge">
                    <span>▶</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="thumbnail-fallback">
                <span className="thumbnail-icon">
                  {isVideo ? '🎬' : '📄'}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

export default ThumbnailGrid
```

### Step 3: 添加ThumbnailGrid样式到drive.css

在 `client/src/styles/drive.css` 文件中添加缩略图样式：
- .thumbnail-grid
- .thumbnail-item
- .thumbnail-item--folder
- .thumbnail-preview
- .thumbnail-image
- .thumbnail-loading
- .thumbnail-spinner
- .thumbnail-fallback
- .thumbnail-icon
- .thumbnail-video-badge

### Step 4: 更新DriveGridView使用ThumbnailGrid

修改 `client/src/components/drive/DriveGridView.tsx` 文件：
- 导入ThumbnailGrid组件
- 在网格视图中使用ThumbnailGrid显示缩略图

### Step 5: 创建测试文件

创建 `client/src/hooks/__tests__/useThumbnails.test.ts` 文件，包含以下测试用例：
- 初始状态为空
- 加载缩略图后返回URL
- 加载失败后返回错误状态
- 缓存机制

### Step 6: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 7: 提交代码

```bash
git add client/src/hooks/useThumbnails.ts client/src/components/drive/ThumbnailGrid.tsx client/src/components/drive/DriveGridView.tsx client/src/styles/drive.css client/src/hooks/__tests__/useThumbnails.test.ts
git commit -m "feat(drive): implement thumbnail support"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useState和useEffect管理缩略图状态
- 使用useRef实现缓存机制
- 支持图片和视频文件的缩略图
- 提供加载状态和错误状态
- 使用memo包装组件避免不必要的重渲染