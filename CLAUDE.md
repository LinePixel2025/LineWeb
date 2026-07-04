# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Line Web 是一个使用 **Apple Liquid Glass** 设计语言（WWDC 2025）的个人网站。
前端基于 React 19 + Vite + TypeScript，后端基于 Express + Prisma + SQLite（本地） / PostgreSQL（部署）。
支持亮色/暗色/跟随系统三种主题模式。

## Architecture

```
lineweb/                       # 根 monorepo (concurrently 管理双端)
├── client/                    # 前端 (React + Vite)
│   ├── index.html             # SVG <filter> 玻璃折射滤镜内联于此
│   └── src/
│       ├── App.tsx            # 路由定义 + Provider 嵌套
│       ├── components/
│       │   ├── Navbar.tsx      # 浮动导航栏 (.navbar + lg-underlay)
│       │   ├── Layout.tsx      # 路由出口 + 壁纸背景层 + 渐变叠加 + 版权
│       │   ├── Guards.tsx      # ProtectedRoute / AdminRoute
│       │   ├── AdminLayout.tsx # 管理后台侧栏布局
│       │   ├── comments/       # CommentSection + ReplyForm + CommentCard
│       │   ├── editor/         # LexicalEditor + EditorToolbar + CodeHighlightPlugin
│       │   └── glass/          # LiquidGlass + LiquidButton React 组件
│       ├── contexts/
│       │   ├── AuthContext.tsx       # JWT 认证 (useAuth hook)
│       │   ├── WallpaperContext.tsx  # 壁纸 URL + 版权 + loading/loaded/refresh (useWallpaper hook)
│       │   └── ContrastContext.tsx   # 逐像素位置感知字体反色 (data-ac 属性扫描)
│       ├── lib/
│       │   └── api.ts          # 自动注入 Bearer token 的 fetch 封装 (get/post/put/delete)
│       ├── types/
│       │   └── comment.ts      # CommentData / CommentAuthor 共享类型
│       ├── pages/              # 每页一个文件
│       │   └── admin/          # CommentAdminPage / PageList / PageEditor / UserAdminPage
│       └── styles/
│           └── globals.css     # 全部设计系统 (无其他 CSS 文件)
├── server/                    # 后端 (Express + Prisma)
│   ├── .env                   # DATABASE_URL + JWT_SECRET (必填)
│   ├── prisma/
│   │   ├── schema.prisma      # User + Post + Comment + Page + DriveFile 模型
│   │   └── seed.ts            # 管理员 seed
│   ├── scripts/
│   │   └── generate-pg-schema.js  # schema.prisma → PostgreSQL 版本 (Railway 部署)
│   └── src/
│       ├── index.ts           # Express 入口 (app.listen + 静态文件 serve)
│       ├── config/index.ts    # Zod schema + 环境变量
│       ├── lib/
│       │   ├── prisma.ts      # 单例 PrismaClient
│       │   └── utils.ts       # parsePagination / parseId (路由共用)
│       ├── middleware/
│       │   ├── auth.ts           # authenticate + requireAdmin
│       │   └── errorHandler.ts   # 全局错误处理中间件
│       ├── routes/               # auth / posts / comments / pages / bing / drive / users
│       ├── services/
│       │   ├── storageTunnel.ts  # WebSocket 存储节点通信
│       │   ├── storageSync.ts    # 定时同步 DB 与存储节点文件 (upsert 幂等)
│       │   └── dedupDriveFiles.ts # 启动时清理重复 storagePath 记录
│       └── scripts/              # 部署 & 工具脚本
├── package.json               # Monorepo 脚本
└── .npmrc                     # registry=https://registry.npmmirror.com (中国加速)
```

