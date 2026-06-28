# 移动端体验全面优化设计文档

> **目标：** 全面提升 Line Web 项目在移动设备上的用户体验，使所有页面在 360px-768px 范围内获得可用、美观、流畅的交互体验。

**架构思路：** 采用 CSS 响应式为主、`useResponsive` hook 为辅的混合策略。在现有 `globals.css` 基础上扩展统一断点体系，逐步迁移重要 inline style 到 CSS class。核心组件添加触摸优化，非关键页面逐一过适配。

**技术栈：** React 19 + TypeScript 5 + Vite 6 + CSS Custom Properties

**设计原则：** 渐进增强、不破坏现有桌面体验、触摸优先的交互、iOS/Android 双端兼容。

---

## 1. 响应式断点与 CSS 基础体系

### 1.1 标准化断点

| 断点 | 名称 | 用途 |
|------|------|------|
| `≤360px` | x-small | iPhone SE / 极小屏特调 |
| `≤480px` | small | 手机竖屏 |
| `≤768px` | medium | 平板竖屏 / 大屏手机 |
| `≤1024px` | large | 平板横屏 / 小桌面（已存在） |

### 1.2 CSS 自定义属性

```css
:root {
  --lg-touch-target-min: 44px;
  --lg-touch-target-min-sm: 36px;
}
```

### 1.3 容器响应式扩展

- **768px:** `.container` padding: 0 16px（已有）；`.page` padding-top 调整（已有）
- **480px:** `.container` padding: 0 12px（已有）；`.lg-surface` padding: 14px（已有）
- **360px（新增）:** `.container` padding: 0 8px; `.lg-surface` padding: 12px

### 1.4 Typography 扩展

| 元素 | 桌面 | 768px | 480px |
|------|------|-------|-------|
| h1 | 2.5rem | 1.8rem | 1.5rem |
| h2 | 1.8rem | 1.4rem | 1.2rem |
| **h3（新增）** | **1.4rem** | **1.2rem** | **1.1rem** |
| **h4（新增）** | **1.15rem** | **1rem** | **0.95rem** |
| **body（新增）** | **1rem** | **0.95rem** | **0.92rem** |

---

## 2. 核心组件优化

### 2.1 LiquidButton — 触摸反馈增强

- 添加 `onTouchStart` / `onTouchEnd` 的 `scale(0.96)` 压感效果
- 添加 `(hover: none) and (pointer: coarse)` 去粘滞 CSS，阻止触摸设备保留 hover 状态
- 保持桌面端 hover 效果不变

### 2.2 useResponsive Hook（新增）

**文件: `client/src/hooks/useResponsive.ts`**

```typescript
export type Breakpoint = 'mobile' | 'tablet' | 'desktop'

export function useResponsive(): {
  breakpoint: Breakpoint
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
}
```

- 基于 `window.matchMedia('(max-width: 768px)')` 监听
- 仅在需要 JS 逻辑响应的场景使用（分页、视图切换、渲染控制）
- 纯 CSS 能解决的问题优先用 CSS

### 2.3 LiquidGlass — 移动端性能优化

- 768px 以下降低镜面高光更新帧率（`throttleMs: 16 → 50`）
- 480px 以下自动关闭色差边缘（chromatic aberration），通过 CSS 隐藏
- 480px 以下降低 `backdrop-filter` blur 强度（14px → 8px）
- 保留所有交互功能，仅降低 GPU 负载

### 2.4 管理后台表格 — 卡片化

在 580px 以下，将 `<table>` 转换为卡片式布局（`display: block`），每行变为独立卡片，列名为 `::before` 伪元素的 `content: attr(data-label)`。受影响页面：

- AdminPage（文章管理列表）
- CommentAdminPage（评论管理）
- UserAdminPage（用户管理）
- PageList（页面管理）

此改造仅通过 CSS 实现，JSX 中只需为 `<td>` 添加 `data-label` 属性。

---

## 3. 页面逐级适配

### 3.1 PostPage 文章详情页（最高优先级）

- 将上层容器从 inline style 迁移到 CSS class（`.post-page`, `.post-content-card`）
- 480px: padding 32→16px, h1 字体 2rem→1.35rem
- 480px: 文章内容字号 1rem→0.95rem，行高 1.8→1.75
- 480px: 作者/日期元信息改为纵向堆叠
- 返回链接字号缩小，间距缩小

### 3.2 ProfilePage 个人中心

- 提取关键 inline style 为 CSS class
- 480px: 卡片 padding 32→20px, h1 字体 1.6rem→1.3rem
- 480px: 设置按钮行从水平变为垂直全宽
- 480px: 历史壁纸网格 min-width 从 96px→80px

### 3.3 DynamicPage 动态页面

- columns 组件添加 `flex-wrap: wrap` + `flex: 1 1 200px`
- 确保所有 inline style 在窄屏不溢出

### 3.4 CommentSection 评论系统

