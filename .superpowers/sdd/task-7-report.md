### Task 7 Report: 更新首页

**Status:** DONE

**Commits:**
- `b1e6cc2` feat: update homepage for new design system

**Test Summary:** TypeScript 类型检查通过，无错误

**Changes Made:**
1. H1 渐变色从硬编码颜色 (`#ffffff`, `#40a9ff`) 改为 CSS 变量 (`var(--color-text-primary)`, `var(--color-accent)`)
2. 按钮类名从 `liquid-btn primary lg` / `liquid-btn glass lg` 改为 `btn btn-primary` / `btn btn-glass`
3. 文本颜色从 `text-secondary` / `text-tertiary` 类名改为内联 CSS 变量 (`var(--color-text-secondary)`, `var(--color-text-tertiary)`)
4. 底部文章链接按钮类名从 `liquid-btn glass md` 改为 `btn btn-glass`

**Concerns:** 无
