# LineWeb — 项目知识库

**生成时间：** 2026-08-30
**提交：** 768c41b
**分支：** master

## 概述

个人网站/CMS 单体仓库，GitHub Primer 风格的纯 CSS 前端设计系统（`.gh-*` BEM，已全面改版完成）。React 19 SPA 前端，Express 4 REST API 后端，Python 3 WebSocket 文件存储节点，以及打包为 exe 的 LineWeb CLI 本地管理工具。SQLite 本地开发与运行（生产即本地 Windows 服务器）。功能：文章/评论、动态页面构建器、网盘、计算器、屏幕时间追踪（数字健康卡片，含电脑使用热力图）、AI 助手、头像裁剪上传、用户名登录、PWA。**部署：本地 Windows 服务器运行 + Cloudflare Tunnel 内网穿透；Railway / 云服务器（Docker+Nginx）部署已全部废除。**

## 目录结构

```
lineweb/
├── client/           # React 19 + Vite 6 SPA → 开发端口 5173，生产从 dist/ 提供
├── server/           # Express 4 + Prisma 6 API → 端口 3001，tsx 运行时，.js 导入后缀
├── storage-node/     # Python 3 WebSocket 文件存储客户端（10 个命令）→ D:/LineWebDrive，仅本地
├── cli/              # LineWeb CLI 本地管理工具（TS + esbuild + pkg → LineWebCLI.exe，v2.1.0）
├── scripts/          # 14 个运维脚本（部署、开发启动/停止、webhook、截图、屏幕时间推送）
├── docs/             # API 参考、Drive 部署指南、屏幕时间 API 指南、健康系统 API 指南、HTTP 直连部署指南
├── .omo/             # OpenCode 会话续传数据
├── .trae/            # Trae IDE 配置、项目规则
├── .superpowers/     # SDD 任务产物
├── .codegraph/       # 代码图谱分析数据库
├── .agents/          # 代理技能定义（pdf）
├── .lineweb-cli/     # CLI 运行时数据（已 gitignore）
│
├── package.json      # 单体仓库根 — concurrently 编排 client + server；build:cli 构建 CLI
├── CLAUDE.md         # 用户维护的 Claude Code 指令文件（已 gitignore，与 AGENTS.md 并存）
├── ecosystem.config.js # ⚠️ 已废弃的 PM2 配置（历史遗留，宝塔面板/云服务器部署存档）
├── Dockerfile        # ⚠️ 已废弃：Docker 镜像构建（云服务器部署存档）
├── docker-compose.yml # ⚠️ 已废弃：容器编排（云服务器部署存档）
├── nginx.conf        # ⚠️ 已废弃：Nginx 反向代理配置（云服务器部署存档）
└── .npmrc            # 中文 npm 镜像

> `.github/workflows/deploy.yml`（云服务器自动部署）已删除；`.github/` 目录仅剩默认配置。
```

### 子项目 AGENTS.md

| 目录 | AGENTS.md | 覆盖内容 |
|-----------|-----------|----------|
| `client/` | ✅ | 路由、Context、网盘模块、数据获取、测试、反模式 |
| `server/` | ✅ | 中间件链、路由、服务、认证流程、反模式 |
| `storage-node/` | ✅ | WebSocket 协议、10 个命令、安全、配置 |
| `cli/` | ❌（有 `cli/README.md`） | setup/start/stop/restart/status/update/logs/token 命令、autoupdate（S4U）、pkg 构建 |

> 注意：子项目 AGENTS.md 部分内容已过期（如 server 仍提 bing.ts、client 仍提 WallpaperContext），以本文件为准。

## 哪里找

