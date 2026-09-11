# Time Master API 接入指南

Time Master 是 LineWeb 的数字健康伴侣——它将本地电脑屏幕使用时间同步到 LineWeb，并读取用户设定的每日使用目标进行时长管控。

## 概述

```
┌─────────────────┐    POST /api/health/push     ┌──────────────────┐
│  Time Master     │ ──────────────────────────► │  LineWeb Server   │
│  (本地脚本)       │    推送屏幕使用时间            │                   │
│                  │ ◄────────────────────────── │                   │
│                  │    GET /api/health/daily-goal                    │
│                  │    读取每日使用目标             │                   │
└─────────────────┘                             └──────────────────┘
```

**数据流向**：
1. **Time Master → LineWeb**：推送今日屏幕使用时间（秒）
2. **LineWeb → Time Master**：Time Master 读取用户设定的每日目标，据此决定是否提醒/锁定

> **凭证变更（2026-09）**：屏幕时间 Token（`X-Screen-Time-Token`、`st_` 前缀）与 `GET /api/health/daily-goal/data`、`GET /api/health/screen-time/data` 已移除。Time Master 改为使用**账号登录令牌**：先 `POST /api/auth/login` 换取令牌，之后所有请求携带 `Authorization: Bearer <token>`。健康模块只要求登录，账号无需任何管理权限。

## 前提条件

1. 拥有 LineWeb 账号（用户名或邮箱 + 密码）
2. 具备运行 HTTP 请求的能力（Python/Node.js/Bash 等）

## 第一步：登录换取令牌

第三方设备不再需要任何独立密钥，用账号登录即可：

```
POST /api/auth/login
Content-Type: application/json
```

```json
{
  "identifier": "admin",
  "password": "你的密码",
  "rememberDays": 90
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `identifier` | string | 是 | 用户名或邮箱 |
| `password` | string | 是 | 账号密码 |
| `rememberDays` | integer | 否 | 令牌有效期天数，**1–90**，默认 7 天。设备建议传 `90` |

**成功响应（200）：**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "username": "admin", "role": "admin", "capabilities": ["content:write", "..."] }
}
```

> `rememberDays` 只是把同一个登录令牌的有效期拉长，不引入第二套凭证。登录端点限流 **20 次 / 15 分钟（按 IP）**，设备应缓存令牌，仅在收到 `401` 时重新登录。

## 第二步：设置环境变量

```bash
# Linux/macOS
export LINEWEB_API_URL="https://lineweb.dev/api"
export LINEWEB_USERNAME="admin"
export LINEWEB_PASSWORD="你的密码"
export LINEWEB_REMEMBER_DAYS="90"     # 可选，令牌有效期（1–90 天）

# Windows PowerShell
$env:LINEWEB_API_URL="https://lineweb.dev/api"
$env:LINEWEB_USERNAME="admin"
$env:LINEWEB_PASSWORD="你的密码"
$env:LINEWEB_REMEMBER_DAYS="90"
```

> 也可以把登录换来的令牌直接放进 `LINEWEB_TOKEN` 复用，脚本会跳过登录步骤。

## API 端点

所有端点前缀为 `/api/health`。

### 1. 推送屏幕使用时间

```
POST /api/health/push
```

将今日累计屏幕使用时间推送到 LineWeb。

**认证**：`Authorization: Bearer <登录令牌>`

**请求体**：

```json
{
  "totalSeconds": 3665,
  "date": "2026-07-17"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalSeconds` | number (整数) | 今日累计秒数，范围 0 - 86400 |
| `date` | string | 日期，格式 YYYY-MM-DD |

**成功响应** (200)：

```json
{
  "message": "已同步"
}
```

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | 输入数据无效（totalSeconds 超范围或 date 格式错误） |
| 401 | 未携带登录令牌 / 令牌无效或已过期（需重新登录） |

### 2. 读取每日使用目标

```
GET /api/health/daily-goal
```

