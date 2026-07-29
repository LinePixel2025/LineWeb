import { memo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import GitHubHeader from './GitHubHeader'
import GitHubSidebar from './GitHubSidebar'

export default memo(function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="gh-layout-root">
      <GitHubHeader onMenuToggle={() => setMobileOpen(prev => !prev)} />
      <GitHubSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed(prev => !prev)}
      />
      <main className={`gh-content ${collapsed ? 'gh-content--collapsed' : ''}`}>
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
