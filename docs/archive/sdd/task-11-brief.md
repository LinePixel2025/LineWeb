# Task 11: 实现批量操作功能

## 项目上下文
这是网盘前端界面重构项目的第十一步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-10已完成基础架构和UI组件。

## 任务目标
实现批量操作功能，支持多选文件后进行批量下载、移动、删除、收藏等操作。

## 文件列表
- Create: `client/src/components/drive/BatchActions.tsx`
- Modify: `client/src/pages/DrivePage.tsx`
- Test: `client/src/components/drive/__tests__/BatchActions.test.tsx`

## 接口定义
- Consumes: `useDrive` - 获取选中文件状态和操作方法
- Produces: `BatchActions` component - 批量操作栏组件

## 详细步骤

### Step 1: 创建BatchActions.tsx

创建 `client/src/components/drive/BatchActions.tsx` 文件：

```typescript
import { memo, useCallback } from 'react'
import LiquidButton from '../glass/LiquidButton'
import { useDrive } from '../../contexts/DriveContext'

export interface BatchActionsProps {
  onBatchDownload?: () => void
  onBatchMove?: () => void
  onBatchDelete?: () => void
  onBatchFavorite?: () => void
  onClearSelection?: () => void
}

const BatchActions = memo(function BatchActions({
  onBatchDownload,
  onBatchMove,
  onBatchDelete,
  onBatchFavorite,
  onClearSelection
}: BatchActionsProps) {
  const { state } = useDrive()

  if (state.selectedFiles.length === 0) {
    return null
  }

  return (
    <div className="batch-actions">
      <div className="batch-actions-info">
        <span className="batch-actions-count">
          已选择 {state.selectedFiles.length} 个文件
        </span>
        <button
          className="batch-actions-clear"
          onClick={onClearSelection}
        >
          取消选择
        </button>
      </div>

      <div className="batch-actions-buttons">
        <LiquidButton size="sm" variant="glass" onClick={onBatchDownload}>
          ⬇ 批量下载
        </LiquidButton>
        <LiquidButton size="sm" variant="glass" onClick={onBatchMove}>
          📁 移动到
        </LiquidButton>
        <LiquidButton size="sm" variant="ghost" onClick={onBatchFavorite}>
          ⭐ 收藏
        </LiquidButton>
        <LiquidButton size="sm" variant="danger" onClick={onBatchDelete}>
          🗑️ 删除
        </LiquidButton>
      </div>
    </div>
  )
})

export default BatchActions
```

### Step 2: 添加BatchActions样式到drive.css

在 `client/src/styles/drive.css` 文件中添加批量操作样式：
- .batch-actions
- .batch-actions-info
- .batch-actions-count
- .batch-actions-clear
- .batch-actions-buttons

### Step 3: 更新DrivePage使用BatchActions

修改 `client/src/pages/DrivePage.tsx` 文件：
- 导入BatchActions组件
- 在Toolbar下方添加BatchActions
- 实现批量操作回调函数

### Step 4: 创建测试文件

创建 `client/src/components/drive/__tests__/BatchActions.test.tsx` 文件，包含以下测试用例：
- 没有选中文件时不显示
- 选中文件后显示操作栏
- 点击取消选择按钮调用onClearSelection
- 点击批量下载按钮调用onBatchDownload

### Step 5: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 6: 提交代码

```bash
git add client/src/components/drive/BatchActions.tsx client/src/pages/DrivePage.tsx client/src/styles/drive.css client/src/components/drive/__tests__/BatchActions.test.tsx
git commit -m "feat(drive): implement batch operations"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useDrive hook获取选中文件状态
- 只在选中文件数量大于0时显示
- 支持批量下载、移动、删除、收藏操作
- 显示选中文件数量和取消选择按钮
- 使用memo包装组件避免不必要的重渲染