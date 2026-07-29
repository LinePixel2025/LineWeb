import { memo } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import { DownloadIcon, FolderIcon, StarIcon, DeleteIcon } from './DriveIcons'

export interface BatchActionsProps {
  onBatchDownload?: () => void
  onBatchMove?: () => void
  onBatchDelete?: () => void
  onBatchFavorite?: () => void
  onClearSelection?: () => void
}

const BatchActions = memo(function BatchActions({
  onBatchDownload,
  onBatchMove,
  onBatchDelete,
  onBatchFavorite,
  onClearSelection
}: BatchActionsProps) {
  const { state } = useDrive()

  if (state.selectedFiles.length === 0) {
    return null
  }

  return (
    <div className="gh-drive-batch-actions">
      <div className="gh-drive-batch-info">
        <span className="gh-drive-batch-count">
          已选择 {state.selectedFiles.length} 个文件
        </span>
        <button
          className="gh-drive-batch-clear"
          onClick={onClearSelection}
        >
          取消选择
        </button>
      </div>

      <div className="gh-drive-batch-buttons">
        <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onBatchDownload}>
          <DownloadIcon size={14} /> 批量下载
        </button>
        <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onBatchMove}>
          <FolderIcon size={14} /> 移动到
        </button>
        <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={onBatchFavorite}>
          <StarIcon size={14} /> 收藏
        </button>
        <button className="gh-btn gh-btn--sm gh-btn--danger" onClick={onBatchDelete}>
          <DeleteIcon size={14} /> 删除
        </button>
      </div>
    </div>
  )
})

export default BatchActions
