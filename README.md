# Line Web

LineWeb 采用 GitHub Primer 风格：浅色/暗色主题、细边框、克制阴影、8px 圆角和明确的 focus ring。

React 19 SPA 前端 + Express 4 REST API 后端 + Python 3 WebSocket 文件存储节点。

## 特性

- **GitHub Primer 设计** — 语义化 CSS 令牌、边框式信息层级与明暗主题
- 📝 **文章系统** — Markdown 写作、发布与管理
- ☁️ **网盘** — 文件上传/下载/预览/搜索，文件夹管理，批量操作，收藏夹跨设备同步
- 🧮 **在线计算器** — 基础运算与科学计算
- 🎮 **游戏大厅** — 2048 单机 / 好友联机对战；联机与好友关系打通，支持无 WebSocket 的 HTTP 轮询降级
- 💬 **实时聊天** — 好友/私聊/群聊、图片消息与 2 分钟撤回；WebSocket 不可用时自动切换轮询
- 🔐 **认证系统** — 账号登录令牌（JWT）单一认证 + 角色能力矩阵，管理员面板
- 🖼️ **页面构建器** — 可视化控件树，自定义功能页面
- 📊 **屏幕时间追踪** — 跨设备使用统计与目标管理
- 🌓 **智能主题** — 亮色/暗色模式，跟随系统或手动切换
- 📱 **响应式设计** — 桌面端与移动端完美适配
- ☁️ **阿里云 ECS 部署** — Ubuntu 云服务器上以 1Panel + Docker Compose 承载 Express 与 PostgreSQL，公网 IP 直接访问
- 🔗 **远程存储节点** — 存储节点仍运行在本地 Windows，文件不出本机，经 WebSocket 连接云端服务端

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite 6, TypeScript, React Router 7, TanStack React Query |
| 后端 | Express 4, Prisma 6, JWT, Zod, tsx 运行时 |
| 数据库 | SQLite（本地开发） / PostgreSQL 16（生产，1Panel 上的容器） |
| 存储节点 | Python 3 + websockets 库，WebSocket 二进制流传输 |
| 设计 | GitHub Primer 风格，CSS 变量令牌、`.gh-*` BEM 组件和 light/dark/auto 主题 |
| 部署 | 阿里云 ECS（Ubuntu）：1Panel + Docker Compose，Express + PostgreSQL 16 容器；存储在本地 Windows |

## 架构

```
┌──────────────┐     HTTPS/API     ┌────────────────────────┐     WebSocket      ┌──────────────────┐
│  浏览器        │ ◄──────────────► │  Cloudflare 边缘        │                    │  Storage Node    │
│  (React SPA)  │ web.linetech.online│  ↓ Cloudflare Tunnel  │                    │  (Python)        │
└──────────────┘                  └───────────┬────────────┘                    │  本地 Windows     │
                                              │ 隧道（出站 7844）                  │  D:/LineWebDrive │
┌──────────────┐     HTTP/API      ┌───────────▼────────────┐     WebSocket      └──────────────────┘
│  浏览器(备用)  │ ◄──────────────► │  阿里云 ECS (Ubuntu)    │ ◄───────────────►  ws:// 或 wss://
│               │   公网 IP :3001   │  1Panel + Docker Compose│   /ws/storage
└──────────────┘                  │  Express 容器          │
                                   │  + PostgreSQL 16 容器   │
                                   └────────────────────────┘

开发：  Vite :5173 → 代理 /api → Express :3001（本地）
生产：  阿里云 ECS 上 1Panel + Docker Compose：Express 容器 :3001 提供 client/dist + /api，PostgreSQL 16 容器提供数据库
公网：  https://web.linetech.online（Cloudflare Tunnel → 本机 127.0.0.1:3001，HTTPS 由 Cloudflare 提供）
        IP 直连 http://<ECS 公网 IP>:3001 作为备用入口（阿里云按 Host 头拦截未备案域名，故域名只能走隧道）
存储：  本地 Windows 存储节点主动外连 wss://web.linetech.online/ws/storage（或直连 ws://<ECS IP>:3001/ws/storage），文件不出本机
备用：  本地 Windows 全栈（开发/应急，见「本地方案」）
```

