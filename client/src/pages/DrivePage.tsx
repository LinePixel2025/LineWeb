import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import DriveToolbar from '../components/drive/DriveToolbar'
import DriveNavigation from '../components/drive/DriveNavigation'
import DriveDetailPanel from '../components/drive/DriveDetailPanel'
import DriveListView from '../components/drive/DriveListView'
import DriveGridView from '../components/drive/DriveGridView'
import MobileDriveShell from '../components/drive/MobileDriveShell'
import UploadZone from '../components/drive/UploadZone'
import DrivePreview from '../components/drive/DrivePreview'
import BatchActions from '../components/drive/BatchActions'
import FolderPickerDialog from '../components/drive/FolderPickerDialog'
import { NewFolderDialog, RenameDialog, DeleteDialog } from '../components/drive/DriveDialogs'
import Pagination from '../components/Pagination'
import api from '../lib/api'
import { useDownload } from '../contexts/DownloadContext'
import { DriveProvider, useDrive } from '../contexts/DriveContext'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useDriveFiles } from '../hooks/useDriveFiles'
import { useDriveSearch } from '../hooks/useDriveSearch'
import { useDriveSync } from '../hooks/useDriveSync'
import { useDriveDialogs } from '../hooks/useDriveDialogs'
import { useResponsive } from '../hooks/useResponsive'
import type { DriveItem, SortField } from '../types/drive'
import { getFileCategory } from '../types/drive'
import { CloseIcon, FolderIcon, RefreshIcon, UploadIcon, NewFolderIcon } from '../components/drive/DriveIcons'