| 跨模块关注点 | 位置 | 说明 |
|----------------------|----------|-------|
| 单体仓库编排 | `package.json` | `concurrently` 同时运行前后端；`postinstall` 级联安装子目录依赖 |
| 部署方式 | 本地 Windows + Cloudflare Tunnel | 服务运行在本机（Express :3001 + 存储节点），`cloudflared tunnel run` 将本地端口映射为公网 HTTPS 域名；无公网 IP 要求；代码更新走本地 CLI `update`（`git reset --hard`）；Railway / 云服务器（Docker+Nginx+GitHub Actions）已废弃，`.github/workflows/deploy.yml` 已删除 |
| 数据库结构 | `server/prisma/schema.prisma` | **10 个模型**：User、Post、Comment、Page、DriveFile、DriveFavorite、ApiKey、ScreenTimeToken、ScreenTimeLog、AiConfig；SQLite（本地开发与运行，生产即本地） |
| 数据库连接池 | `server/src/lib/prisma.ts` | Prisma 单例；仅旧 PostgreSQL 部署会注入 `connection_limit=10&pool_timeout=30`（已废弃，SQLite 单机无池） |
| 认证（JWT + API Key） | `server/src/middleware/auth.ts` | 双认证 + `?token=` 查询参数；**12 个公开路径**在 `index.ts` 白名单；新增公开端点必须同步改白名单；另有 `optionalAuthenticate`（有 token 则解析、无则匿名放行，用于 AI chat） |
| 登录/个人资料 | `server/src/routes/auth.ts` | 登录支持 `identifier`（用户名或邮箱，兼容 email）；`PUT /auth/profile` 修改用户名（唯一性校验）/密码（验证当前密码，改密后旧 token 全失效并重签） |
| 屏幕时间认证 | `server/src/middleware/screenTimeAuth.ts` | `X-Screen-Time-Token` 头单独认证，用于 `/api/health/push` |
| AI 助手 | `server/src/routes/ai.ts` + `services/aiService.ts` | OpenAI SDK + 兼容 baseUrl；`AiConfig` 单行表存 key（脱敏显示）；**`/api/ai/chat` 公开（POST）但走 `optionalAuthenticate`**——登录用户额外注入站点统计、最近评论、全部已发布页面、按需检索文章正文（≤2 篇×1500 字）、近 14 天屏幕时间；`/chat/public` GET 取站点内容；管理端 `/admin/ai` 配置；chat() 错误统一 `AppError` |
| 存储架构 | `server/src/services/storageTunnel.ts` ↔ `storage-node/main.py` | WebSocket 隧道；服务器代理命令到 Python 节点；节点 10 命令（7 个 HANDLERS + 流式 read/write/eof）、阻塞 I/O 线程池化、运行期间 `SetThreadExecutionState` 阻止 Windows 休眠 |
| 头像服务 | `server/src/services/avatarService.ts` | sharp 处理 + 存储节点读写；`GET /api/auth/avatar/:userId` 公开（头像可匿名访问） |
| 全文搜索 | `server/src/services/ftsSearch.ts` | SQLite FTS5 全文索引，启动时 `ensureFTSTable` |
| React Query 层 | `client/src/hooks/useQueries.ts` + `lib/queryKeys.ts` | 公开页面已使用（staleTime 5min、retry 1、不随窗口聚焦刷新），管理页面仍手写 `useState+useEffect` |
| 设计系统 | `client/src/styles/`（9 个 CSS 文件，含 `ai.css`） | `globals.css` 仅 import 聚合器；`drive.css` 最大（约 2900 行）；无 Tailwind、无 CSS-in-JS |
| 本地管理 CLI | `cli/src/`（commands/autoupdate/processes/ui） | `setup` 新机器一键安装、`start` 默认生产模式、`update` GitHub 拉取（镜像降级）、`token` 查询存储节点 Key、`autoupdate` S4U 计划任务无人值守更新；构建 `npm run build:cli` → `cli/dist/LineWebCLI.exe` |
| PWA | `client/index.html` + `client/public/manifest.json` | theme-color、apple-touch-icon、manifest 已配置 |
| 环境配置 | `server/.env` | `JWT_SECRET`、`DATABASE_URL`（`file:./lineweb.db`）、`STORAGE_NODE_TOKEN`、`MAX_FILE_SIZE_MB`；`.env.docker` 已随云服务器部署废弃 |
| 内网穿透 | `cloudflared`（Cloudflare Tunnel） | `cloudflared tunnel run <name>` 将本地 :3001 映射为公网 HTTPS 域名，原生支持 WebSocket；无公网 IP 要求；与原 Docker/Nginx（nginx.conf + 1Panel 反代）完全无关 |
| API 缓存策略 | `server/src/index.ts` cachePublic 中间件 | posts/pages/comments 5min、stats 1min；**bing 壁纸已移除** |

## 架构

