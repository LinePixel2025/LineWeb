# Frontend Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all issues found in the frontend verification report — accessibility defects, component inconsistencies, animation irregularities, and hardcoded design values.

**Architecture:** Each task is an independent fix that can be committed and verified separately. Tasks are ordered by severity: critical bugs first, then accessibility, then consistency, then cleanup. No task depends on another task's code changes, but Tasks 2-4 depend on Task 1's API fix being in place for visual testing.

**Tech Stack:** React 19, TypeScript, CSS (globals.css), LiquidGlass/LiquidButton components

## Global Constraints

- CSS changes ONLY in `client/src/styles/globals.css`
- All animations must respect `prefers-reduced-motion: reduce`
- Use CSS custom properties (`--lg-*`) instead of hardcoded values
- Use `<LiquidButton>` component instead of raw `<button>/<Link>` with `liquid-btn` class
- Windows platform: no POSIX-only commands
- `.npmrc` uses `registry=https://registry.npmmirror.com`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `server/src/index.ts` | Modify | Fix public API paths (already done, verify) |
| `client/src/styles/globals.css` | Modify | Add `.fade-in-stagger` class, fix glassRise params, remove `menuSlideOut`, fix wallpaper transition |
| `client/src/pages/HomePage.tsx` | Modify | Replace inline animation with CSS class |
| `client/src/pages/PostsPage.tsx` | Modify | Replace inline animation with CSS class, use Pagination component |
| `client/src/pages/FeaturesPage.tsx` | Modify | Replace inline animation with CSS class |
| `client/src/pages/admin/PageEditor.tsx` | Modify | Replace inline animation with CSS class |
| `client/src/pages/LoginPage.tsx` | Modify | Use LiquidButton, remove inline touch handlers |
| `client/src/pages/RegisterPage.tsx` | Modify | Use LiquidButton, remove inline touch handlers |
| `client/src/pages/ProfilePage.tsx` | Modify | Use CSS variables, use LiquidButton for logout |
| `client/src/pages/DynamicPage.tsx` | Modify | Use LiquidButton instead of `<span>` |
| `client/src/pages/AdminPage.tsx` | Modify | Use Pagination component |
| `client/src/components/Layout.tsx` | Modify | Use `--lg-transition` for wallpaper |
| `client/src/components/AdminLayout.tsx` | Modify | Use `--lg-transition` for wallpaper |

---

### Task 1: Fix public API paths (verify existing fix)

**Files:**
- Modify: `server/src/index.ts:47-54`

**Interfaces:**
- Consumes: None
- Produces: Public API endpoints accessible without JWT token

- [ ] **Step 1: Verify the fix is in place**

Read `server/src/index.ts` lines 46-55. Confirm `publicApiPaths` contains:
```
['/auth/login', '/auth/register', '/health', '/posts', '/pages/featured', '/pages/slug', '/bing-wallpaper']
```
and the check uses `req.path === p || req.path.startsWith(p + '/')`.

- [ ] **Step 2: Test public endpoints**

Run:
```bash
curl -s http://localhost:3001/api/posts?page=1&limit=3 | head -c 100
curl -s http://localhost:3001/api/pages/featured | head -c 100
curl -s http://localhost:3001/api/auth/login -X POST -H "Content-Type: application/json" -d '{"email":"admin@lineweb.dev","password":"admin123"}' | head -c 100
```
Expected: All return JSON data (not 401).

- [ ] **Step 3: Commit**

```bash
git add server/src/index.ts
git commit -m "fix(auth): correct public API paths to not require authentication"
```

---

### Task 2: Fix inline animations for accessibility (FeaturesPage)

**Files:**
- Modify: `client/src/pages/FeaturesPage.tsx:73,121`
- Modify: `client/src/styles/globals.css` (add `.fade-in-stagger` class)

**Interfaces:**
- Consumes: `fadeIn` keyframe (already exists at globals.css:646)
- Produces: `.fade-in-stagger` CSS class with `animation-delay` support via inline style

