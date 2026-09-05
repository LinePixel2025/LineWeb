# 网盘系统配置教程

> ⚠️ **已废弃（2026-09）**：本指南的 **Railway 部署章节已随云服务器部署废除**，仅作历史存档。当前部署为**本地 Windows 服务器运行 + Cloudflare Tunnel 内网穿透**（服务运行在 `http://127.0.0.1:3001`，存储节点直接连 `ws://127.0.0.1:3001/ws/storage`），参见 [README](../README.md#部署本地-windows--cloudflare-tunnel)。

本文档指导你完成 LineWeb 网盘系统的完整配置，包括：
- **Railway** — 部署更新后的服务器代码（⚠️ 已废弃，仅存档）
- **Windows 存储节点** — 在 Windows 笔记本上运行存储节点
- **管理后台** — 为用户开通网盘权限
- **验证** — 端到端测试

---

## 目录

1. [Railway 部署更新](#1-railway-部署更新)
2. [Windows 存储节点配置](#2-windows-存储节点配置)
3. [管理后台开通权限](#3-管理后台开通权限)
4. [端到端验证](#4-端到端验证)
5. [故障排除](#5-故障排除)

---

## 1. Railway 部署更新

代码已推送到 GitHub，Railway 会自动检测更新并重新部署，但需要确认环境变量。

### 1.1 确认环境变量

登录 [Railway Dashboard](https://railway.app/dashboard)，选择你的 LineWeb 项目 → **Variables**，确保以下变量存在：

| 变量名 | 值 | 必需 | 说明 |
|--------|-----|------|------|
| `JWT_SECRET` | 你的密钥 | ✅ | 生产环境 JWT 签名密钥 |
| `NPM_CONFIG_REGISTRY` | `https://registry.npmjs.org` | ✅ | 覆盖 .npmrc 的中国镜像 |
| `STORAGE_NODE_TOKEN` | `openssl rand -hex 32 生成的随机串` | ✅ | 存储节点认证令牌 |

> **`STORAGE_NODE_TOKEN` 是新增的必需变量！** 务必与存储节点 config.json 中的 token 一致。

### 1.2 触发重新部署

Railway 通常会在推送后自动部署。如果要手动触发：

1. 进入 Railway Dashboard → **Deployments**
2. 点击 **Redeploy** → 选择最新 commit `aff50d0`
3. 查看部署日志，确认无错误

### 1.3 验证部署成功

部署完成后，访问你的 Railway 域名 `/api/health`：
```json
{"status":"ok","timestamp":"2026-06-27T18:00:00.000Z"}
```

---

## 2. Windows 存储节点配置

这是网盘系统的**物理存储层**——文件实际保存在你的 Windows 笔记本上。

### 2.1 安装 Python 3.10+

- 从 [python.org](https://www.python.org/downloads/) 下载 Python 3.10+
- **安装时务必勾选 "Add Python to PATH"**

### 2.2 复制存储节点代码

方案 A：从项目目录复制（推荐）

```bash
# 在你的开发机上，storage-node/ 目录在项目根目录
cd D:\AICOP\工程\LineWeb
xcopy storage-node D:\LineWebStorageNode /E /I
```

方案 B：从 GitHub 下载

```bash
git clone https://github.com/LinePixel2025/LineWeb.git D:\LineWebStorageNode
cd D:\LineWebStorageNode
# 只需要 storage-node/ 目录，其他可以删除
```

### 2.3 安装依赖

```bash
cd D:\LineWebStorageNode\storage-node
pip install -r requirements.txt
```

### 2.4 修改配置文件

编辑 `config.json`：

```json
{
  "serverUrl": "wss://你的railway域名.com/ws/storage",
  "token": "你的 STORAGE_NODE_TOKEN（与服务器 .env 一致）",
  "storagePath": "D:/LineWebDrive",
  "logFile": "storage-node.log",
  "maxReconnectDelay": 60
}
```

| 字段 | 说明 |
|------|------|
| `serverUrl` | Railway 域名 + `/ws/storage`（**注意用 `wss://` 而非 `ws://`** 因为生产环境用 HTTPS） |
| `token` | 与 Railway Variables 中的 `STORAGE_NODE_TOKEN` 完全一致 |
| `storagePath` | Windows 上存储文件的目录（文件实际保存在这里） |
| `logFile` | 日志文件路径 |
| `maxReconnectDelay` | 断线重连最大间隔（秒） |

### 2.5 测试启动

```bash
cd D:\LineWebStorageNode\storage-node
python main.py
```

你应该看到：

```
INFO 存储节点启动 — 根目录: D:\LineWebDrive, 服务器: wss://你的域名/ws/storage
INFO 已连接到服务器
INFO 认证成功
```

### 2.6 开机自启（可选）

使用 [nssm](https://nssm.cc/download) 注册为 Windows 服务：

```bash
# 下载 nssm，然后：
nssm install LineWebStorageNode "C:\path\to\python.exe" "D:\LineWebStorageNode\storage-node\main.py"
nssm start LineWebStorageNode
nssm status LineWebStorageNode  # 确认运行中
```

或使用 Windows 任务计划程序创建一个"登录时启动"的任务。

---

## 3. 管理后台开通权限

存储节点连接后，需要为具体用户开通网盘权限。

### 3.1 登录管理后台

1. 访问你的网站 → **登录**（admin@lineweb.dev / admin123）
2. 点击导航栏的 **管理**
3. 点击 **用户管理**

### 3.2 开通网盘权限

在用户管理页面，你会看到每行用户右侧新增了 **网盘** 列：

| 状态 | 含义 |
|------|------|
| ✅ | 已开通网盘访问权限 |
| ❌ | 未开通（默认） |

**点击 ✅/❌ 图标**即可切换该用户的网盘权限。

### 3.3 确认结果

开通后，该用户登录网站即可在导航栏看到 **☁️ 网盘** 入口。

---

## 4. 端到端验证

### 4.1 检查存储节点状态

```bash
# 在存储节点终端，确认连接正常
INFO 认证成功
# 确认后可以看到实时日志
```

### 4.2 基础文件操作测试

作为已开通权限的用户：

1. 访问 **☁️ 网盘**
2. 点击 **📁 新建文件夹** → 输入名称 → 创建
3. 点击 **⬆ 上传文件** → 选择文件 → 上传
4. 点击文件名称 → **重命名**
5. 点击 **预览** → 查看图片/视频
6. 点击 **下载** → 文件应该从存储节点读取并传输
7. 点击 **删除** → 确认删除

### 4.3 验证文件实际落盘

在 Windows 笔记本上打开 `D:\LineWebDrive\` 目录：

```
D:\LineWebDrive\
├── YourFolder/
│   └── 1712345678-a1b2c3d4.jpg   ← 实际文件
└── 1712345678-e5f6g7h8.pdf       ← 根目录下的文件
```

### 4.4 权限验证

```bash
# 用没有开通权限的用户测试
curl -s http://你的域名/api/drive/files
# 应该返回 403 无网盘访问权限
```

---

## 5. 故障排除

### 5.1 存储节点连不上服务器

**现象：**
```
WARNING 连接断开，准备重连...
```

**排查：**
1. 检查 `config.json` 中的 `serverUrl`：
   - 生产环境用 `wss://`（不是 `ws://`）
   - 开发环境用 `ws://localhost:3001/ws/storage`
2. 确认 Railway 项目正在运行
3. 检查防火墙是否阻止出站 WebSocket 连接

### 5.2 认证失败

**现象：**
```
ERROR 认证失败: {'type': 'auth_error', 'error': '认证失败'}
```

**排查：**
1. 确认 `config.json` 中的 `token` 与 **Railway Variables** 中的 `STORAGE_NODE_TOKEN` 完全一致
2. 检查 token 中是否有空格或换行符
3. 在 Railway 重新设置 `STORAGE_NODE_TOKEN` 后记得重新部署

### 5.3 上传失败

**现象：**
```
上传失败: 存储节点未连接
```

**排查：**
1. 检查存储节点是否正在运行且显示"认证成功"
2. 检查网络连接
3. 文件是否超过大小限制（默认 500MB）

### 5.4 上传报 413 Request Entity Too Large

**现象：**
```
413 Request Entity Too Large
```

**排查：**
1. Railway 有自身请求体限制，可在 Railway Dashboard → **Networking** 中调整
2. 或在前端限制单文件大小

### 5.5 下载文件内容错误或损坏

**排查：**
1. 检查存储节点硬盘空间
2. 检查 `D:\LineWebDrive\` 下的文件是否完整
3. 查看 `storage-node.log` 中的读写日志

### 5.6 数据库相关

**如果部署后出现数据库错误：**

```bash
# 重置数据库（会丢失数据）
cd server
npx prisma db push --accept-data-loss
npx prisma db seed
```

或删除 `server/prisma/lineweb.db` 再重新 `db push && db seed`。

---

## 架构图

```
用户浏览器 ──HTTPS──→ Railway (Express + WebSocket)
                            │
                            │ WebSocket (wss://)
                            │
                    Windows 笔记本 (Storage Node)
                            │
                    读取/写入 ↓
                    D:\LineWebDrive\ 目录
```

## 文件结构

```
LineWeb/
├── server/
│   ├── src/
│   │   ├── services/storageTunnel.ts    ← WebSocket 隧道服务
│   │   └── routes/drive.ts              ← 网盘 API 路由
│   └── prisma/schema.prisma             ← DriveFile 模型
├── storage-node/                         ← Windows 存储节点应用
│   ├── main.py                          ← 主程序
│   ├── config.json                      ← 连接配置
│   ├── requirements.txt                 ← Python 依赖
│   └── README.md                        ← 简要说明
└── client/src/pages/DrivePage.tsx       ← 网页端文件管理器
```
