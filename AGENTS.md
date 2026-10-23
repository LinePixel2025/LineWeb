# LineWeb — 项目知识库

**生成时间：** 2026-10-17
**提交：** 660f492
**分支：** master

## 概述

个人网站/CMS 单体仓库，GitHub Primer 风格的纯 CSS 前端设计系统（`.gh-*` BEM，已全面改版完成）。React 19 SPA 前端，Express 4 REST API 后端，Python 3 WebSocket 文件存储节点，以及打包为 exe 的 LineWeb CLI 本地管理工具。SQLite 仅用于本地开发，生产为 PostgreSQL 16。功能：文章/评论、动态页面构建器、网盘、计算器、屏幕时间追踪（数字健康卡片，含电脑使用热力图）、AI 助手、头像裁剪上传、用户名登录、**私信（好友/群聊，支持图片消息与 2 分钟撤回）**、**游戏大厅（2048 单机 / 好友联机，支持无 WebSocket 轮询降级）**、PWA。**部署：阿里云 ECS（Ubuntu，公网 IP `120.24.223.65`）上用 1Panel + Docker Compose 部署：Express :3001 容器 + PostgreSQL 16 容器，公网入口 `https://web.linetech.online`（Cloudflare Tunnel 出站隧道，`cloudflared` 已注册为 systemd 服务开机自启）；IP 直连 `http://120.24.223.65:3001` 仍可用；阿里云按 Host 头拦截未备案域名，故不能用橙云 A 记录直连源站；存储节点仍运行在本地 Windows（`D:/LineWebDrive`），主动外连服务端；本地 Windows 全栈仍为开发/备用方案。**（2026-10-17 实测：生产 `/api/health` 显示 `storageNode: connected`，但本机未运行节点、仓库 `storage-node/config.json` 仍指向已不可达的 `ws://123.207.8.77:3001`，线上实际接入的节点来源待确认。）**

## 目录结构

