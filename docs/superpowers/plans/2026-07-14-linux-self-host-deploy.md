# Linux 自托管部署 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCloudOS 9 服务器上部署 LineWeb，并通过 GitHub webhook 实现 push 自动重新部署

**Architecture:** 项目部署到 `/opt/lineweb/`，Express 在生产模式下同时提供 API（端口 3001）和前端静态文件。独立的 webhook 监听器（端口 9000）接收 GitHub push 事件后执行自动更新脚本。两个进程均由 systemd 管理，SQLite 直接读写。

**Tech Stack:** Node.js 18+, systemd, SQLite, tsx, Vite build

## 全局约束

- 操作系统：OpenCloudOS 9 (RHEL 9 系，dnf + systemd)
- 数据库：SQLite，不引入 PostgreSQL
- 存储节点：不部署到服务器，留在本地
- 无 Docker、无 nginx、无域名、无 HTTPS
- 生产环境必须设置 JWT_SECRET 和 STORAGE_NODE_TOKEN

---

### Task 1: 创建生产启动脚本

**Files:**
- Create: `scripts/serve.sh`
- Modify: `server/package.json`

**Interfaces:**
- Produces: `serve.sh` — 被 systemd 的 `ExecStart` 调用，返回 Node 进程（永不退出，由 systemd 管理生命周期）

**说明:** 当前根 `package.json` 的 `start` 脚本包含 `generate-pg-schema.js`（PostgreSQL 转换），SQLite 部署需要跳过。新建独立的 `serve.sh` 处理 SQLite 生产启动流程。同时修改根 `package.json` 的 `start` 脚本，使其在 `server/` 目录下正确执行 tsx。

- [ ] **Step 1: 创建 serve.sh**

`scripts/serve.sh`:

```bash
#!/bin/bash
set -e

cd /opt/lineweb

export NODE_ENV=production

echo "[serve.sh] 构建前端..."
npx vite build --outDir client/dist

echo "[serve.sh] 同步数据库..."
npx prisma db push --schema=server/prisma/schema.prisma

echo "[serve.sh] 启动服务 (端口 ${PORT:-3001})..."
npx tsx server/src/index.ts
```

- [ ] **Step 2: 修复根 package.json 的 start 脚本**

`package.json` 中，`start` 脚本中的 `cd server && NODE_ENV=production npx tsx src/index.ts` 会在 cd 后从 `server/src/index.ts` 寻找文件，但此时 `npx tsx` 在 server 目录下执行，路径正确。需要确认 — 实际上此处没问题，`cd server` 后 `src/index.ts` 就是 `server/src/index.ts`。

但 `npm run build` 中的 `cd client` 会在 client 目录下执行 `npx vite build`，这也是正确的。

然而，未来执行 `serve.sh` 时，`npx prisma db push --schema` 需要从 server 目录的 prisma 执行。让我们调整：

`scripts/serve.sh`:

```bash
#!/bin/bash
set -e

cd /opt/lineweb
export NODE_ENV=production

echo "[serve.sh] 构建前端..."
cd client && npx vite build && cd ..

echo "[serve.sh] 同步数据库..."
cd server && npx prisma db push && cd ..

echo "[serve.sh] 启动服务 (端口 ${PORT:-3001})..."
npx tsx server/src/index.ts
```

- [ ] **Step 3: 设置可执行权限 (在服务器上执行)**

```bash
chmod +x /opt/lineweb/scripts/serve.sh
```

- [ ] **Step 4: 提交**

```bash
git add scripts/serve.sh
git commit -m "chore: 添加生产启动脚本 serve.sh (SQLite)"
```

---

### Task 2: 创建自动部署脚本

**Files:**
- Create: `scripts/deploy.sh`

**Interfaces:**
- Consumes: 被 `webhook-server.mjs` 通过 `child_process.spawn` 调用，无需参数
- Produces: 重启 `lineweb.service`，输出日志到 stdout/stderr

- [ ] **Step 1: 创建 deploy.sh**

`scripts/deploy.sh`:

```bash
#!/bin/bash
set -e

LOG_FILE="/opt/lineweb/deploy.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "========================================"
echo "[deploy] $(date '+%Y-%m-%d %H:%M:%S')"
echo "[deploy] 开始自动部署..."

cd /opt/lineweb

echo "[deploy] 拉取最新代码..."
git pull origin master

echo "[deploy] 安装依赖..."
npm install

echo "[deploy] 同步数据库..."
cd server && npx prisma db push && cd ..

echo "[deploy] 重启服务..."
systemctl restart lineweb.service

echo "[deploy] 部署完成"
```

- [ ] **Step 2: 提交**

```bash
git add scripts/deploy.sh
git commit -m "chore: 添加自动部署脚本 deploy.sh"
```

---

### Task 3: 创建 GitHub Webhook 监听器

**Files:**
- Create: `scripts/webhook-server.mjs`

**Interfaces:**
- Produces: HTTP 服务器监听 `0.0.0.0:9000`，仅响应 `POST /github-webhook`，验证 HMAC-SHA256 签名后执行 `deploy.sh`

