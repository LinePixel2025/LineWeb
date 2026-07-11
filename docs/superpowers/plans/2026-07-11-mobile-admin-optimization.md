# 移动端管理界面优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将移动端管理后台导航从汉堡菜单侧边栏改为底部标签栏，并全面优化表格、表单、弹窗在小屏上的布局和触控交互。

**Architecture:** 移动端（<768px）使用底部 3 Tab 固定标签栏 + "更多"半屏弹窗替代侧边栏；桌面端（≥768px）保持现有侧边栏不变。CSS 媒体查询驱动切换，非 JS 监听。所有样式写入现有 CSS 文件，不引入新依赖。

**Tech Stack:** React 19, TypeScript, Vite 6, CSS (globals.css / pages.css / responsive.css)

## Global Constraints

- CSS 媒体查询驱动导航模式切换，不使用 JS 监听窗口大小
- 遵循现有 Liquid Glass 设计系统，不引入新依赖
- 所有触控目标 ≥ 44px（`(hover: none) and (pointer: coarse)` 媒体查询）
- 输入框字号 ≥ 16px（防止 iOS 自动缩放）
- 不影响桌面端现有体验
- 排除 PageEditor（拖拽式可视化编辑器）
- 断点：`768px`（导航切换）、`580px`（表格卡片）、`(hover: none) and (pointer: coarse)`（触控增强）

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `client/src/components/admin/AdminMobileNav.tsx` | 新建 | 底部标签栏 + 更多菜单组件 |
| `client/src/components/AdminLayout.tsx` | 修改 | 集成底部标签栏，条件渲染 |
| `client/src/styles/pages.css` | 修改 | 底部标签栏、更多菜单、侧边栏移动端修复 |
| `client/src/styles/responsive.css` | 修改 | 表格卡片增强、表单纵向堆叠、弹窗全屏 |
| `client/src/styles/components.css` | 修改 | 编辑器工具栏简化、Toast 位置调整 |
| `client/src/pages/AdminPage.tsx` | 修改 | 分页使用 Pagination 组件 |
| `client/src/pages/EditorPage.tsx` | 修改 | 表单布局优化、底部固定按钮 |
| `client/src/pages/admin/CommentAdminPage.tsx` | 修改 | 操作按钮优化 |
| `client/src/pages/admin/PageList.tsx` | 修改 | 分页使用 Pagination 组件 |
| `client/src/pages/admin/UserAdminPage.tsx` | 修改 | 分页使用 Pagination 组件、表单优化 |
| `client/src/pages/admin/ApiAdminPage.tsx` | 修改 | 弹窗移动端适配 |
| `client/src/pages/admin/DeviceMonitorPage.tsx` | 修改 | 统计卡片响应式 |

---

### Task 1: 创建 AdminMobileNav 底部标签栏组件

**Files:**
- Create: `client/src/components/admin/AdminMobileNav.tsx`

**Interfaces:**
- Consumes: `useLocation()` from react-router-dom, `useNavigate()` from react-router-dom
- Produces: `AdminBottomTabBar` 组件（底部标签栏）、`AdminMoreMenu` 组件（更多弹窗）

- [ ] **Step 1: 创建 AdminMobileNav.tsx 骨架**

