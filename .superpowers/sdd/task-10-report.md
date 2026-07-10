# Task 10: 更新页面样式

## Status: DONE

## Commits
- `050e577` feat: update page styles for new design system

## Test Summary
TypeScript 检查通过，无编译错误。

## Changes Made
已更新 `client/src/styles/pages.css` 文件，将所有旧的 CSS 变量（`--lg-*`）替换为新的设计系统变量：

### 主要更新内容：
1. **页面容器**：`.page` 和 `.container` 使用新的间距和布局变量
2. **首页区域**：`.home-section` 使用 `100dvh` 和 flexbox 居中
3. **文章页面**：`.posts-toolbar`、`.posts-search-wrap`、`.posts-list` 等使用新的间距和颜色变量
4. **文章详情**：`.post-page` 使用新的间距变量
5. **个人资料**：`.profile-card` 使用新的间距和颜色变量
6. **功能卡片**：`.features-card` 使用新的间距变量
7. **刷新按钮**：`.wallpaper-refresh-btn` 使用新的玻璃效果和过渡变量
8. **管理后台**：所有管理后台相关样式使用新的颜色、间距和圆角变量
9. **网盘页面**：所有网盘相关样式使用新的颜色、间距和圆角变量
10. **评论系统**：所有评论相关样式使用新的颜色和间距变量
11. **对话框**：所有对话框样式使用新的颜色和间距变量
12. **下载提示**：所有下载提示样式使用新的颜色和间距变量
13. **移动端菜单**：新增 `.mobile-menu-btn` 和响应式样式

### 新增样式：
- `.page` - 页面容器
- `.container` - 内容容器
- `.home-section` - 首页区域
- `.spinner` - 加载动画
- `.fade-in-stagger` - 淡入动画
- `body.menu-open` - 菜单打开状态
- `.mobile-menu-btn` - 移动端菜单按钮
- `@media (max-width: 768px)` - 移动端响应式样式

### CSS 变量映射：
- `--lg-text-*` → `--color-text-*`
- `--lg-accent` → `--color-accent`
- `--lg-glass-*` → `--glass-*`
- `--lg-radius-*` → `--radius-*`
- `--lg-font` → `--font-sans`
- `--lg-transition` → `--transition-fast`
- `--lg-nav-height` → `--nav-height`
- `--lg-*` 间距 → `--spacing-*`

## Concerns
无。所有更改已完成并通过 TypeScript 检查。