```
lineweb/
├── client/           # React 19 + Vite 6 SPA → 开发端口 5173，生产从 dist/ 提供
├── server/           # Express 4 + Prisma 6 API → 端口 3001，tsx 运行时，.js 导入后缀
├── storage-node/     # Python 3 WebSocket 文件存储客户端（10 个命令）→ D:/LineWebDrive，仅本地
├── cli/              # LineWeb CLI 本地管理工具（TS + esbuild + pkg → LineWebCLI.exe，v2.1.0）
├── scripts/          # 14 个运维脚本（部署、开发启动/停止、webhook、截图、屏幕时间推送）
├── docs/             # 登录认证接入（auth-api.md）、第三方应用授权（app-auth-api.md）、聊天 API（chat-api.md）、游戏 API（game-api.md）、API 参考、Drive 部署指南、屏幕时间 API 指南、健康系统 API 指南、ECS 部署指南（DEPLOYMENT_HTTP_3001.md）
├── .omo/             # OpenCode 会话续传数据
├── .trae/            # Trae IDE 配置、项目规则
├── .superpowers/     # SDD 任务产物
├── .codegraph/       # 代码图谱分析数据库
├── .agents/          # 代理技能定义（pdf）
├── .lineweb-cli/     # CLI 运行时数据（已 gitignore）
│
├── package.json      # 单体仓库根 — concurrently 编排 client + server；build:cli 构建 CLI
├── CLAUDE.md         # 用户维护的 Claude Code 指令文件（已 gitignore，与 AGENTS.md 并存）
├── ecosystem.config.js # 备选/存档：PM2 直跑 Node/tsx 的配置（生产不用；cwd 指向 /opt/lineweb）
├── Dockerfile        # 生产使用：Docker 镜像（入口脚本 docker-entrypoint.sh 把 SQLite schema 改写为 PostgreSQL 后 db push + seed）
├── docker-compose.yml # 生产使用：容器编排（Docker Compose + PostgreSQL 16；Docker 与 1panel-network 由 1Panel 提供）
├── nginx.conf        # 备选：Nginx 反向代理配置（仅启用域名 + HTTPS 后使用）
└── .npmrc            # 中文 npm 镜像

> 生产部署主线：阿里云 ECS（Ubuntu，`/opt/lineweb`）+ 1Panel + Docker Compose（Express 容器 + PostgreSQL 16 容器）；systemd 直跑 tsx 与旧宝塔 PM2 路径均已作废，仅存档。
> 原 `.github/workflows/deploy.yml`（云服务器自动部署）已删除，如需 CI 需重建；`.github/` 目录仅剩默认配置。
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
| 部署方式 | 阿里云 ECS（Ubuntu，`120.24.223.65`）+ 本地存储节点 | 生产由 **1Panel v2.3.2 + Docker Compose** 部署，代码在 `/opt/lineweb`：应用是 compose 项目 `lineweb`（容器 `lineweb-server-1`，由仓库根 `docker-compose.yml` + `Dockerfile` 构建，端口 `3001:3001`，`restart: unless-stopped`，自带健康检查），数据库是 PostgreSQL 16 容器 `lineweb-postgres`；1Panel 面板在 `http://120.24.223.65:18080/lineweb_panel`（安装目录 `/opt/1panel`，**继续用 IP 访问，不要绑定域名**），公网入口 `https://web.linetech.online`（**Cloudflare Tunnel 出站隧道**：`cloudflared` 2026.9.3 装在 `/usr/local/bin/cloudflared`，已注册为 systemd 服务 `cloudflared`（enabled + active，开机自启），隧道名 `lineweb-ecs`，入口规则 `web.linetech.online → http://127.0.0.1:3001`；DNS 是 **CNAME → `<隧道ID>.cfargotunnel.com`**（Cloudflare 代理开启），不再是 A 记录指向源站 IP）；IP 直连 `http://120.24.223.65:3001` 仍可用；**阿里云安全组当前放行 `22`、`18080`、`3001`**；存储在本地 `D:/LineWebDrive` 的 Python 节点**主动外连**服务端（`/api/health` 2026-10-17 实测为 `storageNode: connected`，但本机未运行节点、仓库 `config.json` 仍指已不可达的 `ws://123.207.8.77:3001`，实际接入来源待确认；规范地址为 `wss://web.linetech.online/ws/storage`），因此家里无需公网 IP；**服务器直连 GitHub 极慢/不可达，`git fetch + git reset --hard` 在服务器上跑不通**，更新需走镜像/代理或从本地机器 `git push` 到服务器。备选/存档：systemd 直跑 tsx、PM2（`ecosystem.config.js`）、Nginx 反代（`nginx.conf`）、Railway（`docs/DRIVE_SETUP.md` 第 1 章）；本地 Windows 全栈仍为开发/备用 |
| 数据库结构 | `server/prisma/schema.prisma` | **17 个模型**：User、Post、Comment、Page、DriveFile、DriveFavorite、ScreenTimeLog、AiConfig、OAuthClient、OAuthGrant、OAuthCode、OAuthRefreshToken、Friendship、FriendRequest、Conversation、ConversationMember、Message（`ApiKey`、`ScreenTimeToken` 已随统一登录移除）；`User.storageQuota` 为网盘空间上限（BigInt，默认 2 GiB）；**本地开发用 SQLite**，**生产为 PostgreSQL 16**（容器 `lineweb-postgres`，基于 `postgres:16-alpine`，挂在 `1panel-network` 上，数据卷 `lineweb-pg-data`） |
| 数据库连接池 | `server/src/lib/prisma.ts` | Prisma 单例；生产（PostgreSQL 16）在 `DATABASE_URL` 上注入 `connection_limit=10&pool_timeout=30`（由 `DATABASE_POOL_SIZE`/`DATABASE_POOL_TIMEOUT` 控制，默认 10/30）；本地 SQLite 单文件无连接池 |
| 认证（账号登录令牌） | `server/src/middleware/auth.ts` | **账号凭证**：`POST /api/auth/login` 换取 JWT（`Authorization: Bearer`，下载直链兼容 `?token=`）；**13 个公开路径**在 `index.ts` 白名单；新增公开端点必须同步改白名单；`optionalAuthenticate`（有 token 则解析、无则匿名放行，用于 AI chat；应用令牌与下载票据按游客处理） |
| 第三方应用授权 | `server/src/routes/oauth.ts` + `services/oauthService.ts` | **OAuth 2.0 授权码 + PKCE（强制 S256）**：管理员在 `/admin/apps` 注册应用取得 `client_id`（机密客户端另有 `client_secret`，仅返回一次）；第三方应用跳转前端 `/authorize` 让用户确认授权（`AuthorizePage.tsx`），授权码 5 分钟且一次性核销（防重放），换得 `access_token`(1h) + `refresh_token`(30d，每次刷新轮换，重放即吊销整条授权)；撤销入口在个人资料页 |
| 应用令牌（scope） | `server/src/lib/appScopes.ts` | **scope 与端点白名单的唯一真相源**：9 个 scope（`profile:read`、`content:read`、`comment:write`、`health:read/write`、`drive:read/write`、`content:write`、`comment:moderate`）；`APP_ENDPOINT_RULES` 是应用令牌唯一可达的 API 面，**未列入一律 403**（`/api/users`、`/api/devices`、`/api/stats`、`/api/ai/config`、`/api/oauth/*`、`/api/auth/logout|profile|settings` 等永不可达）；应用令牌 `role:'app'`（未知角色 → 全部角色型检查自动为假），能力派生 scope 逐请求与账号当前能力取交集 → 降权即时生效；前端副本 `client/src/lib/appScopes.ts`，`__tests__/appScopes.test.ts` 跨端断言一致 |
| 角色能力矩阵 | `server/src/lib/permissions.ts` | 角色 `user`/`author`/`admin` → 能力（`content:write`、`content:manage`、`comment:moderate`、`user:manage`、`stats:view`、`device:view`、`ai:configure`、`drive:all`、`app:manage`）；**新注册用户默认 `author`**（schema `User.role` 默认值 + `registerUser` 显式指定，可发布自己的文章；一次性提升存量账号用 `server/scripts/promote-users-to-author.ts`）；`author` 仅 `content:write`（管理员仍可调整角色）；`content:manage` 为全站文章 + 页面（仅 admin）；admin 自动全权；路由用 `requireCapability()` 守卫（读认证阶段解析好的 `req.user.capabilities`，故对应用令牌精确生效）；令牌只签 `{userId, role, ts}`，能力、网盘开关与空间配额逐请求从 DB 解析 → 角色变更即时生效 |
| 好友 / 聊天（私信） | `server/src/routes/chat.ts` + `services/chatService.ts` + `services/chatImageService.ts` + `services/chatHub.ts` | REST（21 个端点，前缀 `/api/chat`）：好友申请/接受、好友列表、私聊/群聊会话、消息游标分页、已读、群管理、**图片消息上传/读取**（`POST /conversations/:id/images`、`GET /messages/:id/image`：busboy + sharp 统一转 WebP，存存储节点 `_chat/<conversationId>/`，计入发送者网盘配额）、**2 分钟内撤回**（`POST /messages/:id/recall`，撤回图片会删除节点文件并释放配额）；WebSocket `/ws/chat`（账号令牌认证帧 + 30s 心跳 + `message:new` / `message:recalled` / `friend:*` / `conversation:*` 推送），与 `/ws/storage` 共用 HTTP server（chatHub 接管 upgrade 分发，必须在 initStorageTunnel 之后初始化）；应用令牌/下载票据不可用；前端 `client/src/pages/ChatPage.tsx` + `contexts/ChatContext.tsx` + `components/chat/`（含 `ChatCameraDialog` 相机拍照） |
| 游戏 / 2048 联机 | `server/src/routes/games.ts` + `services/gameService.ts` + `services/game2048.ts` + `services/gamePresence.ts`；前端 `client/src/pages/games/` + `contexts/GameContext.tsx` + `lib/games/` | REST 前缀 `/api/games`：好友邀请加入 **等待房间（2–10 人）**、接受/拒绝/取消、房主开始 `start`、离开/解散 `leave`、对局、移动、认输、`sync` 轮询、`presence` 心跳；邀请通过后双方进入同一房间，开始后自动进入对局；`game:*` 事件复用 `/ws/chat`；服务端权威多玩家棋盘，内存态、无 Prisma 表；无路可走/认输/掉线淘汰该玩家，最后存活或分数最高者获胜；无 WebSocket 时按 2–10 秒轮询降级，在线判定 = 聊天 WS 在线 OR presence 未过期（TTL 90s，120s 判负）；单机版纯前端、最高分 localStorage |
| 网盘空间配额 | `server/src/services/driveQuota.ts` + `routes/drive.ts` / `routes/users.ts` | 每用户 `user.storageQuota`（默认 2 GiB，管理员 `PUT /api/users/:id/quota` 可调 0–10 TiB）；**已用空间 = 网盘文件 + 聊天图片**（`Message.imageSize`，撤回后不计）；上传三阶段强制（预检 / busboy 按剩余空间截断 / 写后复核并清理），超限 413 `QUOTA_EXCEEDED`；`GET /api/drive/quota` 返回 BigInt 字符串；`drive:all` 不受限；`POST /api/drive/sync` 收紧为仅 `drive:all`；前端 `useDriveQuota` + `DriveQuotaBar` |
| 登录/个人资料 | `server/src/routes/auth.ts` | 登录支持 `identifier`（用户名或邮箱，兼容 email）与 `rememberDays`（1–90 天设备长期令牌）；`PUT /auth/profile` 修改用户名（唯一性校验）/密码（验证当前密码，改密后旧 token 全失效并重签） |
| 屏幕时间推送 | `server/src/routes/health.ts` | `/api/health/push`、`/screen-time*`、`/daily-goal*` 统一用登录令牌（仅本人数据）；`X-Screen-Time-Token` 已移除 |
| AI 助手 | `server/src/routes/ai.ts` + `services/aiService.ts` | OpenAI SDK + 兼容 baseUrl；`AiConfig` 单行表存 key（脱敏显示）；**`/api/ai/chat` 公开（POST）但走 `optionalAuthenticate`**——登录用户额外注入站点统计、最近评论、全部已发布页面、按需检索文章正文（≤2 篇×1500 字）、近 14 天屏幕时间；`/chat/public` GET 取站点内容；管理端 `/admin/ai` 配置；chat() 错误统一 `AppError` |
| 存储架构 | `server/src/services/storageTunnel.ts` ↔ `storage-node/main.py` | WebSocket 隧道；服务器代理命令到 Python 节点；节点 10 命令（7 个 HANDLERS + 流式 read/write/eof）、阻塞 I/O 线程池化、运行期间 `SetThreadExecutionState` 阻止 Windows 休眠 |
| 头像服务 | `server/src/services/avatarService.ts` | sharp 处理 + 存储节点读写；`GET /api/auth/avatar/:userId` 公开（头像可匿名访问） |
| 全文搜索 | `server/src/services/ftsSearch.ts` | SQLite FTS5 全文索引，启动时 `ensureFTSTable` |
| React Query 层 | `client/src/hooks/useQueries.ts` + `lib/queryKeys.ts` | 公开页面已使用（staleTime 5min、retry 1、不随窗口聚焦刷新），管理页面仍手写 `useState+useEffect` |
| 设计系统 | `client/src/styles/`（11 个 CSS 文件，含 `chat.css`、`games.css`） | `globals.css` 仅 import 聚合器；`drive.css` 最大（约 2900 行）；聊天样式为 `.gh-chat-*`，游戏为 `.gh-games-*` / `.gh-g2048-*` / `.gh-game-*`；无 Tailwind、无 CSS-in-JS |
| 本地管理 CLI | `cli/src/`（commands/autoupdate/processes/ui） | `setup` 新机器一键安装、`start` 默认生产模式、`update` GitHub 拉取（镜像降级）、`token` 查询存储节点 Key、`autoupdate` S4U 计划任务无人值守更新；构建 `npm run build:cli` → `cli/dist/LineWebCLI.exe` |
| PWA | `client/index.html` + `client/public/manifest.json` | theme-color、apple-touch-icon、manifest 已配置 |
| 环境配置 | `server/.env`（本地）/ `/opt/lineweb/.env`（生产） | 本地：`NODE_ENV`、`PORT=3001`、`JWT_SECRET`、`DATABASE_URL`（`file:./lineweb.db`）、`STORAGE_NODE_TOKEN`、`CORS_ORIGIN`、`MAX_FILE_SIZE_MB`；**生产 `.env` 在服务器 `/opt/lineweb/.env`，`DATABASE_URL` 指向 `lineweb-postgres:5432`**，另有 `JWT_SECRET`、`STORAGE_NODE_TOKEN`、`MAX_FILE_SIZE_MB` 等（凭据副本在服务器 `/root/lineweb-secrets.txt`，不进仓库）；缺 `JWT_SECRET`/`STORAGE_NODE_TOKEN` 会直接启动失败。本地与生产 `.env` 各自独立，`.env.docker` 为容器部署模板 |
| 内网穿透 | `cloudflared`（Cloudflare Tunnel） | **生产公网入口即由它承载**：ECS 上跑 `cloudflared`（systemd 服务 `cloudflared`，隧道 `lineweb-ecs`），`https://web.linetech.online` → `127.0.0.1:3001`；本地开发时也可用 `cloudflared tunnel run <name>` 把本机 :3001 映射为公网 HTTPS 域名，原生支持 WebSocket；无公网 IP 要求。**若日志出现 QUIC 降级，已通过 `/etc/systemd/system/cloudflared.service.d/override.conf` 设置 `TUNNEL_TRANSPORT_PROTOCOL=http2` 强制 HTTP/2 出站**（见部署指南故障排查） |
| API 缓存策略 | `server/src/index.ts` cachePublic 中间件 | posts/pages/comments 5min、stats 1min；**bing 壁纸已移除** |