**设计要点:**
- 纯 Node.js 内置模块（`http`, `crypto`, `child_process`），零外部依赖
- Webhook secret 从环境变量 `WEBHOOK_SECRET` 读取
- 验签失败返回 403，成功返回 200 后异步执行部署脚本
- 防止并发部署：用互斥锁确保同一时间只有一个部署在执行

- [ ] **Step 1: 创建 webhook-server.mjs**

`scripts/webhook-server.mjs`:

```javascript
import http from 'node:http'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'

const PORT = process.env.WEBHOOK_PORT || 9000
const SECRET = process.env.WEBHOOK_SECRET

if (!SECRET) {
  console.error('[webhook] 错误: WEBHOOK_SECRET 未设置')
  process.exit(1)
}

let deploying = false

function verifySignature(payload, signature) {
  const hmac = crypto.createHmac('sha256', SECRET)
  hmac.update(payload)
  const digest = 'sha256=' + hmac.digest('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
  } catch {
    return false
  }
}

function runDeploy() {
  if (deploying) {
    console.log('[webhook] 已有部署进行中，跳过')
    return
  }
  deploying = true
  console.log('[webhook] 开始执行 deploy.sh...')

  const proc = spawn('/bin/bash', ['/opt/lineweb/scripts/deploy.sh'], {
    detached: true,
    stdio: 'inherit',
  })

  proc.on('close', (code) => {
    deploying = false
    console.log(`[webhook] deploy.sh 退出，code=${code}`)
  })

  proc.on('error', (err) => {
    deploying = false
    console.error(`[webhook] deploy.sh 执行失败: ${err.message}`)
  })
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/github-webhook') {
    res.writeHead(404)
    res.end()
    return
  }

  const signature = req.headers['x-hub-signature-256'] || ''
  let body = ''

  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    if (!verifySignature(body, signature)) {
      console.log('[webhook] 签名验证失败')
      res.writeHead(403)
      res.end('Forbidden')
      return
    }

    console.log('[webhook] 收到 GitHub push 事件')
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('OK')
    runDeploy()
  })
})

server.listen(PORT, () => {
  console.log(`[webhook] 监听端口 ${PORT}`)
})
```

- [ ] **Step 2: 提交**

```bash
git add scripts/webhook-server.mjs
git commit -m "chore: 添加 GitHub webhook 监听器"
```

---

### Task 4: 创建 systemd 服务文件

**Files:**
- Create: `scripts/lineweb.service`
- Create: `scripts/lineweb-webhook.service`

**Interfaces:**
- Produces: 两个 systemd unit 文件，通过 `systemctl` 管理主服务和 webhook 监听器的生命周期

**说明:** 这些是模板文件，需要用户在服务器上复制到 `/etc/systemd/system/` 并调整路径。使用 `systemctl daemon-reload`、`systemctl enable`、`systemctl start` 启用。

- [ ] **Step 1: 创建 lineweb.service**

`scripts/lineweb.service`:

```ini
[Unit]
Description=LineWeb Express Server
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lineweb
ExecStart=/bin/bash /opt/lineweb/scripts/serve.sh
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: 创建 lineweb-webhook.service**

`scripts/lineweb-webhook.service`:

```ini
[Unit]
Description=LineWeb GitHub Webhook Listener
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/lineweb
ExecStart=/usr/bin/node /opt/lineweb/scripts/webhook-server.mjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=WEBHOOK_PORT=9000
Environment=WEBHOOK_SECRET=<替换为你的 Webhook Secret>
Environment=PATH=/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: 提交**

```bash
git add scripts/lineweb.service scripts/lineweb-webhook.service
git commit -m "chore: 添加 systemd 服务文件"
```

---

### Task 5: 服务器初始化 —— 安装环境与克隆项目

**说明:** 此任务在 Linux 服务器上直接执行。

- [ ] **Step 1: 安装 Node.js 18+**

```bash
dnf module list nodejs
dnf module enable nodejs:20
dnf install nodejs -y
node -v
```

- [ ] **Step 2: 确认 git 已安装**

```bash
git --version
# 如果没有: dnf install git -y
```

- [ ] **Step 3: 克隆项目**

```bash
mkdir -p /opt
cd /opt
git clone <你的 GitHub 仓库 URL> lineweb
```

- [ ] **Step 4: 安装项目依赖**

```bash
cd /opt/lineweb
npm install
```

- [ ] **Step 5: 设置 deploy.sh 和 serve.sh 可执行权限**

```bash
chmod +x /opt/lineweb/scripts/serve.sh
chmod +x /opt/lineweb/scripts/deploy.sh
```

- [ ] **Step 6: 验证 Node.js 版本 >= 18**

```bash
node -v
```

---

### Task 6: 配置环境变量与初始化数据库

**说明:** 此任务在 Linux 服务器上执行。

- [ ] **Step 1: 编辑 server/.env**

