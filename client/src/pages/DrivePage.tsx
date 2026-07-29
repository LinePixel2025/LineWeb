import { useState, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import DriveToolbar from '../components/drive/DriveToolbar'
import DriveNavigation from '../components/drive/DriveNavigation'
import MobileNav from '../components/drive/MobileNav'
import DriveDetailPanel from '../components/drive/DriveDetailPanel'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import BatchActions from '../components/drive/BatchActions'
import FolderPickerDialog from '../components/drive/FolderPickerDialog'
import { NewFolderDialog, RenameDialog, DeleteDialog } from '../components/drive/DriveDialogs'
import Pagination from '../components/Pagination'
import api from '../lib/api'
import { useDownload } from '../contexts/DownloadContext'
import { DriveProvider, useDrive } from '../contexts/DriveContext'
import { useResponsive } from '../hooks/useResponsive'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useDriveFiles } from '../hooks/useDriveFiles'
import { useDriveSearch } from '../hooks/useDriveSearch'
import { useDriveSync } from '../hooks/useDriveSync'
import { useDriveDialogs } from '../hooks/useDriveDialogs'
import type { DriveItem, Breadcrumb, SortField } from '../types/drive'
import { getFileCategory } from '../types/drive'
import { FolderIcon } from '../components/drive/DriveIcons'

