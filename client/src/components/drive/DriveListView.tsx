import { useState, useCallback, memo, useRef, useMemo, forwardRef } from 'react'
import { TableVirtuoso } from 'react-virtuoso'
import ContextMenu from './ContextMenu'
import type { DriveItem, SortField, SortDirection } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'
import { CheckIcon, ChevronDown, DeleteIcon, DownloadIcon, getDriveIcon, RenameIcon } from './DriveIcons'

export interface DriveListViewProps {
  items: DriveItem[]
  selectedId?: number | null
  selectedIds?: number[]
  sortField?: SortField
  sortDirection?: SortDirection
  onSortChange?: (field: SortField) => void
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

const SORT_COLUMNS: { field: SortField; label: string; align?: string }[] = [
  { field: 'name', label: '名称' },
  { field: 'size', label: '大小', align: 'right' },
  { field: 'updatedAt', label: '最近修改' },
  { field: 'type', label: '类型' },
]

function DriveRow({
  item,
  selected,
  onSelect,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: {
  item: DriveItem
  selected: boolean
  onSelect: (item: DriveItem | null, multiSelect?: boolean) => void
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}) {
  return (
    <>
      <td className="gh-drive-cell gh-drive-cell--check">
        <input
          className="gh-drive-checkbox"
          type="checkbox"
          checked={selected}
          onChange={() => onSelect(item, true)}
          onClick={event => event.stopPropagation()}
          aria-label={`选择 ${item.name}`}
        />
      </td>
      <td className="gh-drive-cell gh-drive-cell--name">
        <span className="gh-drive-cell-file">
          <span className={`gh-drive-cell-icon${item.isFolder ? ' gh-drive-cell-icon--folder' : ''}`}>
            {getDriveIcon(item, 18)}
          </span>
          {item.isFolder ? (
            <button
              className="gh-drive-file-name-button"
              onClick={event => { event.stopPropagation(); onFolderClick(item) }}
              title={item.name}
            >
              {item.name}
            </button>
          ) : (
            <button className="gh-drive-file-name-button gh-drive-file-name-button--file" onClick={event => { event.stopPropagation(); onSelect(item) }} title={item.name}>
              {item.name}
            </button>
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
              <button className="gh-drive-row-action" onClick={() => onPreview(item)} title="预览" aria-label={`预览 ${item.name}`}>预览</button>
              <button className="gh-drive-row-action" onClick={() => onDownload(item)} title="下载" aria-label={`下载 ${item.name}`}><DownloadIcon size={14} /></button>
            </>
          )}
          <button className="gh-drive-row-action" onClick={() => onRename(item)} title="重命名" aria-label={`重命名 ${item.name}`}><RenameIcon size={14} /></button>
          <button className="gh-drive-row-action gh-drive-row-action--danger" onClick={() => onDelete(item)} title="删除" aria-label={`删除 ${item.name}`}><DeleteIcon size={14} /></button>
        </div>
      </td>
    </>
  )
}

const DriveListView = memo(function DriveListView({
  items,
  selectedId,
  selectedIds = [],
  sortField,
  sortDirection,
  onSortChange,
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
}: DriveListViewProps) {
  const [contextMenu, setContextMenu] = useState<{ item?: DriveItem; position: { x: number; y: number } } | null>(null)

  const handleItemContextMenu = useCallback((e: React.MouseEvent, item: DriveItem) => {
    e.preventDefault()
    onSelect(item)
    setContextMenu({ item, position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const handleBlankAreaContextMenu = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.gh-drive-row')) return
    e.preventDefault()
    onSelect(null)
    setContextMenu({ position: { x: e.clientX, y: e.clientY } })
  }, [onSelect])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])
  const itemsRef = useRef(items)
  itemsRef.current = items
  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const handleItemContextMenuRef = useRef(handleItemContextMenu)
  handleItemContextMenuRef.current = handleItemContextMenu

  const allSelected = items.length > 0 && items.every(item => selectedIds.includes(item.id))

  const CustomTableRow = useMemo(() => forwardRef<HTMLTableRowElement, any>(({ children, ...props }, ref) => {
    const idx = Number(props['data-index'])
    const currentItems = itemsRef.current
    const currentSelectedIds = selectedIdsRef.current
    const item = !isNaN(idx) && idx >= 0 && idx < currentItems.length ? currentItems[idx] : undefined
    const isDraggable = item ? !item.isFolder : false
    return (
      <tr
        ref={ref}
        {...props}
        className={`gh-drive-row${item && currentSelectedIds.includes(item.id) ? ' gh-drive-row--selected' : ''}${item && selectedId === item.id ? ' gh-drive-row--focused' : ''}`}
        onClick={event => item && onSelectRef.current(item, event.metaKey || event.ctrlKey || event.shiftKey)}
        onContextMenu={event => item && handleItemContextMenuRef.current(event, item)}
        draggable={isDraggable}
        onDragStart={event => {
          if (!item || item.isFolder) { event.preventDefault(); return }
          event.dataTransfer.setData('text/plain', JSON.stringify([item.id]))
          event.dataTransfer.effectAllowed = 'move'
        }}
      >
        {children}
      </tr>
    )
  }), [selectedId])

  return (
    <>
      <div className="gh-drive-table-wrap" onContextMenu={handleBlankAreaContextMenu}>
        <TableVirtuoso
          className="gh-drive-table"
          style={{ height: 'calc(100dvh - 300px)', width: '100%', minHeight: '280px' }}
          totalCount={items.length}
          components={{ TableRow: CustomTableRow }}
          fixedHeaderContent={() => (
            <tr>
              <th className="gh-drive-col-header gh-drive-col-header--check">
                <input
                  className="gh-drive-checkbox"
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onSelectAll?.()}
                  aria-label={allSelected ? '取消全选' : '选择全部'}
                />
              </th>
              {SORT_COLUMNS.map(column => (
                <th
                  key={column.field}
                  className={`gh-drive-col-header${sortField === column.field ? ' gh-drive-col-header--active' : ''}${column.align === 'right' ? ' gh-drive-col-header--right' : ''}`}
                  onClick={() => onSortChange?.(column.field)}
                >
                  <span className="gh-drive-col-header-label">{column.label}</span>
                  {sortField === column.field && <ChevronDown size={13} />}
                </th>
              ))}
              <th className="gh-drive-col-header gh-drive-col-header--actions">操作</th>
            </tr>
          )}
          itemContent={index => {
            const item = items[index]
            return (
              <DriveRow
                item={item}
                selected={selectedIds.includes(item.id)}
                onSelect={onSelect}
                onFolderClick={onFolderClick}
                onPreview={onPreview}
                onDownload={onDownload}
                onRename={onRename}
                onDelete={onDelete}
              />
            )
          }}
        />
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

export default DriveListView
