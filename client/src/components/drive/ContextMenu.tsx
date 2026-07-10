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
