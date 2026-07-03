import { useState, useEffect, useCallback, useRef } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import DriveToolbar from '../components/drive/DriveToolbar'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import { NewFolderDialog, RenameDialog, DeleteDialog } from '../components/drive/DriveDialogs'
import api, { ApiError } from '../lib/api'
import type { DriveItem, Breadcrumb, DriveListResponse } from '../types/drive'

export default function DrivePage() {
  const [items, setItems] = useState<DriveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<DriveItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: null, name: '根目录' }])
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')
  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null

  // Modal states
  const [showUpload, setShowUpload] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [previewItem, setPreviewItem] = useState<DriveItem | null>(null)
  const [deleteItem, setDeleteItem] = useState<DriveItem | null>(null)
  const [renameItem, setRenameItem] = useState<DriveItem | null>(null)
  const [syncing, setSyncing] = useState(false)

  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fetchItems = useCallback(async (parentId: number | null, targetPage?: number) => {
    setLoading(true)
    setError('')
    try {
      const p = targetPage ?? 1
      const params = new URLSearchParams()
      if (parentId !== null) params.set('parentId', String(parentId))
      params.set('page', String(p))
      params.set('limit', '15')
      const res = await api.get<DriveListResponse>(`/drive/files?${params}`)
      setItems(res.data)
      setTotal(res.total)
      setPage(res.page)
      setTotalPages(res.pageCount)
    } catch (err: any) {
      setError(err instanceof ApiError ? err.message : '加载失败')
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchItems(currentParentId, 1)
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

  const navigateToFolder = useCallback((item: DriveItem) => {
    if (!item.isFolder) return
    setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  const navigateToBreadcrumb = useCallback((index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1))
    setSearchQuery('')
    setSearchResults(null)
  }, [])

  const handleDownload = useCallback(async (item: DriveItem) => {
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

      // 流式读取下载，显示速度/进度（console 日志）
      const contentLength = parseInt(res.headers.get('X-Content-Length') || '0', 10)
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      const startTime = Date.now()
      let lastUpdate = startTime
      let lastLoaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        loaded += value.length
        const now = Date.now()

        if (now - lastUpdate > 200 && contentLength > 0) {
          const windowSpeed = (loaded - lastLoaded) / ((now - lastUpdate) / 1000)
          lastUpdate = now
          lastLoaded = loaded
          const pct = Math.round((loaded / contentLength) * 100)
          const remaining = contentLength - loaded
          const eta = windowSpeed > 0 ? Math.ceil(remaining / windowSpeed) : 0
          const speedStr = windowSpeed >= 1024 * 1024
            ? `${(windowSpeed / 1024 / 1024).toFixed(1)} MB/s`
            : `${(windowSpeed / 1024).toFixed(0)} KB/s`
          console.log(`📥 ${item.name}: ${pct}% · ⬇ ${speedStr} · ⏱ ${eta}s`)
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: item.mimeType || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err: any) {
      alert(err.message || '下载失败')
    }
  }, [])

  const handlePreview = useCallback((item: DriveItem) => {
    if (item.isFolder) return
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ||
        mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      setPreviewItem(item)
    } else {
      handleDownload(item)
    }
  }, [handleDownload])

  const displayItems = searchResults !== null ? searchResults : items
  const isSearching = searchResults !== null
  const refresh = useCallback(() => {
    fetchItems(currentParentId, page)
  }, [currentParentId, page])

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await api.post('/drive/sync')
      refresh()
    } catch (err: any) {
      console.error('同步失败:', err)
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  const toggleView = useCallback(() => {
    setViewMode(v => v === 'list' ? 'grid' : 'list')
  }, [])

  const openNewFolder = useCallback(() => setShowNewFolder(true), [])
  const openUpload = useCallback(() => setShowUpload(true), [])

  const handleUploaded = useCallback(() => {
    refresh()
    setShowUpload(false)
  }, [refresh])

  return (
    <div className="page container drive-page">
      <LiquidGlass variant="blur" className="page-card" style={{ padding: '24px' }}>
        <DriveToolbar
          breadcrumbs={breadcrumbs}
          searchQuery={searchQuery}
          searching={searching}
          searchResultCount={searchResults?.length ?? null}
          viewMode={viewMode}
          onSearch={setSearchQuery}
          onNavigate={navigateToBreadcrumb}
          onToggleView={toggleView}
          onNewFolder={openNewFolder}
          onUpload={openUpload}
          onSync={handleSync}
          syncing={syncing}
        />

        {/* Upload Zone */}
        {showUpload && (
          <UploadZone
            parentId={currentParentId}
            onUploaded={handleUploaded}
            onClose={() => setShowUpload(false)}
          />
        )}

        {/* Content */}
        {loading ? (
          <div className="drive-loading">
            <div className="spinner" />
            <p style={{ marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
              正在加载...
            </p>
          </div>
        ) : error ? (
          <LiquidGlass variant="blur" className="drive-state-card">
            <p className="drive-state-text">⚠️ {error}</p>
            <LiquidButton size="sm" variant="glass" onClick={refresh}>重试</LiquidButton>
          </LiquidGlass>
        ) : displayItems.length === 0 ? (
          <LiquidGlass variant="blur" className="drive-state-card">
            <span className="drive-state-icon">☁️</span>
            <p className="drive-state-text">
              {isSearching ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
            </p>
          </LiquidGlass>
        ) : viewMode === 'list' ? (
          <DriveListView
            items={displayItems}
            onFolderClick={navigateToFolder}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onRename={setRenameItem}
            onDelete={setDeleteItem}
          />
        ) : (
          <DriveGridView
            items={displayItems}
            onFolderClick={navigateToFolder}
            onPreview={handlePreview}
            onDownload={handleDownload}
            onRename={setRenameItem}
            onDelete={setDeleteItem}
          />
        )}

        {/* 翻页控件 */}
        {!isSearching && totalPages > 1 && (
          <div className="admin-pagination">
            {(() => {
              const total = totalPages
              const current = page
              const pages: (number | 0)[] = []
              const start = Math.max(1, current - 2)
              const end = Math.min(total, current + 2)

              if (start > 1) {
                pages.push(1)
                if (start > 2) pages.push(0)
              }
              for (let i = start; i <= end; i++) pages.push(i)
              if (end < total) {
                if (end < total - 1) pages.push(0)
                pages.push(total)
              }

              return pages.map((p, i) =>
                p === 0 ? (
                  <span key={`ellipsis-${i}`} className="admin-ellipsis">…</span>
                ) : (
                  <button
                    key={p}
                    className={`admin-page-btn${p === current ? ' admin-page-btn--active' : ''}`}
                    onClick={() => fetchItems(currentParentId, p)}
                  >
                    {p}
                  </button>
                )
              )
            })()}
          </div>
        )}

        {/* 总数显示 */}
        {!isSearching && (
          <div style={{ textAlign: 'center', marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
            第 {page}/{totalPages} 页，共 {total} 项
          </div>
        )}
      </LiquidGlass>

      {/* Modal overlays */}
      {previewItem && (
        <DrivePreview item={previewItem} onClose={() => setPreviewItem(null)} />
      )}
      {showNewFolder && (
        <NewFolderDialog
          parentId={currentParentId}
          onCreated={() => { refresh(); setShowNewFolder(false) }}
          onClose={() => setShowNewFolder(false)}
        />
      )}
      {renameItem && (
        <RenameDialog
          item={renameItem}
          onRenamed={() => { setRenameItem(null); refresh() }}
          onClose={() => setRenameItem(null)}
        />
      )}
      {deleteItem && (
        <DeleteDialog
          item={deleteItem}
          onDeleted={() => { setDeleteItem(null); refresh() }}
          onClose={() => setDeleteItem(null)}
        />
      )}
    </div>
  )
}
