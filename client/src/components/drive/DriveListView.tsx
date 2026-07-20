import { useState, useCallback, memo, useRef, useMemo, forwardRef } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import LiquidButton from '../glass/LiquidButton'
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
      <td className="drive-cell drive-cell--name">
        <span className="drive-cell-file">
          <span className="drive-cell-icon">{getDriveIcon(item, 18)}</span>
          {item.isFolder ? (
            <button className="drive-name-btn drive-name-btn--folder" onClick={(e) => { e.stopPropagation(); onFolderClick(item) }} title={item.name}>{item.name}</button>
          ) : (
            <span className="drive-name-text" title={item.name}>{item.name}</span>
          )}
        </span>
      </td>
      <td className="drive-cell drive-cell--size">{item.isFolder ? '—' : formatFileSize(Number(item.size))}</td>
      <td className="drive-cell drive-cell--date">{formatDate(item.updatedAt)}</td>
      <td className="drive-cell drive-cell--type">{item.isFolder ? '文件夹' : (item.mimeType?.split('/')[0] || '文件')}</td>
      <td className="drive-cell drive-cell--actions">
        <div className="drive-row-actions">
          {!item.isFolder && (
            <>
              <LiquidButton size="sm" variant="ghost" onClick={() => onPreview(item)}>预览</LiquidButton>
              <LiquidButton size="sm" variant="ghost" onClick={() => onDownload(item)}><DownloadIcon size={14} /></LiquidButton>
            </>
          )}
          <LiquidButton size="sm" variant="ghost" onClick={() => onRename(item)}><RenameIcon size={14} /></LiquidButton>
          <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}><DeleteIcon size={14} /></LiquidButton>
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
    if ((e.target as HTMLElement).closest('.drive-row')) return
    e.preventDefault(); onSelect(null); setContextMenu({ position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // Stable refs for virtualized table row component
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
    return (
      <tr ref={ref} {...props}
        className={`drive-row ${item && currentSelectedId === item.id ? 'drive-row--selected' : ''}`}
        onClick={() => item && onSelectRef.current(item)}
        onContextMenu={(e) => item && handleItemContextMenuRef.current(e, item)}
      >
        {children}
      </tr>
    )
  }), [])

  return (
    <>
      <div className="drive-table-wrap" onContextMenu={handleBlankAreaContextMenu}>
        <TableVirtuoso
          className="drive-table"
          style={{ height: 'calc(100vh - 280px)' }}
          totalCount={items.length}
          components={{ TableRow: CustomTableRow }}
          fixedHeaderContent={() => (
            <tr>
              {SORT_COLUMNS.map(col => (
                <th key={col.field} className={`col-${col.field}${col.align === 'right' ? ' col--right' : ''}${sortField === col.field ? ' col--active' : ''}`} onClick={() => onSortChange?.(col.field)}>
                  <span className="col-header-label">{col.label}</span>
                  {sortField === col.field && <span className="col-header-arrow">{sortDirection === 'asc' ? ' ▲' : ' ▼'}</span>}
                </th>
              ))}
              <th className="col-actions">操作</th>
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
