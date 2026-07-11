# Liquid Glass Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-user toggle on the profile page to enable/disable the Liquid Glass visual effect, persisting in `user.settings`.

**Architecture:** CSS `data-glass` attribute on `<html>` controls glass intensity globally. A new `GlassContext` reads the setting from `AuthContext` and syncs the DOM attribute. The `LiquidGlass` component conditionally renders interactive layers based on context.

**Tech Stack:** React 19, TypeScript, CSS custom properties, existing `user.settings` JSON pattern

## Global Constraints

- Settings stored as JSON string in `user.settings` via `PUT /api/auth/settings`
- Default glass is ON (`true`) — backward compatible with existing users
- When glass is OFF: keep `backdrop-filter` blur, remove SVG refraction (`url(#lg-core)`), interactive specular, chromatic aberration
- Context nesting: `GlassProvider` goes between `WallpaperProvider` and `ContrastProvider`
- No backend changes required — reuses existing settings API

---

### Task 1: Create GlassContext

**Files:**
- Create: `client/src/contexts/GlassContext.tsx`
- Modify: `client/src/App.tsx:4-6` (add import + provider)

**Interfaces:**
- Consumes: `useAuth()` from `AuthContext` — reads `user.settings`
- Consumes: `AuthContext.updateSettings(settings: string)` — persists changes
- Produces: `useGlass()` hook — returns `{ glassEnabled: boolean, toggleGlass: () => void }`

- [ ] **Step 1: Create GlassContext.tsx**

```tsx
// client/src/contexts/GlassContext.tsx
import { createContext, useContext, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

interface GlassContextType {
  glassEnabled: boolean
  toggleGlass: () => void
}

const GlassContext = createContext<GlassContextType | null>(null)

export function GlassProvider({ children }: { children: ReactNode }) {
  const { user, updateSettings } = useAuth()

  const glassEnabled = useMemo(() => {
    if (!user?.settings) return true
    try {
      const parsed = JSON.parse(user.settings)
      return parsed.glass !== false // default true
    } catch {
      return true
    }
  }, [user?.settings])

  // Sync data-glass attribute on <html>
  useEffect(() => {
    document.documentElement.dataset.glass = glassEnabled ? 'on' : 'off'
  }, [glassEnabled])

  const toggleGlass = useCallback(async () => {
    if (!user?.settings) {
      await updateSettings(JSON.stringify({ glass: false }))
      return
    }
    try {
      const parsed = JSON.parse(user.settings)
      const newValue = parsed.glass !== false ? false : true
      await updateSettings(JSON.stringify({ ...parsed, glass: newValue }))
    } catch {
      await updateSettings(JSON.stringify({ glass: false }))
    }
  }, [user?.settings, updateSettings])

  const value = useMemo<GlassContextType>(() => ({
    glassEnabled,
    toggleGlass,
  }), [glassEnabled, toggleGlass])

  return (
    <GlassContext.Provider value={value}>
      {children}
    </GlassContext.Provider>
  )
}

export function useGlass() {
  const ctx = useContext(GlassContext)
  if (!ctx) throw new Error('useGlass must be used within GlassProvider')
  return ctx
}
```

- [ ] **Step 2: Add GlassProvider to App.tsx**

In `client/src/App.tsx`, add import and wrap with provider between `WallpaperProvider` and `ContrastProvider`:

```tsx
// Add import at line 5
import { GlassProvider } from './contexts/GlassContext'

// In the JSX, change:
//   <WallpaperProvider>
//     <ContrastProvider>
// to:
//   <WallpaperProvider>
//     <GlassProvider>
//       <ContrastProvider>
```

The nesting becomes:
```
BrowserRouter > AuthProvider > WallpaperProvider > GlassProvider > ContrastProvider > DownloadProvider > Routes
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/contexts/GlassContext.tsx client/src/App.tsx
git commit -m "feat: add GlassContext for liquid glass toggle state"
```

---

### Task 2: Add CSS rules for glass-off state

**Files:**
- Modify: `client/src/styles/glass.css:279` (append at end)

**Interfaces:**
- Consumes: `data-glass` attribute on `<html>` element (set by GlassContext)
- Produces: CSS rules that override glass effects when `data-glass="off"`

- [ ] **Step 1: Append glass-off CSS rules**

Append to end of `client/src/styles/glass.css`:

```css
/* ============================================================
   Glass Toggle — data-glass="off" overrides
   Keeps frosted blur (backdrop-filter on ::before), removes
   SVG refraction, static specular highlight, and interactive layers.
   ============================================================ */
[data-glass="off"] .lg-surface,
[data-glass="off"] .lg-surface-strong {
  backdrop-filter: blur(1.7px) saturate(150%);
  -webkit-backdrop-filter: blur(1.7px) saturate(150%);
}

[data-glass="off"] .lg-surface::after,
[data-glass="off"] .lg-surface-strong::after {
  display: none;
}

[data-glass="off"] .navbar {
  backdrop-filter: blur(1.7px) saturate(170%);
  -webkit-backdrop-filter: blur(1.7px) saturate(170%);
}

[data-glass="off"] .lg-input {
  backdrop-filter: blur(1.7px) saturate(150%);
  -webkit-backdrop-filter: blur(1.7px) saturate(150%);
}

[data-glass="off"] .theme-toggle {
  backdrop-filter: blur(1.7px) saturate(150%);
  -webkit-backdrop-filter: blur(1.7px) saturate(150%);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/glass.css
git commit -m "feat: add CSS rules for glass-off state"
```

---

### Task 3: Update LiquidGlass component to respect glass setting

