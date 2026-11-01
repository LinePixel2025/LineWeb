import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/ui/Icon'
import { api, getToken } from '../lib/api'
import { formatStorageSize } from '../lib/format'
import type { BookDto, BookUploadResponse, ReaderBooksResponse } from '../types/reader'

/**
 * 小说阅读器书架（/reader）：
 * 上传 EPUB/TXT（XHR 带进度，50MiB/本）、封面网格、继续阅读、删除。
 * 阅读视图在 ReaderBookPage（/reader/:bookId）。
 */

const BOOK_MAX_BYTES = 50 * 1024 * 1024

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function formatProgressPercent(percent: number): string {
  const value = Math.round(Math.min(Math.max(percent, 0), 1) * 100)
  return value > 0 ? `${value}%` : ''
}

export default function ReaderPage() {
  const navigate = useNavigate()
  const [books, setBooks] = useState<BookDto[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'success' | 'error' } | null>(null)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

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

  // 上传：XHR 以获得进度回调（服务端会解析 EPUB 元数据，大文件耗时明显）
  const uploadFile = useCallback((file: File) => {
    if (file.size > BOOK_MAX_BYTES) {
      setUploadError(`书籍大小超过限制（单本最多 ${formatStorageSize(BOOK_MAX_BYTES)}）`)
      return
    }
    setUploadError('')
    setUploading(true)
    setUploadProgress(0)

    const form = new FormData()
    form.append('file', file)
    const token = getToken()

    const xhr = new XMLHttpRequest()
    xhrRef.current = xhr
    xhr.open('POST', '/api/reader/books')
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && mountedRef.current) {
        setUploadProgress(Math.round((event.loaded / event.total) * 100))
      }
    }
    xhr.onload = () => {
      if (!mountedRef.current) return
      setUploading(false)
      if (xhr.status >= 200 && xhr.status < 300) {
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
        setUploadError(message)
      }
    }
    xhr.onerror = () => {
      if (mountedRef.current) {
        setUploading(false)
        setUploadError('网络错误，上传失败')
      }
    }
    xhr.send(form)
  }, [load, showToast])

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = '' // 允许重复选择同一文件
    if (file) uploadFile(file)
  }, [uploadFile])

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

  const coverUrl = (book: BookDto) =>
    `/api/reader/books/${book.id}/cover?token=${encodeURIComponent(getToken() ?? '')}`

  return (
    <div className="gh-page gh-reader-page">
      <header className="gh-reader-header">
        <div>
          <h1 className="gh-reader-title">小说阅读器</h1>
          <p className="gh-reader-subtitle">上传 EPUB / TXT，网页上接着读——书架与阅读进度自动同步。</p>
        </div>
        <button
          className="gh-btn gh-btn--primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Icon name="plus" size={16} />
          {uploading ? `上传中 ${uploadProgress}%` : '上传书籍'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub,.txt,application/epub+zip,text/plain"
          className="gh-reader-file-input"
          onChange={handleFileChange}
        />
      </header>

      {uploading && (
        <div className="gh-reader-upload-bar">
          <div className="gh-reader-upload-bar-fill" style={{ width: `${uploadProgress}%` }} />
        </div>
      )}
      {uploadError && <div className="gh-reader-alert gh-reader-alert--error">{uploadError}</div>}

      {loading ? (
        <div className="gh-reader-loading">书架加载中…</div>
      ) : loadError ? (
        <div className="gh-reader-alert gh-reader-alert--error">
          {loadError}
          <button className="gh-btn gh-btn--ghost" onClick={() => void load()}>重试</button>
        </div>
      ) : books.length === 0 ? (
        <div className="gh-reader-empty">
          <Icon name="bookOpen" size={40} />
          <p>书架还是空的</p>
          <p className="gh-reader-empty-hint">选择一本 EPUB 或 TXT 小说上传（单本 ≤ 50 MiB，计入网盘空间）</p>
        </div>
      ) : (
        <div className="gh-reader-grid">
          {books.map((book) => {
            const percentText = formatProgressPercent(book.progress?.percent ?? 0)
            return (
              <div key={book.id} className="gh-reader-card" role="listitem">
                <button
                  className="gh-reader-card-cover"
                  onClick={() => navigate(`/reader/${book.id}`)}
                  aria-label={`阅读《${book.title}》`}
                >
                  {book.hasCover ? (
                    <img src={coverUrl(book)} alt="" loading="lazy" />
                  ) : (
                    <span className="gh-reader-card-cover-fallback">
                      <Icon name="bookOpen" size={28} />
                      <span>{book.format.toUpperCase()}</span>
                    </span>
                  )}
                  {percentText && <span className="gh-reader-card-progress">{percentText}</span>}
                </button>
                <div className="gh-reader-card-meta">
                  <button className="gh-reader-card-title" onClick={() => navigate(`/reader/${book.id}`)} title={book.title}>
                    {book.title}
                  </button>
                  <span className="gh-reader-card-sub">
                    {book.author || '佚名'} · {formatStorageSize(book.size)}
                  </span>
                  {book.progress && (
                    <span className="gh-reader-card-last">
                      {new Date(book.progress.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 读到 {percentText}
                    </span>
                  )}
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
              </div>
            )
          })}
        </div>
      )}

      {toast && (
        <div className={`gh-reader-toast gh-reader-toast--${toast.kind}`}>{toast.text}</div>
      )}
    </div>
  )
}
