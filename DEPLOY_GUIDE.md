# LineWeb 部署指南

> 适用环境: 宝塔面板 + OpenCloudOS 9 + PM2 + Nginx + MySQL

---

## 📋 前置检查

```bash
# 确认环境
node -v          # ≥ v24
npm -v           
pm2 -v           
mysql --version  # MySQL 8+
```

---

## 🚀 标准部署（Webhook 自动触发）

GitHub Push → Webhook (端口 9000) → `deploy.sh` 自动执行：

```
git fetch + reset --hard → npm install → npm run build
→ generate-mysql-schema.js → prisma db push → pm2 restart lineweb
```

**查看部署日志**:
```bash
tail -f /www/wwwroot/lineweb/deploy.log
```

---

## 🔧 手动部署（网络受限时）

如果服务器无法访问 GitHub：

### 1. 拉取代码（选一种方式）

```bash
# 方式A: 直接 git（需 GitHub 可达）
cd /www/wwwroot/lineweb
git fetch origin master && git reset --hard origin/master

# 方式B: 上传 zip 解压
# 本地: git archive -o lineweb.zip HEAD
# 上传到服务器后:
cd /www/wwwroot/lineweb
unzip -o lineweb.zip
```

### 2. 安装依赖

```bash
cd /www/wwwroot/lineweb
npm install
cd server && npm install && cd ..
cd client && npm install && cd ..
```

### 3. 构建前端

```bash
cd /www/wwwroot/lineweb/client
npx vite build
```

### 4. 同步数据库

```bash
cd /www/wwwroot/lineweb/server

# 设置数据库连接（从 ecosystem.config.js 读取）
export DATABASE_URL="mysql://lineweb:密码@127.0.0.1:3306/lineweb"

# 生成 MySQL schema 并 push
node scripts/generate-mysql-schema.js

# 清理临时文件
rm -f prisma.config.ts prisma/schema.mysql.generated.prisma
```

### 5. 重启服务

```bash
cd /www/wwwroot/lineweb
pm2 restart lineweb
pm2 status         # 确认 online
```

---

## 🐛 常见问题

### Q1: `Error: datasource.url is no longer supported`

Prisma 7 不再支持 schema 中的 `url` 字段。已修复：
- `schema.prisma` 移除了 `url` 行
- `prisma.config.ts` 统一管理连接 URL
- `lib/prisma.ts` 使用 `datasourceUrl` 参数

### Q2: `PrismaClient needs constructor options`

```bash
# 确认 prisma.ts 已更新
cat /www/wwwroot/lineweb/server/src/lib/prisma.ts
# 应包含: datasourceUrl: process.env.DATABASE_URL
```

### Q3: `Cannot find module @prisma/client`

```bash
cd /www/wwwroot/lineweb/server
npm install
npx prisma generate
pm2 restart lineweb
```

### Q4: PM2 process not found

```bash
cd /www/wwwroot/lineweb
pm2 start ecosystem.config.js --only lineweb
```

### Q5: DATABASE_URL 未设置

```bash
# 检查 ecosystem.config.js
cat /www/wwwroot/lineweb/ecosystem.config.js | grep DATABASE_URL

# 手动设置
export DATABASE_URL="mysql://lineweb:密码@127.0.0.1:3306/lineweb"
```

---

## 📊 验证部署

```bash
# 1. API 健康检查
curl http://localhost:3001/api/health
# 期望: {"status":"ok","db":"connected"}

# 2. 前端页面
curl -o /dev/null -w "%{http_code}" http://localhost:3001/
# 期望: 200

# 3. PM2 状态
pm2 status
# 期望: lineweb status=online

# 4. 实时日志
pm2 logs lineweb --lines 20
```

---

## 📁 关键文件位置

| 文件 | 路径 | 用途 |
|------|------|------|
| 项目根目录 | `/www/wwwroot/lineweb` | 全部代码 |
| 部署脚本 | `scripts/deploy.sh` | Webhook 触发 |
| Webhook 服务 | `scripts/webhook-server.mjs` | 端口 9000 |
| PM2 配置 | `ecosystem.config.js` | 进程管理 |
| Nginx 配置 | `scripts/lineweb.nginx.conf` | 反向代理 |
| 部署日志 | `/www/wwwroot/lineweb/deploy.log` | 问题排查 |
| PM2 日志 | `~/.pm2/logs/` | 运行时日志 |
| 数据库 | MySQL `lineweb` 库 | 127.0.0.1:3306 |
