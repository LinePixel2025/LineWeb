import { useState, useCallback, memo, useRef, useMemo, forwardRef } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import LiquidButton from '../glass/LiquidButton'
import ContextMenu from './ContextMenu'
import ThumbnailGrid from './ThumbnailGrid'
import type { DriveItem } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'
import { getDriveIcon, DownloadIcon, RenameIcon, DeleteIcon } from './DriveIcons'

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
  items, selectedId, onFolderClick, onPreview, onDownload, onRename, onDelete, onSelect,
  onNewFolder, onUpload, onRefresh, onSelectAll,
}: DriveGridViewProps) {
  const [contextMenu, setContextMenu] = useState<{ item?: DriveItem; position: { x: number; y: number } } | null>(null)

  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: DriveItem) => {
    e.preventDefault(); onSelect(item); setContextMenu({ item, position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.drive-grid-card')) return
    e.preventDefault(); onSelect(null); setContextMenu({ position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // Stable refs for virtualized grid components
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const handleBlankAreaContextMenuRef = useRef(handleBlankAreaContextMenu)
  handleBlankAreaContextMenuRef.current = handleBlankAreaContextMenu

  const gridComponents = useMemo(() => ({
    List: forwardRef<HTMLDivElement, any>(({ style, children, ...props }, ref) => (
      <div ref={ref} {...props}
        className="drive-grid"
        style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', ...style }}
        onContextMenu={(e) => handleBlankAreaContextMenuRef.current(e)}
      >
        {children}
      </div>
    )),
    Item: ({ children, ...props }: any) => {
      const idx = Number(props['data-index'])
      const currentItems = itemsRef.current
      const currentSelectedId = selectedIdRef.current
      const item = !isNaN(idx) && idx >= 0 && idx < currentItems.length ? currentItems[idx] : undefined
      const isSelected = item ? currentSelectedId === item.id : false
      return (
        <div {...props}
          className={`drive-grid-card${isSelected ? ' drive-grid-card--selected' : ''}`}
          style={{ flex: '1 1 160px', minWidth: 0, maxWidth: '1fr' }}
        >
          {children}
        </div>
      )
    },
  }), [])

  const isMediaItem = useCallback((item: DriveItem) => {
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.split('.').pop()?.toLowerCase() || ''
    return mime.startsWith('image/') || mime.startsWith('video/') ||
      ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm'].includes(ext)
  }, [])

  return (
    <>
      <VirtuosoGrid
        style={{ height: 'calc(100vh - 280px)', width: '100%', minHeight: '1px' }}
        totalCount={items.length}
        components={gridComponents}
        itemContent={(index) => {
          const item = items[index]
          return (
            <>
              {!item.isFolder && isMediaItem(item) && (
                <div className="drive-grid-card-thumbnail">
                  <ThumbnailGrid items={[item]} size="medium" />
                </div>
              )}
              <button className="drive-grid-card-body" onClick={() => { onSelect(item); if (item.isFolder) onFolderClick(item) }} onContextMenu={(e) => handleItemContextMenu(e, item)}>
                <span className="drive-grid-card-icon">{getDriveIcon(item, 32)}</span>
                <span className="drive-grid-card-name" title={item.name}>{item.name}</span>
                <span className="drive-grid-card-meta">{item.isFolder ? '文件夹' : formatFileSize(Number(item.size))}</span>
                <span className="drive-grid-card-date">{formatDate(item.updatedAt)}</span>
              </button>
              <div className="drive-grid-card-actions" onClick={e => e.stopPropagation()}>
                {!item.isFolder && (
                  <>
                    <LiquidButton size="sm" variant="ghost" onClick={() => onPreview(item)}>预览</LiquidButton>
                    <LiquidButton size="sm" variant="ghost" onClick={() => onDownload(item)}><DownloadIcon size={14} /></LiquidButton>
                  </>
                )}
                <LiquidButton size="sm" variant="ghost" onClick={() => onRename(item)}><RenameIcon size={14} /></LiquidButton>
                <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}><DeleteIcon size={14} /></LiquidButton>
              </div>
            </>
          )
        }}
      />
      {contextMenu && (
        <ContextMenu item={contextMenu.item} position={contextMenu.position} onClose={closeContextMenu}
          onPreview={onPreview} onDownload={onDownload} onRename={onRename} onDelete={onDelete}
          onFolderClick={onFolderClick} onNewFolder={onNewFolder} onUpload={onUpload}
          onRefresh={onRefresh} onSelectAll={onSelectAll} />
      )}
    </>
  )
})

export default DriveGridView
