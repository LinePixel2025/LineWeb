import { useState, useEffect, useCallback, useRef } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import DriveToolbar from '../components/drive/DriveToolbar'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import { NewFolderDialog, RenameDialog, DeleteDialog } from '../components/drive/DriveDialogs'
import Pagination from '../components/Pagination'
import api, { ApiError } from '../lib/api'
import { useDownload } from '../contexts/DownloadContext'
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

  // 下载 — 通过持久化 Context
  const { startDownload } = useDownload()

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
      // 基于 id 去重（防御性 — 确保不会因后端数据问题导致重复渲染）
      const seen = new Set<number>()
      const deduped = res.data.filter(item => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })
      setItems(deduped)
      setTotal(res.total)
      setPage(res.page)
      setTotalPages(res.pageCount)
    } catch (err: unknown) {
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

  const handlePreview = useCallback((item: DriveItem) => {
    if (item.isFolder) return
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    if (mime.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext) ||
        mime.startsWith('video/') || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
      setPreviewItem(item)
    } else {
      startDownload(item)
    }
  }, [startDownload])

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
    } catch {
      // ignore sync errors silently
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
            onDownload={startDownload}
            onRename={setRenameItem}
            onDelete={setDeleteItem}
          />
        ) : (
          <DriveGridView
            items={displayItems}
            onFolderClick={navigateToFolder}
            onPreview={handlePreview}
            onDownload={startDownload}
            onRename={setRenameItem}
            onDelete={setDeleteItem}
          />
        )}

        {/* 翻页控件 */}
        {!isSearching && (
          <>
            <Pagination page={page} totalPages={totalPages} onPageChange={(p) => fetchItems(currentParentId, p)} />
            <div style={{ textAlign: 'center', marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
              第 {page}/{totalPages} 页，共 {total} 项
            </div>
          </>
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
