import { useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

const mainTabs = [
  { path: '/admin', label: '文章', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75A.75.75 0 01.75 1h4.253c1.227 0 2.317.59 3 1.501A3.744 3.744 0 0111.006 1h4.245a.75.75 0 01.75.75v10.5a.75.75 0 01-.75.75h-4.507a2.25 2.25 0 00-1.591.659l-.622.621a.75.75 0 01-1.06 0l-.622-.621A2.25 2.25 0 005.258 13H.75a.75.75 0 01-.75-.75V1.75zm8.755 3a3 3 0 01-2.154.886H1.5V11.5h3.753a3.73 3.73 0 012.502 1.067V4.75zm1.5 0v7.817A3.73 3.73 0 0112.747 11.5h3.253V2.5H10.9a3.745 3.745 0 00-2.645 1.136z"/></svg>
  )},
  { path: '/admin/comments', label: '评论', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0113.25 12H9.06l-2.573 2.573A1.457 1.457 0 014 13.543V12H2.75A1.75 1.75 0 011 10.25v-7.5zM2.75 2.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 01.75.75v2.19l2.72-2.72a.75.75 0 01.53-.22h4.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25H2.75z"/></svg>
  )},
]

const moreItems = [
  { path: '/admin/new', label: '写文章', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25a1.75 1.75 0 01.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354l-1.086-1.086zM11.189 6.25L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064l6.286-6.286z"/></svg>
  )},
  { path: '/admin/pages', label: '页面管理', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v12.5A1.75 1.75 0 0114.25 16H1.75A1.75 1.75 0 010 14.25V1.75zM1.75 1.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V1.75a.25.25 0 00-.25-.25H1.75zM4 4.75A.75.75 0 014.75 4h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 4.75zm0 3a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 7.75zm0 3a.75.75 0 01.75-.75h3.5a.75.75 0 010 1.5h-3.5a.75.75 0 01-.75-.75z"/></svg>
  )},
  { path: '/admin/users', label: '用户管理', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.561 8.073a6.005 6.005 0 013.005 5.177.75.75 0 01-1.5 0 4.505 4.505 0 00-1.4-3.22.75.75 0 01.987-1.135 5.997 5.997 0 01-1.092-.822zM5.44 8.073a6.005 6.005 0 00-3.005 5.177.75.75 0 001.5 0 4.505 4.505 0 011.4-3.22.75.75 0 00-.987-1.135 5.997 5.997 0 001.092-.822zM8 1.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM6 5a2 2 0 114 0 2 2 0 01-4 0z"/></svg>
  )},
  { path: '/admin/api', label: 'API 密钥', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M10.28 2.22a.75.75 0 011.06 0l2.44 2.44a.75.75 0 010 1.06l-6.5 6.5a.75.75 0 01-.4.204l-3 .5a.75.75 0 01-.846-.846l.5-3a.75.75 0 01.204-.4l6.5-6.5zM11 3.53l-6.22 6.22-.424 2.546 2.546-.424L13.12 5.65 11 3.53zm1.56-.5l1.06 1.06a.75.75 0 010 1.06l-.97.97-1.06-1.06.97-.97zM4.37 1.657a.75.75 0 00-.869.12L.22 5.06a.75.75 0 000 1.06l2.72 2.72a.75.75 0 001.06 0l2.72-2.72a.75.75 0 000-1.06l-.72-.72.72-.72a.75.75 0 000-1.06L5.5 1.72a.75.75 0 00-1.13-.063zm-.47 2.912L3.06 5.41l.72.72-1.78 1.78L1.22 7.13 3.9 4.57zm0-1.06L3.06 3.35l.72.72-1.78 1.78L1.22 5.07 3.9 2.51z"/></svg>
  )},
  { path: '/admin/devices', label: '设备监控', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M4.75 0A2.75 2.75 0 002 2.75v5.5A2.75 2.75 0 004.75 11h2.5v2H5.5a.75.75 0 000 1.5h5a.75.75 0 000-1.5h-1.75v-2h2.5A2.75 2.75 0 0014 8.25v-5.5A2.75 2.75 0 0011.25 0h-6.5zM3.5 2.75c0-.69.56-1.25 1.25-1.25h6.5c.69 0 1.25.56 1.25 1.25v5.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-5.5z"/></svg>
  )},
  { path: '/admin/ai', label: 'AI 助手', icon: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 110 16A8 8 0 018 0zm0 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zm0 7.75a.75.75 0 01.75.75v1.25h.5a.75.75 0 010 1.5h-2.5a.75.75 0 010-1.5h.5V10a.75.75 0 01.75-.75zM8 4a1.5 1.5 0 110 3 1.5 1.5 0 010-3z"/></svg>
  )},
]

