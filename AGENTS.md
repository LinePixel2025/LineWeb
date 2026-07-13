# AGENTS.md — LineWeb

## 架构

- **Monorepo**: 根目录用 `concurrently` 同时启动 `server/`（Express + Prisma，端口 3001）和 `client/`（React 19 + Vite，端口 5173）。
- **数据库**: 通过 Prisma 使用 SQLite（`server/prisma/lineweb.db`）。README 里写的 MySQL 是错的，以 `schema.prisma` 为准（`provider = "sqlite"`）。
- **生产环境**: 宝塔面板 + OpenCloudOS 9 自托管服务器。使用 MySQL（宝塔内置）替代 SQLite，通过 `server/scripts/generate-mysql-schema.js` 转换 schema。PM2 管理进程（`ecosystem.config.js`，含敏感信息已加入 `.gitignore`），Nginx 反向代理。GitHub Webhook（端口 9000）监听 push 事件自动触发 `scripts/deploy.sh` 完成 git pull → npm install → build → db push → pm2 restart。
- **认证**: JWT（`Authorization: Bearer <token>`），token 存在 `localStorage` 的 `lineweb_token` 键下。同时支持 API Key（`X-API-Key: <key>`）。客户端收到 401 时自动跳转 `/login`（但 `/auth/login`、`/auth/register`、`/auth/me` 这三个路径除外）。
- **所有 API 端点都需要认证**，以下公开路径除外：`/auth/login`、`/auth/register`、`/health`、`/posts`、`/pages/featured`、`/pages/slug`、`/bing-wallpaper`、`/stats/public`。认证检查在 `server/src/index.ts` 中通过全局中间件完成。
- **存储节点**: 独立的 Python 服务（`storage-node/`）通过 WebSocket 连接，用于网盘功能的文件操作，留在本地电脑不部署到服务器。

## 命令

```bash
npm run dev          # 同时启动前后端
npm run dev:server   # 仅后端（端口 3001）
npm run dev:client   # 仅前端（端口 5173）
npm run build        # 构建前端（tsc + vite build）
npm run db:push      # 同步 Prisma schema 到 SQLite
npm run db:seed      # 填充种子数据（admin@lineweb.dev / admin123）
npm run db:studio    # Prisma Studio 图形界面
npm run test         # 前端测试 — 需要在 client/ 目录下运行：cd client && npm run test
```

## 关键约定

- **无 lint/格式化工具**: 项目只用了 TypeScript，没有 ESLint、Prettier、EditorConfig。不要运行 lint 命令。
- **Server 端用 `.js` 后缀导入**: server 代码里写 `import ... from './foo.js'`，即使实际文件是 `.ts`。这是因为 ESM 的 `moduleResolution: "bundler"` 配合 `tsx` 运行时。新增 server 文件导入时务必加 `.js` 后缀。
- **路径别名**: client 端使用 `@/*` → `client/src/*`（在 `client/tsconfig.json` 和 `vite.config.ts` 中配置）。
- **测试**: Vitest + jsdom + `@testing-library`。setup 文件：`client/src/test-setup.ts`。测试文件与被测代码放在同目录的 `__tests__/` 下。
- **代码分割**: `App.tsx` 中所有页面使用 `React.lazy()` 做路由级代码分割。
- **中文为主**: 代码注释和 UI 文案使用中文，默认语言为 `zh-CN`。
- **无 CI/CD**: 仓库没有 GitHub Actions，使用 GitHub Webhook + 服务器端 `scripts/deploy.sh` 实现自动部署。

## 部署速查

- **服务器**: 123.207.8.77 (腾讯云 OpenCloudOS 9)
- **面板**: 宝塔 Linux 面板
- **项目路径**: `/www/wwwroot/lineweb`
- **Webhook 端口**: 9000
- **部署日志**: `/www/wwwroot/lineweb/deploy.log`
- **关键文件**: `ecosystem.config.js` 含敏感信息，已加入 `.gitignore`，服务器上用 `git update-index --skip-worktree` 防止被覆盖

## 数据库须知

- `server/.env` 虽然被 `.gitignore` 忽略（`*.env`），但已提交到仓库。如需新增环境变量，也请同步更新 `server/.env`。
- 开发环境用 `db:push` 同步 schema，不用 migration。生产环境通过 `generate-mysql-schema.js` 转换为 MySQL 格式。
- 种子数据创建的管理员账号：`admin@lineweb.dev` / `admin123`。

## 语言

- 所有回复使用中文。
