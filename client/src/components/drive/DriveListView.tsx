import { useState, useCallback, memo, useRef, useMemo, forwardRef } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import ContextMenu from './ContextMenu'
import type { DriveItem, SortField, SortDirection } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'
import { getDriveIcon, DownloadIcon, RenameIcon, DeleteIcon } from './DriveIcons'

export interface DriveListViewProps {
  items: DriveItem[]
  selectedId?: number | null
  sortField?: SortField
  sortDirection?: SortDirection
  onSortChange?: (field: SortField) => void
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

const SORT_COLUMNS: { field: SortField; label: string; align?: string }[] = [
  { field: 'name', label: '名称' },
  { field: 'size', label: '大小', align: 'right' },
  { field: 'updatedAt', label: '修改日期' },
  { field: 'type', label: '类型' },
]

function DriveRow({ item, onFolderClick, onPreview, onDownload, onRename, onDelete }: {
  item: DriveItem
  onFolderClick: (item: DriveItem) => void; onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void; onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}) {
  return (
    <>
      <td className="gh-drive-cell gh-drive-cell--name">
        <span className="gh-drive-cell-file">
          <span className="gh-drive-cell-icon">{getDriveIcon(item, 18)}</span>
          {item.isFolder ? (
            <button className="gh-drive-file-name-btn" onClick={(e) => { e.stopPropagation(); onFolderClick(item) }} title={item.name}>{item.name}</button>
          ) : (
            <span className="gh-drive-file-name-text" title={item.name}>{item.name}</span>
          )}
        </span>
      </td>
      <td className="gh-drive-cell gh-drive-cell--size">{item.isFolder ? '—' : formatFileSize(Number(item.size))}</td>
      <td className="gh-drive-cell gh-drive-cell--date">{formatDate(item.updatedAt)}</td>
      <td className="gh-drive-cell gh-drive-cell--type">{item.isFolder ? '文件夹' : (item.mimeType?.split('/')[0] || '文件')}</td>
      <td className="gh-drive-cell gh-drive-cell--actions">
        <div className="gh-drive-row-actions">
          {!item.isFolder && (
            <>
              <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={() => onPreview(item)}>预览</button>
              <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={() => onDownload(item)}><DownloadIcon size={14} /></button>
            </>
          )}
          <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={() => onRename(item)}><RenameIcon size={14} /></button>
          <button className="gh-btn gh-btn--sm gh-btn--danger" onClick={() => onDelete(item)}><DeleteIcon size={14} /></button>
        </div>
      </td>
    </>
  )
}

const DriveListView = memo(function DriveListView({ items, selectedId, sortField, sortDirection, onSortChange, onFolderClick, onPreview, onDownload, onRename, onDelete, onSelect, onNewFolder, onUpload, onRefresh, onSelectAll }: DriveListViewProps) {
  const [contextMenu, setContextMenu] = useState<{ item?: DriveItem; position: { x: number; y: number } } | null>(null)

  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: DriveItem) => {
    e.preventDefault(); onSelect(item); setContextMenu({ item, position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.gh-drive-row')) return
    e.preventDefault(); onSelect(null); setContextMenu({ position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const handleItemContextMenuRef = useRef(handleItemContextMenu)
  handleItemContextMenuRef.current = handleItemContextMenu

  const CustomTableRow = useMemo(() => forwardRef<HTMLTableRowElement, any>(({ children, ...props }, ref) => {
    const idx = Number(props['data-index'])
    const currentItems = itemsRef.current
    const currentSelectedId = selectedIdRef.current
    const item = !isNaN(idx) && idx >= 0 && idx < currentItems.length ? currentItems[idx] : undefined
    const isDraggable = item ? !item.isFolder : false
    return (
      <tr ref={ref} {...props}
        className={`gh-drive-row ${item && currentSelectedId === item.id ? 'gh-drive-row--selected' : ''}`}
        onClick={() => item && onSelectRef.current(item)}
        onContextMenu={(e) => item && handleItemContextMenuRef.current(e, item)}
        draggable={isDraggable}
        onDragStart={(e) => {
          if (!item || item.isFolder) { e.preventDefault(); return }
          e.dataTransfer.setData('text/plain', JSON.stringify([item.id]))
          e.dataTransfer.effectAllowed = 'move'
        }}
      >
        {children}
      </tr>
    )
  }), [])

  return (
    <>
      <div className="gh-drive-table-wrap" onContextMenu={handleBlankAreaContextMenu}>
        <TableVirtuoso
          className="gh-drive-table"
          style={{ height: 'calc(100vh - 280px)', width: '100%', minHeight: '1px' }}
          totalCount={items.length}
          components={{ TableRow: CustomTableRow }}
          fixedHeaderContent={() => (
            <tr>
              {SORT_COLUMNS.map(col => (
                <th key={col.field} className={`gh-drive-col-header${sortField === col.field ? ' gh-drive-col-header--active' : ''}${col.align === 'right' ? ' gh-drive-col-header--right' : ''}`} onClick={() => onSortChange?.(col.field)}>
                  <span className="gh-drive-col-header-label">{col.label}</span>
                  {sortField === col.field && <span className="gh-drive-col-header-arrow">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
              <th className="gh-drive-col-header">操作</th>
            </tr>
          )}
          itemContent={(index) => {
            const item = items[index]
            return <DriveRow item={item}
              onFolderClick={onFolderClick} onPreview={onPreview} onDownload={onDownload}
              onRename={onRename} onDelete={onDelete} />
          }}
        />
      </div>
      {contextMenu && (
        <ContextMenu item={contextMenu.item} position={contextMenu.position} onClose={closeContextMenu}
          onPreview={onPreview} onDownload={onDownload} onRename={onRename} onDelete={onDelete}
          onFolderClick={onFolderClick} onNewFolder={onNewFolder} onUpload={onUpload} onRefresh={onRefresh} onSelectAll={onSelectAll} />
      )}
    </>
  )
})

export default DriveListView
