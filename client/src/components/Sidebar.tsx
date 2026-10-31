import { memo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { useXmppChat } from '../contexts/XmppChatContext'
import { formatUnread } from '../lib/chat'
import { canAccessAdminPath } from '../lib/permissions'

interface Props {
  collapsed: boolean
  mobileOpen: boolean
  onClose: () => void
  onToggleCollapse: () => void
}

interface SidebarItem { path: string; label: string }

function SidebarIcon({ path }: { path: string }) {
  const icon = path.startsWith('/admin') ? <><rect x="2.5" y="2.5" width="11" height="11" rx="2.5" /><path d="M2.5 6.25h11" /><path d="M5.25 9h5.5" /><path d="M5.25 11.25h3" /></>
    : path === '/' ? <><rect x="3" y="3" width="10" height="10" rx="2" /><path d="M5.5 10 7.5 8l1.5 1.5L11.5 6" /></>
    : path === '/posts' ? <><path d="M3.5 3.5h8a1.5 1.5 0 0 1 1.5 1.5v7.5h-8A1.5 1.5 0 0 0 3.5 14z" /><path d="M3.5 3.5v10.5M6 6.5h4M6 9h4" /></>
    : path === '/drive' ? <path d="M2.5 5.5A1.5 1.5 0 0 1 4 4h3l1.2 1.5H12A1.5 1.5 0 0 1 13.5 7v5A1.5 1.5 0 0 1 12 13.5H4A1.5 1.5 0 0 1 2.5 12z" />
    : path === '/chat' ? <><path d="M8 2.75c-3.1 0-5.5 2.1-5.5 4.7 0 1.4.72 2.62 1.87 3.44l-.57 2.11 2.35-1.1c.58.17 1.2.26 1.85.26 3.1 0 5.5-2.1 5.5-4.71S11.1 2.75 8 2.75Z" /></>
    : path === '/deepseek' ? <><path d="M8 2.75c-3.1 0-5.5 2.1-5.5 4.7 0 1.4.72 2.62 1.87 3.44l-.57 2.11 2.35-1.1c.58.17 1.2.26 1.85.26 3.1 0 5.5-2.1 5.5-4.71S11.1 2.75 8 2.75Z" /><path d="m8 5.35-.66 1.53-1.53.66 1.53.66.66 1.53.66-1.53 1.53-.66-1.53-.66z" fill="currentColor" stroke="none" /></>
    : path === '/features' ? <><circle cx="8" cy="8" r="5" /><path d="m9.8 6.2-1 2.6-2.6 1 1-2.6z" /></>
    : path === '/webproxy' ? <><circle cx="8" cy="8" r="5.5" /><path d="M2.5 8h11M8 2.5c1.7 1.8 2.5 3.6 2.5 5.5S9.7 11.7 8 13.5C6.3 11.7 5.5 9.9 5.5 8s.8-3.7 2.5-5.5Z" /></>
    : path === '/games' ? <><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h5A2.5 2.5 0 0 1 13 7.5v1A2.5 2.5 0 0 1 10.5 11h-5A2.5 2.5 0 0 1 3 8.5z" /><path d="M5 8h2M6 7v2" /><circle cx="10.5" cy="7.5" r=".45" fill="currentColor" stroke="none" /><circle cx="11.5" cy="9" r=".45" fill="currentColor" stroke="none" /></>
    : path === '/points' ? <><circle cx="8" cy="8" r="5.5" /><path d="M8 4.75v6.5M10.25 6.25H7.5a1.25 1.25 0 0 0 0 2.5h1a1.25 1.25 0 0 1 0 2.5H5.75" /></>
    : path === '/stocks' ? <><path d="M2 13.5h12" /><path d="M2.75 10.75 6 7.5l2.5 2 4.25-5" /><path d="M10.5 4.5h2.5V7" /></>
    : path === '/pets' ? <g fill="currentColor" stroke="none"><ellipse cx="8" cy="10.6" rx="3.3" ry="2.7" /><circle cx="4.2" cy="7.3" r="1.25" /><circle cx="8" cy="5.9" r="1.25" /><circle cx="11.8" cy="7.3" r="1.25" /></g>
    : <><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13a4.5 4.5 0 0 1 9 0" /></>

  return <svg className="gh-sidebar-icon" width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon}</svg>
}

