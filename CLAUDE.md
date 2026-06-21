# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Line Web 是一个使用 **Apple Liquid Glass** 设计语言（WWDC 2025）的个人网站。
前端基于 React 19 + Vite + TypeScript，后端基于 Express + Prisma + SQLite。
支持亮色/暗色/跟随系统三种主题模式。

## Architecture

```
lineweb/                       # 根 monorepo (concurrently 管理双端)
├── client/                    # 前端 (React + Vite)
│   ├── index.html             # SVG <filter> 玻璃折射滤镜内联于此
│   └── src/
│       ├── components/
│       │   ├── Navbar.tsx      # 浮动导航栏 (.navbar + lg-underlay)
│       │   ├── Layout.tsx      # 路由出口 + 壁纸背景层
│       │   ├── Guards.tsx      # ProtectedRoute / AdminRoute
│       │   └── glass/          # Liquid Glass 高阶组件 (React)
│       │       ├── LiquidGlass.tsx
│       │       ├── LiquidButton.tsx
│       │       ├── filters.svg  # SVG 滤镜副本 (备用)
│       │       └── index.ts
│       ├── contexts/
│       │   ├── AuthContext.tsx       # JWT 认证 (useAuth hook)
│       │   └── WallpaperContext.tsx  # 壁纸 URL 状态 (useWallpaper hook)
│       ├── lib/api.ts          # 自动注入 Bearer token 的 fetch 封装
│       ├── pages/
│       ├── styles/
│       │   └── globals.css     # 全部设计系统 (无其他 CSS 文件)
│       └── main.tsx
├── server/                    # 后端 (Express + Prisma)
│   ├── .env                   # DATABASE_URL + JWT_SECRET (必填)
│   ├── prisma/
│   │   ├── schema.prisma      # User + Post 模型 (SQLite)
│   │   └── seed.ts            # 管理员 admin@lineweb.dev + 示例文章
│   └── src/
│       ├── config/index.ts    # Zod schema + 环境变量
│       ├── lib/prisma.ts      # 单例 PrismaClient
│       ├── middleware/auth.ts # authenticate + requireAdmin
│       ├── routes/            # auth / posts / bing
│       └── index.ts           # Express 入口
├── package.json               # Monorepo 脚本 (npm run dev 同时启动双端)
└── .npmrc                     # registry=https://registry.npmmirror.com (中国加速)
```

## Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite 6, TypeScript 5, React Router 7 |
| Markdown | react-markdown + rehype-highlight + remark-gfm |
| 后端 | Express 4, Prisma 6, Zod, JWT, bcryptjs |
| 数据库 | SQLite（`server/prisma/lineweb.db`；切换 MySQL 只需改 schema provider + .env） |
| 设计 | Apple Liquid Glass (WWDC 2025) — SVG feDisplacementMap 折射 + backdrop-filter 层叠 |

## Database Schema

```
User (users)                  Post (posts)
├── id (PK, 自增)             ├── id (PK, 自增)
├── username (unique)         ├── title
├── email (unique)            ├── content (Markdown)
├── password (bcrypt, 12轮)   ├── summary?
├── role ("user"|"admin")     ├── slug (unique)
├── createdAt                 ├── published (default: false)
└── updatedAt                 ├── authorId (FK → users.id)
                              ├── createdAt
                              └── updatedAt
```

## API Endpoints

### Auth (`/api/auth`)
| Method | Path | Auth | Returns | Zod |
|--------|------|------|---------|-----|
| POST | `/register` | — | `{ token, user }` | registerSchema |
| POST | `/login` | — | `{ token, user }` | loginSchema |
| GET | `/me` | Bearer | user object | — |

**Zod 校验**: username 2-50 字符, email 最大 100 字符, password 最小 6 字符。
Token 有效期 7 天。