读取用户在 LineWeb 设定的今日使用目标。

**认证**：`Authorization: Bearer <登录令牌>`

**成功响应** (200)：

```json
{
  "dailyGoalSeconds": 7200,
  "date": "2026-07-17"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `dailyGoalSeconds` | number \| null | 目标秒数，null 表示未设置 |
| `date` | string | 日期 YYYY-MM-DD |

**未设置目标时**：

```json
{
  "dailyGoalSeconds": null,
  "date": "2026-07-17"
}
```

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 401 | 未携带登录令牌 / 令牌无效或已过期 |

> 原第三方专用端点 `GET /api/health/daily-goal/data` 已移除，改用本端点，响应结构完全相同。

### 3. 读取历史屏幕时间（网页端内部使用）

```
GET /api/health/screen-time/range?from=2026-07-01&to=2026-07-31
```

按日期范围读取该用户的屏幕使用时间历史，供 LineWeb 首页「数字健康」热力图使用。
Time Master 客户端无需调用此接口——只需持续推送当日时长，服务端会逐日写入数据库，
历史数据会从首次同步起自动累积。

**认证**：账号登录令牌（`Authorization: Bearer <token>`），非公开接口

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `from` | string | 起始日期，格式 YYYY-MM-DD |
| `to` | string | 结束日期，格式 YYYY-MM-DD；不得早于 from，跨度不超过 62 天 |

**成功响应** (200)：

```json
{
  "logs": [
    { "date": "2026-07-01", "totalSeconds": 5400, "dailyGoalSeconds": 7200 },
    { "date": "2026-07-02", "totalSeconds": 7200, "dailyGoalSeconds": null }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `logs` | array | 范围内的已有记录，按日期升序；缺失日期视为 0（未推送） |
| `logs[].date` | string | 日期 YYYY-MM-DD |
| `logs[].totalSeconds` | number | 当日累计使用秒数 |
| `logs[].dailyGoalSeconds` | number \| null | 当日使用目标秒数，null 表示未设置 |

**错误响应**：

| 状态码 | 说明 |
|--------|------|
| 400 | from/to 格式错误、结束早于起始或跨度超过 62 天 |
| 401 | 未携带登录令牌 / 令牌无效或已过期 |

## 完整示例

### Bash (curl)

```bash
#!/bin/bash
# time-master.sh — 登录 → 推送屏幕时间 → 检查目标

API="https://lineweb.dev/api"
USERNAME="admin"
PASSWORD="你的密码"
TODAY=$(date +%Y-%m-%d)
TOTAL_SECONDS=5400  # 1.5 小时

# 1. 账号登录换取令牌（rememberDays 1–90 天，默认 7 天）
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"identifier\":\"$USERNAME\",\"password\":\"$PASSWORD\",\"rememberDays\":90}" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. 推送今日屏幕使用时间（假设通过系统 API 获取了秒数）
curl -s -X POST "$API/health/push" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"totalSeconds\": $TOTAL_SECONDS, \"date\": \"$TODAY\"}"

echo ""

# 3. 读取每日目标
GOAL=$(curl -s "$API/health/daily-goal" \
  -H "Authorization: Bearer $TOKEN" | grep -o '"dailyGoalSeconds":[0-9]*' | cut -d: -f2)

if [ -n "$GOAL" ] && [ "$GOAL" != "null" ]; then
  REMAINING=$((GOAL - TOTAL_SECONDS))
  if [ $REMAINING -le 0 ]; then
    echo "⚠️  今日使用时长已超目标！"
  else
    echo "✅ 剩余可用：$((REMAINING / 60)) 分钟"
  fi
else
  echo "📝 今日未设置使用目标"
fi
```

### Python

```python
#!/usr/bin/env python3
"""time_master.py — 登录 LineWeb、同步屏幕时间并检查每日目标"""

import os
import requests
from datetime import date

API_URL = os.getenv("LINEWEB_API_URL", "https://lineweb.dev/api").rstrip("/")
USERNAME = os.getenv("LINEWEB_USERNAME", "admin")
PASSWORD = os.getenv("LINEWEB_PASSWORD")
REMEMBER_DAYS = int(os.getenv("LINEWEB_REMEMBER_DAYS", "90"))

if not PASSWORD:
    raise RuntimeError("请设置 LINEWEB_PASSWORD 环境变量（可选 LINEWEB_USERNAME / LINEWEB_REMEMBER_DAYS）")

_token = os.getenv("LINEWEB_TOKEN") or None


def login() -> str:
    """账号登录换取令牌（rememberDays 1–90 天，默认 7 天）"""
    resp = requests.post(f"{API_URL}/auth/login", json={
        "identifier": USERNAME,
        "password": PASSWORD,
        "rememberDays": REMEMBER_DAYS,
    }, timeout=30)
    if resp.status_code == 429:
        raise RuntimeError("登录过于频繁（限流 20 次/15 分钟），请稍后重试")
    resp.raise_for_status()
    return resp.json()["token"]


def auth_headers() -> dict:
    global _token
    if not _token:
        _token = login()
    return {"Authorization": f"Bearer {_token}", "Content-Type": "application/json"}


today = date.today().isoformat()


def get_total_seconds_today() -> int:
    """获取今日屏幕使用秒数——替换为实际的系统 API 调用"""
    # TODO: 替换为实际的屏幕时间统计逻辑
    # 示例：Windows 可通过 GetLastInputInfo / GetTickCount 等 API 获取
    # macOS 可通过 CGEventSourceSecondsSinceLastEventType 等获取
    return 3600  # 占位：1 小时


def push_screen_time(total_seconds: int, date_str: str):
    """推送屏幕使用时间到 LineWeb（只能写入登录账号自己的数据）"""
    global _token
    resp = requests.post(
        f"{API_URL}/health/push",
        headers=auth_headers(),
        json={"totalSeconds": total_seconds, "date": date_str},
    )
    if resp.status_code == 401:          # 令牌过期 / 账号改密码 → 重新登录一次
        _token = login()
        resp = requests.post(
            f"{API_URL}/health/push",
            headers=auth_headers(),
            json={"totalSeconds": total_seconds, "date": date_str},
        )
    resp.raise_for_status()
    print(f"✅ 已同步：{total_seconds} 秒")


def check_daily_goal(date_str: str) -> int | None:
    """读取每日使用目标（秒），返回 None 表示未设置"""
    resp = requests.get(
        f"{API_URL}/health/daily-goal",
        headers=auth_headers(),
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("dailyGoalSeconds")


def main():
    # 1. 获取并推送屏幕时间
    total_seconds = get_total_seconds_today()
    push_screen_time(total_seconds, today)

    # 2. 检查每日目标
    goal = check_daily_goal(today)

    if goal:
        remaining = goal - total_seconds
        hours = goal // 3600
        minutes = (goal % 3600) // 60
        print(f"📊 今日目标：{hours} 小时 {minutes} 分钟")

        if remaining <= 0:
            print(f"⚠️  已超目标 {abs(remaining) // 60} 分钟！")
        else:
            print(f"✅ 剩余可用：{remaining // 60} 分钟")
    else:
        print("📝 今日未设置使用目标")


if __name__ == "__main__":
    main()
```

### Node.js

```javascript
#!/usr/bin/env node
/** time-master.js — 登录 LineWeb、同步屏幕时间并检查每日目标 */

const API_URL = (process.env.LINEWEB_API_URL || 'https://lineweb.dev/api').replace(/\/$/, '')
const USERNAME = process.env.LINEWEB_USERNAME || 'admin'
const PASSWORD = process.env.LINEWEB_PASSWORD
const REMEMBER_DAYS = Number(process.env.LINEWEB_REMEMBER_DAYS || 90)

if (!PASSWORD) {
  console.error('请设置 LINEWEB_PASSWORD 环境变量（可选 LINEWEB_USERNAME / LINEWEB_REMEMBER_DAYS）')
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
let token = process.env.LINEWEB_TOKEN || null

async function login() {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: USERNAME, password: PASSWORD, rememberDays: REMEMBER_DAYS }),
  })
  if (res.status === 429) throw new Error('登录过于频繁（限流 20 次/15 分钟）')
  if (!res.ok) throw new Error(`登录失败: ${res.status}`)
  token = (await res.json()).token
  return token
}

async function authHeaders() {
  if (!token) await login()
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

async function pushScreenTime(totalSeconds, date) {
  const res = await fetch(`${API_URL}/health/push`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({ totalSeconds, date }),
  })
  if (res.status === 401) {          // 令牌过期 / 账号改密码 → 重新登录一次
    await login()
    return pushScreenTime(totalSeconds, date)
  }
  if (!res.ok) throw new Error(`推送失败: ${res.status}`)
  console.log(`✅ 已同步：${totalSeconds} 秒`)
}

async function getDailyGoal() {
  const res = await fetch(`${API_URL}/health/daily-goal`, {
    headers: await authHeaders(),
  })
  if (!res.ok) throw new Error(`获取目标失败: ${res.status}`)
  const data = await res.json()
  return data.dailyGoalSeconds
}

;(async () => {
  // 1. 推送屏幕时间（需替换为真实数据源）
  const totalSeconds = 5400 // 示例：1.5 小时
  await pushScreenTime(totalSeconds, today)

  // 2. 检查目标
  const goal = await getDailyGoal()
  if (goal) {
    const remaining = goal - totalSeconds
    const h = Math.floor(goal / 3600)
    const m = Math.floor((goal % 3600) / 60)
    console.log(`📊 今日目标：${h} 小时 ${m} 分钟`)
    if (remaining <= 0) {
      console.log(`⚠️  已超目标 ${Math.floor(Math.abs(remaining) / 60)} 分钟！`)
    } else {
      console.log(`✅ 剩余可用：${Math.floor(remaining / 60)} 分钟`)
    }
  } else {
    console.log('📝 今日未设置使用目标')
  }
})()
```

## 在 LineWeb 设置每日目标

1. 登录 LineWeb → 个人资料（`/profile`）
2. 滚动到 **数字健康** → **今日使用目标**
3. 设置小时和分钟（如 2 小时 0 分钟）
4. 点击「保存目标」

Time Master 读取到此目标后，即可根据剩余时间进行提醒或限制。

## 常见问题

**Q: 登录令牌过期了怎么办？**
A: 用账号密码重新调用 `POST /api/auth/login` 换取新令牌并覆盖本地缓存。登录时传 `rememberDays`（最大 90 天）可以减少重新登录频率。

**Q: 账号改密码或登出后，设备还能推送吗？**
A: 不能。改密码 / 登出会让该账号的所有旧令牌立即失效，设备会收到 `401`，重新登录一次即可恢复。

**Q: 需要在 LineWeb 个人资料页生成 Token 吗？**
A: 不需要。屏幕时间 Token 已移除，个人资料页不再提供「生成 Token」。设备用账号登录换取令牌即可。

**Q: 如何获取屏幕使用时间？**
- **Windows**：通过 `GetLastInputInfo`、`GetTickCount`、`System.Diagnostics.Stopwatch` 等 API
- **macOS**：通过 `CGEventSourceSecondsSinceLastEventType`、`IOKit` 等
- **Linux**：通过 `/proc/uptime`、`xprintidle` 等

建议每 5-10 分钟推送一次，保持数据实时性。

**Q: 推送失败怎么办？**
脚本应实现重试逻辑。建议在失败时记录日志，下次执行时重试。收到 `401` 时重新登录一次；收到 `429` 说明登录过于频繁（限流 20 次 / 15 分钟），需退避后重试。
