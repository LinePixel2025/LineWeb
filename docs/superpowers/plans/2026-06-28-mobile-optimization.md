# 移动端体验全面优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全面提升 Line Web 项目在移动设备上的用户体验，使所有页面在 360px-768px 范围内获得可用、美观、流畅的交互。

**Architecture:** CSS 响应式为主、`useResponsive` hook 为辅的混合策略。在 `globals.css` 扩展统一断点体系，核心组件添加触摸优化，管理后台表格在窄屏切换为卡片式布局。PWA 基础支持通过 manifest 和 meta 标签实现。

**Tech Stack:** React 19 + TypeScript 5 + Vite 6 + CSS Custom Properties + PWA

## Global Constraints

- 所有 CSS 改动集中在 `client/src/styles/globals.css`（项目中唯一的 CSS 文件）
- 不引入新的 CSS 预处理器或 CSS-in-JS 库
- 不破坏桌面端现有体验，桌面断点（`>1024px`）不动
- 新 CSS 断点复用现有断点值：360px / 480px / 768px / 1024px
- 触摸反馈需同时考虑 iOS Safari 和 Chrome Android
- `useResponsive` hook 不可引入额外依赖，纯原生 DOM API
- 所有新创建的文件需在 git commit 中一起提交

---

### Task 1: CSS 响应式基础扩展

**Files:**
- Modify: `client/src/styles/globals.css` — 在已有 `/* Mobile */` 区域后追加

**Interfaces:**
- Produces: CSS 全局样式扩展，被所有后续任务直接使用

- [ ] **Step 1: 添加 h3/h4 移动端字体缩放 + 360px 极窄屏适配**

在 globals.css 的 `@media (max-width: 480px)` 块（约1129-1139行）之后，添加：

```css
/* h3/h4 responsive */
@media (max-width: 768px) {
  h3 { font-size: 1.2rem; }
  h4 { font-size: 1rem; }
}

@media (max-width: 480px) {
  h3 { font-size: 1.1rem; }
  h4 { font-size: 0.95rem; }
  body { font-size: 0.92rem; }
}

/* Extra small devices — iPhone SE */
@media (max-width: 360px) {
  .container { padding: 0 8px; }
  .lg-surface { padding: 12px; }
  .lg-surface-strong { padding: 14px; }
  .page { padding-top: calc(var(--lg-nav-height) + 16px); padding-bottom: 32px; }
}
```

- [ ] **Step 2: 添加全局 transition 变量与动画移动端降级**

在 globals.css 的 `:root` 区域（前60行内）添加：

```css
:root {
  /* 已有属性... */

  /* Touch target minimums */
  --lg-touch-target-min: 44px;
  --lg-touch-target-min-sm: 36px;
}
```

然后在 `/* Mobile */` 区域（约1020行）之前，找到 `prefers-reduced-motion` 媒体查询之前的区域添加降级：

```css
/* Mobile animation downgrade */
@media (max-width: 768px) {
  * { --lg-transition: 0.15s ease; }
  .fade-in { animation-duration: 0.25s !important; }
}
```

- [ ] **Step 3: 提交**

```bash
git add client/src/styles/globals.css
git commit -m "perf(mobile): 响应式基础扩展 — h3/h4 字体、360px 断点、动画降级"
```

---

### Task 2: 新增 useResponsive Hook

**Files:**
- Create: `client/src/hooks/useResponsive.ts`

**Interfaces:**
- Produces: `useResponsive()` hook — 返回 `{ breakpoint, isMobile, isTablet, isDesktop }` 四个属性，供后续任务（PostPage 等）需要 JS 响应逻辑时使用

- [ ] **Step 1: 创建 useResponsive.ts**