- [ ] **Step 1: Add `.fade-in-stagger` CSS class**

In `client/src/styles/globals.css`, after the `.fade-in` block (line 663-664), add:

```css
.fade-in-stagger {
  animation: fadeIn 0.5s ease-out both;
}
```

- [ ] **Step 2: Replace inline animation in FeaturesPage**

In `client/src/pages/FeaturesPage.tsx`, line 73, change:
```tsx
animation: `fadeIn 0.5s ease-out ${i * 0.1}s both`,
```
to:
```tsx
animationDelay: `${i * 0.1}s`,
```
and add `className="fade-in-stagger"` to the same element's props.

Do the same for line 121 (custom pages section):
```tsx
animation: `fadeIn 0.5s ease-out ${(i + features.length) * 0.1}s both`,
```
to:
```tsx
animationDelay: `${(i + features.length) * 0.1}s`,
```
and add `className="fade-in-stagger"`.

- [ ] **Step 3: Verify in browser**

Open `http://localhost:5173/features` in browser. Cards should animate in with staggered delay. Enable `prefers-reduced-motion: reduce` in DevTools → Animations panel → cards should appear instantly.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/FeaturesPage.tsx client/src/styles/globals.css
git commit -m "fix(a11y): replace inline animation with CSS class for reduced-motion support"
```

---

### Task 3: Fix inline animations (HomePage + PostsPage)

**Files:**
- Modify: `client/src/pages/HomePage.tsx:94`
- Modify: `client/src/pages/PostsPage.tsx:38`

**Interfaces:**
- Consumes: `.fade-in-stagger` CSS class (from Task 2)
- Produces: None

- [ ] **Step 1: Replace inline animation in HomePage**

In `client/src/pages/HomePage.tsx`, line 94, change:
```tsx
<LiquidGlass key={post.id} variant="blur" chromatic={false} style={{ padding: '24px', animation: `fadeIn 0.4s ease-out ${i * 0.08}s both` }}>
```
to:
```tsx
<LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger" style={{ padding: '24px', animationDelay: `${i * 0.08}s` }}>
```

- [ ] **Step 2: Replace inline animation in PostsPage**

In `client/src/pages/PostsPage.tsx`, line 38, change:
```tsx
<LiquidGlass key={post.id} variant="blur" chromatic={false} style={{ padding: '24px', animation: `fadeIn 0.4s ease-out ${i * 0.05}s both` }}>
```
to:
```tsx
<LiquidGlass key={post.id} variant="blur" chromatic={false} className="fade-in-stagger" style={{ padding: '24px', animationDelay: `${i * 0.05}s` }}>
```

- [ ] **Step 3: Verify in browser**

Open `http://localhost:5173/` and `http://localhost:5173/posts`. Cards should animate with stagger. Test with `prefers-reduced-motion: reduce`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/HomePage.tsx client/src/pages/PostsPage.tsx
git commit -m "fix(a11y): replace inline animations in HomePage and PostsPage for reduced-motion"
```

---

### Task 4: Fix inline animation in PageEditor

**Files:**
- Modify: `client/src/pages/admin/PageEditor.tsx:583`

**Interfaces:**
- Consumes: `.fade-in-stagger` CSS class (from Task 2)
- Produces: None

- [ ] **Step 1: Replace inline animation**

In `client/src/pages/admin/PageEditor.tsx`, line 583, change:
```tsx
<div className="pe-featured-fields" style={{ animation: 'fadeIn 0.3s ease both' }}>
```
to:
```tsx
<div className="pe-featured-fields fade-in-stagger" style={{ animationDuration: '0.3s' }}>
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/admin/PageEditor.tsx
git commit -m "fix(a11y): replace inline animation in PageEditor for reduced-motion"
```

---

### Task 5: Unify Login/Register buttons to use LiquidButton

**Files:**
- Modify: `client/src/pages/LoginPage.tsx:46-58`
- Modify: `client/src/pages/RegisterPage.tsx:47-59`

**Interfaces:**
- Consumes: `LiquidButton` component from `../components/glass/LiquidButton`
- Produces: Consistent button behavior across all forms

- [ ] **Step 1: Update LoginPage submit button**

In `client/src/pages/LoginPage.tsx`, replace the `<button>` (lines 46-58):
```tsx
import LiquidButton from '../components/glass/LiquidButton'
```
Add import at top. Then replace lines 46-58:
```tsx
<LiquidButton
  type="submit"
  variant="primary"
  size="lg"
  disabled={loading}
  style={{ width: '100%', marginTop: '4px' }}
