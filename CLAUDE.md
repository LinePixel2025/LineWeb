# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Line Web 是一个使用 **Apple Liquid Glass** 设计语言（WWDC 2025）的个人网站。
前端基于 React 19 + Vite + TypeScript，后端基于 Express + Prisma + SQLite（本地） / PostgreSQL（部署）。
支持亮色/暗色/跟随系统三种主题模式。

## Architecture

```
lineweb/                       # 根 monorepo (concurrently 管理双端)
├── client/                    # 前端 (React 19 + Vite 6)
│   ├── index.html             # SVG <filter> 玻璃折射滤镜内联于此
│   └── src/
│       ├── App.tsx            # 路由定义 + Provider 嵌套 + 懒加载
│       ├── components/        # Navbar / Layout / Guards / AdminLayout
│       │   ├── comments/      # CommentSection + ReplyForm + CommentCard
│       │   ├── editor/        # LexicalEditor + EditorToolbar + CodeHighlightPlugin
│       │   ├── drive/         # DrivePage 的拆分组件
│       │   └── glass/         # LiquidGlass + LiquidButton React 组件
│       ├── contexts/          # AuthContext / WallpaperContext / ContrastContext / DownloadContext
│       ├── lib/api.ts         # 自动注入 Bearer token 的 fetch 封装（30s 超时，401 自动登出）
│       ├── types/             # comment.ts (CommentData / CommentAuthor)
│       ├── pages/             # 每页一个文件（admin/ 子目录为管理面板页面）
│       └── styles/globals.css # 全部设计系统（零碎片 CSS 文件）
├── server/                    # 后端 (Express 4 + Prisma 6)
│   ├── .env                   # DATABASE_URL + JWT_SECRET (必需)
│   ├── prisma/
│   │   ├── schema.prisma      # 6 个模型：User / Post / Comment / Page / DriveFile / ApiKey
│   │   └── seed.ts            # 管理员 seed
│   ├── scripts/               # 部署脚本 (generate-pg-schema.js)
│   └── src/
│       ├── index.ts           # Express 入口 + 路由挂载 + 中间件 + 优雅停机
│       ├── config/index.ts    # Zod schema + 环境变量常量
│       ├── lib/
│       │   ├── prisma.ts      # 单例 PrismaClient
│       │   └── utils.ts       # parsePagination / parseId / getErrorMessage / getErrorStatus
│       ├── middleware/
│       │   ├── auth.ts        # JWT + API Key 双重认证 + requireAdmin
│       │   └── errorHandler.ts# AppError 类 + 全局异常处理中间件（含 Prisma 错误细化）
│       ├── routes/            # auth / posts / comments / pages / bing / drive / users / devices / stats / apiKeys
│       ├── services/          # Service 层 — authService / postService / storageTunnel / storageSync / dedupDriveFiles / deviceTracker
│       └── scripts/           # 工具脚本
├── storage-node/              # 独立 WebSocket 存储节点 (Python)
│   ├── main.py                # asyncio WebSocket 客户端 + seek/.tmp 流式文件操作
│   └── config.json            # 连接配置
├── scripts/                   # 前端截图测试脚本 (Playwright)
├── docs/                      # 设计文档 & 计划
│   ├── superpowers/specs/     # 架构规范文档
│   ├── superpowers/plans/     # 实施计划
│   └── api.md                 # API 文档
├── AGENTS.md                  # Codex 指引（与本文件内容同步）
├── package.json               # Monorepo 脚本
└── .npmrc                     # registry=https://registry.npmmirror.com (中国加速)
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

## Database Schema (6 models)

- **User** — `id` / `username`(unique) / `email`(unique) / `password`(bcrypt) / `role`("user"|"admin") / `settings`(JSON string) / `canAccessDrive`(bool) / `tokenValidAfter`(JWT 失效基准)
- **Post** — `id` / `title` / `content`(HTML) / `slug`(unique) / `published` / `authorId`(FK→User)
- **Comment** — `id` / `content` / `postId`(FK→Post, CASCADE) / `authorId`(FK→User, SetNull) / `parentId`(FK→self, CASCADE) — 仅支持一级嵌套
- **Page** — `id` / `slug`(unique) / `title` / `schema`(JSON string 控件树) / `published` / `featured` / `featureEmoji` / `featureDesc`
- **DriveFile** — `id` / `name` / `isFolder` / `parentId`(FK→self) / `size`(BigInt) / `mimeType` / `storagePath`(unique) / `uploadedById`(FK→User, SetNull)
- **ApiKey** — `id` / `name` / `key`(掩码) / `keyHash`(sha256, unique) / `prefix` / `userId`(FK→User, CASCADE) / `active` / `lastUsedAt` / `expiresAt`

注意：Prisma schema 使用 `@map` / `@@map` 将字段和表名映射为 snake_case（如 `author_id` → `authorId`），数据库中实际列名是 snake_case。

## Common Commands

```bash
# 开发启动（根目录，推荐）
npm run dev                    # concurrently 同时启动前后端
npm run dev:server             # 仅后端 tsx watch → localhost:3001
npm run dev:client             # 仅前端 Vite → localhost:5173 (proxy /api → 3001)

# 或分别进入子目录
cd server && npm run dev
cd client && npx vite

# 生产构建（根目录）
npm run build                  # Vite → client/dist/

# 数据库（根目录便捷脚本，实际在 server/ 下执行）
npm run db:push                # 同步 Schema → SQLite（不要用 prisma migrate）
npm run db:seed                # 填充种子数据
npm run db:studio              # Prisma GUI

