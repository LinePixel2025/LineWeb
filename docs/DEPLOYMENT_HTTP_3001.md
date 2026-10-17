# LineWeb 部署指南 — 阿里云 ECS（1Panel + Docker Compose）

> **现状（2026-09-27 实测）**：生产运行在**阿里云 ECS（Ubuntu 24.04，公网 IP `<ECS 公网 IP>`）**，由 **1Panel 管理 + Docker Compose 部署**：
> Express 容器（`:3001`）提供前端与 API，**PostgreSQL 16 容器**提供数据库（不是 SQLite）。
> **公网入口是 `https://web.linetech.online`**（Cloudflare Tunnel 出站隧道，HTTPS 由 Cloudflare 边缘证书提供）；IP 直连 `http://<ECS 公网 IP>:3001` 作为备用入口保留。
> **存储节点仍运行在本地 Windows 机器上**（文件保存在 `D:/LineWebDrive`，不出本机），由节点主动外连云端服务端。
>
> 原先的「本地 Windows 全栈 + Cloudflare Tunnel」已**降级为开发/备用方案**，参见 [README「本地方案」](../README.md#本地方案开发--备用非生产)。

## 0. 拓扑与端口

| 组件 | 位置 | 端口/网络 | 说明 |
|------|------|-----------|------|
| 公网入口 | Cloudflare 边缘 | `443`（HTTPS） | **`https://web.linetech.online`** → Cloudflare Tunnel → 本机 `127.0.0.1:3001` |
| 隧道连接器 | ECS | 出站 `7844`（TCP/QUIC） | `cloudflared`（systemd 服务 `cloudflared`，开机自启），隧道 `lineweb-ecs` |
| 1Panel 面板 | ECS | `18080`（已放行） | `http://<ECS 公网 IP>:18080/lineweb_panel`；管理容器、数据库、防火墙、终端、证书。**不要绑定面板域名** |
| Express 服务端（容器 `lineweb-server-1`） | ECS，代码 `/opt/lineweb` | `3001:3001`，`1panel-network` + `lineweb_default` | 由根目录 `Dockerfile` 多阶段构建；镜像内置 `client/dist` |
| PostgreSQL 16（容器 `lineweb-postgres`） | ECS，数据卷 `lineweb-pg-data` | `1panel-network`（不对外暴露） | `postgres:16-alpine`，`shared_buffers=128MB` |
| 存储节点（Python） | **本地 Windows** | 推荐 `wss://web.linetech.online/ws/storage`；备选 `ws://<ECS 公网 IP>:3001/ws/storage` | 文件读写都在本机 `D:/LineWebDrive` |

```
浏览器 ──HTTPS──► Cloudflare 边缘 ──隧道──► ECS：127.0.0.1:3001（Express 容器 ⇄ PostgreSQL 16 容器）
                                              ▲
                                              └── ws://<ECS IP>:3001/ws/storage ── 本地 Windows 存储节点
                                                  （或 wss://web.linetech.online/ws/storage 走隧道）
```

> ⚠️ **HTTPS 入口由 Cloudflare 提供**（证书由 Google Trust Services 签发）；但 **IP 直连与存储节点的 `ws://` 仍是明文**：登录令牌、应用令牌、存储节点 token 与网盘文件内容在直连路径上明文过网。因此建议存储节点改用 `wss://` 隧道，并把安全组 `3001` 的来源限制为可信 IP（或直接关闭）。

---

## 1. 前置条件

- 阿里云 ECS（本项目实测：Ubuntu 24.04.2 LTS、2 vCPU、1.6 GB 内存、40 GB 系统盘）。
- **内存偏小时先加 swap**（首次 `docker compose build` 会在容器内跑 `vite build`，峰值吃内存）：

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
free -m
```

- 安全组：放行入方向 `18080`（面板）与 `3001`（站点）；建议来源限制为可信 IP。
- 注意：**国内 ECS 通常无法直连 Docker Hub 与 GitHub**，下面第 2、5 节分别处理。

---

## 2. 安装 1Panel（自动安装 Docker）

官方非交互安装（[文档](https://1panel.cn/docs/installation/online_installation/)）：

```bash
PANEL_NON_INTERACTIVE=true PANEL_LANG=zh PANEL_INSTALL_DIR=/opt \
PANEL_PORT=18080 PANEL_ENTRANCE=<安全入口> PANEL_USERNAME=<用户名> PANEL_PASSWORD='<强密码>' \
PANEL_INSTALL_DOCKER=y PANEL_DOCKER_MODE=auto \
bash -c "$(curl -sSL https://resource.fit2cloud.com/1panel/package/v2/quick_start.sh)"
```

安装完成后查看面板信息：

```bash
1pctl user-info                      # 面板地址、账号、安全入口
systemctl is-active 1panel-core 1panel-agent docker
docker -v && docker compose version
```

> 自定义密码请用 `PANEL_PASSWORD` 环境变量传入（不要写在命令行参数里），密码只会在安装日志中出现一次。

### 2.1 配置 Docker 镜像加速（国内必需）

实测该机器拉取 `docker.io` 会 `i/o timeout`，先在 `/etc/docker/daemon.json` 写加速地址（保留已有内容，仅补 `registry-mirrors`）：

```json
{
  "registry-mirrors": [
    "https://docker.1panel.live",
    "https://docker.m.daocloud.io",
    "https://docker.1ms.run"
  ]
}
```

```bash
systemctl restart docker
docker info | grep -A3 "Registry Mirrors"
docker pull node:22-alpine           # 验证加速是否生效
```

---

## 3. 创建网络、数据卷与 PostgreSQL

```bash
docker network create 1panel-network       # 1Panel 通常已创建，重复执行会提示已存在
docker volume create lineweb-pg-data

docker run -d --name lineweb-postgres \
  --network 1panel-network --restart unless-stopped \
  -e POSTGRES_USER=lineweb \
  -e POSTGRES_PASSWORD='<强随机密码>' \
  -e POSTGRES_DB=lineweb -e TZ=Asia/Shanghai \
  -v lineweb-pg-data:/var/lib/postgresql/data \
  postgres:16-alpine -c shared_buffers=128MB -c max_connections=50

# 等待就绪
until docker exec lineweb-postgres pg_isready -U lineweb -d lineweb >/dev/null 2>&1; do sleep 2; done
docker exec lineweb-postgres pg_isready -U lineweb -d lineweb
```

> 容器名 `lineweb-postgres` 会直接用于 `.env` 里的 `DATABASE_URL` 主机名，改名要同步改 `.env`。
> 若希望数据库出现在 1Panel 的「数据库」页面，可在面板应用商店安装 PostgreSQL（需在面板内操作；面板 API 需要先在 UI 里创建 API Key）。

---

## 4. 取代码

国内 ECS 直连 GitHub 极慢（实测 `git clone` 两分钟仅约 200 KB），三种方式任选：

```bash
# 方式 A：能连 GitHub 时直接拉
git clone https://github.com/LinePixel2025/LineWeb.git /opt/lineweb

# 方式 B（实测可用）：本地打包后上传，避免服务器访问 GitHub
#   本地执行： git bundle create lw.bundle --all
#              scp lw.bundle root@<ECS IP>:/root/
git clone /root/lw.bundle /opt/lineweb

# 方式 C：使用 GitHub 镜像/代理前缀克隆
git clone https://<镜像前缀>/https://github.com/LinePixel2025/LineWeb.git /opt/lineweb
```

```bash
cd /opt/lineweb
git remote set-url origin https://github.com/LinePixel2025/LineWeb.git   # 保留原始远端
git log --oneline -1
```

---

## 5. 写入 `/opt/lineweb/.env`

```bash
cd /opt/lineweb
cat > .env <<'EOF'
DATABASE_URL=postgresql://lineweb:<PG密码>@lineweb-postgres:5432/lineweb
JWT_SECRET=<openssl rand -hex 32>
STORAGE_NODE_TOKEN=<openssl rand -hex 32>
CORS_ORIGIN=
MAX_FILE_SIZE_MB=10240
DATABASE_POOL_SIZE=10
DATABASE_POOL_TIMEOUT=30
EOF
chmod 600 .env
```

要点：

- `DATABASE_URL` 指向 PostgreSQL（生产**不使用** SQLite）；`DATABASE_POOL_SIZE/TIMEOUT` 仅在 PostgreSQL 下生效（`server/src/lib/prisma.ts` 会追加 `connection_limit` / `pool_timeout`）。
- `CORS_ORIGIN` 留空即同源（Express 自己托管前端 + API，无需跨域）。
- `STORAGE_NODE_TOKEN` 必须与本地存储节点 `config.json` 的 `token` 完全一致，否则节点认证失败。
- `.env` 权限保持 `600`；不要把凭据写进 Git。

---

## 6. 构建并启动

```bash
cd /opt/lineweb
docker compose up -d --build          # 首次较慢：npm ci ×2 + vite build + 镜像导出
docker compose ps                     # 期望 lineweb-server-1 为 Up (healthy)
docker compose logs -f server
```

容器入口脚本 `server/scripts/docker-entrypoint.sh` 会自动完成：

1. 解析 `DATABASE_URL` 并等待 PostgreSQL 就绪；
2. 把 `prisma/schema.prisma`（SQLite）改写为 `prisma/schema.pg.prisma`（PostgreSQL）；
3. 首次运行：`prisma db push --accept-data-loss` + `prisma db seed`（建表 + 种子管理员）；
4. 以 `tsx` 启动 Express（`/api` + `client/dist` + `/ws/storage`）。

启动成功的关键日志：

```
✦ Storage tunnel listening at /ws/storage
[FTS] PostgreSQL detected, skipping FTS5 setup
✦ LineWeb Server running on port 3001
```

---

## 7. 验收清单

```bash
curl -s http://127.0.0.1:3001/api/health          # {"status":"ok","db":"connected",...}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3001/     # 200
```

1. `/api/health` 返回 200 且 `db` 为 `connected`（本机 `curl http://127.0.0.1:3001/api/health`）。
2. 公网入口可用：`https://web.linetech.online/api/health` 返回 200，首页 `https://web.linetech.online/` 能加载前端并登录（种子管理员 `admin@lineweb.dev` / `admin123`，**登录后立即改密**）。
3. `docker compose ps` 显示 server 为 healthy；`docker ps` 可见 `lineweb-postgres`；`systemctl is-active cloudflared` 为 active。
4. 登录接口可用（`POST /api/auth/login` 返回 token），带令牌访问 `/api/users` 返回 200。
5. WebSocket 可用：`wss://web.linetech.online/ws/storage` 握手返回 `101`（存储节点经隧道连接的前提）。
6. 本地存储节点连接成功后，`/api/health` 的 `storageNode` 变为 `connected`，网盘上传/下载正常。

---

## 8. 本地 Windows 存储节点接入

在本地 Windows 机器上编辑 `storage-node/config.json`：

```json
{
  "serverUrl": "wss://web.linetech.online/ws/storage",
  "token": "与 ECS 上 /opt/lineweb/.env 的 STORAGE_NODE_TOKEN 完全一致",
  "storagePath": "D:/LineWebDrive",
  "maxReconnectDelay": 60,
  "logFile": "storage-node.log"
}
```

```bash
cd storage-node && python main.py     # 或用 nssm 注册为 Windows 服务开机自启
```

两种连接方式：

| `serverUrl` | 链路 | 前提 |
|---|---|---|
| `wss://web.linetech.online/ws/storage`（**推荐**） | 经 Cloudflare Tunnel，**加密** | 仅需 cloudflared 服务正常；可关闭安全组 `3001` |
| `ws://<ECS 公网 IP>:3001/ws/storage` | 直连源站，**明文** | 安全组放行 `3001`，且来源建议限制为家庭公网 IP |

节点是 WebSocket **客户端**，主动外连服务端，因此本地无需公网 IP 或端口映射；两种方式都实测可握手（`101`）。

> ⚠️ 在此之前 `/api/health` 会一直显示 `"storageNode":"disconnected"`，**网盘与头像功能不可用**（网站其它功能正常）。

---

## 9. 更新与回滚

服务器**无法直连 GitHub**，因此不能用服务器上的 `git pull`：

```bash
# 方式 A：本地 bundle（推荐，不依赖 GitHub）
#   本地：git bundle create lw.bundle --all && scp lw.bundle root@<ECS IP>:/root/
cd /opt/lineweb && git fetch /root/lw.bundle master && git reset --hard FETCH_HEAD
docker compose up -d --build

# 方式 B：本地 push 到服务器（本地→服务器 SSH 通即可）
#   服务器：cd /opt/lineweb && git config receive.denyCurrentBranch updateInstead
#   本地：  git remote add aliyun ssh://root@<ECS IP>/opt/lineweb && git push aliyun master
#   服务器：cd /opt/lineweb && docker compose up -d --build
```

```bash
docker compose ps && curl -f http://127.0.0.1:3001/api/health
```

回滚：`git reset --hard <目标提交>` 后同样执行 `docker compose up -d --build`。

备份：

```bash
docker exec lineweb-postgres pg_dump -U lineweb lineweb > /root/lineweb-$(date +%F).sql
# 本地 Windows 侧单独备份 D:/LineWebDrive（网盘实际文件都在这里）
```

> 项目约定只用 `prisma db push`，**没有迁移文件与数据库回滚能力**；PostgreSQL 数据在卷 `lineweb-pg-data`。`docker compose down -v` 会删除数据卷，务必避免。

---

## 10. 公网入口：域名 + HTTPS（Cloudflare Tunnel，已落地）

> 📖 **通用化版本**（剥离本项目细节、便于复制到其他大陆服务器项目）：[cloudflare-tunnel-bypass-icp.md](cloudflare-tunnel-bypass-icp.md)

当前公网入口是 **`https://web.linetech.online`**，由 **Cloudflare Tunnel** 承载（不是「A 记录 + Nginx 反代 + 证书」这套常规做法）。原因：

- 阿里云大陆节点**按 HTTP `Host` 头拦截未备案域名**，返回 `403` + `Server: Beaver` + `Non-compliance ICP Filing`；
- 实测带该 Host 直连 `IP:3001` **同样 403**（拦截与端口无关），橙云 A 记录回源时 Host 仍是未备案域名 → 同样 403；Cloudflare 免费版还**不代理 `3001` 端口**；
- 隧道是 cloudflared **主动外连** Cloudflare（出站 TCP/QUIC 7844），不产生「带未备案域名的入站请求」，因此不被拦截，并且自动获得 HTTPS（证书由 Google Trust Services 签发、自动续期）。

### 10.1 复现步骤

```bash
# 1) 服务器安装 cloudflared（GitHub 直连慢时，可本机下载二进制再上传）
install -m 0755 cloudflared-linux-amd64 /usr/local/bin/cloudflared && cloudflared --version

# 2) Cloudflare 侧创建命名隧道 linew-ecs 并配置入口（也可用 API 完成）：
#    public hostname: web.linetech.online -> http://127.0.0.1:3001

# 3) 把隧道 Token 装成开机自启服务（Token 经 stdin 传入，避免留在命令历史）
echo '<TUNNEL_TOKEN>' | ssh root@<ECS IP> 'cloudflared service install $(cat)'
systemctl is-enabled cloudflared && systemctl is-active cloudflared

# 4) DNS：web.linetech.online 用 CNAME -> <隧道ID>.cfargotunnel.com（Cloudflare 代理开启）
```

验收：

```bash
curl -s https://web.linetech.online/api/health     # {"status":"ok","db":"connected",...}
curl -sI https://web.linetech.online/ | head -1    # HTTP/2 200
# WebSocket（存储节点用）应返回 101
curl -si -N --max-time 8 -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  https://web.linetech.online/ws/storage | head -1
```

### 10.2 合规提示

让未备案域名指向大陆服务器属于 **ICP 备案的合规灰区**：隧道只规避了技术拦截。要彻底合规，需完成 ICP 备案（`.online` 后缀是否可备案需先核实），或把服务器迁到非大陆区域（香港/新加坡等免备案）。

### 10.3 以后若完成备案、想改回直连

1. 把 `web.linetech.online` 的 DNS 从 CNAME（`cfargotunnel.com`）改为 A 记录指向 ECS 公网 IP。
2. 1Panel →「网站」建反向代理站点到 `http://127.0.0.1:3001` 并开启 HTTPS（证书模块申请 Let's Encrypt）；WebSocket 路径 `/ws/` 保留 `Upgrade`/`Connection` 头与长超时，下载路径 `/api/drive/…download` 同样放宽超时。
3. 服务端已设置 `app.set('trust proxy', 1)`（`server/src/index.ts`），反代后限流与设备追踪能正确取到真实 IP。
4. 收敛安全组：保留 `80`/`443`，关闭 `3001` 公网入口。
5. 存储节点 `serverUrl` 改为 `wss://<域名>/ws/storage`；OAuth `redirect_uri` 与屏幕时间推送基址同步改为 `https://<域名>`。
6. 停用隧道：`systemctl disable --now cloudflared`（保留 cloudflared，便于以后复用）。

---

## 11. 故障排查

- **外网打不开站点**：确认走的是 `https://web.linetech.online`（隧道）；若用 IP 直连则确认安全组放行 `3001`（`ss -ltnp | grep 3001` 应显示 `0.0.0.0:3001` docker-proxy）。
- **页面标题是 `Non-compliance ICP Filing`、HTTP 403、`Server: Beaver`**：这是**阿里云对未备案域名的拦截**，不是服务器故障。原因是请求带着未备案域名的 `Host` 头直接打到了 ECS（换端口也无效）。解决方式是走 Cloudflare Tunnel（`https://web.linetech.online`），或完成 ICP 备案 / 换非大陆节点。
- **1Panel 面板只显示 `Access Temporarily Unavailable`**：面板被绑定了域名（`面板设置 → 域名绑定`）。恢复：`1pctl reset domain` 然后 `systemctl restart 1panel-core`；之后**不要**给面板绑域名。
- **隧道不通**：`systemctl status cloudflared` / `journalctl -u cloudflared -n 50`；确认出站 `7844` 可达（`bash -c 'cat < /dev/null > /dev/tcp/region1.v2.argotunnel.com/7844'`）、DNS 是 CNAME 到 `<隧道ID>.cfargotunnel.com` 且 Cloudflare 代理已开启。
- **`docker compose build` 卡在 npm / 拉镜像**：确认 `/etc/docker/daemon.json` 的镜像加速生效（该机器直连 Docker Hub 会超时）。
- **容器反复重启**：`docker compose logs server`；常见原因是 `DATABASE_URL` 写错（主机名必须是 `lineweb-postgres`）或 PostgreSQL 未就绪。
- **`db` 为 `disconnected`**：`docker exec lineweb-postgres pg_isready -U lineweb -d lineweb`；确认 PG 容器与 server 在同一 `1panel-network`。
- **首次启动后数据被重置**：初始化标记在卷 `lineweb-init`（`/var/lib/lineweb/.db-initialized`），不要删除该卷。
- **`"storageNode":"disconnected"`**：节点未启动、token 不一致，或（直连方式）安全组未放行 `3001`。推荐改用 `wss://web.linetech.online/ws/storage`，与安全组无关且链路加密。
- **服务器无法 `git pull`**：属预期（GitHub 不可达），改用第 9 节的 bundle / push 方式。
- **内存不足（构建被 OOM kill）**：`free -m` 确认 swap 已启用；或把构建放到本地完成后再推送镜像。

---

## 12. 历史存档（不再是生产路径）

- **Railway 部署**：见 [DRIVE_SETUP.md](DRIVE_SETUP.md) 第 1 章（仅存档）。
- **systemd 直跑 tsx + ECS 上 SQLite**：一度作为候选方案写在旧版文档中，现已作废——生产使用 Docker Compose + PostgreSQL。
- **宝塔面板路径**（`/www/wwwroot/lineweb`、`ecosystem.config.js` 的 PM2、`scripts/deploy.sh` 的 MySQL schema 生成）：历史存档，采用前需按本指南调整。
