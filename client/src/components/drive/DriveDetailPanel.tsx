import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { DriveItem } from '../../types/drive'
import { getFileIcon, getFileTypeLabel } from '../../types/drive'
import { formatFileSize, formatDate } from '../../lib/format'

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
  if (!item) {
    return (
      <aside className="drive-detail-panel drive-detail-panel--empty">
        <LiquidGlass variant="blur" chromatic={false} className="drive-detail-panel-inner">
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

  return (
    <aside className="drive-detail-panel">
      <LiquidGlass variant="blur" chromatic={false} className="drive-detail-panel-inner">
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
            {getFileIcon(item)}
          </div>
          <div className="drive-detail-preview-name" title={item.name}>
            {item.name}
          </div>
          <div className="drive-detail-preview-type">
            {getFileTypeLabel(item)}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="drive-detail-actions">
          {isPreviewable && (
            <LiquidButton size="sm" variant="primary" onClick={() => onPreview(item)}>
              👁️ 预览
            </LiquidButton>
          )}
          {!item.isFolder && (
            <LiquidButton size="sm" variant="glass" onClick={() => onDownload(item)}>
              ⬇ 下载
            </LiquidButton>
          )}
          <LiquidButton size="sm" variant="ghost" onClick={() => onRename(item)}>
            ✏️ 重命名
          </LiquidButton>
          <LiquidButton size="sm" variant="danger" onClick={() => onDelete(item)}>
            🗑️ 删除
          </LiquidButton>
        </div>

        {/* File Info */}
        <div className="drive-detail-info">
          <h4 className="drive-detail-info-heading">文件信息</h4>
          <div className="drive-detail-info-list">
            {!item.isFolder && (
              <div className="drive-detail-info-row">
                <span className="drive-detail-info-label">大小</span>
                <span className="drive-detail-info-value">{formatFileSize(Number(item.size))}</span>
              </div>
            )}
            {item.isFolder && (
              <div className="drive-detail-info-row">
                <span className="drive-detail-info-label">类型</span>
                <span className="drive-detail-info-value">文件夹</span>
              </div>
            )}
            {item.mimeType && (
              <div className="drive-detail-info-row">
                <span className="drive-detail-info-label">MIME 类型</span>
                <span className="drive-detail-info-value">{item.mimeType}</span>
              </div>
            )}
            <div className="drive-detail-info-row">
              <span className="drive-detail-info-label">创建时间</span>
              <span className="drive-detail-info-value">{formatDate(item.createdAt)}</span>
            </div>
            <div className="drive-detail-info-row">
              <span className="drive-detail-info-label">修改时间</span>
              <span className="drive-detail-info-value">{formatDate(item.updatedAt)}</span>
            </div>
            {item.uploadedBy && (
              <div className="drive-detail-info-row">
                <span className="drive-detail-info-label">上传者</span>
                <span className="drive-detail-info-value">{item.uploadedBy.username}</span>
              </div>
            )}
          </div>
        </div>
      </LiquidGlass>
    </aside>
  )
})

export default DriveDetailPanel