```tsx
// client/src/components/admin/AdminMobileNav.tsx
import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const mainTabs = [
  { path: '/admin', label: '文章', icon: '📝' },
  { path: '/admin/comments', label: '评论', icon: '📬' },
]

const moreItems = [
  { path: '/admin/new', label: '写文章', icon: '✏️' },
  { path: '/admin/pages', label: '页面管理', icon: '📄' },
  { path: '/admin/users', label: '用户管理', icon: '👤' },
  { path: '/admin/api', label: 'API 密钥', icon: '🔑' },
  { path: '/admin/devices', label: '设备监控', icon: '📡' },
]

export function AdminBottomTabBar({ onMoreClick }: { onMoreClick: () => void }) {
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/admin') return location.pathname === '/admin'
    return location.pathname.startsWith(path)
  }

  return (
    <nav className="admin-bottom-tab-bar">
      {mainTabs.map(tab => (
        <a
          key={tab.path}
          href={tab.path}
          className={`admin-tab-item ${isActive(tab.path) ? 'admin-tab-item--active' : ''}`}
        >
          <span className="admin-tab-icon">{tab.icon}</span>
          <span className="admin-tab-label">{tab.label}</span>
        </a>
      ))}
      <button className="admin-tab-item" onClick={onMoreClick}>
        <span className="admin-tab-icon">⋯</span>
        <span className="admin-tab-label">更多</span>
      </button>
    </nav>
  )
}

export function AdminMoreMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()

  if (!open) return null

  const handleClick = (path: string) => {
    navigate(path)
    onClose()
  }

  return (
    <div className="admin-more-overlay" onClick={onClose}>
      <div className="admin-more-menu" onClick={e => e.stopPropagation()}>
        <div className="admin-more-header">
          <span>更多功能</span>
          <button className="admin-more-close" onClick={onClose}>✕</button>
        </div>
        <div className="admin-more-list">
          {moreItems.map(item => (
            <button
              key={item.path}
              className="admin-more-item"
              onClick={() => handleClick(item.path)}
            >
              <span className="admin-more-item-icon">{item.icon}</span>
              <span className="admin-more-item-label">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/components/admin/AdminMobileNav.tsx
git commit -m "feat(admin): add AdminBottomTabBar and AdminMoreMenu components"
```

---

### Task 2: AdminLayout 集成底部标签栏

**Files:**
- Modify: `client/src/components/AdminLayout.tsx:1-209`

**Interfaces:**
- Consumes: `AdminBottomTabBar`, `AdminMoreMenu` from `./admin/AdminMobileNav`
- Produces: 集成后的 AdminLayout，移动端显示底部标签栏，桌面端显示侧边栏

- [ ] **Step 1: 修改 AdminLayout.tsx 集成底部标签栏**

在 `AdminLayout.tsx` 的 import 区域添加：
```tsx
import { AdminBottomTabBar, AdminMoreMenu } from './admin/AdminMobileNav'
```

在组件内部添加 more menu 状态：
```tsx
const [moreOpen, setMoreOpen] = useState(false)
```

在 `{/* Background */}` 注释之前，`</aside>` 之后，添加底部标签栏：
```tsx
{/* Mobile bottom tab bar */}
<AdminBottomTabBar onMoreClick={() => setMoreOpen(true)} />
<AdminMoreMenu open={moreOpen} onClose={() => setMoreOpen(false)} />
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/components/AdminLayout.tsx
git commit -m "feat(admin): integrate bottom tab bar into AdminLayout"
```

---

### Task 3: 底部标签栏 CSS 样式

**Files:**
- Modify: `client/src/styles/pages.css:612-625`（在 admin-layout-overlay 之后添加）

**Interfaces:**
- Consumes: `.admin-bottom-tab-bar`, `.admin-tab-item`, `.admin-tab-item--active`, `.admin-tab-icon`, `.admin-tab-label` 类名
- Produces: 底部标签栏完整样式，仅在 <768px 显示

- [ ] **Step 1: 在 pages.css 的 `.admin-layout-overlay` 之后添加底部标签栏样式**

在 `client/src/styles/pages.css` 的 `body.admin-menu-open` 规则之后（约 625 行），添加：

