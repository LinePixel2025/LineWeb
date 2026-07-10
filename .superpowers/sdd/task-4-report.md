### Task 4: 更新玻璃质感样式

**Status:** DONE

**Commits:**
- `3363c1d` - feat: update glass styles for new design system

**Test Summary:**
TypeScript type check passed (`npx tsc --noEmit`) with no errors.

**Changes Made:**
Updated `client/src/styles/glass.css` to use the new CSS variable system:

1. **`.lg-surface`** - Updated to use `var(--glass-bg)`, `var(--glass-blur)`, `var(--glass-border)`, `var(--radius-md)`, `var(--transition-normal)`
2. **`.lg-surface:hover`** - Added hover state using `var(--color-border-hover)`
3. **`.lg-surface-strong`** - Updated to use `var(--glass-border)`, `var(--radius-lg)`, `blur(20px)`
4. **`.lg-input`** - Updated to use `var(--color-bg-secondary)`, `var(--color-border-default)`, `var(--radius-sm)`, `var(--color-text-primary)`, `var(--transition-fast)`
5. **`.lg-input:focus`** - Updated to use `var(--color-accent)`, `var(--color-accent-soft)`
6. **`.lg-input::placeholder`** - Updated to use `var(--color-text-tertiary)`
7. **`.lg-glass-input`** - New class added using `var(--glass-bg)`, `var(--glass-blur)`, `var(--glass-border)`, `var(--radius-md)`
8. **`.lg-glass-input:focus`** - New class added using `var(--color-accent)`, `var(--color-accent-soft)`

Additional updates:
- Select/option styles updated to use `var(--color-bg-secondary)`, `var(--color-bg-tertiary)`, `var(--color-text-primary)`, `var(--color-text-secondary)`
- Theme toggle updated to use `var(--glass-bg)`, `var(--glass-blur)`, `var(--glass-border)`, `var(--transition-normal)`, `var(--color-text-primary)`
- Navbar updated to use `var(--nav-height)`, `var(--max-width)`, `var(--radius-lg)`, `var(--glass-bg)`, `var(--glass-blur)`, `var(--glass-border)`
- Navbar links updated to use `var(--radius-full)`, `var(--color-text-secondary)`, `var(--color-text-primary)`, `var(--color-accent-soft)`, `var(--color-accent)`, `var(--transition-normal)`
- Underlay backdrop-filter updated to use `var(--glass-blur)`
- Safe area inset updated to use `env(safe-area-inset-top, 0px)` instead of `var(--lg-safe-top)`

**Concerns:**
None. All glass styles have been successfully updated to use the new CSS variable system while preserving the existing Liquid Glass design aesthetic.
