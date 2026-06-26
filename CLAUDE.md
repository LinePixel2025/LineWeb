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
│       │   ├── Layout.tsx      # 路由出口 + 壁纸背景层 + 渐变叠加 + 版权
│       │   ├── Guards.tsx      # ProtectedRoute / AdminRoute
│       │   └── glass/          # Liquid Glass 高阶组件 (React)
│       │       ├── LiquidGlass.tsx
│       │       ├── LiquidButton.tsx
│       │       ├── filters.svg  # SVG 滤镜副本 (备用)
│       │       └── index.ts
│       ├── contexts/
│       │   ├── AuthContext.tsx       # JWT 认证 (useAuth hook)
│       │   ├── WallpaperContext.tsx  # 壁纸 URL + 版权 + loading/loaded/refresh (useWallpaper hook)
│       │   └── ContrastContext.tsx   # 逐像素位置感知字体反色 (data-ac 属性扫描)
│       ├── lib/api.ts          # 自动注入 Bearer token 的 fetch 封装 (get/post/put/delete)
│       ├── pages/              # 每页一个文件，EditorPage 使用 HTML textarea 编辑器
│       └── styles/
│       │   └── globals.css     # 全部设计系统 (无其他 CSS 文件)
│       └── main.tsx
├── server/                    # 后端 (Express + Prisma)
│   ├── .env                   # DATABASE_URL + JWT_SECRET (必填)
│   ├── prisma/
│   │   ├── schema.prisma      # User + Post + Page 模型 (PostgreSQL)
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
| 后端 | Express 4, Prisma 6, Zod, JWT, bcryptjs |
| 数据库 | PostgreSQL（部署 Railway 自动注入 `DATABASE_URL`；本地开发改 `.env` 即可） |
| 设计 | Apple Liquid Glass (WWDC 2025) — SVG feDisplacementMap 折射 + backdrop-filter 层叠 |

## Database Schema

```
User (users)                  Post (posts)
├── id (PK, 自增)             ├── id (PK, 自增)
├── username (unique)         ├── title
├── email (unique)            ├── content (HTML)
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
| `/posts/:slug` | PostPage | — | 文章阅读 |
| `/login` | LoginPage | — | 登录表单 |
| `/register` | RegisterPage | — | 注册表单 |
| `/profile` | ProfilePage | ProtectedRoute | 用户信息 |
| `/admin` | AdminPage | AdminRoute | 文章管理列表 |
| `/admin/new` | EditorPage | AdminRoute | 新建文章 |
| `/admin/edit/:id` | EditorPage | AdminRoute | 编辑文章 |

Provider 嵌套: `BrowserRouter > AuthProvider > WallpaperProvider > ContrastProvider > Routes`。

## Auth Flow

1. **注册/登录** → 后端返回 `{ token, user }` → 存 `localStorage("lineweb_token")`
2. **后续请求** → `api.ts` 自动从 localStorage 读取 token，加到 `Authorization: Bearer` 头
3. **页面刷新** → `AuthProvider` useEffect 检测 token 存在则调用 `/auth/me` 验证，失败则清除 token
4. **路由保护** → `ProtectedRoute` (需登录) / `AdminRoute` (需 admin)，加载时显示 spinner，不满足时 `Navigate`

## ContrastContext — 逐像素位置感知字体反色

`ContrastContext.tsx` 在壁纸之上实现自动文字颜色反色，确保玻璃表面文字在任何壁纸下都清晰可读：

1. **壁纸采样** — 壁纸加载后用 200px 宽 canvas 绘制缩略图 + 叠加渐变层（匹配 Layout 的 `linear-gradient` 参数）
2. **像素位置匹配** — 扫描 `SCAN_SELECTOR`（h1~h6、p、span、a、button 等）中每个元素的中心位置在壁纸上的对应像素亮度，排除 `EXCLUDE_CLASSES`（按钮、输入框、主题切换等自带固定配色的元素）
3. **设置 `data-ac` 属性** — 明亮背景 → `data-ac="black"`，深色背景 → `data-ac="white"`
4. **CSS 响应** — `globals.css` 中 `[data-ac="black"]` 设置黑色文字，`[data-ac="white"]` 设置白色文字，覆盖 `.lg-surface` 的默认颜色
5. **触发场景** — 页面切换、滚动、resize 时重新扫描（3 帧防抖）

关键设计：使用 CanvasGradient API 替代逐像素叠加渐变，批量读取全 canvas 的 ImageData 而非逐元素 getImageData，性能开销极低。

## Key Design Decisions

| 决策 | 方案 | 原因 |
|------|------|------|
| Liquid Glass 实现 | SVG feDisplacementMap + backdrop-filter 三层堆叠 | 纯 blur() 无法产生折射扭曲 |
| 可读性方案 | 底层 blur(14px) 毛玻璃底衬 + ContrastContext 像素级反色 | 在任何壁纸上文字均清晰，无需固定背景色 |
| 单 CSS 文件 | globals.css 一千多行包含全部样式 | 零 CSS 文件碎片，单一 source of truth |
| 壁纸轮换 | WallpaperContext fetch `/api/bing-wallpaper` → CSS background | 组件无关，Layout 统一管理；提供 refresh() 用于手动切换 |
| 主题切换 | CSS 自定义属性 `[data-theme]` + `<meta name="color-scheme">` 跟随系统 | 零 JS 切换开销，原生元素（滚动条、表单）自动适配系统主题 |
| HTTP 客户端 | 前端 api.ts 封装 fetch + JWT 自动注入 | 无外部 HTTP 库依赖 |
| SQLite | Prisma 抽象 | 零配置开发；切 MySQL 改一行 provider |
| 中国 npm | `.npmrc` → npmmirror.com | 境内安装加速 |
| 文章编辑器 | EditorPage 直接使用 HTML textarea + 实时预览 | 无富文本编辑器依赖；内容为纯 HTML，可在预览区直接检查渲染效果 |

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

默认管理员：`admin@lineweb.dev` / `admin123`；第二个管理员 `line@lineweb.dev` / `liang798119`

## Deployment (Railway)

根 `package.json` 的 `start` 脚本是 Railway 入口。部署使用 PostgreSQL schema 文件（`schema.pg.prisma`）：

```bash
# Railway 执行流程：
npm run build                                    # → client/dist/（Vite 构建前端）
cd server && npx prisma generate --schema ...    # 用 PostgreSQL schema 生成客户端
cd server && npx prisma db push --schema ...     # 同步数据库 Schema → PostgreSQL
cd server && npx prisma db seed --schema ...     # 填充种子数据
NODE_ENV=production npx tsx ...                  # 启动 Express（同时 serve 前端）
```

### 首次部署步骤

1. **New Project** → **Deploy from GitHub repo** → 选 `LinePixel2025/LineWeb`
2. **添加 PostgreSQL 数据库**：
   - 在项目 Canvas 上点 **New** → **Database** → **Add PostgreSQL**
   - Railway 会自动注入 `DATABASE_URL` 环境变量，无需手动设置
3. **设置环境变量**（在 Variables 中）：

| Key | Value | 说明 |
|-----|-------|------|
| `JWT_SECRET` | `(随机字符串)` | **必须**，生产环境密钥 |
| `NPM_CONFIG_REGISTRY` | `https://registry.npmjs.org` | **必须**，覆盖 `.npmrc` 中国镜像 |

