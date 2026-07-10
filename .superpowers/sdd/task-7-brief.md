# Task 7: 创建Toolbar工具栏组件

## 项目上下文
这是网盘前端界面重构项目的第七步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-6已完成基础架构和导航组件。

## 任务目标
创建Toolbar工具栏组件，用于显示操作按钮（新建文件夹、上传、同步等）和视图切换。

## 文件列表
- Create: `client/src/components/drive/Toolbar.tsx`
- Modify: `client/src/pages/DrivePage.tsx`
- Test: `client/src/components/drive/__tests__/Toolbar.test.tsx`

## 接口定义
- Consumes: `useDrive` - 获取视图模式和操作方法
- Produces: `Toolbar` component - 工具栏组件

## 详细步骤

### Step 1: 创建Toolbar.tsx

创建 `client/src/components/drive/Toolbar.tsx` 文件：

```typescript
import { memo, useCallback } from 'react'
import LiquidButton from '../glass/LiquidButton'
import { useDrive } from '../../contexts/DriveContext'

export interface ToolbarProps {
  onNewFolder?: () => void
  onUpload?: () => void
  onSync?: () => void
  syncing?: boolean
}

const Toolbar = memo(function Toolbar({ 
  onNewFolder, 
  onUpload, 
  onSync, 
  syncing = false 
}: ToolbarProps) {
  const { state, setViewMode } = useDrive()

  const handleViewToggle = useCallback(() => {
    setViewMode(state.viewMode === 'list' ? 'grid' : 'list')
  }, [state.viewMode, setViewMode])

  return (
    <div className="toolbar">
      <div className="toolbar-actions">
        <LiquidButton size="sm" variant="glass" onClick={onNewFolder}>
          📁 新建
        </LiquidButton>
        <LiquidButton size="sm" variant="primary" onClick={onUpload}>
          ⬆ 上传
        </LiquidButton>
        <LiquidButton size="sm" variant="ghost" onClick={onSync} disabled={syncing}>
          {syncing ? '🔄 同步中...' : '🔄 同步'}
        </LiquidButton>
      </div>

      <div className="toolbar-controls">
        <button
          className={`toolbar-view-toggle ${state.viewMode === 'grid' ? 'toolbar-view-toggle--active' : ''}`}
          onClick={handleViewToggle}
          title={state.viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
        >
          {state.viewMode === 'list' ? '☰' : '▦'}
        </button>
      </div>
    </div>
  )
})

export default Toolbar
```

### Step 2: 添加Toolbar样式到drive.css

在 `client/src/styles/drive.css` 文件中添加工具栏样式：
- .toolbar
- .toolbar-actions
- .toolbar-controls
- .toolbar-view-toggle

### Step 3: 更新DrivePage使用Toolbar

修改 `client/src/pages/DrivePage.tsx` 文件：
- 导入Toolbar组件
- 在PathBar下方添加Toolbar

### Step 4: 创建测试文件

创建 `client/src/components/drive/__tests__/Toolbar.test.tsx` 文件，包含以下测试用例：
- 渲染工具栏
- 点击新建按钮调用onNewFolder
- 点击上传按钮调用onUpload
- 点击同步按钮调用onSync
- 点击视图切换按钮切换视图模式

### Step 5: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 6: 提交代码

```bash
git add client/src/components/drive/Toolbar.tsx client/src/pages/DrivePage.tsx client/src/styles/drive.css client/src/components/drive/__tests__/Toolbar.test.tsx
git commit -m "feat(drive): add Toolbar component for file operations"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useDrive hook获取视图模式和操作方法
- 使用LiquidButton组件保持设计语言一致性
- 支持新建文件夹、上传、同步操作
- 支持列表/网格视图切换
- 使用memo包装组件避免不必要的重渲染