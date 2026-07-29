# GitHub-Style Frontend Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** redesign the entire LineWeb frontend to match GitHub's visual design language (Primer tokens, flat design, 8px radius, light/dark/auto themes, GitHub-style IA).

**Architecture:** Pure CSS with CSS variables for theming. Use `--gh-*` GitHub Primer tokens. Use `ThemeContext` for theme selection. Create reusable UI primitives (`GitHubButton`, `GitHubInput`, `GitHubBadge`, `GitHubAlert`, `GitHubTabNav`). Restructure Layout with fixed Header + left Sidebar. Rewrite all page JSX to GitHub visual patterns while preserving existing API calls and state logic.

**Tech Stack:** React 19, TypeScript, Vite 6, React Router 7, react-query, pure CSS (no Tailwind)

## Global Constraints

- **Visual language**: flat surfaces, borders, restrained shadows, and no decorative blur or displacement effects.
- **All border-radius**: 8px (`border-radius: 8px`) everywhere — cards, buttons, inputs, badges, dialogs, dropdowns, tabs.
- **Theme**: light/dark/auto via `data-theme` on `<html>`. CSV variables in `:root` with `[data-theme="dark"]` overrides.
- **Typography**: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial`), no Instrument Serif.
- **API unchanged**: all backend calls, request shapes, and data flow remain exactly as-is.
- **Existing routes preserved**: `/`, `/posts`, `/posts/:slug`, `/page/:slug`, `/drive`, `/profile`, `/admin*`, `/login`, `/register`.
- **Flat**: borders and background color for hierarchy, minimal box-shadow (only dropdowns/dialogs).
- **Responsive**: >=1280px sidebar+content, 768-1279px icon sidebar or drawer, <768px header+drawer.

---

## Phase 1: CSS Foundation — Design Tokens, Reset, Base

### Task 1.1: Rewrite variables.css with GitHub Primer tokens

**Files:**
- Rewrite: `client/src/styles/variables.css`

**Interfaces:**
- Produces: `--gh-bg`, `--gh-canvas`, `--gh-canvas-inset`, `--gh-border`, `--gh-border-muted`, `--gh-accent`, `--gh-accent-hover`, `--gh-accent-soft`, `--gh-text`, `--gh-text-secondary`, `--gh-text-tertiary`, `--gh-success`, `--gh-danger`, `--gh-warning`, `--gh-font`, `--gh-font-mono`, `--gh-nav-height`, `--gh-max-width`, `--gh-sidebar-width`, `--gh-sidebar-collapsed-width`, `--gh-radius`, `--gh-transition`, `--gh-shadow`, `--gh-focus-ring`, plus spacing/typography tokens. All previous `--lg-*` tokens deleted.

- [ ] **Step 1: Write variables.css**

```css
:root {
  /* Light defaults */
  --gh-bg:                #ffffff;
  --gh-canvas:            #f6f8fa;
  --gh-canvas-inset:      #f3f6f8;
  --gh-border:            #d1d9e0;
  --gh-border-muted:      #d8dee4;
  --gh-accent:            #0969da;
  --gh-accent-hover:      #0550ae;
  --gh-accent-soft:       rgba(9, 105, 218, 0.15);
  --gh-text:              #1f2328;
  --gh-text-secondary:    #59636e;
  --gh-text-tertiary:     #636c76;
  --gh-text-placeholder:  #6e7781;
  --gh-text-disabled:     #8c959f;
  --gh-success:           #1a7f37;
  --gh-success-soft:      rgba(26, 127, 55, 0.15);
  --gh-success-emphasis:  #2da44e;
  --gh-danger:            #cf222e;
  --gh-danger-soft:       rgba(207, 34, 46, 0.15);
  --gh-warning:           #9a6700;
  --gh-warning-soft:      rgba(154, 103, 0, 0.15);
  --gh-accent-emphasis:   #0969da;
  --gh-btn-hover:         rgba(31, 35, 40, 0.04);
  --gh-btn-active:        rgba(31, 35, 40, 0.08);

  /* Typography */
  --gh-font: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans',
             Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
  --gh-font-mono: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;

  /* Layout */
  --gh-nav-height:           64px;
  --gh-sidebar-width:        256px;
  --gh-sidebar-collapsed:    64px;
  --gh-max-width:            1280px;
  --gh-content-width:        1012px;

  /* Spacing — 4px base */
  --gh-space-1:  4px;
  --gh-space-2:  8px;
  --gh-space-3:  12px;
  --gh-space-4:  16px;
  --gh-space-5:  24px;
  --gh-space-6:  32px;
  --gh-space-7:  48px;
  --gh-space-8:  64px;

  /* Radius — all G2 (8px) */
  --gh-radius: 8px;

  /* Typography scale */
  --gh-text-xs:  0.75rem;
  --gh-text-sm:  0.875rem;
  --gh-text-base: 1rem;
  --gh-text-md:  1rem;
  --gh-text-lg:  1.125rem;
  --gh-text-xl:  1.5rem;
  --gh-text-2xl: 2rem;
  --gh-text-3xl: 2.5rem;

  /* Transitions */
  --gh-transition: 0.15s ease;

  /* Shadows — minimal, dropdowns only */
  --gh-shadow-sm: 0 1px 2px rgba(31, 35, 40, 0.04);
  --gh-shadow-md: 0 3px 6px rgba(31, 35, 40, 0.08);
  --gh-shadow-lg: 0 8px 24px rgba(31, 35, 40, 0.12);
  --gh-shadow-xl: 0 12px 32px rgba(31, 35, 40, 0.16);

  /* Focus ring */
  --gh-focus-ring: 0 0 0 3px rgba(9, 105, 218, 0.3);

  /* Safe area */
  --gh-safe-top:    env(safe-area-inset-top, 0px);
  --gh-safe-bottom: env(safe-area-inset-bottom, 0px);
  --gh-safe-left:   env(safe-area-inset-left, 0px);
  --gh-safe-right:  env(safe-area-inset-right, 0px);
}

[data-theme="dark"] {
  --gh-bg:                #0d1117;
  --gh-canvas:            #161b22;
  --gh-canvas-inset:      #010409;
  --gh-border:            #30363d;
  --gh-border-muted:      #21262d;
  --gh-accent:            #2f81f7;
  --gh-accent-hover:      #409eff;
  --gh-accent-soft:       rgba(47, 129, 247, 0.15);
  --gh-text:              #f0f6fc;
  --gh-text-secondary:    #9198a1;
  --gh-text-tertiary:     #8b949e;
  --gh-text-placeholder:  #6e7681;
  --gh-text-disabled:     #6e7681;
  --gh-success:           #3fb950;
  --gh-success-soft:      rgba(63, 185, 80, 0.15);
  --gh-success-emphasis:  #3fb950;
  --gh-danger:            #f85149;
  --gh-danger-soft:       rgba(248, 81, 73, 0.15);
  --gh-warning:           #d29922;
  --gh-warning-soft:      rgba(210, 153, 34, 0.15);
  --gh-accent-emphasis:   #1f6feb;
  --gh-btn-hover:         rgba(255, 255, 255, 0.06);
  --gh-btn-active:        rgba(255, 255, 255, 0.1);
  --gh-shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --gh-shadow-md: 0 3px 6px rgba(0, 0, 0, 0.4);
  --gh-shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
  --gh-shadow-xl: 0 12px 32px rgba(0, 0, 0, 0.6);
  --gh-focus-ring: 0 0 0 3px rgba(47, 129, 247, 0.3);
}
```

- [ ] **Step 2: Verify file written** — Check `client/src/styles/variables.css` exists and contains all tokens.

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/variables.css
git commit -m "refactor: rewrite CSS variables with GitHub Primer tokens"
```

