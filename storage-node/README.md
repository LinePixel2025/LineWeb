# Storage Node — Line Web 网盘存储节点

## 安装

1. 安装 Python 3.10+
2. 安装依赖：

```bash
pip install -r requirements.txt
```

## 配置

编辑 `config.json`：

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `serverUrl` | WebSocket 服务器地址。**开发**（服务端在本机）：`ws://localhost:3001/ws/storage`；**生产**（服务端在阿里云 ECS）：推荐 `wss://web.linetech.online/ws/storage`（经 Cloudflare Tunnel，已实测 WebSocket 101，链路加密），直连备选 `ws://120.24.223.65:3001/ws/storage`（不经过隧道，明文且需安全组放行 3001） | `ws://localhost:3001/ws/storage` |
| `token` | 认证令牌（与所连服务器 .env 的 `STORAGE_NODE_TOKEN` 一致） | — |
| `storagePath` | 文件存储根目录 | `D:/LineWebDrive` |
| `logFile` | 日志文件路径 | `storage-node.log` |
| `maxReconnectDelay` | 重连最大间隔（秒） | 60 |

## 运行

存储节点**始终运行在本地 Windows 机器上**（文件存 `D:/LineWebDrive`），只是连接的服务端不同。

开发（服务端跑在本机）：
```bash
python main.py
```
`config.json` 中 `serverUrl` 用 `ws://localhost:3001/ws/storage`。

生产（服务端在阿里云 ECS 上，节点主动外连）：
```bash
python main.py
```
把 `config.json` 中 `serverUrl` 改为 `wss://web.linetech.online/ws/storage`（经 ECS 上的 Cloudflare Tunnel 到 `127.0.0.1:3001`，已实测握手成功，链路加密），`token` 改为 ECS 上 `server/.env` 的 `STORAGE_NODE_TOKEN`。也可继续用直连备选 `ws://120.24.223.65:3001/ws/storage`（不经过隧道、明文传输，需要 ECS 安全组放行 3001 端口）；改用隧道地址后，可以考虑关闭 3001 的公网入口。

## 开机自启（Windows）

使用 nssm 注册为 Windows 服务：

```bash
nssm install LineWebStorageNode "C:\path\to\python.exe" "C:\path\to\storage-node\main.py"
nssm start LineWebStorageNode
```

## 安全

- `token` 必须使用强随机字符串（例如 `openssl rand -hex 32` 生成）
- 路径遍历攻击由服务器端签名和校验防止
- 所有文件操作在 `storagePath` 限定目录内执行
- ⚠️ **`.gitignore` 未覆盖 `config.json`**（一旦提交即公开；工作区当前即含明文 `token`），因此保守视为**已泄露**。建议：在服务端轮换 `STORAGE_NODE_TOKEN`（同时更新 `config.json`），把 `storage-node/config.json` 加入 `.gitignore`（若已提交还需从版本历史移除），或改用环境变量 `LINEWEB_STORAGE_TOKEN` 注入，避免明文 token 入库。
- 生产优先连 `wss://web.linetech.online/ws/storage`（Cloudflare Tunnel）：整条链路是 TLS 加密的，token 与文件内容不像直连 `ws://` 那样在公网明文传输，**比 IP 直连更安全**；若必须直连，请知悉 `ws://` 是明文信道。
