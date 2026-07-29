# LineWeb 前端全面 GitHub 化重构设计文档

## 1. 背景与目标

### 1.1 现状

LineWeb 前端已统一为 GitHub / Primer 风格的纯 CSS 设计系统，使用扁平化层级、系统字体、8px 圆角和 light/dark/auto 主题。技术栈为 React 19 + Vite 6 + TypeScript，纯 CSS（无 Tailwind / CSS-in-JS）。

### 1.2 目标

将前端全面重构为 GitHub 风格：

- 保持扁平化视觉层级，使用边框、背景色和有限阴影，避免环境光斑、折射滤镜和不必要的渐变效果。
- 采用 GitHub / Primer 风格的扁平化、现代化设计语言。
- 将现有网站功能类比映射到 GitHub 功能与信息架构。
- 三端统一响应式：桌面、平板、手机。
- 完整主题系统：`light / dark / auto`。
- 统一 G2（8px）圆角。
- 本次为纯前端重构，后端 API 与数据库模型保持不变。

---

## 2. 设计原则

1. **扁平优先**：通过边框、背景色、间距建立层级，不依赖阴影和模糊。
2. **内容优先**：减少装饰性动效，页面结构服务于内容消费与操作效率。
3. **GitHub 隐喻**：使用 GitHub 用户熟悉的组件名称和布局模式（Dashboard、Repositories、Issues、Settings）。
4. **响应式统一**：同一套组件在不同断点下保持一致的行为和视觉语言。
5. **最小侵入**：保留现有路由、状态管理逻辑、数据获取模式，仅改造 UI 层。

---

## 3. 视觉设计系统

### 3.1 色彩（Design Tokens）

采用语义化 CSS 变量，支持 light / dark 两套值。`auto` 模式通过 `prefers-color-scheme` 切换。

| Token | Light | Dark |
|-------|-------|------|
| `--gh-bg` | `#ffffff` | `#0d1117` |
| `--gh-canvas` | `#f6f8fa` | `#161b22` |
| `--gh-canvas-inset` | `#f3f6f8` | `#010409` |
| `--gh-border` | `#d1d9e0` | `#30363d` |
| `--gh-border-muted` | `#d8dee4` | `#21262d` |
| `--gh-accent` | `#0969da` | `#2f81f7` |
| `--gh-accent-hover` | `#0550ae` | `#409eff` |
| `--gh-accent-soft` | `rgba(9,105,218,0.15)` | `rgba(47,129,247,0.15)` |
| `--gh-text` | `#1f2328` | `#f0f6fc` |
| `--gh-text-secondary` | `#59636e` | `#9198a1` |
| `--gh-text-tertiary` | `#636c76` | `#8b949e` |
| `--gh-success` | `#1a7f37` | `#3fb950` |
| `--gh-danger` | `#cf222e` | `#f85149` |
| `--gh-warning` | `#9a6700` | `#d29922` |

### 3.2 排版

- **主字体**：`-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif`
- **等宽字体**：`'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace`
- **标题**：使用 `font-weight: 600`，不再使用 Instrument Serif。
- **正文行高**：`1.5`

### 3.3 形状

- **统一圆角**：`border-radius: 8px`（G2），适用于卡片、按钮、输入框、标签、弹窗、下拉菜单等所有组件。不使用 `9999px` pill 形状。
- **边框**：1px 实线，颜色 `--gh-border`。
- **阴影**：极少使用，仅悬浮层使用 `0 1px 2px rgba(31,35,40,0.04)`（light）或 `0 1px 2px rgba(0,0,0,0.3)`（dark）。

### 3.4 间距

- 基础单位 `4px`。
- 页面水平内边距：手机 `16px`，平板 `24px`，桌面 `32px`。
- 内容最大宽度：
  - 首页 Dashboard：`1280px`
  - 文章阅读页：`1012px`
  - 管理后台：`1280px`

---

## 4. 全局布局与导航

### 4.1 顶部全局 Header

- 高度 `64px`，背景 `--gh-canvas-inset`，底部 1px 边框 `--gh-border`。
- 左侧：Logo（"Line Web" 或 "LW" 图标）+ 主导航链接：Overview、Repositories、Drive、Features。
- 中间：全局搜索框（占位符"搜索文章、文件、页面…"），支持 `cmd+k` 聚焦。
- 右侧：主题切换下拉、通知/用户头像下拉（Profile、Settings、Logout）。
- 移动端：左侧汉堡菜单，搜索图标，右侧头像。

### 4.2 左侧 Sidebar（桌面端）

