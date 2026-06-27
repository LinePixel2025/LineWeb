import { useState, useEffect, useCallback, useRef } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import api from '../lib/api'

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
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${dragOver ? 'var(--lg-accent)' : 'var(--lg-border)'}`,
            borderRadius: '10px',
            padding: '24px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
            background: dragOver ? 'var(--lg-accent-alpha, rgba(0,122,255,0.05))' : 'transparent',
            color: 'var(--lg-text-secondary)',
            fontSize: '0.875rem',
          }}
        >
          📂 拖拽文件到此处或点击选择
          <div style={{ fontSize: '0.75rem', marginTop: '4px', opacity: 0.7 }}>
            支持多文件上传，单个文件最大 {Math.round(parseInt(import.meta.env.VITE_MAX_FILE_SIZE_MB || '500') / 1000 * 10) / 10}GB
          </div>
        </div>
      )}
      {uploading && progress && (
        <div style={{ fontSize: '0.875rem', color: 'var(--lg-text-secondary)' }}>
          ⏳ 上传中... {progress.current}/{progress.total}
          <div style={{
            marginTop: '4px',
            height: '4px',
            borderRadius: '2px',
            background: 'var(--lg-border)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${(progress.current / progress.total) * 100}%`,
              background: 'var(--lg-accent)',
              borderRadius: '2px',
              transition: 'width 0.3s',
            }} />
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

  const handleCreate = async () => {
    if (!name.trim()) return
    setLoading(true)
    try {
      await api.post('/drive/folders', { name: name.trim(), parentId })
      setOpen(false)
      setName('')
      onCreated()
    } catch (err: any) {
      alert(err.message || '创建失败')
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
          <div className="lg-surface-strong dialog" onClick={(e: React.MouseEvent) => e.stopPropagation()}
            style={{ padding: '24px', borderRadius: '16px', maxWidth: '400px', margin: 'auto', position: 'relative' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.125rem' }}>新建文件夹</h3>
            <input
              className="lg-input"
              type="text"
              placeholder="文件夹名称"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              autoFocus
              style={{ width: '100%', marginBottom: '16px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
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

/* ---------- Rename Dialog ---------- */

function RenameDialog({ item, onRenamed }: { item: DriveItem; onRenamed: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(item.name)
  const [loading, setLoading] = useState(false)

  const handleRename = async () => {
    if (!name.trim() || name.trim() === item.name) {
      setOpen(false)
      return
    }
    setLoading(true)
    try {
      await api.put(`/drive/files/${item.id}`, { name: name.trim() })
      setOpen(false)
      onRenamed()
    } catch (err: any) {
      alert(err.message || '重命名失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <span className="drive-link" onClick={() => { setName(item.name); setOpen(true) }}
        title="点击重命名" style={{ cursor: 'pointer' }}>
        {item.isFolder ? '📁 ' : getFileIcon(item) + ' '}
        {item.name}
      </span>
      {open && (
        <div className="dialog-overlay" onClick={() => setOpen(false)}>
          <div className="lg-surface-strong dialog" onClick={(e: React.MouseEvent) => e.stopPropagation()}
            style={{ padding: '24px', borderRadius: '16px', maxWidth: '400px', margin: 'auto', position: 'relative' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: '1.125rem' }}>重命名</h3>
            <input
              className="lg-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRename()}
              autoFocus
              style={{ width: '100%', marginBottom: '16px', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <LiquidButton size="sm" variant="ghost" onClick={() => setOpen(false)}>取消</LiquidButton>
              <LiquidButton size="sm" variant="primary" onClick={handleRename} disabled={loading || !name.trim()}>
                {loading ? '保存中...' : '保存'}
              </LiquidButton>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/* ---------- Delete Confirm Dialog ---------- */

function DeleteDialog({ item, onDeleted, onClose }: { item: DriveItem; onDeleted: () => void; onClose: () => void }) {
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    setLoading(true)
    try {
      await api.delete(`/drive/files/${item.id}`)
      onDeleted()
    } catch (err: any) {
      alert(err.message || '删除失败')
      setLoading(false)
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="lg-surface-strong dialog" onClick={(e: React.MouseEvent) => e.stopPropagation()}
        style={{ padding: '24px', borderRadius: '16px', maxWidth: '400px', margin: 'auto', position: 'relative' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: '1.125rem' }}>确认删除</h3>
        <p style={{ margin: '0 0 16px', color: 'var(--lg-text-secondary)', fontSize: '0.9rem' }}>
          确定要删除 {item.isFolder ? '文件夹' : '文件'} <strong>{item.name}</strong> 吗？
          {item.isFolder && <><br/>文件夹内的所有内容将一并删除。</>}
        </p>
        <p style={{ margin: '0 0 16px', color: 'var(--lg-text-tertiary, #999)', fontSize: '0.8rem' }}>
          此操作不可撤销。
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
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
    const fetchImage = async () => {
      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch(`/api/drive/download/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('加载失败')
        const blob = await res.blob()
        setSrc(URL.createObjectURL(blob))
      } catch (err: any) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchImage()
    return () => { if (src) URL.revokeObjectURL(src) }
  }, [item.id])

  return (
    <div className="dialog-overlay" onClick={onClose}
      style={{ background: 'rgba(0,0,0,0.85)', cursor: 'zoom-out' }}>
      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: '90vw', maxHeight: '90vh',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        {loading && <div className="spinner" />}
        {error && <p style={{ color: '#fff' }}>{error}</p>}
        {src && <img src={src} alt={item.name}
          style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: '12px', objectFit: 'contain' }} />}
        <button onClick={onClose} style={{
          position: 'absolute', top: '-40px', right: '0',
          background: 'none', border: 'none', color: '#fff',
          fontSize: '1.5rem', cursor: 'pointer',
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
    const loadVideo = async () => {
      try {
        const token = localStorage.getItem('lineweb_token')
        const res = await fetch(`/api/drive/download/${item.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) throw new Error('加载失败')
        const blob = await res.blob()
        setSrc(URL.createObjectURL(blob))
      } catch (err: any) {
        setError(err.message)
      }
    }
    loadVideo()
    return () => { if (src) URL.revokeObjectURL(src) }
  }, [item.id])

  return (
    <div className="dialog-overlay" onClick={onClose} style={{ background: 'rgba(0,0,0,0.85)' }}>
      <div onClick={e => e.stopPropagation()} style={{
        maxWidth: '80vw', maxHeight: '80vh',
        position: 'relative',
      }}>
        {error ? (
          <p style={{ color: '#fff' }}>{error}</p>
        ) : src ? (
          <video controls autoPlay style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: '12px' }}
            src={src} />
        ) : (
          <div className="spinner" />
        )}
        <button onClick={onClose} style={{
          position: 'absolute', top: '-40px', right: '0',
          background: 'none', border: 'none', color: '#fff',
          fontSize: '1.5rem', cursor: 'pointer',
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

  // 预览/删除状态
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<DriveItem | null>(null)

  // 搜索防抖
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetchItems = useCallback(async (parentId: number | null) => {
    setLoading(true)
    setError('')
    try {
      const params = parentId !== null ? `?parentId=${parentId}` : ''
      const data = await api.get<DriveItem[]>(`/drive/files${params}`)
      setItems(data)
    } catch (err: any) {
      setError(err.message || '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems(currentParentId)
  }, [currentParentId, fetchItems])

  // 搜索
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
    const newBreadcrumbs = [...breadcrumbs, { id: item.id, name: item.name }]
    setBreadcrumbs(newBreadcrumbs)
    setSearchQuery('')
    setSearchResults(null)
  }

  const navigateToBreadcrumb = (index: number) => {
    setBreadcrumbs(breadcrumbs.slice(0, index + 1))
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
      if (!res.ok) throw new Error('下载失败')
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
    <div className="page container">
      <LiquidGlass variant="blur" className="page-card" style={{ padding: '24px' }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexWrap: 'wrap', gap: '12px', marginBottom: '16px',
        }}>
          <h1 style={{ margin: 0, fontSize: '1.5rem' }}>☁️ 网盘</h1>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <NewFolderDialog parentId={currentParentId} onCreated={() => fetchItems(currentParentId)} />
            <UploadZone parentId={currentParentId} onUploaded={() => fetchItems(currentParentId)} />
          </div>
        </div>

        {/* Search */}
        <div style={{ marginBottom: '16px' }}>
          <input
            className="lg-input"
            type="text"
            placeholder="🔍 搜索文件..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ width: '100%', maxWidth: '400px', boxSizing: 'border-box' }}
          />
          <span style={{ marginLeft: '8px', fontSize: '0.8rem', color: 'var(--lg-text-tertiary)' }}>
            {searching ? '搜索中...' : searchResults !== null ? `找到 ${searchResults.length} 项` : ''}
          </span>
        </div>

        {/* Breadcrumbs */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          marginBottom: '12px', fontSize: '0.875rem',
          color: 'var(--lg-text-secondary)',
          flexWrap: 'wrap',
        }}>
          {breadcrumbs.map((crumb, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {i > 0 && <span style={{ opacity: 0.5 }}>›</span>}
              {i === breadcrumbs.length - 1 ? (
                <span style={{ color: 'var(--lg-text)', fontWeight: 500 }}>{crumb.name}</span>
              ) : (
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--lg-text-secondary)',
                    padding: 0, fontSize: 'inherit',
                    textDecoration: 'none',
                  }}
                  className="drive-link-hover"
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>

        {/* File list */}
        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center' }}>
            <div className="spinner" />
          </div>
        ) : error ? (
          <LiquidGlass variant="blur" style={{ padding: '20px', textAlign: 'center' }}>
            <p style={{ color: 'var(--lg-text-tertiary)' }}>⚠️ {error}</p>
            <LiquidButton size="sm" variant="glass" onClick={() => fetchItems(currentParentId)}>
              重试
            </LiquidButton>
          </LiquidGlass>
        ) : displayItems.length === 0 ? (
          <LiquidGlass variant="blur" style={{ padding: '40px', textAlign: 'center' }}>
            <p style={{ color: 'var(--lg-text-tertiary)' }}>
              {isSearching ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
            </p>
          </LiquidGlass>
        ) : (
          <div style={{ overflowX: 'auto', margin: '0 -24px', padding: '0 24px' }}>
            <table className="drive-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{
                  borderBottom: '1px solid var(--lg-border)',
                  fontSize: '0.8rem',
                  color: 'var(--lg-text-tertiary)',
                }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500, width: '40%' }}>名称</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 500, width: '100px' }}>大小</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500, width: '80px' }}>类型</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', fontWeight: 500, width: '120px' }}>修改时间</th>
                  <th style={{ textAlign: 'right', padding: '8px 12px', fontWeight: 500, width: '110px' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {displayItems.map((item, i) => (
                  <tr key={item.id} className="drive-row"
                    style={{
                      borderBottom: '1px solid var(--lg-border-alpha, rgba(255,255,255,0.05))',
                      transition: 'background 0.15s',
                    }}>
                    <td className="drive-cell" style={{ padding: '10px 12px' }}>
                      {item.isFolder ? (
                        <span onClick={() => navigateToFolder(item)}
                          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          📁 {item.name}
                        </span>
                      ) : (
                        <RenameDialog item={item} onRenamed={() => fetchItems(currentParentId)} />
                      )}
                    </td>
                    <td className="drive-cell" style={{
                      padding: '10px 12px', textAlign: 'right',
                      color: 'var(--lg-text-secondary)', fontSize: '0.85rem',
                      whiteSpace: 'nowrap',
                    }}>
                      {formatFileSize(Number(item.size))}
                    </td>
                    <td className="drive-cell" style={{
                      padding: '10px 12px',
                      color: 'var(--lg-text-secondary)', fontSize: '0.85rem',
                    }}>
                      {item.isFolder ? '文件夹' : (item.mimeType?.split('/')[1]?.toUpperCase() || '文件')}
                    </td>
                    <td className="drive-cell" style={{
                      padding: '10px 12px',
                      color: 'var(--lg-text-secondary)', fontSize: '0.85rem',
                      whiteSpace: 'nowrap',
                    }}>
                      {formatDate(item.updatedAt)}
                    </td>
                    <td className="drive-cell" style={{ padding: '10px 12px', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        {!item.isFolder && (
                          <>
                            <LiquidButton size="sm" variant="ghost"
                              onClick={() => handlePreview(item)}>
                              预览
                            </LiquidButton>
                            <LiquidButton size="sm" variant="ghost"
                              onClick={() => handleDownload(item)}>
                              下载
                            </LiquidButton>
                          </>
                        )}
                        <LiquidButton size="sm" variant="danger"
                          onClick={() => setDeleteItem(item)}>
                          删除
                        </LiquidButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{
              padding: '8px 12px', fontSize: '0.8rem',
              color: 'var(--lg-text-tertiary)',
            }}>
              共 {displayItems.length} 项
            </div>
          </div>
        )}
      </LiquidGlass>

      {/* Modal overlays */}
      {renderPreview()}
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
