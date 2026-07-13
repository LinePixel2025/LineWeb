# Time Master 接入教程

Time Master 是一款电脑屏幕使用时间管理软件。通过本教程，你可以将 Time Master 记录的屏幕时间同步到 LineWeb，在主页实时查看今日使用时长。

## 概述

```
Time Master（本地） → 推送脚本 → LineWeb API → 主页数字健康卡片
```

- 你只需在本地运行一个 Python 脚本，它会定期读取 Time Master 数据并推送到 LineWeb。
- LineWeb 接收后自动更新主页的数字健康卡片。
- 支持多个设备（笔记本、台式机），每个设备独立生成 Token。

## 第一步：在 LineWeb 生成 Token

1. 登录 [LineWeb](http://localhost:5173)，进入 **个人资料** 页面。
2. 滚动到 **数字健康** 区域。
3. 在「生成新 Token」表单中：
   - **名称**：给设备起个名字，如 `办公笔记本`、`家里台式机`。
   - **有效期**：选择「永久」或「7 天」「30 天」。永久 Token 无需续期。
4. 点击 **生成 Token**。
5. Token 仅显示一次，**立即点击复制**并保存到安全的地方。

> Token 格式示例：`st_a1b2c3d4e5f6...`

## 第二步：安装脚本依赖

推送脚本需要 Python 3.7+ 和 `requests` 库：

```bash
pip install requests
```

脚本位于仓库 `scripts/time-master-push.py`，将其复制到你希望运行的目录。

## 第三步：配置环境变量

```bash
# 必填：你在第一步生成的 Token
export LINEWEB_SCREEN_TIME_TOKEN="st_your_token_here"

# 可选：LineWeb API 地址（默认 http://localhost:3001）
export LINEWEB_API_URL="http://localhost:3001"

# 可选：推送间隔（秒），默认 900（15 分钟）
export LINEWEB_PUSH_INTERVAL_SECONDS="900"
```

将以上内容写入 `~/.bashrc`（Linux/Mac）或系统环境变量（Windows），使脚本持久运行。

Windows PowerShell 用户：

```powershell
$env:LINEWEB_SCREEN_TIME_TOKEN = "st_your_token_here"
$env:LINEWEB_API_URL = "http://localhost:3001"
$env:LINEWEB_PUSH_INTERVAL_SECONDS = "900"
```

## 第四步：实现数据读取函数

脚本核心是一个占位函数 `get_total_seconds_today()`，你需要根据 Time Master 的实际数据格式实现它。

### 方式 A：读取 JSON 文件（推荐）

如果 Time Master 将每日数据导出为 JSON：

```python
import json
import os
from datetime import datetime

def get_total_seconds_today() -> int:
    data_dir = os.path.expanduser("~/.time-master")
    date = datetime.now().strftime("%Y-%m-%d")

    with open(os.path.join(data_dir, f"{date}.json")) as f:
        data = json.load(f)
    return data.get("total_seconds", 0)
```

### 方式 B：读取 SQLite 数据库

```python
import sqlite3
import os
from datetime import datetime

def get_total_seconds_today() -> int:
    db_path = os.path.expanduser("~/.time-master/timemaster.db")
    date = datetime.now().strftime("%Y-%m-%d")

    conn = sqlite3.connect(db_path)
    cursor = conn.execute(
        "SELECT SUM(duration) FROM sessions WHERE date = ?", (date,)
    )
    row = cursor.fetchone()
    conn.close()
    return int(row[0]) if row and row[0] else 0
```

### 方式 C：读取 Windows 注册表 / macOS 系统日志

根据 Time Master 的实际存储方式自行实现，只需保证函数返回一个整数秒数即可。

## 第五步：测试推送

```bash
# 立即推送一次，验证连通性
python scripts/time-master-push.py --now
```

预期输出：

```
已同步 3600 秒 (2026-07-14)
```

刷新 LineWeb 主页，数字健康卡片应显示「1 小时 0 分钟」。

## 第六步：后台长期运行

### Linux / macOS（systemd）

创建服务文件 `/etc/systemd/system/lineweb-time-master.service`：

```ini
[Unit]
Description=LineWeb Time Master Push
After=network.target

[Service]
Type=simple
Environment="LINEWEB_SCREEN_TIME_TOKEN=st_your_token_here"
Environment="LINEWEB_API_URL=http://localhost:3001"
ExecStart=/usr/bin/python3 /path/to/scripts/time-master-push.py
Restart=always
RestartSec=30

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lineweb-time-master.service
```

### Windows（任务计划程序）

1. 打开 **任务计划程序** → 创建基本任务
2. **触发器**：每天 → 重复间隔 15 分钟
3. **操作**：启动程序 → `python` → 参数 `scripts/time-master-push.py --now`
4. 在环境变量中设置 `LINEWEB_SCREEN_TIME_TOKEN`

### 简单方式（终端常驻）

```bash
# 保持终端打开，脚本会每 15 分钟自动推送
python scripts/time-master-push.py
```

## 管理多个设备

为每个设备生成独立的 Token，在本地分别配置不同的 `LINEWEB_SCREEN_TIME_TOKEN`。LineWeb 会按用户聚合数据，同一天多设备推送会自动覆盖为最新值。

## 故障排查

| 症状 | 可能原因 | 解决 |
|------|---------|------|
| `401 Token 无效` | Token 已过期或被删除 | 重新生成 Token |
| `400 totalSeconds 无效` | 推送的秒数为负或超过 86400 | 检查数据读取逻辑 |
| 连接失败 | API 地址不正确或服务器未启动 | 检查 `LINEWEB_API_URL`，确认服务已启动 |
| 主页显示 0 小时 | 日期不匹配或数据未同步 | 检查推送脚本的 `date` 参数与 `--now` 输出 |
| 脚本报错 ModuleNotFoundError | 缺少 `requests` 库 | `pip install requests` |

## 安全提示

- Token 具有推送屏幕时间的权限，请勿泄露或提交到公开仓库。
- 不建议将 Token 直接写在脚本中，使用环境变量管理。
- 如需撤销某个设备的访问权限，在 LineWeb 个人资料页删除对应 Token 即可。
