# LineWeb HTTP + 3001 部署指南

本项目的服务器部署约束如下：

- 只使用 HTTP，不配置 HTTPS、TLS 或 WSS。
- Express 固定监听 `3001`。
- Docker 固定映射 `3001:3001`。
- Nginx 使用 `80`，反向代理到 `3001`。
- Windows 存储节点使用 `ws://服务器地址:3001/ws/storage`。

> HTTP 和 `ws://` 不提供传输加密。该方案只适合可信内网、VPN 或受安全组保护的网络，不适合直接承载公网敏感数据。

## 1. 服务器准备

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo ufw allow 80/tcp
sudo ufw allow 3001/tcp
```

获取代码：

```bash
sudo mkdir -p /opt/lineweb
sudo chown -R "$USER":"$USER" /opt/lineweb
git clone https://github.com/LinePixel2025/LineWeb.git /opt/lineweb
cd /opt/lineweb
```

## 2. 配置 `.env`

在项目根目录创建 `.env`，不要提交到 Git：

```env
DATABASE_URL=postgresql://lineweb:数据库密码@数据库地址:5432/lineweb
JWT_SECRET=至少32字节的随机字符串
STORAGE_NODE_TOKEN=存储节点共享密钥
PORT=3001
NODE_ENV=production
CORS_ORIGIN=
MAX_FILE_SIZE_MB=10240
DATABASE_POOL_SIZE=10
DATABASE_POOL_TIMEOUT=30
```

生成随机密钥：

```bash
openssl rand -hex 32
```

数据库建议使用内网地址或安全组限制访问，不要直接暴露 PostgreSQL 端口。

## 3. 启动服务

```bash
cd /opt/lineweb
docker compose build --no-cache --pull
docker compose up -d
docker compose ps
curl -i http://127.0.0.1:3001/api/health
docker compose logs --tail=200 server
```

Compose 会等待数据库，然后首次启动执行 schema 初始化和 seed；后续启动只执行非破坏性 schema 同步。初始化标记位于持久化卷中，不要使用 `docker compose down -v`。

访问地址：

```text
http://服务器地址/
http://服务器地址:3001/
```

## 4. HTTP Nginx

项目内的 `nginx.conf` 已配置 `listen 80`、下载长超时和 `/ws/` WebSocket Upgrade。宿主机 Nginx 不在 Compose 网络时，将 upstream 指向 `127.0.0.1:3001`：

```nginx
upstream lineweb_server { server 127.0.0.1:3001; }

server {
    listen 80;
    server_name _;
    client_max_body_size 10240m;

    location /ws/ {
        proxy_pass http://lineweb_server;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    location / {
        proxy_pass http://lineweb_server;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto http;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo nginx -t
sudo systemctl reload nginx
curl -i http://服务器地址/api/health
```

不要增加 HTTPS 重定向，不要把 `ws://` 改成 `wss://`。

## 5. Windows 存储节点

```powershell
cd D:\LineWeb\storage-node
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

`storage-node/config.json`：

```json
{
  "serverUrl": "ws://服务器地址:3001/ws/storage",
  "token": "与服务器 STORAGE_NODE_TOKEN 完全一致",
  "storagePath": "D:/LineWebDrive",
  "maxReconnectDelay": 60,
  "logFile": "./storage-node.log"
}
```

也可使用环境变量：

```powershell
$env:LINEWEB_STORAGE_SERVER_URL = "ws://服务器地址:3001/ws/storage"
$env:LINEWEB_STORAGE_TOKEN = "与服务器 STORAGE_NODE_TOKEN 完全一致"
$env:LINEWEB_STORAGE_PATH = "D:/LineWebDrive"
python main.py
```

如果经过 Nginx，地址使用 `ws://服务器地址/ws/storage`。启动日志应显示连接和认证成功。

## 6. 验收清单

1. `/api/health` 返回 200，数据库状态为 `connected`。
2. 浏览器可以打开 `http://服务器地址/`。
3. 存储节点显示认证成功，服务端显示 `storageNode: connected`。
4. 创建目录、上传、下载、预览、重命名、移动、删除均成功。
5. `D:\LineWebDrive` 中的实际文件与网盘操作一致。
6. 无网盘权限用户访问 `/api/drive/files` 返回 403。
7. 两个普通用户不能互相写入对方的目录。
8. 重启容器后不会重复执行破坏性初始化。

## 7. 更新与回滚

更新：

```bash
cd /opt/lineweb
git fetch origin master
git reset --hard origin/master
docker compose build --no-cache --pull
docker compose up -d --force-recreate
curl -f http://127.0.0.1:3001/api/health
```

回滚前备份 PostgreSQL：

```bash
git log --oneline -10
git reset --hard 目标提交
docker compose build --no-cache
docker compose up -d --force-recreate
```

不要使用 `docker compose down -v`，不要在未备份时手动执行 `prisma db push --accept-data-loss`。

## 8. 常见问题

- **3001 无法访问**：检查 `docker compose ps`、容器日志、`ss -ltnp | grep ':3001'` 和云安全组。
- **存储节点重连**：检查 `STORAGE_NODE_TOKEN`、`ws://` 地址、TCP 3001 防火墙和 Nginx Upgrade 配置。
- **上传失败**：确认存储节点在线、`D:\LineWebDrive` 可写、Nginx `client_max_body_size` 足够大。
- **数据库失败**：检查 `DATABASE_URL`、PostgreSQL 网络连通性和容器日志。

定期备份 PostgreSQL 和 `D:\LineWebDrive`，并确保 `.env`、存储节点 token 和运行日志不会进入 GitHub。
