import { memo } from 'react'
import { useThumbnails } from '../../hooks/useThumbnails'
import type { DriveItem } from '../../types/drive'

export interface ThumbnailGridProps {
  items: DriveItem[]
  size?: 'small' | 'medium' | 'large'
}

const ThumbnailGrid = memo(function ThumbnailGrid({ items, size = 'medium' }: ThumbnailGridProps) {
  const fileIds = items
    .filter(item => {
      if (item.isFolder) return false
      const mime = (item.mimeType || '').toLowerCase()
      const ext = item.name.split('.').pop()?.toLowerCase() || ''
      return mime.startsWith('image/') || mime.startsWith('video/') ||
        ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm'].includes(ext)
    })
    .map(item => item.id)

  const { getThumbnail } = useThumbnails(fileIds, { size })

  return (
    <div className="gh-drive-thumbnail-grid">
      {items.map(item => {
        if (item.isFolder) {
          return (
            <div key={item.id} className="gh-drive-thumbnail-item gh-drive-thumbnail-item--folder">
              <span className="gh-drive-thumbnail-icon">📁</span>
            </div>
          )
        }

        const thumbnail = getThumbnail(item.id)
        const mime = (item.mimeType || '').toLowerCase()
        const isVideo = mime.startsWith('video/')

        return (
          <div key={item.id} className="gh-drive-thumbnail-item">
            {thumbnail.loading ? (
              <div className="gh-drive-thumbnail-loading">
                <div className="gh-spinner" />
              </div>
            ) : thumbnail.url ? (
              <div className="gh-drive-thumbnail-preview">
                <img
                  src={thumbnail.url}
                  alt={item.name}
                  className="gh-drive-thumbnail-image"
                  loading="lazy"
                />
                {isVideo && (
                  <div className="gh-drive-thumbnail-video-badge">
                    <span>▶</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="gh-drive-thumbnail-fallback">
                <span className="gh-drive-thumbnail-icon">
                  {isVideo ? '🎬' : '📄'}
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
})

export default ThumbnailGrid
