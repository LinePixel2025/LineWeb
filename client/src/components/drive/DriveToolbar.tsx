import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { Breadcrumb, SortOption, ViewMode } from '../../types/drive'
import { NewFolderIcon, UploadIcon, RefreshIcon, SearchIcon, GridViewIcon, ListViewIcon } from './DriveIcons'

export interface DriveToolbarProps {
  breadcrumbs: Breadcrumb[]
  searchQuery: string
  searching: boolean
  searchResultCount: number | null
  viewMode: ViewMode
  sort: SortOption
  onSearch: (query: string) => void
  onNavigate: (index: number) => void
  onToggleView: () => void
  onNewFolder: () => void
  onUpload: () => void
  onSync: () => void
  onSortChange: (sort: SortOption) => void
  syncing: boolean
}

const sortOptions: { field: SortOption['field']; label: string }[] = [
  { field: 'name', label: '名称' },
  { field: 'size', label: '大小' },
  { field: 'updatedAt', label: '修改时间' },
  { field: 'createdAt', label: '创建时间' },
  { field: 'type', label: '类型' },
]

const DriveToolbar = memo(function DriveToolbar({
  breadcrumbs,
  searchQuery,
  searching,
  searchResultCount,
  viewMode,
  sort,
  onSearch,
  onNavigate,
  onToggleView,
  onNewFolder,
  onUpload,
  onSync,
  onSortChange,
  syncing,
}: DriveToolbarProps) {
  const handleSortClick = (field: SortOption['field']) => {
    if (sort.field === field) {
      onSortChange({ field, direction: sort.direction === 'asc' ? 'desc' : 'asc' })
    } else {
      onSortChange({ field, direction: 'asc' })
    }
  }

  return (
    <LiquidGlass variant="blur" interactive={false} chromatic={false} className="drive-toolbar">
      {/* Row 1: Breadcrumbs + Action buttons */}
      <div className="drive-toolbar-top">
        <nav className="drive-toolbar-breadcrumbs">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="drive-breadcrumb-item">
              {i > 0 && <span className="drive-breadcrumb-sep">›</span>}
              {i === breadcrumbs.length - 1 ? (
                <span className="drive-breadcrumb-current">{crumb.name}</span>
              ) : (
                <button
                  className="drive-breadcrumb-btn"
                  onClick={() => onNavigate(i)}
                >
                  {crumb.name}
                </button>
              )}
            </span>
          ))}
        </nav>
        <div className="drive-toolbar-actions">
          <LiquidButton size="sm" variant="glass" onClick={onNewFolder}>
            <NewFolderIcon size={14} /> 新建
          </LiquidButton>
          <LiquidButton size="sm" variant="primary" onClick={onUpload}>
            <UploadIcon size={14} /> 上传
          </LiquidButton>
          <LiquidButton size="sm" variant="ghost" onClick={onSync} disabled={syncing}>
            <RefreshIcon size={14} /> {syncing ? '同步中...' : '同步'}
          </LiquidButton>
        </div>
      </div>

      {/* Row 2: Search + Sort + View toggle */}
      <div className="drive-toolbar-middle">
        <div className="drive-toolbar-search">
          <input
            className="lg-input drive-toolbar-search-input"
            type="text"
            placeholder="搜索文件..."
            value={searchQuery}
            onChange={e => onSearch(e.target.value)}
          />
          {searchQuery && (
            <span className="drive-toolbar-search-hint">
              {searching
                ? '搜索中...'
                : searchResultCount !== null
                  ? `找到 ${searchResultCount} 项`
                  : ''}
            </span>
          )}
        </div>

        <div className="drive-toolbar-controls">
          {/* Sort Dropdown */}
          <div className="drive-sort-dropdown">
            <span className="drive-sort-label">排序:</span>
            {sortOptions.map(option => (
              <button
                key={option.field}
                className={`drive-sort-btn ${sort.field === option.field ? 'drive-sort-btn--active' : ''}`}
                onClick={() => handleSortClick(option.field)}
                title={`按${option.label}${sort.direction === 'asc' ? '降序' : '升序'}`}
              >
                {option.label}
                {sort.field === option.field && (
                  <span className="drive-sort-arrow">
                    {sort.direction === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* View Toggle */}
          <button
            className={`drive-view-toggle ${viewMode === 'grid' ? 'drive-view-toggle--active' : ''}`}
            onClick={onToggleView}
            title={viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
          >
            {viewMode === 'list' ? <GridViewIcon size={16} /> : <ListViewIcon size={16} />}
          </button>
        </div>
      </div>
    </LiquidGlass>
  )
})

export default DriveToolbar