## 快速开始

### 前置要求

- Node.js 18+（ECS 上建议 20 LTS）
- Python 3.10+（存储节点运行在**本地 Windows 机器**上）
- 生产：阿里云 ECS（Ubuntu）+ 弹性公网 IP
- 可选：cloudflared（Cloudflare Tunnel，仅本地方案/开发调试使用）

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
│   │   ├── middleware/   # 认证（账号登录令牌）、错误处理
│   │   ├── routes/      # 12 个路由模块（全部前缀 /api）
│   │   ├── services/    # 业务逻辑（auth、drive、storage 等）
│   │   └── lib/         # Prisma 单例、工具函数
│   └── prisma/          # 数据库 schema、种子数据
├── storage-node/        # Python 3 WebSocket 文件存储节点
├── cli/                 # LineWeb CLI 本地管理工具（打包为 exe）
├── scripts/             # 运维脚本（14 个）
├── docs/                # API 文档、部署指南、设计系统文档
├── Dockerfile           # 生产使用：Docker 镜像（多阶段：vite 构建前端 + tsx 运行后端）
├── docker-compose.yml   # 生产使用：容器编排（Express + 外部 PostgreSQL 16，1panel-network）
├── nginx.conf           # 备选：Nginx/OpenResty 反向代理（启用域名 + HTTPS 后使用）
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
npm run start            # 遗留入口：构建 client → 生成 PG schema → 本地直跑 tsx；生产部署请用「部署」章节的 docker compose 流程

# 数据库
npm run db:push          # prisma db push
npm run db:seed          # 种子数据
npm run db:studio        # prisma studio GUI

# 测试（仅 client）
cd client && npm run test        # vitest run（14 个测试文件）
cd client && npm run test:watch  # vitest watch