### Task 1.2: Rewrite base.css (reset, typography, utilities)

**Files:**
- Rewrite: `client/src/styles/base.css`

**Interfaces:**
- Consumes: `--gh-*` CSS variables from Task 1.1
- Produces: base reset, body typography, `.gh-content` layout class, spinner, skeleton, text utilities

- [ ] **Step 1: Write base.css**

```css
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

body {
  font-family: var(--gh-font);
  background-color: var(--gh-bg);
  color: var(--gh-text);
  line-height: 1.5;
  min-height: 100dvh;
  -webkit-tap-highlight-color: transparent;
}

a {
  color: var(--gh-accent);
  text-decoration: none;
  transition: color var(--gh-transition);
}
a:hover { color: var(--gh-accent-hover); }

::selection {
  background: var(--gh-accent-soft);
  color: var(--gh-text);
}

/* Typography */
h1, h2, h3, h4, h5, h6 {
  font-weight: 600;
  line-height: 1.25;
  color: var(--gh-text);
}
h1 { font-size: var(--gh-text-2xl); }
h2 { font-size: var(--gh-text-xl); }
h3 { font-size: var(--gh-text-lg); }
h4 { font-size: var(--gh-text-base); font-weight: 600; }

.gh-text-secondary { color: var(--gh-text-secondary); }
.gh-text-tertiary { color: var(--gh-text-tertiary); font-size: var(--gh-text-sm); }

/* Layout root — fills viewport, offset by header + sidebar */
.gh-layout-root {
  position: relative;
  min-height: 100dvh;
  background: var(--gh-bg);
}

.gh-content {
  margin-left: var(--gh-sidebar-width);
  padding: var(--gh-space-5) var(--gh-space-6);
  min-height: calc(100dvh - var(--gh-nav-height));
  transition: margin-left 0.2s ease;
}

.gh-content--collapsed {
  margin-left: var(--gh-sidebar-collapsed);
}

.gh-page-container {
  max-width: var(--gh-max-width);
  margin: 0 auto;
}

/* Spinner */
.gh-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--gh-border);
  border-top-color: var(--gh-accent);
  border-radius: 50%;
  animation: gh-spin 0.6s linear infinite;
}
@keyframes gh-spin {
  to { transform: rotate(360deg); }
}

/* Skeleton */
.gh-skeleton {
  background: linear-gradient(90deg,
    var(--gh-canvas) 25%,
    var(--gh-canvas-inset) 50%,
    var(--gh-canvas) 75%
  );
  background-size: 200% 100%;
  animation: gh-shimmer 1.2s ease-in-out infinite;
  border-radius: var(--gh-radius);
}
@keyframes gh-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* Scrollbar */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--gh-border);
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--gh-text-tertiary);
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/styles/base.css
git commit -m "refactor: rewrite base.css with GitHub Primer reset and typography"
```

### Task 1.3: Rewrite globals.css (import orchestrator)

**Files:**
- Rewrite: `client/src/styles/globals.css`

- [ ] **Step 1: Write globals.css**

```css
/* LineWeb — GitHub Primer Design System */
@import './variables.css';
@import './base.css';
@import './components.css';
@import './layout.css';
@import './pages.css';
@import './drive.css';
@import './responsive.css';
```

- [ ] **Step 2: Commit**

```bash
git add client/src/styles/globals.css
git commit -m "refactor: rewrite globals.css import orchestrator"
```

---

## Phase 2: Theme System

### Task 2.1: Create ThemeContext

**Files:**
- Create: `client/src/contexts/ThemeContext.tsx`
- Delete: `client/src/contexts/legacy visual context.tsx`
- Modify: `client/src/App.tsx` (replace GlassProvider with ThemeProvider)

**Interfaces:**
- Produces: `ThemeProvider`, `useTheme()` → `{ theme: 'light'|'dark'|'auto', resolvedTheme: 'light'|'dark', setTheme, toggleTheme }`
- Consumes: localStorage for persistence, `prefers-color-scheme` for auto

- [ ] **Step 1: Write ThemeContext.tsx**

```tsx
import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'

type Theme = 'light' | 'dark' | 'auto'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextType {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType | null>(null)
const STORAGE_KEY = 'lineweb_theme'

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
    } catch {}
    return 'auto'
  })

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme))

  // Apply data-theme to <html>
  useEffect(() => {
    const resolved = resolveTheme(theme)
    setResolvedTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [theme])

  // Listen for system theme changes when in auto mode
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'auto') {
        const resolved = resolveTheme('auto')
        setResolvedTheme(resolved)
        document.documentElement.setAttribute('data-theme', resolved)
      }
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next: Theme = prev === 'light' ? 'dark' : prev === 'dark' ? 'auto' : 'light'
      try { localStorage.setItem(STORAGE_KEY, next) } catch {}
      return next
    })
  }, [])

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme, toggleTheme }), [theme, resolvedTheme, setTheme, toggleTheme])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
```

- [ ] **Step 2: Delete legacy visual context.tsx**

```bash
Remove-Item -LiteralPath "client/src/contexts/legacy visual context.tsx"
```

- [ ] **Step 3: Update App.tsx providers** — Replace GlassProvider import with ThemeProvider, remove legacy visual context import.

