import { memo, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import GitHubHeader from './GitHubHeader'
import GitHubSidebar from './GitHubSidebar'
import SiteAnnouncementBar from './SiteAnnouncementBar'
import SiteAnnouncementAckGate from './SiteAnnouncementAckGate'
import { SiteAnnouncementProvider } from '../contexts/SiteAnnouncementContext'
import { useFeature } from '../contexts/FeatureContext'
import { useAuth } from '../contexts/AuthContext'

export default memo(function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isEnabled } = useFeature()
  const { user } = useAuth()
  const location = useLocation()
  // 聊天页需要「整页固定高度 + 内部滚动」的外壳：用显式类名而不是 :has()，
  // 避免旧内核（不支持 :has）下页脚把整页撑高
  const isChatRoute = location.pathname === '/chat' || location.pathname.startsWith('/chat/')
  // 反代查看页铺满内容区（列表页 /webproxy 仍用普通页面布局）
  const isProxyViewRoute = /^\/webproxy\/\d+/.test(location.pathname)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  // ≤1279px 为抽屉模式：视口跨回桌面档（≥1280px）时复位抽屉状态，
  // 避免手机旋转/缩放窗口后抽屉在桌面布局中残留
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1279px)')
    const handleChange = (e: MediaQueryListEvent) => {
      if (!e.matches) setMobileOpen(false)
    }
    mq.addEventListener('change', handleChange)
    return () => mq.removeEventListener('change', handleChange)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    const previousOverflow = document.body.style.overflow
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleEscape)
    }
  }, [mobileOpen])

  // 反代查看页是沉浸式的：不渲染顶栏 / 侧栏 / 页脚，只保留 iframe 与左下角小浮窗
  if (isProxyViewRoute) {
    return (
      <div className="gh-layout-root gh-layout-root--immersive">
        <main className="gh-proxy-immersive">
          <Outlet />
        </main>
      </div>
    )
  }

  return (
    <SiteAnnouncementProvider>
      <div className="gh-layout-root">
        <GitHubHeader onMenuToggle={() => setMobileOpen(prev => !prev)} />
        <GitHubSidebar
          collapsed={collapsed}
          mobileOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          onToggleCollapse={() => setCollapsed(prev => !prev)}
        />
        <main className={`gh-content ${collapsed ? 'gh-content--collapsed' : ''} ${isChatRoute ? 'gh-content--chat' : ''} ${isProxyViewRoute ? 'gh-content--proxy' : ''}`}>
          <SiteAnnouncementBar />
          <SiteAnnouncementAckGate />
          <Outlet />
          <footer className="gh-footer">
            <div className="gh-footer-links">
              {user && isEnabled('pages') && <a href="/features">About</a>}
              {user && isEnabled('posts') && <a href="/posts">Posts</a>}
              {user && isEnabled('drive') && <a href="/drive">Drive</a>}
            </div>
            <p className="gh-footer-copy">© {new Date().getFullYear()} LineWeb</p>
          </footer>
        </main>
      </div>
    </SiteAnnouncementProvider>
  )
})
