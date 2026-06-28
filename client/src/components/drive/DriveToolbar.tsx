import { memo } from 'react'
import LiquidButton from '../glass/LiquidButton'
import type { Breadcrumb } from '../../types/drive'

export interface DriveToolbarProps {
  breadcrumbs: Breadcrumb[]
  searchQuery: string
  searching: boolean
  searchResultCount: number | null
  viewMode: 'list' | 'grid'
  onSearch: (query: string) => void
  onNavigate: (index: number) => void
  onToggleView: () => void
  onNewFolder: () => void
  onUpload: () => void
  onSync: () => void
  syncing: boolean
}

const DriveToolbar = memo(function DriveToolbar({
  breadcrumbs,
  searchQuery,
  searching,
  searchResultCount,
  viewMode,
  onSearch,
  onNavigate,
  onToggleView,
  onNewFolder,
  onUpload,
  onSync,
  syncing,
}: DriveToolbarProps) {
  return (
    <div className="drive-toolbar">
      {/* Row 1: Title + Action buttons */}
      <div className="drive-toolbar-top">
        <h1 className="drive-toolbar-title">☁️ 网盘</h1>
        <div className="drive-toolbar-actions">
          <LiquidButton size="sm" variant="glass" onClick={onNewFolder}>
            📁 新建文件夹
          </LiquidButton>
          <LiquidButton size="sm" variant="primary" onClick={onUpload}>
            ⬆ 上传文件
          </LiquidButton>
          <LiquidButton size="sm" variant="ghost" onClick={onSync} disabled={syncing}>
            {syncing ? '🔄 同步中...' : '🔄 同步'}
          </LiquidButton>
        </div>
      </div>

      {/* Row 2: Search + View toggle */}
      <div className="drive-toolbar-middle">
        <div className="drive-toolbar-search">
          <input
            className="lg-input drive-toolbar-search-input"
            type="text"
            placeholder="🔍 搜索文件..."
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
        <button
          className={`drive-view-toggle ${viewMode === 'grid' ? 'drive-view-toggle--active' : ''}`}
          onClick={onToggleView}
          title={viewMode === 'list' ? '切换为网格视图' : '切换为列表视图'}
        >
          {viewMode === 'list' ? '☰' : '▦'}
        </button>
      </div>

      {/* Row 3: Breadcrumbs */}
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
    </div>
  )
})

export default DriveToolbar
