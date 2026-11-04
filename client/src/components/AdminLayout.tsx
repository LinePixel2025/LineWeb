import { memo, useState, useRef, useEffect } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { Button } from './ui'
import { AdminCapabilityRoute } from './Guards'
import { canAccessAdminPath } from '../lib/permissions'
import { FEATURE_KEYS, type FeatureKey } from '../lib/features'
import api from '../lib/api'
import Icon, { type IconName } from './ui/Icon'
import { onMediaQueryChange } from '../lib/mediaQuery'

/** 导航项可见性由 lib/permissions.ts 的 ADMIN_ROUTE_CAPABILITIES 决定（与路由守卫同源）；
 * 分组仅影响侧边栏展示，能力过滤与守卫仍按 path 单项判定 */
interface AdminNavItem { path: string; label: string; icon: IconName; showPendingBadge?: boolean }

const adminNavSections: { title: string; items: AdminNavItem[] }[] = [
  {
    title: '内容',
    items: [
      { path: '/admin', label: '内容管理', icon: 'book' },
    ],
  },
  {
    title: '用户',
    items: [
      { path: '/admin/users', label: '用户与设备', icon: 'users', showPendingBadge: true },
      { path: '/admin/chat', label: '聊天治理', icon: 'message' },
    ],
  },
  {
    title: 'AI',
    items: [
      { path: '/admin/ai', label: 'AI 设置', icon: 'sparkles' },
    ],
  },
  {
    title: '运营',
    items: [
      { path: '/admin/points', label: '积分体系', icon: 'coin' },
      { path: '/admin/crisis', label: 'Lineweb 危机', icon: 'wallet' },
      { path: '/admin/company', label: '公司', icon: 'users' },
    ],
  },
  {
    title: '平台',
    items: [
      { path: '/admin/features', label: '功能开关', icon: 'toggles' },
      { path: '/admin/apps', label: '应用授权', icon: 'shield' },
      { path: '/admin/proxy', label: '网页反代', icon: 'globe' },
      { path: '/admin/api', label: 'API 接入', icon: 'api' },
    ],
  },
]

/** 顶栏页面标题：编辑器/个人空间等非导航路由显式映射，其余按导航项匹配 */
function pageTitleForPathname(pathname: string): string {
  if (pathname === '/admin/new') return '写文章'
  if (pathname.startsWith('/admin/edit/')) return '编辑文章'
  if (pathname === '/admin/pages/new') return '新建页面'
  if (/^\/admin\/pages\/\d+\/edit$/.test(pathname)) return '编辑页面'
  if (pathname === '/personal-space') return '个人空间'
  for (const section of adminNavSections) {
    for (const item of section.items) {
      const matched = item.path === '/admin' ? pathname === '/admin' : pathname.startsWith(item.path)
      if (matched) return item.label
    }
  }
  return '管理面板'
}

const SIDEBAR_COLLAPSED_KEY = 'lineweb_admin_sidebar_collapsed'

