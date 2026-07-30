import { memo, useCallback, useState } from 'react'
import type { DriveItem, FavoriteItem } from '../../types/drive'
import { getFileTypeLabel } from '../../types/drive'
import FileAttributes from './FileAttributes'
import { useDrive } from '../../contexts/DriveContext'
import { CloseIcon, CopyIcon, DeleteIcon, DownloadIcon, getDriveIcon, RenameIcon, StarIcon } from './DriveIcons'

export interface DriveDetailPanelProps {
  item: DriveItem
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
  const [copied, setCopied] = useState(false)

  const isFavorite = useCallback((folderId: number) => {
    return state.favorites.some((favorite: FavoriteItem) => favorite.folderId === folderId)
  }, [state.favorites])

  const handleToggleFavorite = useCallback(() => {
    if (!item.isFolder) return
    if (isFavorite(item.id)) removeFavorite(item.id)
    else addFavorite(item.id, item.name)
  }, [item, isFavorite, addFavorite, removeFavorite])

  const handleCopyName = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(item.name)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch { /* clipboard access is optional */ }
  }, [item.name])

  const ext = item.name.split('.').pop()?.toLowerCase() || ''
  const isImage = item.mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)
  const isVideo = item.mimeType?.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)
  const isPreviewable = isImage || isVideo
  const isFav = item.isFolder && isFavorite(item.id)

  return (
    <aside className="gh-drive-detail-panel" aria-label="文件详情">
      <div className="gh-drive-detail-panel-inner">
        <div className="gh-drive-detail-header">
          <div>
            <span className="gh-drive-detail-eyebrow">选中项目</span>
            <h2 className="gh-drive-detail-title">文件详情</h2>
          </div>
          <button className="gh-drive-detail-close" onClick={onClose} aria-label="关闭详情" title="关闭详情">
            <CloseIcon size={16} />
          </button>
        </div>

        <div className="gh-drive-detail-preview">
          <div className="gh-drive-detail-preview-icon">{getDriveIcon(item, 42)}</div>
          <div className="gh-drive-detail-preview-name" title={item.name}>{item.name}</div>
          <div className="gh-drive-detail-preview-type">{getFileTypeLabel(item)}</div>
        </div>

        {item.isFolder && (
          <button
            className={`gh-drive-detail-fav-btn${isFav ? ' gh-drive-detail-fav-btn--active' : ''}`}
            onClick={handleToggleFavorite}
            title={isFav ? '取消收藏' : '加入收藏'}
          >
            <StarIcon size={17} filled={isFav} />
            <span>{isFav ? '已收藏' : '收藏文件夹'}</span>
          </button>
        )}

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
          <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={handleCopyName}>
            <CopyIcon size={14} /> {copied ? '已复制' : '复制名称'}
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