```
┌──────────────┐     HTTP/API      ┌──────────────────┐     WebSocket     ┌──────────────────┐
│  浏览器        │ ◄──────────────► │  Express Server   │ ◄──────────────► │  Storage Node    │
│  (React SPA)  │    端口 3001     │  (tsx/Node)       │   /ws/storage    │  (Python)        │
│               │                  │  + Prisma ↔ SQLite │                  │  D:/LineWebDrive  │
└──────────────┘                  │  + WebSocket WSS   │                  └──────────────────┘
                                   └──────────────────┘

开发：  Vite :5173 → 代理 /api → Express :3001
生产：  Express 本地 :3001，直接提供 client/dist（静态资源 + SPA fallback）
公网：  Cloudflare Tunnel（cloudflared）→ HTTPS 域名 → 本地 :3001（含 WebSocket）
```

### 启动流程

```
server.listen(3001)
  ├── helmet(CSP) → cors → compression（跳过 /proxy、/download）
  ├── body parser 限定 /api（1mb，避免静态文件请求触发解析）
  ├── rate-limit(600/15min，代码注释里的 200 是过期的) → 设备追踪 → 全局认证检查
  ├── cachePublic 中间件 → 13 个路由组挂载于 /api/*
  ├── [生产] express.static(client/dist, maxAge 1y+immutable, HTML 不缓存) + SPA fallback
  └── errorHandler

监听后：
  ├── http.createServer → WebSocket 隧道路由 /ws/storage
  ├── 网盘同步定时器（每 5 分钟，unref）
  ├── 启动延迟（10s）：去重 + 初始同步
  └── 设备追踪清理（30 分钟不活跃超时）
```

## 部署流程（本地 Windows + Cloudflare Tunnel）

```
本地 Windows 服务器：
  1. npm run build                 # 构建前端 → client/dist
  2. NODE_ENV=production tsx src/index.ts   # Express :3001（SQLite + client/dist + /api）
  3. python storage-node/main.py   # 存储节点（D:/LineWebDrive）
  4. 管理：LineWebCLI.exe start/stop/status/update | autoupdate（S4U 计划任务）

公网暴露（无需公网 IP）：
  cloudflared tunnel run <tunnel-name>
     → Cloudflare 边缘 → HTTPS 域名 → http://127.0.0.1:3001（WebSocket 原生支持）

代码更新（本地执行，不走 CI）：
  LineWebCLI.exe update --yes   # git reset --hard origin/master → 重装依赖 → db push → 自动重启
```

## 约定

### 沟通

- **项目文档、注释、AI 交互均使用中文**

### TypeScript

- 前后端均 `strict: true`
- 前端 `noUnusedLocals: false`、`noUnusedParameters: false` — 死代码不被检测
- 前后端均 `skipLibCheck: true`
- 前端：`@/*` 别名 → `src/*`（已配置但很少使用；大部分使用相对导入）
- 后端：ESM 配合 .js 后缀（`import x from './routes/auth.js'`，尽管源文件是 .ts）
- **根 `npm run build` 只跑 vite、不跑 tsc** — 类型检查需单独 `cd client && npx tsc --noEmit`（client 内 `npm run build` 才包含 `tsc -b`）

### CSS

- **纯 CSS** — 无 Tailwind、无 CSS 模块、无 CSS-in-JS
- 命名空间 BEM：`.gh-*`（设计系统）、`.drive-*`（网盘）、`.admin-*`、`.lex-*`（编辑器）
- 状态修饰符：`--active`、`--selected`、`--collapsed`
- 主题属性：`[data-theme="dark"]`
- 字体为 GitHub 系统字体栈 `--gh-font` / `--gh-font-mono`（variables.css）

### 命名

| 分类 | 约定 | 示例 |
|----------|-----------|---------|
| React 组件 | PascalCase，默认导出 | `Navbar.tsx` |
| 页面 | PascalCase，懒加载 | `HomePage.tsx` |
| Context | PascalCase + Context 后缀 | `AuthContext.tsx` |
| Hooks | `use` 前缀，camelCase | `useThumbnails.ts` |
| 后端路由 | 复数，每个域一个文件 | `routes/auth.ts` |
| 后端服务 | 域名 + Service 后缀 | `services/authService.ts` |
| 数据库模型 | PascalCase 单数 → snake_case 表名（@map） | `DriveFile` → `drive_files` |
| CSS 类名 | kebab-case，模块命名空间 | `.drive-grid-card--selected` |