## Tech Stack

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite 6, TypeScript 5, React Router 7, Lexical 0.46 (富文本编辑器) |
| 后端 | Express 4, Prisma 6, Zod, JWT, bcryptjs, multer (文件上传), ws (WebSocket) |
| 数据库 | PostgreSQL（Railway 部署） / SQLite（本地开发） |
| 存储 | WebSocket Storage Node — 独立存储节点，通过 storageTunnel 通信 |
| 设计 | Apple Liquid Glass (WWDC 2025) — SVG feDisplacementMap 折射 + backdrop-filter 层叠 |

## Database Schema

```
User (users)                  Post (posts)
├── id (PK, 自增)             ├── id (PK, 自增)
├── username (unique)         ├── title
├── email (unique)            ├── content (HTML)
├── password (bcrypt)         ├── summary?
├── role ("user"|"admin")     ├── slug (unique)
├── settings? (JSON string)   ├── published (default: false)
├── canAccessDrive (bool)     ├── authorId (FK → users.id)
├── createdAt                 └── ...
└── updatedAt

Comment (comments)            Page (pages)           DriveFile (drive_files)
├── id (PK, 自增)             ├── id (PK, 自增)     ├── id (PK, 自增)
├── content                   ├── slug (unique)      ├── name
├── postId (FK → posts.id)    ├── title              ├── isFolder (bool)
├── authorId (FK → users.id)  ├── schema (JSON)      ├── parentId? (FK → self)
├── parentId? (FK → self)     ├── published          ├── size (BigInt)
└── replies[]                 ├── featured           ├── mimeType?
                              ├── featureEmoji?      ├── storagePath
                              ├── featureDesc?       ├── uploadedById (FK → users.id)
                              └── ...                └── ...
```

- 评论仅支持一级嵌套：parentId 非 null 的评论不能再有子评论
- Page.schema 是 JSON 字符串，存储控件树结构供 DynamicPage 渲染
- DriveFile 支持文件夹嵌套 (self-relation)，isFolder=true 时为文件夹

## API Endpoints

### Auth (`/api/auth`)
| Method | Path | Auth | Returns |
|--------|------|------|---------|
| POST | `/register` | — | `{ token, user }` |
| POST | `/login` | — | `{ token, user }` |
| GET | `/me` | Bearer | user object |
| PUT | `/settings` | Bearer | `{ settings }` — 用户个性化设置 |

Zod 校验: username 2-50, email max 100, password min 6。Token 7 天有效。

### Posts (`/api/posts`)
Express 注册顺序: `/` → `/:slug` → `/admin/all` → `/admin/:id` (注意 `/admin/all` 不被 `/:slug` 吞掉)。

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | — | 已发布文章列表（分页） |
| GET | `/:slug` | — | 单篇公开文章 |
| GET | `/admin/all` | admin | 全部文章（含草稿，分页） |
| GET | `/admin/:id` | admin | 单篇文章完整内容 |
| POST | `/` | admin | 创建文章 |
| PUT | `/:id` | admin | 更新文章（部分更新） |
| DELETE | `/:id` | admin | 删除文章 |

### Pages (`/api/pages`)
Express 注册顺序: `/featured` → `/slug/:slug` → `/` → `/:id`。

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/featured` | — | 功能界面展示的已发布页面列表 |
| GET | `/slug/:slug` | — | 按 slug 获取已发布页面 |
| GET | `/` | admin | 全部页面列表（分页） |
| POST | `/` | admin | 创建页面 |
| GET | `/:id` | admin | 按 ID 获取页面完整内容 |
| PUT | `/:id` | admin | 更新页面 |
| DELETE | `/:id` | admin | 删除页面 |

### Comments (`/api/comments`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/post/:postId` | — | 某篇文章的全部评论（树状） |
| POST | `/` | Bearer | 发表评论（支持 parentId 回复） |
| GET | `/admin/posts` | admin | 有评论的文章列表（按文章分组） |
| GET | `/admin/post/:postId` | admin | 某篇文章的全部评论（树状） |
| PUT | `/:id` | admin | 编辑评论 |
| DELETE | `/:id` | admin | 删除评论（级联删除子评论） |

