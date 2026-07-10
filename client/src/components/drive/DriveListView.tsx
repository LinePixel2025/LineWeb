import { useState, useCallback, memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import DriveContextMenu from './DriveContextMenu'
import type { DriveItem } from '../../types/drive'
import { getFileIcon } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'

export interface DriveListViewProps {
  items: DriveItem[]
  selectedId?: number | null
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
  onSelect: (item: DriveItem | null) => void
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
          <span className="drive-cell-icon">{getFileIcon(item)}</span>
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
}: DriveListViewProps) {
  const [contextMenu, setContextMenu] = useState<{
    item: DriveItem
    position: { x: number; y: number }
  } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, item: DriveItem) => {
    e.preventDefault()
    onSelect(item)
    setContextMenu({
      item,
      position: { x: e.clientX, y: e.clientY },
    })
  }, [onSelect])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  return (
    <>
      <div className="drive-table-wrap">
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
                onContextMenu={handleContextMenu}
              />
            ))}
          </tbody>
        </table>
      </div>

      {contextMenu && (
        <DriveContextMenu
          item={contextMenu.item}
          position={contextMenu.position}
          onClose={closeContextMenu}
          onPreview={onPreview}
          onDownload={onDownload}
          onRename={onRename}
          onDelete={onDelete}
          onFolderClick={onFolderClick}
        />
      )}
    </>
  )
})

export default DriveListView
