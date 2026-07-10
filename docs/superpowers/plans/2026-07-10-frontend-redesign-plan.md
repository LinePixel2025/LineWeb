# LineWeb 前端重新设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将LineWeb前端从Liquid Glass Design System升级为现代实用主义风格，保留玻璃质感和折射效果，实现双主题支持

**Architecture:** 采用Vercel Geist的实用主义设计理念，结合Liquid Glass的玻璃质感，通过CSS变量系统实现双主题支持，更新所有组件和页面

**Tech Stack:** React 19, Vite 6, CSS Variables, CSS backdrop-filter, TypeScript

## Global Constraints

- 所有CSS放在`client/src/styles/globals.css`或其导入的文件中
- 使用CSS变量管理颜色、间距、字体等
- 支持深色和浅色主题切换
- 保留Liquid Glass的玻璃质感和折射效果
- 使用简约动画（150-200ms）
- 确保WCAG AA可访问性标准
- 响应式设计：移动端、平板、桌面

---

## 文件结构

### CSS文件
- `client/src/styles/variables.css` — 更新CSS变量系统（颜色、间距、字体）
- `client/src/styles/base.css` — 更新基础样式（排版、重置）
- `client/src/styles/glass.css` — 更新玻璃质感样式
- `client/src/styles/components.css` — 更新组件样式（按钮、输入框、卡片）
- `client/src/styles/pages.css` — 更新页面样式
- `client/src/styles/responsive.css` — 更新响应式样式

### 组件文件
- `client/src/components/glass/LiquidButton.tsx` — 更新按钮组件
- `client/src/components/glass/LiquidGlass.tsx` — 更新玻璃容器组件
- `client/src/components/Navbar.tsx` — 更新导航栏组件
- `client/src/components/Pagination.tsx` — 更新分页组件

### 页面文件
- `client/src/pages/HomePage.tsx` — 更新首页
- `client/src/pages/PostsPage.tsx` — 更新文章列表页
- `client/src/pages/LoginPage.tsx` — 更新登录页
- `client/src/pages/RegisterPage.tsx` — 更新注册页
- `client/src/pages/PostPage.tsx` — 更新文章详情页
- `client/src/pages/DrivePage.tsx` — 更新网盘页
- `client/src/pages/admin/AdminPage.tsx` — 更新管理页

### 上下文文件
- `client/src/contexts/ThemeContext.tsx` — 新建主题上下文

---

### Task 1: 更新CSS变量系统

**Files:**
- Modify: `client/src/styles/variables.css`

**Interfaces:**
- Produces: CSS变量系统，供所有组件使用

- [ ] **Step 1: 更新CSS变量文件**

```css
/* client/src/styles/variables.css */
:root {
  /* ===== Dark Mode (default) ===== */
  
  /* Backgrounds */
  --color-bg-primary: #0a0a0a;
  --color-bg-secondary: #111111;
  --color-bg-tertiary: #191919;
  
  /* Text */
  --color-text-primary: #ededed;
  --color-text-secondary: #a1a1a1;
  --color-text-tertiary: #6b6b6b;
  
  /* Border */
  --color-border-default: rgba(255,255,255,0.1);
  --color-border-hover: rgba(255,255,255,0.15);
  
  /* Accent */
  --color-accent: #0070f3;
  --color-accent-hover: #0060df;
  --color-accent-soft: rgba(0,112,243,0.1);
  
  /* States */
  --color-success: #00a67e;
  --color-warning: #f5a623;
  --color-error: #ee5a5a;
  
  /* Glass */
  --glass-bg: rgba(255,255,255,0.05);
  --glass-blur: blur(16px);
  --glass-border: rgba(255,255,255,0.1);
  
  /* Typography */
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', monospace;
  
  /* Spacing */
  --spacing-1: 4px;
  --spacing-2: 8px;
  --spacing-3: 12px;
  --spacing-4: 16px;
  --spacing-6: 24px;
  --spacing-8: 32px;
  --spacing-12: 48px;
  
  /* Border Radius */
  --radius-sm: 6px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-full: 9999px;
  
  /* Transitions */
  --transition-fast: 150ms cubic-bezier(0.25, 0.1, 0.25, 1);
  --transition-normal: 200ms cubic-bezier(0.25, 0.1, 0.25, 1);
  
  /* Layout */
  --max-width: 1200px;
  --nav-height: 56px;
}

/* Light Theme */
[data-theme="light"] {
  --color-bg-primary: #ffffff;
  --color-bg-secondary: #fafafa;
  --color-bg-tertiary: #f5f5f5;
  
  --color-text-primary: #171717;
  --color-text-secondary: #666666;
  --color-text-tertiary: #888888;
  
  --color-border-default: rgba(0,0,0,0.1);
  --color-border-hover: rgba(0,0,0,0.15);
  
  --glass-bg: rgba(255,255,255,0.7);
  --glass-border: rgba(0,0,0,0.1);
}
```