4. 等待部署完成即可。

> **注意**：不再需要 Volume。PostgreSQL 由 Railway 托管，数据自动持久化。

### `DATABASE_URL`

由 Railway 自动注入，格式为 `postgresql://user:pass@host:5432/railway`。不需要手动在 Variables 中设置。

### 注意点

- `start` 脚本包含 `npm run build` 前置步骤，自动构建前端
- `prisma db push` 已移除 `--accept-data-loss`（PostgreSQL 不需要）
- 如果 seed 失败，检查容器日志，常见原因见下方的数据库故障排除

## Adding Features

1. **后端路由**: 在 `server/src/routes/` 新建 → `index.ts` 中用 `app.use('/api/xxx', router)` 挂载
2. **前端页面**: 在 `client/src/pages/` 新建 → `App.tsx` `<Routes>` 中添加 `<Route>` — 注意 Provider 嵌套顺序
3. **路由保护**: 用 `<ProtectedRoute>`（需登录）或 `<AdminRoute>`（需 admin）包裹
4. **新数据库模型**: `schema.prisma` 中添加 → `npx prisma db push`
5. **玻璃效果**: 容器用 `className="lg-surface"`，重要面板用 `lg-surface-strong`；只需毛玻璃底层的加 `lg-underlay` 混入类

## Important Patterns & Gotchas

### 后端模式
- `res.json(...)` 后必须 `return`（Express 4 无返回值检查），否则会继续执行并报 `Cannot set headers after they are sent`
- Zod 校验一律用 `.safeParse`，失败时返回 `400` + `parsed.error.flatten()`
- auth 路由的 `upsert` 用 `username` 做 `where` 条件，而非 `email`（历史原因：本地可能已有同名不同 email 的用户）

### 前端模式
- `api.ts` 导出一个 `api` 对象，所有请求自动注 token，使用方式 `api.get<T>(url)` / `api.post<T>(url, body)`
- 所有页面放在 `pages/`，组件在 `components/`，contexts 在 `contexts/`
- CSS 修改只改 `globals.css` 一个文件，不要新建 CSS 文件
- `LiquidButton` 支持 `to` / `href` / `onClick` 三种交互模式；`variant` 默认为 `glass`
- `LiquidGlass` 组件默认开启交互镜面高光和色差边缘

### 数据库故障排除
- **seed 失败 "Unique constraint failed on `username`"**：用户已存在但 `upsert` 的 `where` 条件用的是 `email` 而非 `username`（两次 seed 的 email 可能不同）。修复：确保 seed 中每个用户的 `upsert` 用 `username` 做唯一匹配
- **数据库重置**：删 `server/prisma/lineweb.db` 再 `prisma db push && prisma db seed`
- **开发中普适性建议**：不要用 `prisma migrate`（容易与 SQLite 文件冲突），直接用 `prisma db push`
