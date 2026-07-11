# Frontend Design Improvements

Date: 2026-07-11

## Overview

Improve the Line Web frontend visual identity based on the design review in `docs/design-review.md`. The goal is to move from "Apple Liquid Glass clone" to a distinctive personal website with character.

## Changes

### 1. Typography — Instrument Serif

**What**: Add Instrument Serif (Google Fonts) as the display face for all h1, h2, h3 elements globally.

**Details**:
- Load from Google Fonts: `Instrument+Serif:ital@0,1` (regular 400 + italic 400)
- Apply via CSS: `h1, h2, h3 { font-family: 'Instrument Serif', var(--lg-font); }`
- Keep weight at 400 (regular) — let the serif geometry speak, don't bold it
- Letter-spacing: keep `-0.02em` for h1, `-0.01em` for h2/h3
- Chinese characters will fall back to system font (Instrument Serif lacks CJK coverage)
- Body text, navigation, UI labels: unchanged (system fonts)

**Files changed**:
- `client/src/styles/variables.css` — add `--lg-font-display` variable
- `client/src/styles/base.css` — update h1-h4 rules, import Google Fonts
- `client/index.html` — add Google Fonts link in `<head>`

### 2. Color — Warm Coral Accent

**What**: Add `--lg-accent-secondary: #E8927C` as a secondary accent color.

**Variables added**:
```css
--lg-accent-secondary: #E8927C;
--lg-accent-secondary-hover: #D4785E;
--lg-accent-secondary-soft: rgba(232, 146, 124, 0.18);
--lg-accent-secondary-glow: rgba(232, 146, 124, 0.3);
```

**Usage**:
- Logo hover state in navbar
- `.liquid-btn.coral` variant (background: coral gradient, used sparingly)
- Hero gradient: blend from white through coral to blue
- "View all posts →" link on home page
- Stats card numbers
- Some badge highlights in admin

**Files changed**:
- `client/src/styles/variables.css`
- `client/src/styles/components.css` (new button variant)
- `client/src/pages/HomePage.tsx` (hero gradient, stats link)

### 3. Hero Section — Identity Statement

**What**: Add subtitle below "Line Web" in the hero card.

**Copy**: "代码 · 思考 · 生活"

**Styling**:
- `.text-secondary` color
- Font size: `clamp(1rem, 3vw, 1.3rem)`
- Letter-spacing: `0.02em`
- Margin-top: `16px`
- Keep the glass card, enlarge max-width to 560px

**Files changed**:
- `client/src/pages/HomePage.tsx`

### 4. Navbar Scroll Effect

**What**: When page scrolls past 80px, darken the navbar glass background for better contrast.

**Implementation**:
- Use IntersectionObserver or scroll listener on Layout
- Toggle class `.navbar--scrolled` on navbar element
- CSS: `.navbar--scrolled { background: rgba(255,255,255,0.12); }`

**Files changed**:
- `client/src/components/Navbar.tsx` (scroll listener)
- `client/src/styles/glass.css` (`.navbar--scrolled` style)

### 5. Page Transition

**What**: Add fadeIn animation to `<Outlet>` content in Layout and AdminLayout.

**Implementation**:
- Wrap `<Outlet>` in a `<div className="page-transition">`
- CSS: `.page-transition { animation: fadeIn 0.3s ease-out; }`

**Files changed**:
- `client/src/components/Layout.tsx`
- `client/src/components/AdminLayout.tsx`
- `client/src/styles/base.css` (add `.page-transition` class or reuse existing)

### 6. Spacing Scale Variables

**What**: Add spacing token variables to the design system, start using them in HomePage.

**Variables added**:
```css
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

**Initial usage**: Replace inline `padding`/`margin`/`gap` values in `HomePage.tsx` and `FeaturesPage.tsx` with CSS variables. Other pages to be done incrementally.

**Files changed**:
- `client/src/styles/variables.css`

## Files Changed Summary

| File | Change |
|------|--------|
| `client/index.html` | Add Google Fonts link |
| `client/src/styles/variables.css` | Add display font var, coral accent vars, spacing scale |
| `client/src/styles/base.css` | Update h1-h3 font-family, add page-transition class |
| `client/src/styles/components.css` | Add `.liquid-btn.coral` variant |
| `client/src/styles/glass.css` | Add `.navbar--scrolled` style |
| `client/src/components/Navbar.tsx` | Add scroll listener |
| `client/src/components/Layout.tsx` | Wrap Outlet with transition div |
| `client/src/components/AdminLayout.tsx` | Wrap Outlet with transition div |
| `client/src/pages/HomePage.tsx` | Hero subtitle, coral accents, spacing tokens |

## Non-Changes (explicitly excluded from this scope)

- Drive page layout
- Admin table styling
- 404 page / empty states
- Light mode theme