```css
/* ============================================================
   Mobile Bottom Tab Bar (< 768px)
   ============================================================ */
.admin-bottom-tab-bar {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 200;
  height: 56px;
  padding-bottom: env(safe-area-inset-bottom);
  background: rgba(18, 18, 22, 0.85);
  backdrop-filter: blur(20px) saturate(1.4);
  -webkit-backdrop-filter: blur(20px) saturate(1.4);
  border-top: 1px solid var(--lg-glass-border);
  justify-content: space-around;
  align-items: center;
}

.admin-tab-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  flex: 1;
  height: 100%;
  border: none;
  background: none;
  color: var(--lg-text-tertiary);
  font-size: 0.68rem;
  cursor: pointer;
  transition: color 0.2s ease;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
}

.admin-tab-item--active {
  color: var(--lg-accent);
}

.admin-tab-icon {
  font-size: 1.25rem;
  line-height: 1;
}

.admin-tab-label {
  font-size: 0.65rem;
  font-weight: 500;
  line-height: 1;
}

/* More menu overlay */
.admin-more-overlay {
  display: none;
  position: fixed;
  inset: 0;
  z-index: 300;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

/* More menu panel */
.admin-more-menu {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  max-height: 60vh;
  background: rgba(28, 28, 34, 0.95);
  backdrop-filter: blur(24px) saturate(1.4);
  -webkit-backdrop-filter: blur(24px) saturate(1.4);
  border-top: 1px solid var(--lg-glass-border);
  border-radius: var(--lg-radius-lg) var(--lg-radius-lg) 0 0;
  overflow-y: auto;
  padding-bottom: env(safe-area-inset-bottom);
}

.admin-more-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--lg-text-primary);
  border-bottom: 1px solid var(--lg-glass-border);
}

.admin-more-close {
  background: none;
  border: none;
  color: var(--lg-text-tertiary);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s ease;
}

.admin-more-close:hover {
  background: rgba(255, 255, 255, 0.08);
}

.admin-more-list {
  padding: 8px 0;
}

.admin-more-item {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 14px 20px;
  border: none;
  background: none;
  color: var(--lg-text-secondary);
  font-size: 0.92rem;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  text-align: left;
  font-family: var(--lg-font);
  -webkit-tap-highlight-color: transparent;
}

.admin-more-item:hover,
.admin-more-item:active {
  background: rgba(255, 255, 255, 0.06);
  color: var(--lg-text-primary);
}

.admin-more-item-icon {
  font-size: 1.2rem;
  width: 24px;
  text-align: center;
}

.admin-more-item-label {
  font-weight: 500;
}

/* Show bottom tab bar on mobile */
@media (max-width: 767px) {
  .admin-bottom-tab-bar {
    display: flex;
  }

  .admin-more-overlay {
    display: block;
  }

  /* Add bottom padding to main content for tab bar */
  .admin-main {
    padding-bottom: 72px;
  }
}
```

- [ ] **Step 2: 验证页面无 TypeScript 错误**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/styles/pages.css
git commit -m "feat(admin): add bottom tab bar and more menu CSS styles"
```

---

### Task 4: 修复侧边栏移动端 CSS + 隐藏桌面端底部标签栏

**Files:**
- Modify: `client/src/styles/pages.css:339-357`（admin-sidebar 区域）
- Modify: `client/src/styles/pages.css:512-523`（admin-topbar-toggle 区域）
- Modify: `client/src/styles/pages.css:612-621`（admin-layout-overlay 区域）

**Interfaces:**
- Consumes: 现有 `.admin-sidebar`, `.admin-sidebar--open`, `.admin-topbar-toggle`, `.admin-layout-overlay`, `.admin-main` 类名
- Produces: 移动端侧边栏隐藏、桌面端底部标签栏隐藏

- [ ] **Step 1: 在 pages.css 末尾添加移动端媒体查询修复**

在 `pages.css` 文件末尾添加：

```css
/* ============================================================
   Admin Mobile Fixes (< 768px)
   ============================================================ */
@media (max-width: 767px) {
  /* Hide sidebar on mobile */
  .admin-sidebar {
    display: none;
  }

  /* Remove sidebar offset from main content */
  .admin-main {
    margin-left: 0;
  }

  .admin-main--collapsed {
    margin-left: 0;
  }

  /* Hide hamburger toggle on mobile (using bottom tab bar instead) */
  .admin-topbar-toggle {
    display: none;
  }

  /* Hide overlay (sidebar is hidden, no need for overlay) */
  .admin-layout-overlay {
    display: none;
  }

  /* Adjust topbar for mobile */
  .admin-topbar {
    padding: 0 12px;
  }

  /* Adjust content padding */
  .admin-content {
    padding: 16px 12px 24px;
  }

  /* Page header responsive */
  .admin-page-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }

  .admin-page-title {
    font-size: 1.2rem;
  }

  /* Wallpaper refresh button - move up to avoid tab bar overlap */
  .admin-wallpaper-refresh {
    bottom: 80px;
  }
}
```

- [ ] **Step 2: 验证页面无 TypeScript 错误**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/styles/pages.css
git commit -m "fix(admin): hide sidebar on mobile, remove sidebar offset, adjust layout"
```

