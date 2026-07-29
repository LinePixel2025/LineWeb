# LineWeb — 项目知识库

**生成时间：** 2026-07-16
**提交：** 17057eb
**分支：** master

## 概述

个人网站/CMS 单体仓库，采用 GitHub Primer 风格的纯 CSS 前端设计系统。React 19 SPA 前端，Express 4 REST API 后端，Python 3 WebSocket 文件存储节点。SQLite 本地开发，PostgreSQL 生产环境。

## 目录结构

```
lineweb/
├── client/           # React 19 + Vite 6 SPA → 开发端口 5173，生产从 dist/ 提供
├── server/           # Express 4 + Prisma 6 API → 端口 3001，tsx 运行时，.js 导入后缀
├── storage-node/     # Python 3 WebSocket 文件存储客户端（5 个文件）→ D:/LineWebDrive，仅本地
├── scripts/          # 14 个运维脚本（部署、开发启动/停止、webhook、截图）
├── docs/             # API 参考、Drive 部署指南和项目设计文档
├── .omo/             # OpenCode 会话续传数据
├── .trae/            # Trae IDE 配置、项目规则
├── .superpowers/     # SDD 任务产物
├── .codegraph/       # 代码图谱分析数据库
├── .agents/          # 代理技能定义（pdf）
│
├── package.json      # 单体仓库根 — concurrently 编排 client + server
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
| `server/` | ✅ | 中间件链、13 个路由、9 个服务、认证流程、反模式 |
| `storage-node/` | ✅ | WebSocket 协议、9 个命令、安全、配置 |

## 哪里找

| 跨模块关注点 | 位置 | 说明 |
|----------------------|----------|-------|
| 单体仓库编排 | `package.json` | `concurrently` 同时运行前后端；`postinstall` 级联安装子目录依赖 |
| 部署流水线 | `Dockerfile` + `docker-compose.yml` + `.github/workflows/deploy.yml` | GitHub Actions SSH 到 123.207.8.77 自动部署（git reset --hard → build --no-cache → down → up --force-recreate + Nginx 缓存刷新；`set -e` 使构建失败时立即停止，不会静默回退旧版本） |
| 数据库结构 | `server/prisma/schema.prisma` | 9 个模型；SQLite 开发，PostgreSQL Docker（自动转换） |
| 数据库连接池 | `server/src/lib/prisma.ts` | 生产 PostgreSQL 自动注入 `connection_limit=10&pool_timeout=30`（环境变量 `DATABASE_POOL_SIZE`/`DATABASE_POOL_TIMEOUT` 可覆盖） |
| 认证（JWT + API Key） | `server/src/middleware/auth.ts` | 双认证 + ?token= 查询参数；11 个公开路径在 `index.ts` 中白名单 |
| 屏幕时间认证 | `server/src/middleware/screenTimeAuth.ts` | `X-Screen-Time-Token` 头单独认证，用于 `/api/health/push` |
| 存储架构 | `server/src/services/storageTunnel.ts` ↔ `storage-node/main.py` | WebSocket 隧道；服务器代理命令到 Python 节点 |
| 全文搜索 | `server/src/services/ftsSearch.ts` | SQLite FTS5 全文索引，启动时 `ensureFTSTable` |
| React Query 层 | `client/src/hooks/useQueries.ts` + `queryKeys.ts` | 公开页面已使用，管理页面仍手写 `useState+useEffect` |
| 设计系统 | `client/src/styles/variables.css` + `client/src/styles/*.css` | GitHub Primer 风格的 CSS 变量和组件样式 |
| 环境配置 | `server/.env`（开发）+ `.env.docker`（生产） | `JWT_SECRET`、`DATABASE_URL`、`STORAGE_NODE_TOKEN` |
| Nginx 反向代理 | `nginx.conf`（Docker）+ 1Panel 面板 | 1Panel 管理外部 HTTPS 反代 → 容器 3001 端口；静态资源 `/assets/` 直连 + Brotli 压缩 |
| 字体加载 | `client/src/main.tsx` + `client/index.html` | @fontsource/instrument-serif 异步加载（requestIdleCallback）；woff2 preload |
| API 缓存策略 | `server/src/index.ts` cachePublic 中间件 | 公开端点 Cache-Control（posts/pages/comments 5min，bing 10min，stats 1min） |

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
  ├── helmet(CSP) → cors → compression
  ├── body parser 限定 /api（避免静态文件请求触发解析）
  ├── rate-limit(600/15min) → 设备追踪 → 全局认证检查
  ├── cachePublic 中间件 → 13 个路由组挂载于 /api/*
  ├── [生产] express.static(client/dist) + SPA fallback
  └── errorHandler

监听后：
  ├── http.createServer → WebSocket 隧道路由 /ws/storage
  ├── 网盘同步定时器（每 5 分钟）
  ├── 启动延迟（10s）：去重 + 初始同步
  └── 设备追踪清理（30 分钟不活跃超时）
```

## 性能优化（2026-07-16）

### 网络层
| 优化 | 文件 | 说明 |
|------|------|------|
| Nginx 直连静态文件 | `nginx.conf` | `location /assets/` 绕过 Express 中间件链，expires 1y + immutable |
| Brotli 压缩 | `nginx.conf` | `brotli on` + `brotli_static on`（比 gzip 小 20-30%） |
| Gzip 扩展 | `nginx.conf` | 新增 woff2/ttf/wasm 类型；gzip_vary on |
| upstream keepalive | `nginx.conf` | `keepalive 32` 减少 TCP 握手 |

### 服务端
| 优化 | 文件 | 说明 |
|------|------|------|
| Body-parser 限定 /api | `server/src/index.ts:73-75` | `express.json/urlencoded` 仅对 `/api` 路径，静态文件不再浪费解析 |
| 公开 API 缓存头 | `server/src/index.ts:105-111` | `cachePublic(maxAge)` 中间件；posts/pages/comments 5min，bing 10min，stats 1min |
| 数据库连接池 | `server/src/lib/prisma.ts` | 生产 PostgreSQL 自动追加 `connection_limit=10&pool_timeout=30` |
| bcrypt 降成本 | `server/src/services/authService.ts:54` | `bcrypt.hash(password, 12)` → `10`（~300ms → ~100ms，仍足够安全） |
| N+1 去重修复 | `server/src/routes/drive.ts:413-435` | 上传去重从循环 `findFirst`（最多 99 次）改为单次 `findMany` + 内存集合匹配 |

### 前端
| 优化 | 文件 | 说明 |
|------|------|------|
| 字体异步加载 | `client/src/main.tsx:8-19` | @fontsource 动态 import + requestIdleCallback，不阻塞首屏渲染 |
| 字体预加载 | `client/index.html:14-16` | `<link rel="preload">` woff2 字体文件 |
| React Query 独立 chunk | `client/vite.config.ts:30-32` | `@tanstack/react-query` 拆分为 `query-xxx.js` |

### 容器 / CI
| 优化 | 文件 | 说明 |
|------|------|------|
| Docker 资源限制 | `docker-compose.yml` | cpus: 2 / memory: 512M；reservations 0.5 / 256M |
| 健康检查 | `docker-compose.yml` | 30s 间隔 GET /api/health，3 次失败自动重启 |
| 日志限制 | `docker-compose.yml` | json-file + max-size 10m + max-file 3 |
| CI 精准清理 | `.github/workflows/deploy.yml` | `docker image/builder prune --filter "until=24h"` 替代 `docker system prune -f` |
| 强制部署 | `.github/workflows/deploy.yml` | `git fetch + reset --hard` + `docker compose down` + `--force-recreate` |

## 部署流程（GitHub Actions）

```
git push origin master
   → GitHub Actions SSH 至 123.207.8.77
      → cd /home/Lineweb
      → set -e（任意步骤失败立即退出，防止静默回退旧版本）
      → git fetch origin master
      → git reset --hard origin/master     # 强制覆盖（.env 在 .gitignore 不受影响）
      → docker compose build --no-cache --pull  # 先构建，不中断线上服务
      → docker compose down               # 构建成功后才停旧容器
      → docker compose up -d --force-recreate  # 启动新容器
      → Nginx 缓存刷新 + 健康检查
      → docker compose ps + logs          # 输出状态确认
      → docker image/builder prune --filter "until=24h"  # 仅清理 24h+ 旧缓存
```

## 约定

### 沟通

- **项目文档、注释、AI 交互均使用中文**

### TypeScript

- 前后端均 `strict: true`
- 前端 `noUnusedLocals: false`、`noUnusedParameters: false` — 死代码不被检测
- 前后端均 `skipLibCheck: true` — 跳过 .d.ts 类型检查
- 前端：`@/*` 别名 → `src/*`（已配置但很少使用；大部分使用相对导入）
- 后端：ESM 配合 .js 后缀（`import x from './routes/auth.js'`，尽管源文件是 .ts）

### CSS

- **纯 CSS** — 无 Tailwind、无 CSS 模块、无 CSS-in-JS
- 命名空间 BEM：`.gh-*`（设计系统）、`.drive-*`、`.admin-*`、`.lex-*`（编辑器）
- 状态修饰符：`--active`、`--selected`、`--collapsed`
- 主题属性：`[data-theme="dark"]`

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
- **CI/CD** — GitHub Actions（`.github/workflows/deploy.yml`），push master → SSH 自动部署至 123.207.8.77
- **根目录无 `npm test`** — 仅在 `client/` 中有测试；server 零测试
- **不使用 `prisma migrate`** — 约定仅使用 `prisma db push`
- **测试约定**：源文件旁 `__tests__/` 目录、`.test.{ts,tsx}` 命名、`vi.mock()`（无 MSW）

## 反模式（项目全局）

### TypeScript

- **`req.user!.userId`**（后端 36 处）— 非空断言；应使用声明合并
- **`as any`**（1 处）、**`: any`**（2 处）、**`as unknown as X`**（10 处）— 散落的类型绕过
- **`@/` 别名未普及** — 已配置但仅 2 个文件使用

### 错误处理

- **`.catch(() => {})`**（12 处）— Promise 拒绝被忽略，主要集中 storageTunnel/drive/routes 中
- **错误传播不一致** — 部分路由委托给 `errorHandler`，部分内联 `res.status(500)`

### 代码质量

- **死代码**：`client/.../DriveSidebar.tsx` 和 `DriveContextMenu.tsx` 已删除；`server/src/lib/errorHandler.ts` 未使用（实际用 `middleware/errorHandler.ts`）
- **超大文件**：`drive.ts`（833 行）、`PageEditor.tsx`（733 行）、`DrivePage.tsx`（588 行）、`globals.css`（~2000+ 行）
- **跨模块耦合**：`users.ts` 从 `drive.ts` 导入 `clearDriveAccessCache`
- **服务层不一致**：部分路由使用 service 层（auth、posts、avatar），其他直接调用 Prisma（comments、pages、stats、apiKeys）
- **React Query 层已使用** — `QueryClientProvider` 在 App.tsx 中配置，公开页面通过 `useQueries.ts` 使用 React Query，管理页面仍手写 `useState+useEffect`

### 数据库

- **无迁移** — 仅使用 `prisma db push`；无回滚能力
- **`$queryRawUnsafe`**（2 处）— 去重脚本中的原始 SQL（已参数化，但绕过了类型安全）
- **双数据库策略** — SQLite 开发，PostgreSQL Docker（容器启动时自动转换 schema）
- **连接池未显式配置** — 生产 PostgreSQL 通过 `prisma.ts` 注入 `connection_limit=10&pool_timeout=30`

### 安全

- **明文 token** 存储于 `storage-node/config.json`
- **JWT 存于 localStorage** — 标准 SPA 模式，存在 XSS 风险

## 命令

```bash
# 开发
npm run dev              # concurrently：server (3001) + client (5173)
npm run dev:server       # tsx watch server/src/index.ts
npm run dev:client       # vite（端口 5173，代理 /api → :3001）

# 构建 & 生产
npm run build            # 仅 vite 构建 client（跳过 tsc 类型检查，server 通过 tsx 运行从不编译）
npm run start            # 构建 client → 生成 PG schema → tsx server/src/index.ts

# 数据库
npm run db:push          # prisma db push（SQLite 开发）
npm run db:seed          # 种子数据 admin@lineweb.dev / admin123
npm run db:studio        # prisma studio

# 测试（仅 client/）
cd client && npm run test        # vitest run（14 个测试文件）
cd client && npm run test:watch  # vitest watch

# Storage Node（本地机器）
cd storage-node && python main.py

# 部署
docker compose up -d --build   # Docker Compose（1Panel/Ubuntu 生产环境）

# 自动部署（GitHub Actions）
# git push origin master → GitHub Actions SSH →
#   git fetch + reset --hard → docker compose down →
#   docker compose build --no-cache --pull →
#   docker compose up -d --force-recreate →
#   Nginx 缓存刷新 → 部署验证（chunk hash + health）
# 服务器：123.207.8.77，项目路径：/home/Lineweb
```

## 注意事项

- **Server 运行时使用 tsx** — 生产环境从不编译为 JS。根目录 `npm run build` 仅构建 client。
- **Docker 将 SQLite schema 转换为 PostgreSQL** — `docker-entrypoint.sh` 通过 Node 脚本将 `provider = "sqlite"` 改写为 `"postgresql"`，然后执行 `prisma db push`。
- **Storage node 是外部进程** — Python 进程运行在本地 Windows 机器上，未容器化。通过 WebSocket 以指数退避重连方式连接到 `/ws/storage`。
- **中文友好默认配置** — `.npmrc` 设置 npmmirror.com 镜像；文档使用中文。
- **部署强制覆盖** — 使用 `git reset --hard origin/master` 而非 `git pull`，避免服务器本地改动导致合并冲突。
- **Docker 重建顺序** — 先 `build --no-cache --pull` 再 `down`，确保构建失败时旧容器继续运行不中断服务；`set -e` 确保任何步骤失败时脚本立即退出，避免静默回退旧版本。
- **构建缓存保留** — `image/builder prune --filter "until=24h"` 保留 24h 内构建层缓存加速后续部署。
- **部署目标**：123.207.8.77，路径 `/home/Lineweb`，Docker 容器由 1Panel 面板管理。
- **Server 无测试** — `server/` 中零测试基础设施。Playwright 是依赖但无配置或测试。
- **CSS 是单体的** — 所有样式从 `globals.css`（~2000+ 行）级联。无作用域机制。
- **认证中间件跳过 11 个路径**：`/auth/login`、`/auth/register`、`/health`、`/health/push`、`/posts`、`/pages/featured`、`/pages/slug`、`/bing-wallpaper`、`/stats/public`、`/version`、`/comments/post`。
- **字体异步加载** — `@fontsource/instrument-serif` 在首屏渲染后通过 `requestIdleCallback` 异步加载，`index.html` 中有 woff2 preload 标签提前下载。
