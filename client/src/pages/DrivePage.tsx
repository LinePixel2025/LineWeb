import { useState, useCallback, useMemo, useEffect } from 'react'
import { createPortal } from 'react-dom'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'
import DriveToolbar from '../components/drive/DriveToolbar'
import DriveNavigation from '../components/drive/DriveNavigation'
import MobileNav from '../components/drive/MobileNav'
import DriveDetailPanel from '../components/drive/DriveDetailPanel'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import DownloadManager from '../components/drive/DownloadManager'
import BatchActions from '../components/drive/BatchActions'
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

  const currentParentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null

  // 数据
  const { items, loading, error, total, page, totalPages, fetchItems, invalidate } =
    useDriveFiles(currentParentId, ctx.sort, ctx.categoryFilter)

  // 搜索
  const search = useDriveSearch()

  // 同步
  const syncOpts = useDriveSync()

  // 对话框
  const dialogs = useDriveDialogs()

  // 初始加载 + 路径切换
  useEffect(() => {
    fetchItems(1)
  }, [currentParentId, fetchItems])

  // 导航
  const navigateToFolder = useCallback((item: DriveItem) => {
    if (!item.isFolder) return
    setBreadcrumbs(prev => [...prev, { id: item.id, name: item.name }])
  }, [])

  const navigateToBreadcrumb = useCallback((index: number) => {
    setBreadcrumbs(prev => prev.slice(0, index + 1))
  }, [])

  // 刷新
  const refresh = useCallback(() => { invalidate() }, [invalidate])

  // 预览 / 下载
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

  // 显示数据
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

  // 键盘快捷键
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

  // 选中文件
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

  // 上传完成
  const handleUploaded = useCallback(() => {
    refresh()
    dialogs.closeUpload()
  }, [refresh, dialogs])

  return (
    <div className="page drive-page">
      {isDesktop && (
        <DriveNavigation
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        />
      )}

      <div className="drive-main">
        <LiquidGlass variant="blur" interactive={false} className="page-card drive-content-card">
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
            <div className="drive-sync-message" style={{
              padding: '8px 16px', fontSize: '0.85rem',
              color: syncOpts.message.includes('失败') || syncOpts.message.includes('错误')
                ? 'var(--lg-text-danger)' : 'var(--lg-text-secondary)',
              background: 'var(--lg-surface)', borderRadius: '8px', marginBottom: '8px',
            }}>
              {syncOpts.message}
              <button onClick={syncOpts.clearMessage} style={{ marginLeft: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--lg-text-tertiary)' }}>✕</button>
            </div>
          )}

          {/* Batch Actions */}
          {batchSelected.length > 0 && (
            <BatchActions
              onBatchDownload={() => {
                displayItems.filter(i => batchSelected.includes(i.id) && !i.isFolder)
                  .forEach(i => startDownload(i))
              }}
              onBatchMove={() => alert('移动功能即将上线')}
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

          {/* Upload Zone */}
          {dialogs.showUpload && (
            <UploadZone parentId={currentParentId} onUploaded={handleUploaded} onClose={dialogs.closeUpload} />
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
              <LiquidButton size="sm" variant="glass" onClick={() => fetchItems(page, true)}>重试</LiquidButton>
            </LiquidGlass>
          ) : displayItems.length === 0 ? (
            <LiquidGlass variant="blur" interactive={false} className="drive-state-card">
              <span className="drive-state-icon"><FolderIcon size={40} /></span>
              <p className="drive-state-text">
                {search.isSearchActive ? '未找到匹配的文件' : '网盘为空，点击上方按钮上传文件'}
              </p>
            </LiquidGlass>
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

          {/* 翻页 */}
          {!search.isSearchActive && totalPages > 1 && (
            <>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(p) => fetchItems(p)}
              />
              <div style={{ textAlign: 'center', marginTop: '12px', color: 'var(--lg-text-tertiary)', fontSize: '0.85rem' }}>
                第 {page}/{totalPages} 页，共 {total} 项
              </div>
            </>
          )}
        </LiquidGlass>
      </div>

      {/* Detail Panel */}
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

      {/* Mobile Nav */}
      {isMobile && <MobileNav activeTab={mobileTab} onTabChange={setMobileTab} />}

      {/* Download Manager */}
      <DownloadManager />

      {/* Modals */}
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
