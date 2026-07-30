import { memo } from 'react'
import { FolderIcon, MoreIcon, SearchIcon, StarIcon } from './DriveIcons'

export interface MobileNavProps {
  activeTab: 'files' | 'favorites' | 'search' | 'settings'
  onTabChange: (tab: 'files' | 'favorites' | 'search' | 'settings') => void
}

const MobileNav = memo(function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  const tabs = [
    { id: 'files' as const, label: '文件', icon: <FolderIcon size={18} /> },
    { id: 'favorites' as const, label: '收藏', icon: <StarIcon size={18} /> },
    { id: 'search' as const, label: '搜索', icon: <SearchIcon size={18} /> },
    { id: 'settings' as const, label: '更多', icon: <MoreIcon size={18} /> },
  ]

  return (
    <nav className="gh-drive-mobile-nav" aria-label="网盘导航">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`gh-drive-mobile-nav-item${activeTab === tab.id ? ' gh-drive-mobile-nav-item--active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <span className="gh-drive-mobile-nav-icon">{tab.icon}</span>
          <span className="gh-drive-mobile-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
})

export default MobileNav