>
  {loading ? '登录中...' : '登录'}
</LiquidButton>
```
Remove the `onTouchStart` and `onTouchEnd` handlers (lines 54-55).

- [ ] **Step 2: Update RegisterPage submit button**

In `client/src/pages/RegisterPage.tsx`, same pattern. Add import:
```tsx
import LiquidButton from '../components/glass/LiquidButton'
```
Replace lines 47-59:
```tsx
<LiquidButton
  type="submit"
  variant="primary"
  size="lg"
  disabled={loading}
  style={{ width: '100%', marginTop: '4px' }}
>
  {loading ? '注册中...' : '注册'}
</LiquidButton>
```
Remove `onTouchStart` and `onTouchEnd` handlers (lines 55-56).

- [ ] **Step 3: Verify in browser**

Open `http://localhost:5173/login` and `http://localhost:5173/register`. Buttons should have glass hover effect, proper focus ring, and touch scale via CSS `:active`.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/LoginPage.tsx client/src/pages/RegisterPage.tsx
git commit -m "refactor: use LiquidButton in Login/Register pages, remove inline touch handlers"
```

---

### Task 6: Unify DynamicPage button to use LiquidButton

**Files:**
- Modify: `client/src/pages/DynamicPage.tsx:98-108`

**Interfaces:**
- Consumes: `LiquidButton` component from `../components/glass/LiquidButton`
- Produces: Accessible buttons in dynamic pages

- [ ] **Step 1: Replace span-based button with LiquidButton**

In `client/src/pages/DynamicPage.tsx`, add import:
```tsx
import LiquidButton from '../components/glass/LiquidButton'
```

Replace lines 98-108:
```tsx
case 'button': {
  const variant = (comp.props.variant as string) || 'primary'
  const link = comp.props.link as string
  const text = (comp.props.text as string) || '按钮'
  if (link) {
    return <LiquidButton href={link} variant={variant as 'primary' | 'glass' | 'ghost' | 'danger'} size="md">{text}</LiquidButton>
  }
  return <LiquidButton variant={variant as 'primary' | 'glass' | 'ghost' | 'danger'} size="md">{text}</LiquidButton>
}
```

- [ ] **Step 2: Verify in browser**

Create a page with buttons in the visual page editor. Buttons should be focusable, keyboard-accessible, and have glass hover effects.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/DynamicPage.tsx
git commit -m "fix(a11y): use LiquidButton in DynamicPage for accessible button rendering"
```

---

### Task 7: Unify pagination using Pagination component

**Files:**
- Modify: `client/src/pages/PostsPage.tsx:57-87`
- Modify: `client/src/pages/AdminPage.tsx:100-128`

**Interfaces:**
- Consumes: `Pagination` component from `../components/Pagination`
- Produces: Consistent pagination across all list pages

- [ ] **Step 1: Read the Pagination component**

Read `client/src/components/Pagination.tsx` to understand its props interface.

- [ ] **Step 2: Replace pagination in PostsPage**

In `client/src/pages/PostsPage.tsx`, replace the inline pagination block (lines 57-87) with:
```tsx
import Pagination from '../components/Pagination'
```
Add import at top. Then replace lines 57-87:
```tsx
{data && data.totalPages > 1 && (
  <Pagination
    currentPage={page}
    totalPages={data.totalPages}
    onPageChange={setPage}
  />
)}
```