export default memo(function AdminLayout() {
  const { user, logout } = useAuth()
  const { refresh: refreshFeatures } = useFeature()
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
  const [pendingUsers, setPendingUsers] = useState(0)
  const [featureMap, setFeatureMap] = useState<Record<FeatureKey, boolean> | null>(null)
  const [featureBusy, setFeatureBusy] = useState(false)

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

  const canManageFeatures = canAccessAdminPath(user, '/admin/features')
  const allFeaturesEnabled = !!featureMap && FEATURE_KEYS.every((key) => featureMap[key] !== false)

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

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // ≤1279px 为抽屉模式：视口跨回桌面档（≥1280px）时复位抽屉状态，
  // 避免旋转/缩放后抽屉与遮罩在桌面布局中残留
  useEffect(() => {
    return onMediaQueryChange('(max-width: 1279px)', (matches) => {
      if (!matches) setMobileOpen(false)
    })
  }, [])

  useEffect(() => {
    if (!canAccessAdminPath(user, '/admin/users')) return
    let cancelled = false
    api.get<{ pending: number }>('/users/pending-count', { noRedirect: true })
      .then((data) => { if (!cancelled) setPendingUsers(data.pending ?? 0) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user, location.pathname])

  // 一键开关按钮的状态来源；拉取失败静默降级为「不渲染按钮」——开关状态未知时不提供
  // 一键批量操作（避免按错误的假定价执行全站关闭），管理员仍可用功能开关页逐个调整
  useEffect(() => {
    if (!canManageFeatures) return
    let cancelled = false
    api.get<{ features: Record<FeatureKey, boolean> }>('/admin/features', { noRedirect: true })
      .then((data) => { if (!cancelled) setFeatureMap(data.features ?? null) })
      .catch(() => { if (!cancelled) setFeatureMap(null) })
    return () => { cancelled = true }
  }, [canManageFeatures, location.pathname])

  const handleToggleAllFeatures = () => {
    if (!featureMap || featureBusy) return
    const enabled = !allFeaturesEnabled
    const confirmed = window.confirm(enabled
      ? '确认一键开启全部功能？所有功能开关将恢复为开启状态。'
      : '确认一键关闭网站全部功能？关闭后普通用户将无法使用文章、聊天、游戏等全部功能（管理员不受影响），可随时回到这里一键恢复。')
    if (!confirmed) return
    setFeatureBusy(true)
    api.put<{ features: Record<FeatureKey, boolean> }>('/admin/features/all', { enabled })
      .then((data) => {
        setFeatureMap(data.features)
        void refreshFeatures() // 立即刷新全站开关状态，导航与页面同步生效
      })
      .catch((err) => {
        window.alert(err instanceof Error ? err.message : '批量更新功能开关失败')
      })
      .finally(() => setFeatureBusy(false))
  }

  useEffect(() => {
    if (!mobileOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [mobileOpen])

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="gh-layout-root gh-layout-root--admin">
      {/* Mobile overlay（display 由 responsive.css 在 ≤1279px 抽屉模式下控制，
          不写内联 style——否则视口跨断点残留时内联样式会压过媒体查询） */}
      {mobileOpen && (
        <div className="gh-sidebar-overlay" onClick={closeMobile} />
      )}

      {/* Admin sidebar */}
      <aside
        ref={sidebarRef}
        className={`gh-sidebar ${mobileOpen ? 'gh-sidebar--open' : ''} ${collapsed ? 'gh-sidebar--collapsed' : ''}`}
      >
        <div className="gh-sidebar-brand">
          <Link to="/admin" className="gh-sidebar-brand-link" onClick={closeMobile}>
            <Icon name="logo" size={22} />
            <span className="gh-sidebar-brand-name">LineWeb</span>
          </Link>
          <button className="gh-sidebar-close" onClick={closeMobile} aria-label="关闭导航菜单">
            <Icon name="close" size={16} />
          </button>
          {canManageFeatures && featureMap && (
            <button
              type="button"
              className={`gh-sidebar-feature-toggle ${allFeaturesEnabled ? 'gh-sidebar-feature-toggle--danger' : ''}`}
              onClick={handleToggleAllFeatures}
              disabled={featureBusy}
              title={allFeaturesEnabled ? '一键关闭全部功能' : '一键开启全部功能'}
              aria-label={allFeaturesEnabled ? '一键关闭全部功能' : '一键开启全部功能'}
            >
              <Icon name="power" size={16} />
              <span className="gh-sidebar-label">{allFeaturesEnabled ? '一键关闭' : '一键开启'}</span>
            </button>
          )}
        </div>

        <nav className="gh-sidebar-nav">
          {adminNavSections.map(section => {
            const visibleItems = section.items.filter(item => canAccessAdminPath(user, item.path))
            if (visibleItems.length === 0) return null
            return (
              <div key={section.title} className="gh-sidebar-section">
                <div className="gh-sidebar-section-title">{section.title}</div>
                {visibleItems.map(item => (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`gh-sidebar-item ${isActive(item.path) ? 'gh-sidebar-item--active' : ''}`}
                    onClick={closeMobile}
                  >
                    <span className="gh-sidebar-icon"><Icon name={item.icon} size={18} /></span>
                    <span className="gh-sidebar-label">{item.label}</span>
                    {item.showPendingBadge && pendingUsers > 0 && (
                      <span className="gh-chat-nav-badge">{pendingUsers > 99 ? '99+' : pendingUsers}</span>
                    )}
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="gh-sidebar-footer">
          <button
            className="gh-sidebar-collapse-btn gh-sidebar-item"
            onClick={() => {
              // 抽屉模式下「收起」语义是关闭抽屉；桌面模式保持折叠/展开切换
              if (mobileOpen) {
                closeMobile()
                return
              }
              toggleCollapsed()
            }}
          >
            <span className="gh-sidebar-icon">
              <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} />
            </span>
            <span className="gh-sidebar-label">{collapsed ? '展开' : '收起'}</span>
          </button>
          <Link to="/" className="gh-sidebar-item gh-sidebar-back" onClick={closeMobile}>
            <span className="gh-sidebar-icon">
              <Icon name="home" size={18} />
            </span>
            <span className="gh-sidebar-label">返回主站</span>
          </Link>
        </div>
      </aside>


      {/* Main content area */}
      <div className={`gh-content ${collapsed ? 'gh-content--collapsed' : ''}`}>
        {/* Top bar：吸顶毛玻璃工具条 */}
        <header className="gh-admin-toolbar">
          <button
            ref={btnRef}
            className="gh-btn gh-btn--secondary gh-btn--sm gh-visible-mobile"
            onClick={() => setMobileOpen(prev => !prev)}
            aria-label="切换菜单"
          >
            <Icon name="menu" size={17} />
          </button>

          <div className="gh-admin-topbar-crumbs">
            <span className="gh-admin-topbar-root">管理</span>
            <Icon name="chevron-right" size={12} />
            <h1 className="gh-admin-topbar-title">{pageTitleForPathname(location.pathname)}</h1>
          </div>

          <div className="gh-admin-toolbar-spacer" />

          <div className="gh-admin-toolbar-actions">
            {user && (
              <>
                <span className="gh-text-secondary gh-admin-topbar-username">{user.username}</span>
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                  退出
                </Button>
              </>
            )}
          </div>
        </header>

        <div className="gh-page-container">
          {/* 按当前路径所需能力守卫：缺能力时重定向到该账号可访问的第一个管理页 */}
          <AdminCapabilityRoute>
            <Outlet />
          </AdminCapabilityRoute>
        </div>
      </div>
    </div>
  )
})
