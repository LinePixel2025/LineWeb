import { memo, useState, useRef, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { GitHubButton } from './ui'

const navItems = [
  { path: '/admin', label: '文章管理', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75A.75.75 0 01.75 1h4.253c1.227 0 2.317.59 3 1.501A3.744 3.744 0 0111.006 1h4.245a.75.75 0 01.75.75v10.5a.75.75 0 01-.75.75h-4.507a2.25 2.25 0 00-1.591.659l-.622.621a.75.75 0 01-1.06 0l-.622-.621A2.25 2.25 0 005.258 13H.75a.75.75 0 01-.75-.75V1.75zm8.755 3a3 3 0 01-2.154.886H1.5V11.5h3.753a3.73 3.73 0 012.502 1.067V4.75zm1.5 0v7.817A3.73 3.73 0 0112.747 11.5h3.253V2.5H10.9a3.745 3.745 0 00-2.645 1.136z"/></svg>
  ) },
  { path: '/admin/new', label: '写文章', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z"/></svg>
  ) },
  { path: '/admin/comments', label: '评论管理', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.457 1.457 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25v-7.5zM2.75 2.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 01.75.75v2.19l2.72-2.72a.75.75 0 01.53-.22h4.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25H2.75z"/></svg>
  ) },
  { path: '/admin/pages', label: '页面管理', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0114.25 16H1.75A1.75 1.75 0 010 14.25V1.75zM1.75 1.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25H1.75zM4 4.75A.75.75 0 014.75 4h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 4.75zm0 3a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 7.75zm0 3a.75.75 0 01.75-.75h3.5a.75.75 0 010 1.5h-3.5a.75.75 0 01-.75-.75z"/></svg>
  ) },
  { path: '/admin/users', label: '用户管理', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5a2.75 2.75 0 115.5 0 2.75 2.75 0 01-5.5 0zm2.75-1.25a1.25 1.25 0 100 2.5 1.25 1.25 0 000-2.5zM3.5 12.477a3.854 3.854 0 015.814-3.354 3.854 3.854 0 013.186 0c.537.3.98.763 1.215 1.334.235.57.328 1.207.326 1.848a.75.75 0 01-1.5 0c.002-.515-.09-1.013-.273-1.458a2.37 2.37 0 00-.809-1.013 2.357 2.357 0 00-2.518 0A2.37 2.37 0 008.04 10.847c-.183.445-.275.943-.273 1.458a.75.75 0 01-1.5 0c.002-.641.095-1.278.326-1.848.235-.571.678-1.034 1.215-1.334a3.855 3.855 0 00-4.309-.003.75.75 0 01-.621-1.364c1.22-.558 2.644-.77 4.008-.587.335-.18.689-.326 1.057-.437 1.002-.302 2.06-.302 3.062 0l.003.001a.75.75 0 01.003.001c.367.111.72.257 1.054.436 1.365-.183 2.789.029 4.008.587a.75.75 0 01-.621 1.364 3.855 3.855 0 00-4.308.003.75.75 0 01-.604-1.374c.543-.234 1.138-.234 1.682 0a2.354 2.354 0 01.72.393v-.425a1.75 1.75 0 00-1.75-1.75H3.75A1.75 1.75 0 002 11.625v.425c.173-.175.418-.314.72-.393.544-.234 1.139-.234 1.683 0 .486.21.934.586 1.174 1.079.241.493.365 1.06.365 1.627a.75.75 0 01-1.5 0 1.88 1.88 0 00-.25-.934 1.88 1.88 0 00-.717-.674 2.355 2.355 0 00-2.204-.001.75.75 0 01-.605-1.374c.555-.24 1.164-.241 1.721-.002a.755.755 0 01.008.003z"/></svg>
  ) },
  { path: '/admin/api', label: 'API 密钥', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 3.5A1.5 1.5 0 013.5 2h9A1.5 1.5 0 0114 3.5v2.794l2.22 1.2a.75.75 0 010 1.345L14 10.039v2.461a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 12.5v-2.794L.28 8.706a.75.75 0 010-1.345L2 6.161V3.5zm1.5 0v3.294l-.22-.12A.75.75 0 013.5 6.5h1a.75.75 0 01.75.75v2.25a.75.75 0 01-.75.75h-1a.75.75 0 010-1.5h.25V8h-.25a.75.75 0 010-1.5h.25V6h-.25a.75.75 0 01-.22-.174L3.5 3.5zm0 0h9v2.661h.25a.75.75 0 010 1.5h-.25V8h.25a.75.75 0 010 1.5h-.25v.75h.25a.75.75 0 010 1.5h.25V3.5zm0 9a.25.25 0 00.25.25h9a.25.25 0 00.25-.25v-2.294l2.22-1.2a.75.75 0 000-1.345l-2.22-1.2V3.5a.25.25 0 00-.25-.25h-9a.25.25 0 00-.25.25v2.294L1.78 6.961a.75.75 0 000 1.345l2.22 1.2V12.5z"/></svg>
  ) },
  { path: '/admin/devices', label: '设备监控', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.75 0A2.75 2.75 0 002 2.75v5.5A2.75 2.75 0 004.75 11h2.5v2H5.5a.75.75 0 000 1.5h5a.75.75 0 000-1.5h-1.75v-2h2.5A2.75 2.75 0 0014 8.25v-5.5A2.75 2.75 0 0011.25 0h-6.5zM3.5 2.75c0-.69.56-1.25 1.25-1.25h6.5c.69 0 1.25.56 1.25 1.25v5.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-5.5z"/></svg>
  ) },
  { path: '/admin/ai', label: 'AI 助手', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 110 16A8 8 0 018 0zm0 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 7.75a.75.75 0 01.75.75v1.25h.5a.75.75 0 010 1.5h-2.5a.75.75 0 010-1.5h.5V10a.75.75 0 01.75-.75zM8 4a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>
  ) },
]

