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
│       ├── components/        # Navbar / Layout / Guards / AdminLayout
│       │   ├── comments/      # CommentSection + ReplyForm + CommentCard
│       │   ├── editor/        # LexicalEditor + EditorToolbar + CodeHighlightPlugin
│       │   ├── drive/         # DrivePage 的拆分组件
│       │   └── glass/         # LiquidGlass + LiquidButton React 组件
│       ├── contexts/          # AuthContext / WallpaperContext / ContrastContext
│       ├── lib/api.ts         # 自动注入 Bearer token 的 fetch 封装
│       ├── types/             # comment.ts (CommentData / CommentAuthor)
│       ├── pages/             # 每页一个文件（admin/ 子目录为管理面板页面）
│       └── styles/globals.css # 全部设计系统（零碎片 CSS 文件）
├── server/                    # 后端 (Express + Prisma)
│   ├── .env                   # DATABASE_URL + JWT_SECRET (必需)
│   ├── prisma/
│   │   ├── schema.prisma      # 5 个模型：User / Post / Comment / Page / DriveFile
│   │   └── seed.ts            # 管理员 seed
│   ├── scripts/               # 部署脚本 (generate-pg-schema.js)
│   └── src/
│       ├── index.ts           # Express 入口 + 路由挂载 + 静态文件
│       ├── config/index.ts    # Zod schema + 环境变量常量
│       ├── lib/
│       │   ├── prisma.ts      # 单例 PrismaClient（含 BigInt.prototype.toJSON 扩展）
│       │   └── utils.ts       # parsePagination / parseId / getErrorMessage / getErrorStatus
│       ├── middleware/
│       │   ├── auth.ts        # authenticate + requireAdmin
│       │   └── errorHandler.ts# AppError 类 + 全局异常处理中间件
│       ├── routes/            # auth / posts / comments / pages / bing / drive / users
│       ├── services/          # Service 层 — authService / postService / storageTunnel / storageSync / dedupDriveFiles
│       └── scripts/           # 工具脚本
├── storage-node/              # 独立 WebSocket 存储节点 (Python)
│   ├── main.py                # asyncio WebSocket 客户端 + seek/.tmp 流式文件操作
│   └── config.json            # 连接配置
├── package.json               # Monorepo 脚本
├── .npmrc                     # registry=https://registry.npmmirror.com (中国加速)
└── docs/                      # 设计文档 & 计划
    └── superpowers/specs/     # 架构规范文档
    └── superpowers/plans/     # 实施计划
```

## Key Architecture Patterns

### 后端架构 — Route → Service → Prisma

路由层（`routes/`）处理 HTTP 请求/响应、Zod 校验、中间件；业务逻辑委托给 Service 层（`services/`）。

- **Routes** 只做：参数提取 → Zod 校验 → 调用 Service → `res.json()`
- **Services** 只做：业务逻辑 → Prisma 查询/写入 → 返回结果或 throw
- **错误处理**：业务层 throw `AppError`（带 status 码），`errorHandler` 中间件统一 catch
- `res.json(...)` 后必须 `return`（Express 4 无返回值检查）

### 大文件传输协议 (JSON-over-WebSocket)

```
Express (WebSocket Server) ←→ Storage Node (Python WebSocket Client)
```

- **下载**：拉模式 — Express 逐个请求 chunk（`read_file` + `offset` + `length`），Storage Node 用 `seek + read` 只读一个 chunk 返回。内存峰值 ~256KB。
- **上传**：Express 边收边转发（32KB/chunk），Storage Node 每个 chunk 立即 base64 解码 + `os.write` + `os.fsync` 追加到 `.tmp` 文件，最后一块 `os.rename`。内存峰值 ~64KB。

**关键文件：** `server/src/services/storageTunnel.ts`（Express 端）↔ `storage-node/main.py`（Python 端）

### 前端架构

- **Context 嵌套顺序**：`BrowserRouter > AuthProvider > WallpaperProvider > ContrastProvider > Routes`
- **驱动**：上传、下载、文件浏览都在 `api.get<T>()` / `api.post<T>()` 等封装方法中自动注入 Bearer token
- **CSS**：只改 `client/src/styles/globals.css` 一个文件
- **路由保护**：`ProtectedRoute`（需登录，任意 role） / `AdminRoute`（需 role=admin）

### Design System — Liquid Glass

三层玻璃堆叠：`::before`(backdrop-filter 毛玻璃, z-index:-1) → element(SVG feDisplacementMap 折射, z-index:0) → `::after`(径向渐变镜面高光, z-index:1)。LiquidGlass 组件额外叠加交互式高光(z-index:3)和色差边缘(z-index:1)。

全部 CSS 集中在 `globals.css`。Glass 效果类：
- `.lg-surface`（标准）+ `.lg-surface-strong`（厚）+ `.lg-surface-blur`（无底衬）+ `.lg-surface-strong-blur`（无底衬）

## Database Schema (5 models)

- **User** — `id` / `username`(unique) / `email`(unique) / `password`(bcrypt) / `role`("user"|"admin") / `settings`(JSON string) / `canAccessDrive`(bool)
- **Post** — `id` / `title` / `content`(HTML) / `slug`(unique) / `published` / `authorId`(FK→User)
- **Comment** — `id` / `content` / `postId`(FK→Post, CASCADE) / `authorId`(FK→User) / `parentId`(FK→self, CASCADE) — 仅支持一级嵌套
- **Page** — `id` / `slug`(unique) / `title` / `schema`(JSON string 控件树) / `published` / `featured`
- **DriveFile** — `id` / `name` / `isFolder` / `parentId`(FK→self) / `size`(BigInt) / `storagePath`(unique) / `uploadedById`(FK→User)

## Common Commands

```bash
# 开发启动
cd server && npm run dev           # tsx watch → localhost:3001
cd client && npx vite              # → localhost:5173 (proxy /api → 3001)
# 或根目录：npm run dev            # concurrently 同时启动

