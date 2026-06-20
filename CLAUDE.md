# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Line Web 是一个使用 **Apple Liquid Glass** 设计语言（WWDC 2025）的个人网站。
前端基于 React 19 + Vite + TypeScript，后端基于 Express + Prisma + SQLite。
支持亮色/暗色/跟随系统三种主题模式。

## Architecture

```
lineweb/
├── client/                      # 前端 (React + Vite)
│   └── src/
│       ├── components/          # 共享组件
│       │   ├── Navbar.tsx       # 导航栏 (含 lg-underlay)
│       │   ├── Layout.tsx       # 路由布局壳
│       │   ├── Guards.tsx       # ProtectedRoute / AdminRoute
│       │   └── glass/           # Liquid Glass 高阶组件
│       │       ├── LiquidGlass.tsx  # 可交互玻璃容器
│       │       ├── LiquidButton.tsx # 玻璃按钮
│       │       └── index.ts
│       ├── contexts/
│       │   ├── ThemeContext.tsx  # 亮/暗/system 三态主题
│       │   └── AuthContext.tsx   # JWT 认证状态
│       ├── lib/api.ts           # 自动带 JWT 的 fetch 封装
│       ├── pages/               # 页面组件
│       │   ├── HomePage.tsx     # 主页 (Bing 壁纸 + Hero)
│       │   ├── FeaturesPage.tsx # 功能界面
│       │   ├── CalculatorPage.tsx
│       │   ├── PostsPage.tsx    # 文章列表
│       │   ├── PostPage.tsx     # 文章详情 (Markdown)
│       │   ├── LoginPage.tsx
│       │   ├── RegisterPage.tsx
│       │   ├── ProfilePage.tsx
│       │   ├── AdminPage.tsx    # 管理面板
│       │   └── EditorPage.tsx   # 文章编辑器
│       └── styles/globals.css   # 全部设计系统
├── server/                      # 后端 (Express + Prisma)
│   ├── prisma/
│   │   ├── schema.prisma        # User + Post (SQLite)
│   │   └── seed.ts              # 管理员 + 示例文章
│   └── src/
│       ├── config/index.ts      # Zod 校验 + 环境变量
│       ├── lib/prisma.ts        # Prisma 客户端
│       ├── middleware/auth.ts   # JWT + admin 检查
│       ├── routes/auth.ts       # 注册/登录/用户信息
│       ├── routes/posts.ts      # 公开 + 管理 CRUD
│       ├── routes/bing.ts       # Bing 每日壁纸代理
│       └── index.ts             # Express 入口
├── .npmrc                       # registry=https://registry.npmmirror.com
├── CLAUDE.md
├── README.md
└── package.json
```

## Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite 6, TypeScript 5, React Router 7 |
| Markdown | react-markdown + remark-gfm |
| 后端 | Express 4, Prisma 6, Zod, JWT, bcryptjs |
| 数据库 | SQLite（`server/prisma/lineweb.db`；切换 MySQL 只需改 schema provider + .env） |
| 设计 | Apple Liquid Glass (WWDC 2025) — SVG feDisplacementMap 折射 + backdrop-filter 层叠 |

## Database Schema

```
User (users)        Post (posts)
├── id (PK)         ├── id (PK)
├── username unique ├── title
├── email unique    ├── content  (Markdown)
├── password (bcrypt)├── summary?
├── role (user/admin)├── slug unique
├── createdAt       ├── published (default false)
└── updatedAt       ├── authorId (FK → users.id)
                    ├── createdAt
                    └── updatedAt
```

## API Endpoints

### Auth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/register | — | 注册 |
| POST | /api/auth/login | — | 登录 → JWT |
| GET | /api/auth/me | Bearer | 当前用户信息 |

### Posts (公开)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/posts?page=&limit= | 已发布文章列表 |
| GET | /api/posts/:slug | 单篇文章详情 |

### Posts (管理 — 需 admin)
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/posts/admin/all | 全部文章（含草稿） |
| GET | /api/posts/admin/:id | 单篇文章完整内容 |
| POST | /api/posts | 创建文章 |
| PUT | /api/posts/:id | 更新文章 |
| DELETE | /api/posts/:id | 删除文章 |

### Other
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/health | 健康检查 |
| GET | /api/bing-wallpaper | Bing 每日壁纸 URL + 版权 |

## Design System — Liquid Glass

### 三层玻璃结构

所有玻璃表面 `(.lg-surface / .lg-surface-strong / .lg-underlay)` 统一由三层堆叠：

```
┌──────────────────────────────────────┐
│  ::after         z-index:  1         │  镜面高光 (径向渐变)
│  element         z-index:  0         │  SVG <feDisplacementMap> 折射 + tint
│  ::before        z-index: -1         │  backdrop-filter: blur(14px) 毛玻璃底衬
└──────────────────────────────────────┘
```

- **底层 (::before)**: `blur(14px) saturate(180%)` — 强模糊提供可读性，无任何不透明填充
- **中层 (element)**: `url(#lg-core)` SVG 滤镜做像素位移折射，模拟玻璃透镜扭曲
- **顶层 (::after)**: `radial-gradient` 镜面高光，模拟环境光反射

### SVG 滤镜 (inline 在 index.html `<svg>` 中)