### Posts (`/api/posts`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | 已发布文章列表（分页） |
| GET | `/:slug` | — | 单篇公开文章 |
| GET | `/admin/all` | admin | 全部文章（含草稿，分页） |
| GET | `/admin/:id` | admin | 单篇文章完整内容 |
| POST | `/` | admin | 创建文章 |
| PUT | `/:id` | admin | 更新文章（部分更新） |
| DELETE | `/:id` | admin | 删除文章 |

**路由顺序注意**: Express 注册顺序为 `/` → `/:slug` → `/admin/all` → `/admin/:id`。请求按顺序匹配，所以 `/admin/all` 不会被 `/:slug` 吞掉。

### Wallpaper (`/api/bing-wallpaper`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | 返回 `{ url, copyright }` |

本质上代理 picsum.photos，每次请求随机返回高清壁纸。

## Design System — Liquid Glass

全部 CSS 集中在单一文件 `client/src/styles/globals.css` 中，无其他样式文件。

### 三层玻璃堆叠

所有玻璃表面由 `::before / element / ::after` 三层构成：

```
┌───────────────────────────────────────┐
│  ::after        z-index:  1          │  径向渐变镜面高光 (共享)
│  element        z-index:  0          │  SVG feDisplacementMap 折射 + 底色
│  ::before       z-index: -1          │  backdrop-filter: blur(14px) 毛玻璃 (共享)
└───────────────────────────────────────┘
```

### SVG 滤镜 (内联在 `client/index.html <svg>` 中)

| 滤镜 | 用途 | feTurbulence | feDisplacementMap scale | feGaussianBlur |
|------|------|-------------|------------------------|----------------|
| `#lg-core` | 标准玻璃 | 0.006 / 3 octaves | 35 | 0.4px |
| `#lg-core-strong` | 厚玻璃 | 0.004 / 4 octaves | 60 | 0.6px |
| `#lg-glow` | 泛光 | — | — | 12px blur |

滤镜的关键设计：用 `feColorMatrix` 先将圆角半透明像素填为不透明，防止 `feDisplacementMap` 把透明边拉入作为白色伪影，再通过 `feComposite` 恢复原始 alpha。

### 核心 CSS 类

| Class | 角色 | 折射滤镜 | 含 underlay |
|-------|------|---------|-------------|
| `.lg-surface` | 标准玻璃卡片 | `#lg-core` | ✅ |
| `.lg-surface-strong` | 厚玻璃（导航栏、表单、计算器） | `#lg-core-strong` | ✅ |
| `.lg-surface-blur` | 厚模糊变体 (文章阅读) | `#lg-core` | — |
| `.lg-surface-strong-blur` | 更厚模糊变体 | `#lg-core-strong` | — |
| `.lg-underlay` | 仅底层模糊（混入类） | — | — |
| `.lg-input` | 玻璃输入框 | `#lg-core` | ❌ 但自带 |
| `.navbar` | 浮动导航栏 | `#lg-core` | ✅ |

### 按钮设计 (`.liquid-btn`)

| Variant | 背景 | 适用场景 |
|---------|------|---------|
| `primary` | 渐变色 + accent glow | 主要操作 |
| `glass` | 毛玻璃半透明 + 边框 | 次要操作 |
| `ghost` | 透明 + hover 时 | 轻量操作 |
| `danger` | 红色渐变 | 删除/危险操作 |

尺寸: `sm` / `md` / `lg`。每个按钮含 `.btn-flare` hover 炫光层。

### 主题切换

CSS 自定义属性 (`--lg-*`) 硬编码为暗色模式值。亮色模式通过 `[data-theme="light"]` 覆盖实现，跟随系统通过 `<meta name="color-scheme">` 监听。
无 JS 样式切换开销，零闪烁初始化。

## Pages & Routes (React Router)