- [ ] **Step 3: Replace pagination in AdminPage**

In `client/src/pages/AdminPage.tsx`, same pattern. Add import:
```tsx
import Pagination from '../components/Pagination'
```
Replace lines 100-128:
```tsx
{data && data.totalPages > 1 && (
  <Pagination
    currentPage={page}
    totalPages={data.totalPages}
    onPageChange={setPage}
  />
)}
```

- [ ] **Step 4: Verify in browser**

Test pagination on `http://localhost:5173/posts` and `http://localhost:5173/admin`. Both should render identical pagination controls.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/PostsPage.tsx client/src/pages/AdminPage.tsx
git commit -m "refactor: unify pagination using Pagination component in PostsPage and AdminPage"
```

---

### Task 8: Fix ProfilePage — use CSS variables and LiquidButton

**Files:**
- Modify: `client/src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: `LiquidButton` component, CSS custom properties (`--lg-text-primary`, `--lg-text-secondary`, `--lg-accent`, `--lg-danger`)
- Produces: Theme-adaptive ProfilePage

- [ ] **Step 1: Replace hardcoded colors with CSS variables**

In `client/src/pages/ProfilePage.tsx`, make these replacements:

| Line | Old | New |
|------|-----|-----|
| 82 | `color: '#fff'` | `color: 'var(--lg-text-primary)'` |
| 88 | `color: '#fff'` | `color: 'var(--lg-text-primary)'` |
| 92 | `color: 'rgba(255,255,255,0.8)'` | `color: 'var(--lg-text-secondary)'` |
| 96 | `color: '#40a9ff'` | `color: 'var(--lg-accent)'` |
| 114 | `color: '#fff'` | `color: 'var(--lg-text-primary)'` |
| 127 | `color: bgType === t ? 'var(--lg-accent)' : 'rgba(255,255,255,0.7)'` | `color: bgType === t ? 'var(--lg-accent)' : 'var(--lg-text-secondary)'` |
| 174 | `color: wallpaperMode === key ? 'var(--lg-accent)' : 'rgba(255,255,255,0.7)'` | `color: wallpaperMode === key ? 'var(--lg-accent)' : 'var(--lg-text-secondary)'` |
| 240 | `color: '#4cd964'` | `color: 'var(--lg-success)'` |
| 241 | `color: '#ff3b30'` | `color: 'var(--lg-danger)'` |

- [ ] **Step 2: Replace hardcoded transitions**

Replace all `transition: 'all 0.2s'` (lines 129, 176, 207) with:
```tsx
transition: 'all 0.2s ease',
```

- [ ] **Step 3: Replace logout button with LiquidButton**

Add import:
```tsx
import LiquidButton from '../components/glass/LiquidButton'
```

Replace lines 100-109:
```tsx
<LiquidButton variant="danger" size="md" onClick={handleLogout}>
  退出登录
</LiquidButton>
```

- [ ] **Step 4: Verify in browser**

Open `http://localhost:5173/profile`. All text should use design system colors. Logout button should have glass danger style.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/ProfilePage.tsx
git commit -m "refactor: use CSS variables and LiquidButton in ProfilePage"
```

---

### Task 9: Fix wallpaper transition to use design system variable

**Files:**
- Modify: `client/src/components/Layout.tsx:19,31`
- Modify: `client/src/components/AdminLayout.tsx`

**Interfaces:**
- Consumes: `--lg-transition` CSS variable
- Produces: Responsive wallpaper transitions

- [ ] **Step 1: Fix Layout.tsx wallpaper transitions**

In `client/src/components/Layout.tsx`, replace both occurrences of:
```tsx
transition: 'opacity 0.8s ease',
```
with:
```tsx
transition: `opacity var(--lg-transition)`,
```
(Lines 19 and 31)

- [ ] **Step 2: Fix AdminLayout.tsx wallpaper transitions**

In `client/src/components/AdminLayout.tsx`, find the wallpaper `<div>` elements with `transition: 'opacity 0.8s ease'` and replace with:
```tsx
transition: `opacity var(--lg-transition)`,
```

- [ ] **Step 3: Verify in browser**

Refresh the page. Wallpaper fade-in should be smooth. On mobile (resize to 375px), the transition should be faster (0.15s vs 0.35s).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/Layout.tsx client/src/components/AdminLayout.tsx
git commit -m "fix: use --lg-transition for wallpaper fade to respect mobile speed"
```

