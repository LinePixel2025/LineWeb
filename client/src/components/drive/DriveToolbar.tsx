import { memo, type RefObject } from 'react'
import type { Breadcrumb, CategoryFilter, SortDirection, SortField, ViewMode } from '../../types/drive'
import {
  ChevronRight,
  CloseIcon,
  FilterIcon,
  GridViewIcon,
  ListViewIcon,
  NewFolderIcon,
  RefreshIcon,
  SearchIcon,
  UploadIcon,
} from './DriveIcons'

export interface DriveToolbarProps {
  breadcrumbs: Breadcrumb[]
  searchQuery: string
  searching: boolean
  searchResultCount: number | null
  onSearch: (query: string) => void
  onClearSearch?: () => void
  searchInputRef?: RefObject<HTMLInputElement | null>
  onNavigate: (index: number) => void
  onNewFolder: () => void
  onUpload: () => void
  onSync: () => void
  syncing: boolean
  onParentFolder?: () => void
  viewMode: ViewMode
  itemCount: number
  onViewModeChange: (mode: ViewMode) => void
  categoryFilter: CategoryFilter
  onCategoryFilterChange: (filter: CategoryFilter) => void
  sortField: SortField
  sortDirection: SortDirection
  onSortChange: (field: SortField) => void
  onSortDirectionChange: () => void
  showActions?: boolean
}

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: '全部类型' },
  { value: 'images', label: '图片' },
  { value: 'videos', label: '视频' },
  { value: 'audio', label: '音频' },
  { value: 'documents', label: '文档' },
  { value: 'archives', label: '压缩包' },
  { value: 'code', label: '代码' },
]

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'name', label: '名称' },
  { value: 'updatedAt', label: '最近修改' },
  { value: 'createdAt', label: '创建时间' },
  { value: 'size', label: '文件大小' },
  { value: 'type', label: '类型' },
]

const DriveToolbar = memo(function DriveToolbar({
  breadcrumbs,
  searchQuery,
  searching,
  searchResultCount,
  onSearch,
  onClearSearch,
  searchInputRef,
  onNavigate,
  onNewFolder,
  onUpload,
  onSync,
  syncing,
  onParentFolder,
  viewMode,
  itemCount,
  onViewModeChange,
  categoryFilter,
  onCategoryFilterChange,
  sortField,
  sortDirection,
  onSortChange,
  onSortDirectionChange,
  showActions = true,
}: DriveToolbarProps) {
  return (
    <div className="gh-drive-toolbar">
      <div className="gh-drive-path-row">
        <div className="gh-drive-path-navigation">
          {breadcrumbs.length > 1 && (
            <button
              className="gh-drive-icon-button"
              onClick={onParentFolder}
              title="返回上一级"
              aria-label="返回上一级"
            >
              <ChevronRight size={16} />
            </button>
          )}
          <nav className="gh-drive-breadcrumbs" aria-label="当前路径">
            {breadcrumbs.map((crumb, index) => (
              <span key={`${crumb.id ?? 'root'}-${index}`} className="gh-drive-breadcrumb-item">
                {index > 0 && <ChevronRight size={13} />}
                {index === breadcrumbs.length - 1 ? (
                  <span className="gh-drive-breadcrumb-current">{crumb.name}</span>
                ) : (
                  <button className="gh-drive-breadcrumb-button" onClick={() => onNavigate(index)}>
                    {crumb.name}
                  </button>
                )}
              </span>
            ))}
          </nav>
        </div>
        <span className="gh-drive-path-summary">
          {searchQuery
            ? searching ? '正在搜索…' : `${searchResultCount ?? 0} 个结果`
            : `${itemCount} 个项目`}
        </span>
      </div>

      <div className="gh-drive-control-row">
        <label className="gh-drive-search-field">
          <SearchIcon size={16} />
          <span className="sr-only">搜索文件</span>
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={event => onSearch(event.target.value)}
            placeholder="搜索文件"
            autoComplete="off"
          />
          {searching && <span className="gh-drive-search-status" aria-label="正在搜索" />}
          {searchQuery && !searching && onClearSearch && (
            <button className="gh-drive-search-clear" onClick={onClearSearch} aria-label="清除搜索">
              <CloseIcon size={14} />
            </button>
          )}
        </label>

        <div className="gh-drive-control-group">
          <label className="gh-drive-select-control" title="筛选文件类型">
            <FilterIcon size={14} />
            <span className="sr-only">文件类型</span>
            <select value={categoryFilter} onChange={event => onCategoryFilterChange(event.target.value as CategoryFilter)}>
              {CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <label className="gh-drive-select-control" title="排序方式">
            <span className="gh-drive-select-label">排序</span>
            <span className="sr-only">排序方式</span>
            <select value={sortField} onChange={event => onSortChange(event.target.value as SortField)}>
              {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          <button
            className="gh-drive-sort-direction"
            onClick={onSortDirectionChange}
            title={sortDirection === 'asc' ? '升序' : '降序'}
            aria-label={sortDirection === 'asc' ? '升序，点击切换为降序' : '降序，点击切换为升序'}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </button>

          <div className="gh-drive-view-switcher" role="group" aria-label="文件展示方式">
            <button
              className={`gh-drive-view-switcher-button${viewMode === 'list' ? ' gh-drive-view-switcher-button--active' : ''}`}
              onClick={() => onViewModeChange('list')}
              aria-label="列表视图"
              aria-pressed={viewMode === 'list'}
              title="列表视图"
            >
              <ListViewIcon size={15} />
            </button>
            <button
              className={`gh-drive-view-switcher-button${viewMode === 'grid' ? ' gh-drive-view-switcher-button--active' : ''}`}
              onClick={() => onViewModeChange('grid')}
              aria-label="网格视图"
              aria-pressed={viewMode === 'grid'}
              title="网格视图"
            >
              <GridViewIcon size={15} />
            </button>
          </div>
        </div>

        {showActions && (
          <div className="gh-drive-toolbar-actions">
            <button className="gh-btn gh-btn--sm gh-btn--secondary" onClick={onNewFolder}>
              <NewFolderIcon size={14} /> 新建
            </button>
            <button className="gh-btn gh-btn--sm gh-btn--primary" onClick={onUpload}>
              <UploadIcon size={14} /> 上传
            </button>
            <button className="gh-btn gh-btn--sm gh-btn--ghost" onClick={onSync} disabled={syncing}>
              <RefreshIcon size={14} /> {syncing ? '同步中…' : '同步'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
})

export default DriveToolbar
