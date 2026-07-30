import { useState, useCallback, memo, useRef, useMemo, forwardRef } from 'react'
import { VirtuosoGrid } from 'react-virtuoso'
import ContextMenu from './ContextMenu'
import ThumbnailGrid from './ThumbnailGrid'
import type { DriveItem } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'
import { DeleteIcon, DownloadIcon, getDriveIcon, RenameIcon } from './DriveIcons'

export interface DriveGridViewProps {
  items: DriveItem[]
  selectedId?: number | null
  selectedIds?: number[]
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
  onSelect: (item: DriveItem | null, multiSelect?: boolean) => void
  onNewFolder?: () => void
  onUpload?: () => void
  onRefresh?: () => void
  onSelectAll?: () => void
}

const DriveGridView = memo(function DriveGridView({
  items,
  selectedId,
  selectedIds = [],
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
  const [contextMenu, setContextMenu] = useState<{ item?: DriveItem; position: { x: number; y: number } } | null>(null)

  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: DriveItem) => {
    e.preventDefault()
    onSelect(item)
    setContextMenu({ item, position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.gh-drive-grid-card')) return
    e.preventDefault()
    onSelect(null)
    setContextMenu({ position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const handleBlankAreaContextMenuRef = useRef(handleBlankAreaContextMenu)
  handleBlankAreaContextMenuRef.current = handleBlankAreaContextMenu
  const handleItemContextMenuRef = useRef(handleItemContextMenu)
  handleItemContextMenuRef.current = handleItemContextMenu

  const gridComponents = useMemo(() => ({
    List: forwardRef<HTMLDivElement, any>(({ style, children, ...props }, ref) => (
      <div
        ref={ref}
        {...props}
        className="gh-drive-grid"
        style={{ ...style }}
        onContextMenu={event => handleBlankAreaContextMenuRef.current(event)}
      >
        {children}
      </div>
    )),
    Item: ({ children, ...props }: any) => {
      const idx = Number(props['data-index'])
      const currentItems = itemsRef.current
      const currentSelectedIds = selectedIdsRef.current
      const item = !isNaN(idx) && idx >= 0 && idx < currentItems.length ? currentItems[idx] : undefined
      const isSelected = item ? currentSelectedIds.includes(item.id) : false
      const isFocused = item ? selectedIdRef.current === item.id : false
      const isDraggable = item ? !item.isFolder : false
      return (
        <div
          {...props}
          className={`gh-drive-grid-card${isSelected ? ' gh-drive-grid-card--selected' : ''}${isFocused ? ' gh-drive-grid-card--focused' : ''}`}
          draggable={isDraggable}
          onDragStart={event => {
            if (!item || item.isFolder) { event.preventDefault(); return }
            event.dataTransfer.setData('text/plain', JSON.stringify([item.id]))
            event.dataTransfer.effectAllowed = 'move'
          }}
        >
          {children}
        </div>
      )
    },
  }), [])

  const isMediaItem = useCallback((item: DriveItem) => {
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.split('.').pop()?.toLowerCase() || ''
    return mime.startsWith('image/') || mime.startsWith('video/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm'].includes(ext)
  }, [])

  return (
    <>
      <div className="gh-drive-grid-toolbar">
        <span>{items.length} 个项目</span>
        <button className="gh-drive-grid-select-all" onClick={onSelectAll} disabled={items.length === 0}>
          {items.length > 0 && items.every(item => selectedIds.includes(item.id)) ? '取消全选' : '全选'}
        </button>
      </div>
      <VirtuosoGrid
        style={{ height: 'calc(100dvh - 348px)', width: '100%', minHeight: '280px' }}
        totalCount={items.length}
        components={gridComponents}
        itemContent={index => {
          const item = items[index]
          const media = !item.isFolder && isMediaItem(item)
          const selected = selectedIds.includes(item.id)
          return (
            <>
              <div className={`gh-drive-grid-card-visual${media ? ' gh-drive-grid-card-visual--media' : ''}`}>
                {media ? <ThumbnailGrid items={[item]} size="medium" /> : <span className="gh-drive-grid-card-icon">{getDriveIcon(item, 34)}</span>}
                <input
                  className="gh-drive-checkbox gh-drive-grid-checkbox"
                  type="checkbox"
                  checked={selected}
                  onChange={() => onSelect(item, true)}
                  onClick={event => event.stopPropagation()}
                  aria-label={`选择 ${item.name}`}
                />
              </div>
              <button
                className="gh-drive-grid-card-body"
                onClick={() => { onSelect(item); if (item.isFolder) onFolderClick(item) }}
                onContextMenu={event => handleItemContextMenu(event, item)}
              >
                <span className="gh-drive-grid-card-name" title={item.name}>{item.name}</span>
                <span className="gh-drive-grid-card-meta">{item.isFolder ? '文件夹' : formatFileSize(Number(item.size))}</span>
                <span className="gh-drive-grid-card-date">{formatDate(item.updatedAt)}</span>
              </button>
              <div className="gh-drive-grid-card-actions" onClick={event => event.stopPropagation()}>
                {!item.isFolder && (
                  <>
                    <button className="gh-drive-row-action" onClick={() => onPreview(item)} title="预览" aria-label={`预览 ${item.name}`}>预览</button>
                    <button className="gh-drive-row-action" onClick={() => onDownload(item)} title="下载" aria-label={`下载 ${item.name}`}><DownloadIcon size={14} /></button>
                  </>
                )}
                <button className="gh-drive-row-action" onClick={() => onRename(item)} title="重命名" aria-label={`重命名 ${item.name}`}><RenameIcon size={14} /></button>
                <button className="gh-drive-row-action gh-drive-row-action--danger" onClick={() => onDelete(item)} title="删除" aria-label={`删除 ${item.name}`}><DeleteIcon size={14} /></button>
              </div>
            </>
          )
        }}
      />
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
