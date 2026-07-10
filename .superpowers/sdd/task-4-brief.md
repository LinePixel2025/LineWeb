# Task 4: 创建TreeView树形目录组件

## 项目上下文
这是网盘前端界面重构项目的第四步。项目采用React 19 + TypeScript + Vite技术栈。Task 1-3已完成基础架构。

## 任务目标
创建TreeView树形目录组件，用于在侧边栏显示完整的文件夹层级结构，支持展开/折叠和导航。

## 文件列表
- Create: `client/src/components/drive/TreeView.tsx`
- Modify: `client/src/components/drive/DriveNavigation.tsx`
- Test: `client/src/components/drive/__tests__/TreeView.test.tsx`

## 接口定义
- Consumes: `useDrive` - 获取当前路径和导航方法
- Produces: `TreeView` component - 树形目录组件

## 详细步骤

### Step 1: 创建TreeView.tsx

创建 `client/src/components/drive/TreeView.tsx` 文件：

```typescript
import { useState, useCallback, memo } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import api from '../../lib/api'
import type { DriveItem } from '../../types/drive'

interface TreeNode {
  id: number | null
  name: string
  children: TreeNode[]
  isExpanded: boolean
  isLoading: boolean
  hasLoaded: boolean
}

export interface TreeViewProps {
  onFolderSelect?: (folderId: number | null, folderName: string) => void
}

const TreeView = memo(function TreeView({ onFolderSelect }: TreeViewProps) {
  const { state, navigateToFolder } = useDrive()
  const [tree, setTree] = useState<TreeNode>({
    id: null,
    name: '根目录',
    children: [],
    isExpanded: true,
    isLoading: false,
    hasLoaded: false
  })

  const loadChildren = useCallback(async (node: TreeNode) => {
    if (node.hasLoaded) return

    setTree(prev => {
      const updateNode = (n: TreeNode): TreeNode => {
        if (n.id === node.id) {
          return { ...n, isLoading: true }
        }
        return { ...n, children: n.children.map(updateNode) }
      }
      return updateNode(prev)
    })

    try {
      const params = new URLSearchParams()
      if (node.id !== null) params.set('parentId', String(node.id))
      params.set('limit', '100')
      
      const res = await api.get<{ data: DriveItem[] }>(`/drive/files?${params}`)
      const folders = res.data.filter(item => item.isFolder)
      
      setTree(prev => {
        const updateNode = (n: TreeNode): TreeNode => {
          if (n.id === node.id) {
            return {
              ...n,
              children: folders.map(folder => ({
                id: folder.id,
                name: folder.name,
                children: [],
                isExpanded: false,
                isLoading: false,
                hasLoaded: false
              })),
              isLoading: false,
              hasLoaded: true,
              isExpanded: true
            }
          }
          return { ...n, children: n.children.map(updateNode) }
        }
        return updateNode(prev)
      })
    } catch (error) {
      console.error('Failed to load children:', error)
      setTree(prev => {
        const updateNode = (n: TreeNode): TreeNode => {
          if (n.id === node.id) {
            return { ...n, isLoading: false }
          }
          return { ...n, children: n.children.map(updateNode) }
        }
        return updateNode(prev)
      })
    }
  }, [])

  const toggleExpand = useCallback(async (node: TreeNode) => {
    if (!node.isExpanded && !node.hasLoaded) {
      await loadChildren(node)
    } else {
      setTree(prev => {
        const updateNode = (n: TreeNode): TreeNode => {
          if (n.id === node.id) {
            return { ...n, isExpanded: !n.isExpanded }
          }
          return { ...n, children: n.children.map(updateNode) }
        }
        return updateNode(prev)
      })
    }
  }, [loadChildren])

  const handleFolderClick = useCallback((node: TreeNode) => {
    navigateToFolder(node.id, node.name)
    onFolderSelect?.(node.id, node.name)
  }, [navigateToFolder, onFolderSelect])

  const renderNode = (node: TreeNode, level: number = 0) => {
    const isActive = state.currentPath.some(p => p.id === node.id)
    const hasChildren = node.children.length > 0 || !node.hasLoaded

    return (
      <div key={node.id ?? 'root'} className="tree-node" style={{ paddingLeft: `${level * 16}px` }}>
        <div className={`tree-node-content ${isActive ? 'tree-node-content--active' : ''}`}>
          {hasChildren && (
            <button
              className="tree-node-expand"
              onClick={(e) => {
                e.stopPropagation()
                toggleExpand(node)
              }}
              disabled={node.isLoading}
            >
              {node.isLoading ? '⏳' : node.isExpanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <span className="tree-node-spacer" />}
          
          <button
            className="tree-node-label"
            onClick={() => handleFolderClick(node)}
          >
            <span className="tree-node-icon">📁</span>
            <span className="tree-node-name">{node.name}</span>
          </button>
        </div>
        
        {node.isExpanded && node.children.map(child => renderNode(child, level + 1))}
      </div>
    )
  }

  return (
    <div className="tree-view">
      {renderNode(tree)}
    </div>
  )
})

export default TreeView
```

### Step 2: 更新DriveNavigation使用TreeView

修改 `client/src/components/drive/DriveNavigation.tsx` 文件：
- 导入TreeView组件
- 在侧边栏中使用TreeView替换占位符

### Step 3: 添加TreeView样式到drive.css

在 `client/src/styles/drive.css` 文件中添加树形目录样式：
- .tree-view
- .tree-node
- .tree-node-content
- .tree-node-expand
- .tree-node-label
- .tree-node-icon
- .tree-node-name

### Step 4: 创建测试文件

创建 `client/src/components/drive/__tests__/TreeView.test.tsx` 文件，包含以下测试用例：
- 渲染根节点
- 点击展开按钮加载子节点
- 点击文件夹调用onFolderSelect

### Step 5: 运行测试验证

Run: `cd client && npm test -- --watchAll=false TreeView.test.tsx`
Expected: 所有测试通过

### Step 6: 提交代码

```bash
git add client/src/components/drive/TreeView.tsx client/src/components/drive/DriveNavigation.tsx client/src/styles/drive.css client/src/components/drive/__tests__/TreeView.test.tsx
git commit -m "feat(drive): add TreeView component for folder navigation"
```

## Global Constraints
- 保持Liquid Glass设计语言
- 所有现有功能必须正常工作

## 注意事项
- 使用useDrive hook获取当前路径和导航方法
- 使用api.get获取文件夹子节点
- 支持无限层级展开/折叠
- 使用memo包装组件避免不必要的重渲染
- 树形节点需要显示加载状态