# TypeScript 检查
cd server && npx tsc --noEmit
cd client && npx tsc --noEmit

# 截图测试（需前后端已启动）
node scripts/screenshot-admin.cjs   # 管理后台移动端截图
node scripts/screenshot-posts.cjs   # 文章页截图

# 存储节点 (Windows Python)
cd storage-node && python main.py
```

## Initial Setup

```bash
# 1. 安装依赖（postinstall 自动装子目录）
npm install

# 2. 配好 server/.env
DATABASE_URL="file:./lineweb.db"
JWT_SECRET="your-secret-key"           # 生产环境必须修改
STORAGE_NODE_TOKEN=$(openssl rand -hex 32)  # 可选，本地开发可用默认值

# 3. 初始化数据库
cd server && npx prisma db push && npx prisma db seed
```

默认管理员：`admin@lineweb.dev` / `admin123`；第二个管理员 `line@lineweb.dev` / `liang798119`

环境变量说明（`server/.env`）：
- `DATABASE_URL` — 数据库连接串（SQLite 文件路径或 PostgreSQL URL）
- `JWT_SECRET` — JWT 签名密钥
- `STORAGE_NODE_TOKEN` — 存储节点认证 token（与 `storage-node/config.json` 一致）
- `MAX_FILE_SIZE_MB` — 最大上传文件大小（默认 500）
- `UPLOAD_CHUNK_KB` — 上传分块大小（默认 64）
- `DOWNLOAD_CHUNK_KB` — 下载分块大小（默认 256）
- `DRIVE_SYNC_INTERVAL_MS` — 网盘同步间隔（默认 300000 = 5 分钟）

## Important Patterns & Gotchas

### 后端
- `res.json(...)` 后必须 `return`（Express 4 无返回值检查）
- Zod 校验一律用 `.safeParse`，失败时返回 `400` + `parsed.error.flatten()`
- 路由注册顺序重要：`/featured` 必须在 `/:id` 之前；`/admin/all` 必须在 `/:slug` 之前
- `parsePagination` 和 `parseId` 位于 `server/src/lib/utils.ts`，各路由共用
- Service 层抛错用 `throw Object.assign(new Error(msg), { status: 4xx })` 或 `throw new AppError(msg, status)`
- Drive upload 使用 busboy（非 multer）流式解析，支持大文件边收边发到存储节点
- **双重认证**：JWT (`Authorization: Bearer <token>`) 和 API Key (`X-API-Key: <key>`)，认证逻辑在 `middleware/auth.ts`
- **API Key 安全**：DB 只存 sha256 哈希 + 掩码，完整 key 仅创建时返回一次
- **JWT 失效校验**：`tokenValidAfter` 字段 + 60s TTL 缓存，改密/登出时清除缓存
- **安全中间件**：Helmet (CSP/HSTS) + CORS + compression + express-rate-limit (200次/15分钟/IP)
- **设备追踪**：`services/deviceTracker.ts` 记录所有 API 请求来源，`/admin/devices` 端点查看
- **优雅停机**：SIGTERM/SIGINT → 停止接受新连接 → 断开 Prisma → 10s 超时强制退出
- `trust proxy` 设为 1（Railway 反向代理），rate-limiter 正确获取客户端 IP
- 生产环境静态资源缓存 1 年 (immutable)，HTML 不缓存；SPA fallback 兜底 `*` 路由

### 前端
- `api.get<T>(url)` / `api.post<T>(url, body)` / `api.put<T>()` / `api.delete()` — 自动注入 Bearer token，30s 超时，401 自动登出
- **代码分割**：所有页面级组件用 `React.lazy()` + `Suspense` 懒加载，减少首屏包体积
- **DownloadContext**：跨页面共享下载状态，`DownloadToast` 放在 Routes 外层不随页面卸载
- 驱动相关的组件在 `components/drive/`，页面在 `pages/DrivePage.tsx`
- `LiquidButton` 支持 `to`(React Router) / `href`(外部链接) / `onClick`(事件)；`variant` 默认为 `glass`
- 编辑器使用 Lexical（非 textarea），内容为 HTML
- Vite dev server 配置了 `/api` 代理到 localhost:3001，开发时前后端端口不同

### 数据库
- **不要用 `prisma migrate`**，直接用 `prisma db push`
- seed 失败"Unique constraint"：upsert 的 where 条件用 `username` 而非 `email`
- 数据库重置：删 `server/prisma/lineweb.db` 再 `prisma db push && prisma db seed`

### 部署 (Railway)
- 入口为根 `package.json` 的 `start` 脚本：`npm run build` → `generate-pg-schema.js` → `tsx src/index.ts`
- 环境变量 `NPM_CONFIG_REGISTRY=https://registry.npmjs.org` 覆盖 .npmrc 的中国镜像
- 存储节点需配置 `STORAGE_NODE_TOKEN` 并与 `storage-node/config.json` 的 token 一致
- 生产环境 Express 直接 serve 前端构建产物 (`client/dist/`)，同源无需 CORS
- 前端环境变量 `VITE_API_URL` 可覆盖 API 基础路径（默认 `/api`）

### 跨平台兼容 (Windows)
- Storage Node 运行在 Windows 笔记本上，Python 文件操作用 `open() + seek + read`，**不要用 `os.pread`**（POSIX-only，Windows 不存在）
- HTTP body 解析用 busboy（非 formidable）
- `.npmrc` 设了 `registry=https://registry.npmmirror.com`（中国加速），Railway 部署需覆盖为 npmjs