Edit `client/src/App.tsx`:
- Remove `import { GlassProvider } from './contexts/legacy visual context'`
- Remove `import { ContrastProvider } from './contexts/ContrastContext'`
- Add `import { ThemeProvider } from './contexts/ThemeContext'`
- Replace `<GlassProvider>` wrapping with `<ThemeProvider>`
- Remove `<ContrastProvider>` wrapper (delete line)
- Remove `<WallpaperProvider>` wrapper (we'll handle wallpaper differently in Task 4.3)

- [ ] **Step 4: Commit**

```bash
git add client/src/contexts/ThemeContext.tsx client/src/App.tsx
git rm client/src/contexts/legacy visual context.tsx
git commit -m "feat: add ThemeContext (light/dark/auto), replace legacy visual context"
```

---

## Phase 3: UI Component Library

### Task 3.1: Create GitHub-style Base Components

**Files:**
- Create: `client/src/components/ui/GitHubButton.tsx`
- Create: `client/src/components/ui/GitHubInput.tsx`
- Create: `client/src/components/ui/GitHubBadge.tsx`
- Create: `client/src/components/ui/GitHubAlert.tsx`
- Create: `client/src/components/ui/GitHubTabNav.tsx`
- Create: `client/src/components/ui/index.ts`
- Rewrite: `client/src/styles/components.css`

**Interfaces:**
- Produces:
  - `<GitHubButton variant="primary|secondary|danger|ghost" size="sm|md|lg" ...props>` — renders `<button>` or `<a>` (if href) with GitHub styling
  - `<GitHubInput placeholder? icon? ...props>` — renders `<input>` with optional left icon
  - `<GitHubBadge variant="success|danger|warning|default" ...props>` — renders inline `<span>` badge
  - `<GitHubAlert variant="success|danger|warning|info" ...props>` — renders alert box
  - `<GitHubTabNav tabs=[{label,value}] active value on>Change ...props>` — renders tab navigation

- [ ] **Step 1: Write GitHubButton.tsx**

```tsx
import { forwardRef, type ButtonHTMLAttributes, type AnchorHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface BaseProps {
  variant?: Variant
  size?: Size
  fullWidth?: boolean
}

type ButtonAsButton = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined }
type ButtonAsLink = BaseProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; external?: boolean }

type GitHubButtonProps = ButtonAsButton | ButtonAsLink

const GitHubButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, GitHubButtonProps>(
  ({ variant = 'secondary', size = 'md', fullWidth, className = '', children, ...props }, ref) => {
    const cls = `gh-btn gh-btn--${variant} gh-btn--${size}${fullWidth ? ' gh-btn--full' : ''} ${className}`.trim()

    if ('href' in props && props.href) {
      const { href, external, ...anchorProps } = props as ButtonAsLink
      if (external || href.startsWith('http')) {
        return <a href={href} className={cls} target="_blank" rel="noopener noreferrer" ref={ref as any} {...anchorProps}>{children}</a>
      }
      return <Link to={href} className={cls} ref={ref as any} {...(anchorProps as any)}>{children}</Link>
    }

    return (
      <button className={cls} ref={ref as any} {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}>
        {children}
      </button>
    )
  }
)

GitHubButton.displayName = 'GitHubButton'
export default GitHubButton
```

- [ ] **Step 2: Write GitHubInput.tsx**

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react'

interface GitHubInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
  fullWidth?: boolean
}

const GitHubInput = forwardRef<HTMLInputElement, GitHubInputProps>(
  ({ icon, fullWidth, className = '', ...props }, ref) => {
    const cls = `gh-input${fullWidth ? ' gh-input--full' : ''} ${className}`.trim()
    if (icon) {
      return (
        <span className="gh-input-wrap">
          <span className="gh-input-icon">{icon}</span>
          <input ref={ref} className={cls} {...props} />
        </span>
      )
    }
    return <input ref={ref} className={cls} {...props} />
  }
)

GitHubInput.displayName = 'GitHubInput'
export default GitHubInput
```

- [ ] **Step 3: Write GitHubBadge.tsx**

```tsx
import type { ReactNode } from 'react'

type BadgeVariant = 'default' | 'success' | 'danger' | 'warning' | 'accent'

interface GitHubBadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

export default function GitHubBadge({ variant = 'default', children, className = '' }: GitHubBadgeProps) {
  return <span className={`gh-badge gh-badge--${variant} ${className}`}>{children}</span>
}
```

- [ ] **Step 4: Write GitHubAlert.tsx**

```tsx
import type { ReactNode } from 'react'

interface GitHubAlertProps {
  variant: 'info' | 'success' | 'warning' | 'danger'
  title?: string
  children: ReactNode
  className?: string
}

export default function GitHubAlert({ variant, title, children, className = '' }: GitHubAlertProps) {
  return (
    <div className={`gh-alert gh-alert--${variant} ${className}`} role="alert">
      {title && <p className="gh-alert-title">{title}</p>}
      <div className="gh-alert-body">{children}</div>
    </div>
  )
}
```

- [ ] **Step 5: Write GitHubTabNav.tsx**

```tsx
interface Tab {
  value: string
  label: string
  count?: number
}

interface GitHubTabNavProps {
  tabs: Tab[]
  active: string
  onChange: (value: string) => void
  className?: string
}

