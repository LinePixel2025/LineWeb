# Task 10: 实现快捷键支持

## 项目上下文
这是网盘前端界面重构项目的第十步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-9已完成基础架构和UI组件。

## 任务目标
实现快捷键支持，提高文件操作效率。

## 文件列表
- Create: `client/src/hooks/useKeyboardShortcuts.ts`
- Modify: `client/src/pages/DrivePage.tsx`
- Test: `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts`

## 接口定义
- Consumes: `useDrive` - 获取当前状态和操作方法
- Produces: `useKeyboardShortcuts` hook - 快捷键逻辑hook

## 详细步骤

### Step 1: 创建useKeyboardShortcuts.ts

创建 `client/src/hooks/useKeyboardShortcuts.ts` 文件：

```typescript
import { useEffect, useCallback } from 'react'
import { useDrive } from '../contexts/DriveContext'

export interface KeyboardShortcutsOptions {
  onDelete?: () => void
  onRename?: () => void
  onNewFolder?: () => void
  onUpload?: () => void
  onRefresh?: () => void
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions = {}) {
  const { state, selectAll, clearSelection, navigateToBreadcrumb } = useDrive()
  const { onDelete, onRename, onNewFolder, onUpload, onRefresh } = options

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // 忽略输入框中的快捷键
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }

    const isCtrl = e.ctrlKey || e.metaKey

    // Ctrl+A: 全选
    if (isCtrl && e.key === 'a') {
      e.preventDefault()
      // 需要当前文件夹的文件ID列表，这里暂时为空
      // 实际实现需要从DrivePage传递文件列表
      selectAll([])
    }

    // Ctrl+Z: 撤销（暂未实现）
    if (isCtrl && e.key === 'z') {
      e.preventDefault()
      // TODO: 实现撤销功能
    }

    // Ctrl+Y: 重做（暂未实现）
    if (isCtrl && e.key === 'y') {
      e.preventDefault()
      // TODO: 实现重做功能
    }

    // Delete: 删除
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedFiles.length > 0) {
        e.preventDefault()
        onDelete?.()
      }
    }

    // F2: 重命名
    if (e.key === 'F2') {
      if (state.selectedFiles.length === 1) {
        e.preventDefault()
        onRename?.()
      }
    }

    // Enter: 打开选中项
    if (e.key === 'Enter') {
      if (state.selectedFiles.length === 1) {
        e.preventDefault()
        // 需要获取选中的文件信息，这里暂时为空
        // 实际实现需要从DrivePage传递文件列表
      }
    }

    // Escape: 取消选择
    if (e.key === 'Escape') {
      e.preventDefault()
      clearSelection()
    }

    // Ctrl+N: 新建文件夹
    if (isCtrl && e.key === 'n') {
      e.preventDefault()
      onNewFolder?.()
    }

    // Ctrl+F: 搜索（暂未实现）
    if (isCtrl && e.key === 'f') {
      e.preventDefault()
      // TODO: 聚焦搜索框
    }

    // Backspace: 返回上级
    if (e.key === 'Backspace' && !isCtrl) {
      if (state.currentPath.length > 1) {
        e.preventDefault()
        navigateToBreadcrumb(state.currentPath.length - 2)
      }
    }
  }, [state, selectAll, clearSelection, navigateToBreadcrumb, onDelete, onRename, onNewFolder, onUpload, onRefresh])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
```

### Step 2: 更新DrivePage使用useKeyboardShortcuts

修改 `client/src/pages/DrivePage.tsx` 文件：
- 导入useKeyboardShortcuts hook
- 使用hook并传入操作回调

### Step 3: 创建测试文件

创建 `client/src/hooks/__tests__/useKeyboardShortcuts.test.ts` 文件，包含以下测试用例：
- 按Delete键调用onDelete
- 按F2键调用onRename
- 按Escape键调用clearSelection
- 按Backspace键导航到上级目录

### Step 4: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 5: 提交代码

```bash
git add client/src/hooks/useKeyboardShortcuts.ts client/src/pages/DrivePage.tsx client/src/hooks/__tests__/useKeyboardShortcuts.test.ts
git commit -m "feat(drive): implement keyboard shortcuts"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useEffect监听keydown事件
- 忽略输入框中的快捷键
- 支持Ctrl/Mod键修饰符
- 提供onDelete、onRename等回调
- 使用useCallback包装事件处理函数