# 生产部署（在当前机器上执行，ECS 上即为生产；详见「部署」章节）
cd /opt/lineweb && docker compose up -d --build    # 构建并启动
docker compose logs -f server                      # 查看日志
docker compose restart server                      # 重启
# 或使用根目录快捷脚本：
npm run docker:up        # docker compose up -d
npm run docker:down      # docker compose down（不要加 -v，会删数据卷）
npm run docker:build     # docker compose build
npm run docker:logs      # 查看 server 日志
npm run docker:restart   # 重启 server 容器
```

## API 概览

所有 API 前缀 `/api`。认证方式只有一种：**账号登录令牌** —— 先 `POST /api/auth/login` 换取 `token`，之后所有请求携带 `Authorization: Bearer <token>`。令牌只签 `{ userId, role }`，能力与网盘开关每次请求从数据库解析，因此角色变更即时生效。

> 完整的登录认证接入说明（端点、令牌生命周期、能力矩阵、错误码、curl/TS/Python 示例、迁移与自检清单）见 **[`docs/auth-api.md`](docs/auth-api.md)**；全部端点详解见 [`docs/api.md`](docs/api.md)。

> **第三方应用**（桌面/移动客户端、外部网站）接入请使用 OAuth 2.0 授权码 + PKCE 流程，不要在应用中保存用户密码：应用由管理员在 `/admin/apps` 注册后跳转 `/authorize` 让用户确认授权，再用授权码换取**作用域受限**的访问令牌（无法获得任何管理能力）。完整说明见 **[`docs/app-auth-api.md`](docs/app-auth-api.md)**。

> 自 2026-09 起统一为账号登录令牌：API Key（`X-API-Key`、`lw_` 前缀）与屏幕时间 Token（`X-Screen-Time-Token`、`st_` 前缀）已移除，相关端点与数据表均已删除，旧密钥全部失效。第三方设备（如 Time Master）可继续用账号登录 + `rememberDays`（1–90 天）长期令牌，**或改用 OAuth 授权流程**获得更小权限面。

| 路由模块 | 主要端点 | 说明 |
|---------|---------|------|
| **认证** | `POST /auth/login|register`、`GET /auth/me` | 登录/注册/个人信息 |
| **第三方应用授权** | `POST /oauth/token|revoke`、`GET /oauth/authorize-context`、`POST /oauth/authorize`、`GET /oauth/grants`、`/oauth/clients` | OAuth 2.0 授权码 + PKCE；`/authorize` 为账户验证页，`/admin/apps` 注册应用，个人资料页可撤销 |
| **文章** | `GET /posts`、`GET/POST/PUT/DELETE /posts/:id` | 公开列表 + 内容编辑（`content:write`）CRUD |
| **评论** | `GET/POST /comments/post/:id`、嵌套回复 | 树形评论系统 |
| **页面** | `GET /pages/featured|slug/:slug`、管理端 CRUD | 可视化页面构建器（`content:write`） |
| **网盘** | `GET/POST /drive/files`、`POST /drive/upload`、`GET /drive/files/:id/download` | 完整文件管理 |
| **网盘收藏** | `GET/POST/DELETE /drive/favorites` | 文件夹收藏跨设备同步 |
| **头像** | `POST/GET/DELETE /avatar` | 用户头像上传 |
| **用户管理** | `GET/PUT /users`、`PUT /users/:id/drive-access` | admin 用户管理 |
| **API 接入** | `GET /api` | 自描述端点清单；管理面板 `/admin/api` 为账号登录接入指南页 |
| **统计** | `GET /stats/public`、`GET /stats` | 公开/管理统计 |
| **设备** | `GET /devices` | 在线设备追踪（admin） |
| **健康** | `GET /health`、`GET/PUT /health/daily-goal`、`POST /health/push` | 健康检查 + 屏幕时间读写（第三方推送用登录令牌或应用令牌） |
| **版本** | `GET /version` | 部署版本信息 |

## 部署（阿里云 ECS）

> **现状（2026-09-27 实测）**：生产环境为**阿里云 ECS**（Ubuntu 24.04，公网 IP `<ECS 公网 IP>`），用 **1Panel 管理 + Docker Compose 部署**：Express 容器（`:3001`）+ PostgreSQL 16 容器。**公网入口是 `https://web.linetech.online`**（Cloudflare Tunnel 出站隧道，HTTPS 由 Cloudflare 提供）；**存储节点仍运行在本地 Windows 机器上**，文件保存在 `D:/LineWebDrive`，不出本机，由节点主动外连云端服务端。

| 组件 | 位置 | 说明 |
|------|------|------|
| 公网入口 | Cloudflare 边缘 | **`https://web.linetech.online`** → Cloudflare Tunnel → 本机 `127.0.0.1:3001`；IP 直连 `http://<ECS 公网 IP>:3001` 作为备用入口 |
| 隧道连接器 | ECS | `cloudflared`（systemd 服务 `cloudflared`，开机自启），隧道 `lineweb-ecs`，出站 TCP/QUIC 7844 |
| 1Panel 面板 | ECS `:18080` | `http://<ECS 公网 IP>:18080/lineweb_panel`，管理容器、数据库、防火墙、终端、证书。**不要绑定面板域名**（绑了会拒绝 IP 访问，见第 6 节） |
| Express 服务端（容器 `lineweb-server-1`） | ECS，代码 `/opt/lineweb` | `3001:3001`，`restart: unless-stopped`，镜像由 `Dockerfile` 多阶段构建 |
| React SPA | 同上 | 构建产物 `client/dist` 打进镜像，由 Express 直接托管（静态资源 + SPA fallback） |
| PostgreSQL 16（容器 `lineweb-postgres`） | ECS，数据卷 `lineweb-pg-data` | 挂 `1panel-network`；schema 由入口脚本从 SQLite 改写为 PostgreSQL 后 `db push` + `seed` |
| 存储节点（Python） | **本地 Windows** | 文件存 `D:/LineWebDrive`；推荐连 `wss://web.linetech.online/ws/storage`（已实测 WebSocket 101），直连 `ws://<ECS 公网 IP>:3001/ws/storage` 为备选 |

