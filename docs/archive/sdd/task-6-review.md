# Task 6 Review: UserAvatar Component

## Spec Compliance

| Requirement | Status | Notes |
|---|---|---|
| Renders avatar from `GET /api/auth/avatar/:userId` on mount | ✅ | Fetches in `useEffect` with Bearer token from `localStorage` |
| Falls back to colored circle with initials on 204 | ✅ | `setFailed(true)` on `res.status === 204` |
| Falls back on error | ✅ | `.catch(() => setFailed(true))` handles network/fetch errors |
| Props: `userId`, `username`, `size?` with correct types | ✅ | Exact match: `userId: number`, `username: string`, `size?: 'sm' | 'md' | 'lg' | 'xl'` |
| `URL.revokeObjectURL` cleanup | ✅ | Separate `useEffect` revokes previous blob URL on change/unmount |
| AbortController on unmount | ✅ | `return () => controller.abort()` in fetch effect |

**Compliance verdict: Pass** — All spec requirements are implemented.

## Code Quality

### Race Condition: Stale aborted fetch sets `failed = true` permanently

`client/src/components/UserAvatar.tsx:58` — The `.catch(() => setFailed(true))` does **not** distinguish `AbortError` from real errors. When `userId` changes:

1. Old effect cleanup calls `controller.abort()`
2. New effect body runs: `setFailed(false)`
3. Old fetch's `.catch` fires (as microtask): `setFailed(true)`
4. New fetch succeeds: `setImgSrc(blobUrl)`
5. Render: `imgSrc && !failed` is `false` → **fallback shows despite successful fetch**

The `failed` state never resets because `setFailed(true)` from the aborted request overrides the new `setFailed(false)`. Fix: filter `AbortError` in `.catch`:

```ts
.catch((err) => {
  if (err instanceof DOMException && err.name === 'AbortError') return
  setFailed(true)
})
```

### Minor: `getInitials` only returns one character

`client/src/components/UserAvatar.tsx:11-18` — For two-word names like "John Doe", returns only "J". Many avatar components return multi-character initials (e.g., "JD"). This is a design choice, not a bug, but worth noting if multi-character initials are desired later.

### Style: Inline styles consistent with project conventions

In `client/src/components/UserAvatar.tsx:74-80, 88-100` — Uses inline `style` objects for sizing, border-radius, flex layout, etc. Matches patterns in `Guards.tsx` and `CommentSection.tsx`. No project CSS modules were harmed. ✅

### Token key: Matches project constant

Uses the hardcoded string `'lineweb_token'` which equals the `TOKEN_KEY` constant in `client/src/lib/api.ts:2`. ✅

## Verdict

**Pass with issue** — Spec-compliant implementation, but has a race condition where a stale aborted fetch permanently sets `failed = true`, causing the fallback to render even after a successful avatar fetch on `userId` change. Fix the `AbortError` filtering in the `.catch` handler.
