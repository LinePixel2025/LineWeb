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
| `serverUrl` | WebSocket 服务器地址 | `ws://localhost:3001/ws/storage` |
| `token` | 认证令牌（与服务器 .env 的 `STORAGE_NODE_TOKEN` 一致） | — |
| `storagePath` | 文件存储根目录 | `D:/LineWebDrive` |
| `logFile` | 日志文件路径 | `storage-node.log` |
| `maxReconnectDelay` | 重连最大间隔（秒） | 60 |

## 运行

```bash
python main.py
```

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
