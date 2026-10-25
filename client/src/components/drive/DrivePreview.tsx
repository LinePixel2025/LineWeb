import { useState, memo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { DriveItem } from '../../types/drive'
import { resolvePreviewKind } from '../../lib/drivePreview'
import { renderMarkdown } from '../../lib/markdown'
import { AudioIcon, CloseIcon, FileIcon } from './DriveIcons'
import api from '../../lib/api'

export interface DrivePreviewProps {
  item: DriveItem
  onClose: () => void
}

function useDownloadUrl(itemId: number, inline = false) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let cancelled = false
    api.post<{ ticket: string }>(`/drive/download-ticket/${itemId}`)
      .then(({ ticket }) => {
        if (!cancelled) {
          const disposition = inline ? '&disposition=inline' : ''
          setUrl(`/api/drive/download/${itemId}?token=${encodeURIComponent(ticket)}${disposition}`)
        }
      })
      .catch(() => { if (!cancelled) setUrl('') })
    return () => { cancelled = true }
  }, [itemId, inline])
  return url
}

/* ---------- Image Preview ---------- */

const ImagePreview = memo(function ImagePreview({ item, onClose }: DrivePreviewProps) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const imgSrc = useDownloadUrl(item.id)

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
          {!error && imgSrc && (
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
  // inline 下发：Safari 对 attachment 的媒体资源可能拒播；同时规避 autoPlay 在移动端被禁的问题
  const videoSrc = useDownloadUrl(item.id, true)
  return createPortal(
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        {loading && <div className="gh-spinner" />}
        {error && <p className="gh-drive-preview-error">{error}</p>}
        {videoSrc && <video
          controls
          playsInline
          preload="metadata"
          className={`gh-drive-preview-video ${loading ? 'gh-drive-preview-video--hidden' : ''}`}
          src={videoSrc}
          onLoadedData={() => setLoading(false)}
          onError={() => { setLoading(false); setError('视频加载失败（浏览器可能不支持该编码格式）') }}
        >
          您的浏览器不支持视频播放
        </video>}
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Audio Preview ---------- */

const AudioPreview = memo(function AudioPreview({ item, onClose }: DrivePreviewProps) {
  const audioSrc = useDownloadUrl(item.id, true)
  return createPortal(
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <div className="gh-drive-preview-audio-wrap">
          <div className="gh-drive-preview-audio-icon"><AudioIcon size={48} /></div>
          <p className="gh-drive-preview-audio-name">{item.name}</p>
          {audioSrc && <audio controls autoPlay className="gh-drive-preview-audio" src={audioSrc}>
            您的浏览器不支持音频播放
          </audio>}
        </div>
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- PDF Preview ---------- */

const PdfPreview = memo(function PdfPreview({ item, onClose }: DrivePreviewProps) {
  // inline 下发让 iframe 能直接渲染；iOS Safari 不支持 iframe 内嵌 PDF，用「新窗口打开」兜底
  const pdfSrc = useDownloadUrl(item.id, true)
  return createPortal(
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <div className="gh-drive-preview-toolbar">
          <button
            className="gh-drive-preview-toolbar-btn"
            disabled={!pdfSrc}
            onClick={() => pdfSrc && window.open(pdfSrc, '_blank', 'noopener')}
            title="在新窗口打开"
          >
            ↗ 新窗口打开
          </button>
        </div>
        <iframe
          className="gh-drive-preview-pdf"
          src={pdfSrc || undefined}
          title={item.name}
        />
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Text / Code Preview ---------- */

const TextPreview = memo(function TextPreview({ item, onClose }: DrivePreviewProps) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.text(`/drive/download/${item.id}`)
      .then(content => { if (!cancelled) { setText(content); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : '读取失败'); setLoading(false) } })
    return () => { cancelled = true }
  }, [item.id])

  return createPortal(
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <div className="gh-drive-preview-toolbar">
          <span className="gh-drive-preview-toolbar-label">{item.name}</span>
        </div>
        {loading ? (
          <div className="gh-spinner" />
        ) : error ? (
          <p className="gh-drive-preview-error">{error}</p>
        ) : (
          <pre className="gh-drive-preview-code"><code>{text}</code></pre>
        )}
        <button className="gh-drive-preview-close" onClick={onClose} aria-label="关闭预览"><CloseIcon size={16} /></button>
      </div>
    </div>,
    document.body
  )
})

/* ---------- Markdown Preview ---------- */

const MarkdownPreview = memo(function MarkdownPreview({ item, onClose }: DrivePreviewProps) {
  const [html, setHtml] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    api.text(`/drive/download/${item.id}`)
      .then(content => { if (!cancelled) { setHtml(renderMarkdown(content)); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e instanceof Error ? e.message : '读取失败'); setLoading(false) } })
    return () => { cancelled = true }
  }, [item.id])

  return createPortal(
    <div className="gh-drive-preview-overlay" onClick={onClose}>
      <div className="gh-drive-preview-container" onClick={e => e.stopPropagation()}>
        <div className="gh-drive-preview-toolbar">
          <span className="gh-drive-preview-toolbar-label">{item.name}</span>
        </div>
        {loading ? (
          <div className="gh-spinner" />
        ) : error ? (
          <p className="gh-drive-preview-error">{error}</p>
        ) : (
          <div className="gh-drive-preview-markdown" dangerouslySetInnerHTML={{ __html: html }} />
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

  switch (resolvePreviewKind(item)) {
    case 'image': return <ImagePreview item={item} onClose={onClose} />
    case 'video': return <VideoPreview item={item} onClose={onClose} />
    case 'audio': return <AudioPreview item={item} onClose={onClose} />
    case 'pdf': return <PdfPreview item={item} onClose={onClose} />
    case 'markdown': return <MarkdownPreview item={item} onClose={onClose} />
    case 'text': return <TextPreview item={item} onClose={onClose} />
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
