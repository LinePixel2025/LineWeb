import { useState, useEffect, useCallback, useRef } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import api, { ApiError } from '../lib/api'

/* ---------- Types ---------- */

interface DriveItem {
  id: number
  name: string
  isFolder: boolean
  parentId: number | null
  size: number
  mimeType: string | null
  createdAt: string
  updatedAt: string
  uploadedBy?: { id: number; username: string }
}

interface Breadcrumb {
  id: number | null
  name: string
}

/* ---------- Helpers ---------- */

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function getFileIcon(item: DriveItem): string {
  if (item.isFolder) return '📁'
  const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
  const mime = (item.mimeType || '').toLowerCase()
  if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️'
  if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) return '🎬'
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵'
  if (mime.includes('pdf') || ext === 'pdf') return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext)) return '📑'
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '🗜️'
  if (['js', 'ts', 'py', 'java', 'go', 'rs', 'c', 'cpp', 'html', 'css'].includes(ext)) return '💻'
  return '📄'
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function getMimeDisplay(mimeType: string | null, isFolder: boolean): string {
  if (isFolder) return '文件夹'
  if (!mimeType) return '文件'
  const parts = mimeType.split('/')
  return parts[1]?.toUpperCase() || '文件'
}

/* ---------- Upload Zone Component ---------- */