export default function GitHubTabNav({ tabs, active, onChange, className = '' }: GitHubTabNavProps) {
  return (
    <nav className={`gh-tabnav ${className}`}>
      {tabs.map(tab => (
        <button
          key={tab.value}
          className={`gh-tabnav-item ${tab.value === active ? 'gh-tabnav-item--active' : ''}`}
          onClick={() => onChange(tab.value)}
          type="button"
        >
          <span>{tab.label}</span>
          {tab.count !== undefined && <span className="gh-tabnav-count">{tab.count}</span>}
        </button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 6: Write index.ts**

```ts
export { default as GitHubButton } from './GitHubButton'
export { default as GitHubInput } from './GitHubInput'
export { default as GitHubBadge } from './GitHubBadge'
export { default as GitHubAlert } from './GitHubAlert'
export { default as GitHubTabNav } from './GitHubTabNav'
```

- [ ] **Step 7: Write components.css**

```css
/* ===== GitHub Button ===== */
.gh-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid var(--gh-border);
  border-radius: var(--gh-radius);
  font-family: var(--gh-font);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--gh-transition),
              color var(--gh-transition),
              border-color var(--gh-transition),
              box-shadow var(--gh-transition);
  user-select: none;
  text-decoration: none;
  white-space: nowrap;
  line-height: 1.4;
}
.gh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.gh-btn:active { transform: scale(0.98); }

.gh-btn--sm { padding: 4px 10px; font-size: var(--gh-text-sm); }
.gh-btn--md { padding: 6px 14px; font-size: var(--gh-text-sm); }
.gh-btn--lg { padding: 8px 20px; font-size: var(--gh-text-base); }
.gh-btn--full { width: 100%; }

.gh-btn--primary {
  background: var(--gh-accent);
  color: #fff;
  border-color: var(--gh-accent);
}
.gh-btn--primary:hover:not(:disabled) {
  background: var(--gh-accent-hover);
  border-color: var(--gh-accent-hover);
}

.gh-btn--secondary {
  background: var(--gh-canvas);
  color: var(--gh-text);
}
.gh-btn--secondary:hover:not(:disabled) {
  background: var(--gh-btn-hover);
  border-color: var(--gh-border-muted);
}

.gh-btn--danger {
  background: var(--gh-canvas);
  color: var(--gh-danger);
  border-color: var(--gh-border);
}
.gh-btn--danger:hover:not(:disabled) {
  background: var(--gh-danger-soft);
  border-color: var(--gh-danger);
}

.gh-btn--ghost {
  background: transparent;
  color: var(--gh-accent);
  border-color: transparent;
}
.gh-btn--ghost:hover:not(:disabled) {
  background: var(--gh-accent-soft);
}

/* ===== GitHub Input ===== */
.gh-input-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.gh-input {
  padding: 6px 12px;
  font-size: var(--gh-text-sm);
  font-family: var(--gh-font);
  line-height: 1.4;
  color: var(--gh-text);
  background: var(--gh-canvas);
  border: 1px solid var(--gh-border);
  border-radius: var(--gh-radius);
  outline: none;
  transition: border-color var(--gh-transition), box-shadow var(--gh-transition);
  width: 260px;
}
.gh-input--full { width: 100%; }
.gh-input:focus {
  border-color: var(--gh-accent);
  box-shadow: var(--gh-focus-ring);
}
.gh-input::placeholder { color: var(--gh-text-placeholder); }
.gh-input-icon {
  position: absolute;
  left: 10px;
  color: var(--gh-text-tertiary);
  display: flex;
  pointer-events: none;
}
.gh-input-icon + .gh-input { padding-left: 32px; }

/* ===== GitHub Badge ===== */
.gh-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  font-size: var(--gh-text-xs);
  font-weight: 500;
  border-radius: var(--gh-radius);
  border: 1px solid var(--gh-border);
  color: var(--gh-text-secondary);
  background: var(--gh-canvas);
  line-height: 1.4;
}
.gh-badge--success {
  background: var(--gh-success-soft);
  color: var(--gh-success);
  border-color: var(--gh-success-soft);
}
.gh-badge--danger {
  background: var(--gh-danger-soft);
  color: var(--gh-danger);
  border-color: var(--gh-danger-soft);
}
.gh-badge--warning {
  background: var(--gh-warning-soft);
  color: var(--gh-warning);
  border-color: var(--gh-warning-soft);
}
.gh-badge--accent {
  background: var(--gh-accent-soft);
  color: var(--gh-accent);
  border-color: var(--gh-accent-soft);
}

/* ===== GitHub Alert ===== */
.gh-alert {
  padding: 12px 16px;
  border-radius: var(--gh-radius);
  border: 1px solid var(--gh-border);
  border-left-width: 4px;
  background: var(--gh-canvas);
  color: var(--gh-text);
}
.gh-alert--info { border-left-color: var(--gh-accent); }
.gh-alert--success { border-left-color: var(--gh-success-emphasis); }
.gh-alert--warning { border-left-color: var(--gh-warning); }
.gh-alert--danger { border-left-color: var(--gh-danger); }
.gh-alert-title { font-weight: 600; margin-bottom: 4px; }
.gh-alert-body { font-size: var(--gh-text-sm); }

/* ===== GitHub TabNav ===== */
.gh-tabnav {
  display: flex;
  border-bottom: 1px solid var(--gh-border);
  margin-bottom: var(--gh-space-5);
}
.gh-tabnav-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px;
  font-size: var(--gh-text-sm);
  font-family: var(--gh-font);
  font-weight: 500;
  color: var(--gh-text-secondary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color var(--gh-transition), border-color var(--gh-transition);
  margin-bottom: -1px;
}
.gh-tabnav-item:hover { color: var(--gh-text); }
.gh-tabnav-item--active {
  color: var(--gh-text);
  border-bottom-color: var(--gh-accent);
}
.gh-tabnav-count {
  font-size: var(--gh-text-xs);
  color: var(--gh-text-tertiary);
  background: var(--gh-canvas-inset);
  padding: 1px 6px;
  border-radius: var(--gh-radius);
}

/* ===== GitHub Card / Box ===== */
.gh-box {
  background: var(--gh-canvas);
  border: 1px solid var(--gh-border);
  border-radius: var(--gh-radius);
  padding: var(--gh-space-4);
}
.gh-box + .gh-box { margin-top: var(--gh-space-4); }

/* ===== GitHub List Item ===== */
.gh-list-item {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--gh-border-muted);
  transition: background var(--gh-transition);
  text-decoration: none;
  color: inherit;
}
.gh-list-item:last-child { border-bottom: none; }
.gh-list-item:hover { background: var(--gh-canvas-inset); }

/* ===== GitHub Dropdown / Popover ===== */
.gh-popover {
  background: var(--gh-canvas);
  border: 1px solid var(--gh-border);
  border-radius: var(--gh-radius);
  box-shadow: var(--gh-shadow-lg);
  padding: 4px;
  min-width: 180px;
  z-index: 1000;
}
.gh-popover-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: none;
  color: var(--gh-text);
  font-size: var(--gh-text-sm);
  font-family: var(--gh-font);
  cursor: pointer;
  border-radius: var(--gh-radius);
  text-align: left;
  transition: background var(--gh-transition);
}
.gh-popover-item:hover { background: var(--gh-btn-hover); }
.gh-popover-divider {
  height: 1px;
  background: var(--gh-border);
  margin: 4px 0;
}

/* ===== GitHub Table ===== */
.gh-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--gh-text-sm);
}
.gh-table th {
  text-align: left;
  padding: 10px 16px;
  font-weight: 500;
  color: var(--gh-text-secondary);
  border-bottom: 1px solid var(--gh-border);
  white-space: nowrap;
}
.gh-table td {
  padding: 10px 16px;
  vertical-align: middle;
  border-bottom: 1px solid var(--gh-border-muted);
}
.gh-table tr:last-child td { border-bottom: none; }
.gh-table tr:hover td { background: var(--gh-canvas-inset); }

/* ===== GitHub Dialog ===== */
.gh-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(31, 35, 40, 0.4);
}
.gh-dialog {
  background: var(--gh-canvas);
  border: 1px solid var(--gh-border);
  border-radius: var(--gh-radius);
  box-shadow: var(--gh-shadow-xl);
  padding: var(--gh-space-5);
  width: 90%;
  max-width: 440px;
  max-height: 80vh;
  overflow-y: auto;
}
.gh-dialog-title { font-size: var(--gh-text-base); font-weight: 600; margin-bottom: var(--gh-space-4); }
.gh-dialog-actions { display: flex; gap: var(--gh-space-2); justify-content: flex-end; margin-top: var(--gh-space-4); }

/* ===== GitHub Page Header ===== */
.gh-page-header {
  padding-bottom: var(--gh-space-4);
  border-bottom: 1px solid var(--gh-border);
  margin-bottom: var(--gh-space-5);
}
.gh-page-header h1 { font-size: var(--gh-text-xl); margin-bottom: var(--gh-space-1); }
.gh-page-header p { color: var(--gh-text-secondary); font-size: var(--gh-text-sm); }

/* ===== GitHub Actions Row ===== */
.gh-actions {
  display: flex;
  align-items: center;
  gap: var(--gh-space-2);
  justify-content: flex-end;
}
```

- [ ] **Step 8: Commit**

```bash
git add client/src/components/ui/ client/src/styles/components.css
git commit -m "feat: add GitHub-style UI component library and components.css"
```

---

## Phase 4: Global Layout — Header, Sidebar, Footer

### Task 4.1: Create GitHubHeader

**Files:**
- Create: `client/src/components/GitHubHeader.tsx`
- Rewrite: `client/src/components/Navbar.tsx` (re-export GitHubHeader or delete and update imports)

**Interfaces:**
- Consumes: `useAuth()`, `useTheme()`
- Produces: `<GitHubHeader>` — fixed 64px top bar, logo + nav links + search + theme toggle + user menu

- [ ] **Step 1: Write GitHubHeader.tsx**

```tsx
import { memo, useState, useRef, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import UserAvatar from './UserAvatar'

interface Props { onMenuToggle: () => void }

const navItems = [
  { path: '/', label: 'Overview' },
  { path: '/posts', label: 'Repositories' },
  { path: '/drive', label: 'Drive' },
  { path: '/features', label: 'Features' },
]

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
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 8 8A8.013 8.013 0 0 0 8 0Zm0 14.5a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Z"/></svg>
  ) : theme === 'dark' ? (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M6 .278a.768.768 0 0 1 .08.858 7.208 7.208 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277.527 0 1.04-.055 1.533-.16a.787.787 0 0 1 .81.316.733.733 0 0 1-.031.893A8.349 8.349 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.752.752 0 0 1 6 .278Z"/></svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5.657-8.157a.75.75 0 0 1 0 1.061l-1.061 1.06a.749.749 0 0 1-1.06-1.06l1.06-1.061a.75.75 0 0 1 1.061 0Zm-9.193 9.193a.75.75 0 0 1 0 1.061l-1.06 1.061a.75.75 0 1 1-1.061-1.061l1.06-1.061a.75.75 0 0 1 1.061 0ZM16 8a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5h1.5A.75.75 0 0 1 16 8ZM2.25 8a.75.75 0 0 1-.75.75H0a.75.75 0 0 1 0-1.5h1.5a.75.75 0 0 1 .75.75ZM2.404 3.404a.749.749 0 0 1 1.061 0l1.06 1.06a.75.75 0 1 1-1.06 1.061l-1.061-1.061a.75.75 0 0 1 0-1.06ZM12.596 12.596a.75.75 0 0 1 1.061 0l1.061 1.06a.75.75 0 0 1-1.061 1.061l-1.06-1.06a.75.75 0 0 1 0-1.062Z"/></svg>
  )

  return (
    <header className="gh-header">
      <div className="gh-header-inner">
        <button className="gh-header-menu-btn gh-visible-mobile" onClick={onMenuToggle} aria-label="Toggle menu">
          <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75A.75.75 0 0 1 1.75 2h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 2.75Zm0 5A.75.75 0 0 1 1.75 7h12.5a.75.75 0 0 1 0 1.5H1.75A.75.75 0 0 1 1 7.75ZM1.75 12a.75.75 0 0 0 0 1.5h12.5a.75.75 0 0 0 0-1.5H1.75Z"/></svg>
        </button>
        <Link to="/" className="gh-header-logo">
          <svg width="24" height="24" viewBox="0 0 16 16" fill="var(--gh-accent)">
            <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.46-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/>
          </svg>
          <span className="gh-hidden-tablet">Line Web</span>
        </Link>
        <nav className="gh-header-nav">
          {navItems.map(item => (
            <Link key={item.path} to={item.path} className={`gh-header-link ${location.pathname === item.path ? 'gh-header-link--active' : ''}`}>
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
                <span className="gh-header-username gh-hidden-mobile">{user.username}</span>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M6 8.825a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 0 1 1.06-1.06L6 6.939l3.47-3.47a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-.53.22Z"/></svg>
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
```

- [ ] **Step 2: Commit**

- [ ] **Step 2: Commit**

### Task 4.2: Create GitHubSidebar

**Files:**
- Create: `client/src/components/GitHubSidebar.tsx`

**Interfaces:**
- Consumes: `useAuth()`, `useLocation()`
- Produces: `<GitHubSidebar collapsed? onToggle?>`

- [ ] **Step 1: Write GitHubSidebar.tsx**

```tsx
import { memo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  collapsed: boolean
  mobileOpen: boolean
  onClose: () => void
  onToggleCollapse: () => void
}

interface SidebarItem { path: string; label: string; icon: string }

const sections: { title: string; items: SidebarItem[]; requireAuth?: boolean; requireAdmin?: boolean }[] = [
  {
    title: 'Home',
    items: [
      { path: '/', label: 'Overview', icon: 'M1.75 1a.75.75 0 0 0-.75.75v12.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 0-1.5H2.5V1.75A.75.75 0 0 0 1.75 1Z M8 5.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 5.5Z M1.75 11.5h12.5v1.5H1.75v-1.5Z' },
    ]
  },
  {
    title: 'Create', requireAuth: true,
    items: [
      { path: '/admin/new', label: 'New Post', icon: 'M2.5 1.75a.25.25 0 0 1 .25-.25h10.5a.25.25 0 0 1 .25.25v10.5a.25.25 0 0 1-.25.25H2.75a.25.25 0 0 1-.25-.25V1.75ZM2.75 0A1.75 1.75 0 0 0 1 1.75v10.5C1 13.216 1.784 14 2.75 14h10.5A1.75 1.75 0 0 0 15 12.25V1.75A1.75 1.75 0 0 0 13.25 0H2.75Z M8 4.5a.75.75 0 0 1 .75.75v2h2a.75.75 0 0 1 0 1.5h-2v2a.75.75 0 0 1-1.5 0v-2h-2a.75.75 0 0 1 0-1.5h2v-2A.75.75 0 0 1 8 4.5Z' },
    ]
  },
  {
    title: 'Explore',
    items: [
      { path: '/posts', label: 'Repositories', icon: 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.25.25h-3.5a.25.25 0 0 1-.25-.25Zm-2 0a.25.25 0 0 1 .25-.25h.75a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.25.25h-.75a.25.25 0 0 1-.25-.25Z' },
      { path: '/drive', label: 'Files', icon: 'M0 2.75C0 1.784.784 1 1.75 1H5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1h6.75c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0 1 14.25 15H1.75A1.75 1.75 0 0 1 0 13.25Zm1.75-.25a.25.25 0 0 0-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 0 0 .25-.25v-8.5a.25.25 0 0 0-.25-.25H7.5c-.55 0-1.07-.26-1.4-.7l-.9-1.2a.25.25 0 0 0-.2-.1Z' },
      { path: '/features', label: 'About', icon: 'M6.354.646a.5.5 0 0 1 .708 0l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L10.043 5 6.354 1.354a.5.5 0 0 1 0-.708Z' },
    ]
  },
  {
    title: 'Personal',
    items: [
      { path: '/profile', label: 'Profile', icon: 'M2 1.75C2 .784 2.784 0 3.75 0h8.5C13.216 0 14 .784 14 1.75v12.5a1.75 1.75 0 0 1-1.75 1.75h-8.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25V1.75a.25.25 0 0 0-.25-.25Z M5.5 2.75a.75.75 0 0 1 0-1.5h5a.75.75 0 0 1 0 1.5Z M8 12a.75.75 0 0 0 .75-.75v-3.5a.75.75 0 0 0-1.5 0v3.5c0 .414.336.75.75.75Z' },
    ]
  },
]

export default memo(function GitHubSidebar({ collapsed, mobileOpen, onClose, onToggleCollapse }: Props) {
  const { user, isAdmin } = useAuth()
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <>
      {mobileOpen && <div className="gh-sidebar-overlay" onClick={onClose} />}
      <aside className={`gh-sidebar ${collapsed ? 'gh-sidebar--collapsed' : ''} ${mobileOpen ? 'gh-sidebar--open' : ''}`}>
        <nav className="gh-sidebar-nav">
          {sections.map(section => {
            if (section.requireAuth && !user) return null
            if (section.requireAdmin && !isAdmin) return null
            // Determine which items to show
            const visibleItems = section.items.filter(item => {
              if (item.path.startsWith('/admin') && !isAdmin) return false
              if (item.path.startsWith('/profile') && !user) return false
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
                    className={`gh-sidebar-item ${isActive(item.path) ? 'gh-sidebar-item--active' : ''}`}
                    onClick={onClose}
                  >
                    <svg className="gh-sidebar-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d={item.icon} />
                    </svg>
                    <span className="gh-sidebar-label">{item.label}</span>
                  </Link>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="gh-sidebar-footer">
          <button className="gh-sidebar-item gh-sidebar-collapse-btn" onClick={onToggleCollapse} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
            <svg className="gh-sidebar-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d={collapsed ? 'M6.354.646a.5.5 0 0 1 .708 0l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L10.043 5 6.354 1.354a.5.5 0 0 1 0-.708Z' : 'M3.354.646a.5.5 0 0 0-.708 0l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L-.043 5 3.354 1.354a.5.5 0 0 0 0-.708Z'} />
            </svg>
            <span className="gh-sidebar-label">{collapsed ? 'Expand' : 'Collapse'}</span>
          </button>
        </div>
      </aside>
    </>
  )
})
```

- [ ] **Step 2: Commit**

### Task 4.3: Rewrite Layout.tsx (public layout)

**Files:**
- Rewrite: `client/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `<GitHubHeader>`, `<GitHubSidebar>`, `<Outlet>`
- Produces: new `Layout` — header + sidebar + content area, no wallpaper background, no ambient blobs

- [ ] **Step 1: Write Layout.tsx**

```tsx
import { memo, useState } from 'react'
import { Outlet } from 'react-router-dom'
import GitHubHeader from './GitHubHeader'
import GitHubSidebar from './GitHubSidebar'

export default memo(function Layout() {
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <div className="gh-layout-root">
      <GitHubHeader onMenuToggle={() => setMobileOpen(prev => !prev)} />
      <GitHubSidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onClose={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed(prev => !prev)}
      />
      <main className={`gh-content ${collapsed ? 'gh-content--collapsed' : ''}`}>
        <Outlet />
      </main>
    </div>
  )
})
```

- [ ] **Step 2: Replace Navbar.tsx with a re-export or remove**

The current `Navbar.tsx` is imported in `Layout.tsx`. Since Layout is rewritten, update Navbar.tsx to re-export GitHubHeader for any remaining imports.

In `client/src/components/Navbar.tsx`, replace content with:
```tsx
export { default } from './GitHubHeader'
```

- [ ] **Step 3: Commit**

### Task 4.4: Create layout.css

**Files:**
- Create: `client/src/styles/layout.css`

- [ ] **Step 1: Write layout.css** — styles for header, sidebar, footer, layout root.

```css
/* ===== Header ===== */
.gh-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--gh-nav-height);
  background: var(--gh-canvas-inset);
  border-bottom: 1px solid var(--gh-border);
  z-index: 300;
  padding-top: var(--gh-safe-top);
}
.gh-header-inner {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 var(--gh-space-4);
  max-width: 1600px;
  margin: 0 auto;
}
.gh-header-menu-btn {
  display: none;
  background: none;
  border: none;
  color: var(--gh-text-secondary);
  cursor: pointer;
  padding: 8px;
  margin-right: 8px;
  border-radius: var(--gh-radius);
}
.gh-header-menu-btn:hover { background: var(--gh-btn-hover); }
.gh-header-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--gh-text);
  font-weight: 600;
  font-size: var(--gh-text-sm);
  text-decoration: none;
  margin-right: var(--gh-space-4);
  flex-shrink: 0;
}
.gh-header-nav { display: flex; align-items: center; gap: 2px; }
.gh-header-link {
  padding: 8px 12px;
  font-size: var(--gh-text-sm);
  font-weight: 500;
  color: var(--gh-text-secondary);
  text-decoration: none;
  border-radius: var(--gh-radius);
  transition: background var(--gh-transition), color var(--gh-transition);
}
.gh-header-link:hover { background: var(--gh-btn-hover); color: var(--gh-text); }
.gh-header-link--active { color: var(--gh-text); }
.gh-header-spacer { flex: 1; }
.gh-header-actions { display: flex; align-items: center; gap: var(--gh-space-2); }
.gh-header-user-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--gh-border);
  border-radius: var(--gh-radius);
  background: var(--gh-canvas);
  color: var(--gh-text);
  font-size: var(--gh-text-sm);
  font-family: var(--gh-font);
  cursor: pointer;
  transition: background var(--gh-transition);
}
.gh-header-user-btn:hover { background: var(--gh-btn-hover); }