- [ ] **Step 2: 验证CSS变量**

在浏览器中检查CSS变量是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/variables.css
git commit -m "feat: update CSS variables system for new design"
```

---

### Task 2: 创建主题上下文

**Files:**
- Create: `client/src/contexts/ThemeContext.tsx`

**Interfaces:**
- Produces: ThemeContext, ThemeProvider, useTheme hook

- [ ] **Step 1: 创建主题上下文文件**

```tsx
// client/src/contexts/ThemeContext.tsx
import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type Theme = 'dark' | 'light'

interface ThemeContextType {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('theme')
    return (saved as Theme) || 'dark'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
```

- [ ] **Step 2: 在App.tsx中集成ThemeProvider**

```tsx
// client/src/App.tsx
import { ThemeProvider } from './contexts/ThemeContext'

function App() {
  return (
    <ThemeProvider>
      {/* 其他组件 */}
    </ThemeProvider>
  )
}
```

- [ ] **Step 3: 提交更改**

```bash
git add client/src/contexts/ThemeContext.tsx client/src/App.tsx
git commit -m "feat: add theme context for dark/light mode"
```

---

### Task 3: 更新基础样式

**Files:**
- Modify: `client/src/styles/base.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 基础排版和重置样式

- [ ] **Step 1: 更新基础样式文件**

```css
/* client/src/styles/base.css */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

body {
  font-family: var(--font-sans);
  background-color: var(--color-bg-primary);
  color: var(--color-text-primary);
  line-height: 1.6;
  transition: background-color var(--transition-normal), color var(--transition-normal);
}

h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
}

h1 { font-size: 2rem; }
h2 { font-size: 1.5rem; }
h3 { font-size: 1.25rem; }

p {
  margin-bottom: 1rem;
}

a {
  color: var(--color-accent);
  text-decoration: none;
  transition: color var(--transition-fast);
}

a:hover {
  color: var(--color-accent-hover);
}

code {
  font-family: var(--font-mono);
  font-size: 0.875rem;
  background: var(--color-bg-tertiary);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

img {
  max-width: 100%;
  height: auto;
}

button {
  cursor: pointer;
  border: none;
  background: none;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

input, textarea, select {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}
```

- [ ] **Step 2: 验证基础样式**

在浏览器中检查基础样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/base.css
git commit -m "feat: update base styles for new design system"
```

---

### Task 4: 更新玻璃质感样式

**Files:**
- Modify: `client/src/styles/glass.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 玻璃质感组件样式

- [ ] **Step 1: 更新玻璃质感样式文件**

```css
/* client/src/styles/glass.css */
.lg-surface {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  transition: background var(--transition-normal), border-color var(--transition-normal);
}

.lg-surface:hover {
  background: rgba(255,255,255,0.08);
  border-color: var(--color-border-hover);
}

.lg-surface-strong {
  background: rgba(255,255,255,0.08);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
}

.lg-input {
  width: 100%;
  padding: 12px 16px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  color: var(--color-text-primary);
  font-size: 0.95rem;
  transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}

.lg-input:focus {
  outline: none;
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}

.lg-input::placeholder {
  color: var(--color-text-tertiary);
}

.lg-glass-input {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
}

.lg-glass-input:focus {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 3px var(--color-accent-soft);
}
```

- [ ] **Step 2: 验证玻璃质感样式**

在浏览器中检查玻璃质感样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/glass.css
git commit -m "feat: update glass styles for new design system"
```

---

### Task 5: 更新组件样式

**Files:**
- Modify: `client/src/styles/components.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 组件样式（按钮、卡片、导航栏）

- [ ] **Step 1: 更新组件样式文件**

```css
/* client/src/styles/components.css */

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 24px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
  cursor: pointer;
  text-decoration: none;
}

.btn-primary {
  background: var(--color-accent);
  color: #ffffff;
}

.btn-primary:hover {
  background: var(--color-accent-hover);
  color: #ffffff;
}

.btn-secondary {
  background: transparent;
  border: 1px solid var(--color-border-default);
  color: var(--color-text-primary);
}

.btn-secondary:hover {
  background: rgba(255,255,255,0.05);
  border-color: var(--color-border-hover);
}

.btn-ghost {
  background: transparent;
  color: var(--color-text-primary);
}

.btn-ghost:hover {
  background: rgba(255,255,255,0.05);
}

.btn-glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  color: var(--color-text-primary);
  border-radius: var(--radius-md);
}

.btn-glass:hover {
  background: rgba(255,255,255,0.1);
}

/* Cards */
.card {
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
  padding: var(--spacing-4);
  transition: all var(--transition-normal);
}

.card:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.card-glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: var(--spacing-4);
}

.card-glass:hover {
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

/* Navbar */
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 100;
  height: var(--nav-height);
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-bottom: 1px solid var(--glass-border);
}

.navbar-inner {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--spacing-4);
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.navbar-logo {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text-primary);
  text-decoration: none;
}

.navbar-links {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
}

.navbar-link {
  padding: 8px 16px;
  border-radius: var(--radius-full);
  color: var(--color-text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: all var(--transition-fast);
}

.navbar-link:hover {
  color: var(--color-text-primary);
  background: var(--color-accent-soft);
}

.navbar-link.active {
  color: var(--color-accent);
  background: var(--color-accent-soft);
}

/* Theme Toggle */
.theme-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.theme-toggle:hover {
  background: rgba(255,255,255,0.1);
}
```

- [ ] **Step 2: 验证组件样式**

在浏览器中检查组件样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/components.css
git commit -m "feat: update component styles for new design system"
```

---

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

---

### Task 7: 更新首页

**Files:**
- Modify: `client/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: CSS变量系统，LiquidGlass组件
- Produces: 更新后的首页

- [ ] **Step 1: 更新首页组件**

```tsx
// client/src/pages/HomePage.tsx
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { useWallpaper } from '../contexts/WallpaperContext'
import LiquidGlass from '../components/glass/LiquidGlass'

interface PostPreview {
  id: number
  title: string
  summary: string | null
  slug: string
  createdAt: string
  author: { username: string }
}

export default function HomePage() {
  const [recentPosts, setRecentPosts] = useState<PostPreview[]>([])
  const { refresh, loading } = useWallpaper()

  useEffect(() => {
    api.get<{ posts: PostPreview[] }>('/posts?page=1&limit=3')
      .then(data => setRecentPosts(data.posts))
      .catch(() => {})
  }, [])

  return (
    <>
      {/* Hero */}
      <section
        style={{
          textAlign: 'center',
          padding: '160px 24px 100px',
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        className="home-section"
      >
        <LiquidGlass
          variant="strong"
          chromatic={false}
          style={{
            padding: '56px 48px',
            maxWidth: '520px',
            width: '100%',
          }}
        >
          <h1
            style={{
              fontSize: 'clamp(2.4rem, 7vw, 4rem)',
              fontWeight: 700,
              letterSpacing: '-0.03em',
              color: 'var(--color-text-primary)',
              background: 'linear-gradient(135deg, var(--color-text-primary) 0%, var(--color-accent) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}
          >
            Line Web
          </h1>
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap', marginTop: '36px' }}>
            <Link to="/posts" className="btn btn-primary">
              浏览文章
            </Link>
            <Link to="/features" className="btn btn-glass">
              探索功能
            </Link>
          </div>
        </LiquidGlass>
      </section>

      {/* Latest Posts Preview */}
      {recentPosts.length > 0 && (
        <section
          className="home-posts-section"
          style={{
            maxWidth: '720px',
            margin: '0 auto',
          }}
        >
          <div style={{ textAlign: 'center', marginBottom: '40px' }}>
            <h2>最新文章</h2>
            <p style={{ marginTop: '8px', color: 'var(--color-text-secondary)' }}>近期发布的内容精选</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {recentPosts.map((post, i) => (
              <LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger" style={{ padding: '24px', animationDelay: `${i * 0.08}s` }}>
                <Link
                  to={`/posts/${post.slug}`}
                  style={{
                    display: 'block',
                    textDecoration: 'none',
                    color: 'inherit',
                  }}
                >
                  <h3 style={{ marginBottom: '4px' }}>{post.title}</h3>
                  {post.summary && (
                    <p style={{ marginTop: '8px', fontSize: '0.92rem', color: 'var(--color-text-secondary)' }}>
                      {post.summary}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{post.author.username}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </Link>
              </LiquidGlass>
            ))}
          </div>

          <div style={{ textAlign: 'center', marginTop: '32px' }}>
            <Link to="/posts" className="btn btn-glass">
              查看全部文章 →
            </Link>
          </div>
        </section>
      )}

      {/* Refresh wallpaper button */}
      <button
        onClick={refresh}
        className={`wallpaper-refresh-btn${loading ? ' refreshing' : ''}`}
        disabled={loading}
        aria-label="刷新壁纸"
        title="刷新壁纸"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <polyline points="1 20 1 14 7 14" />
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
        </svg>
      </button>
    </>
  )
}
```

- [ ] **Step 2: 验证首页**

在浏览器中检查首页是否正确显示。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/pages/HomePage.tsx
git commit -m "feat: update homepage for new design system"
```

---

### Task 8: 更新文章列表页

**Files:**
- Modify: `client/src/pages/PostsPage.tsx`

**Interfaces:**
- Consumes: CSS变量系统，LiquidGlass组件
- Produces: 更新后的文章列表页

- [ ] **Step 1: 更新文章列表页组件**

```tsx
// client/src/pages/PostsPage.tsx
import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import LiquidGlass from '../components/glass/LiquidGlass'
import Pagination from '../components/Pagination'

interface PostSummary {
  id: number; title: string; summary: string | null
  slug: string; createdAt: string; author: { username: string }
}
interface PostsResponse { posts: PostSummary[]; total: number; page: number; totalPages: number }

export default function PostsPage() {
  const [data, setData] = useState<PostsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'desc' | 'asc'>('desc')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  const fetchPosts = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({
      page: String(page),
      limit: '6',
      sort,
    })
    if (search) params.set('search', search)
    api.get<PostsResponse>(`/posts?${params}`)
      .then(setData).catch(console.error).finally(() => setLoading(false))
  }, [page, sort, search])

  useEffect(() => { fetchPosts() }, [fetchPosts])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    setSearch(searchInput.trim())
  }

  const handleClearSearch = () => {
    setSearchInput('')
    setSearch('')
    setPage(1)
  }

  const toggleSort = () => {
    setPage(1)
    setSort(prev => prev === 'desc' ? 'asc' : 'desc')
  }

  return (
    <div className="page container" style={{ maxWidth: '720px' }}>
      <h1 style={{ marginBottom: '8px' }}>文章</h1>
      <p style={{ marginBottom: '24px', color: 'var(--color-text-secondary)' }}>发现 Line Web 的最新内容</p>

      {/* Toolbar */}
      <LiquidGlass variant="blur" chromatic={false} className="posts-toolbar">
        <div className="posts-search-wrap">
          <span className="posts-search-icon">🔍</span>
          <input
            className="lg-input posts-search-input"
            type="text"
            placeholder="搜索文章标题…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
          />
          <button type="button" className="posts-search-submit" onClick={handleSearch} aria-label="搜索">→</button>
          <div className="posts-toolbar-divider" />
          <button className="posts-sort-btn-inline" onClick={toggleSort}>
            {sort === 'desc' ? '🕐 最新' : '🕐 最早'}
          </button>
        </div>
        {search && (
          <button type="button" className="btn btn-ghost" onClick={handleClearSearch}>
            ✕ 清除
          </button>
        )}
      </LiquidGlass>

      {/* Search results hint */}
      {search && data && (
        <p style={{ margin: '16px 0 0', fontSize: '0.88rem', color: 'var(--color-text-tertiary)' }}>
          搜索 "{search}" 找到 {data.total} 篇文章
        </p>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}><div className="spinner" /></div>
      ) : data?.posts.length === 0 ? (
        <LiquidGlass variant="regular" chromatic={false} style={{ textAlign: 'center', padding: '60px 24px', marginTop: '24px' }}>
          <p style={{ color: 'var(--color-text-secondary)' }}>{search ? `未找到包含 "${search}" 的文章` : '暂无文章'}</p>
        </LiquidGlass>
      ) : (
        <>
          <div className="posts-list">
            {data?.posts.map((post, i) => (
              <LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger posts-card" style={{ animationDelay: `${i * 0.05}s` }}>
                <Link
                  to={`/posts/${post.slug}`}
                  style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
                >
                  <h3>{post.title}</h3>
                  {post.summary && <p style={{ marginTop: '8px', fontSize: '0.92rem', color: 'var(--color-text-secondary)' }}>{post.summary}</p>}
                  <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{post.author.username}</span>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                </Link>
              </LiquidGlass>
            ))}
          </div>

          {data && data.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: 验证文章列表页**

在浏览器中检查文章列表页是否正确显示。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/pages/PostsPage.tsx
git commit -m "feat: update posts page for new design system"
```

---

### Task 9: 更新登录页

**Files:**
- Modify: `client/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: CSS变量系统，LiquidGlass组件
- Produces: 更新后的登录页

- [ ] **Step 1: 更新登录页组件**

```tsx
// client/src/pages/LoginPage.tsx
import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LiquidGlass from '../components/glass/LiquidGlass'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally { setLoading(false) }
  }

  return (
    <div className="page container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <LiquidGlass variant="strong" chromatic={false} style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '8px' }}>登录</h2>
        <p style={{ textAlign: 'center', marginBottom: '28px', fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
          欢迎回到 Line Web
        </p>

        {error && (
          <div style={{
            background: 'rgba(238,90,90,0.12)',
            color: 'var(--color-error)', padding: '10px 14px',
            borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.88rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input className="lg-input" type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="lg-input" type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} required />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: '4px' }}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '20px', color: 'var(--color-text-tertiary)' }}>
          还没有账号？ <Link to="/register">注册</Link>
        </p>
      </LiquidGlass>
    </div>
  )
}
```

- [ ] **Step 2: 验证登录页**

在浏览器中检查登录页是否正确显示。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/pages/LoginPage.tsx
git commit -m "feat: update login page for new design system"
```

---

### Task 10: 更新页面样式

**Files:**
- Modify: `client/src/styles/pages.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 页面特定样式

- [ ] **Step 1: 更新页面样式文件**

```css
/* client/src/styles/pages.css */

/* Page container */
.page {
  padding-top: calc(var(--nav-height) + 24px);
  padding-bottom: 24px;
}

.container {
  max-width: var(--max-width);
  margin: 0 auto;
  padding: 0 var(--spacing-4);
}

/* Home section */
.home-section {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

/* Posts page */
.posts-toolbar {
  display: flex;
  align-items: center;
  gap: var(--spacing-3);
  padding: var(--spacing-3) var(--spacing-4);
  margin-bottom: var(--spacing-4);
}

.posts-search-wrap {
  display: flex;
  align-items: center;
  gap: var(--spacing-2);
  flex: 1;
}

.posts-search-input {
  flex: 1;
}

.posts-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-3);
}

.posts-card {
  padding: var(--spacing-4);
}

/* Drive page */
.drive-page {
  display: grid;
  grid-template-columns: 240px 1fr 280px;
  gap: var(--spacing-4);
  min-height: calc(100vh - var(--nav-height));
}

.drive-main {
  flex: 1;
  min-width: 0;
}

.drive-content-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.drive-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 0;
}

.drive-state-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
}

.drive-state-icon {
  font-size: 3rem;
  margin-bottom: var(--spacing-4);
}

.drive-state-text {
  color: var(--color-text-secondary);
  margin-bottom: var(--spacing-4);
}

/* Spinner */
.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border-default);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Fade in animation */
.fade-in-stagger {
  animation: fadeIn 0.3s ease-out forwards;
  opacity: 0;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Wallpaper refresh button */
.wallpaper-refresh-btn {
  position: fixed;
  bottom: var(--spacing-4);
  right: var(--spacing-4);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--color-text-primary);
}

.wallpaper-refresh-btn:hover {
  background: rgba(255,255,255,0.1);
}

.wallpaper-refresh-btn.refreshing {
  animation: spin 1s linear infinite;
}

/* Menu open state */
body.menu-open {
  overflow: hidden;
}

/* Mobile menu button */
.mobile-menu-btn {
  display: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--color-text-primary);
}

@media (max-width: 768px) {
  .mobile-menu-btn {
    display: flex;
  }
  
  .navbar-links {
    display: none;
  }
  
  .navbar-links.open {
    display: flex;
    flex-direction: column;
    position: fixed;
    top: var(--nav-height);
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--color-bg-primary);
    padding: var(--spacing-4);
    gap: var(--spacing-2);
  }
  
  .drive-page {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: 验证页面样式**

在浏览器中检查页面样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/pages.css
git commit -m "feat: update page styles for new design system"
```

---

### Task 11: 更新响应式样式

**Files:**
- Modify: `client/src/styles/responsive.css`

**Interfaces:**
- Consumes: CSS变量系统
- Produces: 响应式样式

- [ ] **Step 1: 更新响应式样式文件**

```css
/* client/src/styles/responsive.css */

/* Mobile First */
@media (max-width: 768px) {
  :root {
    --spacing-4: 12px;
    --spacing-6: 16px;
    --spacing-8: 24px;
  }
  
  h1 {
    font-size: 1.75rem;
  }
  
  h2 {
    font-size: 1.25rem;
  }
  
  h3 {
    font-size: 1.125rem;
  }
  
  .container {
    padding: 0 var(--spacing-3);
  }
  
  .posts-toolbar {
    flex-direction: column;
    align-items: stretch;
  }
  
  .posts-search-wrap {
    flex-direction: column;
  }
  
  .posts-toolbar-divider {
    display: none;
  }
}

/* Tablet */
@media (min-width: 769px) and (max-width: 1024px) {
  .container {
    padding: 0 var(--spacing-6);
  }
  
  .drive-page {
    grid-template-columns: 200px 1fr;
  }
}

/* Desktop */
@media (min-width: 1025px) {
  .container {
    padding: 0 var(--spacing-8);
  }
}

/* Large Desktop */
@media (min-width: 1400px) {
  :root {
    --max-width: 1320px;
  }
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 2: 验证响应式样式**

在浏览器中检查响应式样式是否正确应用。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/responsive.css
git commit -m "feat: update responsive styles for new design system"
```

---

### Task 12: 更新globals.css导入

**Files:**
- Modify: `client/src/styles/globals.css`

**Interfaces:**
- Consumes: 所有CSS文件
- Produces: 统一的样式入口

- [ ] **Step 1: 更新globals.css文件**

```css
/* client/src/styles/globals.css */
/* Line Web — Modern Design System */

/* Import modular CSS files */
@import './variables.css';
@import './base.css';
@import './glass.css';
@import './components.css';
@import './pages.css';
@import './responsive.css';
```

- [ ] **Step 2: 验证样式导入**

在浏览器中检查所有样式是否正确导入。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/styles/globals.css
git commit -m "feat: update globals.css imports"
```

---

### Task 13: 最终验证

**Files:**
- None

**Interfaces:**
- None

- [ ] **Step 1: 运行类型检查**

```bash
cd client && npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 2: 运行构建**

```bash
cd client && npx vite build
```

Expected: Build successful

- [ ] **Step 3: 测试所有页面**

在浏览器中测试以下页面：
- 首页
- 文章列表页
- 登录页
- 注册页
- 文章详情页
- 网盘页
- 管理页

验证：
- 深色主题显示正确
- 浅色主题显示正确
- 主题切换工作正常
- 响应式布局正确
- 动画效果正常
- 玻璃质感显示正确

- [ ] **Step 4: 提交最终更改**

```bash
git add .
git commit -m "feat: complete frontend redesign with modern design system"
```

---

## 成功标准验证

- [ ] 所有页面遵循设计规范
- [ ] 页面加载时间 < 2秒
- [ ] 动画流畅（60fps）
- [ ] 符合WCAG AA标准
- [ ] 响应式设计正确
- [ ] 双主题支持正常
- [ ] 玻璃质感和折射效果保留