```typescript
import { useState, useEffect } from 'react'

export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

function getBreakpoint(): Breakpoint {
  if (typeof window === 'undefined') return 'desktop'
  if (window.innerWidth <= 480) return 'mobile'
  if (window.innerWidth <= 768) return 'tablet'
  return 'desktop'
}

export function useResponsive() {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint)

  useEffect(() => {
    const handleResize = () => setBp(getBreakpoint())
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return {
    breakpoint: bp,
    isMobile: bp === 'mobile',
    isTablet: bp === 'tablet',
    isDesktop: bp === 'desktop',
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add client/src/hooks/useResponsive.ts
git commit -m "feat: 新增 useResponsive hook"
```

---

### Task 3: LiquidButton 触摸反馈增强

**Files:**
- Modify: `client/src/components/glass/LiquidButton.tsx`
- Modify: `client/src/styles/globals.css` — 添加 `hover:none` 去粘滞

**Interfaces:**
- Consumes: 无外部依赖
- Produces: LiquidButton 组件触摸缩放效果

- [ ] **Step 1: LiquidButton 添加触摸缩放状态**

修改 LiquidButton，添加 `touchScale` 状态：

```tsx
import React, { memo, useState } from 'react'
import { Link } from 'react-router-dom'

export interface LiquidButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'glass' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  to?: string
  href?: string
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
}

const LiquidButton = memo(function LiquidButton({
  children,
  variant = 'glass',
  size = 'md',
  to,
  href,
  onClick,
  type = 'button',
  disabled = false,
  className = '',
  style,
}: LiquidButtonProps) {
  const [touchScale, setTouchScale] = useState(1)

  const cls = `liquid-btn ${variant} ${size} ${className}`

  const mergedStyle: React.CSSProperties = {
    ...style,
    transform: `scale(${touchScale})`,
    transition: 'transform 0.15s ease, box-shadow 0.25s ease, background 0.25s ease, color 0.25s ease',
  }

  const touchHandlers = disabled ? {} : {
    onTouchStart: () => setTouchScale(0.96),
    onTouchEnd: () => setTouchScale(1),
  }

  const content = (
    <>
      {children}
      <span className="btn-flare" />
    </>
  )

  if (to) {
    return (
      <Link to={to} className={cls} style={mergedStyle} {...touchHandlers}>
        {content}
      </Link>
    )
  }

  if (href) {
    return (
      <a href={href} className={cls} style={mergedStyle} target="_blank" rel="noopener noreferrer" {...touchHandlers}>
        {content}
      </a>
    )
  }

  return (
    <button type={type} disabled={disabled} onClick={onClick} className={cls} style={mergedStyle} {...touchHandlers}>
      {content}
    </button>
  )
})

export default LiquidButton
```

- [ ] **Step 2: globals.css 添加 hover:none 去粘滞**

在已有 `/* Larger touch targets for mobile */` 的 `@media (hover: none) and (pointer: coarse)` 块（约1142-1147行）中添加：

```css
.liquid-btn:hover {
  transform: none !important;
}

.drive-grid-card:hover .drive-grid-card-actions {
  opacity: 1;
}
```

- [ ] **Step 3: 提交**

```bash
git add client/src/components/glass/LiquidButton.tsx client/src/styles/globals.css
git commit -m "feat: LiquidButton 触摸缩放反馈 + 移动端 hover 去粘滞"
```

---

### Task 4: LiquidGlass 移动端性能优化

**Files:**
- Modify: `client/src/components/glass/LiquidGlass.tsx`
- Modify: `client/src/styles/globals.css`

- [ ] **Step 1: LiquidGlass 降低移动端镜面高光帧率 + 隐藏色差**

在 LiquidGlass.tsx 的 `onMove` 回调中添加节流，并在 480px 以下关闭 chromatic：

