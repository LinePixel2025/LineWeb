# Task 8: 实现拖拽上传功能

## 项目上下文
这是网盘前端界面重构项目的第八步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-7已完成基础架构和UI组件。

## 任务目标
实现拖拽上传功能，支持将文件从系统文件管理器拖入网盘界面进行上传。

## 文件列表
- Create: `client/src/hooks/useDragAndDrop.ts`
- Modify: `client/src/components/drive/UploadZone.tsx`
- Test: `client/src/hooks/__tests__/useDragAndDrop.test.ts`

## 接口定义
- Consumes: `useDrive` - 获取当前路径
- Produces: `useDragAndDrop` hook - 拖拽逻辑hook

## 详细步骤

### Step 1: 创建useDragAndDrop.ts

创建 `client/src/hooks/useDragAndDrop.ts` 文件：

```typescript
import { useState, useCallback, useRef } from 'react'

export interface DragAndDropOptions {
  onFilesDropped?: (files: FileList) => void
  onDragStateChange?: (isDragging: boolean) => void
}

export interface DragAndDropReturn {
  isDragging: boolean
  dragProps: {
    onDragOver: (e: React.DragEvent) => void
    onDragEnter: (e: React.DragEvent) => void
    onDragLeave: (e: React.DragEvent) => void
    onDrop: (e: React.DragEvent) => void
  }
}

export function useDragAndDrop(options: DragAndDropOptions = {}): DragAndDropReturn {
  const { onFilesDropped, onDragStateChange } = options
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    dragCounterRef.current++
    
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true)
      onDragStateChange?.(true)
    }
  }, [onDragStateChange])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    dragCounterRef.current--
    
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
      onDragStateChange?.(false)
    }
  }, [onDragStateChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    setIsDragging(false)
    dragCounterRef.current = 0
    onDragStateChange?.(false)
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDropped?.(e.dataTransfer.files)
      e.dataTransfer.clearData()
    }
  }, [onFilesDropped, onDragStateChange])

  return {
    isDragging,
    dragProps: {
      onDragOver: handleDragOver,
      onDragEnter: handleDragEnter,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop
    }
  }
}
```

### Step 2: 更新UploadZone使用useDragAndDrop

修改 `client/src/components/drive/UploadZone.tsx` 文件：
- 导入useDragAndDrop hook
- 使用hook提供的dragProps替换原有的拖拽处理逻辑

### Step 3: 创建测试文件

创建 `client/src/hooks/__tests__/useDragAndDrop.test.ts` 文件，包含以下测试用例：
- 初始状态isDragging为false
- 拖拽进入时isDragging变为true
- 拖拽离开时isDragging变为false
- 放下文件时调用onFilesDropped

### Step 4: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 5: 提交代码

```bash
git add client/src/hooks/useDragAndDrop.ts client/src/components/drive/UploadZone.tsx client/src/hooks/__tests__/useDragAndDrop.test.ts
git commit -m "feat(drive): implement drag and drop upload functionality"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useState和useRef管理拖拽状态
- 处理dragCounter解决子元素触发的dragLeave问题
- 支持多文件拖拽
- 提供isDragging状态用于UI反馈
- 使用memo包装组件避免不必要的重渲染