import { useState, useCallback, memo, useRef } from 'react'
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

  return (
    <div className="gh-drive-tree-view">
      <TreeNodeItem
        node={tree}
        level={0}
        onExpand={toggleExpand}
        onFolderClick={handleFolderClick}
      />
    </div>
  )
})

interface TreeNodeItemProps {
  node: TreeNode
  level: number
  onExpand: (node: TreeNode) => void
  onFolderClick: (node: TreeNode) => void
}

const TreeNodeItem = memo(function TreeNodeItem({
  node,
  level,
  onExpand,
  onFolderClick,
}: TreeNodeItemProps) {
  const { state } = useDrive()
  const [dragOver, setDragOver] = useState(false)
  const expandTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expandTargetRef = useRef<number | null>(null)

  const hasChildren = node.children.length > 0 || !node.hasLoaded

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
    if (!node.isExpanded && hasChildren) {
      if (expandTimeoutRef.current) clearTimeout(expandTimeoutRef.current)
      const nodeId = node.id
      expandTargetRef.current = nodeId
      expandTimeoutRef.current = setTimeout(() => {
        if (expandTargetRef.current === nodeId) {
          onExpand(node)
        }
      }, 800)
    }
  }, [node, hasChildren, onExpand])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (expandTimeoutRef.current) {
      clearTimeout(expandTimeoutRef.current)
      expandTimeoutRef.current = null
    }
    expandTargetRef.current = null
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (expandTimeoutRef.current) clearTimeout(expandTimeoutRef.current)
    try {
      const raw = e.dataTransfer.getData('text/plain')
      if (!raw) return
      const fileIds: number[] = JSON.parse(raw)
      const targetFolderId = node.id
      await Promise.allSettled(
        fileIds.map(fileId => api.put(`/drive/files/${fileId}`, { parentId: targetFolderId }))
      )
      window.dispatchEvent(new CustomEvent('drive-refresh'))
    } catch { /* ignore malformed data */ }
  }, [node.id])

  const active = state.currentPath.some(p => p.id === node.id)

  const nodeContentClass = [
    'gh-drive-tree-node-content',
    active ? 'gh-drive-tree-node-content--active' : '',
    dragOver ? 'gh-drive-tree-node-content--drag-over' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className="gh-drive-tree-node" style={{ paddingLeft: `${level * 16}px` }}>
      <div
        className={nodeContentClass}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {hasChildren && (
          <button
            className="gh-drive-tree-node-expand"
            onClick={(e) => {
              e.stopPropagation()
              onExpand(node)
            }}
            disabled={node.isLoading}
          >
            {node.isLoading ? '⏳' : node.isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </button>
        )}
        {!hasChildren && <span className="gh-drive-tree-node-spacer" />}

        <button
          className="gh-drive-tree-node-label"
          onClick={() => onFolderClick(node)}
        >
          <span className="gh-drive-tree-node-icon"><FolderIcon size={14} /></span>
          <span className="gh-drive-tree-node-name">{node.name}</span>
        </button>
      </div>

      {node.isExpanded && node.children.map(child => (
        <TreeNodeItem
          key={child.id ?? `child-${child.name}`}
          node={child}
          level={level + 1}
          onExpand={onExpand}
          onFolderClick={onFolderClick}
        />
      ))}
    </div>
  )
})

export default TreeView