- 宽度 `256px`（可折叠至 `64px` 图标模式），固定在左侧，背景 `--gh-canvas`。
- 分组：
  - **Home**：Overview、Feed
  - **Create**（登录后）：New Post、New Page、Upload
  - **Explore**：Repositories、Drive、Pages、Features
  - **Manage**（管理员）：Admin Dashboard、Comments、Users、API Keys、Devices、AI
  - **Personal**：Profile、Settings、Logout
- 当前项：左侧 4px 蓝色竖线 + 浅蓝背景 `--gh-accent-soft`。
- 移动端 Sidebar 变为抽屉式覆盖层。

### 4.3 内容区

- 桌面：`margin-left: 256px`，`padding: 24px 32px`。
- 平板：左侧 64px 图标-only sidebar 或顶部 Header + 抽屉菜单。
- 手机：顶部 Header + 抽屉/底部导航。

### 4.4 页脚

- 删除底部 copyright 悬浮胶囊。
- 改为页脚链接行：© LineWeb、About、Privacy、Terms、Status、Help。

---

## 5. 页面重构映射

### 5.1 首页 `/` → Overview Dashboard

- **布局**：三栏（桌面）。
  - 左侧：用户资料卡片（头像、简介、统计）。
  - 中间：Activity Feed（最新文章、评论、网盘上传动态）。
  - 右侧：热门/推荐、贡献统计。
- **删除**：大 hero 区域、bento grid、装饰性视觉外壳。
- **改造**：`StatsCard` 改为小尺寸数据卡片；Digital Health 改造为 GitHub contributions 风格热力图；AI 助手入口改为右下角悬浮按钮或顶部导航入口。

### 5.2 文章列表 `/posts` → Repositories

- 页面标题使用"Repositories"（或中文"文章仓库"）。
- 顶部：搜索框 + 类型筛选（All / Public / Drafts，登录后可见）。
- 列表项改为 GitHub repo 列表样式：
  - 左侧彩色语言点（按分类/标签着色）。
  - 标题加粗。
  - 描述一行。
  - 底部元信息：作者、日期、评论数。
- 分页：GitHub 风格 Previous / Next 或页码。

### 5.3 文章详情 `/posts/:slug` → Issue / PR 详情

- 顶部：标题 + 状态徽章（Open/Closed）、作者、日期、标签。
- 主体：左侧窄边栏（作者头像 + 用户名），右侧主要内容。
- 评论区：改为 issue timeline，每条评论一个卡片，左侧头像竖线，右侧评论内容。
- Markdown 代码块使用 GitHub 风格背景，保持清晰的内容层级。

### 5.4 动态页面 `/page/:slug` → Wiki / Project Page

- 复用文章详情布局但去掉评论。
- 顶部 Tab：Page / History（History 可后续实现，先保留占位）。

### 5.5 网盘 `/drive` → Repository Files

- 左侧：目录树（类似 repo 文件浏览器）。
- 顶部：breadcrumb、视图选择器、搜索框。
- 主区域：文件表格（Name / Size / Type / Updated），表头可排序。
- 网格视图保留但改为扁平卡片。
- 预览面板改为右侧或弹出层，使用普通边框和背景容器。
- 上传区改为类似 GitHub "Add file" 按钮下拉。

### 5.6 个人资料 `/profile` → GitHub Profile

- 左侧：大头像、用户名、简介、加入时间、文章/网盘等统计（复用现有可获取的数据，不新增关注关系）。
- 右侧：Tab 导航（Overview / Repositories / Drive / Activity）。
- 贡献热力图、Pinned Repositories（精选文章）。

### 5.7 Features 页面 `/features` → About / Features

- 简化为 GitHub product/organization 介绍页风格：功能卡片网格，每个卡片有图标、标题、描述、链接。

### 5.8 认证页 `/login` `/register`

- 居中单栏卡片，纯色背景，无壁纸/光斑。
- 顶部 Logo，简洁表单，8px 圆角输入框。
- 错误提示使用左侧彩色竖条的 alert 条。

### 5.9 管理后台 `/admin*`

- 统一为 GitHub Settings / Organization 风格：
  - 左侧设置菜单：Account、Posts、Comments、Pages、Users、API keys、Devices、AI、Appearance。
  - 右侧：多个 `Box` 卡片，每个卡片有标题、描述、操作区。
- 表格：无竖线，仅行底边框，hover 背景色变化，操作按钮 hover 显示。
- 表单：扁平 label + input，保存按钮右下角。

---

## 6. 组件库

### 6.1 按钮

- **primary**：`#0969da` 背景，白色文字，无边框。
- **secondary**（default）：`--gh-canvas` 背景，`--gh-border` 边框，hover `--gh-border` 加深背景。
- **danger**：红色文字/背景按需。
- **ghost**：透明背景，hover 背景色。
- 全部 `border-radius: 8px`。

