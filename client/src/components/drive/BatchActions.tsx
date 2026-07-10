import { memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import { useDrive } from '../../contexts/DriveContext'

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
    <div className="batch-actions">
      <div className="batch-actions-info">
        <span className="batch-actions-count">
          已选择 {state.selectedFiles.length} 个文件
        </span>
        <button
          className="batch-actions-clear"
          onClick={onClearSelection}
        >
          取消选择
        </button>
      </div>

      <div className="batch-actions-buttons">
        <LiquidButton size="sm" variant="glass" onClick={onBatchDownload}>
          ⬇ 批量下载
        </LiquidButton>
        <LiquidButton size="sm" variant="glass" onClick={onBatchMove}>
          📁 移动到
        </LiquidButton>
        <LiquidButton size="sm" variant="ghost" onClick={onBatchFavorite}>
          ⭐ 收藏
        </LiquidButton>
        <LiquidButton size="sm" variant="danger" onClick={onBatchDelete}>
          🗑️ 删除
        </LiquidButton>
      </div>
    </div>
  )
})

export default BatchActions
