# Task 9: 实现右键菜单增强

## 项目上下文
这是网盘前端界面重构项目的第九步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-8已完成基础架构和UI组件。

## 任务目标
实现增强型右键菜单，支持文件、文件夹和空白区域的不同菜单选项。

## 文件列表
- Create: `client/src/components/drive/ContextMenu.tsx`
- Modify: `client/src/components/drive/DriveListView.tsx`
- Modify: `client/src/components/drive/DriveGridView.tsx`
- Test: `client/src/components/drive/__tests__/ContextMenu.test.tsx`

## 接口定义
- Consumes: `useDrive` - 获取当前状态和操作方法
- Produces: `ContextMenu` component - 增强型右键菜单组件

## 详细步骤

### Step 1: 创建ContextMenu.tsx

创建 `client/src/components/drive/ContextMenu.tsx` 文件：

```typescript
import { useState, useEffect, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import type { DriveItem } from '../../types/drive'

export interface ContextMenuItem {
  label: string
  icon: string
  action: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}

export interface ContextMenuProps {
  item?: DriveItem | null
  position: { x: number; y: number }
  onClose: () => void
  onPreview?: (item: DriveItem) => void
  onDownload?: (item: DriveItem) => void
  onRename?: (item: DriveItem) => void
  onDelete?: (item: DriveItem) => void
  onFolderClick?: (item: DriveItem) => void
  onNewFolder?: () => void
  onUpload?: () => void
  onRefresh?: () => void
  onSelectAll?: () => void
}

const ContextMenu = memo(function ContextMenu({
  item,
  position,
  onClose,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  onFolderClick,
  onNewFolder,
  onUpload,
  onRefresh,
  onSelectAll
}: ContextMenuProps) {
  const [adjustedPos, setAdjustedPos] = useState(position)

  useEffect(() => {
    const menuWidth = 200
    const menuHeight = 300
    const padding = 8

    let x = position.x
    let y = position.y

    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding
    }

    setAdjustedPos({ x, y })
  }, [position])

  useEffect(() => {
    const handleClickOutside = () => onClose()
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('click', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('click', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const handleAction = useCallback((action: () => void) => {
    action()
    onClose()
  }, [onClose])

  const menuItems: ContextMenuItem[] = []

  if (item) {
    // 文件/文件夹菜单
    if (item.isFolder) {
      menuItems.push({
        label: '打开文件夹',
        icon: '📂',
        action: () => handleAction(() => onFolderClick?.(item))
      })
    }

    if (!item.isFolder) {
      const ext = item.name.split('.').pop()?.toLowerCase() || ''
      const mime = (item.mimeType || '').toLowerCase()
      const isPreviewable = mime.startsWith('image/') || mime.startsWith('video/') ||
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)

      if (isPreviewable) {
        menuItems.push({
          label: '预览',
          icon: '👁️',
          action: () => handleAction(() => onPreview?.(item))
        })
      }

      menuItems.push({
        label: '下载',
        icon: '⬇️',
        action: () => handleAction(() => onDownload?.(item))
      })
    }

    menuItems.push({
      label: '重命名',
      icon: '✏️',
      action: () => handleAction(() => onRename?.(item))
    })

    menuItems.push({
      label: '删除',
      icon: '🗑️',
      action: () => handleAction(() => onDelete?.(item)),
      variant: 'danger'
    })
  } else {
    // 空白区域菜单
    menuItems.push({
      label: '新建文件夹',
      icon: '📁',
      action: () => handleAction(() => onNewFolder?.())
    })

    menuItems.push({
      label: '上传文件',
      icon: '⬆️',
      action: () => handleAction(() => onUpload?.())
    })

    menuItems.push({
      label: '刷新',
      icon: '🔄',
      action: () => handleAction(() => onRefresh?.())
    })

    menuItems.push({
      label: '全选',
      icon: '☑️',
      action: () => handleAction(() => onSelectAll?.())
    })
  }

  return createPortal(
    <div
      className="context-menu"
      style={{
        position: 'fixed',
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 1100
      }}
      onClick={e => e.stopPropagation()}
    >
      {item && (
        <div className="context-menu-header">
          <span className="context-menu-icon">
            {item.isFolder ? '📁' : '📄'}
          </span>
          <span className="context-menu-name" title={item.name}>
            {item.name}
          </span>
        </div>
      )}
      {item && <div className="context-menu-divider" />}
      {menuItems.map((menuItem, index) => (
        <button
          key={index}
          className={`context-menu-item ${menuItem.variant === 'danger' ? 'context-menu-item--danger' : ''}`}
          onClick={() => menuItem.action()}
          disabled={menuItem.disabled}
        >
          <span className="context-menu-item-icon">{menuItem.icon}</span>
          <span className="context-menu-item-label">{menuItem.label}</span>
        </button>
      ))}
    </div>,
    document.body
  )
})

export default ContextMenu
```

### Step 2: 添加ContextMenu样式到drive.css

在 `client/src/styles/drive.css` 文件中添加右键菜单样式：
- .context-menu
- .context-menu-header
- .context-menu-icon
- .context-menu-name
- .context-menu-divider
- .context-menu-item
- .context-menu-item--danger
- .context-menu-item-icon
- .context-menu-item-label

### Step 3: 更新DriveListView使用ContextMenu

修改 `client/src/components/drive/DriveListView.tsx` 文件：
- 导入ContextMenu组件
- 添加右键菜单状态和处理逻辑
- 在文件行上添加onContextMenu事件

### Step 4: 更新DriveGridView使用ContextMenu

修改 `client/src/components/drive/DriveGridView.tsx` 文件：
- 导入ContextMenu组件
- 添加右键菜单状态和处理逻辑
- 在文件卡片上添加onContextMenu事件

### Step 5: 创建测试文件

创建 `client/src/components/drive/__tests__/ContextMenu.test.tsx` 文件，包含以下测试用例：
- 渲染文件菜单
- 渲染空白区域菜单
- 点击菜单项调用相应函数
- 按Escape键关闭菜单

### Step 6: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 7: 提交代码

```bash
git add client/src/components/drive/ContextMenu.tsx client/src/components/drive/DriveListView.tsx client/src/components/drive/DriveGridView.tsx client/src/styles/drive.css client/src/components/drive/__tests__/ContextMenu.test.tsx
git commit -m "feat(drive): implement enhanced context menu"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用createPortal渲染右键菜单到body
- 处理菜单位置调整，避免超出视口
- 支持文件/文件夹和空白区域的不同菜单选项
- 点击外部或按Escape键关闭菜单
- 使用memo包装组件避免不必要的重渲染