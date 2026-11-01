import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { api, getToken } from '../lib/api'
import { formatStorageSize } from '../lib/format'
import { useDragAndDrop } from '../hooks/useDragAndDrop'
import type { BookDto, BookUploadResponse, ReaderBooksResponse } from '../types/reader'

/**
 * 小说阅读器书架（/reader）：
 * 上传 EPUB/TXT（XHR 带进度，50MiB/本）、封面网格、继续阅读、删除。
 * 阅读视图在 ReaderBookPage（/reader/:bookId）。
 *
 * 上传两阶段：progress（浏览器→服务器）+ processing（服务器写存储节点/解析 EPUB 元数据）。
 * 大文件在第二阶段会停留一段时间，必须给出明确文案，否则看起来就是「卡在 100%」。
 */

const BOOK_MAX_BYTES = 50 * 1024 * 1024
/** 服务器处理阶段的上限（写节点 + 解析元数据；超时给明确报错而不是永远转圈） */
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000

type UploadPhase = 'idle' | 'uploading' | 'processing'

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function formatProgressPercent(percent: number): string {
  const value = Math.round(Math.min(Math.max(percent, 0), 1) * 100)
  return value > 0 ? `${value}%` : ''
}

function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime()
  if (!Number.isFinite(time)) return ''
  const diffMin = Math.floor((Date.now() - time) / 60000)
  if (diffMin < 1) return '刚刚'
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDay = Math.floor(diffHour / 24)
  if (diffDay < 30) return `${diffDay} 天前`
  return new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

