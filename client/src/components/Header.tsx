import { memo, useState, useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { usePoints } from '../contexts/PointsContext'
import UserAvatar from './UserAvatar'
import UserTitleBadge from './UserTitleBadge'
import Icon from './ui/Icon'

interface Props {
  onMenuToggle: () => void
}

const themeIcons = {
  auto: 'auto',
  dark: 'moon',
  light: 'sun',
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
          <Icon name="menu" size={20} />
        </button>

        <Link to="/" className="gh-header-logo" aria-label="LineWeb 首页">
          <Icon name="logo" size={26} className="gh-header-logo-mark" />
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
            <Icon name={themeIcons[theme]} size={18} />
          </button>

          {user ? (
            <>
              <Link to="/points" className="gh-header-points" title="积分中心：游戏赚积分，兑换称号与表情包">
                <span className="gh-header-points-icon" aria-hidden><Icon name="coin" size={15} /></span>
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
                  <Icon name="chevron-down" size={13} className="gh-header-chevron gh-hidden-mobile" />
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
