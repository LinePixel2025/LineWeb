import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { DriveItem } from '../../types/drive'
import { getFileIcon, formatFileSize, formatDate } from '../../types/drive'

export interface DriveGridViewProps {
  items: DriveItem[]
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
}

const DriveGridView = memo(function DriveGridView({
  items,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
}: DriveGridViewProps) {
  return (
    <div className="drive-grid">
      {items.map((item, i) => (
        <LiquidGlass
          key={item.id}
          variant="strong"
          chromatic={false}
          className="drive-grid-card"
        >
          {/* Main click area */}
          <button
            className="drive-grid-card-body"
            onClick={() => item.isFolder ? onFolderClick(item) : onPreview(item)}
          >
            <span className="drive-grid-card-icon">
              {getFileIcon(item)}
            </span>
            <span className="drive-grid-card-name">{item.name}</span>
            <span className="drive-grid-card-meta">
              {formatFileSize(Number(item.size))}
            </span>
            <span className="drive-grid-card-date">
              {formatDate(item.updatedAt)}
            </span>
          </button>

          {/* Actions — shows on hover desktop, always on mobile */}
          <div className="drive-grid-card-actions" onClick={e => e.stopPropagation()}>
            {!item.isFolder && (
              <>
                <LiquidButton size="sm" variant="ghost" onClick={() => onDownload(item)}>
                  下载
                </LiquidButton>
                <LiquidButton size="sm" variant="ghost" onClick={() => onRename(item)}>
                  重命名
                </LiquidButton>
              </>
            )}
            <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}>
              删除
            </LiquidButton>
          </div>
        </LiquidGlass>
      ))}
    </div>
  )
})

export default DriveGridView
