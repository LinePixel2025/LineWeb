### Task 6: 更新导航栏组件

**Files:**
- Modify: `client/src/components/Navbar.tsx`

**Interfaces:**
- Consumes: useTheme hook
- Produces: 更新后的导航栏组件

- [ ] **Step 1: 更新导航栏组件**

```tsx
// client/src/components/Navbar.tsx
import { useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'

const navItems = [
  { path: '/', label: '首页' },
  { path: '/features', label: '功能' },
  { path: '/posts', label: '文章' },
]

export default function Navbar() {
  const { user, isAdmin } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  const closeMenu = () => setMobileOpen(false)
  const toggleMenu = () => setMobileOpen(prev => !prev)

  // Lock body scroll when menu is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.classList.add('menu-open')
    } else {
      document.body.classList.remove('menu-open')
    }
    return () => document.body.classList.remove('menu-open')
  }, [mobileOpen])

  // Close menu on outside tap
  useEffect(() => {
    if (!mobileOpen) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
        setMobileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside, { passive: true })
    return () => {
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
          className={`navbar-links ${mobileOpen ? 'open' : ''}`}
        >
          {navItems.map(item => (
            <Link
              key={item.path}
              to={item.path}
              className={`navbar-link ${location.pathname === item.path ? 'active' : ''}`}
              onClick={closeMenu}
            >
              {item.label}
            </Link>
          ))}

          {user ? (
            <>
              {user.canAccessDrive && (
                <Link
                  to="/drive"
                  className={`navbar-link ${location.pathname === '/drive' ? 'active' : ''}`}
                  onClick={closeMenu}
                >
                  网盘
                </Link>
              )}
              {isAdmin && (
                <Link
                  to="/admin"
                  className={`navbar-link ${location.pathname.startsWith('/admin') ? 'active' : ''}`}
                  onClick={closeMenu}
                >
                  管理
                </Link>
              )}
              <Link
                to="/profile"
                className={`navbar-link ${location.pathname === '/profile' ? 'active' : ''}`}
                onClick={closeMenu}
              >
                {user.username}
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              className="navbar-link"
              onClick={closeMenu}
            >
              登录
            </Link>
          )}

          <button
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
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
```

- [ ] **Step 2: 验证导航栏**

在浏览器中检查导航栏是否正确显示，主题切换是否工作。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/components/Navbar.tsx
git commit -m "feat: update navbar with theme toggle"
```
