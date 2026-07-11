# Specular Highlight Fade-on-Leave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mouse-leave fade-out animation to the LiquidGlass interactive specular highlight.

**Architecture:** CSS opacity transition driven by mouseenter/mouseleave DOM listeners, integrated into the existing useEffect in LiquidGlass.tsx. No new props, no new files.

**Tech Stack:** React 19, TypeScript, CSS transitions

## Global Constraints

- Only modify `client/src/components/glass/LiquidGlass.tsx`
- No new props — behavior is automatic when `interactive={true}`
- No CSS file changes
- Preserve existing touch support and throttle logic
- Maintain `memo` wrapper and cleanup patterns

---

### Task 1: Add fade-on-leave to specular highlight

**Files:**
- Modify: `client/src/components/glass/LiquidGlass.tsx:55-86` (useEffect) and `:110-123` (specular style)

**Interfaces:**
- No API changes — `LiquidGlassProps` unchanged

- [ ] **Step 1: Update specular div initial style**

In the specular div's `style` prop (line 110-123), make two changes:
1. Add `opacity: 0` — specular starts hidden, appears on first mouse enter
2. Change `transition` from `'background 0.15s ease-out'` to `'opacity 0.6s ease-out'`

Replace lines 110-123 with:

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
        } as React.CSSProperties}
```

- [ ] **Step 2: Add opacity reset in onMove handler**

At the start of the `onMove` function (line 55), add one line to ensure opacity is 1 when the mouse is moving over the component:

```tsx
    const onMove = (e: MouseEvent | TouchEvent) => {
      specular.style.opacity = '1'
```

- [ ] **Step 3: Add mouseenter and mouseleave listeners**

After the `touchmove` listener registration (line 81), add `mouseenter` and `mouseleave` handlers:

```tsx
    const onEnter = () => {
      specular.style.opacity = '1'
    }
    const onLeave = () => {
      specular.style.opacity = '0'
    }

    el.addEventListener('mousemove', onMove)
    el.addEventListener('touchmove', onMove, { passive: true })
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
```

- [ ] **Step 4: Add cleanup for new listeners**

In the cleanup function (lines 82-86), add removal of the new listeners:

```tsx
    return () => {
      el.removeEventListener('mousemove', onMove)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('mouseenter', onEnter)
      el.removeEventListener('mouseleave', onLeave)
      cancelAnimationFrame(rectFrame)
    }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Manual verification**

1. Start dev server: `npm run dev:client`
2. Visit any page with an interactive LiquidGlass component (e.g., home page hero card)
3. Hover over the card — specular highlight should appear and follow the cursor
4. Move cursor away — highlight should fade out over ~600ms at the last position
5. Move cursor back — highlight should reappear and resume following
6. Test on mobile viewport — touch should work the same way

- [ ] **Step 7: Commit**

```bash
git add client/src/components/glass/LiquidGlass.tsx
git commit -m "feat(glass): fade specular highlight on mouse leave"
```