export default function ReaderPage() {
  const navigate = useNavigate()
  const [books, setBooks] = useState<BookDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [phase, setPhase] = useState<UploadPhase>('idle')
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processingStartedAt, setProcessingStartedAt] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const uploading = phase !== 'idle'

  const showToast = useCallback((text: string, kind: 'success' | 'error') => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setToast({ text, kind })
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const data = await api.get<ReaderBooksResponse>('/reader/books')
      if (mountedRef.current) {
        setBooks(data.books)
        setLoadError('')
      }
    } catch (err) {
      if (mountedRef.current) setLoadError(errMessage(err, '书架加载失败'))
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
      xhrRef.current?.abort()
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    }
  }, [load])

  // 处理阶段的计时器（服务器写节点耗时不可预知，至少让用户看到在动）
  useEffect(() => {
    if (phase !== 'processing') {
      setElapsedSec(0)
      return
    }
    const timer = window.setInterval(() => {
      if (processingStartedAt > 0) {
        setElapsedSec(Math.floor((Date.now() - processingStartedAt) / 1000))
      }
    }, 500)
    return () => window.clearInterval(timer)
  }, [phase, processingStartedAt])

  const finishUpload = useCallback((err?: string) => {
    if (!mountedRef.current) return
    setPhase('idle')
    setUploadProgress(0)
    xhrRef.current = null
    if (err) setUploadError(err)
  }, [])

  // 上传：XHR 以获得进度回调（服务端会解析 EPUB 元数据并写入存储节点，大文件耗时明显）
  const uploadFile = useCallback((file: File) => {
    if (file.size > BOOK_MAX_BYTES) {
      setUploadError(`书籍大小超过限制（单本最多 ${formatStorageSize(BOOK_MAX_BYTES)}）`)
      return
    }
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.epub') && !lower.endsWith('.txt')) {
      setUploadError('仅支持 EPUB 与 TXT 文件')
      return
    }
    setUploadError('')
    setPhase('uploading')
    setUploadProgress(0)
    setProcessingStartedAt(0)

    const form = new FormData()
    form.append('file', file)
    const token = getToken()

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('POST', '/api/reader/books')
    xhr.timeout = UPLOAD_TIMEOUT_MS
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && mountedRef.current) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    // 请求体已发完但响应还没回来：进入「服务器处理中」阶段
    xhr.upload.onload = () => {
      if (!mountedRef.current) return
      setUploadProgress(100)
      setPhase('processing')
      setProcessingStartedAt(Date.now())
    }
    xhr.onload = () => {
      if (!mountedRef.current) return
      if (xhr.status >= 200 && xhr.status < 300) {
        finishUpload()
        try {
          const data = JSON.parse(xhr.responseText) as BookUploadResponse
          showToast(`《${data.book.title}》已加入书架`, 'success')
        } catch {
          showToast('上传成功', 'success')
        }
        void load(true)
      } else {
        let message = `上传失败（${xhr.status}）`
        try {
          const data = JSON.parse(xhr.responseText) as { error?: string }
          if (data.error) message = data.error
        } catch { /* 保持默认文案 */ }
        finishUpload(message)
      }
    }
    xhr.onerror = () => finishUpload('网络中断，上传失败（请检查网络后重试）')
    xhr.ontimeout = () => finishUpload('服务器处理超时，请稍后重试（大文件建议先压缩）')
    xhr.onabort = () => finishUpload('已取消上传')
    xhr.send(form)
  }, [finishUpload, load, showToast])

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // 允许重复选择同一文件
    if (file) uploadFile(file)
  }, [uploadFile])

  const cancelUpload = useCallback(() => {
    xhrRef.current?.abort()
  }, [])

  const { isDragging, dragProps } = useDragAndDrop({
    onFilesDropped: useCallback((files: FileList) => {
      const file = files[0]
      if (file) uploadFile(file)
    }, [uploadFile]),
  })

  const handleDelete = useCallback(async (book: BookDto) => {
    if (!window.confirm(`确定删除《${book.title}》吗？阅读进度将一并删除。`)) return
    setDeletingId(book.id)
    try {
      await api.delete(`/reader/books/${book.id}`)
      setBooks(prev => prev.filter(item => item.id !== book.id))
      showToast('已删除', 'success')
    } catch (err) {
      showToast(errMessage(err, '删除失败'), 'error')
    } finally {
      if (mountedRef.current) setDeletingId(null)
    }
  }, [showToast])

  const coverUrl = useCallback(
    (book: BookDto) => `/api/reader/books/${book.id}/cover?token=${encodeURIComponent(getToken() ?? '')}`,
    [],
  )

  const readingCount = useMemo(() => books.filter(book => book.progress).length, [books])

  return (
    <div className="gh-page gh-reader-page" {...dragProps}>
      <header className="gh-reader-header">
        <div>
          <h1 className="gh-reader-title">小说阅读器</h1>
          <p className="gh-reader-subtitle">
            EPUB / TXT 在线阅读 · 书架与进度自动同步
            {books.length > 0 && ` · 共 ${books.length} 本${readingCount > 0 ? `（在读 ${readingCount}）` : ''}`}
          </p>
        </div>
        <div className="gh-reader-header-actions">
          <button
            className="gh-btn gh-btn--primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            <Icon name="plus" size={16} />
            {uploading ? (phase === 'processing' ? '处理中…' : `上传中 ${uploadProgress}%`) : '上传书籍'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,.txt,application/epub+zip,text/plain"
            className="gh-reader-file-input"
            onChange={handleFileChange}
          />
        </div>
      </header>

      {uploading && (
        <div className={`gh-reader-upload-card ${phase === 'processing' ? 'gh-reader-upload-card--processing' : ''}`}>
          <div className="gh-reader-upload-head">
            <span className="gh-reader-upload-label">
              {phase === 'uploading'
                ? `正在上传 ${uploadProgress}%`
                : `服务器正在写入存储${elapsedSec > 0 ? ` · ${elapsedSec}s` : ''}`}
            </span>
            <button className="gh-btn gh-btn--ghost gh-btn--sm" onClick={cancelUpload}>取消</button>
          </div>
          <div className="gh-reader-upload-bar">
            <div
              className={`gh-reader-upload-bar-fill ${phase === 'processing' ? 'gh-reader-upload-bar-fill--processing' : ''}`}
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
          <p className="gh-reader-upload-hint">
            {phase === 'uploading'
              ? 'EPUB 会自动解析标题、作者与封面'
              : '文件已送达，正在写入存储节点（大文件需要几十秒，请别刷新页面）'}
          </p>
        </div>
      )}
      {uploadError && (
        <div className="gh-reader-alert gh-reader-alert--error">
          <span>{uploadError}</span>
          <button className="gh-reader-icon-btn" onClick={() => setUploadError('')} aria-label="关闭提示">
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {loading ? (
        <div className="gh-reader-grid" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="gh-reader-card gh-reader-card--skeleton">
              <span className="gh-reader-skeleton-cover" />
              <span className="gh-reader-skeleton-line" />
              <span className="gh-reader-skeleton-line gh-reader-skeleton-line--short" />
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div className="gh-reader-alert gh-reader-alert--error">
          {loadError}
          <button className="gh-btn gh-btn--ghost gh-btn--sm" onClick={() => void load()}>重试</button>
        </div>
      ) : books.length === 0 ? (
        <div className="gh-reader-empty">
          <span className="gh-reader-empty-icon"><Icon name="bookOpen" size={34} /></span>
          <p className="gh-reader-empty-title">书架还是空的</p>
          <p className="gh-reader-empty-hint">把 EPUB 或 TXT 拖到页面任意位置，或点右上角「上传书籍」</p>
          <p className="gh-reader-empty-hint">单本 ≤ 50 MiB · EPUB 自动抓封面与作者 · 计入网盘空间</p>
        </div>
      ) : (
        <div className="gh-reader-grid">
          {books.map((book) => {
            const percentText = formatProgressPercent(book.progress?.percent ?? 0)
            const percentValue = Math.min(Math.max(book.progress?.percent ?? 0, 0), 1)
            return (
              <article key={book.id} className="gh-reader-card" role="listitem">
                <button
                  className="gh-reader-card-cover"
                  onClick={() => navigate(`/reader/${book.id}`)}
                  aria-label={`阅读《${book.title}》`}
                >
                  {book.hasCover ? (
                    <img src={coverUrl(book)} alt="" loading="lazy" />
                  ) : (
                    <span className="gh-reader-card-cover-fallback">
                      <span className="gh-reader-card-spine" aria-hidden="true" />
                      <span className="gh-reader-card-initial" aria-hidden="true">
                        {(book.title.trim() || '书').slice(0, 1)}
                      </span>
                      <span className="gh-reader-card-format">{book.format.toUpperCase()}</span>
                    </span>
                  )}
                  <span className="gh-reader-card-hover">
                    <Icon name="play" size={15} />
                    <span>{book.progress ? '继续阅读' : '开始阅读'}</span>
                  </span>
                  {percentValue > 0 && (
                    <span className="gh-reader-card-progress-track" aria-hidden="true">
                      <span className="gh-reader-card-progress-fill" style={{ width: `${percentValue * 100}%` }} />
                    </span>
                  )}
                  {percentText && <span className="gh-reader-card-progress">{percentText}</span>}
                </button>
                <div className="gh-reader-card-meta">
                  <button
                    className="gh-reader-card-title"
                    onClick={() => navigate(`/reader/${book.id}`)}
                    title={book.title}
                  >
                    {book.title}
                  </button>
                  <span className="gh-reader-card-sub">
                    {book.author || '佚名'} · {book.format.toUpperCase()} · {formatStorageSize(book.size)}
                  </span>
                  <span className="gh-reader-card-last">
                    {book.progress
                      ? `${formatRelativeTime(book.progress.updatedAt)}读到 ${percentText}`
                      : `${formatRelativeTime(book.createdAt)}加入`}
                  </span>
                </div>
                <button
                  className="gh-reader-card-delete"
                  onClick={() => void handleDelete(book)}
                  disabled={deletingId === book.id}
                  aria-label={`删除《${book.title}》`}
                  title="删除"
                >
                  <Icon name="trash" size={14} />
                </button>
              </article>
            )
          })}
        </div>
      )}

      {isDragging && (
        <div className="gh-reader-dropzone">
          <Icon name="upload" size={30} />
          <p>松开即可上传 EPUB / TXT</p>
        </div>
      )}

      {toast && (
        <div className={`gh-reader-toast gh-reader-toast--${toast.kind}`}>{toast.text}</div>
      )}
    </div>
  )
}