```tsx
// 在 LiquidGlass 组件顶部添加常量
const HIGHLIGHT_THROTTLE_MS = typeof window !== 'undefined' && window.innerWidth <= 768 ? 50 : 16

// 然后在 useEffect 中添加节流逻辑 (修改 onMove 函数)
const onMove = (e: MouseEvent | TouchEvent) => {
  // 每帧只读一次 getBoundingClientRect
  if (!cachedRect) {
    cachedRect = el.getBoundingClientRect()
    rectFrame = requestAnimationFrame(() => { cachedRect = null })
  }

  // 节流：在移动设备上降低刷新频率
  const now = performance.now()
  if (now - lastMoveTime < HIGHLIGHT_THROTTLE_MS) return
  lastMoveTime = now

  let cx = 0, cy = 0
  if ('touches' in e && e.touches.length > 0) {
    cx = e.touches[0].clientX - cachedRect.left
    cy = e.touches[0].clientY - cachedRect.top
  } else if ('clientX' in e) {
    cx = e.clientX - cachedRect.left
    cy = e.clientY - cachedRect.top
  }

  const x = Math.max(5, Math.min(95, (cx / cachedRect.width) * 100))
  const y = Math.max(5, Math.min(95, (cy / cachedRect.height) * 100))
  specular.style.background = `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)`
}

// 添加 lastMoveTime 变量引用
let lastMoveTime = 0
```

同时用 CSS 在 480px 以下隐藏色差边缘：

```css
@media (max-width: 480px) {
  .lg-surface, .lg-surface-strong {
    backdrop-filter: blur(8px) saturate(140%);
  }
}
```

注意：确保 `lastMoveTime` 变量在 `useEffect` 的清理函数中不会被意外清除 —— 可以用 `useRef` 来持久化：

```tsx
const lastMoveRef = useRef(0)

// 在 onMove 中：
const now = Date.now()
if (now - lastMoveRef.current < HIGHLIGHT_THROTTLE_MS) return
lastMoveRef.current = now
```

完整的 useEffect 修改后代码：

```tsx
useEffect(() => {
  if (!interactive) return
  const el = ref.current
  const specular = specularRef.current
  if (!el || !specular) return

  let cachedRect: DOMRect | null = null
  let rectFrame = 0
  let lastMove = 0
  const throttleMs = window.innerWidth <= 768 ? 50 : 16

  const onMove = (e: MouseEvent | TouchEvent) => {
    if (!cachedRect) {
      cachedRect = el.getBoundingClientRect()
      rectFrame = requestAnimationFrame(() => { cachedRect = null })
    }

    const now = Date.now()
    if (now - lastMove < throttleMs) return
    lastMove = now

    let cx = 0, cy = 0
    if ('touches' in e && e.touches.length > 0) {
      cx = e.touches[0].clientX - cachedRect.left
      cy = e.touches[0].clientY - cachedRect.top
    } else if ('clientX' in e) {
      cx = e.clientX - cachedRect.left
      cy = e.clientY - cachedRect.top
    }

    const x = Math.max(5, Math.min(95, (cx / cachedRect.width) * 100))
    const y = Math.max(5, Math.min(95, (cy / cachedRect.height) * 100))
    specular.style.background = `radial-gradient(circle at ${x}% ${y}%, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.08) 30%, transparent 60%)`
  }

  el.addEventListener('mousemove', onMove)
  el.addEventListener('touchmove', onMove, { passive: true })
  return () => {
    el.removeEventListener('mousemove', onMove)
    el.removeEventListener('touchmove', onMove)
    cancelAnimationFrame(rectFrame)
  }
}, [interactive])
```

- [ ] **Step 2: 提交**

```bash
git add client/src/components/glass/LiquidGlass.tsx client/src/styles/globals.css
git commit -m "perf(mobile): LiquidGlass 移动端帧率节流 + blur 降级"
```

---

### Task 5: PostPage 文章详情页移动端适配

**Files:**
- Modify: `client/src/pages/PostPage.tsx`
- Modify: `client/src/styles/globals.css` — 添加 post-page 相关 CSS

- [ ] **Step 1: globals.css 添加 post-page 响应式样式**

在 `/* Mobile */` 区域后新增：