export function AdminBottomTabBar({ onMoreClick }: { onMoreClick: () => void }) {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin'
    return location.pathname.startsWith(path)
  }

  return (
    <nav style={{
      display: 'none',
      position: 'fixed', bottom: 0, left: 0, right: 0,
      height: '56px',
      background: 'var(--gh-canvas)',
      borderTop: '1px solid var(--gh-border)',
      zIndex: 300,
      paddingBottom: 'var(--gh-safe-bottom)',
    }}
      className="gh-visible-mobile"
      aria-label="管理面板导航"
    >
      <div style={{ display: 'flex', height: '100%' }}>
        {mainTabs.map(tab => (
          <Link
            key={tab.path}
            to={tab.path}
            style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: '2px', textDecoration: 'none',
              color: isActive(tab.path) ? 'var(--gh-accent)' : 'var(--gh-text-tertiary)',
              fontSize: 'var(--gh-text-xs)', fontWeight: 500,
              borderTop: isActive(tab.path) ? '2px solid var(--gh-accent)' : '2px solid transparent',
              marginTop: '-1px',
              transition: 'color var(--gh-transition), border-color var(--gh-transition)',
            }}
            aria-current={isActive(tab.path) ? 'page' : undefined}
          >
            <span style={{ display: 'flex' }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </Link>
        ))}
        <button
          onClick={onMoreClick}
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: '2px', background: 'none', border: 'none',
            color: 'var(--gh-text-tertiary)', fontSize: 'var(--gh-text-xs)',
            fontFamily: 'var(--gh-font)', fontWeight: 500, cursor: 'pointer',
            borderTop: '2px solid transparent', marginTop: '-1px',
            padding: 0,
          }}
        >
          <span style={{ display: 'flex' }}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM1.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3zm13 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
            </svg>
          </span>
          <span>更多</span>
        </button>
      </div>
    </nav>
  )
}

export function AdminMoreMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const handleClick = (path: string) => {
    navigate(path)
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: 'rgba(31, 35, 40, 0.4)',
      }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="更多功能"
    >
      <div
        style={{
          background: 'var(--gh-canvas)',
          border: '1px solid var(--gh-border)',
          borderRadius: 'var(--gh-radius) var(--gh-radius) 0 0',
          width: '100%', maxWidth: '480px',
          maxHeight: '70vh',
          overflow: 'auto',
          padding: 'var(--gh-space-3)',
          paddingBottom: 'calc(var(--gh-space-3) + var(--gh-safe-bottom))',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--gh-space-2) var(--gh-space-3)',
          marginBottom: 'var(--gh-space-2)',
          fontWeight: 600, fontSize: 'var(--gh-text-sm)',
        }}>
          <span>更多功能</span>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--gh-text-tertiary)', fontSize: 'var(--gh-text-base)',
              padding: '4px', borderRadius: 'var(--gh-radius)',
            }}
            aria-label="关闭"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {moreItems.map(item => (
            <button
              key={item.path}
              onClick={() => handleClick(item.path)}
              className="gh-sidebar-item"
              style={{
                width: '100%', textAlign: 'left',
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'var(--gh-font)',
              }}
            >
              <span className="gh-sidebar-icon">{item.icon}</span>
              <span className="gh-sidebar-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