### 6.2 输入框

- `.gh-input`：8px 圆角、1px 边框、内边距 `8px 12px`。
- focus：蓝色边框 + 柔和阴影。
- 搜索框左侧带搜索图标。

### 6.3 卡片与列表

- `.gh-box` / `.gh-card`：8px 圆角、1px 边框、背景 `--gh-canvas`。
- 列表项：无边框，仅底边框分隔；hover 背景 `--gh-canvas-inset`。

### 6.4 导航

- `.gh-tabnav`：顶部 tab，当前项底部 2px 蓝色下划线。
- `.gh-side-nav`：左侧菜单，当前项蓝色左竖线 + 浅蓝背景。
- `.gh-breadcrumb`：灰色小字链接 + `/` 分隔符。

### 6.5 Badges / Labels

- 8px 圆角、小号字体、状态色背景。
- Open（绿）、Closed（红）、Draft（灰）。

### 6.6 Alerts / Toasts

- 左侧彩色竖条、浅色背景、8px 圆角。

### 6.7 图标

- 统一使用 SVG 图标，24px Octicons 风格。主导航不再使用 emoji。

---

## 7. 主题系统

### 7.1 模式

- `light`：固定浅色。
- `dark`：固定深色。
- `auto`：跟随 `prefers-color-scheme`。

### 7.2 实现

- 在 `ThemeContext` 中管理（由 `WallpaperContext` 改造而来）。
- `<html>` 上设置 `data-theme="light|dark"`。
- `auto` 时：JavaScript 监听 `prefers-color-scheme`，将 `data-theme` 实时设为 `light` 或 `dark`；持久化存储的值为 `auto`，而不是具体颜色。
- 用户偏好持久化到 `localStorage`。

### 7.3 主题与背景策略

- 主题系统统一负责颜色和明暗模式。
- Bing 壁纸可作为主题页的可选背景图，默认关闭。
- 对比度设置由主题系统和无障碍样式统一覆盖。

---

## 8. 动效与交互

### 8.1 视觉约束

- 保持边框、背景和有限阴影构成的扁平层级。
- 避免全屏装饰性光效、折射滤镜和不必要的渐变。
- 避免大圆角 hover 浮起和页面进入动画。

### 8.2 保留/引入

- hover 背景色变化：`transition: background 0.15s ease`。
- focus 蓝色 ring（`focus-visible`）。
- 按钮 active 时轻微反馈（不强制）。
- Sidebar 折叠/展开的 width transition。

### 8.3 无障碍

- `prefers-reduced-motion: reduce` 完全关闭动画。

---

## 9. 响应式策略

| 断点 | 布局 |
|------|------|
| `>= 1280px` | 256px sidebar + 主内容 + 可选右侧边栏 |
| `768px - 1279px` | 64px 图标 sidebar 或顶部 Header + 抽屉菜单 |
| `< 768px` | 顶部 Header + 抽屉/底部导航 |

- 表格横向滚动，不压缩列宽。
- 网盘网格视图在移动端改为单列或双列。

---

## 10. 删除与迁移清单

### 10.1 已完成的设计系统迁移

- 统一使用 `client/src/styles/` 中的 GitHub Primer 变量和组件样式。
- 统一使用 `.gh-*`、`.drive-*`、`.admin-*` 和 `.lex-*` 命名空间。
- 使用系统字体、8px 圆角和 `--gh-*` 设计 token。
- 主题由 `ThemeContext` 管理，支持 light / dark / auto。

### 10.2 保留并改造

- `AuthContext`、`DownloadContext`、`DriveContext` 逻辑保留，UI 改造。
- `WallpaperContext` 改造为 `ThemeContext`。
- 现有路由与 API 调用不变。

### 10.3 后端影响

- 无。本次为纯前端重构。

---

## 11. URL 策略

为保持外链兼容性和降低重构风险，**保留现有 URL 路径**：

- `/`、`/posts`、`/posts/:slug`、`/page/:slug`
- `/drive`、`/profile`
- `/admin*`、`/login`、`/register`

页面标题和文案使用 GitHub 隐喻，URL 不改变。

---

## 12. 成功标准

1. 全站统一使用 GitHub / Primer 风格视觉系统。
2. 所有组件统一 8px 圆角。
3. `light / dark / auto` 主题正常工作。
4. 桌面、平板、手机三端布局无严重错乱。
5. 现有功能（文章、评论、网盘、管理后台）可正常使用。
6. `npm run build` 与 `npm run test` 通过（client 测试）。

---

*设计文档版本：1.0*  
*日期：2026-07-29*  
*状态：待审阅*