### Drive (`/api/drive`) — 网盘文件管理
所有路由需 `authenticate` + `canAccessDrive` 权限。依赖独立的 WebSocket Storage Node 做实际文件存储。

| Method | Path | Description |
|--------|------|-------------|
| GET | `/files` | 列出文件（支持 parentId 参数） |
| GET | `/files/:id` | 获取单个文件/文件夹详情 |
| GET | `/search` | 搜索文件（`?q=keyword`） |
| POST | `/folders` | 创建文件夹 |
| POST | `/upload` | 上传文件 (busboy 流式解析, multipart/form-data) |
| GET | `/download/:id` | 下载文件（重定向到存储节点 URL） |
| PUT | `/files/:id` | 重命名文件/文件夹 |
| DELETE | `/files/:id` | 删除文件/文件夹 |
| POST | `/storage/connect` | 连接 WebSocket 存储节点 |

### Users (`/api/users`) — 管理员用户管理
所有路由需 `authenticate` + `requireAdmin`。

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | 用户列表（分页） |
| PUT | `/:id` | 更新用户（role 或 password） |

### Wallpaper (`/api/bing-wallpaper`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | 代理 picsum.photos，返回 `{ url, copyright }` |

## Design System — Liquid Glass

全部 CSS 集中在 `client/src/styles/globals.css`，零碎片 CSS 文件。

### 三层玻璃堆叠

```
┌───────────────────────────────────────┐
│  ::after        z-index:  1          │  径向渐变镜面高光 (共享)
│  element        z-index:  0          │  SVG feDisplacementMap 折射 + 底色
│  ::before       z-index: -1          │  backdrop-filter: blur(14px) 毛玻璃 (共享)
└───────────────────────────────────────┘
```

LiquidGlass 组件还额外叠加交互式镜面高光（鼠标跟随，z-index:3）和色差边缘（z-index:1）。

### SVG 滤镜（内联于 `client/index.html <svg>`）

| 滤镜 | 用途 | feTurbulence | feDisplacementMap scale | feGaussianBlur |
|------|------|-------------|------------------------|----------------|
| `#lg-core` | 标准玻璃 | 0.006 / 2 octaves | 35 | 0.4px |
| `#lg-core-strong` | 厚玻璃 | 0.004 / 4 octaves | 60 | 0.6px |
| `#lg-glow` | 泛光 | — | — | 12px blur |

关键设计: feColorMatrix 将圆角半透明像素填为不透明 → 防止 displacement 把透明边拉入作为白色伪影 → feComposite 恢复原始 alpha。

### 核心 CSS 类

| Class | 折射滤镜 | 含 underlay |
|-------|---------|-------------|
| `.lg-surface` | `#lg-core` | ✅ |
| `.lg-surface-strong` | `#lg-core-strong` | ✅ |
| `.lg-surface-blur` | `#lg-core` | — |
| `.lg-surface-strong-blur` | `#lg-core-strong` | — |
| `.lg-underlay` | — | — (仅底衬) |
| `.lg-input` | `#lg-core` | ❌ 但自带 |
| `.navbar` | `#lg-core` | ✅ |

### 按钮 Variant

`primary`(渐变+accent glow) / `glass`(毛玻璃半透明+边框，默认) / `ghost`(透明+hover) / `danger`(红色渐变)。尺寸: `sm`/`md`/`lg`。含 `.btn-flare` hover 炫光层。

### 主题切换

CSS 自定义属性暗色为默认值，亮色模式通过 `[data-theme="light"]` 覆盖，跟随系统通过 `<meta name="color-scheme">` 监听。零 JS 切换开销。

## Pages & Routes (React Router)

Provider 嵌套: `BrowserRouter > AuthProvider > WallpaperProvider > ContrastProvider > Routes`。