# 数据库 (在 server/ 下执行)
npx prisma db push                 # 同步 Schema → SQLite（不要用 prisma migrate）
npx prisma db seed                 # 填充种子数据
npx prisma studio                  # Prisma GUI

# TypeScript 检查
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit

# 生产构建 (Vite → client/dist/)
cd client && npx vite build        # 或根目录：npm run build

# 存储节点 (Windows Python)
cd storage-node && python main.py
```

## Initial Setup

```bash
# 1. 安装依赖（postinstall 自动装子目录）
npm install

# 2. 配好 server/.env
DATABASE_URL="file:./lineweb.db"
JWT_SECRET="your-secret-key"
STORAGE_NODE_TOKEN="openssl rand -hex 32"  # 可选，本地开发可用默认值

# 3. 初始化数据库
cd server && npx prisma db push && npx prisma db seed
```

默认管理员：`admin@lineweb.dev` / `admin123`；第二个管理员 `line@lineweb.dev` / `liang798119`

## Important Patterns & Gotchas

### 后端
- `res.json(...)` 后必须 `return`（Express 4 无返回值检查）
- Zod 校验一律用 `.safeParse`，失败时返回 `400` + `parsed.error.flatten()`
- 路由注册顺序重要：`/featured` 必须在 `/:id` 之前；`/admin/all` 必须在 `/:slug` 之前
- `parsePagination` 和 `parseId` 位于 `server/src/lib/utils.ts`，各路由共用
- Service 层抛错用 `throw Object.assign(new Error(msg), { status: 4xx })` 或 `throw new AppError(msg, status)`
- `BigInt.prototype.toJSON` 扩展在 `server/src/lib/prisma.ts` 顶部（DriveFile.size 字段）
- Drive upload 使用 busboy（非 multer）流式解析，支持大文件边收边发到存储节点

### 前端
- `api.get<T>(url)` / `api.post<T>(url, body)` / `api.put<T>()` / `api.delete()` — 自动注入 Bearer token
- 驱动相关的组件在 `components/drive/`，页面在 `pages/DrivePage.tsx`
- `LiquidButton` 支持 `to`(React Router) / `href`(外部链接) / `onClick`(事件)；`variant` 默认为 `glass`
- 编辑器使用 Lexical（非 textarea），内容为 HTML
- Drive 上传使用多文件 + 进度条，依赖 `components/drive/`

### 数据库
- **不要用 `prisma migrate`**，直接用 `prisma db push`
- seed 失败"Unique constraint"：upsert 的 where 条件用 `username` 而非 `email`
- 数据库重置：删 `server/prisma/lineweb.db` 再 `prisma db push && prisma db seed`

### 部署 (Railway)
- 入口为根 `package.json` 的 `start` 脚本：`npm run build` → `generate-pg-schema.js` → `tsx src/index.ts`
- 环境变量 `NPM_CONFIG_REGISTRY=https://registry.npmjs.org` 覆盖 .npmrc 的中国镜像
- 存储节点需配置 `STORAGE_NODE_TOKEN` 并与 `storage-node/config.json` 的 token 一致

### 跨平台兼容 (Windows)
- Storage Node 运行在 Windows 笔记本上，Python 文件操作用 `open() + seek + read`，**不要用 `os.pread`**（POSIX-only，Windows 不存在）
- HTTP body 解析用 busboy（非 formidable）
- `.npmrc` 设了 `registry=https://registry.npmmirror.com`（中国加速），Railway 部署需覆盖为 npmjs