## 架构

```
┌────────────────┐     HTTP/API      ┌──────────────────────────────────┐     WebSocket      ┌──────────────────────────┐
│  浏览器         │ ◄──────────────► │  阿里云 ECS (Ubuntu)              │ ◄───────────────► │  Storage Node            │
│  (React SPA)   │   公网 IP :3001   │  1Panel + Docker Compose          │ ws(s)://ECS:3001   │  (Python)                │
│                │                  │  Express 容器 + PostgreSQL 16     │  :3001/ws/storage  │  本地 Windows             │
└────────────────┘                  │  + client/dist 静态               │                   │  D:/LineWebDrive         │
                                    └──────────────────────────────────┘                   └──────────────────────────┘

开发：  Vite :5173 → 代理 /api → Express :3001（本地，SQLite）
生产：  阿里云 ECS：1Panel + Docker Compose（Express 容器 :3001 + PostgreSQL 16 容器），容器内提供 client/dist 静态资源 + SPA fallback
公网：  https://web.linetech.online（Cloudflare Tunnel → 本机 127.0.0.1:3001）；IP 直连 http://120.24.223.65:3001 备用
存储：  2026-10-17 实测生产 health 为 storageNode: connected（网盘/头像可用）；本机未运行节点，仓库 config.json 仍指已不可达的 ws://123.207.8.77:3001，实际接入来源待确认。规范配置为 wss://web.linetech.online/ws/storage（已实测可握手）
备用：  本地 Windows 全栈（开发/应急，非生产）
```

