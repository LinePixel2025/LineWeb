# Task 3: 创建响应式布局框架

## 项目上下文
这是网盘前端界面重构项目的第三步。项目采用React 19 + TypeScript + Vite技术栈。Task 1已完成DriveContext状态管理，Task 2已完成useResponsive hook。

## 任务目标
创建响应式布局框架，实现桌面端三栏布局、平板端双栏布局、移动端单栏布局。

## 文件列表
- Create: `client/src/components/drive/DriveNavigation.tsx`
- Create: `client/src/components/drive/MobileNav.tsx`
- Create: `client/src/styles/drive.css`
- Modify: `client/src/pages/DrivePage.tsx`

## 接口定义
- Consumes: `DriveProvider`, `useResponsive`, `useDrive`
- Produces: 响应式三栏/双栏/单栏布局

## 详细步骤

### Step 1: 创建DriveNavigation.tsx

创建 `client/src/components/drive/DriveNavigation.tsx` 文件：

```typescript
import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import { useDrive } from '../../contexts/DriveContext'
import { useResponsive } from '../../hooks/useResponsive'

export interface DriveNavigationProps {
  collapsed?: boolean
  onToggleCollapse?: () => void
}

const DriveNavigation = memo(function DriveNavigation({ 
  collapsed = false, 
  onToggleCollapse 
}: DriveNavigationProps) {
  const { state } = useDrive()
  const { isMobile } = useResponsive()

  if (isMobile) {
    return null // 移动端使用底部导航
  }

  return (
    <aside className={`drive-sidebar ${collapsed ? 'drive-sidebar--collapsed' : ''}`}>
      <LiquidGlass variant="blur" chromatic={false} className="drive-sidebar-section">
        <div className="drive-sidebar-header">
          <h3 className="drive-sidebar-heading">导航</h3>
          {onToggleCollapse && (
            <button 
              className="drive-sidebar-toggle"
              onClick={onToggleCollapse}
              aria-label={collapsed ? '展开导航' : '折叠导航'}
            >
              {collapsed ? '→' : '←'}
            </button>
          )}
        </div>
        
        {/* 树形目录占位 */}
        <div className="drive-sidebar-tree">
          <p className="drive-sidebar-placeholder">树形目录将在此显示</p>
        </div>
      </LiquidGlass>

      {!collapsed && (
        <>
          <LiquidGlass variant="blur" chromatic={false} className="drive-sidebar-section">
            <h3 className="drive-sidebar-heading">收藏夹</h3>
            <div className="drive-sidebar-favorites">
              {state.favorites.length === 0 ? (
                <p className="drive-sidebar-placeholder">暂无收藏</p>
              ) : (
                state.favorites.map(fav => (
                  <div key={fav.id} className="drive-sidebar-favorite-item">
                    <span>📁</span>
                    <span>{fav.folderName}</span>
                  </div>
                ))
              )}
            </div>
          </LiquidGlass>

          <LiquidGlass variant="blur" chromatic={false} className="drive-sidebar-section drive-sidebar-storage">
            <h3 className="drive-sidebar-heading">存储空间</h3>
            <div className="drive-storage-bar">
              <div className="drive-storage-bar-track">
                <div className="drive-storage-bar-fill" style={{ width: '25%' }} />
              </div>
              <div className="drive-storage-bar-text">
                <span>2.5 GB</span>
                <span className="drive-storage-bar-sep">/</span>
                <span>10 GB</span>
              </div>
            </div>
          </LiquidGlass>
        </>
      )}
    </aside>
  )
})

export default DriveNavigation
```

### Step 2: 创建MobileNav.tsx

创建 `client/src/components/drive/MobileNav.tsx` 文件：

```typescript
import { memo } from 'react'

export interface MobileNavProps {
  activeTab: 'files' | 'favorites' | 'search' | 'settings'
  onTabChange: (tab: 'files' | 'favorites' | 'search' | 'settings') => void
}

const MobileNav = memo(function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  const tabs = [
    { id: 'files' as const, label: '文件', icon: '📁' },
    { id: 'favorites' as const, label: '收藏', icon: '⭐' },
    { id: 'search' as const, label: '搜索', icon: '🔍' },
    { id: 'settings' as const, label: '设置', icon: '⚙️' }
  ]

  return (
    <nav className="mobile-nav">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`mobile-nav-item ${activeTab === tab.id ? 'mobile-nav-item--active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="mobile-nav-icon">{tab.icon}</span>
          <span className="mobile-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
})

export default MobileNav
```

### Step 3: 创建drive.css基础样式

创建 `client/src/styles/drive.css` 文件，包含：
- 响应式布局样式（.drive-page, .drive-sidebar, .drive-main, .drive-detail-panel）
- 移动端导航样式（.mobile-nav）
- 侧边栏样式（.drive-sidebar-section, .drive-sidebar-heading等）
- 存储空间样式（.drive-storage-bar）
- 响应式媒体查询（平板端、移动端）

### Step 4: 重构DrivePage.tsx使用响应式布局

修改 `client/src/pages/DrivePage.tsx` 文件：
- 使用DriveProvider包装
- 使用useResponsive hook
- 使用DriveNavigation组件
- 使用MobileNav组件（移动端）
- 使用PathBar组件占位

### Step 5: 运行TypeScript检查

Run: `cd client && npx tsc --noEmit`
Expected: 无类型错误

### Step 6: 提交代码

```bash
git add client/src/pages/DrivePage.tsx client/src/components/drive/DriveNavigation.tsx client/src/components/drive/MobileNav.tsx client/src/styles/drive.css
git commit -m "feat(drive): implement responsive layout framework"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 支持亮色/暗色/跟随系统三种主题模式
- 响应式断点：桌面端≥1024px、平板端768-1023px、移动端<768px
- 所有现有功能必须正常工作

## 注意事项
- 使用useResponsive hook获取设备类型
- 桌面端显示三栏布局（侧边栏+主内容+详情面板）
- 平板端显示双栏布局（可折叠侧边栏+主内容）
- 移动端显示单栏布局（主内容+底部导航）
- 使用LiquidGlass组件保持设计语言一致性