### 1. 安装 1Panel（自动装 Docker）

```bash
PANEL_NON_INTERACTIVE=true PANEL_LANG=zh PANEL_INSTALL_DIR=/opt \
PANEL_PORT=18080 PANEL_ENTRANCE=<安全入口> PANEL_USERNAME=<用户名> PANEL_PASSWORD='<强密码>' \
PANEL_INSTALL_DOCKER=y PANEL_DOCKER_MODE=auto \
bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"
```

安装完成后可用 `1pctl user-info` 查看面板地址、账号与安全入口。

### 2. 配置 Docker 镜像加速（国内机器必需）

该机器**直连 Docker Hub 会超时**，需先在 `/etc/docker/daemon.json` 写入加速地址：

```json
{ "registry-mirrors": ["https://docker.1panel.live", "https://docker.m.daocloud.io", "https://docker.1ms.run"] }
```

```bash
systemctl restart docker && docker info | grep -A3 "Registry Mirrors"
```

### 3. 创建网络、数据卷与 PostgreSQL 容器

```bash
docker network create 1panel-network      # 1Panel 已创建时会提示已存在
docker volume create lineweb-pg-data
docker run -d --name lineweb-postgres --network 1panel-network --restart unless-stopped \
  -e POSTGRES_USER=lineweb -e POSTGRES_PASSWORD='<强随机密码>' -e POSTGRES_DB=lineweb \
  -v lineweb-pg-data:/var/lib/postgresql/data postgres:16-alpine
```

### 4. 取代码并写 `/opt/lineweb/.env`

```bash
git clone https://github.com/LinePixel2025/LineWeb.git /opt/lineweb
cd /opt/lineweb
cat > .env <<'EOF'
DATABASE_URL=postgresql://lineweb:<PG密码>@lineweb-postgres:5432/lineweb
JWT_SECRET=<openssl rand -hex 32>
STORAGE_NODE_TOKEN=<openssl rand -hex 32；必须与本地存储节点 config.json 的 token 一致>
CORS_ORIGIN=
MAX_FILE_SIZE_MB=10240
DATABASE_POOL_SIZE=10
DATABASE_POOL_TIMEOUT=30
EOF
chmod 600 .env
```

> 国内服务器直连 GitHub 极慢（实测 clone 两分钟仅约 200KB），可改用镜像/代理，或在本地 `git bundle create lw.bundle --all` 后上传、在服务器 `git clone lw.bundle /opt/lineweb`。

### 5. 构建并启动

```bash
cd /opt/lineweb
docker compose up -d --build
docker compose ps                              # 期望 STATUS 为 healthy
docker compose logs -f server                  # 首次会执行 schema 转换 + db push + seed
curl -s http://127.0.0.1:3001/api/health       # {"status":"ok","db":"connected",...}
```

### 6. 公网入口：域名 + HTTPS（Cloudflare Tunnel）+ 安全组

#### 6.1 为什么必须用隧道（重点）

阿里云大陆节点会**按 HTTP `Host` 头**拦截未备案域名，返回 `403` + `Server: Beaver` + `Non-compliance ICP Filing` 页面。实测结论：

- 带 `Host: web.linetech.online` 直连 `IP:3001` → **403**（换端口无效，拦截与端口无关）；
- 走 Cloudflare 橙云 A 记录回源，回源请求的 `Host` 仍是未备案域名 → **同样 403**；
- Cloudflare 免费版**不代理 3001 端口**，所以 `web.linetech.online:3001` 直接超时。