### 启动流程

```
server.listen(3001)
  ├── helmet(CSP) → cors → compression（跳过 /proxy、/download）
  ├── body parser 限定 /api（1mb，避免静态文件请求触发解析）
  ├── rate-limit(600/15min，代码注释里的 200 是过期的) → 设备追踪 → 全局认证检查
  ├── cachePublic 中间件 → 15 个路由组挂载于 /api/*（含 /api/oauth、/api/chat、/api/games）
  ├── [生产] express.static(client/dist, maxAge 1y+immutable, HTML 不缓存) + SPA fallback
  └── errorHandler

监听后：
  ├── http.createServer → WebSocket：/ws/storage（存储隧道）+ /ws/chat（聊天 Hub；chatHub 接管 upgrade 分发，需在 initStorageTunnel 之后初始化）
  ├── 网盘同步定时器（每 5 分钟，unref）
  ├── 启动延迟（10s）：去重 + 初始同步
  └── 设备追踪清理（30 分钟不活跃超时）
```

## 部署流程（阿里云 ECS + 1Panel + Docker Compose + 本地存储节点）

```
阿里云 ECS（Ubuntu 24.04，2 vCPU / 1.6GB + 2GB swap，代码在 /opt/lineweb）：
  1. 安装 1Panel v2.3.2（用非交互 PANEL_* 变量指定端口/入口/用户名，避免交互提问）：
     官方安装脚本会同时装好 Docker 29.8.1 + Docker Compose v5.5.1；
     安装目录 /opt/1panel，面板地址 http://120.24.223.65:18080/lineweb_panel（用户名 lineweb）
  2. 配置 /etc/docker/daemon.json 国内镜像加速
     （docker.1panel.live、docker.m.daocloud.io、docker.1ms.run）
     —— 该机器直连 Docker Hub 会超时，不配加速无法拉取镜像
  3. 创建 1panel-network 外部网络与 PostgreSQL 16 容器 lineweb-postgres
     （postgres:16-alpine、数据卷 lineweb-pg-data、数据库 lineweb）
  4. 代码放到 /opt/lineweb（git 仓库，当前 HEAD 660f492；origin 仍指向 GitHub）
  5. 写 /opt/lineweb/.env：DATABASE_URL 指向 lineweb-postgres:5432，
     另有 JWT_SECRET、STORAGE_NODE_TOKEN、MAX_FILE_SIZE_MB 等
     （凭据副本在服务器 /root/lineweb-secrets.txt，不要写入文档或仓库）
  6. docker compose up -d --build
     # 应用容器 lineweb-server-1，端口 3001:3001，restart: unless-stopped，compose 自带健康检查
     # 首次启动由 server/scripts/docker-entrypoint.sh 把 SQLite schema 改写为 PostgreSQL，
     # 再执行 prisma db push + prisma db seed
  7. 验收：curl http://127.0.0.1:3001/api/health
     # 期望 {"status":"ok","db":"connected",...}，docker ps 显示容器 healthy
  8. 阿里云安全组放行 22、18080、3001
     —— 当前三者均已放行；若后续存储节点改走 wss://web.linetech.online/ws/storage（隧道），
        可考虑关闭 3001 的公网入站

本地 Windows（存储节点，文件不出本机）：
  1. storage-node/config.json：serverUrl=wss://web.linetech.online/ws/storage（直连备选 ws://120.24.223.65:3001/ws/storage），
     token 与服务器 /opt/lineweb/.env 的 STORAGE_NODE_TOKEN 完全一致，storagePath=D:/LineWebDrive
  2. python main.py（或用 nssm 注册 Windows 服务开机自启）
  3. 节点为 WebSocket 客户端主动外连，本地无需公网 IP / 端口映射
  4. 节点接入状态（2026-10-17 实测）：/api/health 显示 "storageNode":"connected"，网盘/头像可用；
     但本机未运行节点、仓库 config.json 仍指向已不可达的 ws://123.207.8.77:3001，
     线上实际由哪台节点接入待确认。规范做法：serverUrl 用 wss://web.linetech.online/ws/storage

公网入口：
  当前 https://web.linetech.online（HTTPS，Cloudflare 边缘证书）→ 由 Cloudflare Tunnel 转发到本机
  http://127.0.0.1:3001：cloudflared 装在 /usr/local/bin/cloudflared，已注册为 systemd 服务
  cloudflared（enabled + active，开机自启），隧道名 lineweb-ecs，入口规则
  web.linetech.online → http://127.0.0.1:3001；DNS 是 CNAME → <隧道ID>.cfargotunnel.com（Cloudflare 代理开启），
  不再用 A 记录指向源站 IP。实测：/api/health 200 且 db: connected、首页 200、登录接口 200、
  wss://web.linetech.online/ws/storage 握手 101。
  为什么必须走隧道：阿里云大陆节点会按 HTTP Host 头拦截未备案域名，返回 403 + Server: Beaver +
  Non-compliance ICP Filing 页面；实测带 Host: web.linetech.online 直连 IP:3001 同样 403（换端口、
  套橙云 A 记录都没用，因为回源 Host 仍是未备案域名），而 Cloudflare 免费版不代理 3001 端口。
  隧道是 cloudflared 主动外连（TCP/QUIC 7844），不产生「带未备案域名的入站请求」，所以能正常服务。
  IP 直连 http://120.24.223.65:3001 仍然可用（/api/health 200）。
  ⚠️ 合规提示：未备案域名指向大陆服务器属备案合规灰区（阿里云要求指向大陆服务器的域名备案），
  隧道只是规避了技术拦截；要彻底合规需完成 ICP 备案或把服务器换到非大陆区域。
  1Panel 面板：http://120.24.223.65:18080/lineweb_panel（用户名 lineweb）——继续用 IP:18080 访问，
  **不要在面板里绑定域名**（面板设置 → 域名绑定）：绑了之后用 IP 访问会被拦成
  "Access Temporarily Unavailable"，恢复命令是 1pctl reset domain && systemctl restart 1panel-core。

代码更新（服务器无法直连 GitHub）：
  ❌ git fetch origin master && git reset --hard origin/master   # 在该 ECS 上跑不通
     （实测 clone 两分钟只拉到约 200KB，最初代码是用本地 git bundle 上传后 clone 的）
  ✅ 走镜像/代理拉取，或从本地机器 git push 到服务器（本地 → 服务器 SSH 可达）
  更新后重建容器：docker compose up -d --build
```

