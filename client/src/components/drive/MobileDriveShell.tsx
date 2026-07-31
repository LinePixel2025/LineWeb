import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import type {
  Breadcrumb,
  CategoryFilter,
  DriveItem,
  FavoriteItem,
  SortDirection,
  SortField,
  ViewMode,
} from '../../types/drive'
import { getFileTypeLabel } from '../../types/drive'
import { useDrive } from '../../contexts/DriveContext'
import { formatDate, formatFileSize } from '../../lib/format'
import {
  ChevronDown,
  ChevronRight,
  CloseIcon,
  DeleteIcon,
  DownloadIcon,
  FilterIcon,
  FolderIcon,
  GridViewIcon,
  ListViewIcon,
  MoreIcon,
  NewFolderIcon,
  RefreshIcon,
  RenameIcon,
  SearchIcon,
  StarIcon,
  UploadIcon,
  getDriveIcon,
} from './DriveIcons'

type MobileView = 'files' | 'favorites'

export interface MobileDriveShellProps {
  breadcrumbs: Breadcrumb[]
  items: DriveItem[]
  loading: boolean
  error: string
  total: number
  page: number
  totalPages: number
  searchQuery: string
  searching: boolean
  searchResultCount: number | null
  onSearch: (query: string) => void
  onClearSearch: () => void
  onNavigate: (index: number) => void
  onParentFolder: () => void
  onNewFolder: () => void
  onUpload: () => void
  onSync: () => void
  syncing: boolean
  onRefresh: () => void
  onPageChange: (page: number) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  categoryFilter: CategoryFilter
  onCategoryFilterChange: (filter: CategoryFilter) => void
  sortField: SortField
  sortDirection: SortDirection
  onSortChange: (field: SortField) => void
  onSortDirectionChange: () => void
  favorites: FavoriteItem[]
  selectedIds: number[]
  onFolderClick: (item: DriveItem) => void
  onPreview: (item: DriveItem) => void
  onDownload: (item: DriveItem) => void
  onRename: (item: DriveItem) => void
  onDelete: (item: DriveItem) => void
  onSelect: (item: DriveItem | null, multiSelect?: boolean) => void
  onClearSelection: () => void
  onSelectAll: () => void
  onBatchDownload: () => void
  onBatchMove: () => void
  onBatchDelete: () => void
  onBatchFavorite: () => void
}