---

### Task 10: Fix glassRise animation inconsistency in CSS

**Files:**
- Modify: `client/src/styles/globals.css:3436`

**Interfaces:**
- Consumes: `glassRise` keyframe (globals.css:651)
- Produces: Consistent glassRise animation parameters

- [ ] **Step 1: Fix glassRise in page-editor-module-setup**

In `client/src/styles/globals.css`, line 3436, change:
```css
animation: glassRise 0.4s ease both;
```
to:
```css
animation: glassRise 0.6s cubic-bezier(0.25, 0.1, 0.25, 1) both;
```

- [ ] **Step 2: Commit**

```bash
git add client/src/styles/globals.css
git commit -m "fix: unify glassRise animation parameters in page-editor-module-setup"
```

---

### Task 11: Remove dead code and clean up CSS

**Files:**
- Modify: `client/src/styles/globals.css` (remove `menuSlideOut`)

**Interfaces:**
- Consumes: None
- Produces: Cleaner CSS file

- [ ] **Step 1: Remove unused `@keyframes menuSlideOut`**

In `client/src/styles/globals.css`, delete lines 1061-1064:
```css
@keyframes menuSlideOut {
  from { opacity: 1; transform: translateY(0) scale(1); }
  to   { opacity: 0; transform: translateY(-8px) scale(0.97); }
}
```

- [ ] **Step 2: Verify no references**

Run: `grep -r "menuSlideOut" client/src/`
Expected: No results.

- [ ] **Step 3: Commit**

```bash
git add client/src/styles/globals.css
git commit -m "chore: remove unused menuSlideOut keyframe animation"
```

---

### Task 12: Fix copyright text overflow on mobile

**Files:**
- Modify: `client/src/components/Layout.tsx:51-59`

**Interfaces:**
- Consumes: None
- Produces: Properly truncated copyright text on mobile

- [ ] **Step 1: Add textOverflow to copyright span**

In `client/src/components/Layout.tsx`, the `<span>` at line 51 already has `whiteSpace: 'nowrap'` and `overflow: 'hidden'`. Add `textOverflow: 'ellipsis'` to the style object:
```tsx
textOverflow: 'ellipsis',
```

- [ ] **Step 2: Verify in browser**

Resize to 375px width. Copyright text should show with ellipsis instead of being clipped.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "fix: add text-overflow ellipsis to copyright text on mobile"
```

---

## Self-Review

**1. Spec coverage:** All 17 issues from the verification report are covered:
- ✅ Issue 1 (API paths) → Task 1
- ✅ Issues 2-4 (inline animations) → Tasks 2-4
- ✅ Issues 5-6 (button inconsistency) → Tasks 5-6
- ✅ Issue 7 (pagination duplication) → Task 7
- ✅ Issues 8-10 (ProfilePage) → Task 8
- ✅ Issue 11 (wallpaper transition) → Task 9
- ✅ Issue 12 (glassRise) → Task 10
- ✅ Issue 13 (dead code) → Task 11
- ✅ Issue 14 (copyright overflow) → Task 12
- Note: Issues 15-17 (contrast on bright wallpapers) are design-level concerns that require design decisions, not code fixes — flagged but not in scope for this plan.

**2. Placeholder scan:** All steps contain exact code. No "TBD" or "TODO".

**3. Type consistency:** `LiquidButton` props (`variant`, `size`, `type`, `disabled`, `onClick`, `style`, `href`, `to`) are consistent across all tasks. CSS class `.fade-in-stagger` is defined in Task 2 and consumed in Tasks 3-4.