/* ===== Sidebar ===== */
.gh-sidebar {
  position: fixed;
  top: var(--gh-nav-height);
  left: 0;
  bottom: 0;
  width: var(--gh-sidebar-width);
  background: var(--gh-canvas);
  border-right: 1px solid var(--gh-border);
  z-index: 200;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: width 0.2s ease, transform 0.3s ease;
}
.gh-sidebar--collapsed { width: var(--gh-sidebar-collapsed); }
.gh-sidebar-nav { flex: 1; padding: var(--gh-space-3) var(--gh-space-2); display: flex; flex-direction: column; gap: 2px; }
.gh-sidebar-section { margin-bottom: var(--gh-space-3); }
.gh-sidebar-section-title {
  padding: var(--gh-space-2) var(--gh-space-3);
  font-size: var(--gh-text-xs);
  font-weight: 600;
  color: var(--gh-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.025em;
}
.gh-sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--gh-space-2);
  padding: var(--gh-space-2) var(--gh-space-3);
  border-radius: var(--gh-radius);
  color: var(--gh-text-secondary);
  text-decoration: none;
  font-size: var(--gh-text-sm);
  font-weight: 500;
  transition: background var(--gh-transition), color var(--gh-transition);
  border-left: 3px solid transparent;
}
.gh-sidebar-item:hover { background: var(--gh-btn-hover); color: var(--gh-text); }
.gh-sidebar-item--active {
  background: var(--gh-accent-soft);
  color: var(--gh-accent);
  border-left-color: var(--gh-accent);
}
.gh-sidebar-icon { flex-shrink: 0; width: 16px; height: 16px; }
.gh-sidebar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gh-sidebar-footer { padding: var(--gh-space-3); border-top: 1px solid var(--gh-border); }
.gh-sidebar-collapse-btn { background: none; border: none; cursor: pointer; width: 100%; text-align: left; font-family: var(--gh-font); }
.gh-sidebar-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 199;
}