const SIDEBAR_COLLAPSED_KEY = 'lineweb_admin_sidebar_collapsed'

export default memo(function AdminLayout() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
    } catch {
      return false
    }
  })
  const sidebarRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const closeMobile = () => setMobileOpen(false)

  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next))
      return next
    })
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  useEffect(() => {
    if (!mobileOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (!sidebarRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [mobileOpen])

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="gh-layout-root gh-layout-root--admin">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="gh-sidebar-overlay" style={{ display: 'block' }} onClick={closeMobile} />
      )}

      {/* Admin sidebar */}
      <aside
        ref={sidebarRef}
        className={`gh-sidebar ${mobileOpen ? 'gh-sidebar--open' : ''} ${collapsed ? 'gh-sidebar--collapsed' : ''}`}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 'var(--gh-space-2)',
          padding: 'var(--gh-space-4)', borderBottom: '1px solid var(--gh-border)',
        }}>
          <Link to="/admin" className="gh-sidebar-item" style={{
            borderLeft: 'none', gap: 'var(--gh-space-2)', padding: 0,
            background: 'none', color: 'var(--gh-text)',
          }} onClick={closeMobile}>
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="1" y="1" width="20" height="20" rx="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 11h8M11 7v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="gh-sidebar-label" style={{ fontWeight: 600 }}>Line Web</span>
          </Link>
        </div>

        <nav className="gh-sidebar-nav">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`gh-sidebar-item ${isActive(item.path) ? 'gh-sidebar-item--active' : ''}`}
              onClick={closeMobile}
            >
              <span className="gh-sidebar-icon">{item.icon}</span>
              <span className="gh-sidebar-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="gh-sidebar-footer">
          <button className="gh-sidebar-collapse-btn gh-sidebar-item" onClick={toggleCollapsed}
            style={{ borderLeft: 'none', cursor: 'pointer', width: '100%' }}>
            <span className="gh-sidebar-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M7.78 12.53a.75.75 0 01-1.06 0L2.47 8.28a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 1.06L4.56 7.25h7.69a.75.75 0 010 1.5H4.56l3.22 3.22a.75.75 0 010 1.06z" />
              </svg>
            </span>
            <span className="gh-sidebar-label">{collapsed ? '展开' : '收起'}</span>
          </button>
          <Link to="/" className="gh-sidebar-item" onClick={closeMobile}
            style={{ borderLeft: 'none', marginTop: 'var(--gh-space-2)' }}>
            <span className="gh-sidebar-icon">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0a8 8 0 110 16A8 8 0 018 0zm0 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm3.25 7.75h-6.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5z" />
              </svg>
            </span>
            <span className="gh-sidebar-label">返回主站</span>
          </Link>
        </div>
      </aside>


      {/* Main content area */}
      <div className={`gh-content ${collapsed ? 'gh-content--collapsed' : ''}`}>
        {/* Top bar */}
        <header style={{
          display: 'flex', alignItems: 'center', gap: 'var(--gh-space-3)',
          paddingBottom: 'var(--gh-space-4)', borderBottom: '1px solid var(--gh-border)',
          marginBottom: 'var(--gh-space-5)',
        }}>
          <button
            ref={btnRef}
            className="gh-btn gh-btn--secondary gh-btn--sm gh-visible-mobile"
            onClick={() => setMobileOpen(prev => !prev)}
            aria-label="切换菜单"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 2.75A.75.75 0 011.75 2h12.5a.75.75 0 010 1.5H1.75A.75.75 0 011 2.75zm0 5A.75.75 0 011.75 7h12.5a.75.75 0 010 1.5H1.75A.75.75 0 011 7.75zm0 5A.75.75 0 011.75 12h12.5a.75.75 0 010 1.5H1.75a.75.75 0 01-.75-.75z" />
            </svg>
          </button>

          <h1 style={{ fontSize: 'var(--gh-text-xl)', fontWeight: 600, margin: 0 }}>管理面板</h1>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--gh-space-2)' }}>
            {user && (
              <>
                <span className="gh-text-secondary" style={{ fontSize: 'var(--gh-text-sm)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.username}
                </span>
                <GitHubButton variant="ghost" size="sm" onClick={handleLogout}>
                  退出
                </GitHubButton>
              </>
            )}
          </div>
        </header>

        <div className="gh-page-container">
          <Outlet />
        </div>
      </div>
    </div>
  )
})