### 工具链缺失（值得注意）

- **无 ESLint、Prettier、Biome 或 EditorConfig** — 代码格式未强制执行
- **根目录无 `npm test`** — 仅在 `client/` 中有测试（17 个文件，7 个 `__tests__/` 目录）；server 零测试
- **不使用 `prisma migrate`** — 约定仅使用 `prisma db push`（根 `db:migrate` 脚本存在但 `prisma/migrations/` 目录不存在，属备用入口）
- **测试约定**：源文件旁 `__tests__/` 目录、`.test.{ts,tsx}` 命名、`vi.mock()`（无 MSW）
- **验证期望**（源自 CLAUDE.md）：前端改动至少跑 `npx tsc --noEmit` + `vite build`；涉及认证、数据库、网盘上传下载、存储 WebSocket 或权限的服务端改动，需启动服务做 API 或浏览器手动验证

## 反模式（项目全局）

### TypeScript

- **`req.user!.userId`**（41 处）— 非空断言；应使用声明合并
- **`as any` / `: any`**（4 处）— 散落的类型绕过
- **`@/` 别名未普及** — 仅少数文件使用

### 错误处理

- **`.catch(() => {})`**（11 处）— Promise 拒绝被忽略，主要集中 storageTunnel/drive/routes 中
- **错误传播不一致** — 部分路由委托给 `errorHandler`（posts/pages 已用 asyncHandler），部分内联 `res.status(500)`

### 代码质量

- **死依赖**：`@fontsource/instrument-serif` 仍在 package.json 但客户端无任何 import（字体已改系统字体栈）
- **超大文件**：`drive.ts`（约 1080 行）、`drive.css`（约 2900 行）、`PageEditor.tsx`（约 810 行，位于 `client/src/pages/admin/`）
- **跨模块耦合**：`users.ts` 从 `drive.ts` 导入 `clearDriveAccessCache`
- **服务层不一致**：部分路由使用 service 层（auth、posts、avatar、ai），其他直接调用 Prisma（comments、pages、stats、apiKeys、driveFavorites）
- **React Query 层已使用** — `QueryClientProvider` 在 App.tsx 中配置，公开页面通过 `useQueries.ts` 使用 React Query，管理页面仍手写 `useState+useEffect`
- **顶部导航快捷方式已移除** — 导航统一由侧边栏提供；首页站点统计移至右侧侧边栏，AI 助手在首页

### 数据库

- **无迁移** — 仅使用 `prisma db push`；无回滚能力
- **`$queryRawUnsafe`**（3 处）— 去重脚本中的原始 SQL（已参数化，但绕过了类型安全）
- **单数据库策略** — 本地运行统一 SQLite（开发与生产一致）；PostgreSQL 转换脚本（`generate-pg-schema.js`、`docker-entrypoint.sh`）仅为已废弃的云服务器部署保留

### 安全

- **明文 token** 存储于 `storage-node/config.json`
- **JWT 存于 localStorage** — 标准 SPA 模式，存在 XSS 风险
- **AI chat 接口公开** — `/api/ai/chat` 匿名可调（走 `optionalAuthenticate`，登录用户获额外上下文），消耗 API key 配额，滥用风险

## 命令

