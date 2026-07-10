import { memo } from 'react'
import LiquidGlass from '../glass/LiquidGlass'
import type { CategoryFilter, SidebarNavItem } from '../../types/drive'

export interface DriveSidebarProps {
  activeFilter: CategoryFilter
  onFilterChange: (filter: CategoryFilter) => void
  fileCounts?: {
    all: number
    images: number
    videos: number
    audio: number
    documents: number
    archives: number
    code: number
  }
}

const navItems: SidebarNavItem[] = [
  { id: 'all', label: '全部文件', icon: '📂', filter: 'all' },
  { id: 'recent', label: '最近上传', icon: '🕐' },
  { id: 'favorites', label: '收藏', icon: '⭐' },
]

const categoryItems: SidebarNavItem[] = [
  { id: 'images', label: '图片', icon: '🖼️', filter: 'images' },
  { id: 'videos', label: '视频', icon: '🎬', filter: 'videos' },
  { id: 'audio', label: '音频', icon: '🎵', filter: 'audio' },
  { id: 'documents', label: '文档', icon: '📄', filter: 'documents' },
  { id: 'archives', label: '压缩包', icon: '🗜️', filter: 'archives' },
  { id: 'code', label: '代码', icon: '💻', filter: 'code' },
]

const DriveSidebar = memo(function DriveSidebar({
  activeFilter,
  onFilterChange,
  fileCounts,
}: DriveSidebarProps) {

  return (
    <aside className="drive-sidebar">
      {/* Main Navigation */}
      <LiquidGlass variant="blur" interactive={false} chromatic={false} className="drive-sidebar-section">
        <nav className="drive-sidebar-nav">
          {navItems.map(item => (
            <button
              key={item.id}
              className={`drive-sidebar-item ${activeFilter === item.filter ? 'drive-sidebar-item--active' : ''}`}
              onClick={() => item.filter && onFilterChange(item.filter)}
            >
              <span className="drive-sidebar-item-icon">{item.icon}</span>
              <span className="drive-sidebar-item-label">{item.label}</span>
              {item.filter && fileCounts && (
                <span className="drive-sidebar-item-count">{fileCounts[item.filter]}</span>
              )}
            </button>
          ))}
        </nav>
      </LiquidGlass>

      {/* File Categories */}
      <LiquidGlass variant="blur" interactive={false} chromatic={false} className="drive-sidebar-section">
        <h3 className="drive-sidebar-heading">文件分类</h3>
        <nav className="drive-sidebar-nav">
          {categoryItems.map(item => (
            <button
              key={item.id}
              className={`drive-sidebar-item ${activeFilter === item.filter ? 'drive-sidebar-item--active' : ''}`}
              onClick={() => item.filter && onFilterChange(item.filter)}
            >
              <span className="drive-sidebar-item-icon">{item.icon}</span>
              <span className="drive-sidebar-item-label">{item.label}</span>
              {item.filter && fileCounts && (
                <span className="drive-sidebar-item-count">{fileCounts[item.filter]}</span>
              )}
            </button>
          ))}
        </nav>
      </LiquidGlass>

    </aside>
  )
})

export default DriveSidebar