> 详细运行手册（含 ECS/1Panel 准备、Docker Compose 部署、`.env`、存储节点连接、验收清单、故障排查、HTTPS 升级步骤）见 [`docs/DEPLOYMENT_HTTP_3001.md`](docs/DEPLOYMENT_HTTP_3001.md)。

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
- **根目录无 `npm test`** — 仅在 `client/` 中有测试（25 个文件 / 180 个用例，`__tests__/` 目录）；server 零测试
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
- **跨模块耦合已消除**：`users.ts` 不再从 `drive.ts` 导入 `clearDriveAccessCache`（网盘权限改为逐请求从 `req.user.canAccessDrive` 读取）
- **服务层不一致**：部分路由使用 service 层（auth、posts、avatar、ai），其他直接调用 Prisma（comments、pages、stats、driveFavorites）
- **React Query 层已使用** — `QueryClientProvider` 在 App.tsx 中配置，公开页面通过 `useQueries.ts` 使用 React Query，管理页面仍手写 `useState+useEffect`
- **顶部导航快捷方式已移除** — 导航统一由侧边栏提供；首页站点统计移至右侧侧边栏，AI 助手在首页

### 数据库

- **无迁移** — 仅使用 `prisma db push`；无回滚能力
- **`$queryRawUnsafe`**（3 处）— 去重脚本中的原始 SQL（已参数化，但绕过了类型安全）
- **本地 SQLite / 生产 PostgreSQL 双轨** — 本地开发用 SQLite（同一套 `schema.prisma`），生产是 PostgreSQL 16（1Panel 上的容器 `lineweb-postgres`）；`server/scripts/docker-entrypoint.sh` 会在容器启动时把 SQLite schema 改写为 PostgreSQL 后执行 `db push`，属生产链路的一部分

