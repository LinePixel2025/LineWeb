import { useState, memo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DriveItem } from '../../types/drive'

export interface DrivePreviewProps {
  item: DriveItem
  onClose: () => void
}

const TOKEN = () => encodeURIComponent(localStorage.getItem('lineweb_token') || '')

/* ---------- Image Preview ---------- */

const ImagePreview = memo(function ImagePreview({ item, onClose }: DrivePreviewProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const imgSrc = `/api/drive/download/${item.id}?token=${TOKEN()}`

  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container" onClick={e => e.stopPropagation()}>
        <div className="preview-toolbar">
          <button className="preview-toolbar-btn" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} title="缩小">−</button>
          <span className="preview-toolbar-label">{Math.round(zoom * 100)}%</span>
          <button className="preview-toolbar-btn" onClick={() => setZoom(z => Math.min(4, z + 0.25))} title="放大">+</button>
          <button className="preview-toolbar-btn" onClick={() => setRotation(r => r - 90)} title="左旋">↺</button>
          <button className="preview-toolbar-btn" onClick={() => setRotation(r => r + 90)} title="右旋">↻</button>
          <button className="preview-toolbar-btn" onClick={() => { setZoom(1); setRotation(0) }} title="重置">⟲</button>
        </div>
        <div className="preview-image-wrap">
          {loading && <div className="spinner" />}
          {error && <p className="preview-error">{error}</p>}
          {!error && (
            <img
              src={imgSrc}
              alt={item.name}
              className="preview-image"
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setError('图片加载失败') }}
            />
          )}
        </div>
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Video Preview ---------- */

const VideoPreview = memo(function VideoPreview({ item, onClose }: DrivePreviewProps) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const videoSrc = `/api/drive/download/${item.id}?token=${TOKEN()}`
  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container preview-container--video" onClick={e => e.stopPropagation()}>
        {loading && <div className="spinner" />}
        {error && <p className="preview-error">{error}</p>}
        <video
          controls autoPlay
          className={`preview-video ${loading ? 'preview-video--hidden' : ''}`}
          src={videoSrc}
          onLoadedData={() => setLoading(false)}
          onError={() => { setLoading(false); setError('视频加载失败') }}
        >
          您的浏览器不支持视频播放
        </video>
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Audio Preview ---------- */

const AudioPreview = memo(function AudioPreview({ item, onClose }: DrivePreviewProps) {
  const audioSrc = `/api/drive/download/${item.id}?token=${TOKEN()}`
  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container preview-container--audio" onClick={e => e.stopPropagation()}>
        <div className="preview-audio-icon">🎵</div>
        <p className="preview-audio-name">{item.name}</p>
        <audio controls autoPlay className="preview-audio" src={audioSrc}>
          您的浏览器不支持音频播放
        </audio>
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- PDF Preview ---------- */

const PdfPreview = memo(function PdfPreview({ item, onClose }: DrivePreviewProps) {
  const pdfSrc = `/api/drive/download/${item.id}?token=${TOKEN()}`
  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container preview-container--pdf" onClick={e => e.stopPropagation()}>
        <iframe
          className="preview-pdf"
          src={pdfSrc}
          title={item.name}
        />
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Code Preview ---------- */

const CodePreview = memo(function CodePreview({ item, onClose }: DrivePreviewProps) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const token = localStorage.getItem('lineweb_token')
    fetch(`/api/drive/download/${item.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.text())
      .then(text => { if (!cancelled) { setCode(text); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [item.id])

  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container preview-container--code" onClick={e => e.stopPropagation()}>
        {loading ? (
          <div className="spinner" />
        ) : error ? (
          <p className="preview-error">{error}</p>
        ) : (
          <pre className="preview-code"><code>{code}</code></pre>
        )}
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- DrivePreview Router ---------- */

const DrivePreview = memo(function DrivePreview({ item, onClose }: DrivePreviewProps) {
  const mime = (item.mimeType || '').toLowerCase()
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''

  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) {
    return <ImagePreview item={item} onClose={onClose} />
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
    return <VideoPreview item={item} onClose={onClose} />
  }
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac', 'aac'].includes(ext)) {
    return <AudioPreview item={item} onClose={onClose} />
  }
  if (mime.includes('pdf') || ext === 'pdf') {
    return <PdfPreview item={item} onClose={onClose} />
  }
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php', 'swift', 'kt', 'scala', 'html', 'css', 'scss', 'less', 'json', 'xml', 'yaml', 'yml', 'toml', 'md', 'sql', 'sh', 'bash', 'zsh', 'dockerfile', 'gitignore'].includes(ext)) {
    return <CodePreview item={item} onClose={onClose} />
  }

  return createPortal(
    <div className="preview-overlay" onClick={onClose}>
      <div className="preview-container" onClick={e => e.stopPropagation()}>
        <div className="preview-unsupported">
          <span className="preview-unsupported-icon">📄</span>
          <p className="preview-unsupported-text">此文件类型不支持预览</p>
          <p className="preview-unsupported-name">{item.name}</p>
        </div>
        <button className="preview-close" onClick={onClose} aria-label="关闭预览">✕</button>
      </div>
    </div>,
    document.body
  )
})

export default DrivePreview