```bash
# 开发
npm run dev              # concurrently：server (3001) + client (5173)
npm run dev:server       # tsx watch server/src/index.ts
npm run dev:client       # vite（端口 5173，代理 /api → :3001）

# 构建 & 类型检查
npm run build            # 仅 vite 构建 client（跳过 tsc！类型检查需 cd client && npx tsc --noEmit）
cd client && npm run build   # tsc -b && vite build（含类型检查）
npm run start            # 构建 client → generate-pg-schema.js → NODE_ENV=production tsx server/src/index.ts
npm run build:cli        # 构建 cli/dist/LineWebCLI.exe（esbuild + pkg node22 基础二进制，缓存在 ~/.pkg-cache/v3.6）

# 数据库
npm run db:push          # prisma db push（SQLite 开发）
npm run db:migrate       # prisma migrate dev（备用入口，约定仍用 db push，无 migrations 目录）
npm run db:seed          # 种子数据：admin@lineweb.dev / admin123 + line@lineweb.dev / liang798119（两个 admin）
npm run db:studio        # prisma studio

# 测试（仅 client/）
cd client && npm run test        # vitest run（17 个测试文件）
cd client && npm run test:watch  # vitest watch
cd client && npx vitest run src/components/drive/__tests__/PathBar.test.tsx  # 单文件测试

# Storage Node（本地机器）
cd storage-node && python main.py   # token 需与 server/.env 的 STORAGE_NODE_TOKEN 一致（或环境变量 LINEWEB_STORAGE_TOKEN）；可用 `cli token` 查询

# LineWeb CLI（本地机器，管理整套服务）
cd cli && npm run dev             # tsx 运行
cd cli && npm run typecheck       # tsc --noEmit

# 部署（本地 Windows + Cloudflare Tunnel）
npm run build                                  # 构建前端 → client/dist
cd server && NODE_ENV=production npx tsx src/index.ts   # 生产模式 :3001
cd storage-node && python main.py              # 存储节点
cloudflared tunnel run <tunnel-name>           # 公网暴露（可选；临时可用 --url http://localhost:3001）
LineWebCLI.exe update --yes                    # 代码更新（git reset --hard，同旧 CI 策略）

# 已废弃（旧云服务器部署，存档）：docker compose 等 docker:* 脚本
#   原 GitHub Actions SSH 自动部署 workflow（.github/workflows/deploy.yml）已删除
```

## 注意事项

- **Server 运行时使用 tsx** — 生产环境从不编译为 JS。根目录 `npm run build` 仅构建 client（且不做类型检查）。
- **Docker schema 转换已废弃** — 原 `docker-entrypoint.sh` 将 SQLite schema 改写为 PostgreSQL 后 `prisma db push` 的机制随云服务器部署废除；本地统一 SQLite，无需转换脚本。
- **Storage node 是外部进程** — Python 进程运行在本地 Windows 机器上，未容器化。通过 WebSocket 以指数退避重连（最长 60s）方式连接到 `/ws/storage`；认证 5s 超时、心跳 30s。运行期间通过 `SetThreadExecutionState` 阻止系统休眠；文件 I/O 走线程池避免阻塞事件循环。
- **LineWeb CLI** — `cli/` 子项目打包为单文件 exe，双击即交互式管理本地服务（setup/start/stop/restart/status/update/logs/token）；`start` 默认生产模式；`autoupdate` 通过 Windows S4U 计划任务无人值守拉取更新；构建依赖 pkg 的 node22 基础二进制（缓存于 `~/.pkg-cache/v3.6`，丢失时需通过镜像下载）。
- **中文友好默认配置** — `.npmrc` 设置 npmmirror.com 镜像；文档使用中文。
- **更新强制覆盖** — CLI `update` 使用 `git reset --hard origin/master` 而非 `git pull`，避免本地改动导致更新冲突；未跟踪文件（`server/.env` 等）不受影响。
- **Cloudflare Tunnel 特点** — 隧道进程运行在本地 Windows，公网流量经 Cloudflare 边缘进入 `127.0.0.1:3001`（无需公网 IP/端口映射）；原生支持 WebSocket（网盘存储隧道、AI 流式响应均可用）；隧道中断不影响本地服务与 CLI 管理。
- **Server 无测试** — `server/` 中零测试基础设施。Playwright 是 client 依赖但无配置或测试。
- **认证中间件跳过 12 个路径**：`/auth/login`、`/auth/register`、`/auth/avatar`、`/health`、`/health/push`、`/posts`、`/pages/featured`、`/pages/slug`、`/stats/public`、`/version`、`/comments/post`、`/ai/chat`。白名单匹配用 `req.path === p || req.path.startsWith(p + '/')`（`req.path` 不含 `/api` 前缀），因此 `/ai/chat` 也覆盖 `/ai/chat/public`。
- **认证 API 禁缓存** — 除公开路径外，全局认证中间件设置 `Cache-Control: no-store` 并清空 ETag，避免 304 导致旧数据。
- **新增公开端点必须同步两处** — `index.ts` 的 `publicApiPaths` 白名单 + `cachePublic` 缓存策略。
- **`/api` 自描述端点** — `GET /api` 返回全部路由清单（需认证），排查路由问题时先看这里。
- **前端 Provider 顺序** — `BrowserRouter → QueryClient → Auth → Theme → Download → RouteErrorBoundary → Suspense → Routes`；`DownloadToast` 在 Routes 外，下载进度跨页面保留。