```css
/* ============================================================
   Post Page — 文章详情
   ============================================================ */
.post-page { max-width: 720px; }

.post-content-card {
  padding: 32px;
}

.post-page .post-title {
  font-size: 2rem;
  line-height: 1.3;
}

.post-page .post-meta {
  display: flex;
  gap: 16px;
  margin-top: 12px;
  margin-bottom: 32px;
}

.post-back-link {
  display: inline-block;
  margin-bottom: 24px;
  font-size: 0.9rem;
}

@media (max-width: 768px) {
  .post-content-card { padding: 20px; }
  .post-page .post-title { font-size: 1.6rem; }
  .post-page .post-meta { flex-direction: column; gap: 4px; }
  .post-back-link { margin-bottom: 20px; }
}

@media (max-width: 480px) {
  .post-content-card {
    padding: 16px;
    border-radius: var(--lg-radius-md);
  }
  .post-page .post-title { font-size: 1.35rem; }
  .article-content { font-size: 0.95rem; line-height: 1.75; }
  .post-back-link { font-size: 0.82rem; margin-bottom: 16px; }
}
```

- [ ] **Step 2: 修改 PostPage.tsx —— 使用 CSS class 替代 inline style**

将 PostPage 中文章卡片部分的 inline style 迁移为 CSS class：

```tsx
// 修改前：
<LiquidGlass variant="blur" interactive={false} style={{ padding: '32px' }}>
  <h1 className="post-title">{post.title}</h1>
  <div style={{ display: 'flex', gap: '16px', marginTop: '12px', marginBottom: '32px' }}>
    <span className="text-tertiary">{post.author.username}</span>
    <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
  </div>
  <div className="article-content" dangerouslySetInnerHTML={{ __html: post.content }} />
</LiquidGlass>

// 修改后：
<LiquidGlass variant="blur" interactive={false} className="post-content-card">
  <h1 className="post-title">{post.title}</h1>
  <div className="post-meta">
    <span className="text-tertiary">{post.author.username}</span>
    <span className="text-tertiary">{new Date(post.createdAt).toLocaleDateString('zh-CN')}</span>
  </div>
  <div className="article-content" dangerouslySetInnerHTML={{ __html: post.content }} />
</LiquidGlass>
```

同时将 `return` 中的 `style={{ fontSize: '0.9rem' }}` 替换为可复用 CSS（不用额外 class 的话保留但这不是关键）。

- [ ] **Step 3: 提交**

```bash
git add client/src/pages/PostPage.tsx client/src/styles/globals.css
git commit -m "feat(mobile): PostPage 文章详情页响应式适配"
```

---

### Task 6: ProfilePage 个人中心移动端适配

**Files:**
- Modify: `client/src/pages/ProfilePage.tsx`
- Modify: `client/src/styles/globals.css` — 添加 profile-page CSS

- [ ] **Step 1: globals.css 添加 profile-page 响应式样式**

```css
/* ============================================================
   Profile Page — 个人中心
   ============================================================ */
.profile-page .profile-card {
  padding: 32px;
}

.profile-page .profile-label {
  font-size: 0.75rem;
  display: block;
  margin-bottom: 8px;
  color: rgba(255,255,255,0.45);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.profile-page .profile-btn-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

@media (max-width: 480px) {
  .profile-page .profile-card { padding: 20px; }
  .profile-page h1 { font-size: 1.3rem; }
  .profile-page .profile-btn-row { flex-direction: column; align-items: stretch; }
}
```

- [ ] **Step 2: 修改 ProfilePage.tsx —— 迁移 inline style 到 CSS class**

将 `labelStyle` 对象改为使用 CSS class（`profile-label`），卡片 `style={{ padding: '32px' }}` 改为 className `profile-card`，保存按钮区域 `div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}` 改为 `profile-btn-row`。

注意：由于 LiquidGlass 接受 `className` 属性，卡片可以直接传 `className="profile-card"`。但 `labelStyle` 被用在多个地方且 inline 了 —— 可以先保留 `labelStyle` 作为 JS 变量，同时添加 `profile-label` 的 CSS 副本。以后逐步统一。

关键改动：
- LiquidGlass 上的 `style={{ padding: '32px', marginBottom: '24px' }}` → 保留 LiquidGlass 的 style，添加 `className="profile-card"`
- labelStyle 定义的样式——迁移到 CSS class，JSX 中 className="profile-label"
- 保存按钮行（`handleSave` 下方的 `div`） → `className="profile-btn-row"`

