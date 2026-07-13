# Linux 自托管部署设计

## 概述

将 LineWeb 从 Railway 平台迁移到用户自有的 OpenCloudOS 9 云服务器（2GB 内存 / 200GB 磁盘），通过 IP 访问（无域名 / 无 HTTPS），实现 GitHub push 自动触发重新部署。

## 目标环境

- **操作系统**: OpenCloudOS 9（RHEL/CentOS 9 系，dnf + systemd）
- **内存**: 2GB
- **磁盘**: 200GB
- **访问方式**: IP 直接访问，端口 3001
- **数据库**: SQLite（节省内存，免除 PostgreSQL 进程开销）
- **存储节点**: 留在用户本地电脑，不上云

## 架构

```
/opt/lineweb/                    # 项目根目录
├── .git/                        # Git 仓库（跟踪 GitHub）
├── client/dist/                 # Vite 构建产物
├── server/
│   ├── .env                     # 生产环境变量
│   └── prisma/lineweb.db        # SQLite 数据库文件
├── webhook-server.mjs           # GitHub Webhook 监听器（端口 9000）
└── deploy.sh                    # 自动部署脚本
```

### systemd 服务

| 服务名 | 端口 | 作用 |
|--------|------|------|
| `lineweb.service` | 3001 | Express 后端 + 托管前端静态文件 |
| `lineweb-webhook.service` | 9000 | 监听 GitHub push webhook，触发 deploy.sh |

### 流程

```
GitHub push → webhook POST http://<IP>:9000/github-webhook
  → webhook-server.mjs 验证签名
    → 执行 deploy.sh
      → git pull
      → npm install (如有依赖变更)
      → npm run build (Vite 构建)
      → npx prisma db push (同步 SQLite schema)
      → systemctl restart lineweb.service
```

## 生产启动命令

`serve.sh`（lineweb.service 的 ExecStart）：

```bash
export NODE_ENV=production
npm run build
npx prisma db push && npx prisma db seed
npx tsx server/src/index.ts
```

Express 在生产模式下自动托管 `client/dist/`，所有非 `/api` 非 `/ws` 请求返回 `index.html`（SPA 路由回退）。

## 环境变量

`server/.env` 生产配置：

```
DATABASE_URL="file:./lineweb.db"
JWT_SECRET=<用户生成的安全随机字符串>
PORT=3001
NODE_ENV=production
CORS_ORIGIN=""
STORAGE_NODE_TOKEN=<用户生成的安全随机字符串>
MAX_FILE_SIZE_MB=10240
```

## Webhook 安全

- GitHub webhook secret 用于 HMAC-SHA256 签名验证
- webhook-server.mjs 仅接受来自 GitHub 的 push 事件
- 监听的端口 9000 仅接受 POST /github-webhook

## 依赖安装

服务器需预装：
- Node.js >= 18（通过 dnf module 或 nvm）
- git

`npm install` 在项目根目录执行，通过 `postinstall` 脚本自动安装 server 和 client 依赖。

## 数据库初始化

首次部署执行：
```bash
cd /opt/lineweb
npx prisma db push    # 创建 SQLite 表
npx prisma db seed    # 填充管理员账户
```
后续每次 webhook 部署时仅执行 `npx prisma db push`（增量同步 schema 变更）。

## 防火墙

需开放端口：
- 3001：Web 服务
- 9000：GitHub Webhook 接收

```bash
firewall-cmd --add-port=3001/tcp --permanent
firewall-cmd --add-port=9000/tcp --permanent
firewall-cmd --reload
```

## 非目标

- 不引入 Docker / nginx / SSL
- 不迁移存储节点
- 不配置 CI/CD 流水线（仅用 webhook）
- 不引入域名
