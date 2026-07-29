import { useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import api from '../../lib/api'
import type { DriveItem } from '../../types/drive'
import { FolderIcon, ChevronRight, ChevronDown } from './DriveIcons'

interface FolderNode {
  id: number | null
  name: string
  children: FolderNode[]
  isExpanded: boolean
  isLoading: boolean
  hasLoaded: boolean
}

interface FolderPickerDialogProps {
  title?: string
  onSelect: (folderId: number | null) => void
  onClose: () => void
}

export default function FolderPickerDialog({
  title = '选择目标文件夹',
  onSelect,
  onClose,
}: FolderPickerDialogProps) {
  const [loading, setLoading] = useState(true)

  const [tree, setTree] = useState<FolderNode>({
    id: null,
    name: '根目录',
    children: [],
    isExpanded: true,
    isLoading: false,
    hasLoaded: false,
  })

  const loadChildren = useCallback(async (node: FolderNode) => {
    if (node.hasLoaded) return

    const updateLoading = (newLoading: boolean) => {
      setTree(prev => {
        const updateNode = (n: FolderNode): FolderNode => {
          if (n.id === node.id) return { ...n, isLoading: newLoading }
          return { ...n, children: n.children.map(updateNode) }
        }
        return updateNode(prev)
      })
    }

    updateLoading(true)

    try {
      const params = new URLSearchParams()
      if (node.id !== null) params.set('parentId', String(node.id))
      params.set('limit', '200')
      const res = await api.get<{ data: DriveItem[] }>(`/drive/files?${params}`)
      const folders = (res.data ?? []).filter(item => item.isFolder)

      setTree(prev => {
        const updateNode = (n: FolderNode): FolderNode => {
          if (n.id === node.id) {
            return {
              ...n,
              children: folders.map(f => ({
                id: f.id,
                name: f.name,
                children: [],
                isExpanded: false,
                isLoading: false,
                hasLoaded: false,
              })),
              isLoading: false,
              hasLoaded: true,
              isExpanded: true,
            }
          }
          return { ...n, children: n.children.map(updateNode) }
        }
        return updateNode(prev)
      })
    } catch (err) {
      console.error('FolderPickerDialog loadChildren error:', err)
      updateLoading(false)
    }
  }, [])

  useEffect(() => {
    const root: FolderNode = {
      id: null,
      name: '根目录',
      children: [],
      isExpanded: true,
      isLoading: false,
      hasLoaded: false,
    }
    loadChildren(root).finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleExpand = useCallback(async (node: FolderNode) => {
    if (!node.hasLoaded) {
      await loadChildren(node)
    } else {
      setTree(prev => {
        const updateNode = (n: FolderNode): FolderNode => {
          if (n.id === node.id) return { ...n, isExpanded: !n.isExpanded }
          return { ...n, children: n.children.map(updateNode) }
        }
        return updateNode(prev)
      })
    }
  }, [loadChildren])

  const handleSelect = useCallback((folderId: number | null) => {
    onSelect(folderId)
  }, [onSelect])

  const renderNode = (node: FolderNode, level: number = 0): React.ReactNode => {
    const hasChildren = node.children.length > 0 || !node.hasLoaded

    return (
      <div key={node.id ?? 'root'} className="gh-drive-folder-picker-node" style={{ paddingLeft: `${level * 16}px` }}>
        <div className="gh-drive-folder-picker-row">
          {hasChildren && (
            <button
              className="gh-drive-tree-node-expand"
              onClick={(e) => { e.stopPropagation(); toggleExpand(node) }}
              disabled={node.isLoading}
            >
              {node.isLoading ? '⏳' : node.isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          )}
          {!hasChildren && <span className="gh-drive-tree-node-spacer" />}
          <button
            className="gh-drive-folder-picker-label"
            onClick={() => handleSelect(node.id)}
          >
            <span className="gh-drive-tree-node-icon"><FolderIcon size={14} /></span>
            <span className="gh-drive-tree-node-name">{node.name}</span>
          </button>
        </div>
        {node.isExpanded && node.children.map(child => renderNode(child, level + 1))}
      </div>
    )
  }

  return createPortal(
    <div className="gh-dialog-overlay" onClick={onClose}>
      <div className="gh-dialog" onClick={e => e.stopPropagation()}>
        <h3 className="gh-dialog-title">{title}</h3>
        {loading ? (
          <div className="gh-drive-loading" style={{ padding: '20px' }}>
            <div className="gh-spinner" />
          </div>
        ) : (
          <div className="gh-drive-folder-picker-tree">
            {renderNode(tree)}
          </div>
        )}
        <div className="gh-dialog-actions">
          <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onClose}>取消</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
