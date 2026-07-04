import { useState, useRef, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useWallpaper } from '../contexts/WallpaperContext'

const navItems = [
  { path: '/admin', label: '文章管理', icon: '📝' },
  { path: '/admin/new', label: '写文章', icon: '✏️' },
  { path: '/admin/comments', label: '评论管理', icon: '📬' },
  { path: '/admin/pages', label: '页面管理', icon: '📄' },
  { path: '/admin/users', label: '用户管理', icon: '👤' },
  { path: '/admin/api', label: 'API 密钥', icon: '🔑' },
  { path: '/admin/devices', label: '设备监控', icon: '📡' },
]

const SIDEBAR_COLLAPSED_KEY = 'lineweb_admin_sidebar_collapsed'

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const { bgUrl, bgType, solidColor, loaded, refresh } = useWallpaper()
  const location = useLocation()
  const navigate = useNavigate()

  // Mobile slide-out
  const [mobileOpen, setMobileOpen] = useState(false)
  // Desktop collapse (persisted)
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true'
  })
  const sidebarRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const [refreshing, setRefreshing] = useState(false)

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

  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.classList.add('admin-menu-open')
    } else {
      document.body.classList.remove('admin-menu-open')
    }
    return () => document.body.classList.remove('admin-menu-open')
  }, [mobileOpen])

  // Close mobile sidebar on outside click
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
    <div className="admin-layout">
      {/* Mobile overlay */}
      {mobileOpen && <div className="admin-layout-overlay" onClick={closeMobile} />}

      {/* Sidebar */}
      <aside
        ref={sidebarRef}
        className={`admin-sidebar ${mobileOpen ? 'admin-sidebar--open' : ''} ${collapsed ? 'admin-sidebar--collapsed' : ''}`}
      >
        <div className="admin-sidebar-header">
          <Link to="/admin" className="admin-sidebar-logo" onClick={closeMobile}>
            <svg className="admin-sidebar-logo-mark" width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="1" y="1" width="20" height="20" rx="6" stroke="currentColor" strokeWidth="1.5" />
              <path d="M7 11h8M11 7v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span className="admin-sidebar-logo-text">Line Web</span>
            <span className="admin-sidebar-logo-badge">管理</span>
          </Link>
        </div>

        <nav className="admin-sidebar-nav">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`admin-sidebar-link ${isActive(item.path) ? 'admin-sidebar-link--active' : ''}`}
              onClick={closeMobile}
            >
              <span className="admin-sidebar-link-icon">{item.icon}</span>
              <span className="admin-sidebar-link-label">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <button
            className="admin-sidebar-link admin-sidebar-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <span className="admin-sidebar-link-icon">{collapsed ? '▶' : '◀'}</span>
            <span className="admin-sidebar-link-label">{collapsed ? '展开' : '收起'}</span>
          </button>
          <Link to="/" className="admin-sidebar-link admin-sidebar-link--back" onClick={closeMobile}>
            <span className="admin-sidebar-link-icon">←</span>
            <span className="admin-sidebar-link-label">返回主站</span>
          </Link>
        </div>
      </aside>

      {/* Background */}
      {bgType === 'wallpaper' && bgUrl ? (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 0,
              background: `url(${bgUrl}) center/cover no-repeat`,
              transition: 'opacity var(--lg-transition)',
              opacity: loaded ? 1 : 0,
              transform: 'scale(1.02)',
            }}
          />
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1,
              background: 'linear-gradient(180deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.40) 50%, rgba(0,0,0,0.70) 100%)',
              opacity: loaded ? 1 : 0,
              transition: 'opacity var(--lg-transition)',
            }}
          />
        </>
      ) : (
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, background: solidColor }} />
      )}

      {/* Main content area */}
      <div className={`admin-main ${collapsed ? 'admin-main--collapsed' : ''}`}>
        {/* Top bar */}
        <header className="admin-topbar">
          <button
            ref={btnRef}
            className="admin-topbar-toggle"
            onClick={() => setMobileOpen(prev => !prev)}
            aria-label="切换菜单"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="5" x2="17" y2="5" />
              <line x1="3" y1="10" x2="17" y2="10" />
              <line x1="3" y1="15" x2="17" y2="15" />
            </svg>
          </button>

          <div className="admin-topbar-title">管理面板</div>
          <div className="admin-topbar-spacer" />

          <div className="admin-topbar-user">
            {user && (
              <>
                <span className="admin-topbar-username">{user.username}</span>
                <span className="admin-topbar-role">管理员</span>
                <button className="admin-topbar-logout" onClick={handleLogout}>退出</button>
              </>
            )}
          </div>
        </header>

        <div className="admin-content">
          <Outlet />
        </div>
      </div>

      {/* Wallpaper refresh button */}
      <button
        className={`admin-wallpaper-refresh ${refreshing ? 'refreshing' : ''}`}
        onClick={() => { setRefreshing(true); refresh(); setTimeout(() => setRefreshing(false), 1000) }}
        aria-label="切换壁纸" title="切换壁纸"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </div>
  )
}