---

### Task 5: 表格卡片布局增强

**Files:**
- Modify: `client/src/styles/responsive.css:255-333`（admin table mobile card layout）

**Interfaces:**
- Consumes: 现有 `.admin-table`, `.admin-row`, `.admin-cell`, `.admin-actions`, `.admin-badge` 类名
- Produces: 增强的卡片布局，操作按钮纵向排列，状态 pill 样式

- [ ] **Step 1: 替换 responsive.css 中 580px 媒体查询的 admin table 样式**

在 `client/src/styles/responsive.css` 中，找到 `@media (max-width: 580px)` 块中从 `.admin-table` 到 `.admin-cell--actions` 的所有规则（约 255-333 行），替换为：

```css
@media (max-width: 580px) {
  .admin-table {
    min-width: unset;
  }

  .admin-table thead {
    display: none;
  }

  .admin-table tbody,
  .admin-table tr,
  .admin-table td {
    display: block;
  }

  .admin-row {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px;
    position: relative;
    border-bottom: 1px solid var(--lg-glass-border);
    background: rgba(255, 255, 255, 0.02);
    border-radius: var(--lg-radius-md);
    margin-bottom: 8px;
  }

  .admin-row:last-child {
    margin-bottom: 0;
  }

  .admin-cell::before {
    display: none !important;
  }

  .admin-cell {
    padding: 0;
  }

  .admin-cell--title {
    max-width: unset;
    white-space: normal;
  }

  .admin-post-title {
    font-size: 1rem;
    font-weight: 600;
  }

  .admin-post-date {
    margin-top: 4px;
    font-size: 0.78rem;
  }

  .admin-cell--status {
    position: absolute;
    top: 16px;
    right: 16px;
  }

  /* Status badge pill enhancement */
  .admin-badge {
    font-size: 0.72rem;
    padding: 3px 10px;
    border-radius: 9999px;
    font-weight: 600;
  }

  /* Actions: full-width vertical on very small screens, horizontal on 360-580px */
  .admin-actions {
    display: flex;
    flex-direction: row;
    gap: 6px;
    flex-wrap: nowrap;
  }

  .admin-actions .liquid-btn {
    flex: 1;
    min-width: 0;
    justify-content: center;
    font-size: 0.78rem;
    padding: 6px 8px;
  }

  .admin-cell--actions {
    justify-content: stretch;
  }

  /* Pagination mobile simplification */
  .admin-pagination {
    gap: 4px;
  }

  .admin-page-btn {
    width: 44px;
    height: 44px;
    font-size: 0.9rem;
  }
}
```

- [ ] **Step 2: 验证页面无 TypeScript 错误**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/styles/responsive.css
git commit -m "feat(admin): enhance table card layout for mobile"
```

---

### Task 6: 表单/弹窗移动端优化 CSS

**Files:**
- Modify: `client/src/styles/responsive.css`（在 580px 媒体查询之后添加 768px 媒体查询）

**Interfaces:**
- Consumes: `.admin-modal`, `.admin-modal-overlay`, `.admin-modal-input`, `.admin-modal-footer`, `.lg-input`, `.editor-field`, `.editor-controls`, `.editor-actions` 类名
- Produces: 移动端全屏弹窗、纵向表单、输入框 16px 最小字号

- [ ] **Step 1: 在 responsive.css 末尾添加 768px 媒体查询**

在 `client/src/styles/responsive.css` 文件末尾添加：

```css
/* ============================================================
   Admin Mobile Forms & Modals (< 768px)
   ============================================================ */
