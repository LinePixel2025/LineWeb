import { memo, useCallback } from 'react'
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
      <aside className="gh-drive-detail-panel gh-drive-detail-panel--empty">
        <div className="gh-drive-detail-panel-inner gh-drive-detail-empty">
          <span className="gh-drive-detail-empty-icon">📋</span>
          <p className="gh-drive-detail-empty-text">选择文件查看详情</p>
        </div>
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
    <aside className="gh-drive-detail-panel">
      <div className="gh-drive-detail-panel-inner">
        <div className="gh-drive-detail-header">
          <h3 className="gh-drive-detail-title">文件详情</h3>
          <button className="gh-drive-detail-close" onClick={onClose} aria-label="关闭详情">
            ✕
          </button>
        </div>

        <div className="gh-drive-detail-preview">
          <div className="gh-drive-detail-preview-icon">
            {getDriveIcon(item, 48)}
          </div>
          <div className="gh-drive-detail-preview-name" title={item.name}>
            {item.name}
          </div>
          <div className="gh-drive-detail-preview-type">
            {getFileTypeLabel(item)}
          </div>
        </div>

        <button
          className={`gh-drive-detail-fav-btn ${isFav ? 'gh-drive-detail-fav-btn--active' : ''}`}
          onClick={handleToggleFavorite}
          title={isFav ? '取消收藏' : '加入收藏'}
        >
          <StarIcon size={20} filled={isFav} />
          <span>{isFav ? '已收藏' : '收藏'}</span>
        </button>

        <div className="gh-drive-detail-actions">
          {isPreviewable && (
            <button className="gh-btn gh-btn--sm gh-btn--primary" onClick={() => onPreview(item)}>
              预览
            </button>
          )}
          {!item.isFolder && (
            <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={() => onDownload(item)}>
              <DownloadIcon size={14} /> 下载
            </button>
          )}
          <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={() => onRename(item)}>
            <RenameIcon size={14} /> 重命名
          </button>
          <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={() => navigator.clipboard.writeText(item.name)}>
            <CopyIcon size={14} /> 复制名称
          </button>
          <button className="gh-btn gh-btn--sm gh-btn--danger" onClick={() => onDelete(item)}>
            <DeleteIcon size={14} /> 删除
          </button>
        </div>

        <FileAttributes item={item} />
      </div>
    </aside>
  )
})

export default DriveDetailPanel
