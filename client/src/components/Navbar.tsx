import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const navItems = [
  { path: '/', label: '首页' },
  { path: '/features', label: '功能' },
  { path: '/posts', label: '文章' },
]

export default function Navbar() {
  const { user, isAdmin } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const closeMenu = () => {
    if (!mobileOpen) return
    setClosing(true)
    setTimeout(() => {
      setMobileOpen(false)
      setClosing(false)
    }, 200)
  }

  const toggleMenu = () => {
    if (mobileOpen) {
      closeMenu()
    } else {
      setMobileOpen(true)
    }
  }

  // Lock body scroll when menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.classList.add('menu-open')
    } else {
      requestAnimationFrame(() => {
        document.body.classList.remove('menu-open')
      })
    }
    return () => document.body.classList.remove('menu-open')
  }, [mobileOpen])

  // Close menu on outside tap
  useEffect(() => {
    if (!mobileOpen) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (!menuRef.current || !btnRef.current) return
      if (!menuRef.current.contains(target) && !btnRef.current.contains(target)) {
        closeMenu()
      }
    }
    // Delay to avoid closing from the toggle tap itself
    const id = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside, { passive: true })
    }, 100)
    return () => {
      clearTimeout(id)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [mobileOpen])

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="navbar-logo">Line Web</Link>

        <div
          ref={menuRef}
          className={`navbar-links ${mobileOpen ? 'open' : ''} ${closing ? 'closing' : ''}`}
        >
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`navbar-link ${location.pathname === item.path ? 'active' : ''}`}
              onClick={() => closeMenu()}
            >
              {item.label}
            </Link>
          ))}

          {user ? (
            <>
              {isAdmin && (
                <Link
                  to="/admin"
                  className={`navbar-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`}
                  onClick={() => closeMenu()}
                >
                  管理
                </Link>
              )}
              <Link
                to="/profile"
                className={`navbar-link ${location.pathname === '/profile' ? 'active' : ''}`}
                onClick={() => closeMenu()}
              >
                {user.username}
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              className="navbar-link"
              onClick={() => closeMenu()}
            >
              登录
            </Link>
          )}
        </div>

        <button
          ref={btnRef}
          className="mobile-menu-btn"
          onClick={toggleMenu}
          aria-label={mobileOpen ? '关闭菜单' : '打开菜单'}
        >
          {mobileOpen ? (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="4" x2="18" y2="18" />
              <line x1="18" y1="4" x2="4" y2="18" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="19" y2="6" />
              <line x1="3" y1="11" x2="19" y2="11" />
              <line x1="3" y1="16" x2="19" y2="16" />
            </svg>
          )}
        </button>
      </div>
    </nav>
  )
}
