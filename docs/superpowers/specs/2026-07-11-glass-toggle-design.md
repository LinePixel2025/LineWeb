# Liquid Glass Toggle Design

**Date:** 2026-07-11
**Status:** Approved

## Overview

Add a per-user toggle on the profile page to enable/disable the Liquid Glass visual effect. When disabled, the site keeps backdrop-filter blur (frosted glass) but removes SVG displacement refraction, interactive specular highlights, and chromatic aberration. Default is enabled. Setting persists in `user.settings`.

## Data Model

Extend `user.settings` JSON:

```json
{
  "background": { "type": "wallpaper", "wallpaperMode": "latest" },
  "glass": true
}
```

- `true` = full Liquid Glass (default)
- `false` = frosted blur only, no SVG refraction / interactive highlight / chromatic
- Missing field defaults to `true` (backward compatible with existing users)

No schema changes needed — `settings` is already a freeform JSON string.

## Architecture

### GlassContext (new)

**File:** `client/src/contexts/GlassContext.tsx`

```tsx
interface GlassContextValue {
  glassEnabled: boolean
  toggleGlass: () => void
}
```

- Reads `user.settings.glass` from `AuthContext`
- Defaults to `true` when field is missing
- `toggleGlass()` calls `AuthContext.updateSettings()` with toggled value
- Sets `document.documentElement.dataset.glass = "on" | "off"` on change
- Initializes `data-glass` attribute on mount

**Nesting order in App.tsx:**
```
BrowserRouter > AuthProvider > WallpaperProvider > GlassProvider > ContrastProvider > DownloadProvider > Routes
```

### CSS Mechanism

`data-glass` attribute on `<html>` controls glass intensity via CSS selectors.

**In `client/src/styles/glass.css`, append:**

```css
/* Glass off: keep frosted blur, remove SVG refraction + static highlight */
[data-glass="off"] .lg-surface,
[data-glass="off"] .lg-surface-strong {
  backdrop-filter: blur(1.7px) saturate(150%);
}
[data-glass="off"] .lg-surface::after,
[data-glass="off"] .lg-surface-strong::after {
  display: none;
}
```

`::before` (frosted underlay with `backdrop-filter: var(--lg-frost)`) is intentionally left unchanged.

### LiquidGlass Component Changes

**File:** `client/src/components/glass/LiquidGlass.tsx`

- Read `glassEnabled` from `useGlass()`
- When `glassEnabled === false`:
  - Skip rendering interactive specular highlight layer (z:3)
  - Skip rendering top edge rim glow layer (z:1)
  - Skip rendering chromatic aberration layer (z:0)
  - Only render content layer (z:2)
  - Ignore `interactive` and `chromatic` props
- The CSS handles the backdrop-filter change automatically

### Profile Page UI

**File:** `client/src/pages/ProfilePage.tsx`

Add a new section in the personalization card, below the background settings:

```
┌──────────────────────────────────────┐
│ 液态玻璃效果                         │
│                                      │
│ [glass icon]  液态玻璃        [开关] │
│               关闭后仅保留毛玻璃      │
└──────────────────────────────────────┘
```

- Toggle switch styled consistently with existing UI (pill-shaped button or toggle)
- Clicking toggles immediately — no separate "save" button needed
- Uses `useGlass()` context to read state and trigger toggle

## Data Flow

```
User clicks toggle
  → GlassContext.toggleGlass()
    → AuthContext.updateSettings(JSON.stringify({ ...currentSettings, glass: newValue }))
      → PUT /api/auth/settings
        → Backend updates user.settings
          → Returns updated user
            → AuthContext updates user state
              → GlassContext re-reads user.settings.glass
                → document.documentElement.dataset.glass = "on"|"off"
                  → CSS applies immediately
                  → LiquidGlass re-renders with conditional layers
```

## Files to Modify

| File | Change |
|------|--------|
| `client/src/contexts/GlassContext.tsx` | **New** — GlassProvider + useGlass hook |
| `client/src/App.tsx` | Add GlassProvider to context nesting |
| `client/src/styles/glass.css` | Append `[data-glass="off"]` override rules |
| `client/src/components/glass/LiquidGlass.tsx` | Read glassEnabled, conditionally render layers |
| `client/src/pages/ProfilePage.tsx` | Add glass toggle UI section |

## Edge Cases

- **Existing users**: `glass` field missing from settings → defaults to `true` (no migration needed)
- **Logged-out users**: Glass defaults to `true` (no settings to read)
- **Settings save failure**: Revert `data-glass` attribute to previous value, show error toast
- **SSR/hydration**: Not applicable (Vite SPA)