**Cloudflare Tunnel 是出站隧道**：`cloudflared` 主动外连 Cloudflare，公网流量从不以「带该域名的入站请求」打到 ECS，因此不触发备案拦截，并且顺带得到 HTTPS 且无需公网开放源站端口。

> ⚠️ 合规提示：让未备案域名指向大陆服务器属于 ICP 备案的合规灰区——隧道只规避了技术拦截。要彻底合规需完成 ICP 备案（`.online` 后缀能否备案需先核实），或把服务器换到非大陆区域（香港/新加坡等，免备案）。

#### 6.2 一次性配置（已完成，此处为复现步骤）

```bash
# 1) 服务器安装 cloudflared（GitHub 直连慢时，可从本机下载二进制再上传）
install -m 0755 cloudflared-linux-amd64 /usr/local/bin/cloudflared
cloudflared --version

# 2) 在 Cloudflare 侧创建命名隧道并配置入口（也可用 API 完成）
#    隧道名 lineweb-ecs：public hostname = web.linetech.online -> http://127.0.0.1:3001

# 3) 把隧道 Token 装成开机自启服务（Token 经 stdin 传入，避免留在命令历史里）
echo '<TUNNEL_TOKEN>' | ssh root@<ECS IP> 'cloudflared service install $(cat)'
systemctl is-enabled cloudflared && systemctl is-active cloudflared

# 4) DNS：web.linetech.online 用 CNAME -> <隧道ID>.cfargotunnel.com（Cloudflare 代理开启）
```

#### 6.3 安全组

- 放行 `3001`：**IP 直连入口与存储节点直连仍在使用**；若存储节点改走 `wss://` 隧道，可关闭该端口；
- 放行 `18080`：1Panel 面板；
- 放行 `22`：SSH；
- 建议来源限制为可信 IP。

#### 6.4 面板域名绑定的坑

**不要在 1Panel 里给面板绑定域名**（`面板设置 → 域名绑定`）：绑定后任何 Host 不匹配的请求都会被拒绝，表现为打开面板只显示 *Access Temporarily Unavailable*，让人误以为面板挂了。恢复：

```bash
1pctl reset domain          # 取消面板域名绑定
systemctl restart 1panel-core   # 复位后需要重启才生效
```

### 7. 验收清单

1. `https://web.linetech.online/api/health` 返回 200 且 `db` 为 `connected`（IP 直连 `http://<ECS 公网 IP>:3001/api/health` 同样 200）
2. 浏览器打开 `https://web.linetech.online/` 可加载前端并登录（种子账号 `admin@lineweb.dev` / `admin123`，登录后请改密）
3. `wss://web.linetech.online/ws/storage` WebSocket 握手返回 `101`（存储节点可经隧道走 wss）
4. `docker compose ps` 中 server 为 healthy；`docker ps` 可见 `lineweb-postgres`
5. 本地存储节点连接成功后，`/api/health` 的 `storageNode` 变为 `connected`
6. 网盘上传/下载/重命名/删除正常，`D:/LineWebDrive` 中可见对应文件

### 8. 更新与回滚

⚠️ **服务器无法直连 GitHub**，因此不能在服务器上直接 `git pull`。两种可用方式：

```bash
# 方式 A：本地打 bundle 上传（无需 GitHub 可达）
#   本地：git bundle create lw.bundle --all && scp lw.bundle root@<ECS IP>:/root/
cd /opt/lineweb && git fetch /root/lw.bundle master && git reset --hard FETCH_HEAD

# 方式 B：从本地机器 push 到服务器（本地→服务器 SSH 可达）
#   服务器：cd /opt/lineweb && git config receive.denyCurrentBranch updateInstead
#   本地：git remote add aliyun ssh://root@<ECS IP>/opt/lineweb && git push aliyun master

# 更新后重建并校验
cd /opt/lineweb && docker compose up -d --build && docker compose ps
curl -f http://127.0.0.1:3001/api/health
```