| Path | Component | Guard | Notes |
|------|-----------|-------|-------|
| `/` | HomePage | — | 壁纸全屏背景 + Hero |
| `/features` | FeaturesPage | — | 功能卡片网格 (从 pages API 加载) |
| `/calculator` | CalculatorPage | — | 科学计算器 |
| `/posts` | PostsPage | — | 文章列表 (分页) |
| `/posts/:slug` | PostPage | — | 文章阅读 + 评论区 |
| `/page/:slug` | DynamicPage | — | 动态页面（从 schema JSON 渲染控件树） |
| `/drive` | DrivePage | ProtectedRoute | 网盘文件管理 |
| `/login` | LoginPage | — | 登录表单 |
| `/register` | RegisterPage | — | 注册表单 |
| `/profile` | ProfilePage | ProtectedRoute | 用户信息/设置 |
| `/admin` | AdminPage | AdminRoute | 文章管理列表 |
| `/admin/new` | EditorPage | AdminRoute | 新建文章 (Lexical) |
| `/admin/edit/:id` | EditorPage | AdminRoute | 编辑文章 (Lexical) |
| `/admin/comments` | CommentAdminPage | AdminRoute | 评论管理（按文章分组） |
| `/admin/pages` | PageList | AdminRoute | 页面管理 |
| `/admin/pages/new` | PageEditor | AdminRoute | 新建动态页面 |
| `/admin/pages/:id/edit` | PageEditor | AdminRoute | 编辑动态页面 |
| `/admin/users` | UserAdminPage | AdminRoute | 用户管理 |

## Key Architecture Notes

### Auth Flow
1. 注册/登录 → 后端返回 `{ token, user }` → 存 `localStorage("lineweb_token")`
2. api.ts 自动注入 Bearer token
3. AuthProvider 在 token 存在时调用 `/auth/me` 验证，失败则清除
4. Guards: ProtectedRoute (需登录) / AdminRoute (需 admin)

### ContrastContext — 逐像素位置感知字体反色
壁纸采样 → 扫描 h1~h6/p/span/a/button 等元素的中心位置对应的壁纸像素亮度（排除按钮/输入框等固定配色元素）→ `data-ac="black"|"white"` 属性 → CSS 选择器覆盖文字颜色。用 CanvasGradient API 匹配 Layout 的 linear-gradient 叠加。

### DynamicPage — JSON Schema 驱动页
Page 模型存储 `schema` 为 JSON 字符串，描述控件树结构。DynamicPage 解析并在运行时渲染。
用于无需编写代码即可创建的功能页面（如 FeaturesPage 展示这类页面的入口）。

### Drive — 网盘 + Storage Node
DrivePage 是前端文件管理器。文件元数据存本地 Prisma，实际文件存储通过 WebSocket 隧道转交给远程 Storage Node（`services/storageTunnel.ts`）。大文件分块传输（32KB/chunk）。需 User.canAccessDrive=true 权限。

### LexicalEditor — 富文本编辑器
使用 Meta 的 Lexical 框架 (v0.46)，替换了之前的 textarea。位于 `components/editor/`：
- LexicalEditor.tsx — 编辑器核心，包含 $generateHtmlFromNodes / $generateNodesFromDOM
- EditorToolbar.tsx — 文本格式（加粗/斜体/标题/代码块/有序无序列表/链接/对齐）

### 编辑器插件
- CodeHighlightPlugin — 代码块语法高亮
- @lexical/react 全套插件 (RichTextPlugin, HistoryPlugin, LinkPlugin, ListPlugin, OnChangePlugin)

### 计算器 (CalculatorPage)
纯前端科学计算器，无后端依赖。

## Common Commands