function UploadZone({ parentId, onUploaded }: { parentId: number | null; onUploaded: () => void }) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [showZone, setShowZone] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true)
    const fileArray = Array.from(files)
    setProgress({ current: 0, total: fileArray.length })

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]
      const formData = new FormData()
      formData.append('file', file)
      if (parentId !== null) {
        formData.append('parentId', String(parentId))
      }

      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          throw new Error(err.error || '上传失败')
        }
      } catch (err: any) {
        alert(`上传失败: ${file.name}\n${err.message}`)
      }
      setProgress({ current: i + 1, total: fileArray.length })
    }

    setUploading(false)
    setProgress(null)
    setShowZone(false)
    onUploaded()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files)
    }
  }

  if (!showZone && !uploading) {
    return (
      <LiquidButton size="sm" variant="primary" onClick={() => setShowZone(true)}>
        ⬆ 上传文件
      </LiquidButton>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <LiquidButton size="sm" variant="primary" onClick={() => fileInputRef.current?.click()}>
          ⬆ 选择文件
        </LiquidButton>
        {uploading ? null : (
          <LiquidButton size="sm" variant="ghost" onClick={() => setShowZone(false)}>取消</LiquidButton>
        )}
      </div>
      {!uploading && (
        <div
          className={`drive-upload-zone ${dragOver ? 'drive-upload-zone--drag' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          📂 拖拽文件到此处或点击选择
          <div className="drive-upload-zone-hint">
            支持多文件上传，单个文件最大 500MB
          </div>
        </div>
      )}
      {uploading && progress && (
        <div className="drive-progress">
          ⏳ 上传中... {progress.current}/{progress.total}
          <div className="drive-progress-bar">
            <div className="drive-progress-fill" style={{ width: `${(progress.current / progress.total) * 100}%` }} />
          </div>
        </div>
      )}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={handleFileSelect}
      />
    </div>
  )
}

/* ---------- New Folder Dialog ---------- */

function NewFolderDialog({ parentId, onCreated }: { parentId: number | null; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError('')
    try {
      await api.post('/drive/folders', { name: name.trim(), parentId })
      setOpen(false)
      setName('')
      onCreated()
    } catch (err: any) {
      setError(err.message || '创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <LiquidButton size="sm" variant="glass" onClick={() => setOpen(true)}>
        📁 新建文件夹
      </LiquidButton>
      {open && (
        <div className="dialog-overlay" onClick={() => setOpen(false)}>
          <div className="lg-surface-strong drive-dialog" onClick={e => e.stopPropagation()}>
            <h3>新建文件夹</h3>
            {error && <div className="editor-error">{error}</div>}
            <input
              className="lg-input drive-dialog-input"
              type="text"
              placeholder="文件夹名称"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="drive-dialog-actions">
              <LiquidButton size="sm" variant="ghost" onClick={() => setOpen(false)}>取消</LiquidButton>
              <LiquidButton size="sm" variant="primary" onClick={handleCreate} disabled={loading || !name.trim()}>
                {loading ? '创建中...' : '创建'}
              </LiquidButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- Rename Trigger (only the clickable name) ---------- */

function RenameTrigger({ item, onRename }: { item: DriveItem; onRename: (item: DriveItem) => void }) {
  return (
    <span
      className="drive-name-link"
      onClick={() => onRename(item)}
      title="点击重命名"
    >
      {item.isFolder ? '📁 ' : getFileIcon(item) + ' '}
      {item.name}
    </span>
  )
}

/* ---------- Rename Dialog (rendered as portal at top level) ---------- */

function RenameDialog({ item, onRenamed, onClose }: { item: DriveItem; onRenamed: () => void; onClose: () => void }) {
  const [name, setName] = useState(item.name)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRename = async () => {
    if (!name.trim() || name.trim() === item.name) {
      onClose()
      return
    }
    setLoading(true)
    setError('')
    try {
      await api.put(`/drive/files/${item.id}`, { name: name.trim() })
      onRenamed()
    } catch (err: any) {
      setError(err.message || '重命名失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="lg-surface-strong drive-dialog" onClick={e => e.stopPropagation()}>
        <h3>重命名</h3>
        {error && <div className="editor-error">{error}</div>}
        <input
          className="lg-input drive-dialog-input"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleRename()}
          autoFocus
        />
        <div className="drive-dialog-actions">
          <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
          <LiquidButton size="sm" variant="primary" onClick={handleRename} disabled={loading || !name.trim()}>
            {loading ? '保存中...' : '保存'}
          </LiquidButton>
        </div>
      </div>
    </div>
  )
}

/* ---------- Delete Confirm Dialog ---------- */

function DeleteDialog({ item, onDeleted, onClose }: { item: DriveItem; onDeleted: () => void; onClose: () => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    setLoading(true)
    setError('')
    try {
      await api.delete(`/drive/files/${item.id}`)
      onDeleted()
    } catch (err: any) {
      setError(err.message || '删除失败')
      setLoading(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="lg-surface-strong drive-dialog" onClick={e => e.stopPropagation()}>
        <h3>确认删除</h3>
        {error && <div className="editor-error">{error}</div>}
        <p className="drive-dialog-desc">
          确定要删除 {item.isFolder ? '文件夹' : '文件'} <strong>{item.name}</strong> 吗？
          {item.isFolder && <><br/>文件夹内的所有内容将一并删除。</>}
        </p>
        <p className="drive-dialog-warn">此操作不可撤销。</p>
        <div className="drive-dialog-actions">
          <LiquidButton size="sm" variant="ghost" onClick={onClose}>取消</LiquidButton>
          <LiquidButton size="sm" variant="danger" onClick={handleDelete} disabled={loading}>
            {loading ? '删除中...' : '确认删除'}
          </LiquidButton>
        </div>
      </div>
    </div>
  )
}

/* ---------- Image Preview (Lightbox) ---------- */

function ImagePreview({ item, onClose }: { item: DriveItem; onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [src, setSrc] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let objectUrl: string | null = null
    const fetchImage = async () => {
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
      } finally {
        setLoading(false)
      }
    }
    fetchImage()
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item.id])

  return (
    <div className="dialog-overlay" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.85)', cursor: 'zoom-out' }}>
      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: '90vw', maxHeight: '85vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {loading && <div className="spinner" />}
        {error && <p style={{ color: '#fff' }}>{error}</p>}
        {src && <img src={src} alt={item.name}
          style={{ maxWidth: '100%', maxHeight: '85vh', borderRadius: '12px', objectFit: 'contain' }} />}
        <button onClick={onClose} style={{
          position: 'absolute', top: '-40px', right: '0',
          background: 'none', border: 'none', color: '#fff',
          fontSize: '1.5rem', cursor: 'pointer', padding: '4px 8px',
        }} aria-label="关闭预览">✕</button>
      </div>
    </div>
  )
}

/* ---------- Video Preview ---------- */

function VideoPreview({ item, onClose }: { item: DriveItem; onClose: () => void }) {
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
    <div className="dialog-overlay" onClick={onClose} style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: '85vw', maxHeight: '85vh',
        position: 'relative',
      }}>
        {error ? (
          <p style={{ color: '#fff' }}>{error}</p>
        ) : src ? (
          <video controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '12px' }} src={src} />
        ) : (
          <div className="spinner" />
        )}
        <button onClick={onClose} style={{
          position: 'absolute', top: '-40px', right: '0',
          background: 'none', border: 'none', color: '#fff',
          fontSize: '1.5rem', cursor: 'pointer', padding: '4px 8px',
        }} aria-label="关闭预览">✕</button>
      </div>
    </div>
  )
}

/* ---------- Main DrivePage ---------- */

export default function DrivePage() {
  const [items, setItems] = useState<DriveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DriveItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: null, name: '根目录' }])
  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null

  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<DriveItem | null>(null)
  const [renameItem, setRenameItem] = useState<DriveItem | null>(null)

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetchItems = useCallback(async (parentId: number | null) => {
    setLoading(true)
    setError('')
    try {
      const params = parentId !== null ? `?parentId=${parentId}` : ''
      const data = await api.get<DriveItem[]>(`/drive/files${params}`)
      setItems(data)
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems(currentParentId)
  }, [currentParentId, fetchItems])

  // Search with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults(null)
      setSearching(false)
      return
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await api.get<DriveItem[]>(`/drive/search?q=${encodeURIComponent(searchQuery)}`)
        setSearchResults(data)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery])

  const navigateToFolder = (item: DriveItem) => {
    if (!item.isFolder) return
    setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])
    setSearchQuery('')
    setSearchResults(null)
  }

  const navigateToBreadcrumb = (index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1))
    setSearchQuery('')
    setSearchResults(null)
  }

  const handleDownload = async (item: DriveItem) => {
    if (item.isFolder) return
    try {
      const token = localStorage.getItem('lineweb_token')
      const res = await fetch(`/api/drive/download/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '下载失败')
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || '下载失败')
    }
  }

  const handlePreview = (item: DriveItem) => {
    if (item.isFolder) return
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      setPreviewItem(item)
    } else if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      setPreviewItem(item)
    } else {
      handleDownload(item)
    }
  }

  const renderPreview = () => {
    if (!previewItem) return null
    const mime = (previewItem.mimeType || '').toLowerCase()
    const ext = previewItem.name.includes('.') ? previewItem.name.split('.').pop()!.toLowerCase() : ''
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
      return <ImagePreview item={previewItem} onClose={() => setPreviewItem(null)} />
    }
    if (mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      return <VideoPreview item={previewItem} onClose={() => setPreviewItem(null)} />
    }
    return null
  }

  const displayItems = searchResults !== null ? searchResults : items
  const isSearching = searchResults !== null

  return (
    <div className="page container drive-page">
      <LiquidGlass variant="blur" className="page-card" style={{ padding: '24px' }}>
        {/* Header */}
        <div className="drive-header">
          <h1>☁️ 网盘</h1>
          <div className="drive-header-actions">
            <NewFolderDialog parentId={currentParentId} onCreated={() => fetchItems(currentParentId)} />
            <UploadZone parentId={currentParentId} onUploaded={() => fetchItems(currentParentId)} />
          </div>
        </div>

        {/* Search */}
        <div className="drive-search">
          <input
            className="lg-input drive-search-input"
            type="text"
            placeholder="🔍 搜索文件..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <span className="drive-search-hint">
            {searching ? '搜索中...' : searchResults !== null ? `找到 ${searchResults.length} 项` : ''}
          </span>
        </div>

        {/* Breadcrumbs */}
        <div className="drive-breadcrumbs">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
              {i > 0 && <span className="drive-breadcrumb-sep">›</span>}
              {i === breadcrumbs.length - 1 ? (
                <span className="drive-breadcrumb-current">{crumb.name}</span>
              ) : (
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className="drive-breadcrumb-btn"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>

        {/* Content */}
        {loading ? (
          <div className="drive-loading"><div className="spinner" /></div>
        ) : error ? (
          <LiquidGlass variant="blur" className="drive-error">
            <p className="drive-error-text">⚠️ {error}</p>
            <LiquidButton size="sm" variant="glass" onClick={() => fetchItems(currentParentId)}>
              重试
            </LiquidButton>
          </LiquidGlass>
        ) : displayItems.length === 0 ? (
          <LiquidGlass variant="blur" className="drive-empty">
            <span className="drive-empty-icon">☁️</span>
            <p className="drive-empty-text">
              {isSearching ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
            </p>
          </LiquidGlass>
        ) : (
          <div className="drive-table-wrap">
            <table className="drive-table">
              <thead>
                <tr>
                  <th className="col-name">名称</th>
                  <th className="col-size">大小</th>
                  <th className="col-type">类型</th>
                  <th className="col-date">修改时间</th>
                  <th className="col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item, i) => (
                  <tr key={item.id} className="drive-row fade-in" style={{ animationDelay: `${i * 0.04}s` }}>
                    <td className="drive-cell drive-cell--name">
                      {item.isFolder ? (
                        <span onClick={() => navigateToFolder(item)}
                          className="drive-name-link drive-name-link--folder">
                          📁 {item.name}
                        </span>
                      ) : (
                        <RenameTrigger item={item} onRename={setRenameItem} />
                      )}
                    </td>
                    <td className="drive-cell drive-cell--size">{formatFileSize(Number(item.size))}</td>
                    <td className="drive-cell drive-cell--type">{getMimeDisplay(item.mimeType, item.isFolder)}</td>
                    <td className="drive-cell drive-cell--date">{formatDate(item.updatedAt)}</td>
                    <td className="drive-cell drive-cell--actions">
                      <div className="drive-actions">
                        {!item.isFolder && (
                          <>
                            <LiquidButton size="sm" variant="ghost" onClick={() => handlePreview(item)}>
                              预览
                            </LiquidButton>
                            <LiquidButton size="sm" variant="ghost" onClick={() => handleDownload(item)}>
                              下载
                            </LiquidButton>
                          </>
                        )}
                        <LiquidButton size="sm" variant="danger" onClick={() => setDeleteItem(item)}>
                          删除
                        </LiquidButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="drive-count">共 {displayItems.length} 项</div>
          </div>
        )}
      </LiquidGlass>

      {/* Modal overlays */}
      {renderPreview()}
      {renameItem && (
        <RenameDialog
          item={renameItem}
          onClose={() => setRenameItem(null)}
          onRenamed={() => {
            setRenameItem(null)
            fetchItems(currentParentId)
          }}
        />
      )}
      {deleteItem && (
        <DeleteDialog
          item={deleteItem}
          onClose={() => setDeleteItem(null)}
          onDeleted={() => {
            setDeleteItem(null)
            fetchItems(currentParentId)
          }}
        />
      )}
    </div>
  )
}