const sections: { title: string; requireAuth?: boolean; items: SidebarItem[] }[] = [
  {
    title: '首页',
    items: [
      { path: '/', label: '概览' },
    ],
  },
  {
    title: '管理',
    requireAuth: true,
    items: [
      { path: '/admin', label: '管理面板' },
    ],
  },
  {
    title: '探索',
    items: [
      { path: '/posts', label: '文章' },
      { path: '/drive', label: '网盘' },
      { path: '/features', label: '关于' },
      { path: '/games', label: '游戏' },
      { path: '/pets', label: '宠物' },
      { path: '/stocks', label: '模拟股市' },
    ],
  },
  {
    title: '个人',
    items: [
      { path: '/chat', label: '聊天' },
      { path: '/points', label: '积分中心' },
      { path: '/deepseek', label: 'AI 对话' },
      { path: '/webproxy', label: '网页反代' },
      { path: '/profile', label: '个人资料' },
    ],
  },
]

export default memo(function Sidebar({ collapsed, mobileOpen, onClose, onToggleCollapse }: Props) {
  const { user } = useAuth()
  const { isEnabled } = useFeature()
  const { unreadTotal } = useXmppChat()
  const location = useLocation()
  const chatUnreadLabel = formatUnread(unreadTotal)

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <>
      {mobileOpen && <div className="gh-sidebar-overlay" onClick={onClose} />}
      <aside
        className={`gh-sidebar ${collapsed ? 'gh-sidebar--collapsed' : ''} ${mobileOpen ? 'gh-sidebar--open' : ''}`}
        aria-label="主导航"
      >
        {/* 抽屉模式下的品牌行 + 关闭按钮（桌面端隐藏，桌面品牌在顶栏） */}
        <div className="gh-sidebar-brand gh-sidebar-brand--drawer">
          <Link to="/" className="gh-sidebar-brand-link" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2h7L19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5z" />
              <path d="M14 2v5h5M8.5 11h7M8.5 15h4" />
            </svg>
            <span className="gh-sidebar-brand-name">LineWeb</span>
          </Link>
          <button className="gh-sidebar-close" onClick={onClose} aria-label="关闭导航菜单">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <nav className="gh-sidebar-nav">
          {sections.map(section => {
            if (section.requireAuth && !user) return null
            const visibleItems = section.items.filter(item => {
              // 全站需登录：未登录时除首页外不展示任何业务入口
              if (!user && item.path !== '/') return false
              if (item.path.startsWith('/admin') && !canAccessAdminPath(user, item.path)) return false
              if (item.path.startsWith('/profile') && !user) return false
              if (item.path.startsWith('/chat') && (!user || !isEnabled('chat'))) return false
              if (item.path.startsWith('/deepseek') && (!user || !isEnabled('aiChat'))) return false
              if (item.path.startsWith('/webproxy') && (!user || !isEnabled('webProxy'))) return false
              if (item.path === '/posts' && !isEnabled('posts')) return false
              if (item.path === '/drive' && !isEnabled('drive')) return false
              if (item.path === '/features' && !isEnabled('pages')) return false
              if (item.path === '/games' && !isEnabled('games')) return false
              if (item.path === '/stocks' && (!user || !isEnabled('stock'))) return false
              if (item.path === '/pets' && (!user || !isEnabled('pet'))) return false
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
                    className={`gh-sidebar-item ${isActive(item.path) ? 'gh-sidebar-item--active' : ''} ${item.path === '/chat' ? 'gh-chat-nav-item' : ''}`}
                    aria-current={isActive(item.path) ? 'page' : undefined}
                    onClick={onClose}
                  >
                    <SidebarIcon path={item.path} />
                    <span className="gh-sidebar-label">{item.label}</span>
                    {item.path === '/chat' && chatUnreadLabel && (
                      <span className="gh-chat-nav-badge" aria-label={`${unreadTotal} 条未读消息`}>
                        {chatUnreadLabel}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="gh-sidebar-footer">
          <button
            className="gh-sidebar-item gh-sidebar-collapse-btn"
            onClick={() => {
              // ≤1279px 为抽屉模式：此时桌面折叠无视觉意义（宽度/标签均被 --open 覆盖），
              // 「收起」语义应为关闭抽屉；≥1280px 保持折叠/展开切换
              if (window.matchMedia('(max-width: 1279px)').matches) {
                onClose()
                return
              }
              onToggleCollapse()
            }}
            title={collapsed ? '展开侧栏' : '收起侧栏'}
            aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
          >
            <svg className="gh-sidebar-icon" width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={collapsed ? 'm6 3.5 4 4.5-4 4.5' : 'm10 3.5-4 4.5 4 4.5'} />
            </svg>
            <span className="gh-sidebar-label">{collapsed ? '展开' : '收起'}</span>
          </button>
        </div>
      </aside>
    </>
  )
})
