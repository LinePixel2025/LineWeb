import { memo } from 'react'
import { useDrive } from '../../contexts/DriveContext'
import { DownloadIcon, FolderIcon, StarIcon, DeleteIcon } from './DriveIcons'

export interface BatchActionsProps {
  onBatchDownload?: () => void
  onBatchMove?: () => void
  onBatchDelete?: () => void
  onBatchFavorite?: () => void
  onClearSelection?: () => void
  /** 是否展示写操作（移动/删除）：公共网盘下普通用户只读 */
  canWrite?: boolean
  /** 是否展示收藏：公共网盘不提供收藏（收藏指向私有盘文件夹） */
  showFavorite?: boolean
}

const BatchActions = memo(function BatchActions({
  onBatchDownload,
  onBatchMove,
  onBatchDelete,
  onBatchFavorite,
  onClearSelection,
  canWrite = true,
  showFavorite = true,
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
        {canWrite && (
          <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onBatchMove}>
            <FolderIcon size={14} /> 移动到
          </button>
        )}
        {canWrite && showFavorite && (
          <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={onBatchFavorite}>
            <StarIcon size={14} /> 收藏
          </button>
        )}
        {canWrite && (
          <button className="gh-btn gh-btn--sm gh-btn--danger" onClick={onBatchDelete}>
            <DeleteIcon size={14} /> 删除
          </button>
        )}
      </div>
    </div>
  )
})

export default BatchActions
