import { memo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  collapsed: boolean
  mobileOpen: boolean
  onClose: () => void
  onToggleCollapse: () => void
}

interface SidebarItem { path: string; label: string; icon: string }

function SidebarIcon({ path }: { path: string }) {
  const icon = path.startsWith('/admin') ? <><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M2.5 6.25h11" /><path d="M5.25 9h5.5" /><path d="M5.25 11.25h3" /></>
    : path === '/' ? <><rect x="3" y="3" width="10" height="10" rx="2" /><path d="M5.5 10 7.5 8l1.5 1.5L11.5 6" /></>
    : path === '/posts' ? <><path d="M3.5 3.5h8a1.5 1.5 0 0 1 1.5 1.5v7.5h-8A1.5 1.5 0 0 0 3.5 14z" /><path d="M3.5 3.5v10.5M6 6.5h4M6 9h4" /></>
    : path === '/drive' ? <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3l1.2 1.5H12A1.5 1.5 0 0 1 13.5 7v5A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12z" />
    : path === '/features' ? <><circle cx="8" cy="8" r="5" /><path d="m9.8 6.2-1 2.6-2.6 1 1-2.6z" /></>
    : <><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13a4.5 4.5 0 0 1 9 0" /></>

  return <svg className="gh-sidebar-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
}

const sections = [
  {
    title: 'Home',
    items: [
      { path: '/', label: 'Overview', icon: 'M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 0-1.5H2.5V1.75A.75.75 0 0 0 1.75 1ZM8 5.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 5.5Z M1.75 11.5h12.5v1.5H1.75v-1.5Z' },
    ]
  },
  {
    title: 'Manage', requireAuth: true,
    items: [
      { path: '/admin', label: '管理面板', icon: 'M2.75 0A1.75 1.75 0 0 0 1 1.75v12.5C1 15.216 1.784 16 2.75 16h10.5A1.75 1.75 0 0 0 15 14.25V1.75A1.75 1.75 0 0 0 13.25 0ZM3.25 4.5a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1-.75-.75Zm0 3.5a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5H4a.75.75 0 0 1-.75-.75Z' },
    ]
  },
  {
    title: 'Explore',
    items: [
      { path: '/posts', label: 'Repositories', icon: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.25.25h-3.5a.25.25 0 0 1-.25-.25Zm-2 0a.25.25 0 0 1 .25-.25h.75a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.25.25h-.75a.25.25 0 0 1-.25-.25Z' },
      { path: '/drive', label: 'Files', icon: 'M0 2.75C0 1.784.784 1 1.75 1H5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1h6.75c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 0 0-.2-.1Z' },
      { path: '/features', label: 'About', icon: 'M6.354.646a.5.5 0 0 1 .708 0l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L10.043 5 6.354 1.354a.5.5 0 0 1 0-.708Z' },
    ]
  },
  {
    title: 'Personal',
    items: [
      { path: '/profile', label: 'Profile', icon: 'M2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25Z M5.5 2.75a.75.75 0 0 1 0-1.5h5a.75.75 0 0 1 0 1.5Z M8 12a.75.75 0 0 0 .75-.75v-3.5a.75.75 0 0 0-1.5 0v3.5c0 .414.336.75.75.75Z' },
    ]
  },
]

export default memo(function GitHubSidebar({ collapsed, mobileOpen, onClose, onToggleCollapse }: Props) {
  const { user, isAdmin } = useAuth()
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <>
      {mobileOpen && <div className="gh-sidebar-overlay" onClick={onClose} />}
      <aside className={`gh-sidebar ${collapsed ? 'gh-sidebar--collapsed' : ''} ${mobileOpen ? 'gh-sidebar--open' : ''}`}>
        <nav className="gh-sidebar-nav">
          {sections.map(section => {
            if (section.requireAuth && !user) return null
            const visibleItems = section.items.filter(item => {
              if (item.path.startsWith('/admin') && !isAdmin) return false
              if (item.path.startsWith('/profile') && !user) return false
              return true
            })
            if (visibleItems.length === 0) return null
            return (
              <div key={section.title} className="gh-sidebar-section">
                <div className="gh-sidebar-section-title">{section.title}</div>
                {visibleItems.map(item => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`gh-sidebar-item ${isActive(item.path) ? 'gh-sidebar-item--active' : ''}`}
                    onClick={onClose}
                  >
                    <SidebarIcon path={item.path} />
                    <span className="gh-sidebar-label">{item.label}</span>
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="gh-sidebar-footer">
          <button className="gh-sidebar-item gh-sidebar-collapse-btn" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg className="gh-sidebar-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={collapsed ? 'm6 3.5 4 4.5-4 4.5' : 'm10 3.5-4 4.5 4 4.5'} />
            </svg>
            <span className="gh-sidebar-label">{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>
    </>
  )
})
