import { useState, useCallback, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import ContextMenu from './ContextMenu'
import type { DriveItem } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'
import { getDriveIcon, DownloadIcon, RenameIcon, DeleteIcon, StarIcon } from './DriveIcons'

export interface DriveListViewProps {
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

function DriveRow({
  item,
  isSelected,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  onSelect,
  onContextMenu,
}: {
  item: DriveItem
  isSelected: boolean
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
  onSelect: (item: DriveItem) => void
  onContextMenu: (e: React.MouseEvent, item: DriveItem) => void
}) {
  return (
    <tr
      className={`drive-row ${isSelected ? 'drive-row--selected' : ''}`}
      onClick={() => onSelect(item)}
      onContextMenu={(e) => onContextMenu(e, item)}
    >
      <td className="drive-cell drive-cell--name" data-label="名称">
        <span className="drive-cell-file">
          <span className="drive-cell-icon">{getDriveIcon(item, 18)}</span>
          {item.isFolder ? (
            <button
              className="drive-name-btn drive-name-btn--folder"
              onClick={(e) => { e.stopPropagation(); onFolderClick(item) }}
              title={item.name}
            >
              {item.name}
            </button>
          ) : (
            <span className="drive-name-text" title={item.name}>
              {item.name}
            </span>
          )}
        </span>
      </td>
      <td className="drive-cell drive-cell--size" data-label="大小">
        {item.isFolder ? '—' : formatFileSize(Number(item.size))}
      </td>
      <td className="drive-cell drive-cell--date" data-label="修改时间">
        {formatDate(item.updatedAt)}
      </td>
      <td className="drive-cell drive-cell--actions" data-label="操作">
        <div className="drive-row-actions">
          {!item.isFolder && (
            <>
              <LiquidButton size="sm" variant="ghost" onClick={() => onPreview(item)}>
                预览
              </LiquidButton>
              <LiquidButton size="sm" variant="ghost" onClick={() => onDownload(item)}>
                <DownloadIcon size={14} />
              </LiquidButton>
            </>
          )}
          <LiquidButton size="sm" variant="ghost" onClick={() => onRename(item)}>
            <RenameIcon size={14} />
          </LiquidButton>
          <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}>
            <DeleteIcon size={14} />
          </LiquidButton>
        </div>
      </td>
    </tr>
  )
}

const DriveListView = memo(function DriveListView({
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
}: DriveListViewProps) {
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
    // Only trigger if right-clicking on the table wrapper itself, not on rows
    if ((e.target as HTMLElement).closest('.drive-row')) return
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
      <div className="drive-table-wrap" onContextMenu={handleBlankAreaContextMenu}>
        <table className="drive-table">
          <thead>
            <tr>
              <th className="col-name">名称</th>
              <th className="col-size">大小</th>
              <th className="col-date">修改时间</th>
              <th className="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <DriveRow
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onFolderClick={onFolderClick}
                onPreview={onPreview}
                onDownload={onDownload}
                onRename={onRename}
                onDelete={onDelete}
                onSelect={onSelect}
                onContextMenu={handleItemContextMenu}
              />
            ))}
          </tbody>
        </table>
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