| Path | Component | Guard | Notes |
|------|-----------|-------|-------|
| `/` | HomePage | — | 壁纸全屏背景 + Hero |
| `/features` | FeaturesPage | — | 功能卡片网格 |
| `/calculator` | CalculatorPage | — | 科学计算器 |
| `/posts` | PostsPage | — | 文章列表 (分页) |
| `/posts/:slug` | PostPage | — | Markdown 阅读 |
| `/login` | LoginPage | — | 登录表单 |
| `/register` | RegisterPage | — | 注册表单 |
| `/profile` | ProfilePage | ProtectedRoute | 用户信息 |
| `/admin` | AdminPage | AdminRoute | 文章管理列表 |
| `/admin/new` | EditorPage | AdminRoute | 新建文章 |
| `/admin/edit/:id` | EditorPage | AdminRoute | 编辑文章 |

Provider 嵌套: `BrowserRouter > AuthProvider > WallpaperProvider > Routes`。

## Auth Flow

1. **注册/登录** → 后端返回 `{ token, user }` → 存 `localStorage("lineweb_token")`
2. **后续请求** → `api.ts` 自动从 localStorage 读取 token，加到 `Authorization: Bearer` 头
3. **页面刷新** → `AuthProvider` useEffect 检测 token 存在则调用 `/auth/me` 验证，失败则清除 token
4. **路由保护** → `ProtectedRoute` (需登录) / `AdminRoute` (需 admin)，加载时显示 spinner，不满足时 `Navigate`

## Key Design Decisions

| 决策 | 方案 | 原因 |
|------|------|------|
| Liquid Glass 实现 | SVG feDisplacementMap + backdrop-filter 三层堆叠 | 纯 blur() 无法产生折射扭曲 |
| 可读性方案 | 底层 blur(14px) 毛玻璃底衬，无任何不透明填充 | 保留背景色彩，确保文字清晰 |
| 单 CSS 文件 | globals.css 一千多行包含全部样式 | 零 CSS 文件碎片，单一 source of truth |
| 壁纸轮换 | WallpaperContext fetch `/api/bing-wallpaper` → CSS background | 组件无关，Layout 统一管理 |
| jQuery 替换 | 前端 api.ts 封装 fetch + JWT 自动注入 | 无外部 HTTP 库依赖 |
| SQLite | Prisma 抽象 | 零配置开发；切 MySQL 改一行 provider |
| 中国 npm | `.npmrc` → npmmirror.com | 境内安装加速 |

## Common Commands

```bash
# 开发启动（需两个终端）
cd server && npx tsx src/index.ts        # → localhost:3001
cd client && npx vite                    # → localhost:5173
# 或根目录：npm run dev  (concurrently 同时启动)

# 生产构建
cd client && npx vite build              # → client/dist/

# 数据库 (在 server/ 下执行)
npx prisma db push        # 同步 Schema → SQLite
npx prisma db seed        # 填充种子数据
npx prisma studio         # Prisma 数据浏览器

# TypeScript 类型检查
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit

# Vite 网络访问
cd client && npx vite --host             # 局域网可访问
```

## Initial Setup

```bash
# 根目录 + 子目录各装一次
npm install && cd server && npm install && cd ../client && npm install && cd ..

# 配好 server/.env（见下方）

# 初始化数据库
cd server && npx prisma db push && npx prisma db seed

# 分别启动前端和后端
cd server && npx tsx src/index.ts
# 新终端：
cd client && npx vite
```

**`server/.env` 必须包含：**
```env
DATABASE_URL="file:./lineweb.db"
JWT_SECRET="your-secret-key"
```

默认管理员：`admin@lineweb.dev` / `admin123`

## Adding Features

1. **后端路由**: 在 `server/src/routes/` 新建 → `index.ts` 中用 `app.use('/api/xxx', router)` 挂载
2. **前端页面**: 在 `client/src/pages/` 新建 → `App.tsx` `<Routes>` 中添加 `<Route>` — 注意 Provider 嵌套顺序
3. **路由保护**: 用 `<ProtectedRoute>`（需登录）或 `<AdminRoute>`（需 admin）包裹
4. **新数据库模型**: `schema.prisma` 中添加 → `npx prisma db push`
5. **玻璃效果**: 容器用 `className="lg-surface"`，重要面板用 `lg-surface-strong`；只需毛玻璃底层的加 `lg-underlay` 混入类
