import { useState, memo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DriveItem } from '../../types/drive'
import { AudioIcon, CloseIcon, FileIcon } from './DriveIcons'

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
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <div className="gh-drive-preview-toolbar">
          <button className="gh-drive-preview-toolbar-btn" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} title="缩小">−</button>
          <span className="gh-drive-preview-toolbar-label">{Math.round(zoom * 100)}%</span>
          <button className="gh-drive-preview-toolbar-btn" onClick={() => setZoom(z => Math.min(4, z + 0.25))} title="放大">+</button>
          <button className="gh-drive-preview-toolbar-btn" onClick={() => setRotation(r => r - 90)} title="左旋">↺</button>
          <button className="gh-drive-preview-toolbar-btn" onClick={() => setRotation(r => r + 90)} title="右旋">↻</button>
          <button className="gh-drive-preview-toolbar-btn" onClick={() => { setZoom(1); setRotation(0) }} title="重置">⟲</button>
        </div>
        <div className="gh-drive-preview-image-wrap">
          {loading && <div className="gh-spinner" />}
          {error && <p className="gh-drive-preview-error">{error}</p>}
          {!error && (
            <img
              src={imgSrc}
              alt={item.name}
              className="gh-drive-preview-image"
              style={{ transform: `scale(${zoom}) rotate(${rotation}deg)` }}
              onLoad={() => setLoading(false)}
              onError={() => { setLoading(false); setError('图片加载失败') }}
            />
          )}
        </div>
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
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
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        {loading && <div className="gh-spinner" />}
        {error && <p className="gh-drive-preview-error">{error}</p>}
        <video
          controls autoPlay
          className={`gh-drive-preview-video ${loading ? 'gh-drive-preview-video--hidden' : ''}`}
          src={videoSrc}
          onLoadedData={() => setLoading(false)}
          onError={() => { setLoading(false); setError('视频加载失败') }}
        >
          您的浏览器不支持视频播放
        </video>
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Audio Preview ---------- */

const AudioPreview = memo(function AudioPreview({ item, onClose }: DrivePreviewProps) {
  const audioSrc = `/api/drive/download/${item.id}?token=${TOKEN()}`
  return createPortal(
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <div className="gh-drive-preview-audio-wrap">
          <div className="gh-drive-preview-audio-icon"><AudioIcon size={48} /></div>
          <p className="gh-drive-preview-audio-name">{item.name}</p>
          <audio controls autoPlay className="gh-drive-preview-audio" src={audioSrc}>
            您的浏览器不支持音频播放
          </audio>
        </div>
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- PDF Preview ---------- */

const PdfPreview = memo(function PdfPreview({ item, onClose }: DrivePreviewProps) {
  const pdfSrc = `/api/drive/download/${item.id}?token=${TOKEN()}`
  return createPortal(
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <iframe
          className="gh-drive-preview-pdf"
          src={pdfSrc}
          title={item.name}
        />
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
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
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        {loading ? (
          <div className="gh-spinner" />
        ) : error ? (
          <p className="gh-drive-preview-error">{error}</p>
        ) : (
          <pre className="gh-drive-preview-code"><code>{code}</code></pre>
        )}
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- DrivePreview Router ---------- */

const DrivePreview = memo(function DrivePreview({ item, onClose }: DrivePreviewProps) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

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
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <div className="gh-drive-preview-unsupported">
          <span className="gh-drive-preview-unsupported-icon"><FileIcon size={48} /></span>
          <p className="gh-drive-preview-unsupported-text">此文件类型不支持预览</p>
          <p className="gh-drive-preview-unsupported-name">{item.name}</p>
        </div>
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

export default DrivePreview