function DrivePageInner() {
  const {
    state: ctx,
    setSort,
    setViewMode,
    setCategoryFilter,
    selectAll,
    selectFile,
    clearSelection,
    addFavorite,
    navigateToFolder: navigateToFolderInContext,
    navigateToBreadcrumb: navigateToBreadcrumbInContext,
  } = useDrive()
  const { startDownload } = useDownload()
  const { isMobile } = useResponsive()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [pendingMoveIds, setPendingMoveIds] = useState<number[]>([])
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const breadcrumbs = ctx.currentPath
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
    if (item.isFolder) navigateToFolderInContext(item.id, item.name)
  }, [navigateToFolderInContext])

  const navigateToBreadcrumb = useCallback((index: number) => {
    navigateToBreadcrumbInContext(index)
  }, [navigateToBreadcrumbInContext])

  const refresh = useCallback(() => invalidate(), [invalidate])

  const handlePreview = useCallback((item: DriveItem) => {
    if (item.isFolder) return
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    const previewableExts = [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp',
      'mp4', 'webm', 'avi', 'mov', 'mkv',
      'mp3', 'wav', 'ogg', 'flac', 'aac',
      'pdf', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'go', 'rs', 'c', 'cpp',
      'html', 'css', 'json', 'xml', 'yaml', 'yml', 'toml', 'md', 'sql', 'sh',
    ]
    if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime.includes('pdf') || previewableExts.includes(ext)) {
      dialogs.openPreview(item)
    } else {
      startDownload(item)
    }
  }, [startDownload, dialogs])

  const displayItems = useMemo(() => {
    let source = search.isSearchActive ? (search.results ?? []) : items
    if (ctx.categoryFilter !== 'all') {
      source = source.filter(item => item.isFolder || getFileCategory(item) === ctx.categoryFilter)
    }

    return [...source].sort((a, b) => {
      if (a.isFolder && !b.isFolder) return -1
      if (!a.isFolder && b.isFolder) return 1
      const multiplier = ctx.sort.direction === 'asc' ? 1 : -1
      switch (ctx.sort.field) {
        case 'name': return multiplier * a.name.localeCompare(b.name, 'zh-CN')
        case 'size': return multiplier * (Number(a.size) - Number(b.size))
        case 'updatedAt': return multiplier * (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
        case 'createdAt': return multiplier * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        case 'type': {
          const extA = a.name.split('.').pop()?.toLowerCase() || ''
          const extB = b.name.split('.').pop()?.toLowerCase() || ''
          return multiplier * extA.localeCompare(extB)
        }
        default: return 0
      }
    })
  }, [items, search.results, search.isSearchActive, ctx.categoryFilter, ctx.sort])

  const handleSelectAll = useCallback(() => {
    const everyItemSelected = displayItems.length > 0 && displayItems.every(item => ctx.selectedFiles.includes(item.id))
    if (everyItemSelected) clearSelection()
    else selectAll(displayItems.map(item => item.id))
  }, [displayItems, ctx.selectedFiles, clearSelection, selectAll])

  useKeyboardShortcuts({
    selectedFileIds: ctx.selectedFiles,
    currentPathLength: breadcrumbs.length,
    onDelete: () => {
      const item = displayItems.find(candidate => candidate.id === ctx.selectedFiles[0])
      if (item) dialogs.openDelete(item)
    },
    onRename: () => {
      const item = displayItems.find(candidate => candidate.id === ctx.selectedFiles[0])
      if (item) dialogs.openRename(item)
    },
    onNewFolder: dialogs.openNewFolder,
    onUpload: dialogs.openUpload,
    onRefresh: refresh,
    onClearSelection: clearSelection,
    onNavigateBack: () => navigateToBreadcrumb(Math.max(0, breadcrumbs.length - 2)),
    onSelectAll: handleSelectAll,
  })

  const selectedItem = useMemo(() => {
    if (ctx.selectedFiles.length === 0) return null
    return displayItems.find(item => item.id === ctx.selectedFiles[0]) || null
  }, [ctx.selectedFiles, displayItems])

  const handleSelect = useCallback((item: DriveItem | null, multiSelect = false) => {
    if (!item) {
      clearSelection()
      return
    }
    selectFile(item.id, multiSelect)
  }, [clearSelection, selectFile])

  const handleUploaded = useCallback(() => {
    refresh()
    dialogs.closeUpload()
  }, [refresh, dialogs])

  const handleBatchMove = useCallback(() => {
    if (ctx.selectedFiles.length === 0) return
    setPendingMoveIds(ctx.selectedFiles)
    setShowFolderPicker(true)
  }, [ctx.selectedFiles])

  const handleFolderPick = useCallback(async (targetFolderId: number | null) => {
    await Promise.allSettled(
      pendingMoveIds.map(fileId => api.put(`/drive/files/${fileId}`, { parentId: targetFolderId }))
    )
    clearSelection()
    setPendingMoveIds([])
    invalidate()
    setShowFolderPicker(false)
  }, [pendingMoveIds, clearSelection, invalidate])

  const handleBatchDownload = useCallback(() => {
    displayItems
      .filter(item => ctx.selectedFiles.includes(item.id) && !item.isFolder)
      .forEach(item => startDownload(item))
  }, [ctx.selectedFiles, displayItems, startDownload])

  const handleBatchDelete = useCallback(() => {
    const item = displayItems.find(candidate => ctx.selectedFiles.includes(candidate.id))
    if (item) dialogs.openDelete(item)
  }, [ctx.selectedFiles, displayItems, dialogs])

  const handleBatchFavorite = useCallback(() => {
    displayItems
      .filter(item => ctx.selectedFiles.includes(item.id) && item.isFolder)
      .forEach(item => addFavorite(item.id, item.name))
    clearSelection()
  }, [addFavorite, clearSelection, ctx.selectedFiles, displayItems])


  return (
    <div className={`gh-drive-page${isMobile ? ' gh-drive-page--mobile' : ''}`}>
      <div className="gh-drive-desktop-shell">
      <header className="gh-drive-repo-header">
        <div className="gh-drive-repo-heading">
          <span className="gh-drive-repo-mark"><FolderIcon size={24} /></span>
          <div>
            <div className="gh-drive-repo-path">LineWeb <span>/</span> Drive</div>
            <h1>网盘</h1>
            <p>你的文件工作区</p>
          </div>
        </div>
        <div className="gh-drive-repo-actions">
          <span className="gh-drive-repo-status"><span /> 私有工作区</span>
          <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={dialogs.openNewFolder}>
            <NewFolderIcon size={14} /> 新建文件夹
          </button>
          <button className="gh-btn gh-btn--sm gh-btn--primary" onClick={dialogs.openUpload}>
            <UploadIcon size={14} /> 上传
          </button>
          <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={syncOpts.sync} disabled={syncOpts.syncing}>
            <RefreshIcon size={14} /> {syncOpts.syncing ? '同步中…' : '同步'}
          </button>
        </div>
      </header>

      <div className="gh-drive-subnav" role="tablist" aria-label="网盘视图">
        <button className="gh-drive-subnav-item gh-drive-subnav-item--active" role="tab" aria-selected="true">
          <FolderIcon size={15} /> 文件
        </button>
        <span className="gh-drive-subnav-note">{breadcrumbs.length > 1 ? `位于 ${breadcrumbs[breadcrumbs.length - 1].name}` : '根目录'}</span>
      </div>

      <div className={`gh-drive-workspace${selectedItem ? ' gh-drive-workspace--with-detail' : ''}${sidebarCollapsed ? ' gh-drive-workspace--sidebar-collapsed' : ''}`}>
        <DriveNavigation
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(value => !value)}
        />

        <main className="gh-drive-main">
          <div className="gh-drive-files-card">
            <DriveToolbar
              breadcrumbs={breadcrumbs}
              searchQuery={search.query}
              searching={search.searching}
              searchResultCount={search.results?.length ?? null}
              onSearch={search.setQuery}
              onClearSearch={search.clearSearch}
              searchInputRef={searchInputRef}
              onNavigate={navigateToBreadcrumb}
              onNewFolder={dialogs.openNewFolder}
              onUpload={dialogs.openUpload}
              onSync={syncOpts.sync}
              syncing={syncOpts.syncing}
              onParentFolder={() => navigateToBreadcrumb(Math.max(0, breadcrumbs.length - 2))}
              viewMode={ctx.viewMode}
              itemCount={displayItems.length}
              onViewModeChange={setViewMode}
              categoryFilter={ctx.categoryFilter}
              onCategoryFilterChange={setCategoryFilter}
              sortField={ctx.sort.field}
              sortDirection={ctx.sort.direction}
              onSortChange={(field: SortField) => {
                if (ctx.sort.field === field) {
                  setSort({ field, direction: ctx.sort.direction === 'asc' ? 'desc' : 'asc' })
                } else {
                  setSort({ field, direction: 'asc' })
                }
              }}
              onSortDirectionChange={() => setSort({ field: ctx.sort.field, direction: ctx.sort.direction === 'asc' ? 'desc' : 'asc' })}
              showActions={false}
            />


            {syncOpts.message && (
              <div className={`gh-drive-sync-message${syncOpts.message.includes('失败') || syncOpts.message.includes('错误') ? ' gh-drive-sync-message--error' : ''}`}>
                <span>{syncOpts.message}</span>
                <button onClick={syncOpts.clearMessage} aria-label="关闭同步提示" title="关闭提示"><CloseIcon size={14} /></button>
              </div>
            )}

            {ctx.selectedFiles.length > 0 && (
              <BatchActions
                onBatchDownload={handleBatchDownload}
                onBatchMove={handleBatchMove}
                onBatchDelete={handleBatchDelete}
                onBatchFavorite={handleBatchFavorite}
                onClearSelection={clearSelection}
              />
            )}

            {dialogs.showUpload && (
              <UploadZone parentId={currentParentId} onUploaded={handleUploaded} onClose={dialogs.closeUpload} />
            )}

            {loading ? (
              <div className="gh-drive-loading" role="status" aria-live="polite">
                <div className="gh-spinner" />
                <p>正在加载文件…</p>
              </div>
            ) : error ? (
              <div className="gh-drive-state-card gh-drive-state-card--error">
                <p className="gh-drive-state-text">{error}</p>
                <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={() => fetchItems(page, true)}>重试</button>
              </div>
            ) : displayItems.length === 0 ? (
              <div className="gh-drive-state-card">
                <span className="gh-drive-state-icon"><FolderIcon size={34} /></span>
                <p className="gh-drive-state-text">{search.isSearchActive ? '没有匹配的文件' : '这个目录还是空的'}</p>
                <span className="gh-drive-state-hint">上传文件或新建文件夹开始整理</span>
              </div>
            ) : ctx.viewMode === 'list' ? (
              <DriveListView
                items={displayItems}
                selectedId={ctx.selectedFiles[0] ?? null}
                selectedIds={ctx.selectedFiles}
                sortField={ctx.sort.field}
                sortDirection={ctx.sort.direction}
                onSortChange={(field: SortField) => {
                  setSort({ field, direction: ctx.sort.field === field && ctx.sort.direction === 'asc' ? 'desc' : 'asc' })
                }}
                onFolderClick={navigateToFolder}
                onPreview={handlePreview}
                onDownload={startDownload}
                onRename={dialogs.openRename}
                onDelete={dialogs.openDelete}
                onSelect={handleSelect}
                onNewFolder={dialogs.openNewFolder}
                onUpload={dialogs.openUpload}
                onRefresh={refresh}
                onSelectAll={handleSelectAll}
              />
            ) : (
              <DriveGridView
                items={displayItems}
                selectedId={ctx.selectedFiles[0] ?? null}
                selectedIds={ctx.selectedFiles}
                onFolderClick={navigateToFolder}
                onPreview={handlePreview}
                onDownload={startDownload}
                onRename={dialogs.openRename}
                onDelete={dialogs.openDelete}
                onSelect={handleSelect}
                onNewFolder={dialogs.openNewFolder}
                onUpload={dialogs.openUpload}
                onRefresh={refresh}
                onSelectAll={handleSelectAll}
              />
            )}

            {!search.isSearchActive && totalPages > 1 && (
              <div className="gh-drive-pagination-wrap">
                <Pagination page={page} totalPages={totalPages} onPageChange={targetPage => fetchItems(targetPage)} />
                <div className="gh-drive-pagination-info">第 {page}/{totalPages} 页，共 {total} 项</div>
              </div>
            )}
          </div>
        </main>

        {selectedItem && (
          <DriveDetailPanel
            item={selectedItem}
            onClose={clearSelection}
            onDownload={startDownload}
            onRename={dialogs.openRename}
            onDelete={dialogs.openDelete}
            onPreview={handlePreview}
          />
        )}
      </div>

      </div>

      <MobileDriveShell
        breadcrumbs={breadcrumbs}
        items={displayItems}
        loading={loading}
        error={error}
        total={total}
        page={page}
        totalPages={totalPages}
        searchQuery={search.query}
        searching={search.searching}
        searchResultCount={search.results?.length ?? null}
        onSearch={search.setQuery}
        onClearSearch={search.clearSearch}
        onNavigate={navigateToBreadcrumb}
        onParentFolder={() => navigateToBreadcrumb(Math.max(0, breadcrumbs.length - 2))}
        onNewFolder={dialogs.openNewFolder}
        onUpload={dialogs.openUpload}
        onSync={syncOpts.sync}
        syncing={syncOpts.syncing}
        onRefresh={refresh}
        onPageChange={targetPage => fetchItems(targetPage)}
        viewMode={ctx.viewMode}
        onViewModeChange={setViewMode}
        categoryFilter={ctx.categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
        sortField={ctx.sort.field}
        sortDirection={ctx.sort.direction}
        onSortChange={(field: SortField) => {
          if (ctx.sort.field === field) {
            setSort({ field, direction: ctx.sort.direction === 'asc' ? 'desc' : 'asc' })
          } else {
            setSort({ field, direction: 'asc' })
          }
        }}
        onSortDirectionChange={() => setSort({ field: ctx.sort.field, direction: ctx.sort.direction === 'asc' ? 'desc' : 'asc' })}
        favorites={ctx.favorites}
        selectedIds={ctx.selectedFiles}
        onFolderClick={navigateToFolder}
        onPreview={handlePreview}
        onDownload={startDownload}
        onRename={dialogs.openRename}
        onDelete={dialogs.openDelete}
        onSelect={handleSelect}
        onClearSelection={clearSelection}
        onSelectAll={handleSelectAll}
        onBatchDownload={handleBatchDownload}
        onBatchMove={handleBatchMove}
        onBatchDelete={handleBatchDelete}
        onBatchFavorite={handleBatchFavorite}
      />

      {dialogs.previewItem && <DrivePreview item={dialogs.previewItem} onClose={dialogs.closePreview} />}
      {dialogs.showNewFolder && (
        <NewFolderDialog parentId={currentParentId} onCreated={() => { refresh(); dialogs.closeNewFolder() }} onClose={dialogs.closeNewFolder} />
      )}
      {dialogs.renameItem && (
        <RenameDialog item={dialogs.renameItem} onRenamed={() => { dialogs.closeRename(); refresh() }} onClose={dialogs.closeRename} />
      )}
      {dialogs.deleteItem && (
        <DeleteDialog item={dialogs.deleteItem} onDeleted={() => { dialogs.closeDelete(); refresh(); clearSelection() }} onClose={dialogs.closeDelete} />
      )}
      {showFolderPicker && (
        <FolderPickerDialog
          title={`移动 ${pendingMoveIds.length} 个项目到…`}
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