### 安全

- **明文 token 存储于 `storage-node/config.json`，且 `.gitignore` 未覆盖该文件** — 一旦提交即对外公开（仓库工作区当前就是明文 token），保守应视为**已泄露**：需轮换 `STORAGE_NODE_TOKEN` 并把该文件加入 `.gitignore`，或改用 `LINEWEB_STORAGE_TOKEN` 环境变量注入；另注意直连 `ws://` 时 token 明文过网，改用 `wss://web.linetech.online/ws/storage`（Tunnel）可加密整条链路
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
cd client && npm run test        # vitest run（25 个测试文件 / 180 个用例）
cd client && npm run test:watch  # vitest watch
cd client && npx vitest run src/components/drive/__tests__/PathBar.test.tsx  # 单文件测试

# Storage Node（本地机器）
cd storage-node && python main.py   # token 需与 server/.env 的 STORAGE_NODE_TOKEN 一致（或环境变量 LINEWEB_STORAGE_TOKEN）；可用 `cli token` 查询

# LineWeb CLI（本地机器，管理整套服务）
cd cli && npm run dev             # tsx 运行
cd cli && npm run typecheck       # tsc --noEmit

# 部署（阿里云 ECS Ubuntu + 1Panel + Docker Compose + PostgreSQL 16；代码在 /opt/lineweb）
docker compose up -d --build          # 构建并启动（Express 容器 lineweb-server-1 + PostgreSQL 16 容器）
docker compose logs -f server         # 跟踪 server 容器日志
docker compose restart server         # 重启 server 容器
docker compose ps                     # 查看容器与健康状态
curl http://127.0.0.1:3001/api/health # 验收：{"status":"ok","db":"connected",...}
cd storage-node && python main.py     # 本地 Windows 存储节点，config.json 指向 wss://web.linetech.online/ws/storage（直连备选 ws://120.24.223.65:3001/ws/storage）
# 更新（服务器无法直连 GitHub，git fetch/reset 跑不通）：走镜像/代理，或从本地 git push 到服务器后 docker compose up -d --build
# 本地开发/备用：npm run dev + Cloudflare Tunnel（cloudflared tunnel run <name>）