- 480px: section padding 从 32→16px
- 480px: 评论 metadata 纵向堆叠（作者/时间分行）
- 480px: 操作按钮纵向排列
- 480px: 回复区域左边距从 40px→16px

### 3.5 PostsPage 文章列表

- 分页按钮在 480px 下缩小（40px→36px）
- 480px: 按钮字体 0.95rem→0.85rem
- 分页按钮添加 `:active` 触摸缩放

### 3.6 FeaturesPage 功能页面

- grid 布局 `auto-fit, minmax(220px, 1fr)` 已有弹性，可直接适配
- 480px: 卡片 padding 从 40px→28px
- 480px: emoji 图标缩小 2.8rem→2.2rem

### 3.7 CalculatorPage

- 已有 480/400/360 三级断点 + `hover:none` 去粘滞，足够完善
- 无需额外改动

---

## 4. PWA 与 iOS 优化

### 4.1 index.html 增强

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#000000" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="Line Web" />
<link rel="apple-touch-icon" href="/icon-192.png" />
```

### 4.2 manifest.json

- `display: standalone`
- `background_color: #000000`
- 引用 SVG favicon 作为主要图标

### 4.3 Service Worker 注册（可选）

- 在 `client/src/main.tsx` 中注册 SW
- Network-first 缓存策略，缓存首页和最近访问页面
- 不影响现有功能，可单独开启/关闭

### 4.4 Layout 调整

- `<main>` 标签添加 `min-height: 100dvh` 以确保正确高度
- 版权文字在 480px 下缩小字号至 0.65rem

---

## 5. 交互细节增强

### 5.1 全局触摸反馈
- 所有 `.pagination-btn`, `.admin-page-btn` 添加 `:active { transform: scale(0.94) }`
- `.drive-grid-card-body:active` 添加轻微缩放
- 已有 `-webkit-tap-highlight-color: transparent` 保持

### 5.2 全局动画降级
- 在 768px 以下，将 CSS 自定义属性 `--lg-transition` 从 0.25s→0.15s
- 入场动画延迟叠加间距从 0.08s→0.04s
- 保留动画效果但减少等待时间

### 5.3 导航栏增强
- 汉堡菜单点击外部关闭改用 touchstart + mousedown 双监听
- 在 360px 下 navbar 的 margin 从 24px→12px

---

## 6. 相关文件清单

### 新增文件
| 文件 | 用途 |
|------|------|
| `client/public/manifest.json` | PWA 清单 |
| `client/src/hooks/useResponsive.ts` | JS 响应式 hook |
| `client/public/icon-192.png` | PWA 图标 192px |
| `client/public/icon-512.png` | PWA 图标 512px |

### 修改文件
| 文件 | 改动 |
|------|------|
| `client/index.html` | manifest、theme-color、iOS meta、apple-touch-icon、SW 注册 |
| `client/src/styles/globals.css` | 新增全局响应式扩展、各页面适配 CSS、卡片化表格、触摸反馈、动画降级 |
| `client/src/components/glass/LiquidGlass.tsx` | 移动端降低镜面高光帧率，chromatic 在 480px 关闭 |
| `client/src/components/glass/LiquidButton.tsx` | 添加 onTouchStart/onTouchEnd 缩放反馈 |
| `client/src/pages/PostPage.tsx` | 迁移 inline style 到 CSS class，添加响应式容器 |
| `client/src/pages/ProfilePage.tsx` | 提取 inline style 到 CSS class，添加响应式 |
| `client/src/pages/DynamicPage.tsx` | columns 添加 flex-wrap |
| `client/src/pages/PostsPage.tsx` | 分页按钮响应式优化 |
| `client/src/pages/FeaturesPage.tsx` | 卡片 padding 响应式 |
| `client/src/pages/AdminPage.tsx`（文章管理列表） | 表格 `<td>` 添加 `data-label` 属性 + 卡片化 |
| `client/src/pages/admin/CommentAdminPage.tsx` | 同上 |
| `client/src/pages/admin/UserAdminPage.tsx` | 同上 |
| `client/src/pages/admin/PageList.tsx` | 同上 |
| `client/src/components/comments/CommentSection.tsx` | 响应式 CSS class 替换（CSS 侧完成） |
| `client/src/components/Navbar.tsx` | 点击外部关闭监听 touchstart 支持 |

---

## 7. 不纳入本次范围

- 移动端侧滑手势导航（SwipeBack）— 复杂度高，与现有路由系统耦合
- 移动端专用 Navigation Bar 替换（如底部 Tab Bar）— 超出本次优化范围
- 富文本编辑器（Lexical）移动端大改 — 编辑器核心行为依赖第三方库，仅在 CSS 层面适配
- 图片懒加载全面改造 — 已有基本支持，不做专项优化
- 非 WebKit 浏览器兼容（如 Firefox Android）— 当前聚焦 iOS Safari + Chrome Android