**Files:**
- Modify: `client/src/components/glass/LiquidGlass.tsx:1-2,32-39,114-187`

**Interfaces:**
- Consumes: `useGlass()` from `GlassContext` — reads `glassEnabled`
- Produces: Conditional rendering of interactive/highlight layers

- [ ] **Step 1: Add useGlass import and conditional rendering**

In `client/src/components/glass/LiquidGlass.tsx`:

Add import at line 1:
```tsx
import { useGlass } from '../../contexts/GlassContext'
```

Add hook call inside the component (after line 40, inside the memo function):
```tsx
const { glassEnabled } = useGlass()
```

Replace the return block (lines 114-187) to conditionally render layers:
```tsx
  return (
    <div
      ref={ref}
      className={allClass}
      style={style}
    >
      {/* Interactive specular highlight — only when glass is fully enabled */}
      {glassEnabled && (
        <div
          ref={specularRef}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 3,
            '--lg-specular-x': '30%',
            '--lg-specular-y': '20%',
            opacity: 0,
            background: interactive
              ? 'radial-gradient(circle at var(--lg-specular-x, 30%) var(--lg-specular-y, 20%), rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)'
              : 'transparent',
            transition: interactive ? 'opacity 0.6s ease-out' : 'none',
          } as React.CSSProperties}
        />
      )}

      {/* Top edge rim glow — only when glass is fully enabled */}
      {glassEnabled && interactive && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            pointerEvents: 'none',
            zIndex: 1,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.10) 0%, transparent 40%)',
          }}
        />
      )}

      {/* Chromatic aberration — only when glass is fully enabled */}
      {glassEnabled && chromatic && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 'inherit',
              border: '1.5px solid rgba(255,50,50,0.06)',
              pointerEvents: 'none',
              zIndex: 0,
              transform: 'translateX(1.5px)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: -2,
              borderRadius: 'inherit',
              border: '1.5px solid rgba(50,100,255,0.06)',
              pointerEvents: 'none',
              zIndex: 0,
              transform: 'translateX(-1.5px)',
            }}
          />
        </>
      )}

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 2 }}>
        {children}
      </div>
    </div>
  )
```

Also update the `useEffect` for mouse tracking (line 44) to include `glassEnabled` in the guard:
```tsx
  useEffect(() => {
    if (!interactive || !glassEnabled) return
    // ... rest of the effect
  }, [interactive, glassEnabled])
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add client/src/components/glass/LiquidGlass.tsx
git commit -m "feat: LiquidGlass respects glass toggle setting"
```

---

### Task 4: Add glass toggle UI to ProfilePage

**Files:**
- Modify: `client/src/pages/ProfilePage.tsx:1-8,273-286` (add import + toggle section)

**Interfaces:**
- Consumes: `useGlass()` from `GlassContext` — reads `glassEnabled`, calls `toggleGlass`
- Produces: Toggle switch UI in the personalization card

- [ ] **Step 1: Add useGlass import**

In `client/src/pages/ProfilePage.tsx`, add import at line 8:
```tsx
import { useGlass } from '../contexts/GlassContext'
```

Add hook call inside the component (after line 13):
```tsx
const { glassEnabled, toggleGlass } = useGlass()
```

- [ ] **Step 2: Add glass toggle section**

Insert the glass toggle section after the background settings and before the save button. Add this block before the `{/* 保存 */}` comment (before line 273):

```tsx
        {/* 液态玻璃效果 */}
        <div style={{ marginBottom: '22px' }}>
          <span className="profile-label">液态玻璃效果</span>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 18px', borderRadius: '14px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
          }}>
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--lg-text-primary)', marginBottom: '2px' }}>
                液态玻璃
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--lg-text-tertiary)' }}>
                {glassEnabled ? 'SVG 折射 + 交互高光 + 色差' : '关闭后仅保留毛玻璃'}
              </div>
            </div>
            <button
              onClick={toggleGlass}
              style={{
                position: 'relative', width: '48px', height: '28px', borderRadius: '14px',
                border: '1px solid', flexShrink: 0, cursor: 'pointer',
                borderColor: glassEnabled ? 'var(--lg-accent)' : 'rgba(255,255,255,0.15)',
                background: glassEnabled ? 'var(--lg-accent)' : 'rgba(255,255,255,0.08)',
                transition: 'all 0.25s ease',
              }}
            >
              <span style={{
                position: 'absolute', top: '2px',
                left: glassEnabled ? '22px' : '2px',
                width: '22px', height: '22px', borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                transition: 'left 0.25s ease',
              }} />
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ProfilePage.tsx
git commit -m "feat: add glass toggle switch to profile page"
```

---

### Task 5: End-to-end verification

**Files:** None (manual testing)

- [ ] **Step 1: Start dev server**

Run: `npm run dev` from project root
Expected: Both client and server start without errors

- [ ] **Step 2: Test glass toggle flow**

1. Open browser to `http://localhost:5173`
2. Login with existing account
3. Navigate to `/profile`
4. Verify the glass toggle appears in the personalization card
5. Click the toggle to turn glass OFF
6. Verify: cards lose SVG refraction and interactive highlight, keep frosted blur
7. Refresh the page — verify glass is still OFF (persisted)
8. Click toggle to turn glass ON
9. Verify: full glass effects restored
10. Logout and login again — verify setting persisted

- [ ] **Step 3: Test backward compatibility**

1. Login with an account that has no `glass` field in settings
2. Verify glass defaults to ON
3. Verify toggle shows ON state

- [ ] **Step 4: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: glass toggle edge cases from testing"
```
