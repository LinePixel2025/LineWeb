import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { DriveItem } from '../../types/drive'
import { getFileIcon } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'

export interface DriveListViewProps {
  items: DriveItem[]
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}

function DriveRow({
  item,
  index,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: {
  item: DriveItem
  index: number
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}) {
  return (
    <tr className="drive-row">
      <td className="drive-cell drive-cell--name" data-label="名称">
        <span className="drive-cell-file">
          <span className="drive-cell-icon">{getFileIcon(item)}</span>
          {item.isFolder ? (
            <button
              className="drive-name-btn drive-name-btn--folder"
              onClick={() => onFolderClick(item)}
              title={item.name}
            >
              {item.name}
            </button>
          ) : (
            <button
              className="drive-name-btn"
              onClick={() => onRename(item)}
              title={`${item.name} — 点击重命名`}
            >
              {item.name}
            </button>
          )}
        </span>
      </td>
      <td className="drive-cell drive-cell--size" data-label="大小">
        {formatFileSize(Number(item.size))}
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
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: DriveListViewProps) {
  return (
    <LiquidGlass variant="blur" chromatic={false} className="drive-table-wrap">
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
          {items.map((item, i) => (
            <DriveRow
              key={item.id}
              item={item}
              index={i}
              onFolderClick={onFolderClick}
              onPreview={onPreview}
              onDownload={onDownload}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>
    </LiquidGlass>
  )
})

export default DriveListView