回滚：`git reset --hard <目标提交>` 后同样执行 `docker compose up -d --build`。备份建议：

```bash
docker exec lineweb-postgres pg_dump -U lineweb lineweb > /root/lineweb-$(date +%F).sql
```

项目**不使用迁移文件**（约定只用 `prisma db push`，无数据库回滚能力）；PostgreSQL 数据在卷 `lineweb-pg-data`，网盘文件在本地 `D:/LineWebDrive`，备份策略相互独立。

### 本地方案（开发 / 备用，非生产）

本地 Windows 全栈 + Cloudflare Tunnel 内网穿透仅用于开发与应急：

```bash
npm run dev                                   # 开发：Vite :5173 + Express :3001
npm run build && cd server && NODE_ENV=production npx tsx src/index.ts   # 本地生产模式验证
python storage-node/main.py                   # 节点指向 ws://localhost:3001/ws/storage
cloudflared tunnel run <tunnel-name>          # 可选：临时对外暴露本地服务
LineWebCLI.exe start|stop|status|update       # 本地服务一键管理，详见 cli/README.md
```

- 本地与云端是**两套独立环境**：SQLite 数据库与存储节点数据互不相通，切换时注意数据来源。

### 已知限制与待办

- **服务器无法直连 GitHub** — 实测 `git clone` 两分钟仅约 200KB，服务器上 `git pull` 不可用；更新走「本地 bundle 上传」或「本地 push」（见第 8 节），或日后配置镜像/代理。
- **存储节点状态（2026-10-17 实测）** — 生产 `/api/health` 返回 `"storageNode":"connected"`，网盘与头像可用；但**本机没有运行节点**，且仓库 `storage-node/config.json` 仍指向已不可达的 `ws://123.207.8.77:3001`，说明线上接入的是另一份配置/另一台机器（来源待确认）。若要在本机跑节点：把 `serverUrl` 改为 `wss://web.linetech.online/ws/storage`（推荐，走隧道且加密）或 `ws://<ECS 公网 IP>:3001/ws/storage`（直连），并让其 `token` 与服务器 `/opt/lineweb/.env` 的 `STORAGE_NODE_TOKEN` 一致。
- **安全组** — 当前放行 `22`（SSH）、`18080`（面板）、`3001`（IP 直连与存储节点直连）。若存储节点改走 `wss://` 隧道，可以关闭 `3001` 公网入口；建议三者的来源都收敛到可信 IP。
- **域名走隧道属于合规灰区** — 大陆节点要求指向它的域名完成 ICP 备案，隧道只是规避了技术拦截（详见第 6.1 节）。要彻底合规：完成备案，或把服务器迁到非大陆区域（免备案）。
- **面板不要绑定域名** — 1Panel 面板继续用 `http://<ECS 公网 IP>:18080/lineweb_panel` 访问；一旦绑定域名，用 IP 打开只会看到 *Access Temporarily Unavailable*，用 `1pctl reset domain` + `systemctl restart 1panel-core` 恢复。
- **自动部署** — 原 GitHub Actions workflow（`.github/workflows/deploy.yml`）已删除，可另行恢复。
- ⚠️ 历史存档（不再是生产路径）：Railway 部署（`docs/DRIVE_SETUP.md` 第 1 章）。

## 设计系统

GitHub Primer 风格通过纯 CSS 实现：

- **设计令牌**：`variables.css` 定义 `--gh-*` 颜色、间距、字体、圆角和阴影令牌
- **组件样式**：`components.css` 提供 `.gh-btn`、`.gh-input`、`.gh-box`、`.gh-dialog` 等共享组件
- **主题系统**：支持 light、dark 和 auto 三种主题，使用语义化令牌适配明暗模式
- **命名约定**：BEM 风格 `.gh-*` 设计系统、`.drive-*` 网盘、`.admin-*` 管理面板

## License

MIT
