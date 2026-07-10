import { memo, useCallback } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { DriveItem, FavoriteItem } from '../../types/drive'
import { getFileTypeLabel } from '../../types/drive'
import FileAttributes from './FileAttributes'
import { useDrive } from '../../contexts/DriveContext'
import { getDriveIcon, StarIcon, DownloadIcon, DeleteIcon, RenameIcon, CopyIcon } from './DriveIcons'

export interface DriveDetailPanelProps {
  item: DriveItem | null
  onClose: () => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
}

const DriveDetailPanel = memo(function DriveDetailPanel({
  item,
  onClose,
  onDownload,
  onRename,
  onDelete,
  onPreview,
}: DriveDetailPanelProps) {
  const { state, addFavorite, removeFavorite } = useDrive()

  const isFavorite = useCallback((folderId: number) => {
    return state.favorites.some((f: FavoriteItem) => f.folderId === folderId)
  }, [state.favorites])

  const handleToggleFavorite = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!item) return
    if (isFavorite(item.id)) {
      removeFavorite(item.id)
    } else {
      addFavorite(item.id, item.name)
    }
  }, [item, isFavorite, addFavorite, removeFavorite])

  if (!item) {
    return (
      <aside className="drive-detail-panel drive-detail-panel--empty">
        <LiquidGlass variant="blur" interactive={false} chromatic={false} className="drive-detail-panel-inner">
          <div className="drive-detail-empty">
            <span className="drive-detail-empty-icon">📋</span>
            <p className="drive-detail-empty-text">选择文件查看详情</p>
          </div>
        </LiquidGlass>
      </aside>
    )
  }

  const isImage = item.mimeType?.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(
      item.name.split('.').pop()?.toLowerCase() || ''
    )

  const isVideo = item.mimeType?.startsWith('video/') ||
    ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(
      item.name.split('.').pop()?.toLowerCase() || ''
    )

  const isPreviewable = isImage || isVideo
  const isFav = isFavorite(item.id)

  return (
    <aside className="drive-detail-panel">
      <LiquidGlass variant="blur" interactive={false} chromatic={false} className="drive-detail-panel-inner">
        {/* Header */}
        <div className="drive-detail-header">
          <h3 className="drive-detail-title">文件详情</h3>
          <button className="drive-detail-close" onClick={onClose} aria-label="关闭详情">
            ✕
          </button>
        </div>

        {/* Preview Area */}
        <div className="drive-detail-preview">
          <div className="drive-detail-preview-icon">
            {getDriveIcon(item, 48)}
          </div>
          <div className="drive-detail-preview-name" title={item.name}>
            {item.name}
          </div>
          <div className="drive-detail-preview-type">
            {getFileTypeLabel(item)}
          </div>
        </div>

        {/* Favorite Button */}
        <button
          className={`drive-detail-fav-btn ${isFav ? 'drive-detail-fav-btn--active' : ''}`}
          onClick={handleToggleFavorite}
          title={isFav ? '取消收藏' : '加入收藏'}
        >
          <StarIcon size={20} filled={isFav} />
          <span>{isFav ? '已收藏' : '收藏'}</span>
        </button>

        {/* Quick Actions */}
        <div className="drive-detail-actions">
          {isPreviewable && (
            <LiquidButton size="sm" variant="primary" onClick={() => onPreview(item)}>
              预览
            </LiquidButton>
          )}
          {!item.isFolder && (
            <LiquidButton size="sm" variant="glass" onClick={() => onDownload(item)}>
              <DownloadIcon size={14} /> 下载
            </LiquidButton>
          )}
          <LiquidButton size="sm" variant="ghost" onClick={() => onRename(item)}>
            <RenameIcon size={14} /> 重命名
          </LiquidButton>
          <LiquidButton size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(item.name)}>
            <CopyIcon size={14} /> 复制名称
          </LiquidButton>
          <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}>
            <DeleteIcon size={14} /> 删除
          </LiquidButton>
        </div>

        {/* File Attributes */}
        <FileAttributes item={item} />
      </LiquidGlass>
    </aside>
  )
})

export default DriveDetailPanel
