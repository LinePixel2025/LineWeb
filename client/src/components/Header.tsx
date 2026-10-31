import { memo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { usePoints } from '../contexts/PointsContext'
import UserAvatar from './UserAvatar'
import UserTitleBadge from './UserTitleBadge'

interface Props {
  onMenuToggle: () => void
}

const themeIcons = {
  auto: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="currentColor" stroke="none" />
    </svg>
  ),
  dark: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278Z" />
    </svg>
  ),
  light: (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="3.4" />
      <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
    </svg>
  ),
} as const

export default memo(function Header({ onMenuToggle }: Props) {
  const { user, hasAdminAccess, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { balance: pointsBalance, title: pointsTitle, equippedLeaderTitle, leaderTitles } = usePoints()
  // 佩戴的称号优先；都没有时用首个传说称号（单机榜一）兜底展示
  const headerTitle = pointsTitle ?? equippedLeaderTitle ?? leaderTitles[0] ?? null
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!userMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [userMenuOpen])

  // 滚动后给顶栏补一层发丝阴影，避免毛玻璃与内容粘连
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`gh-header${scrolled ? ' gh-header--scrolled' : ''}`}>
      <div className="gh-header-inner">
        <button
          className="gh-header-menu-btn gh-visible-mobile"
          onClick={onMenuToggle}
          aria-label="打开导航菜单"
        >
          <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2 4.5h12M2 8h12M2 11.5h12" />
          </svg>
        </button>

        <Link to="/" className="gh-header-logo" aria-label="LineWeb 首页">
          <svg className="gh-header-logo-mark" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 4.5A2.5 2.5 0 0 1 7.5 2h7L19 6.5v11A2.5 2.5 0 0 1 16.5 20h-9A2.5 2.5 0 0 1 5 17.5z" />
            <path d="M14 2v5h5M8.5 11h7M8.5 15h4" />
          </svg>
          <span className="gh-header-brand-name">LineWeb</span>
        </Link>

        <div className="gh-header-spacer" />

        <div className="gh-header-actions">
          <button
            className="gh-header-icon-btn gh-header-theme-btn"
            onClick={toggleTheme}
            title={`主题：${theme === 'auto' ? '跟随系统' : theme === 'dark' ? '深色' : '浅色'}`}
            aria-label="切换主题"
          >
            {themeIcons[theme]}
          </button>

          {user ? (
            <>
              <Link to="/points" className="gh-header-points" title="积分中心：游戏赚积分，兑换称号与表情包">
                <span className="gh-header-points-icon" aria-hidden>🪙</span>
                <span className="gh-header-points-value">{pointsBalance}</span>
              </Link>
              <div ref={menuRef} className="gh-header-user-wrap">
                <button
                  className="gh-header-user-btn"
                  onClick={() => setUserMenuOpen(prev => !prev)}
                  aria-expanded={userMenuOpen}
                  aria-label="打开用户菜单"
                >
                  <UserAvatar userId={user.id} username={user.username} size="sm" />
                  <span className="gh-hidden-mobile gh-header-username">{user.username}</span>
                  <UserTitleBadge title={headerTitle} className="gh-hidden-mobile" />
                  <svg className="gh-header-chevron gh-hidden-mobile" width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                    <path d="M6 8.825a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 0 1 1.06-1.06L6 6.939l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-.53.22Z" />
                  </svg>
                </button>
                {userMenuOpen && (
                  <div className="gh-popover gh-header-menu">
                    <Link to="/profile" className="gh-popover-item" onClick={() => setUserMenuOpen(false)}>个人资料</Link>
                    <Link to="/points" className="gh-popover-item" onClick={() => setUserMenuOpen(false)}>积分中心</Link>
                    {hasAdminAccess && <Link to="/admin" className="gh-popover-item" onClick={() => setUserMenuOpen(false)}>管理面板</Link>}
                    <div className="gh-popover-divider" />
                    {!pointsTitle && leaderTitles.length > 0 && (
                      <div className="gh-popover-titles">
                        {leaderTitles.map((item) => (
                          <UserTitleBadge key={item.game} title={item} />
                        ))}
                      </div>
                    )}
                    <button className="gh-popover-item" onClick={() => { setUserMenuOpen(false); logout() }}>退出登录</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link to="/login" className="gh-btn gh-btn--primary gh-btn--sm">登录</Link>
          )}
        </div>
      </div>
    </header>
  )
})