@media (max-width: 767px) {
  /* Form fields: vertical stack */
  .editor-field {
    width: 100%;
  }

  .editor-field .lg-input,
  .admin-modal-input {
    font-size: 16px; /* prevent iOS zoom */
    min-height: 44px;
  }

  /* Editor controls: stack on mobile */
  .editor-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .editor-actions {
    flex-direction: column;
    gap: 8px;
  }

  .editor-actions .liquid-btn {
    width: 100%;
    justify-content: center;
  }

  /* Modal: near-fullscreen on mobile */
  .admin-modal-overlay {
    align-items: flex-end;
    padding: 0;
  }

  .admin-modal {
    max-width: 100%;
    width: 100%;
    margin: 0;
    border-radius: var(--lg-radius-lg) var(--lg-radius-lg) 0 0;
    max-height: 90vh;
    overflow-y: auto;
  }

  .admin-modal-footer {
    flex-direction: column;
    gap: 8px;
  }

  .admin-modal-btn {
    width: 100%;
    justify-content: center;
    min-height: 44px;
  }

  /* Comment edit form */
  .comment-edit-form textarea {
    font-size: 16px;
    min-height: 80px;
  }

  .comment-edit-actions {
    display: flex;
    gap: 8px;
  }

  .comment-edit-actions .liquid-btn {
    flex: 1;
    justify-content: center;
  }

  /* Stat cards responsive */
  .api-stat-cards {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  /* Device monitor header */
  .api-header-controls {
    flex-direction: column;
    width: 100%;
    gap: 8px;
  }

  .api-refresh-btn {
    width: 100%;
    justify-content: center;
  }

  /* User admin inline edit */
  .admin-cell--actions .lg-input {
    font-size: 16px;
    min-height: 40px;
  }

  /* Toast: top position to avoid tab bar */
  .toast-container {
    bottom: auto;
    top: 16px;
  }
}
```

- [ ] **Step 2: 验证页面无 TypeScript 错误**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/styles/responsive.css
git commit -m "feat(admin): mobile form, modal, and toast optimization CSS"
```

---

### Task 7: AdminPage 分页组件化 + EditorPage 优化

**Files:**
- Modify: `client/src/pages/AdminPage.tsx:101-107`（分页区域）
- Modify: `client/src/pages/EditorPage.tsx:100-175`（表单布局）

**Interfaces:**
- Consumes: `Pagination` from `../components/Pagination`
- Produces: AdminPage 使用 Pagination 组件，EditorPage 表单纵向堆叠

- [ ] **Step 1: AdminPage 已使用 Pagination 组件，无需修改**

AdminPage.tsx 第 101-107 行已经使用了 `<Pagination>` 组件，无需修改。

- [ ] **Step 2: EditorPage 表单布局优化**

在 `client/src/pages/EditorPage.tsx` 中，将 Slug 和摘要的横向布局改为纵向。

找到第 113-130 行的 Slug + 摘要横向布局：
```tsx
<div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
  <div className="editor-field" style={{ flex: 1, minWidth: 180 }}>
    ...
  </div>
  <div className="editor-field" style={{ flex: 2, minWidth: 240 }}>
    ...
  </div>
</div>
```

替换为纵向布局：
```tsx
<div className="editor-field">
  <label className="editor-label">Slug</label>
  <input
    className="lg-input"
    value={slug}
    onChange={e => setSlug(e.target.value)}
    placeholder={title ? toSlug(title) : 'article-slug'}
  />
</div>

<div className="editor-field">
  <label className="editor-label">摘要</label>
  <input
    className="lg-input"
    value={summary}
    onChange={e => setSummary(e.target.value)}
    placeholder="文章摘要（可选）"
  />
</div>
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add client/src/pages/EditorPage.tsx
git commit -m "feat(admin): EditorPage form vertical layout for mobile"
```

---

### Task 8: PageList / UserAdminPage / CommentAdminPage 分页组件化

**Files:**
- Modify: `client/src/pages/admin/PageList.tsx:99-135`（内联分页 → Pagination 组件）
- Modify: `client/src/pages/admin/UserAdminPage.tsx:184-209`（内联分页 → Pagination 组件）
- Modify: `client/src/pages/admin/CommentAdminPage.tsx`（无分页，仅检查）

**Interfaces:**
- Consumes: `Pagination` from `../../components/Pagination`
- Produces: PageList、UserAdminPage 使用 Pagination 组件替代内联分页逻辑

- [ ] **Step 1: PageList 使用 Pagination 组件**

在 `client/src/pages/admin/PageList.tsx` 顶部添加 import：
```tsx
import Pagination from '../../components/Pagination'
```

找到第 99-135 行的内联分页逻辑：
```tsx
{data && data.totalPages > 1 && (
  <div className="admin-pagination">
    {(() => {
      ...
    })()}
  </div>
)}
```

替换为：
```tsx
{data && data.totalPages > 1 && (
  <Pagination
    page={page}
    totalPages={data.totalPages}
    onPageChange={setPage}
  />
)}
```

- [ ] **Step 2: UserAdminPage 使用 Pagination 组件**

在 `client/src/pages/admin/UserAdminPage.tsx` 顶部添加 import：
```tsx
import Pagination from '../../components/Pagination'
```

找到第 184-209 行的内联分页逻辑：
```tsx
{totalPages > 1 && (
  <div className="admin-pagination">
    {(() => {
      ...
    })()}
  </div>
)}
```

替换为：
```tsx
{totalPages > 1 && (
  <Pagination
    page={page}
    totalPages={totalPages}
    onPageChange={setPage}
  />
)}
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add client/src/pages/admin/PageList.tsx client/src/pages/admin/UserAdminPage.tsx
git commit -m "refactor(admin): use Pagination component in PageList and UserAdminPage"
```

---

### Task 9: ApiAdminPage / DeviceMonitorPage 移动端优化

**Files:**
- Modify: `client/src/pages/admin/ApiAdminPage.tsx`（弹窗已使用 admin-modal 类，CSS 层处理）
- Modify: `client/src/pages/admin/DeviceMonitorPage.tsx:27-31`（统计卡片响应式）

**Interfaces:**
- Consumes: 已有的 `.api-stat-cards`, `.api-header-controls` 类名
- Produces: DeviceMonitorPage 统计卡片在移动端单列布局

- [ ] **Step 1: DeviceMonitorPage 统计卡片添加响应式类**

在 `client/src/pages/admin/DeviceMonitorPage.tsx` 中，找到第 27-31 行的 stats 数组定义后的渲染（约 107 行）：

```tsx
<div className="api-stat-cards">
```

这个类名已经在 CSS 中有 `api-stat-cards`，需要确认 responsive.css 中有对应的移动端样式。在 Task 6 中已添加 `.api-stat-cards { grid-template-columns: 1fr; }`，所以此处无需修改。

ApiAdminPage 的弹窗使用 `.admin-modal` 类，Task 6 的 CSS 已处理移动端全屏弹窗，无需修改页面代码。

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add client/src/pages/admin/DeviceMonitorPage.tsx
git commit -m "feat(admin): DeviceMonitorPage responsive stat cards"
```

---

### Task 10: 最终验证与截图测试

**Files:**
- Modify: 如有需要，调整任何遗漏的样式

**Interfaces:**
- Consumes: 所有前述任务的产出
- Produces: 完整的移动端管理界面优化

- [ ] **Step 1: 启动开发服务器**

Run: `npm run dev`
Expected: 前端 localhost:5173，后端 localhost:3001

- [ ] **Step 2: 运行 TypeScript 检查**

Run: `cd client && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 运行截图测试**

Run: `node scripts/screenshot-admin.cjs`
Expected: 截图中底部标签栏可见，侧边栏隐藏，无水平溢出

- [ ] **Step 4: 手动检查清单**

在浏览器中打开 localhost:5173，使用开发者工具切换到移动视图（375x812）：

1. `/admin` — 底部标签栏可见，文章列表卡片布局正常
2. `/admin/comments` — 评论列表卡片布局正常
3. `/admin/new` — 表单纵向堆叠，工具栏简化，底部按钮固定
4. `/admin/pages` — 页面列表卡片布局正常
5. `/admin/users` — 用户列表卡片布局正常，编辑表单正常
6. `/admin/api` — API 密钥列表卡片布局，弹窗全屏显示
7. `/admin/devices` — 统计卡片单列，在线设备表格卡片布局
8. 点击"更多"按钮 — 半屏弹窗从底部滑出，包含 5 个导航项
9. 桌面视图（≥768px）— 侧边栏正常显示，底部标签栏隐藏

- [ ] **Step 5: 提交最终修复（如有）**

```bash
git add -A
git commit -m "fix(admin): final mobile optimization adjustments"
```
