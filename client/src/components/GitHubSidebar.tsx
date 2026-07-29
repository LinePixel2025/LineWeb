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

const sections = [
  {
    title: 'Home',
    items: [
      { path: '/', label: 'Overview', icon: 'M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 0-1.5H2.5V1.75A.75.75 0 0 0 1.75 1ZM8 5.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 5.5Z M1.75 11.5h12.5v1.5H1.75v-1.5Z' },
    ]
  },
  {
    title: 'Create', requireAuth: true,
    items: [
      { path: '/admin/new', label: '写文章', icon: 'M2.5 1.75a.25.25 0 0 1 .25-.25h10.5a.25.25 0 0 1 .25.25v10.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25V1.75ZM2.75 0A1.75 1.75 0 0 0 1 1.75v10.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25V1.75A1.75 1.75 0 0 0 13.25 0H2.75ZM8 4.5a.75.75 0 0 1 .75.75v2h2a.75.75 0 0 1 0 1.5h-2v2a.75.75 0 0 1-1.5 0v-2h-2a.75.75 0 0 1 0-1.5h2v-2A.75.75 0 0 1 8 4.5Z' },
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
                    <svg className="gh-sidebar-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d={item.icon} />
                    </svg>
                    <span className="gh-sidebar-label">{item.label}</span>
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="gh-sidebar-footer">
          <button className="gh-sidebar-item gh-sidebar-collapse-btn" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg className="gh-sidebar-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d={collapsed ? 'M6.354.646a.5.5 0 0 1 .708 0l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L10.043 5 6.354 1.354a.5.5 0 0 1 0-.708Z' : 'M9.646 1.646a.5.5 0 0 1 .708.708L6.707 6l3.647 3.646a.5.5 0 0 1-.708.708l-4-4a.5.5 0 0 1 0-.708l4-4Z'} />
            </svg>
            <span className="gh-sidebar-label">{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>
    </>
  )
})
