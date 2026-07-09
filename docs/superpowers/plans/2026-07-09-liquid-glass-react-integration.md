# liquid-glass-react Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CSS-only glass effect in the LiquidGlass component with liquid-glass-react's SVG displacement refraction, with automatic CSS fallback for non-Chromium browsers and mobile devices.

**Architecture:** Modify the existing `LiquidGlass.tsx` component to conditionally use `liquid-glass-react` internally when SVG displacement is supported (Chromium desktop browsers), falling back to the current CSS-only implementation for Safari/Firefox/mobile. The component's public API (`variant`, `interactive`, `chromatic`, `className`, `style`, `children`) remains unchanged — all 20+ consumer files require zero modifications.

**Tech Stack:** liquid-glass-react@1.1.1 (already installed), React 19, TypeScript, SVG displacement maps

## Global Constraints

- `liquid-glass-react@^1.1.1` already in `client/package.json` — do not add again
- Existing `LiquidGlassProps` interface must not change — all 20+ consumer files depend on it
- CSS classes `lg-surface`, `lg-surface-strong`, `lg-surface-blur`, `lg-surface-strong-blur` must remain functional — `Layout.tsx`, `DynamicPage.tsx`, `PageEditor.tsx` use them directly via `className`
- Mobile (≤768px) must always use CSS-only mode — `globals.css:4713` already downgrades `backdrop-filter` at this breakpoint
- `prefers-reduced-motion: reduce` must disable displacement effects
- `client/src/components/glass/filters.svg` must remain loaded — it serves direct CSS class usage and fallback mode
- All glass component files live in `client/src/components/glass/`

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `client/src/components/glass/useGlassCapabilities.ts` | Browser capability detection hook — returns `{ supportsDisplacement, isMobile }` |
| Modify | `client/src/components/glass/LiquidGlass.tsx` | Add liquid-glass-react integration with CSS fallback branching |
| Create | `client/src/pages/GlassTestPage.tsx` | Side-by-side comparison page for visual verification |
| Modify | `client/src/App.tsx` | Add `/glass-test` route for dev verification |

---

### Task 1: Create browser capability detection hook

**Files:**
- Create: `client/src/components/glass/useGlassCapabilities.ts`

**Interfaces:**
- Produces: `useGlassCapabilities(): { supportsDisplacement: boolean; isMobile: boolean }`

- [ ] **Step 1: Write the capability detection hook**

```typescript
// client/src/components/glass/useGlassCapabilities.ts
import { useState, useEffect } from 'react'

interface GlassCapabilities {
  /** Browser supports SVG feDisplacementMap in backdrop-filter (Chromium desktop) */
  supportsDisplacement: boolean
  /** Mobile device or narrow viewport — skip heavy effects */
  isMobile: boolean
}

/**
 * Detects whether the current browser/device can render SVG displacement
 * effects properly. Only Chromium desktop browsers support feDisplacementMap
 * in backdrop-filter. Safari and Firefox silently ignore it.
 *
 * Mobile devices are always flagged — globals.css already downgrades
 * backdrop-filter at ≤768px, and liquid-glass-react's SVG filters
 * would cause GPU pressure on mobile.
 */
export function useGlassCapabilities(): GlassCapabilities {
  const [capabilities, setCapabilities] = useState<GlassCapabilities>({
    supportsDisplacement: false,
    isMobile: false,
  })

  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase()
    const isChromium = !!window.chrome || ua.includes('chrome') || ua.includes('edg/')
    const isMobile = window.innerWidth <= 768 || /android|iphone|ipad|ipod/i.test(ua)
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    setCapabilities({
      supportsDisplacement: isChromium && !isMobile && !prefersReducedMotion,
      isMobile,
    })
  }, [])

  return capabilities
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors related to `useGlassCapabilities.ts`

- [ ] **Step 3: Commit**

```bash
git add client/src/components/glass/useGlassCapabilities.ts
git commit -m "feat(glass): add browser capability detection hook for SVG displacement"
```

---

### Task 2: Modify LiquidGlass to use liquid-glass-react with fallback

**Files:**
- Modify: `client/src/components/glass/LiquidGlass.tsx`

**Interfaces:**
- Consumes: `useGlassCapabilities()` from Task 1
- Consumes: `LiquidGlass` from `liquid-glass-react` (npm package, already installed)
- Produces: Same `LiquidGlassProps` interface — no consumer changes needed

- [ ] **Step 1: Rewrite LiquidGlass.tsx with dual-mode rendering**

Replace the entire file content:

```tsx
// client/src/components/glass/LiquidGlass.tsx
import React, { useRef, useEffect, memo } from 'react'
import AdvancedGlass from 'liquid-glass-react'
import { useGlassCapabilities } from './useGlassCapabilities'

