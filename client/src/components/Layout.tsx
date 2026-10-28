import { memo, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import GitHubHeader from './GitHubHeader'
import GitHubSidebar from './GitHubSidebar'

export default memo(function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()
  // 聊天页需要「整页固定高度 + 内部滚动」的外壳：用显式类名而不是 :has()，
  // 避免旧内核（不支持 :has）下页脚把整页撑高
  const isChatRoute = location.pathname === '/chat' || location.pathname.startsWith('/chat/')
  // 反代查看页铺满内容区（列表页 /webproxy 仍用普通页面布局）
  const isProxyViewRoute = /^\/webproxy\/\d+/.test(location.pathname)

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

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

  return (
    <div className="gh-layout-root">
      <GitHubHeader onMenuToggle={() => setMobileOpen(prev => !prev)} />
      <GitHubSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed(prev => !prev)}
      />
      <main className={`gh-content ${collapsed ? 'gh-content--collapsed' : ''} ${isChatRoute ? 'gh-content--chat' : ''} ${isProxyViewRoute ? 'gh-content--proxy' : ''}`}>
        <Outlet />
        <footer className="gh-footer">
          <div className="gh-footer-links">
            <a href="/features">About</a>
            <a href="/posts">Posts</a>
            <a href="/drive">Drive</a>
          </div>
          <p className="gh-footer-copy">© {new Date().getFullYear()} LineWeb</p>
        </footer>
      </main>
    </div>
  )
})
