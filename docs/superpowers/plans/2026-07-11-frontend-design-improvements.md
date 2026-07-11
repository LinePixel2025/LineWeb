# Frontend Design Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement typography, color, hero, navbar scroll, page transition, and spacing improvements across the frontend.

**Architecture:** All changes are CSS variable additions + component/HTML updates. No new packages beyond Google Fonts link. Follow existing patterns — all CSS in `client/src/styles/`, components in `client/src/components/`.

**Tech Stack:** React 19 + Vite 6 + CSS custom properties

## Global Constraints

- All CSS changes go in `client/src/styles/` (no new CSS files)
- Google Fonts loaded via `<link>` in `client/index.html`
- Font fallback: `'Instrument Serif', var(--lg-font)` for h1-h3
- Coral accent hex: `#E8927C`
- Follow existing CSS class naming conventions (`.lg-*`, `.admin-*`)
- No new dependencies — use vanilla CSS/JS only

---

### Task 1: CSS Design Tokens — Variables

**Files:**
- Modify: `client/src/styles/variables.css`

**Interfaces:**
- Consumes: nothing
- Produces: `--lg-font-display`, `--lg-accent-secondary*`, `--lg-space-*` for all downstream tasks

- [ ] **Step 1: Add display font variable and spacing scale**

```css
/* Typography */
--lg-font: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text',
  'Helvetica Neue', Helvetica, Arial, sans-serif;
/* Add after --lg-font line */
--lg-font-display: 'Instrument Serif', var(--lg-font);
--lg-font-mono: 'SF Mono', 'Fira Code', 'JetBrains Mono', 'Cascadia Code', monospace;

/* Add after --lg-max-width */
/* Spacing scale (8px grid) */
--lg-space-1: 4px;
--lg-space-2: 8px;
--lg-space-3: 12px;
--lg-space-4: 16px;
--lg-space-5: 24px;
--lg-space-6: 32px;
--lg-space-7: 48px;
--lg-space-8: 64px;
--lg-space-9: 96px;
```

- [ ] **Step 2: Add coral accent color variables**

```css
/* Add after --lg-accent-glow */
/* Secondary accent — coral */
--lg-accent-secondary: #E8927C;
--lg-accent-secondary-hover: #D4785E;
--lg-accent-secondary-soft: rgba(232, 146, 124, 0.18);
--lg-accent-secondary-glow: rgba(232, 146, 124, 0.3);
```

- [ ] **Step 3: Verify variables.css is valid**

Read the file and confirm syntax is correct.

---

### Task 2: Google Fonts + Typography Update

**Files:**
- Modify: `client/index.html`
- Modify: `client/src/styles/base.css`

**Interfaces:**
- Consumes: `--lg-font-display` from Task 1
- Produces: h1-h3 rendered in Instrument Serif

- [ ] **Step 1: Add Google Fonts link in index.html**

Add inside `<head>` after any existing meta tags:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0,1&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Update h1-h3 in base.css**

Replace current h1-h4 rules:
```css
h1, h2, h3, h4 {
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.02em;
  color: var(--lg-text-primary);
}

h1 { font-size: 2.5rem; }
h2 { font-size: 1.8rem; }
h3 { font-size: 1.4rem; }
h4 { font-size: 1.15rem; }
```

Change to:
```css
h1, h2, h3 {
  font-family: var(--lg-font-display);
  font-weight: 400;
  line-height: 1.25;
  letter-spacing: -0.02em;
  color: var(--lg-text-primary);
}

h4 {
  font-weight: 600;
  line-height: 1.3;
  letter-spacing: -0.02em;
  color: var(--lg-text-primary);
}

h1 { font-size: 2.5rem; }
h2 { font-size: 1.8rem; }
h3 { font-size: 1.4rem; }
h4 { font-size: 1.15rem; }
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd client && npx tsc --noEmit`
Expected: PASS (no type errors — CSS changes only)

---

### Task 3: Hero Section Update

**Files:**
- Modify: `client/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: coral color vars, spacing vars from Task 1
- Produces: new hero layout with subtitle and coral accents

- [ ] **Step 1: Add subtitle below the "Line Web" title**

After the `</h1>` closing tag, add:
```tsx
<p
  style={{
    marginTop: '16px',
    fontSize: 'clamp(1rem, 3vw, 1.3rem)',
    color: 'var(--lg-text-secondary)',
    letterSpacing: '0.02em',
    fontWeight: 400,
  }}
>
  代码 · 思考 · 生活