```bash
cat > /opt/lineweb/server/.env << 'EOF'
DATABASE_URL="file:./lineweb.db"
JWT_SECRET="<用这个命令生成: openssl rand -hex 32>"
PORT=3001
CORS_ORIGIN=""
STORAGE_NODE_TOKEN="<用这个命令生成: openssl rand -hex 32>"
MAX_FILE_SIZE_MB=10240
EOF
```

生成安全密钥并替换：

```bash
JWT_SECRET=$(openssl rand -hex 32)
STORAGE_TOKEN=$(openssl rand -hex 32)
sed -i "s/<用.*>/\"$JWT_SECRET\"/" /opt/lineweb/server/.env
# 第二个替换需要不同的模式，重写整个文件:
cat > /opt/lineweb/server/.env << EOF
DATABASE_URL="file:./lineweb.db"
JWT_SECRET="${JWT_SECRET}"
PORT=3001
CORS_ORIGIN=""
STORAGE_NODE_TOKEN="${STORAGE_TOKEN}"
MAX_FILE_SIZE_MB=10240
EOF
```

- [ ] **Step 2: 初始化数据库**

```bash
cd /opt/lineweb/server
npx prisma db push
npx prisma db seed
```

- [ ] **Step 3: 验证数据库文件已生成**

```bash
ls -la /opt/lineweb/server/prisma/lineweb.db
```

---

### Task 7: 配置防火墙与 systemd

**说明:** 此任务在 Linux 服务器上执行。

- [ ] **Step 1: 开放端口**

```bash
firewall-cmd --add-port=3001/tcp --permanent
firewall-cmd --add-port=9000/tcp --permanent
firewall-cmd --reload
firewall-cmd --list-ports
```

- [ ] **Step 2: 安装 systemd 服务文件**

```bash
cp /opt/lineweb/scripts/lineweb.service /etc/systemd/system/
cp /opt/lineweb/scripts/lineweb-webhook.service /etc/systemd/system/
```

- [ ] **Step 3: 修改 webhook service 的 WEBHOOK_SECRET**

```bash
WEBHOOK_SECRET=$(openssl rand -hex 16)
sed -i "s|<替换为你的 Webhook Secret>|${WEBHOOK_SECRET}|" /etc/systemd/system/lineweb-webhook.service
echo "Webhook Secret: ${WEBHOOK_SECRET}  (请保存此值，后续 GitHub 配置需要)"
```

- [ ] **Step 4: 重载 systemd 并启用服务**

```bash
systemctl daemon-reload
systemctl enable lineweb.service
systemctl enable lineweb-webhook.service
```

- [ ] **Step 5: 启动服务**

```bash
systemctl start lineweb.service
systemctl start lineweb-webhook.service
```

- [ ] **Step 6: 检查服务状态**

```bash
systemctl status lineweb.service --no-pager
systemctl status lineweb-webhook.service --no-pager
```

- [ ] **Step 7: 查看日志**

```bash
journalctl -u lineweb.service -n 30 --no-pager
```

---

### Task 8: 配置 GitHub Webhook

**说明:** 此任务在 GitHub.com 仓库设置页面操作。

- [ ] **Step 1: 打开仓库 Settings > Webhooks > Add webhook**

- [ ] **Step 2: 填写配置**

| 字段 | 值 |
|------|-----|
| Payload URL | `http://<服务器IP>:9000/github-webhook` |
| Content type | `application/json` |
| Secret | 上一步生成的 Webhook Secret (openssl rand -hex 16) |
| Events | 勾选 "Just the push event" |

- [ ] **Step 3: 点击 "Add webhook"**

- [ ] **Step 4: 验证 webhook 连接**

GitHub 会在创建时发送 ping 请求。检查 webhook 页面的 "Recent Deliveries" 是否显示绿色对勾。

---

### Task 9: 首次部署验证

**说明:** 此任务在浏览器中执行，验证服务可用。

- [ ] **Step 1: 浏览器访问**

```
http://<服务器IP>:3001
```
预期：看到 LineWeb 网站首页。

- [ ] **Step 2: 测试自动部署**

在本地 push 一个无关紧要的提交（如修改 README）：

```bash
echo "# test webhook" >> README.md
git add README.md && git commit -m "test: webhook"
git push
```

等待 10-20 秒后刷新浏览器，确认服务仍然正常。

- [ ] **Step 3: 检查 webhook 日志确认部署被触发**

```bash
journalctl -u lineweb-webhook.service -n 10 --no-pager
```

---

### Task 10: 创建 .npmrc 覆盖

**说明:** 项目根目录的 `.npmrc` 配置了 npmmirror.com 镜像（中国镜像）。在 OpenCloudOS 服务器上可能不需要，但如果速度慢可以保留。确认 `.npmrc` 不影响服务器上的安装。

- [ ] **Step 1: 查看当前 .npmrc 内容**

```bash
cat /opt/lineweb/.npmrc
```

- [ ] **Step 2: 如果服务器访问 npmmirror.com 速度慢，替换为官方源**

```bash
echo "registry=https://registry.npmjs.org/" > /opt/lineweb/.npmrc
```

或者如果要保留本地源、仅在服务器用官方源，在 deploy.sh 中不加 `.npmrc` 相关逻辑，由用户手动处理。
