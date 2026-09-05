# LineWeb — 项目知识库

**生成时间：** 2026-08-30
**提交：** 768c41b
**分支：** master

## 概述

个人网站/CMS 单体仓库，GitHub Primer 风格的纯 CSS 前端设计系统（`.gh-*` BEM，已全面改版完成）。React 19 SPA 前端，Express 4 REST API 后端，Python 3 WebSocket 文件存储节点，以及打包为 exe 的 LineWeb CLI 本地管理工具。SQLite 本地开发，PostgreSQL 生产环境。功能：文章/评论、动态页面构建器、网盘、计算器、屏幕时间追踪（数字健康卡片，含电脑使用热力图）、AI 助手、头像裁剪上传、用户名登录、PWA。

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
├── ecosystem.config.js # ⚠️ 已弃用的 PM2 配置（历史遗留，仅供宝塔面板参考，现用 Docker Compose）
├── Dockerfile        # 多阶段构建：构建 client dist → Node 22 Alpine server
├── docker-compose.yml
├── .github/workflows/ # GitHub Actions CI/CD（push master → 自动部署）
├── nginx.conf        # Nginx 反向代理配置（Docker Compose 用，引用上游 serve:3001）
└── .npmrc            # 中文 npm 镜像
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
| 部署流水线 | `.github/workflows/deploy.yml` | push master → SSH 至 `secrets.SSH_HOST`（123.207.8.77）`/home/Lineweb`；`git fetch` 失败自动重试 ×3 + 强制 HTTP/1.1；`reset --hard` → `build --no-cache --pull`（先构建不中断服务）→ `down` → `up --force-recreate`；`command_timeout: 30m`；`set -e` 任意失败立即退出 |
| 数据库结构 | `server/prisma/schema.prisma` | **10 个模型**：User、Post、Comment、Page、DriveFile、DriveFavorite、ApiKey、ScreenTimeToken、ScreenTimeLog、AiConfig；SQLite 开发，PostgreSQL Docker（自动转换） |
| 数据库连接池 | `server/src/lib/prisma.ts` | Prisma 单例；生产 PostgreSQL 自动注入 `connection_limit=10&pool_timeout=30`（`DATABASE_POOL_SIZE`/`DATABASE_POOL_TIMEOUT` 可覆盖） |
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
| 环境配置 | `server/.env`（开发）+ `.env.docker`（生产，复制为 `.env`） | `JWT_SECRET`、`DATABASE_URL`、`STORAGE_NODE_TOKEN`、`MAX_FILE_SIZE_MB` |
| Nginx 反向代理 | `nginx.conf`（Docker）+ 1Panel 面板 | 1Panel 管理外部 HTTPS 反代 → 容器 3001 端口；静态资源 `/assets/` 直连 + Brotli 压缩 |
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
生产：  Nginx /assets/ 直连静态文件 → Express 仅处理 /api + SPA fallback
Docker：Nginx → Express → PostgreSQL（运行于 1Panel/Ubuntu）
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

## 部署流程（GitHub Actions）

```
git push origin master
   → GitHub Actions SSH 至 123.207.8.77 /home/Lineweb（command_timeout 30m）
      → set -e（任意步骤失败立即退出，防止静默回退旧版本）
      → git config http.version HTTP/1.1（缓解 SSL 超时）
      → git fetch origin master 重试 ×3（失败退出）
      → git reset --hard origin/master     # 强制覆盖（.env 在 .gitignore 不受影响）
      → docker compose build --no-cache --pull  # 先构建，不中断线上服务
      → docker compose down               # 构建成功后才停旧容器
      → docker compose up -d --force-recreate  # 启动新容器
      → docker restart 1Panel-openresty（清 Nginx/OpenResty 静态缓存；失败则回退 nginx -s reload，再失败则跳过）
      → docker compose ps + logs → curl /api/health + chunk 文件验证
      → docker image prune + builder prune --filter "until=24h"  # 仅清理 24h+ 旧缓存
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
- **双数据库策略** — SQLite 开发，PostgreSQL Docker（容器启动时自动转换 schema）

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

# 部署
docker compose up -d --build   # Docker Compose（1Panel/Ubuntu 生产环境）

# 自动部署（GitHub Actions）
# git push origin master → SSH → fetch 重试+reset --hard → build --no-cache --pull →
#   down → up --force-recreate → 重启 1Panel-openresty → 验证（chunk hash + health）
# 服务器：123.207.8.77，项目路径：/home/Lineweb
```

## 注意事项

- **Server 运行时使用 tsx** — 生产环境从不编译为 JS。根目录 `npm run build` 仅构建 client（且不做类型检查）。
- **Docker 将 SQLite schema 转换为 PostgreSQL** — `docker-entrypoint.sh` 通过 Node 脚本将 `provider = "sqlite"` 改写为 `"postgresql"`，然后执行 `prisma db push`。
- **Storage node 是外部进程** — Python 进程运行在本地 Windows 机器上，未容器化。通过 WebSocket 以指数退避重连（最长 60s）方式连接到 `/ws/storage`；认证 5s 超时、心跳 30s。运行期间通过 `SetThreadExecutionState` 阻止系统休眠；文件 I/O 走线程池避免阻塞事件循环。
- **LineWeb CLI** — `cli/` 子项目打包为单文件 exe，双击即交互式管理本地服务（setup/start/stop/restart/status/update/logs/token）；`start` 默认生产模式；`autoupdate` 通过 Windows S4U 计划任务无人值守拉取更新；构建依赖 pkg 的 node22 基础二进制（缓存于 `~/.pkg-cache/v3.6`，丢失时需通过镜像下载）。
- **中文友好默认配置** — `.npmrc` 设置 npmmirror.com 镜像；文档使用中文。
- **部署强制覆盖** — 使用 `git reset --hard origin/master` 而非 `git pull`，避免服务器本地改动导致合并冲突。
- **Docker 重建顺序** — 先 `build --no-cache --pull` 再 `down`，确保构建失败时旧容器继续运行不中断服务；`set -e` 确保任何步骤失败时脚本立即退出，避免静默回退旧版本。
- **Server 无测试** — `server/` 中零测试基础设施。Playwright 是 client 依赖但无配置或测试。
- **认证中间件跳过 12 个路径**：`/auth/login`、`/auth/register`、`/auth/avatar`、`/health`、`/health/push`、`/posts`、`/pages/featured`、`/pages/slug`、`/stats/public`、`/version`、`/comments/post`、`/ai/chat`。白名单匹配用 `req.path === p || req.path.startsWith(p + '/')`（`req.path` 不含 `/api` 前缀），因此 `/ai/chat` 也覆盖 `/ai/chat/public`。
- **认证 API 禁缓存** — 除公开路径外，全局认证中间件设置 `Cache-Control: no-store` 并清空 ETag，避免 304 导致旧数据。
- **新增公开端点必须同步两处** — `index.ts` 的 `publicApiPaths` 白名单 + `cachePublic` 缓存策略。
- **`/api` 自描述端点** — `GET /api` 返回全部路由清单（需认证），排查路由问题时先看这里。
- **前端 Provider 顺序** — `BrowserRouter → QueryClient → Auth → Theme → Download → RouteErrorBoundary → Suspense → Routes`；`DownloadToast` 在 Routes 外，下载进度跨页面保留。
