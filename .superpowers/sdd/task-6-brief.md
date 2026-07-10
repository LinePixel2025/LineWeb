# Task 6: 创建TabList标签页组件

## 项目上下文
这是网盘前端界面重构项目的第六步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-5已完成基础架构。

## 任务目标
创建TabList标签页组件，用于在侧边栏显示已打开的文件夹标签，支持关闭和切换。

## 文件列表
- Create: `client/src/components/drive/TabList.tsx`
- Modify: `client/src/components/drive/DriveNavigation.tsx`
- Test: `client/src/components/drive/__tests__/TabList.test.tsx`

## 接口定义
- Consumes: `useDrive` - 获取标签页状态和操作方法
- Produces: `TabList` component - 标签页列表组件

## 详细步骤

### Step 1: 创建TabList.tsx

创建 `client/src/components/drive/TabList.tsx` 文件：

```typescript
import { memo, useCallback } from 'react'
import { useDrive } from '../../contexts/DriveContext'

export interface TabListProps {
  onTabSelect?: (tabId: string) => void
}

const TabList = memo(function TabList({ onTabSelect }: TabListProps) {
  const { state, setActiveTab, closeTab } = useDrive()

  const handleTabClick = useCallback((tabId: string) => {
    setActiveTab(tabId)
    onTabSelect?.(tabId)
  }, [setActiveTab, onTabSelect])

  const handleCloseClick = useCallback((e: React.MouseEvent, tabId: string) => {
    e.stopPropagation()
    closeTab(tabId)
  }, [closeTab])

  if (state.tabs.length <= 1) {
    return null // 只有一个标签时不显示
  }

  return (
    <div className="tab-list">
      <h4 className="tab-list-heading">打开的标签</h4>
      <div className="tab-list-items">
        {state.tabs.map(tab => (
          <div
            key={tab.id}
            className={`tab-item ${tab.id === state.activeTabId ? 'tab-item--active' : ''}`}
            onClick={() => handleTabClick(tab.id)}
          >
            <span className="tab-item-icon">📁</span>
            <span className="tab-item-name">{tab.folderName}</span>
            {state.tabs.length > 1 && (
              <button
                className="tab-item-close"
                onClick={(e) => handleCloseClick(e, tab.id)}
                aria-label={`关闭${tab.folderName}标签`}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

export default TabList
```

### Step 2: 更新DriveNavigation使用TabList

修改 `client/src/components/drive/DriveNavigation.tsx` 文件：
- 导入TabList组件
- 在侧边栏中添加TabList组件

### Step 3: 添加TabList样式到drive.css

在 `client/src/styles/drive.css` 文件中添加标签页样式：
- .tab-list
- .tab-list-heading
- .tab-list-items
- .tab-item
- .tab-item--active
- .tab-item-icon
- .tab-item-name
- .tab-item-close

### Step 4: 创建测试文件

创建 `client/src/components/drive/__tests__/TabList.test.tsx` 文件，包含以下测试用例：
- 只有一个标签时不显示
- 多个标签时显示列表
- 点击标签调用setActiveTab
- 点击关闭按钮调用closeTab

### Step 5: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 6: 提交代码

```bash
git add client/src/components/drive/TabList.tsx client/src/components/drive/DriveNavigation.tsx client/src/styles/drive.css client/src/components/drive/__tests__/TabList.test.tsx
git commit -m "feat(drive): add TabList component for tab navigation"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useDrive hook获取标签页状态和操作方法
- 只有一个标签时不显示标签列表
- 支持点击标签切换
- 支持关闭标签（最后一个标签不能关闭）
- 使用memo包装组件避免不必要的重渲染