/* Collapsed state: hide labels, center icons */
.gh-sidebar--collapsed .gh-sidebar-label,
.gh-sidebar--collapsed .gh-sidebar-section-title,
.gh-sidebar--collapsed .gh-sidebar-collapse-btn .gh-sidebar-label { display: none; }
.gh-sidebar--collapsed .gh-sidebar-item { justify-content: center; padding: var(--gh-space-2); border-left: none; }
.gh-sidebar--collapsed .gh-sidebar-section { margin-bottom: var(--gh-space-2); }

/* ===== Footer ===== */
.gh-footer {
  padding: var(--gh-space-6) var(--gh-space-4);
  border-top: 1px solid var(--gh-border);
  margin-top: var(--gh-space-7);
  text-align: center;
}
.gh-footer-links {
  display: flex;
  justify-content: center;
  gap: var(--gh-space-4);
  flex-wrap: wrap;
  margin-bottom: var(--gh-space-3);
}
.gh-footer-links a {
  font-size: var(--gh-text-sm);
  color: var(--gh-text-tertiary);
  text-decoration: none;
  transition: color var(--gh-transition);
}
.gh-footer-links a:hover { color: var(--gh-accent); }
.gh-footer-copy { font-size: var(--gh-text-xs); color: var(--gh-text-tertiary); }
```

- [ ] **Step 2: Add Footer component to Layout.tsx**

Add this inside `<main>` after `<Outlet />`:
```tsx
<footer className="gh-footer">
  <div className="gh-footer-links">
    <a href="/features">About</a>
    <a href="/posts">Repositories</a>
    <a href="/drive">Drive</a>
    <a href="/">Status</a>
  </div>
  <p className="gh-footer-copy">© {new Date().getFullYear()} LineWeb</p>
