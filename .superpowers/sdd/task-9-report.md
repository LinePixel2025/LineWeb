## Task 9: 更新登录页

**Status:** DONE

**Commits:**
- `1a2cc2e` - feat: update login page for new design system

**Test summary:** TypeScript check passed, Vite build succeeded (144 modules, 2.33s)

**Changes made:**
- Removed LiquidButton component import, using standard `btn btn-primary` CSS classes instead
- Updated error message colors: `var(--lg-danger)` → `var(--color-error)`, `rgba(255,59,48,0.12)` → `rgba(238,90,90,0.12)`
- Updated border radius: `var(--lg-radius-md)` → `var(--radius-md)`
- Updated text colors to use CSS variables: `var(--color-text-secondary)`, `var(--color-text-tertiary)`
- Component now matches the design system's variable naming conventions
