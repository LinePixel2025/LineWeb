# Line Web

LineWeb 采用 GitHub Primer 风格：浅色/暗色主题、细边框、克制阴影、8px 圆角和明确的 focus ring。

React 19 SPA 前端 + Express 4 REST API 后端 + Python 3 WebSocket 文件存储节点。

## 特性

- **GitHub Primer 设计** — 语义化 CSS 令牌、边框式信息层级与明暗主题
- 📝 **文章系统** — Markdown 写作、发布与管理
- ☁️ **网盘** — 文件上传/下载/预览/搜索，文件夹管理，批量操作，收藏夹跨设备同步
- 🧮 **在线计算器** — 基础运算与科学计算
- 🔐 **认证系统** — JWT + API Key 双认证，管理员面板
- 🖼️ **页面构建器** — 可视化控件树，自定义功能页面
- 📊 **屏幕时间追踪** — 跨设备使用统计与目标管理
- 🌓 **智能主题** — 亮色/暗色模式，跟随系统或手动切换
- 📱 **响应式设计** — 桌面端与移动端完美适配
- 🖥️ **本地部署** — Windows 本地服务器运行，LineWeb CLI 一键管理
- 🌐 **Cloudflare 内网穿透** — 公网域名直连本地服务，无需云服务器

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite 6, TypeScript, React Router 7, TanStack React Query |
| 后端 | Express 4, Prisma 6, JWT, Zod, tsx 运行时 |
| 数据库 | SQLite（本地文件，开发与生产一致） |
| 存储节点 | Python 3 + websockets 库，WebSocket 二进制流传输 |
| 设计 | GitHub Primer 风格，CSS 变量令牌、`.gh-*` BEM 组件和 light/dark/auto 主题 |
| 部署 | 本地 Windows 服务器 + Cloudflare Tunnel（内网穿透） |

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

## 快速开始

### 前置要求

- Node.js 18+
- Python 3.10+（存储节点）
- 可选：cloudflared（Cloudflare Tunnel，公网访问本地服务）

### 安装

```bash
# 配置 npm 镜像（中国用户）
npm config set registry https://registry.npmmirror.com

# 安装依赖（根目录 postinstall 自动安装 client + server）
npm install
```

### 配置

编辑 `server/.env`：

```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="替换为安全的密钥"
STORAGE_NODE_TOKEN="lineweb-storage-node-secret"
```

### 启动开发环境

```bash
# 前后端同时启动（server :3001 + client :5173）
npm run dev

# 或分别启动
npm run dev:server   # tsx watch server/src/index.ts
npm run dev:client   # vite 端口 5173

# 存储节点（本地 Windows，需另开终端）
cd storage-node && python main.py
```

### LineWeb CLI（本地管理工具）

`cli/` 子项目提供一键管理本地服务的命令行工具，构建后双击 `LineWebCLI.exe` 即可交互使用：

```bash
npm run build:cli        # 构建 cli/dist/LineWebCLI.exe
```

支持 `setup`（新机器一键安装并启动）、`start` / `stop` / `restart` / `status` / `update`（从 GitHub 拉取最新版本）/ `logs` 等命令，详见 [cli/README.md](cli/README.md)。

### 数据库

```bash
npm run db:push    # prisma db push 同步表结构
npm run db:seed    # 填充种子数据
npm run db:studio  # prisma studio GUI
```

### 管理员入口

打开 http://localhost:5173/admin 登录：

- 邮箱：`admin@lineweb.dev`
- 密码：`admin123`

## 网盘

LineWeb 内置完整网盘功能，架构分为三层：

| 层 | 技术 | 职责 |
|----|------|------|
| 前端 | React + Virtuoso 虚拟滚动 | 文件浏览、预览、拖拽上传、批量操作 |
| 服务端 | Express + Prisma | REST API、权限控制、FTS5 全文搜索 |
| 存储节点 | Python WebSocket 客户端 | 实际文件读写、二进制流传输、SHA-256 完整性校验 |

### 网盘特性

- 文件/文件夹管理（创建、重命名、移动、删除、递归删除）
- 流式上传下载（支持断点续传 Range 请求）
- 文件预览（图片、视频、音频、PDF、代码高亮）
- 批量操作（多选下载、移动、删除、收藏）
- FTS5 全文搜索
- 列表/网格两种视图
- 键盘快捷键（F2 重命名、Delete 删除、Ctrl+N 新建等）
- 自动同步（5 分钟间隔，节点 ↔ DB 双向同步）

## 项目结构

```
lineweb/
├── client/              # React 19 + Vite 6 SPA
│   └── src/
│       ├── components/  # 共享组件（gh、drive、admin 等）
│       ├── contexts/    # React Context（Auth、Drive、Download）
│       ├── hooks/       # 自定义 Hook（useQueries、useDriveFiles 等）
│       ├── pages/       # 页面组件（懒加载）
│       ├── lib/         # 工具函数、API 客户端
│       ├── styles/      # 全局样式（variables、components、layout、pages 等）
│       └── types/       # TypeScript 类型定义
├── server/              # Express 4 + Prisma API
│   ├── src/
│   │   ├── config/      # Zod 校验 schema、环境变量
│   │   ├── middleware/   # 认证（JWT + API Key）、错误处理
│   │   ├── routes/      # 12 个路由模块（全部前缀 /api）
│   │   ├── services/    # 业务逻辑（auth、drive、storage 等）
│   │   └── lib/         # Prisma 单例、工具函数
│   └── prisma/          # 数据库 schema、种子数据
├── storage-node/        # Python 3 WebSocket 文件存储节点
├── cli/                 # LineWeb CLI 本地管理工具（打包为 exe）
├── scripts/             # 运维脚本（14 个）
├── docs/                # API 文档、部署指南、设计系统文档
├── Dockerfile           # ⚠️ 已废弃：Docker 镜像构建（存档）
├── docker-compose.yml   # ⚠️ 已废弃：容器编排（存档）
├── nginx.conf           # ⚠️ 已废弃：Nginx 反向代理（存档）
└── .npmrc              # npmmirror.com 镜像
```

