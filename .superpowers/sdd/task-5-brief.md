# Task 5: 创建PathBar路径栏组件

## 项目上下文
这是网盘前端界面重构项目的第五步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-4已完成基础架构和TreeView组件。

## 任务目标
创建PathBar路径栏组件，用于显示当前完整路径，支持点击导航和路径编辑模式。

## 文件列表
- Create: `client/src/components/drive/PathBar.tsx`
- Modify: `client/src/pages/DrivePage.tsx`
- Test: `client/src/components/drive/__tests__/PathBar.test.tsx`

## 接口定义
- Consumes: `useDrive` - 获取当前路径和导航方法
- Produces: `PathBar` component - 路径栏组件

## 详细步骤

### Step 1: 创建PathBar.tsx

创建 `client/src/components/drive/PathBar.tsx` 文件：

```typescript
import { useState, useCallback, memo } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import type { Breadcrumb } from '../../types/drive'

export interface PathBarProps {
  onNavigate?: (path: Breadcrumb[]) => void
}

const PathBar = memo(function PathBar({ onNavigate }: PathBarProps) {
  const { state, navigateToBreadcrumb, navigateTo } = useDrive()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')

  const handleBreadcrumbClick = useCallback((index: number) => {
    navigateToBreadcrumb(index)
    onNavigate?.(state.currentPath.slice(0, index + 1))
  }, [navigateToBreadcrumb, onNavigate, state.currentPath])

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true)
    setEditValue(state.currentPath.map(p => p.name).join('/'))
  }, [state.currentPath])

  const handleEditSubmit = useCallback(() => {
    setIsEditing(false)
    // TODO: 解析路径并导航
    console.log('Navigate to:', editValue)
  }, [editValue])

  const handleEditCancel = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit()
    } else if (e.key === 'Escape') {
      handleEditCancel()
    }
  }, [handleEditSubmit, handleEditCancel])

  return (
    <nav className="path-bar" onDoubleClick={handleDoubleClick}>
      {isEditing ? (
        <div className="path-bar-edit">
          <input
            type="text"
            className="path-bar-input"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleEditSubmit}
            autoFocus
          />
        </div>
      ) : (
        <div className="path-bar-breadcrumbs">
          {state.currentPath.map((crumb, index) => (
            <span key={crumb.id ?? 'root'} className="path-bar-item">
              {index > 0 && <span className="path-bar-separator">/</span>}
              {index === state.currentPath.length - 1 ? (
                <span className="path-bar-current">{crumb.name}</span>
              ) : (
                <button
                  className="path-bar-link"
                  onClick={() => handleBreadcrumbClick(index)}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      
      <div className="path-bar-actions">
        <button
          className="path-bar-action"
          onClick={() => handleBreadcrumbClick(state.currentPath.length - 2)}
          disabled={state.currentPath.length <= 1}
          title="返回上级"
        >
          ←
        </button>
        <button
          className="path-bar-action"
          onClick={() => window.location.reload()}
          title="刷新"
        >
          ↻
        </button>
      </div>
    </nav>
  )
})

export default PathBar
```

### Step 2: 添加PathBar样式到drive.css

在 `client/src/styles/drive.css` 文件中添加路径栏样式：
- .path-bar
- .path-bar-breadcrumbs
- .path-bar-item
- .path-bar-separator
- .path-bar-link
- .path-bar-current
- .path-bar-edit
- .path-bar-input
- .path-bar-actions
- .path-bar-action

### Step 3: 更新DrivePage使用PathBar

修改 `client/src/pages/DrivePage.tsx` 文件：
- 导入PathBar组件
- 在主内容区使用PathBar替换占位符

### Step 4: 创建测试文件

创建 `client/src/components/drive/__tests__/PathBar.test.tsx` 文件，包含以下测试用例：
- 渲染根路径
- 返回上级按钮在根路径时禁用

### Step 5: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 6: 提交代码

```bash
git add client/src/components/drive/PathBar.tsx client/src/pages/DrivePage.tsx client/src/styles/drive.css client/src/components/drive/__tests__/PathBar.test.tsx
git commit -m "feat(drive): add PathBar component for breadcrumb navigation"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useDrive hook获取当前路径和导航方法
- 支持点击面包屑导航
- 支持双击进入编辑模式
- 支持键盘Enter/Escape提交/取消编辑
- 使用memo包装组件避免不必要的重渲染