```tsx
// 修改前：
<LiquidGlass variant="strong" chromatic={false} style={{ padding: '32px', marginBottom: '24px' }}>

// 修改后：
<LiquidGlass variant="strong" chromatic={false} style={{ marginBottom: '24px' }} className="profile-card">
```

- [ ] **Step 3: 提交**

```bash
git add client/src/pages/ProfilePage.tsx client/src/styles/globals.css
git commit -m "feat(mobile): ProfilePage 个人中心响应式适配"
```

---

### Task 7: DynamicPage columns 修复

**Files:**
- Modify: `client/src/pages/DynamicPage.tsx`

- [ ] **Step 1: columns case 添加 flex-wrap**

```tsx
case 'columns': {
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      {comp.children.map(child => (
        <div key={child.id} style={{ flex: '1 1 200px', minWidth: 0 }}>
          <RenderComponent comp={child} />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 提交**

```bash
git add client/src/pages/DynamicPage.tsx
git commit -m "fix(mobile): DynamicPage columns 添加 flex-wrap 防溢出"
```

---

### Task 8: CommentSection 评论系统移动端适配

**Files:**
- Modify: `client/src/styles/globals.css` — 添加 comment-section 响应式

- [ ] **Step 1: globals.css 添加评论系统响应式**

在 CSS 中找到 comment-section 相关区域（约3118-3220行），在 `/* Comment admin */` 上方添加：

```css
/* Comment section responsive */
@media (max-width: 480px) {
  .comment-section > .comment-form .lg-surface,
  .comment-section .lg-surface[class*="blur"] {
    padding: 16px !important;
  }

  .comment-item {
    font-size: 0.9rem;
  }

  .comment-meta {
    flex-direction: column;
    gap: 2px;
  }

  .comment-time {
    font-size: 0.78rem;
  }

  .comment-actions {
    flex-direction: column;
    gap: 4px;
  }

  .comment-actions .liquid-btn {
    width: 100%;
    justify-content: center;
  }

  .reply-form textarea {
    font-size: 0.9rem;
  }

  .reply-form-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .reply-form-actions > div {
    justify-content: stretch;
  }

  .reply-form-actions .liquid-btn {
    flex: 1;
    justify-content: center;
  }

  .replies-section {
    margin-left: 0;
    padding-left: 8px;
  }

  .reply-item {
    margin-top: 8px;
  }

  .comment-heading {
    font-size: 1.1rem;
  }

  .comment-form-actions {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .comment-form-actions .liquid-btn {
    width: 100%;
    justify-content: center;
  }

  .comment-input {
    font-size: 0.9rem;
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add client/src/styles/globals.css
git commit -m "feat(mobile): CommentSection 评论系统响应式适配"
```

---

### Task 9: PostsPage + FeaturesPage 移动端适配

**Files:**
- Modify: `client/src/pages/PostsPage.tsx`
- Modify: `client/src/styles/globals.css`

- [ ] **Step 1: PostsPage 分页按钮移动端缩小**

修改 globals.css 添加分页按钮响应式：

```css
/* ============================================================
   Pagination — 分页控件
   ============================================================ */
.pagination-btn {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--lg-glass-bg);
  color: var(--lg-text-primary);
  border: 1px solid var(--lg-glass-border);
  cursor: pointer;
  font-weight: 500;
  font-family: var(--lg-font);
  font-size: 0.95rem;
  transition: all 0.2s ease;
  -webkit-tap-highlight-color: transparent;
}

.pagination-btn--active {
  background: var(--lg-accent);
  color: white;
}

.pagination-btn:active {
  transform: scale(0.92);
}

@media (max-width: 480px) {
  .pagination-btn {
    width: 36px;
    height: 36px;
    font-size: 0.85rem;
  }
}
```

- [ ] **Step 2: 简化 PostsPage.tsx 中的分页按钮 inline style**

将 PostsPage.tsx 中分页按钮的 inline `style` 替换为 CSS class：

```tsx
// 修改前：
<button key={p} onClick={() => setPage(p)}
  style={{
    width: '40px', height: '40px', borderRadius: '50%',
    background: p === page ? 'var(--lg-accent)' : 'var(--lg-glass-bg)',
    color: p === page ? 'white' : 'var(--lg-text-primary)',
    border: '1px solid var(--lg-glass-border)', cursor: 'pointer',
    fontWeight: 500, fontFamily: 'var(--lg-font)',
    fontSize: '0.95rem',
    transition: 'all 0.2s ease',
    WebkitTapHighlightColor: 'transparent',
  }}
>

// 修改后：
<button key={p} onClick={() => setPage(p)}
  className={`pagination-btn${p === page ? ' pagination-btn--active' : ''}`}
>
```

- [ ] **Step 3: FeaturesPage 卡片响应式**

在 FeaturesPage.tsx 中，卡片使用了 inline style 来控制 padding 和 emoji 大小。CSS 无法覆盖 inline style，所以需要修改 JSX。给卡片外层 div 添加 `className="features-card"`，给 emoji div 添加 `className="features-emoji"`：

在 FeaturesPage.tsx 的功能卡片 map 中：

```tsx
// 修改前：
<LiquidGlass
  variant="strong" chromatic={false}
  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', textAlign: 'center', padding: '40px 24px', gap: '16px',
    animation: `fadeIn 0.5s ease-out ${i * 0.1}s both` }}
