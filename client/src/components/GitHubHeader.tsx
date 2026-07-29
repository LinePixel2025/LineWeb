import { memo, useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import UserAvatar from './UserAvatar'

const navItems = [
  { path: '/', label: 'Overview' },
  { path: '/posts', label: 'Repositories' },
  { path: '/drive', label: 'Drive' },
  { path: '/features', label: 'About' },
]

interface Props {
  onMenuToggle: () => void
}

export default memo(function GitHubHeader({ onMenuToggle }: Props) {
  const { user, isAdmin, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen])

  const themeIcon = theme === 'auto' ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0a8 8 0 1 0 8 8A8.013 8.013 0 0 0 8 0Zm0 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z"/>
    </svg>
  ) : theme === 'dark' ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278Z"/>
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.657-8.157a.75.75 0 0 1 0 1.061l-1.061 1.06a.749.749 0 0 1-1.06-1.06l1.06-1.061a.75.75 0 0 1 1.061 0Zm-9.193 9.193a.75.75 0 0 1 0 1.061l-1.06 1.061a.75.75 0 1 1-1.061-1.061l1.06-1.061a.75.75 0 0 1 1.061 0ZM16 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8ZM2.25 8a.75.75 0 0 1-.75.75H0a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 .75.75Zm-.154-4.404a.749.749 0 0 1 1.061 0l1.06 1.06a.75.75 0 1 1-1.06 1.061l-1.061-1.061a.75.75 0 0 1 0-1.06Z"/>
    </svg>
  )

  const LogoutButton = () => (
    <button
      className="gh-popover-item"
      onClick={() => { setUserMenuOpen(false); logout() }}
    >
      Sign out
    </button>
  )

  return (
    <header className="gh-header">
      <div className="gh-header-inner">
        <button className="gh-header-menu-btn gh-visible-mobile" onClick={onMenuToggle} aria-label="Toggle menu">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H1.75Z"/>
          </svg>
        </button>
        <Link to="/" className="gh-header-logo">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="var(--gh-accent)" aria-hidden="true">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.46-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
          </svg>
          <span className="gh-hidden-tablet">Line Web</span>
        </Link>
        <nav className="gh-header-nav gh-hidden-mobile">
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`gh-header-link ${location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path)) ? 'gh-header-link--active' : ''}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="gh-header-spacer" />
        <div className="gh-header-actions">
          <button className="gh-btn gh-btn--ghost gh-btn--sm" onClick={toggleTheme} title={`Theme: ${theme}`} aria-label="Toggle theme">
            {themeIcon}
          </button>
          {user ? (
            <div ref={menuRef} style={{ position: 'relative' }}>
              <button className="gh-header-user-btn" onClick={() => setUserMenuOpen(prev => !prev)}>
                <UserAvatar userId={user.id} username={user.username} size="sm" />
                <span className="gh-hidden-mobile gh-header-username">{user.username}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" className="gh-hidden-mobile">
                  <path d="M6 8.825a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 0 1 1.06-1.06L6 6.939l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-.53.22Z"/>
                </svg>
              </button>
              {userMenuOpen && (
                <div className="gh-popover" style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4 }}>
                  <Link to="/profile" className="gh-popover-item" onClick={() => setUserMenuOpen(false)}>Profile</Link>
                  {isAdmin && <Link to="/admin" className="gh-popover-item" onClick={() => setUserMenuOpen(false)}>Admin</Link>}
                  <div className="gh-popover-divider" />
                  <button className="gh-popover-item" onClick={() => { setUserMenuOpen(false); logout() }}>Sign out</button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="gh-btn gh-btn--secondary gh-btn--sm">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  )
})