</footer>
```

- [ ] **Step 2: Commit**

```

Since this is a very large plan, let me write the remaining phases at a higher level to keep the file manageable while still being actionable.

---

## Phase 5: Public Pages

### Task 5.1: Rewrite HomePage → GitHub Dashboard layout
**Files:** `client/src/pages/HomePage.tsx`

Replace all content. Delete `legacy visual wrapper`, `StatsCard` (old), hero section, bento grid, ambient blobs, scroll hint. Use Dashboard layout:

```tsx
import { Link } from 'react-router-dom'
import { usePostsList } from '../hooks/useQueries'
import { GitHubButton } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'

export default function HomePage() {
  const { user } = useAuth()
  const { data: postsData } = usePostsList(1, undefined, undefined, 5)
  const recentPosts = postsData?.posts ?? []

  return (
    <div className="gh-page-container">
      <div className="gh-dashboard">
        {/* Left column — Profile card (if logged in) / Welcome card */}
        <aside className="gh-dashboard-left">
          <div className="gh-box">
            {user ? (
              <>
                <h3>Welcome back</h3>
                <p className="gh-text-secondary">{user.username}</p>
                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <Link to="/profile"><GitHubButton variant="secondary" size="sm">View profile</GitHubButton></Link>
                </div>
              </>
            ) : (
              <>
                <h3>Line Web</h3>
                <p className="gh-text-secondary">Personal site & knowledge hub</p>
                <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                  <Link to="/login"><GitHubButton variant="primary" size="sm">Sign in</GitHubButton></Link>
                  <Link to="/register"><GitHubButton variant="secondary" size="sm">Sign up</GitHubButton></Link>
                </div>
              </>
            )}
          </div>
        </aside>

        {/* Main feed */}
        <section className="gh-dashboard-main">
          <div className="gh-box">
            <h3>Recent activity</h3>
            {recentPosts.length === 0 ? (
              <p className="gh-text-secondary" style={{ marginTop: 12 }}>No posts yet.</p>
            ) : (
              recentPosts.map((post: any) => (
                <Link key={post.id} to={`/posts/${post.slug}`} className="gh-list-item" style={{ marginTop: 8 }}>
                  <span className="gh-repo-circle" style={{ backgroundColor: 'var(--gh-accent)' }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{post.title}</div>
                    <div className="gh-text-secondary" style={{ fontSize: 'var(--gh-text-xs)' }}>
                      {post.author?.username} · {new Date(post.createdAt).toLocaleDateString('zh-CN')}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        {/* Right column — stats / health */}
        <aside className="gh-dashboard-right">
          <div className="gh-box">
            <h3>Quick links</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              <Link to="/posts"><GitHubButton variant="secondary" size="sm" fullWidth>Browse posts</GitHubButton></Link>
              <Link to="/drive"><GitHubButton variant="secondary" size="sm" fullWidth>Drive</GitHubButton></Link>
              {user?.canAccessDrive && <Link to="/drive"><GitHubButton variant="secondary" size="sm" fullWidth>Upload files</GitHubButton></Link>}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
```

Also add dashboard CSS to `pages.css`:
```css
.gh-dashboard {
  display: grid;
  grid-template-columns: 280px 1fr 280px;
  gap: var(--gh-space-4);
  align-items: start;
}
@media (max-width: 1279px) {
  .gh-dashboard { grid-template-columns: 1fr; }
  .gh-dashboard-left, .gh-dashboard-right { display: none; }
}
```

### Task 5.2: Rewrite PostsPage → Repositories view
**Files:** `client/src/pages/PostsPage.tsx`

Pattern: replace legacy visual wrapper cards with `gh-box` + `.gh-list-item`. Replace `legacy visual button` with `GitHubButton`. The search bar uses `GitHubInput` with search icon. Keep existing API state (search state, sort toggle, pagination).

Key snippet pattern:
```tsx
import { GitHubButton, GitHubInput } from '../components/ui'

// In JSX:
<div className="gh-page-header">
  <h1>Repositories</h1>
  <p className="gh-text-secondary">Browse all articles</p>
</div>

<div className="gh-box" style={{ marginBottom: 16, display: 'flex', gap: 12, alignItems: 'center', padding: '12px 16px' }}>
  <GitHubInput icon={<svg>...</svg>} placeholder="Search posts..." value={searchInput} onChange={e => setSearchInput(e.target.value)} />
  <GitHubButton variant="secondary" size="sm" onClick={toggleSort}>
    {sort === 'desc' ? 'Newest' : 'Oldest'}
  </GitHubButton>
  {search && <GitHubButton variant="ghost" size="sm" onClick={handleClearSearch}>Clear</GitHubButton>}
</div>

{data?.posts.map(post => (
  <div key={post.id} className="gh-box">
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span className="gh-repo-circle" style={{ backgroundColor: 'var(--gh-accent)', marginTop: 6 }} />
      <div style={{ flex: 1 }}>
        <Link to={`/posts/${post.slug}`} style={{ fontWeight: 600, fontSize: 'var(--gh-text-lg)' }}>{post.title}</Link>
        {post.summary && <p className="gh-text-secondary" style={{ marginTop: 4 }}>{post.summary}</p>}
        <div style={{ marginTop: 8, display: 'flex', gap: 16, fontSize: 'var(--gh-text-xs)', color: 'var(--gh-text-tertiary)' }}>
          <span>{post.author.username}</span>
          <span>{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      </div>
    </div>
  </div>
))}
```

Add `.gh-repo-circle` to components.css:
```css
.gh-repo-circle {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
```

### Task 5.3: Rewrite PostPage → Issue-like detail
**Files:** `client/src/pages/PostPage.tsx`

Pattern: Delete legacy visual wrapper wrapper and gradient title. Use `gh-box` for article. Author sidebar at left (narrow), content at right. Comment section uses timeline style (`.gh-timeline-item`).

Key pattern:
```tsx
<div className="gh-page-container" style={{ maxWidth: 'var(--gh-content-width)' }}>
  <div className="gh-page-header" style={{ marginBottom: 0 }}>
    <h1>{post.title}</h1>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
      <span className="gh-text-secondary">{post.author?.username}</span>
      <span className="gh-text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
    </div>
  </div>

  <div className="gh-post-layout">
    <aside className="gh-post-author">
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--gh-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--gh-text-tertiary)', fontWeight: 600 }}>
        {post.author?.username?.charAt(0).toUpperCase()}
      </div>
    </aside>
    <article className="gh-box gh-post-body">
      {/* Render article content here — same as current but without legacy visual wrapper wrapping */}
    </article>
  </div>

  <section className="gh-timeline">
    {comments.map(comment => (
      <div key={comment.id} className="gh-timeline-item">
        <div className="gh-timeline-avatar">{comment.author?.username?.charAt(0).toUpperCase()}</div>
        <div className="gh-box gh-timeline-body">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{comment.author?.username}</div>
          <div>{comment.body}</div>
        </div>
      </div>
    ))}
  </section>
</div>
```

