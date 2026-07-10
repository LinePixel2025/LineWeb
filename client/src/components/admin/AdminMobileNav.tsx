import { Link, useLocation, useNavigate } from 'react-router-dom'

const mainTabs = [
  { path: '/admin', label: '文章', icon: '📝' },
  { path: '/admin/comments', label: '评论', icon: '📬' },
]

const moreItems = [
  { path: '/admin/new', label: '写文章', icon: '✏️' },
  { path: '/admin/pages', label: '页面管理', icon: '📄' },
  { path: '/admin/users', label: '用户管理', icon: '👤' },
  { path: '/admin/api', label: 'API 密钥', icon: '🔑' },
  { path: '/admin/devices', label: '设备监控', icon: '📡' },
]

export function AdminBottomTabBar({ onMoreClick }: { onMoreClick: () => void }) {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin'
    return location.pathname.startsWith(path)
  }

  return (
    <nav className="admin-bottom-tab-bar">
      {mainTabs.map(tab => (
        <Link
          key={tab.path}
          to={tab.path}
          className={`admin-tab-item ${isActive(tab.path) ? 'admin-tab-item--active' : ''}`}
        >
          <span className="admin-tab-icon">{tab.icon}</span>
          <span className="admin-tab-label">{tab.label}</span>
        </Link>
      ))}
      <button className="admin-tab-item" onClick={onMoreClick}>
        <span className="admin-tab-icon">⋯</span>
        <span className="admin-tab-label">更多</span>
      </button>
    </nav>
  )
}

export function AdminMoreMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()

  if (!open) return null

  const handleClick = (path: string) => {
    navigate(path)
    onClose()
  }

  return (
    <div className="admin-more-overlay" onClick={onClose}>
      <div className="admin-more-menu" onClick={e => e.stopPropagation()}>
        <div className="admin-more-header">
          <span>更多功能</span>
          <button className="admin-more-close" onClick={onClose}>✕</button>
        </div>
        <div className="admin-more-list">
          {moreItems.map(item => (
            <button
              key={item.path}
              className="admin-more-item"
              onClick={() => handleClick(item.path)}
            >
              <span className="admin-more-item-icon">{item.icon}</span>
              <span className="admin-more-item-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