| 滤镜 | 用途 | feTurbulence | feDisplacementMap scale |
|------|------|-------------|------------------------|
| `#lg-core` | 标准玻璃 | 0.006 / 3 octaves | 35 |
| `#lg-core-strong` | 厚玻璃 | 0.004 / 4 octaves | 60 |
| `#lg-glow` | 泛光 | — | — |

### 核心 CSS 类

| Class | 角色 | 含 underlay | 折射滤镜 |
|-------|------|-------------|----------|
| `.lg-surface` | 标准玻璃表面 | ✅ 自动 | `#lg-core` |
| `.lg-surface-strong` | 厚玻璃卡片、表单、计算器 | ✅ 自动 | `#lg-core-strong` |
| `.lg-underlay` | 混入类，给任何元素加毛玻璃底层 | — | — |
| `.lg-input` | 玻璃风格输入框 | ❌ 但自带折射 | `#lg-core` |

### CSS 变量

```
--lg-bg / --lg-bg-secondary      背景色
--lg-text-primary/secondary/tertiary  文字（WCAG AA+）
--lg-accent / --lg-accent-hover   主题色（亮#0071e3 / 暗#2997ff）
--lg-glass-bg / --lg-glass-border / --lg-glass-shadow  玻璃外观
--lg-radius-sm/md/lg/xl/full     圆角梯级
--lg-font / --lg-font-mono        字体
--lg-nav-height / --lg-max-width  布局常数
--lg-transition                   过渡曲线
```

### 动画

| Class | 动画 |
|-------|------|
| `.fade-in` | 0.5s 渐入 + 上移 |
| `.glass-rise` | 0.6s 上移放大 + 模糊→清晰 |

## Pages & Routes

| Path | Page | Notes |
|------|------|-------|
| `/` | HomePage | Bing 壁纸背景 + lg-surface-strong Hero |
| `/features` | FeaturesPage | lg-surface 功能卡片网格 |
| `/calculator` | CalculatorPage | lg-surface-strong 计算器面板 |
| `/posts` | PostsPage | lg-surface 文章列表卡片 |
| `/posts/:slug` | PostPage | lg-surface Markdown 阅读 |
| `/login` | LoginPage | lg-surface-strong 表单 |
| `/register` | RegisterPage | lg-surface-strong 表单 |
| `/profile` | ProfilePage | ProtectedRoute |
| `/admin` | AdminPage | AdminRoute 文章管理列表 |
| `/admin/new` / `/admin/edit/:id` | EditorPage | AdminRoute |

## Key Design Decisions

| 决策 | 方案 | 原因 |
|------|------|------|
| Liquid Glass 实现 | SVG `<feDisplacementMap>` + `<feTurbulence>` → pixel displacement + `backdrop-filter` 三层堆叠 | 纯 CSS `backdrop-filter: blur()` 无法产生折射扭曲，只有位移滤镜能模拟玻璃透镜效果 |
| 可读性方案 | 底层 `blur(14px)` 毛玻璃底衬，无任何不透明填充 | 保留背景色彩和光影的同时确保文字清晰；避免白底/黑底破坏玻璃通透感 |
| 统一玻璃效果 | `.lg-surface` / `.lg-surface-strong` 两套 CSS 类，统一管理三层结构 | 所有玻璃元素（导航栏、卡片、表单、输入框）共用同一套参数，视觉一致 |
| 首页壁纸 | 代理 Bing API (`/api/bing-wallpaper`)，前端 fetch 后设为 CSS background | 解决跨域，壁纸每日自动更新 |
| 数据库 | SQLite（Prisma 抽象） | 零配置；切 MySQL 只需改 provider + DATABASE_URL |
| 认证 | JWT (localStorage) + `Authorization: Bearer` | 无状态，前端 api.ts 自动注入 |
| 主题 | CSS 自定义属性 + `[data-theme="*"]` + `<meta prefers-color-scheme>` | 零 JS 开销，切换零闪烁 |
| npm 镜像 | `.npmrc` → `registry=https://registry.npmmirror.com` | 中国境内加速 |

## Common Commands

```bash
# 启动（两个终端）
cd server && npx tsx src/index.ts        # → localhost:3001
cd client && npx vite                    # → localhost:5173

# 数据库（在 server/ 下执行）
npx prisma db push        # 同步 Schema → SQLite
npx prisma db seed        # 填充种子
npx prisma studio         # 数据浏览器

# TypeScript 检查
(cd server && npx tsc --noEmit)
(cd client && npx tsc --noEmit)

# 构建
cd client && npx vite build
```

## Initial Setup

```bash
npm install && cd server && npm install && cd ../client && npm install && cd ..
cd server && npx prisma db push && npx prisma db seed
# 然后启动：npx tsx src/index.ts + npx vite
```

默认管理员：`admin@lineweb.dev` / `admin123`

## 添加新功能

1. **后端**: 在 `server/src/routes/` 新建路由 → 在 `index.ts` 用 `app.use()` 挂载
2. **前端页面**: 在 `pages/` 新建组件 → 在 `App.tsx` 的 `<Routes>` 中添加
3. **受保护路由**: 用 `<ProtectedRoute>`（需登录）或 `<AdminRoute>`（需 admin）包裹
4. **新数据库模型**: 在 `schema.prisma` 中添加 → `npx prisma db push`
5. **玻璃效果**: 容器用 `className="lg-surface"`，重要面板用 `lg-surface-strong`，只需底层模糊的加 `lg-underlay`
