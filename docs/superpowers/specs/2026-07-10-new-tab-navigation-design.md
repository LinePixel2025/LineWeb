# 新标签页导航设计

## 背景

当前网站使用 React Router 的 `<Link>` 组件进行 SPA 导航，所有页面切换都在同一个浏览器标签页内完成。用户希望点击任何导航链接时都在新浏览器标签页打开，当前页面保持不变。

## 设计决策

### 范围

- **改**：所有可点击的 `<Link>` 组件 → 添加 `target="_blank" rel="noopener noreferrer"`
- **不动**：所有 `navigate()` 编程式导航（登录/注册后跳转、保存后返回等）保持当前标签页

### 改动文件清单

| 文件 | 链接数 | 说明 |
|------|--------|------|
| `components/Navbar.tsx` | 6 | 主导航栏：Logo、首页、功能、文章、网盘、管理、用户名、登录 |
| `components/AdminLayout.tsx` | 3 | 管理侧栏：Logo、7个管理页面链接、返回主站 |
| `components/glass/LiquidButton.tsx` | 1 | `to` 属性触发的内部 Link |
| `pages/HomePage.tsx` | 4 | 首页 CTA 按钮和文章卡片链接 |
| `pages/PostsPage.tsx` | 1 | 文章列表卡片链接 |
| `pages/PostPage.tsx` | 2 | 返回文章列表链接 |
| `pages/DynamicPage.tsx` | 2 | 功能页链接 |
| `pages/LoginPage.tsx` | 1 | 注册链接 |
| `pages/RegisterPage.tsx` | 1 | 登录链接 |
| `components/comments/CommentSection.tsx` | 1 | 登录链接 |

### 安全属性

- `target="_blank"` 必须配合 `rel="noopener noreferrer"` 防止 `window.opener` 安全漏洞
- React Router 的 `<Link>` 原生支持这两个属性

### LiquidButton 特殊处理

`LiquidButton` 组件的 `to` 分支渲染内部 `<Link>`，需要同步添加 `target="_blank" rel="noopener noreferrer"`。`href` 分支已正确处理外部链接。

## 不变的部分

- `navigate()` 调用（10 处）保持不变
- React Router 路由配置不变
- SPA 懒加载机制不变
- 新标签页内仍为 SPA，可正常切换子页面
