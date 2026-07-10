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
    <div className="thumbnail-grid">
      {items.map(item => {
        if (item.isFolder) {
          return (
            <div key={item.id} className="thumbnail-item thumbnail-item--folder">
              <span className="thumbnail-icon">📁</span>
            </div>
          )
        }

        const thumbnail = getThumbnail(item.id)
        const mime = (item.mimeType || '').toLowerCase()
        const isVideo = mime.startsWith('video/')

        return (
          <div key={item.id} className="thumbnail-item">
            {thumbnail.loading ? (
              <div className="thumbnail-loading">
                <div className="thumbnail-spinner" />
              </div>
            ) : thumbnail.url ? (
              <div className="thumbnail-preview">
                <img
                  src={thumbnail.url}
                  alt={item.name}
                  className="thumbnail-image"
                  loading="lazy"
                />
                {isVideo && (
                  <div className="thumbnail-video-badge">
                    <span>▶</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="thumbnail-fallback">
                <span className="thumbnail-icon">
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
