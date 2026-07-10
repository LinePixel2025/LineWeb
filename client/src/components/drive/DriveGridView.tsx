import { useState, useCallback, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import ContextMenu from './ContextMenu'
import type { DriveItem } from '../../types/drive'
import { getFileIcon } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'

export interface DriveGridViewProps {
  items: DriveItem[]
  selectedId?: number | null
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
  onSelect: (item: DriveItem | null) => void
  onNewFolder?: () => void
  onUpload?: () => void
  onRefresh?: () => void
  onSelectAll?: () => void
}

const DriveGridView = memo(function DriveGridView({
  items,
  selectedId,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  onSelect,
  onNewFolder,
  onUpload,
  onRefresh,
  onSelectAll,
}: DriveGridViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    item?: DriveItem
    position: { x: number; y: number }
  } | null>(null)

  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: DriveItem) => {
    e.preventDefault()
    onSelect(item)
    setContextMenu({
      item,
      position: { x: e.clientX, y: e.clientY },
    })
  }, [onSelect])

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    // Only trigger if right-clicking on the grid container itself, not on cards
    if ((e.target as HTMLElement).closest('.drive-grid-card')) return
    e.preventDefault()
    onSelect(null)
    setContextMenu({
      position: { x: e.clientX, y: e.clientY },
    })
  }, [onSelect])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  return (
    <>
      <div className="drive-grid" onContextMenu={handleBlankAreaContextMenu}>
        {items.map((item) => (
          <div
            key={item.id}
            className={`drive-grid-card ${selectedId === item.id ? 'drive-grid-card--selected' : ''}`}
          >
            {/* Main click area */}
            <button
              className="drive-grid-card-body"
              onClick={() => {
                onSelect(item)
                if (item.isFolder) onFolderClick(item)
              }}
              onContextMenu={(e) => handleItemContextMenu(e, item)}
            >
              <span className="drive-grid-card-icon">
                {getFileIcon(item)}
              </span>
              <span className="drive-grid-card-name" title={item.name}>{item.name}</span>
              <span className="drive-grid-card-meta">
                {item.isFolder ? '文件夹' : formatFileSize(Number(item.size))}
              </span>
              <span className="drive-grid-card-date">
                {formatDate(item.updatedAt)}
              </span>
            </button>

            {/* Actions — shows on hover desktop, always on mobile */}
            <div className="drive-grid-card-actions" onClick={e => e.stopPropagation()}>
              {!item.isFolder && (
                <>
                  <LiquidButton size="sm" variant="ghost" onClick={() => onPreview(item)}>
                    预览
                  </LiquidButton>
                  <LiquidButton size="sm" variant="ghost" onClick={() => onDownload(item)}>
                    下载
                  </LiquidButton>
                </>
              )}
              <LiquidButton size="sm" variant="ghost" onClick={() => onRename(item)}>
                重命名
              </LiquidButton>
              <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}>
                删除
              </LiquidButton>
            </div>
          </div>
        ))}
      </div>

      {contextMenu && (
        <ContextMenu
          item={contextMenu.item}
          position={contextMenu.position}
          onClose={closeContextMenu}
          onPreview={onPreview}
          onDownload={onDownload}
          onRename={onRename}
          onDelete={onDelete}
          onFolderClick={onFolderClick}
          onNewFolder={onNewFolder}
          onUpload={onUpload}
          onRefresh={onRefresh}
          onSelectAll={onSelectAll}
        />
      )}
    </>
  )
})

export default DriveGridView