## 命令参考

```bash
# 开发
npm run dev              # concurrently：server (3001) + client (5173)
npm run dev:server       # tsx watch server
npm run dev:client       # vite

# 构建 & 生产
npm run build            # vite 构建 client → client/dist
npm run build:cli        # 构建 LineWeb CLI（cli/dist/LineWebCLI.exe）
npm run start            # ⚠️ 旧云服务器流程（生成 PG schema）；本地 SQLite 部署见「部署」章节

# 数据库
npm run db:push          # prisma db push
npm run db:seed          # 种子数据
npm run db:studio        # prisma studio GUI

# 测试（仅 client）
cd client && npm run test        # vitest run（14 个测试文件）
cd client && npm run test:watch  # vitest watch

# ⚠️ 以下为旧云服务器部署命令（Docker），已废弃，脚本保留存档
npm run docker:up        # docker compose up -d
npm run docker:down      # docker compose down
npm run docker:build     # docker compose build
npm run docker:logs      # 查看 server 日志
npm run docker:restart   # 重启 server 容器
```

## API 概览

所有 API 前缀 `/api`。认证方式：`Authorization: Bearer <JWT>` 或 `X-API-Key: <key>`。

| 路由模块 | 主要端点 | 说明 |
|---------|---------|------|
| **认证** | `POST /auth/login|register`、`GET /auth/me` | 登录/注册/个人信息 |
| **文章** | `GET /posts`、`GET/POST/PUT/DELETE /posts/:id` | 公开列表 + admin CRUD |
| **评论** | `GET/POST /comments/post/:id`、嵌套回复 | 树形评论系统 |
| **页面** | `GET /pages/featured|slug/:slug`、admin CRUD | 可视化页面构建器 |
| **网盘** | `GET/POST /drive/files`、`POST /drive/upload`、`GET /drive/files/:id/download` | 完整文件管理 |
| **网盘收藏** | `GET/POST/DELETE /drive/favorites` | 文件夹收藏跨设备同步 |
| **头像** | `POST/GET/DELETE /avatar` | 用户头像上传 |
| **用户管理** | `GET/PUT /users`、`PUT /users/:id/drive-access` | admin 用户管理 |
| **API 密钥** | `CRUD /api-keys` | API Key 管理 |
| **统计** | `GET /stats/public`、`GET /stats` | 公开/管理统计 |
| **设备** | `GET /devices` | 在线设备追踪（admin） |
| **健康** | `GET /health`、`POST /health/push` | 健康检查 + 屏幕时间推送 |
| **必应壁纸** | `GET /bing-wallpaper` | 每日必应壁纸 |
| **版本** | `GET /version` | 部署版本信息 |

## 部署（本地 Windows + Cloudflare Tunnel）

**已废除**所有 Railway / 云服务器（Docker + Nginx / 1Panel）部署方式 —— 服务全部运行在本地 Windows 服务器上，通过 Cloudflare Tunnel 内网穿透对外提供公网访问，无需公网 IP 或任何云服务器。

```bash
# 1. 构建前端（产物 client/dist，由 Express 直接提供）
npm run build

# 2. 启动后端（生产模式，:3001；本地 SQLite，无需外部数据库）
cd server && NODE_ENV=production npx tsx src/index.ts

# 3. 启动存储节点（文件存于 D:/LineWebDrive，仅本机）
python storage-node/main.py

# 4. (可选) LineWeb CLI 一键管理本地服务
LineWebCLI.exe start|stop|status|update   # 详见 cli/README.md

# 5. 公网暴露：Cloudflare Tunnel 映射本地 :3001 → HTTPS 域名
cloudflared tunnel run <tunnel-name>      # 或临时快速隧道: cloudflared tunnel --url http://localhost:3001
```

- 服务器无需公网 IP：浏览器 → Cloudflare 边缘 → 隧道 → 本地 `127.0.0.1:3001`
- WebSocket（`/ws/storage`）经隧道正常传输（Cloudflare Tunnel 原生支持）
- 代码更新走本地：CLI `update`（`git reset --hard` 拉取 + 重装依赖）或 `autoupdate` 计划任务
- ⚠️ 历史遗留（保留存档）：Railway 部署（`docs/DRIVE_SETUP.md`）、Docker + Nginx 云服务器部署（`Dockerfile` / `docker-compose.yml` / `nginx.conf` / `docs/DEPLOYMENT_HTTP_3001.md`）；原 GitHub Actions 自动部署 workflow（`.github/workflows/deploy.yml`）**已删除**

## 设计系统

GitHub Primer 风格通过纯 CSS 实现：

- **设计令牌**：`variables.css` 定义 `--gh-*` 颜色、间距、字体、圆角和阴影令牌
- **组件样式**：`components.css` 提供 `.gh-btn`、`.gh-input`、`.gh-box`、`.gh-dialog` 等共享组件
- **主题系统**：支持 light、dark 和 auto 三种主题，使用语义化令牌适配明暗模式
- **命名约定**：BEM 风格 `.gh-*` 设计系统、`.drive-*` 网盘、`.admin-*` 管理面板

## License

MIT
