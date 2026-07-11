# Specular Highlight Fade-on-Leave Design

**Date:** 2026-07-11
**Scope:** `client/src/components/glass/LiquidGlass.tsx`
**Status:** Approved

## Goal

When `interactive={true}`, the LiquidGlass specular highlight should fade out (opacity 0, 600ms) at the mouse's last position when the cursor leaves the component. On re-entry, it fades back in and resumes following the cursor.

## Current Behavior

- `mousemove` listener updates `specular.style.background` with a radial gradient at the cursor position
- No `mouseleave` listener — highlight stays visible at the last position after cursor leaves
- Specular div starts with `opacity: 1` (always visible, using CSS variable defaults at 30%, 20%)

## Target Behavior

| State | Specular |
|---|---|
| Mounted, no hover | `opacity: 0` — invisible |
| Mouse enters | `opacity: 1`, follows cursor |
| Mouse moving | Follows cursor, `opacity: 1` |
| Mouse leaves | `opacity: 0` over 600ms, position frozen at last cursor spot |
| Mouse re-enters | `opacity: 1`, resumes following |

## Implementation

### File: `client/src/components/glass/LiquidGlass.tsx`

**1. Specular div initial style (lines 110-123)**

Change:
- Add `opacity: 0` to initial style
- Change `transition` from `'background 0.15s ease-out'` to `'opacity 0.6s ease-out'`
- Background transition is no longer needed (JS sets position directly, no interpolation needed for the gradient center)

```tsx
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
}}
```

**2. Add mouseenter / mouseleave listeners in useEffect (after line 81)**

```tsx
const onEnter = () => {
  specular.style.opacity = '1'
}

const onLeave = () => {
  specular.style.opacity = '0'
}

el.addEventListener('mouseenter', onEnter)
el.addEventListener('mouseleave', onLeave)
```

In the cleanup function (line 82-86), add:
```tsx
el.removeEventListener('mouseenter', onEnter)
el.removeEventListener('mouseleave', onLeave)
```

**3. Ensure onMove sets opacity to 1**

At the start of `onMove` (line 55), add:
```tsx
specular.style.opacity = '1'
```

This handles edge cases where rapid mouse movement could leave opacity at 0.

## What Does NOT Change

- No new props added — behavior is automatic when `interactive={true}`
- CSS files (`glass.css`, `globals.css`) — no changes
- `LiquidButton.tsx` — not affected (uses CSS hover, not JS)
- `interactive={false}` components — completely unaffected
- Chromatic aberration and rim glow layers — unchanged

## Edge Cases

- **Touch events**: `touchstart` already triggers `touchmove` which calls `onMove` → opacity set to 1. No separate `touchenter`/`touchleave` needed.
- **Fast mouse enter/leave**: CSS transition handles this gracefully — if the mouse enters and leaves quickly, the opacity will begin fading and stop at whatever intermediate value it reached.
- **Component unmount during animation**: cleanup function removes all listeners, no leaked state.
- **`interactive` prop changes**: useEffect re-runs due to `[interactive]` dependency, attaching or detaching listeners as needed.
