# 1Panel 部署 LineWeb 完整指南（PostgreSQL）

## 1. 创建数据库

1Panel → **数据库** → **PostgreSQL** → **创建数据库**

| 字段 | 值 |
|------|-----|
| 数据库名 | `lineweb` |
| 用户名 | `postgres`（或新建专用用户） |
| 密码 | 你的密码 |

创建后点击 **连接信息**，复制连接地址（格式：`postgresql://postgres:密码@localhost:5432/lineweb`）。

---

## 2. 部署项目

```bash
# SSH 进入服务器，进入 1Panel 项目目录
cd /opt/lineweb   # 或你的项目路径

# 拉取代码
git clone https://github.com/你的仓库/lineweb.git .
# 或通过 1Panel 文件管理器上传

# 配置环境变量
cp .env.docker .env
nano .env    # 修改 DATABASE_URL 和 JWT_SECRET
```

`.env` 示例：
```env
DATABASE_URL=postgresql://postgres:你的密码@host.docker.internal:5432/lineweb
JWT_SECRET=这里填随机生成的32位字符串
PORT=3001
```

> `host.docker.internal` 是固定值，容器通过它访问宿主机的 1Panel MySQL。

```bash
# 构建并启动
docker compose up -d

# 查看日志确认启动成功
docker compose logs -f
```

---

## 3. 配置反向代理

1Panel → **网站** → **创建网站** → **反向代理**

| 字段 | 值 |
|------|-----|
| 域名 | `你的域名.com` |
| 代理地址 | `http://127.0.0.1:3001` |

在 **网站设置** → **配置文件** 中，找到 `location /` 块，**上方**添加 WebSocket 支持：

```nginx
# WebSocket（网盘存储节点通信）
location /ws/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}

# 原有的 location / 保持不变
```

在 `location /` 块内，确保有这些头部：
```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 100m;    # 大文件上传
    proxy_read_timeout 120s;
}
```

---

## 4. 启用 SSL

1Panel → **网站** → 你的网站 → **SSL** → **申请证书**

选择 **Let's Encrypt** 或上传已有证书，一键启用 HTTPS。

---

## 5. 更新部署

```bash
cd /opt/lineweb
git pull
docker compose up -d --build
```

---

## 验证

- 访问 `https://你的域名` → 应看到 LineWeb 首页
- 访问 `https://你的域名/admin` → 管理员登录
  - 邮箱: `admin@lineweb.dev`
  - 密码: `admin123`
- `docker compose logs server` → 查看运行日志