function DrivePageInner() {
  const { state: ctx, setSort, selectAll, clearSelection } = useDrive()
  const { startDownload } = useDownload()
  const { isDesktop, isMobile } = useResponsive()
  const [breadcrumbs, setBreadcrumbs] = useState<Breadcrumb[]>([{ id: null, name: '根目录' }])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileTab, setMobileTab] = useState<'files' | 'favorites' | 'search' | 'settings'>('files')
  const [batchSelected, setBatchSelected] = useState<number[]>([])
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [pendingMoveIds, setPendingMoveIds] = useState<number[]>([])

  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null

  const { items, loading, error, total, page, totalPages, fetchItems, invalidate } =
    useDriveFiles(currentParentId, ctx.sort, ctx.categoryFilter)

  const search = useDriveSearch()

  const syncOpts = useDriveSync()

  const dialogs = useDriveDialogs()

  useEffect(() => {
    fetchItems(1)
  }, [currentParentId, fetchItems])

  const navigateToFolder = useCallback((item: DriveItem) => {
    if (!item.isFolder) return
    setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])
  }, [])

  const navigateToBreadcrumb = useCallback((index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1))
  }, [])

  const refresh = useCallback(() => { invalidate() }, [invalidate])

  const handlePreview = useCallback((item: DriveItem) => {
    if (item.isFolder) return
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    const previewableExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
      'mp4', 'webm', 'avi', 'mov', 'mkv',
      'mp3', 'wav', 'ogg', 'flac', 'aac',
      'pdf',
      'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp',
      'html', 'css', 'json', 'xml', 'yaml', 'yml', 'toml', 'md', 'sql', 'sh']
    if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') ||
        mime.includes('pdf') || previewableExts.includes(ext)) {
      dialogs.openPreview(item)
    } else {
      startDownload(item)
    }
  }, [startDownload, dialogs])

  const displayItems = useMemo(() => {
    let src = search.isSearchActive ? (search.results ?? []) : items

    if (ctx.categoryFilter !== 'all') {
      src = src.filter(item => {
        if (search.isSearchActive && item.isFolder) return getFileCategory(item) === ctx.categoryFilter
        if (item.isFolder) return true
        return getFileCategory(item) === ctx.categoryFilter
      })
    }

    return [...src].sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      const { field, direction } = ctx.sort
      const mul = direction === 'asc' ? 1 : -1
      switch (field) {
        case 'name': return mul * a.name.localeCompare(b.name, 'zh-CN')
        case 'size': return mul * (Number(a.size) - Number(b.size))
        case 'updatedAt': return mul * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
        case 'createdAt': return mul * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        case 'type': {
          const ea = a.name.split('.').pop()?.toLowerCase() || ''
          const eb = b.name.split('.').pop()?.toLowerCase() || ''
          return mul * ea.localeCompare(eb)
        }
        default: return 0
      }
    })
  }, [items, search.results, search.isSearchActive, ctx.categoryFilter, ctx.sort])

  useKeyboardShortcuts({
    selectedFileIds: batchSelected,
    currentPathLength: breadcrumbs.length,
    onDelete: () => {
      if (batchSelected.length > 0) {
        const item = displayItems.find(i => i.id === batchSelected[0])
        if (item) dialogs.openDelete(item)
      }
    },
    onRename: () => {
      if (batchSelected.length > 0) {
        const item = displayItems.find(i => i.id === batchSelected[0])
        if (item) dialogs.openRename(item)
      }
    },
    onNewFolder: dialogs.openNewFolder,
    onUpload: dialogs.openUpload,
    onRefresh: refresh,
    onClearSelection: () => { clearSelection(); setBatchSelected([]) },
    onNavigateBack: () => navigateToBreadcrumb(breadcrumbs.length - 2),
    onSelectAll: () => {
      setBatchSelected(displayItems.map(i => i.id))
      selectAll(displayItems.map(i => i.id))
    },
  })

  const selectedItem = useMemo(() => {
    if (batchSelected.length === 0) return null
    return displayItems.find(item => item.id === batchSelected[0]) || null
  }, [batchSelected, displayItems])

  const handleSelect = useCallback((item: DriveItem | null) => {
    if (!item) {
      clearSelection()
      setBatchSelected([])
      return
    }
    setBatchSelected([item.id])
  }, [clearSelection])

  const handleUploaded = useCallback(() => {
    refresh()
    dialogs.closeUpload()
  }, [refresh, dialogs])

  const handleBatchMove = useCallback(() => {
    if (batchSelected.length === 0) return
    setPendingMoveIds(batchSelected)
    setShowFolderPicker(true)
  }, [batchSelected])

  const handleFolderPick = useCallback(async (targetFolderId: number | null) => {
    try {
      await Promise.allSettled(
        pendingMoveIds.map(fileId => api.put(`/drive/files/${fileId}`, { parentId: targetFolderId }))
      )
      clearSelection()
      setBatchSelected([])
      invalidate()
    } catch { /* ignore */ }
    setShowFolderPicker(false)
  }, [pendingMoveIds, clearSelection, invalidate])

  return (
    <div className="gh-drive-layout">
      {isDesktop && (
        <DriveNavigation
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      )}

      <div className="gh-drive-main">
        <div className="gh-drive-content-card">
          <DriveToolbar
            breadcrumbs={breadcrumbs}
            searchQuery={search.query}
            searching={search.searching}
            searchResultCount={search.results?.length ?? null}
            onSearch={search.setQuery}
            onNavigate={navigateToBreadcrumb}
            onNewFolder={dialogs.openNewFolder}
            onUpload={dialogs.openUpload}
            onSync={syncOpts.sync}
            syncing={syncOpts.syncing}
            onParentFolder={() => navigateToBreadcrumb(breadcrumbs.length - 2)}
          />

          {syncOpts.message && (
            <div className="gh-drive-sync-message" style={{
              color: syncOpts.message.includes('失败') || syncOpts.message.includes('错误')
                ? 'var(--gh-danger)' : 'var(--gh-text-secondary)',
            }}>
              {syncOpts.message}
              <button onClick={syncOpts.clearMessage} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--gh-text-tertiary)' }}>✕</button>
            </div>
          )}

          {batchSelected.length > 0 && (
            <BatchActions
              onBatchDownload={() => {
                displayItems.filter(i => batchSelected.includes(i.id) && !i.isFolder)
                  .forEach(i => startDownload(i))
              }}
              onBatchMove={handleBatchMove}
              onBatchDelete={() => {
                const item = displayItems.find(i => batchSelected.includes(i.id))
                if (item) dialogs.openDelete(item)
              }}
              onBatchFavorite={() => {
                displayItems.filter(i => batchSelected.includes(i.id) && i.isFolder)
                  .forEach(item => {
                    try {
                      const raw = localStorage.getItem('lineweb_favorites')
                      const favorites = raw ? JSON.parse(raw) : []
                      if (!favorites.some((f: { folderId: number }) => f.folderId === item.id)) {
                        favorites.push({ id: `fav-${item.id}`, folderId: item.id, folderName: item.name, order: Date.now() })
                        localStorage.setItem('lineweb_favorites', JSON.stringify(favorites))
                      }
                    } catch { /* ignore */ }
                  })
                clearSelection()
                setBatchSelected([])
              }}
              onClearSelection={() => { clearSelection(); setBatchSelected([]) }}
            />
          )}

          {dialogs.showUpload && (
            <UploadZone parentId={currentParentId} onUploaded={handleUploaded} onClose={dialogs.closeUpload} />
          )}

          {loading ? (
            <div className="gh-drive-loading">
              <div className="gh-spinner" />
              <p style={{ marginTop: '12px', color: 'var(--gh-text-tertiary)', fontSize: '0.85rem' }}>
                正在加载...
              </p>
            </div>
          ) : error ? (
            <div className="gh-drive-state-card">
              <p className="gh-drive-state-text">⚠️ {error}</p>
              <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={() => fetchItems(page, true)}>重试</button>
            </div>
          ) : displayItems.length === 0 ? (
            <div className="gh-drive-state-card">
              <span className="gh-drive-state-icon"><FolderIcon size={40} /></span>
              <p className="gh-drive-state-text">
                {search.isSearchActive ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
              </p>
            </div>
          ) : ctx.viewMode === 'list' ? (
            <DriveListView
              items={displayItems}
              selectedId={batchSelected[0] ?? null}
              sortField={ctx.sort.field}
              sortDirection={ctx.sort.direction}
              onSortChange={(field: SortField) => {
                const direction = ctx.sort.field === field && ctx.sort.direction === 'asc' ? 'desc' : 'asc'
                setSort({ field, direction })
              }}
              onFolderClick={navigateToFolder}
              onPreview={handlePreview}
              onDownload={startDownload}
              onRename={(item) => dialogs.openRename(item)}
              onDelete={(item) => dialogs.openDelete(item)}
              onSelect={(item) => handleSelect(item)}
              onNewFolder={dialogs.openNewFolder}
              onUpload={dialogs.openUpload}
              onRefresh={refresh}
            />
          ) : (
            <DriveGridView
              items={displayItems}
              selectedId={batchSelected[0] ?? null}
              onFolderClick={navigateToFolder}
              onPreview={handlePreview}
              onDownload={startDownload}
              onRename={(item) => dialogs.openRename(item)}
              onDelete={(item) => dialogs.openDelete(item)}
              onSelect={(item) => handleSelect(item)}
              onNewFolder={dialogs.openNewFolder}
              onUpload={dialogs.openUpload}
              onRefresh={refresh}
            />
          )}

          {!search.isSearchActive && totalPages > 1 && (
            <>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(p) => fetchItems(p)}
              />
              <div className="gh-drive-pagination-info">
                第 {page}/{totalPages} 页，共 {total} 项
              </div>
            </>
          )}
        </div>
      </div>

      {isDesktop && (
        <DriveDetailPanel
          item={selectedItem}
          onClose={() => handleSelect(null)}
          onDownload={startDownload}
          onRename={(item) => dialogs.openRename(item)}
          onDelete={(item) => dialogs.openDelete(item)}
          onPreview={handlePreview}
        />
      )}

      {isMobile && <MobileNav activeTab={mobileTab} onTabChange={setMobileTab} />}

      {dialogs.previewItem && (
        <DrivePreview item={dialogs.previewItem} onClose={dialogs.closePreview} />
      )}
      {dialogs.showNewFolder && (
        <NewFolderDialog
          parentId={currentParentId}
          onCreated={() => { refresh(); dialogs.closeNewFolder() }}
          onClose={dialogs.closeNewFolder}
        />
      )}
      {dialogs.renameItem && (
        <RenameDialog
          item={dialogs.renameItem}
          onRenamed={() => { dialogs.closeRename(); refresh() }}
          onClose={dialogs.closeRename}
        />
      )}
      {dialogs.deleteItem && (
        <DeleteDialog
          item={dialogs.deleteItem}
          onDeleted={() => { dialogs.closeDelete(); refresh() }}
          onClose={dialogs.closeDelete}
        />
      )}

      {showFolderPicker && (
        <FolderPickerDialog
          title={`移动 ${pendingMoveIds.length} 个文件到...`}
          onSelect={handleFolderPick}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  )
}

export default function DrivePage() {
  return (
    <DriveProvider>
      <DrivePageInner />
    </DriveProvider>
  )
}