Add to pages.css:
```css
.gh-post-layout { display: flex; gap: var(--gh-space-4); margin-top: var(--gh-space-4); }
.gh-post-author { width: 48px; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; padding-top: var(--gh-space-2); }
.gh-post-body { flex: 1; padding: var(--gh-space-5) !important; }
.gh-timeline { margin-top: var(--gh-space-6); }
.gh-timeline-item { display: flex; gap: var(--gh-space-3); margin-bottom: var(--gh-space-4); }
.gh-timeline-avatar {
  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
  background: var(--gh-border); display: flex; align-items: center; justify-content: center;
  font-size: var(--gh-text-xs); font-weight: 600; color: var(--gh-text-tertiary);
}
.gh-timeline-body { flex: 1; }
```

### Task 5.4: Rewrite FeaturesPage, DynamicPage, ProfilePage, LoginPage, RegisterPage
**Files:** 5 page files.

All follow the same pattern: delete legacy visual wrapper imports/wrappers, replace with `gh-box` for cards, `GitHubInput` for forms, `GitHubButton` for buttons, `GitHubAlert` for errors. Keep existing API calls and state unchanged.

For LoginPage/RegisterPage: center card (`max-width: 400px`, `margin: 60px auto`), no wallpaper.

### Task 5.5: Rewrite CalculatorPage, GlassTestPage
**Files:** `client/src/pages/CalculatorPage.tsx`, `client/src/pages/GlassTestPage.tsx`
- CalculatorPage: wrap in `gh-box`.
- GlassTestPage: delete or redirect to `/`.

---

## Phase 6: Admin Pages

### Task 6.1: Rewrite AdminLayout → GitHub Settings layout
**Files:** `client/src/components/AdminLayout.tsx`

Left settings sidebar (Account, Posts, Comments, Pages, Users, API Keys, Devices, AI) + right content area. No wallpaper, no glass. Use `gh-box` for each section card.

### Task 6.2: Rewrite all admin pages
**Files:** All 8 files in `client/src/pages/admin/`

Each page uses `gh-box` cards, `gh-table`, `GitHubButton`, `GitHubBadge`, `GitHubInput`. Keep existing API calls and state logic. Delete legacy visual wrapper wrappers and gradient styles.

---

## Phase 7: Drive Module

### Task 7.1: Rewrite DrivePage layout → Repository files
**Files:** `client/src/pages/DrivePage.tsx`

Three-column: left directory tree (collapse on mobile), center file table, right detail panel. Top breadcrumb + toolbar. Use `gh-table`, `gh-box`, `GitHubButton`, `GitHubInput`.

### Task 7.2: Rewrite all drive components
**Files:** All 20 files in `client/src/components/drive/`

Restyle each component to use GitHub design tokens and UI primitives. Delete legacy visual wrapper wrappers. Keep all state logic and API calls unchanged. Key components:
- TreeView: GitHub-style directory tree with indentation and chevrons.
- DriveToolbar: breadcrumb + search + view toggle + action buttons + upload.
- DriveListView/DriveGridView: `gh-table` rows or flat grid cards.
- DriveDetailPanel: `gh-box` with file info.
- DriveDialogs: `gh-dialog` pattern.
- UploadZone: "Add file" dropdown + upload progress bar.
- ContextMenu: `gh-popover` pattern.
- BatchActions, TabList, PathBar, FileAttributes, DrivePreview, DriveNavigation, DownloadToast, MobileNav, FolderPickerDialog, DriveIcons, ThumbnailGrid.

---

## Phase 8: Cleanup & Polish

### Task 8.1: Delete legacy visual effects & related files
**Files to delete:**
- `client/src/styles/legacy-effects.css`
- `client/src/components/legacy-effects/legacy visual wrapper.tsx`
- `client/src/components/legacy-effects/legacy component.tsx`
- `client/src/components/legacy-effects/filter-definitions.svg`
- `client/src/components/legacy-effects/index.ts`
- `client/src/contexts/legacy visual context.tsx` (if not already deleted)
- `client/src/contexts/ContrastContext.tsx`

Delete imports in any remaining files.

### Task 8.2: Remove legacy visual effects inline filters from index.html
**Files:** `client/index.html`
Remove the entire `<svg>` block containing `lg-core`, `lg-core-strong`, `lg-glow` filters.
Remove font preload links for instrument-serif.
Update body background to use CSS variable or transparent.

### Task 8.3: Remove Instrument Serif font loading
**Files:** `client/src/main.tsx`
Remove `import('@fontsource/instrument-serif/...')` calls. Replace loadFonts() with no-op or delete.

### Task 8.4: Remove wallpaper background from public layout
**Files:** `client/src/contexts/WallpaperContext.tsx`
After ThemeContext is in place and Layout no longer uses wallpaper, delete WallpaperContext.tsx or mark it as deprecated. Remove `WallpaperProvider` from App.tsx.

### Task 8.5: Write responsive.css
**Files:** `client/src/styles/responsive.css`

```css
/* >= 1280px: default (sidebar 256px + content)

/* 768-1279px: collapsed sidebar (64px) or hamburger */
@media (max-width: 1279px) {
  .gh-content { margin-left: var(--gh-sidebar-collapsed); }
  .gh-content--collapsed { margin-left: var(--gh-sidebar-collapsed); }
  .gh-sidebar { width: var(--gh-sidebar-collapsed); }
  .gh-sidebar .gh-sidebar-label,
  .gh-sidebar .gh-sidebar-section-title { display: none; }
}

/* < 768px: top header + drawer sidebar */
@media (max-width: 767px) {
  .gh-content { margin-left: 0 !important; padding: var(--gh-space-4); }
  .gh-sidebar {
    transform: translateX(-100%);
    transition: transform 0.3s ease;
    z-index: 500;
  }
  .gh-sidebar.gh-sidebar--open { transform: translateX(0); }
  .gh-sidebar-overlay { display: block; }

  .gh-header-nav { display: none; }
  .gh-header-menu-btn { display: flex; }

  /* Tables → horizontal scroll */
  .gh-table-wrap { overflow-x: auto; }
}
```

### Task 8.6: Update all remaining legacy visual wrapper references
Run grep for any remaining `legacy visual wrapper`, `legacy visual button`, `glass-rise`, `fade-in-stagger`, `ambient-blob`, `lg-` prefix in CSS, `Instrument Serif`, etc. Update or delete each reference.

---

## Phase 9: Test Verification

### Task 9.1: Update existing tests to match new component names/styles
**Files:** All `__tests__/` files

Update test assertions that reference legacy visual effects class names or components. Replace mocked legacy visual wrapper with `gh-box` or simple div.

### Task 9.2: Run build

```bash
cd client && npm run build
```

### Task 9.3: Run tests

```bash
cd client && npm run test
```

### Task 9.4: Visual verification
Start dev server (`npm run dev`) and check:
- All pages render without legacy visual effects.
- theme toggle works (light → dark → auto → light).
- 8px border-radius on all elements.
- No Instrument Serif on titles.
- Flat styling (borders not blur).

---

**Total task estimate:** ~25 tasks across 9 phases.
