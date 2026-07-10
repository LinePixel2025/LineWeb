import { useState, useCallback, memo } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import api from '../../lib/api'
import type { DriveItem } from '../../types/drive'
import { FolderIcon, ChevronRight, ChevronDown } from './DriveIcons'

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
    if (!node.hasLoaded) {
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
              {node.isLoading ? '⏳' : node.isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
          {!hasChildren && <span className="tree-node-spacer" />}
          
          <button
              className="tree-node-label"
              onClick={() => handleFolderClick(node)}
            >
              <span className="tree-node-icon"><FolderIcon size={14} /></span>
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
