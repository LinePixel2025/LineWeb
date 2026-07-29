import { memo } from 'react'

export interface MobileNavProps {
  activeTab: 'files' | 'favorites' | 'search' | 'settings'
  onTabChange: (tab: 'files' | 'favorites' | 'search' | 'settings') => void
}

const MobileNav = memo(function MobileNav({ activeTab, onTabChange }: MobileNavProps) {
  const tabs = [
    { id: 'files' as const, label: '文件', icon: '📁' },
    { id: 'favorites' as const, label: '收藏', icon: '⭐' },
    { id: 'search' as const, label: '搜索', icon: '🔍' },
    { id: 'settings' as const, label: '设置', icon: '⚙️' },
  ]

  return (
    <nav className="gh-drive-mobile-nav">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`gh-drive-mobile-nav-item ${activeTab === tab.id ? 'gh-drive-mobile-nav-item--active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <span className="gh-drive-mobile-nav-icon">{tab.icon}</span>
          <span className="gh-drive-mobile-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  )
})

export default MobileNav