export interface LiquidGlassProps {
  children: React.ReactNode
  /** strong — 对应 lg-surface-strong；regular — 对应 lg-surface；blur — 对应 lg-surface-strong-blur */
  variant?: 'regular' | 'strong' | 'blur'
  className?: string
  style?: React.CSSProperties
  /** Enable interactive specular highlight (mouse/touch follow) */
  interactive?: boolean
  /** Show chromatic aberration edge refraction */
  chromatic?: boolean
}

/**
 * Map variant + chromatic props to liquid-glass-react props.
 *
 * variant → displacementScale + blurAmount + saturation:
 *   regular:  medium refraction, standard blur (matches lg-surface)
 *   strong:   heavy refraction, thick glass feel (matches lg-surface-strong)
 *   blur:     medium refraction, darker tint for content-heavy surfaces
 *
 * chromatic → aberrationIntensity:
 *   true:  2 (subtle RGB channel separation at edges)
 *   false: 0 (disabled)
 *
 * interactive → elasticity:
 *   true:  0.15 (subtle elastic pull toward cursor)
 *   false: 0 (rigid, no mouse response)
 */
function mapPropsToAdvanced(
  variant: 'regular' | 'strong' | 'blur',
  chromatic: boolean,
  interactive: boolean,
): {
  displacementScale: number
  blurAmount: number
  saturation: number
  aberrationIntensity: number
  elasticity: number
  cornerRadius: number
} {
  const base = {
    aberrationIntensity: chromatic ? 2 : 0,
    elasticity: interactive ? 0.15 : 0,
    cornerRadius: 28, // matches --lg-radius-xl
  }

  switch (variant) {
    case 'strong':
      return { ...base, displacementScale: 80, blurAmount: 0.06, saturation: 140 }
    case 'blur':
      return { ...base, displacementScale: 45, blurAmount: 0.05, saturation: 120 }
    case 'regular':
    default:
      return { ...base, displacementScale: 45, blurAmount: 0.05, saturation: 150 }
  }
}

/* ================================================================
   Advanced Mode — liquid-glass-react with SVG displacement
   Only active on Chromium desktop browsers.
   ================================================================ */
const AdvancedMode = memo(function AdvancedMode({
  children,
  variant,
  className = '',
  style,
  interactive,
  chromatic,
}: Required<Pick<LiquidGlassProps, 'children' | 'variant' | 'interactive' | 'chromatic'>> &
  Pick<LiquidGlassProps, 'className' | 'style'>) {
  const advancedProps = mapPropsToAdvanced(variant, chromatic, interactive)

  return (
    <AdvancedGlass
      {...advancedProps}
      className={className}
      style={style}
    >
      {children}
    </AdvancedGlass>
  )
})

/* ================================================================
   Legacy Mode — CSS-only glass (Safari, Firefox, mobile)
   Preserves the original implementation exactly.
   ================================================================ */
