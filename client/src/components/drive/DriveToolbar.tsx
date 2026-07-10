import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import LiquidButton from '../glass/LiquidButton'
import type { Breadcrumb } from '../../types/drive'
import { NewFolderIcon, UploadIcon, RefreshIcon, ChevronRight, HomeIcon, SearchIcon } from './DriveIcons'

export interface DriveToolbarProps {
  breadcrumbs: Breadcrumb[]
  searchQuery: string
  searching: boolean
  searchResultCount: number | null
  onSearch: (query: string) => void
  onNavigate: (index: number) => void
  onNewFolder: () => void
  onUpload: () => void
  onSync: () => void
  syncing: boolean
  onParentFolder?: () => void
}

const DriveToolbar = memo(function DriveToolbar({
  breadcrumbs, searchQuery, searching, searchResultCount,
  onSearch, onNavigate, onNewFolder, onUpload, onSync, syncing, onParentFolder,
}: DriveToolbarProps) {
  return (
    <LiquidGlass variant="blur" interactive={false} chromatic={false} className="drive-toolbar">
      <div className="drive-toolbar-top">
        <div className="drive-toolbar-nav">
          {breadcrumbs.length > 1 && (
            <button className="drive-toolbar-nav-btn" onClick={onParentFolder} title="上一级" aria-label="上一级">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}
        </div>
        <nav className="drive-toolbar-breadcrumbs">
          {breadcrumbs.map((crumb, i) => (
            <span key={i} className="drive-breadcrumb-item">
              {i > 0 && <ChevronRight size={14} />}
              {i === breadcrumbs.length - 1 ? (
                <span className="drive-breadcrumb-current">{crumb.name}</span>
              ) : (
                <button className="drive-breadcrumb-btn" onClick={() => onNavigate(i)}>{crumb.name}</button>
              )}
            </span>
          ))}
        </nav>
        <div className="drive-toolbar-search">
          <SearchIcon size={14} />
          <input className="drive-toolbar-search-input" type="text" placeholder="搜索" value={searchQuery} onChange={e => onSearch(e.target.value)} />
          {searchQuery && (
            <span className="drive-toolbar-search-hint">
              {searching ? '搜索中...' : searchResultCount !== null ? `${searchResultCount} 项` : ''}
            </span>
          )}
        </div>
      </div>
      <div className="drive-toolbar-bottom">
        <div className="drive-toolbar-actions">
          <LiquidButton size="sm" variant="glass" onClick={onNewFolder}><NewFolderIcon size={14} /> 新建</LiquidButton>
          <LiquidButton size="sm" variant="primary" onClick={onUpload}><UploadIcon size={14} /> 上传</LiquidButton>
          <LiquidButton size="sm" variant="ghost" onClick={onSync} disabled={syncing}>
            <RefreshIcon size={14} /> {syncing ? '同步中...' : '同步'}
          </LiquidButton>
        </div>
      </div>
    </LiquidGlass>
  )
})

export default DriveToolbar