>
  <div style={{ fontSize: '2.8rem', lineHeight: 1 }}>
    {item.emoji}
  </div>

// 修改后：
<LiquidGlass
  variant="strong" chromatic={false}
  className="features-card"
  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', textAlign: 'center', gap: '16px',
    animation: `fadeIn 0.5s ease-out ${i * 0.1}s both` }}
>
  <div className="features-emoji" style={{ lineHeight: 1 }}>
    {item.emoji}
  </div>
```

自定义页面卡片部分同样的修改。

然后在 globals.css 添加：

```css
.features-card {
  padding: 40px 24px;
}

.features-card .features-emoji {
  font-size: 2.8rem;
}

@media (max-width: 480px) {
  .features-card { padding: 28px 20px !important; }
  .features-card .features-emoji { font-size: 2.2rem; }
  .features-card h3 { font-size: 1.05rem; }
}
```

- [ ] **Step 4: 提交**

```bash
git add client/src/pages/PostsPage.tsx client/src/pages/FeaturesPage.tsx client/src/styles/globals.css
git commit -m "feat(mobile): PostsPage 分页 + FeaturesPage 卡片响应式"
```

---

### Task 10: 管理后台表格卡片化

**Files:**
- Modify: `client/src/styles/globals.css` — 添加表格卡片化 CSS
- Modify: `client/src/pages/AdminPage.tsx` — 添加 data-label 属性
- Modify: `client/src/pages/admin/CommentAdminPage.tsx` — 添加 data-label 属性
- Modify: `client/src/pages/admin/UserAdminPage.tsx` — 添加 data-label 属性
- Modify: `client/src/pages/admin/PageList.tsx` — 添加 data-label 属性

- [ ] **Step 1: globals.css 添加表格卡片化 CSS**

在现有 admin table CSS 区域（约1630-1810行）追加：

```css
/* Admin table — mobile card layout */
@media (max-width: 580px) {
  .admin-table { min-width: unset; }
  .admin-table thead { display: none; }

  .admin-table tbody,
  .admin-table tr,
  .admin-table td { display: block; }

  .admin-row {
    display: block;
    padding: 14px;
    border-bottom: 1px solid var(--lg-glass-border);
  }

  .admin-cell {
    padding: 4px 0;
    border: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .admin-cell--title {
    max-width: unset;
    white-space: normal;
  }

  .admin-cell::before {
    content: attr(data-label);
    font-weight: 500;
    color: var(--lg-text-tertiary);
    font-size: 0.78rem;
    flex-shrink: 0;
    margin-right: 8px;
  }

  .admin-actions {
    justify-content: flex-start;
    margin-top: 8px;
  }

  .admin-cell--actions {
    justify-content: flex-start;
  }

  .admin-th--title { display: none; }
  .admin-th--status, .admin-th--actions { display: none; }
}
```

- [ ] **Step 2: AdminPage.tsx 添加 data-label**

打开 `client/src/pages/AdminPage.tsx`，找到表格中每个 `<td>` 元素，如：

```tsx
// 修改前：
<td className="admin-cell admin-cell--title">
  <div className="admin-post-title">{post.title}</div>
</td>
<td className="admin-cell">
  <span className={`admin-badge ${...}`}>{post.published ? '已发布' : '草稿'}</span>
</td>
<td className="admin-cell admin-cell--date">
  {new Date(post.createdAt).toLocaleDateString('zh-CN')}
</td>
<td className="admin-cell admin-cell--actions">
  ...
</td>

// 修改后：
<td className="admin-cell admin-cell--title" data-label="标题">
  <div className="admin-post-title">{post.title}</div>
</td>
<td className="admin-cell" data-label="状态">
  <span className={`admin-badge ${...}`}>{post.published ? '已发布' : '草稿'}</span>
</td>
<td className="admin-cell admin-cell--date" data-label="时间">
  {new Date(post.createdAt).toLocaleDateString('zh-CN')}
</td>
<td className="admin-cell admin-cell--actions" data-label="操作">
  ...
</td>
```

- [ ] **Step 3: CommentAdminPage.tsx 添加 data-label**

对 CommentAdminPage 表格中每列添加：

```tsx
<th className="admin-th">评论内容</th>
<th className="admin-th">作者</th>
<th className="admin-th">类型</th>
<th className="admin-th">时间</th>
<th className="admin-th admin-th--actions">操作</th>
```

```tsx
<td className="admin-cell admin-cell--comment" data-label="评论内容">
<td className="admin-cell" data-label="作者">
<td className="admin-cell" data-label="类型">
<td className="admin-cell admin-cell--date" data-label="时间">
<td className="admin-cell admin-cell--actions" data-label="操作">
```

以及顶部文章列表表格：

```tsx
<td className="admin-cell" data-label="文章标题">
<td className="admin-cell" data-label="评论数">
<td className="admin-cell admin-cell--date" data-label="最新评论">
<td className="admin-cell admin-cell--actions" data-label="操作">
```

- [ ] **Step 4: UserAdminPage.tsx 添加 data-label**

```tsx
<td className="admin-cell" data-label="用户名">
<td className="admin-cell" data-label="邮箱">
<td className="admin-cell" data-label="角色">
<td className="admin-cell admin-cell--date" data-label="注册时间">
<td className="admin-cell admin-cell--actions" data-label="操作">
```

- [ ] **Step 5: PageList.tsx 添加 data-label**

```tsx
<td className="admin-cell" data-label="标题">
<td className="admin-cell" data-label="状态">
<td className="admin-cell" data-label="主页展示">
<td className="admin-cell admin-cell--date" data-label="创建时间">
<td className="admin-cell admin-cell--actions" data-label="操作">
```

- [ ] **Step 6: 提交**

```bash
git add client/src/styles/globals.css client/src/pages/AdminPage.tsx client/src/pages/admin/CommentAdminPage.tsx client/src/pages/admin/UserAdminPage.tsx client/src/pages/admin/PageList.tsx
git commit -m "feat(mobile): 管理后台表格卡片式布局 + data-label"
```

---

### Task 11: Navbar 触摸增强

**Files:**
- Modify: `client/src/components/Navbar.tsx`
- Modify: `client/src/styles/globals.css`

- [ ] **Step 1: 点击外部关闭菜单添加 touchstart 支持**

```tsx
// 修改 useEffect （约32-41行）
useEffect(() => {
  if (!mobileOpen) return
  const handleClickOutside = (e: MouseEvent | TouchEvent) => {
    if (!menuRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) {
      setMobileOpen(false)
    }
  }
  document.addEventListener('mousedown', handleClickOutside)
  document.addEventListener('touchstart', handleClickOutside, { passive: true })
  return () => {
    document.removeEventListener('mousedown', handleClickOutside)
    document.removeEventListener('touchstart', handleClickOutside)
  }
}, [mobileOpen])
```

- [ ] **Step 2: 360px 下 navbar 缩小**

```css
@media (max-width: 360px) {
  .navbar {
    width: calc(100% - 24px);
    height: 48px;
  }
  .navbar-inner { padding: 0 12px; }
  .navbar-logo { font-size: 1rem; }
}
```

- [ ] **Step 3: 提交**

```bash
git add client/src/components/Navbar.tsx client/src/styles/globals.css
git commit -m "feat(mobile): Navbar touchstart 监听 + 360px 适配"
```

---

### Task 12: PWA + iOS 支持 + Layout 调整

**Files:**
- Create: `client/public/manifest.json`
- Modify: `client/index.html`
- Create: `client/public/icon-192.png`（占位，实际需生成）
- Create: `client/public/icon-512.png`（占位，实际需生成）

- [ ] **Step 1: 创建 manifest.json**

```json
{
  "name": "Line Web",
  "short_name": "LineWeb",
  "description": "一个融合 Liquid Glass 设计语言的个人空间",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#000000",
  "icons": [
    { "src": "/favicon.svg", "sizes": "any", "type": "image/svg+xml" },
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

- [ ] **Step 2: 生成占位图标**

使用 bash 生成 192x192 和 512x512 的纯黑 PNG（用 Node.js 替代）：

可以用一个极简的 SVG 作为图标基础，但为了简单，先生成一个纯色圆角方块 PNG。或者用一个内联脚本生成：

```bash
# 如果没有 ImageMagick，就用 node 生成最小有效的 PNG
# 192x192 的纯黑 1x1 像素 PNG 也可以（先占位，后面替换）
cd client/public && node -e "
const fs = require('fs');
// 创建最小 PNG（1x1 黑色像素）
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
// 放大：图标后续用真实设计替换
fs.writeFileSync('icon-192.png', png);
fs.writeFileSync('icon-512.png', png);
"
```

- [ ] **Step 3: index.html 添加 PWA 和 iOS meta**

在 `<head>` 中 `viewport` meta 之后添加：

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#000000" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Line Web" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

- [ ] **Step 4: Layout.tsx 添加 min-height: 100dvh**

修改 Layout.tsx，将根 div 的 `minHeight: '100vh'` 改为 `minHeight: '100dvh'` 以处理 iOS Safari 的地址栏滚动问题：

```tsx
// 修改前：
<div style={{ position: 'relative', minHeight: '100vh' }}>

// 修改后：
<div style={{ position: 'relative', minHeight: '100dvh' }}>
```

同时 globals.css 中 `.lg-underlay` 的 `min-height: 100vh` 也改为 `100dvh`（约117行）。

- [ ] **Step 5: 提交**

```bash
git add client/index.html client/public/manifest.json client/public/icon-192.png client/public/icon-512.png client/src/components/Layout.tsx client/src/styles/globals.css
git commit -m "feat: PWA manifest + iOS meta + 100dvh 适配"
```

---

### Task 13: 全局触摸反馈与动画降级

**Files:**
- Modify: `client/src/styles/globals.css`

- [ ] **Step 1: 添加分页按钮和卡片触摸反馈**

在 globals.css 中有 `.pagination-btn` 和 `.admin-page-btn` 的区域添加 `:active` 状态：

```css
.pagination-btn:active,
.admin-page-btn:active {
  transform: scale(0.92);
}

.drive-grid-card-body:active {
  transform: scale(0.98);
}
```

- [ ] **Step 2: 提交**

```bash
git add client/src/styles/globals.css
git commit -m "feat(mobile): 全局触摸反馈 :active 缩放效果"
```