const LegacyMode = memo(function LegacyMode({
  children,
  variant = 'regular',
  className = '',
  style,
  interactive = true,
  chromatic = true,
}: Required<Pick<LiquidGlassProps, 'children' | 'variant' | 'interactive' | 'chromatic'>> &
  Pick<LiquidGlassProps, 'className' | 'style'>) {
  const ref = useRef<HTMLDivElement>(null)
  const specularRef = useRef<HTMLDivElement>(null)

  // Mouse-following specular highlight — 直接操作 DOM 避免重渲染
  useEffect(() => {
    if (!interactive) return
    const el = ref.current
    const specular = specularRef.current
    if (!el || !specular) return

    let cachedRect: DOMRect | null = null
    let rectFrame = 0
    let lastMove = 0
    const throttleMs = window.innerWidth <= 768 ? 50 : 16

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!cachedRect) {
        cachedRect = el.getBoundingClientRect()
        rectFrame = requestAnimationFrame(() => { cachedRect = null })
      }

      const now = Date.now()
      if (now - lastMove < throttleMs) return
      lastMove = now

      let cx = 0, cy = 0
      if ('touches' in e && e.touches.length > 0) {
        cx = e.touches[0].clientX - cachedRect.left
        cy = e.touches[0].clientY - cachedRect.top
      } else if ('clientX' in e) {
        cx = e.clientX - cachedRect.left
        cy = e.clientY - cachedRect.top
      }

      const x = Math.max(5, Math.min(95, (cx / cachedRect.width) * 100))
      const y = Math.max(5, Math.min(95, (cy / cachedRect.height) * 100))
      specular.style.background = `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)`
    }

    el.addEventListener('mousemove', onMove)
    el.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('touchmove', onMove)
      cancelAnimationFrame(rectFrame)
    }
  }, [interactive])

  const isStrong = variant === 'strong' || variant === 'blur'
  const isBlur = variant === 'blur'

  const glassClass = isBlur
    ? 'lg-surface-strong lg-surface-strong-blur'
    : isStrong
      ? 'lg-surface-strong'
      : 'lg-surface'

  const allClass = `${glassClass}${interactive ? '' : ' lg-surface-no-specular'} ${className}`.trim()

  return (
    <div ref={ref} className={allClass} style={style}>
      {/* Interactive specular highlight */}
      <div
        ref={specularRef}
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'inherit',
          pointerEvents: 'none',
          zIndex: 3,
          background: interactive
            ? 'radial-gradient(circle at var(--lg-specular-x, 30%) var(--lg-specular-y, 20%), rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)'
            : 'transparent',
          transition: interactive ? 'background 0.15s ease-out' : 'none',
        } as React.CSSProperties}
      />

      {/* Top edge rim glow */}
      {interactive && (
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

      {/* Chromatic aberration edge refraction */}
      {chromatic && (
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
})

/* ================================================================
   Main Component — auto-selects mode based on browser capabilities
   Public API unchanged — all consumer files work without modification.
   ================================================================ */
const LiquidGlass = memo(function LiquidGlass({
  children,
  variant = 'regular',
  className = '',
  style,
  interactive = true,
  chromatic = true,
}: LiquidGlassProps) {
  const { supportsDisplacement } = useGlassCapabilities()

  const modeProps = {
    variant: variant ?? 'regular',
    interactive: interactive ?? true,
    chromatic: chromatic ?? true,
    className,
    style,
    children,
  }

  if (supportsDisplacement) {
    return <AdvancedMode {...modeProps} />
  }

  return <LegacyMode {...modeProps} />
})

export default LiquidGlass
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify Vite dev server starts**

Run: `cd client && npx vite --host`
Expected: Dev server starts on http://localhost:5173 without errors

- [ ] **Step 4: Commit**

```bash
git add client/src/components/glass/LiquidGlass.tsx
git commit -m "feat(glass): integrate liquid-glass-react with CSS fallback for non-Chromium"
```

---

### Task 3: Create visual comparison test page

**Files:**
- Create: `client/src/pages/GlassTestPage.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `LiquidGlass` from Task 2
- Consumes: `useGlassCapabilities` from Task 1

- [ ] **Step 1: Create GlassTestPage.tsx**

```tsx
// client/src/pages/GlassTestPage.tsx
import { useState } from 'react'
import LiquidGlass from '../components/glass/LiquidGlass'
import { useGlassCapabilities } from '../components/glass/useGlassCapabilities'

/**
 * Dev test page for visual comparison of glass rendering modes.
 * Shows the current browser's capabilities and renders test cards
 * with all variant/interactive/chromatic combinations.
 */
export default function GlassTestPage() {
  const capabilities = useGlassCapabilities()
  const [variant, setVariant] = useState<'regular' | 'strong' | 'blur'>('regular')
  const [interactive, setInteractive] = useState(true)
  const [chromatic, setChromatic] = useState(true)

  return (
    <div className="page container" style={{ padding: '40px 20px' }}>
      <h1 style={{ marginBottom: 8 }}>Glass Effect Test</h1>
      <p style={{ color: 'var(--lg-text-secondary)', marginBottom: 32 }}>
        Browser: {capabilities.supportsDisplacement
          ? '✅ Chromium — SVG displacement active'
          : '⚠️ Non-Chromium — CSS fallback active'}
        {' · '}Mobile: {capabilities.isMobile ? 'Yes' : 'No'}
      </p>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 32, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--lg-text-secondary)' }}>
          Variant:
          <select
            value={variant}
            onChange={(e) => setVariant(e.target.value as typeof variant)}
            style={{
              padding: '4px 8px',
              borderRadius: 8,
              background: 'var(--lg-bg-secondary)',
              color: 'var(--lg-text-primary)',
              border: '1px solid var(--lg-glass-border)',
            }}
          >
            <option value="regular">regular</option>
            <option value="strong">strong</option>
            <option value="blur">blur</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--lg-text-secondary)' }}>
          <input type="checkbox" checked={interactive} onChange={(e) => setInteractive(e.target.checked)} />
          interactive
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--lg-text-secondary)' }}>
          <input type="checkbox" checked={chromatic} onChange={(e) => setChromatic(e.target.checked)} />
          chromatic
        </label>
      </div>

      {/* Test cards grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
        <LiquidGlass variant={variant} interactive={interactive} chromatic={chromatic}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 1 — Simple</h2>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              Basic glass card. Move your mouse over to see interactive effects.
            </p>
          </div>
        </LiquidGlass>

        <LiquidGlass variant={variant} interactive={interactive} chromatic={chromatic}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 2 — Rich Content</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--lg-accent)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontWeight: 600,
              }}>
                JD
              </div>
              <div>
                <p style={{ fontWeight: 500 }}>John Doe</p>
                <p style={{ fontSize: 14, color: 'var(--lg-text-tertiary)' }}>Software Engineer</p>
              </div>
            </div>
            <p style={{ color: 'var(--lg-text-secondary)', fontSize: 14 }}>
              Tests complex content layouts inside glass.
            </p>
          </div>
        </LiquidGlass>

        <LiquidGlass variant={variant} interactive={false} chromatic={chromatic}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 3 — Static (interactive=false)</h2>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              No mouse-following highlight. Used for content-heavy areas like article text.
            </p>
          </div>
        </LiquidGlass>

        <LiquidGlass variant={variant} interactive={interactive} chromatic={false}>
          <div style={{ padding: 24 }}>
            <h2 style={{ marginBottom: 12 }}>Card 4 — No Chromatic</h2>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              No color separation at edges (chromatic=false).
            </p>
          </div>
        </LiquidGlass>
      </div>

      {/* Full-width surface */}
      <div style={{ marginTop: 32 }}>
        <h2 style={{ marginBottom: 16 }}>Full-width Surface</h2>
        <LiquidGlass variant="strong" interactive={interactive} chromatic={chromatic}>
          <div style={{ padding: 32 }}>
            <p style={{ color: 'var(--lg-text-secondary)' }}>
              Wide glass surface test. In advanced mode, SVG displacement refraction shows
              visible edge bending. In legacy mode, you see CSS-only frosted glass.
            </p>
          </div>
        </LiquidGlass>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add lazy import and route to App.tsx**

In `client/src/App.tsx`, add after line 18 (after the `DeviceMonitorPage` lazy import):

```typescript
const GlassTestPage = lazy(() => import('./pages/GlassTestPage'))
```

Inside the main site `<Route element={<Layout />}>` block, add after the `/drive` route (after line 64):

```tsx
<Route path="/glass-test" element={<GlassTestPage />} />
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Open test page in browser**

Run: `cd client && npx vite --host`
Open: http://localhost:5173/glass-test
Expected: Page renders with test cards, browser detection shows correct status

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/GlassTestPage.tsx client/src/App.tsx
git commit -m "feat(glass): add visual comparison test page at /glass-test"
```

---

### Task 4: Visual regression verification across consumer pages

**Files:**
- No file changes — verification only

- [ ] **Step 1: Verify HomePage**

Open: http://localhost:5173/
Expected: Hero section and post cards render with glass effect (advanced on Chromium, CSS fallback otherwise)

- [ ] **Step 2: Verify LoginPage and RegisterPage**

Open: http://localhost:5173/login and http://localhost:5173/register
Expected: Form cards render correctly with `variant="strong"` glass

- [ ] **Step 3: Verify PostsPage and PostPage**

Open: http://localhost:5173/posts
Expected: Post cards (`variant="blur"`) and toolbar render correctly

- [ ] **Step 4: Verify DrivePage (requires login)**

Open: http://localhost:5173/drive
Expected: Grid/list views, toolbar, dialogs all render correctly

- [ ] **Step 5: Verify Admin pages (requires admin login)**

Open: http://localhost:5173/admin
Expected: Tables, modals, stat cards all render correctly

- [ ] **Step 6: Verify mobile viewport**

Open Chrome DevTools → Toggle device toolbar → iPhone 14 Pro
Expected: CSS fallback mode activates (mobile detection), all pages render correctly

- [ ] **Step 7: Verify Safari/Firefox (if available)**

Test in Safari or Firefox
Expected: CSS fallback mode activates (non-Chromium detection), all pages render correctly

- [ ] **Step 8: Commit final state**

```bash
git add -A
git commit -m "feat(glass): liquid-glass-react integration complete with cross-browser fallback"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ Browser capability detection → Task 1
- ✅ liquid-glass-react integration with CSS fallback → Task 2
- ✅ Visual verification test page → Task 3
- ✅ Cross-browser/cross-device verification → Task 4
- ✅ Existing `LiquidGlassProps` interface preserved → Task 2 (unchanged)
- ✅ CSS classes remain functional for direct usage → Task 2 (LegacyMode uses them)
- ✅ Mobile always uses CSS-only → Task 1 (isMobile check) + Task 2 (fallback)
- ✅ `prefers-reduced-motion` respected → Task 1 (capability detection)
- ✅ `filters.svg` remains loaded → Task 2 (no changes to filters.svg)

**2. Placeholder scan:**
- ✅ No TBD/TODO/placeholders
- ✅ All code blocks complete
- ✅ All commands have expected output descriptions

**3. Type consistency:**
- ✅ `LiquidGlassProps` identical in Task 2 definition and all consumers
- ✅ `useGlassCapabilities` return type consistent between Task 1 and Task 2
- ✅ `mapPropsToAdvanced` return type matches liquid-glass-react's expected props