# 备选/存档：systemd 直跑 tsx、PM2（ecosystem.config.js）、Nginx 反代（nginx.conf）
#   原 GitHub Actions SSH 自动部署 workflow（.github/workflows/deploy.yml）已删除
```

## 注意事项

- **Server 运行时使用 tsx** — 生产环境从不编译为 JS。根目录 `npm run build` 仅构建 client（且不做类型检查）。
- **生产需要 SQLite → PostgreSQL 的 schema 转换** — 本地开发用 SQLite，生产是 PostgreSQL 16 容器；容器首次启动时 `server/scripts/docker-entrypoint.sh` 会把 SQLite schema 改写为 PostgreSQL（`prisma/schema.pg.prisma`）后执行 `prisma db push`（首启带 `--accept-data-loss`）与 `prisma db seed`，这是生产链路的一部分，不是备选机制。
- **服务器无法直连 GitHub** — 该 ECS 直连 GitHub 极慢/不可达（实测 clone 两分钟只拉到约 200KB），代码是本地 `git bundle` 上传后 clone 的；因此 `git fetch && git reset --hard` 在服务器上跑不通，更新需走镜像/代理，或从本地机器 `git push` 到服务器（本地 → 服务器 SSH 可达）。
- **阿里云大陆节点按 Host 头拦截未备案域名** — 带 `Host: web.linetech.online` 请求 ECS 会返回 `403` + `Server: Beaver` + `Non-compliance ICP Filing`（实测直连 `IP:3001` 同样 403，换端口、套橙云 A 记录都无效，因为回源 Host 仍是未备案域名；Cloudflare 免费版也不代理 3001 端口）。当前用 **Cloudflare Tunnel**（cloudflared 主动外连，不产生带该域名的入站请求）规避，属**备案合规灰区**：要彻底合规需完成 ICP 备案或把服务器换到非大陆区域。
- **storageNode 当前为 connected（2026-10-17 实测），但接入来源待确认** — 生产 `/api/health` 返回 `"storageNode":"connected"`（服务端与数据库均正常，隧道入口 `https://web.linetech.online/api/health` 200、`db: connected`），网盘/头像可用；然而**本机没有运行存储节点**，且仓库 `storage-node/config.json` 仍指向已不可达的 `ws://123.207.8.77:3001`，说明线上接入的是另一份配置/另一台机器。若要在本机跑节点：把 `serverUrl` 改为 `wss://web.linetech.online/ws/storage`（Cloudflare Tunnel，已实测握手 101；链路加密且改用隧道后可关闭安全组 3001 公网入口）或 `ws://120.24.223.65:3001/ws/storage`（直连备选），token 换成服务器 `/opt/lineweb/.env` 的 `STORAGE_NODE_TOKEN`。
- **Storage node 是外部进程** — Python 进程运行在本地 Windows 机器上，未容器化。通过 WebSocket 以指数退避重连（最长 60s）方式连接到 `/ws/storage`；认证 5s 超时、心跳 30s。运行期间通过 `SetThreadExecutionState` 阻止系统休眠；文件 I/O 走线程池避免阻塞事件循环。
- **LineWeb CLI** — `cli/` 子项目打包为单文件 exe，双击即交互式管理本地服务（setup/start/stop/restart/status/update/logs/token）；`start` 默认生产模式；`autoupdate` 通过 Windows S4U 计划任务无人值守拉取更新；构建依赖 pkg 的 node22 基础二进制（缓存于 `~/.pkg-cache/v3.6`，丢失时需通过镜像下载）。
- **中文友好默认配置** — `.npmrc` 设置 npmmirror.com 镜像；文档使用中文。
- **更新强制覆盖** — CLI `update` 使用 `git reset --hard origin/master` 而非 `git pull`，避免本地改动导致更新冲突；未跟踪文件（`server/.env` 等）不受影响。
- **Cloudflare Tunnel（当前生产公网入口）** — ECS 上运行 `cloudflared`（systemd 服务，开机自启），公网流量经 Cloudflare 边缘（`https://web.linetech.online`）进入服务器本机 `127.0.0.1:3001`（无需为站点额外开放入站端口）；原生支持 WebSocket（网盘存储隧道、AI 流式响应均可用），实测 `wss://web.linetech.online/ws/storage` 握手 101；本地开发时也可用 `cloudflared tunnel run <name>` 把本机 :3001 临时暴露为公网 HTTPS。
- **Server 无测试框架** — `server/` 中无 vitest 等测试基础设施；2048 引擎/presence 用 `cd server && npm run verify:game` 自检脚本。Playwright 是 client 依赖但无正式配置；本次联机/轮询冒烟用临时脚本完成（未提交）。
- **认证中间件跳过 13 个路径**：`/auth/login`、`/auth/register`、`/auth/avatar`、`/health`、`/posts`、`/pages/featured`、`/pages/slug`、`/stats/public`、`/version`、`/comments/post`、`/ai/chat`、`/oauth/token`、`/oauth/revoke`。白名单匹配用 `req.path === p || req.path.startsWith(p + '/')`（`req.path` 不含 `/api` 前缀），因此 `/health` 覆盖全部 `/health/*`（路由内部仍要求登录令牌），`/ai/chat` 也覆盖 `/ai/chat/public`；`/oauth/token|revoke` 用精确路径，避免前缀匹配放大暴露面。
- **唯一账号凭证是账号登录令牌** — API Key（`X-API-Key`）与屏幕时间 Token（`X-Screen-Time-Token`）已彻底移除（含 `ApiKey` / `ScreenTimeToken` 两张表与 `/api/api-keys`、`/api/health/tokens` 端点）；第三方设备登录同一账号后使用同一 JWT，可用 `rememberDays`（1–90）申请长期令牌，**或走 OAuth 授权流程**获得权限更小的应用令牌。
- **应用令牌必须走 `authenticate` 内的白名单校验** — `/health/*`、`/comments`、`/auth/avatar`、`/ai/*` 在公开路径白名单里，靠路由内再次调用 `authenticate` 兜底，因此应用令牌的端点白名单检查必须写在 `authenticate()` 内部（而非只放在全局中间件），否则这些端点会被应用令牌绕过。完整路径用 `${req.baseUrl}${req.path}` 拼接并**归一化末尾斜杠**（挂在 `/api/posts` 的 router 处理 `POST /api/posts` 时 `req.path` 是 `/`，否则匹配不上 `^/api/posts$`）。
- **令牌失效精确到毫秒** — 签发时写入自签 `ts` claim 与 `user.tokenValidAfter` 直接比较，因此登出/改密后同一秒内的旧令牌也会立即 401；下载票据（`/api/drive/download-ticket/:id`）同样带 `ts`。
- **下载票据有作用域限制** — `type === 'download'` 的票据只允许访问 `/api/drive/download/:id` 与 `/api/drive/files/:id/download`，其它端点一律 403（票据常出现在 URL / 浏览器历史 / 访问日志中）。
- **前端管理区按能力守卫** — `client/src/lib/permissions.ts` 的 `ADMIN_ROUTE_CAPABILITIES` 同时驱动侧边栏过滤（`AdminLayout`/`GitHubSidebar`）与路由守卫（`Guards.AdminCapabilityRoute`，挂在 AdminLayout 的 `<Outlet/>` 外）；缺能力时重定向到该账号第一个可用管理页，避免落到无权页面 403。
- **前后端能力清单有测试兜底** — `client/src/lib/__tests__/permissions.test.ts` 直接读 `server/src/lib/permissions.ts` 源码断言两份 `CAPABILITIES` 完全一致（服务端加能力而前端漏改会让 `npm test` 失败）；同理 `client/src/lib/__tests__/appScopes.test.ts` 读 `server/src/lib/appScopes.ts` 断言 scope 清单、标签/说明、以及端点白名单引用的 scope 全部合法。
- **应用令牌绝不会获得管理能力** — 签发时 `role:'app'` + 按 scope 授予能力，且服务端所有角色判断都走 `roleHasCapability()`，未知角色让全部角色型检查自动为假（含 `drive.ts` 的 `drive:all` 越权豁免），因此新增管理端点无需额外改动即对应用令牌关闭。仅当需要放行「能力派生 scope」（`content:write`、`comment:moderate`）时才依赖 `requireCapability()` 读 `req.user.capabilities` 的行为。
- **认证 API 禁缓存** — 除公开路径外，全局认证中间件设置 `Cache-Control: no-store` 并清空 ETag，避免 304 导致旧数据。
- **新增公开端点必须同步两处** — `index.ts` 的 `publicApiPaths` 白名单 + `cachePublic` 缓存策略。
- **`/api` 自描述端点** — `GET /api` 返回全部路由清单（需认证），排查路由问题时先看这里。
- **前端 Provider 顺序** — `BrowserRouter → QueryClient → Auth → Chat → Game → Theme → Download → RouteErrorBoundary → Suspense → Routes`；`DownloadToast` 与 `GameInviteToast` 在 Routes 外；ChatProvider 负责 `/ws/chat` 连接与未读角标，GameProvider 依赖 ChatProvider 的 `transport`，两者都需在 AuthProvider 内。
- **聊天 WebSocket 与存储隧道共用端口** — `chatHub` 用 `noServer: true` 接管 HTTP server 的 `upgrade` 事件并按路径分发（`/ws/chat` → 聊天，其余转交已注册的 `/ws/storage` 监听），因此**必须先 `initStorageTunnel(server)` 再 `initChatHub(server)`**；后续再新增 WebSocketServer 需接入同一分发逻辑。游戏事件（`game:invite` / `game:invite:removed` / `game:match:started|update|ended`）复用同一 `/ws/chat`，不新增 WS 服务。
- **无 WebSocket 降级** — `ChatContext` 暴露 `transport: 'ws' | 'polling'`；WS 不存在/构造失败/8 秒握手超时/断线时聊天与游戏改用 HTTP 轮询（聊天消息 10s、会话/摘要 30s、好友 60s；游戏对局 sync 2s、全局 sync 5s、presence 20s）。游戏在线判定 = `chatHub.isUserOnline` OR `gamePresence` 未过期（TTL 90s），掉线判负 120s。`?transport=polling` / `localStorage.lineweb_force_polling=1` 可强制轮询，`?transport=auto` 恢复。游戏 `sync`/`presence`/移动端点从全局 600/15min 限流中精确豁免，由路由级按用户限流；聊天轮询不改服务端限流。
- **网盘配额是 BigInt** — `User.storageQuota` / `DriveFile.size` 均不能直接 JSON 序列化；`/api/drive/quota`、`/api/users`、上传 413 响应中的字节数一律用**字符串**；客户端用 `formatStorageSize` 展示。
- **上传配额有三道检查** — 解析前预检剩余空间、busboy 以 `min(单文件上限, 剩余空间)` 截断、写入后重新 SUM 复核并清理（DB 行 + 节点文件 + FTS）。本地无存储节点时 `/upload` 会先返回 503，配额全链路需在节点在线时验证。
- **聊天图片与网盘共用配额** — `driveQuota.getDriveUsage` = `DriveFile.size` + `Message.imageSize`（未撤回图片）；聊天图片写节点后**先落库再复核**（复核必须能看到本张图，否则并发上传各超一张），超限回滚消息行 + 删除节点文件。撤回图片会清空 image 字段并删除节点文件，配额立即释放；`storageSync` 必须排除 `_chat/`，否则聊天图片会被扫进网盘。
- **`compression` 过滤器要用 `req.originalUrl`** — 响应头阶段（onHeaders）执行时，Express 挂载路由会把 `req.path` 剥成路由内相对路径（如 `/messages/17/image`），用 `req.path` 匹配完整路径会失效。聊天图片路由已按此排除压缩（WebP 无需 gzip，且保留 `Content-Length`）。
- **第三方应用的 `content:write` 语义已收窄** — 应用只能管理所属账号自己的文章；`/api/pages*` 已从应用白名单移除，页面管理改为管理员专属 `content:manage`（breaking change，见 `docs/app-auth-api.md`）。