const MobileDriveShell = memo(function MobileDriveShell({
  breadcrumbs,
  items,
  loading,
  error,
  total,
  page,
  totalPages,
  searchQuery,
  searching,
  searchResultCount,
  onSearch,
  onClearSearch,
  onNavigate,
  onParentFolder,
  onNewFolder,
  onUpload,
  onSync,
  syncing,
  onRefresh,
  onPageChange,
  viewMode,
  onViewModeChange,
  categoryFilter,
  onCategoryFilterChange,
  sortField,
  sortDirection,
  onSortChange,
  onSortDirectionChange,
  favorites,
  selectedIds,
  onFolderClick,
  onPreview,
  onDownload,
  onRename,
  onDelete,
  onSelect,
  onClearSelection,
  onSelectAll,
  onBatchDownload,
  onBatchMove,
  onBatchDelete,
  onBatchFavorite,
}: MobileDriveShellProps) {
  const { state, addFavorite, removeFavorite } = useDrive()
  const [view, setView] = useState<MobileView>('files')
  const [searchOpen, setSearchOpen] = useState(false)
  const [actionItem, setActionItem] = useState<DriveItem | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [selectionMode, setSelectionMode] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const favoriteItems = useMemo<DriveItem[]>(() => favorites.map(favorite => ({
    id: favorite.folderId,
    name: favorite.folderName,
    isFolder: true,
    parentId: null,
    size: '0',
    mimeType: null,
    createdAt: '',
    updatedAt: '',
  })), [favorites])

  const visibleItems = view === 'favorites' ? favoriteItems : items
  const currentFolder = breadcrumbs[breadcrumbs.length - 1]?.name || '网盘'
  const title = searchOpen ? '搜索文件' : view === 'favorites' ? '收藏' : currentFolder
  const resultCount = view === 'favorites'
    ? favoriteItems.length
    : searchQuery ? (searchResultCount ?? 0) : total
  const isFavorite = useCallback((folderId: number) => {
    return state.favorites.some(favorite => favorite.folderId === folderId)
  }, [state.favorites])

  useEffect(() => {
    if (selectedIds.length === 0) setSelectionMode(false)
  }, [selectedIds.length])

  useEffect(() => {
    if (searchOpen) window.requestAnimationFrame(() => searchInputRef.current?.focus())
  }, [searchOpen])

  const closeSheets = useCallback(() => {
    setActionItem(null)
    setShowMore(false)
    setShowFilters(false)
  }, [])

  const openSearch = useCallback(() => {
    setView('files')
    setSearchOpen(true)
    setShowMore(false)
  }, [])

  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    onClearSearch()
  }, [onClearSearch])

  const handleBack = useCallback(() => {
    if (searchOpen) {
      closeSearch()
      return
    }
    if (view === 'favorites') {
      setView('files')
      return
    }
    if (breadcrumbs.length > 1) onParentFolder()
  }, [breadcrumbs.length, closeSearch, onParentFolder, searchOpen, view])

  const handleOpenFavorites = useCallback(() => {
    closeSheets()
    setSearchOpen(false)
    if (searchQuery) onClearSearch()
    setSelectionMode(false)
    onClearSelection()
    setView('favorites')
  }, [closeSheets, onClearSearch, onClearSelection, searchQuery])

  const handleRowClick = useCallback((item: DriveItem) => {
    if (selectionMode) {
      onSelect(item, true)
      return
    }
    if (item.isFolder) onFolderClick(item)
    else onPreview(item)
  }, [onFolderClick, onPreview, onSelect, selectionMode])

  const handleStartSelection = useCallback((item: DriveItem) => {
    setSelectionMode(true)
    onSelect(item)
    setActionItem(null)
  }, [onSelect])

  const handleToggleFavorite = useCallback((item: DriveItem) => {
    if (!item.isFolder) return
    if (isFavorite(item.id)) removeFavorite(item.id)
    else addFavorite(item.id, item.name)
    setActionItem(null)
  }, [addFavorite, isFavorite, removeFavorite])

  const handleExitSelection = useCallback(() => {
    setSelectionMode(false)
    onClearSelection()
  }, [onClearSelection])

  const isPreviewable = useCallback((item: DriveItem) => {
    const mime = (item.mimeType || '').toLowerCase()
    const ext = item.name.includes('.') ? item.name.split('.').pop()!.toLowerCase() : ''
    return mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime.includes('pdf') || [
      'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mp3', 'wav', 'ogg', 'pdf',
      'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'html', 'css', 'json', 'md',
    ].includes(ext)
  }, [])

  const handleSortChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
    onSortChange(event.target.value as SortField)
  }, [onSortChange])

  const emptyText = view === 'favorites'
    ? '还没有收藏文件夹'
    : searchOpen || searchQuery
      ? '没有找到匹配文件'
      : '这个目录还是空的'

  return (
    <section className="gh-drive-mobile-shell" aria-label="移动端网盘">
      <header className="gh-drive-mobile-header">
        <div className="gh-drive-mobile-titlebar">
          <button
            className="gh-drive-mobile-icon-button"
            onClick={handleBack}
            disabled={!searchOpen && view === 'files' && breadcrumbs.length <= 1}
            aria-label={searchOpen ? '关闭搜索' : view === 'favorites' ? '返回文件' : '返回上一级'}
            title={searchOpen ? '关闭搜索' : view === 'favorites' ? '返回文件' : '返回上一级'}
          >
            <span className="gh-drive-mobile-back-icon"><ChevronRight size={20} /></span>
          </button>
          <div className="gh-drive-mobile-title-copy">
            <span>LineWeb / Drive</span>
            <h1 title={title}>{title}</h1>
          </div>
          <button
            className={`gh-drive-mobile-icon-button${searchOpen ? ' gh-drive-mobile-icon-button--active' : ''}`}
            onClick={openSearch}
            aria-label="搜索文件"
            title="搜索文件"
          >
            <SearchIcon size={19} />
          </button>
          <button className="gh-drive-mobile-icon-button" onClick={() => setShowMore(true)} aria-label="更多操作" title="更多操作">
            <MoreIcon size={20} />
          </button>
        </div>

        {searchOpen ? (
          <div className="gh-drive-mobile-search-field">
            <SearchIcon size={17} />
            <input
              ref={searchInputRef}
              type="search"
              value={searchQuery}
              onChange={event => onSearch(event.target.value)}
              placeholder="搜索文件和文件夹"
              aria-label="搜索文件和文件夹"
              autoComplete="off"
            />
            {searching && <span className="gh-drive-mobile-search-status" aria-label="正在搜索" />}
            <button onClick={closeSearch} aria-label="关闭搜索" title="关闭搜索"><CloseIcon size={16} /></button>
          </div>
        ) : (
          <div className="gh-drive-mobile-context-row">
            <div className="gh-drive-mobile-path" aria-label="当前路径">
              {view === 'favorites' ? <span><StarIcon size={13} filled /> 常用文件夹</span> : breadcrumbs.slice(Math.max(0, breadcrumbs.length - 2)).map((crumb, index, path) => (
                <span key={`${crumb.id ?? 'root'}-${index}`}>
                  {index > 0 && <ChevronRight size={12} />}
                  {index === path.length - 1 ? crumb.name : <button onClick={() => onNavigate(breadcrumbs.length - path.length + index)}>{crumb.name}</button>}
                </span>
              ))}
            </div>
            <span className="gh-drive-mobile-count">{resultCount} 项</span>
            {view === 'files' && <button className="gh-drive-mobile-filter-button" onClick={() => setShowFilters(true)}><FilterIcon size={15} /> 筛选</button>}
          </div>
        )}
      </header>

      {selectionMode && selectedIds.length > 0 && (
        <div className="gh-drive-mobile-selection-bar" role="toolbar" aria-label="批量操作">
          <button className="gh-drive-mobile-selection-close" onClick={handleExitSelection} aria-label="取消选择" title="取消选择"><CloseIcon size={18} /></button>
          <strong>已选 {selectedIds.length} 项</strong>
          <div className="gh-drive-mobile-selection-actions">
            <button onClick={onSelectAll}>全选</button>
            <button onClick={onBatchDownload}><DownloadIcon size={15} /> 下载</button>
            <button onClick={onBatchMove}><FolderIcon size={15} /> 移动</button>
            <button onClick={onBatchFavorite}><StarIcon size={15} /> 收藏</button>
            <button className="gh-drive-mobile-selection-danger" onClick={onBatchDelete}><DeleteIcon size={15} /> 删除</button>
          </div>
        </div>
      )}

      <main className="gh-drive-mobile-content">
        {view === 'files' && !searchOpen && !searchQuery && breadcrumbs.length > 1 && (
          <button className="gh-drive-mobile-parent-link" onClick={onParentFolder}><span className="gh-drive-mobile-back-icon"><ChevronRight size={16} /></span> 返回上一级</button>
        )}

        {loading && view !== 'favorites' ? (
          <div className="gh-drive-mobile-loading" role="status"><div className="gh-spinner" /><span>正在加载文件…</span></div>
        ) : error && view !== 'favorites' ? (
          <div className="gh-drive-mobile-empty gh-drive-mobile-empty--error" role="alert"><strong>{error}</strong><button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onRefresh}>重新加载</button></div>
        ) : visibleItems.length === 0 ? (
          <div className="gh-drive-mobile-empty" role="status">
            <span className="gh-drive-mobile-empty-icon"><FolderIcon size={30} /></span>
            <strong>{emptyText}</strong>
            <span>{view === 'favorites' ? '在文件夹菜单中添加常用位置' : searchOpen || searchQuery ? '换个关键词试试' : '上传文件或新建文件夹开始整理'}</span>
            {view === 'files' && !searchOpen && !searchQuery && <button className="gh-btn gh-btn--sm gh-btn--primary" onClick={onUpload}><UploadIcon size={14} /> 上传文件</button>}
          </div>
        ) : (
          <div className="gh-drive-mobile-file-list" role="list" aria-label={title}>
            {visibleItems.map(item => {
              const selected = selectedIds.includes(item.id)
              return (
                <article key={`${view}-${item.id}`} className={`gh-drive-mobile-file-row${selected ? ' gh-drive-mobile-file-row--selected' : ''}`} role="listitem">
                  {selectionMode && <input className="gh-drive-mobile-checkbox" type="checkbox" checked={selected} onChange={() => onSelect(item, true)} aria-label={`选择 ${item.name}`} />}
                  <button className="gh-drive-mobile-file-main" onClick={() => handleRowClick(item)}>
                    <span className={`gh-drive-mobile-file-icon${item.isFolder ? ' gh-drive-mobile-file-icon--folder' : ''}`}>{getDriveIcon(item, 24)}</span>
                    <span className="gh-drive-mobile-file-copy">
                      <strong title={item.name}>{item.name}</strong>
                      <span>{item.isFolder ? '文件夹' : `${getFileTypeLabel(item)} · ${formatFileSize(Number(item.size))}`} · {item.updatedAt ? formatDate(item.updatedAt) : '常用位置'}</span>
                    </span>
                  </button>
                  <button className="gh-drive-mobile-file-more" onClick={() => setActionItem(item)} aria-label={`打开 ${item.name} 的操作`} title="更多操作"><MoreIcon size={19} /></button>
                </article>
              )
            })}
          </div>
        )}

        {view === 'files' && !searchOpen && !searchQuery && totalPages > 1 && (
          <div className="gh-drive-mobile-pagination">
            <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
            <span>第 {page}/{totalPages} 页，共 {total} 项</span>
            <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>下一页</button>
          </div>
        )}
      </main>

      {(actionItem || showMore || showFilters) && <div className="gh-drive-mobile-sheet-overlay" onClick={closeSheets} />}

      {actionItem && (
        <div className="gh-drive-mobile-sheet gh-drive-mobile-sheet--item" role="dialog" aria-modal="true" aria-label={`${actionItem.name} 的操作`}>
          <div className="gh-drive-mobile-sheet-handle" />
          <div className="gh-drive-mobile-sheet-heading">
            <span className="gh-drive-mobile-sheet-item-icon">{getDriveIcon(actionItem, 24)}</span>
            <div><strong title={actionItem.name}>{actionItem.name}</strong><span>{getFileTypeLabel(actionItem)}</span></div>
            <button onClick={() => setActionItem(null)} aria-label="关闭操作面板" title="关闭"><CloseIcon size={18} /></button>
          </div>
          <div className="gh-drive-mobile-sheet-actions">
            {actionItem.isFolder ? (
              <button onClick={() => { onFolderClick(actionItem); setActionItem(null) }}><FolderIcon size={18} /> 打开文件夹</button>
            ) : isPreviewable(actionItem) ? (
              <button onClick={() => { onPreview(actionItem); setActionItem(null) }}><SearchIcon size={18} /> 预览</button>
            ) : null}
            {!actionItem.isFolder && <button onClick={() => { onDownload(actionItem); setActionItem(null) }}><DownloadIcon size={18} /> 下载</button>}
            {actionItem.isFolder && <button onClick={() => handleToggleFavorite(actionItem)}><StarIcon size={18} filled={isFavorite(actionItem.id)} /> {isFavorite(actionItem.id) ? '取消收藏' : '收藏文件夹'}</button>}
            {view === 'files' && <button onClick={() => handleStartSelection(actionItem)}><ListViewIcon size={18} /> 选择</button>}
            <button onClick={() => { onRename(actionItem); setActionItem(null) }}><RenameIcon size={18} /> 重命名</button>
            <button className="gh-drive-mobile-sheet-action--danger" onClick={() => { onDelete(actionItem); setActionItem(null) }}><DeleteIcon size={18} /> 删除</button>
          </div>
        </div>
      )}

      {showMore && (
        <div className="gh-drive-mobile-sheet" role="dialog" aria-modal="true" aria-label="更多操作">
          <div className="gh-drive-mobile-sheet-handle" />
          <div className="gh-drive-mobile-sheet-header"><h2>更多操作</h2><button onClick={() => setShowMore(false)} aria-label="关闭更多操作" title="关闭"><CloseIcon size={18} /></button></div>
          <div className="gh-drive-mobile-sheet-actions">
            <button onClick={handleOpenFavorites}><StarIcon size={18} /> 收藏文件夹</button>
            <button onClick={() => { onUpload(); setShowMore(false) }}><UploadIcon size={18} /> 上传文件</button>
            <button onClick={() => { onNewFolder(); setShowMore(false) }}><NewFolderIcon size={18} /> 新建文件夹</button>
            <button onClick={() => { onRefresh(); setShowMore(false) }}><RefreshIcon size={18} /> 刷新文件</button>
            <button onClick={() => { onSync(); setShowMore(false) }} disabled={syncing}><RefreshIcon size={18} /> {syncing ? '同步中…' : '同步存储'}</button>
          </div>
          <div className="gh-drive-mobile-sheet-section"><span>文件视图</span><div className="gh-drive-mobile-view-switcher" role="group" aria-label="文件视图">
            <button className={viewMode === 'list' ? 'gh-drive-mobile-view-button--active' : ''} onClick={() => onViewModeChange('list')}><ListViewIcon size={16} /> 列表</button>
            <button className={viewMode === 'grid' ? 'gh-drive-mobile-view-button--active' : ''} onClick={() => onViewModeChange('grid')}><GridViewIcon size={16} /> 网格</button>
          </div></div>
        </div>
      )}

      {showFilters && (
        <div className="gh-drive-mobile-sheet" role="dialog" aria-modal="true" aria-label="筛选和排序">
          <div className="gh-drive-mobile-sheet-handle" />
          <div className="gh-drive-mobile-sheet-header"><h2>筛选和排序</h2><button onClick={() => setShowFilters(false)} aria-label="关闭筛选" title="关闭"><CloseIcon size={18} /></button></div>
          <div className="gh-drive-mobile-filter-fields">
            <label><span>文件类型</span><select value={categoryFilter} onChange={event => onCategoryFilterChange(event.target.value as CategoryFilter)}><option value="all">全部类型</option><option value="images">图片</option><option value="videos">视频</option><option value="audio">音频</option><option value="documents">文档</option><option value="archives">压缩包</option><option value="code">代码</option></select></label>
            <label><span>排序方式</span><select value={sortField} onChange={handleSortChange}><option value="name">名称</option><option value="updatedAt">最近修改</option><option value="createdAt">创建时间</option><option value="size">文件大小</option><option value="type">类型</option></select></label>
            <button className="gh-drive-mobile-sort-direction" onClick={onSortDirectionChange}><ChevronDown size={16} /> {sortDirection === 'asc' ? '升序排列' : '降序排列'}</button>
          </div>
          <button className="gh-btn gh-btn--sm gh-btn--primary gh-drive-mobile-filter-done" onClick={() => setShowFilters(false)}>完成</button>
        </div>
      )}
    </section>
  )
})

export default MobileDriveShell
