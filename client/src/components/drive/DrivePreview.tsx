import { useState, useEffect, memo } from 'react'
import type { DriveItem } from '../../types/drive'

export interface DrivePreviewProps {
  item: DriveItem
  onClose: () => void
}

/* ---------- Image Preview ---------- */

const ImagePreview = memo(function ImagePreview({ item, onClose }: DrivePreviewProps) {
  const [loading, setLoading] = useState(true)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')
  const [loadProgress, setLoadProgress] = useState(0)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false

    const fetchImage = async () => {
      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch(`/api/drive/download/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('加载失败')
        if (cancelled) return

        const contentLength = parseInt(res.headers.get('X-Content-Length') || '0', 10)
        const reader = res.body!.getReader()
        const chunks: Uint8Array[] = []
        let loaded = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          loaded += value.length
          if (contentLength > 0 && !cancelled) {
            setLoadProgress(Math.round((loaded / contentLength) * 100))
          }
        }

        if (cancelled) return
        const blob = new Blob(chunks as BlobPart[], { type: item.mimeType || undefined })
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchImage()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.id, item.mimeType])

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container" onClick={e => e.stopPropagation()}>
        {loading && (
          <div className="preview-loading">
            <div className="spinner" />
            {loadProgress > 0 && (
              <p className="preview-loading-text">加载中 {loadProgress}%</p>
            )}
          </div>
        )}
        {error && <p className="preview-error">{error}</p>}
        {src && <img src={src} alt={item.name} className="preview-image" />}
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>
  )
})

/* ---------- Video Preview ---------- */

const VideoPreview = memo(function VideoPreview({ item, onClose }: DrivePreviewProps) {
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl: string | null = null
    const loadVideo = async () => {
      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch(`/api/drive/download/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('加载失败')
        const blob = await res.blob()
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      } catch (err: any) {
        setError(err.message)
      }
    }
    loadVideo()
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item.id])

  return (
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container preview-container--video" onClick={e => e.stopPropagation()}>
        {error ? (
          <p className="preview-error">{error}</p>
        ) : src ? (
          <video controls autoPlay className="preview-video" src={src} />
        ) : (
          <div className="spinner" />
        )}
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>
  )
})

/* ---------- DrivePreview Router ---------- */

const DrivePreview = memo(function DrivePreview({ item, onClose }: DrivePreviewProps) {
  const mime = (item.mimeType || '').toLowerCase()
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return <ImagePreview item={item} onClose={onClose} />
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
    return <VideoPreview item={item} onClose={onClose} />
  }
  return null
})

export default DrivePreview