</p>
```

- [ ] **Step 2: Update hero gradient to include coral hint**

Change the hero h1 background gradient:
```tsx
background: 'linear-gradient(135deg, #ffffff 0%, var(--lg-accent-secondary) 50%, var(--lg-accent) 100%)',
```

- [ ] **Step 3: Increase hero card max-width**

Change `maxWidth: '520px'` to `maxWidth: '560px'` on the hero LiquidGlass.

- [ ] **Step 4: Update "查看全部文章" link to use coral**

Find the `查看全部文章` link. Add coral styling. Change it from:
```tsx
<Link to="/posts" className="liquid-btn glass md" ...>
```
to use a custom link with coral accent:
```tsx
<Link
  to="/posts"
  style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    color: 'var(--lg-accent-secondary)',
    fontSize: '1rem',
    fontWeight: 500,
    textDecoration: 'none',
    transition: 'color var(--lg-transition)',
  }}
  target="_blank"
  rel="noopener noreferrer"
>
  查看全部文章
  <span style={{ transition: 'transform var(--lg-transition)', display: 'inline-block' }}>→</span>
</Link>
```

- [ ] **Step 5: Update StatsCard numbers to use coral**

Find the StatsCard usage and inspect if numbers can use coral. In `StatsCard.tsx`, change number color to `var(--lg-accent-secondary)`.

---

### Task 4: Coral Button Variant

**Files:**
- Modify: `client/src/styles/components.css`

**Interfaces:**
- Consumes: coral color vars from Task 1
- Produces: `.liquid-btn.coral` CSS class

- [ ] **Step 1: Add coral button variant**

After the `.liquid-btn.danger:hover` block, add:
```css
.liquid-btn.coral {
  background: linear-gradient(135deg, var(--lg-accent-secondary), var(--lg-accent-secondary-hover));
  color: white;
  box-shadow: 0 4px 12px var(--lg-accent-secondary-glow);
}
.liquid-btn.coral:hover {
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 6px 20px var(--lg-accent-secondary-glow);
}
.liquid-btn.coral:active {
  transform: translateY(0) scale(0.98);
}
```

---

### Task 5: Navbar Scroll Effect

**Files:**
- Modify: `client/src/components/Navbar.tsx`
- Modify: `client/src/styles/glass.css`

**Interfaces:**
- Consumes: nothing
- Produces: scroll-responsive navbar with depth change

- [ ] **Step 1: Add scroll listener in Navbar.tsx**

Add `useEffect` for scroll listener inside the Navbar component:
```tsx
useEffect(() => {
  const el = document.querySelector('.navbar') as HTMLElement | null
  if (!el) return

  const onScroll = () => {
    requestAnimationFrame(() => {
      if (window.scrollY > 80) {
        el.classList.add('navbar--scrolled')
      } else {
        el.classList.remove('navbar--scrolled')
      }
    })
  }

  window.addEventListener('scroll', onScroll, { passive: true })
  return () => window.removeEventListener('scroll', onScroll)
}, [])
```

- [ ] **Step 2: Add navbar--scrolled CSS in glass.css**

```css
.navbar--scrolled {
  background: rgba(255,255,255,0.14);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.10),
    0 4px 24px rgba(0,0,0,0.4);
}
```

---

### Task 6: Page Transition

**Files:**
- Modify: `client/src/components/Layout.tsx`
- Modify: `client/src/components/AdminLayout.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: smooth fade between route navigations

- [ ] **Step 1: Wrap Outlet in Layout.tsx**

Find `<Outlet />` in Layout.tsx and wrap:
```tsx
<div className="page-transition" style={{ animation: 'fadeIn 0.3s ease-out' }}>
  <Outlet />
</div>
```

- [ ] **Step 2: Wrap Outlet in AdminLayout.tsx**

Find `<Outlet />` in AdminLayout.tsx and wrap (same pattern):
```tsx
<div style={{ animation: 'fadeIn 0.3s ease-out' }}>
  <Outlet />
</div>
```

---

### Task 7: Spacing Token Usage in HomePage

**Files:**
- Modify: `client/src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `--lg-space-*` from Task 1
- Produces: HomePage using CSS variable-based spacing

- [ ] **Step 1: Replace Hero section padding**

Change `padding: '160px 24px 100px'` to use spacing tokens:
```tsx
padding: 'var(--lg-space-9) var(--lg-space-5) var(--lg-space-8)',
```

- [ ] **Step 2: Replace card padding**

Change `padding: '56px 48px'` to:
```tsx
padding: 'var(--lg-space-7) var(--lg-space-7)',
```

- [ ] **Step 3: Replace stats section spacing**

Change `padding: '0 24px'` to `padding: '0 var(--lg-space-5)'`
Change `marginBottom: '40px'` to `marginBottom: 'var(--lg-space-7)'`

- [ ] **Step 4: Replace posts section spacing**

Change `padding: '0 24px'` to `padding: '0 var(--lg-space-5)'`
Change `gap: '14px'` to `gap: 'var(--lg-space-3)'`
Change each `marginTop` inline styles to use spacing tokens

---

### Verification

- [ ] **Step 1: Run TypeScript check**

Run: `cd client && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 2: Build check**

Run: `cd client && npm run build` or `npx vite build`
Expected: Build succeeds with no errors