```bash
# 开发启动
cd server && npm run dev        # tsx watch → localhost:3001
cd client && npx vite           # → localhost:5173 (proxy /api → 3001)
# 或根目录：npm run dev         # concurrently 同时启动

# 生产构建 (TypeScript 检查 + Vite)
cd client && npx vite build     # → client/dist/

# 数据库 (在 server/ 下执行)
npx prisma db push              # 同步 Schema → SQLite
npx prisma db seed              # 填充种子数据
npx prisma studio               # Prisma 数据浏览器

# TypeScript 类型检查
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit

# Vite 局域网访问
cd client && npx vite --host
```

## Initial Setup

```bash
# 安装依赖 (postinstall 自动装子目录)
npm install

# 配好 server/.env
DATABASE_URL="file:./lineweb.db"
JWT_SECRET="your-secret-key"

# 初始化数据库
cd server && npx prisma db push && npx prisma db seed
```

默认管理员：`admin@lineweb.dev` / `admin123`；第二个管理员 `line@lineweb.dev` / `liang798119`

## Deployment (Railway)

根 `package.json` 的 `start` 脚本是 Railway 入口：
1. `npm run build` — Vite 构建前端 → `client/dist/`
2. `node scripts/generate-pg-schema.js` — 从 SQLite schema 生成 PG schema + db push + seed
3. `NODE_ENV=production npx tsx src/index.ts` — Express serve（兼做前端静态文件）

环境变量: `JWT_SECRET`(必须)、`NPM_CONFIG_REGISTRY=https://registry.npmjs.org`(必须，覆盖 .npmrc)。

## Adding Features

1. **新后端路由**: `server/src/routes/` 新建文件 → `server/src/index.ts` 中 `app.use('/api/xxx', router)` 挂载
2. **新前端页面**: `client/src/pages/` 新建 → `App.tsx` `<Routes>` 中添加 `<Route>`
3. **路由保护**: 用 `<ProtectedRoute>`（需登录）或 `<AdminRoute>`（需 admin）包裹
4. **新数据库模型**: 改 `schema.prisma`（一个文件），`prisma db push` 同步
5. **玻璃效果**: 容器用 `className="lg-surface"`，重要面板用 `lg-surface-strong`；只需毛玻璃底层的加 `lg-underlay`

## Important Patterns & Gotchas

### 后端
- `res.json(...)` 后必须 `return`（Express 4 无返回值检查）
- Zod 校验一律用 `.safeParse`，失败时返回 `400` + `parsed.error.flatten()`
- auth 路由的 upsert 用 `username` 做 `where`（历史原因，非 email）
- `parsePagination` 和 `parseId` 位于 `server/src/lib/utils.ts`，各路由共用
- 评论树构建用 `buildCommentTree()`（`routes/comments.ts` 内部）
- DriveFile 的 BigInt 字段扩展了 `BigInt.prototype.toJSON` 转为 Number（在 `routes/drive.ts` 顶部）
- 路由注册顺序重要：`/featured` 必须在 `/:id` 之前注册；`/admin/all` 必须在 `/:slug` 之前注册
- Drive upload 使用 busboy（非 multer）流式解析，支持大文件边收边发到存储节点

### 前端
- `api.get<T>(url)` / `api.post<T>(url, body)` — 自动注 token
- CSS 修改只改 `globals.css` 一个文件
- `LiquidButton` 支持 `to`(React Router) / `href`(外部链接) / `onClick`(事件)；`variant` 默认为 `glass`
- `LiquidGlass` 默认开启交互镜面高光和色差边缘
- 编辑器使用 Lexical（非 textarea），内容为 HTML

### 数据库故障排除
- **seed 失败 "Unique constraint"**：upsert 的 where 条件用 `username` 而非 `email`
- **数据库重置**：删 `server/prisma/lineweb.db` 再 `prisma db push && prisma db seed`
- **不要用 `prisma migrate`**，直接用 `prisma db push`
- **添加约束时数据丢失警告**：如果已有数据与新增的 `@unique` 或 `@default` 冲突，`prisma db push` 会要求 `--accept-data-loss` 标志。先运行对应的一次性清理脚本再执行
