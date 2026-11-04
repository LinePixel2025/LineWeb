import { memo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { useXmppChat } from '../contexts/XmppChatContext'
import { useOptionalCrisis } from '../contexts/CrisisContext'
import { formatUnread } from '../lib/chat'
import { canAccessAdminPath } from '../lib/permissions'
import Icon, { type IconName } from './ui/Icon'

interface Props {
  collapsed: boolean
  mobileOpen: boolean
  onClose: () => void
  onToggleCollapse: () => void
}

interface SidebarItem { path: string; label: string; icon: IconName }

const sections: { title: string; requireAuth?: boolean; items: SidebarItem[] }[] = [
  {
    title: '首页',
    items: [
      { path: '/', label: '概览', icon: 'home' },
    ],
  },
  {
    title: '管理',
    requireAuth: true,
    items: [
      { path: '/admin', label: '管理面板', icon: 'dashboard' },
    ],
  },
  {
    title: '探索',
    items: [
      { path: '/posts', label: '文章', icon: 'book' },
      { path: '/drive', label: '网盘', icon: 'folder' },
      { path: '/features', label: '关于', icon: 'compass' },
      { path: '/games', label: '游戏', icon: 'gamepad' },
      { path: '/pets', label: '宠物', icon: 'paw' },
      { path: '/lottery', label: '积分抽奖', icon: 'gift' },
      { path: '/stocks', label: '模拟股市', icon: 'chart' },
      { path: '/bank', label: '银行', icon: 'bank' },
      { path: '/company', label: '公司', icon: 'users' },
      { path: '/crisis', label: 'Lineweb 危机', icon: 'wallet' },
      { path: '/reader', label: '小说', icon: 'bookOpen' },
      { path: '/music', label: '音乐', icon: 'music' },
    ],
  },
  {
    title: '个人',
    items: [
      { path: '/chat', label: '聊天', icon: 'chat' },
      { path: '/points', label: '积分中心', icon: 'coin' },
      { path: '/themes', label: 'LineWeb 主题', icon: 'palette' },
      { path: '/deepseek', label: 'AI 对话', icon: 'sparkles' },
      { path: '/webproxy', label: '网页反代', icon: 'globe' },
      { path: '/profile', label: '个人资料', icon: 'user' },
    ],
  },
]

export default memo(function Sidebar({ collapsed, mobileOpen, onClose, onToggleCollapse }: Props) {
  const { user } = useAuth()
  const { isEnabled } = useFeature()
  const { unreadTotal } = useXmppChat()
  const crisis = useOptionalCrisis()
  const crisisPending = !!crisis?.state && crisis.state.enabled && !crisis.state.exempt && crisis.state.status !== 'clear'
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
            <Icon name="logo" size={22} />
            <span className="gh-sidebar-brand-name">LineWeb</span>
          </Link>
          <button className="gh-sidebar-close" onClick={onClose} aria-label="关闭导航菜单">
            <Icon name="close" size={16} />
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
              if (item.path === '/bank' && (!user || !isEnabled('bank'))) return false
              if (item.path === '/crisis' && (!user || crisis?.state?.enabled === false)) return false
              if (item.path === '/pets' && (!user || !isEnabled('pet'))) return false
              if (item.path === '/lottery' && (!user || !isEnabled('lottery'))) return false
              if (item.path === '/themes' && (!user || !isEnabled('theme'))) return false
              if (item.path === '/reader' && (!user || !isEnabled('reader'))) return false
              if (item.path === '/music' && (!user || !isEnabled('music'))) return false
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
                    <Icon name={item.icon} size={18} className="gh-sidebar-icon" />
                    <span className="gh-sidebar-label">{item.label}</span>
                    {item.path === '/chat' && chatUnreadLabel && (
                      <span className="gh-chat-nav-badge" aria-label={`${unreadTotal} 条未读消息`}>
                        {chatUnreadLabel}
                      </span>
                    )}
                    {item.path === '/crisis' && crisisPending && (
                      <span className="gh-crisis-nav-dot" aria-label="危机积分待缴" title="有待缴的危机积分" />
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
            <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} size={18} className="gh-sidebar-icon" />
            <span className="gh-sidebar-label">{collapsed ? '展开' : '收起'}</span>
          </button>
        </div>
      </aside>
    </>
  )
})
