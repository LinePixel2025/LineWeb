import { useState, useEffect, useCallback, memo } from 'react'
import { createPortal } from 'react-dom'
import type { DriveItem, FavoriteItem } from '../../types/drive'
import { useDrive } from '../../contexts/DriveContext'
import { FolderIcon, StarIcon, DownloadIcon, DeleteIcon, RenameIcon, NewFolderIcon, UploadIcon, RefreshIcon, SelectAllIcon, getDriveIcon } from './DriveIcons'

export interface ContextMenuItem {
  label: string
  icon: React.ReactNode
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
  const { state, addFavorite, removeFavorite } = useDrive()

  const isFavorite = useCallback((folderId: number) => {
    return state.favorites.some((f: FavoriteItem) => f.folderId === folderId)
  }, [state.favorites])

  const handleToggleFavorite = useCallback((item: DriveItem) => {
    if (isFavorite(item.id)) {
      removeFavorite(item.id)
    } else {
      addFavorite(item.id, item.name)
    }
  }, [isFavorite, addFavorite, removeFavorite])

  const [adjustedPos, setAdjustedPos] = useState(position)

  useEffect(() => {
    const menuWidth = 200
    const menuHeight = 350
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
    if (item.isFolder) {
      menuItems.push({
        label: '打开文件夹',
        icon: <FolderIcon size={16} />,
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
          icon: getDriveIcon(item, 16),
          action: () => handleAction(() => onPreview?.(item))
        })
      }

      menuItems.push({
        label: '下载',
        icon: <DownloadIcon size={16} />,
        action: () => handleAction(() => onDownload?.(item))
      })
    }

    menuItems.push({
      label: isFavorite(item.id) ? '取消收藏' : '收藏',
      icon: <StarIcon size={16} filled={isFavorite(item.id)} />,
      action: () => handleAction(() => handleToggleFavorite(item))
    })

    menuItems.push({
      label: '重命名',
      icon: <RenameIcon size={16} />,
      action: () => handleAction(() => onRename?.(item))
    })

    menuItems.push({
      label: '删除',
      icon: <DeleteIcon size={16} />,
      action: () => handleAction(() => onDelete?.(item)),
      variant: 'danger'
    })
  } else {
    menuItems.push({
      label: '新建文件夹',
      icon: <NewFolderIcon size={16} />,
      action: () => handleAction(() => onNewFolder?.())
    })

    menuItems.push({
      label: '上传文件',
      icon: <UploadIcon size={16} />,
      action: () => handleAction(() => onUpload?.())
    })

    menuItems.push({
      label: '刷新',
      icon: <RefreshIcon size={16} />,
      action: () => handleAction(() => onRefresh?.())
    })

    menuItems.push({
      label: '全选',
      icon: <SelectAllIcon size={16} />,
      action: () => handleAction(() => onSelectAll?.())
    })
  }

  return createPortal(
    <div
      className="gh-drive-context-menu"
      style={{
        position: 'fixed',
        left: adjustedPos.x,
        top: adjustedPos.y,
        zIndex: 1100
      }}
      onClick={e => e.stopPropagation()}
    >
      {item && (
        <div className="gh-drive-context-menu-header">
          <span className="gh-drive-context-menu-icon">
            {getDriveIcon(item, 16)}
          </span>
          <span className="gh-drive-context-menu-name" title={item.name}>
            {item.name}
          </span>
        </div>
      )}
      {item && <div className="gh-drive-context-menu-divider" />}
      {menuItems.map((menuItem, index) => (
        <button
          key={index}
          className={`gh-drive-context-menu-item ${menuItem.variant === 'danger' ? 'gh-drive-context-menu-item--danger' : ''}`}
          onClick={() => menuItem.action()}
          disabled={menuItem.disabled}
        >
          <span className="gh-drive-context-menu-item-icon">{menuItem.icon}</span>
          <span className="gh-drive-context-menu-item-label">{menuItem.label}</span>
        </button>
      ))}
    </div>,
    document.body
  )
})

export default ContextMenu
