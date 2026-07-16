# Time Master API 接入指南

Time Master 是 LineWeb 的数字健康伴侣——它将本地电脑屏幕使用时间同步到 LineWeb，并读取用户设定的每日使用目标进行时长管控。

## 概述

```
┌─────────────────┐    POST /api/health/push     ┌──────────────────┐
│  Time Master     │ ──────────────────────────► │  LineWeb Server   │
│  (本地脚本)       │    推送屏幕使用时间            │                   │
│                  │ ◄────────────────────────── │                   │
│                  │    GET /api/health/daily-goal/data              │
│                  │    读取每日使用目标             │                   │
└─────────────────┘                             └──────────────────┘
```

**数据流向**：
1. **Time Master → LineWeb**：推送今日屏幕使用时间（秒）
2. **LineWeb → Time Master**：Time Master 读取用户设定的每日目标，据此决定是否提醒/锁定

## 前提条件

1. 拥有 LineWeb 账号（在 [LineWeb](https://lineweb.dev) 注册）
2. 在个人资料页面生成 Screen Time Token（见下方步骤）
3. 具备运行 HTTP 请求的能力（Python/Node.js/Bash 等）

## 第一步：获取 Token

1. 登录 LineWeb，进入 **个人资料** 页面（`/profile`）
2. 滚动到 **数字健康** 板块
3. 在「生成新 Token」区域输入名称（如 `我的电脑`），选择有效期
4. 点击「生成 Token」
5. **立即复制 Token**——仅显示一次，离开页面后无法找回

Token 格式：`st_` 开头，如 `st_a1b2c3d4e5f6...`

## 第二步：设置环境变量

```bash
# Linux/macOS
export LINEWEB_API_URL="https://lineweb.dev/api"
export LINEWEB_SCREEN_TIME_TOKEN="st_your_token_here"

# Windows PowerShell
$env:LINEWEB_API_URL="https://lineweb.dev/api"
$env:LINEWEB_SCREEN_TIME_TOKEN="st_your_token_here"
```

## API 端点

所有端点前缀为 `/api/health`。

### 1. 推送屏幕使用时间

```
POST /api/health/push
```

将今日累计屏幕使用时间推送到 LineWeb。

**认证**：`X-Screen-Time-Token` 请求头

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
| 401 | Token 无效或已过期 |

### 2. 读取每日使用目标

```
GET /api/health/daily-goal/data
```

读取用户在 LineWeb 个人资料中设定的今日使用目标。

**认证**：`X-Screen-Time-Token` 请求头

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
| 401 | Token 无效或已过期 |

## 完整示例

### Bash (curl)

```bash
#!/bin/bash
# time-master.sh — 推送屏幕时间并检查目标

TOKEN="st_your_token_here"
API="https://lineweb.dev/api"
TODAY=$(date +%Y-%m-%d)

# 1. 推送今日屏幕使用时间（假设通过系统 API 获取了秒数）
TOTAL_SECONDS=5400  # 1.5 小时

curl -s -X POST "$API/health/push" \
  -H "X-Screen-Time-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"totalSeconds\": $TOTAL_SECONDS, \"date\": \"$TODAY\"}"

echo ""

# 2. 读取每日目标
GOAL=$(curl -s "$API/health/daily-goal/data" \
  -H "X-Screen-Time-Token: $TOKEN" | grep -o '"dailyGoalSeconds":[0-9]*' | cut -d: -f2)

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
"""time_master.py — 同步屏幕时间并检查每日目标"""

import os
import requests
from datetime import date

API_URL = os.getenv("LINEWEB_API_URL", "https://lineweb.dev/api")
TOKEN = os.getenv("LINEWEB_SCREEN_TIME_TOKEN")

if not TOKEN:
    raise RuntimeError("请设置 LINEWEB_SCREEN_TIME_TOKEN 环境变量")

HEADERS = {
    "X-Screen-Time-Token": TOKEN,
    "Content-Type": "application/json",
}

today = date.today().isoformat()


def get_total_seconds_today() -> int:
    """获取今日屏幕使用秒数——替换为实际的系统 API 调用"""
    # TODO: 替换为实际的屏幕时间统计逻辑
    # 示例：Windows 可通过 GetLastInputInfo / GetTickCount 等 API 获取
    # macOS 可通过 CGEventSourceSecondsSinceLastEventType 等获取
    return 3600  # 占位：1 小时


def push_screen_time(total_seconds: int, date_str: str):
    """推送屏幕使用时间到 LineWeb"""
    resp = requests.post(
        f"{API_URL}/health/push",
        headers=HEADERS,
        json={"totalSeconds": total_seconds, "date": date_str},
    )
    resp.raise_for_status()
    print(f"✅ 已同步：{total_seconds} 秒")


def check_daily_goal(date_str: str) -> int | None:
    """读取每日使用目标（秒），返回 None 表示未设置"""
    resp = requests.get(
        f"{API_URL}/health/daily-goal/data",
        headers={"X-Screen-Time-Token": TOKEN},
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
/** time-master.js — 同步屏幕时间并检查每日目标 */

const API_URL = process.env.LINEWEB_API_URL || 'https://lineweb.dev/api'
const TOKEN = process.env.LINEWEB_SCREEN_TIME_TOKEN

if (!TOKEN) {
  console.error('请设置 LINEWEB_SCREEN_TIME_TOKEN 环境变量')
  process.exit(1)
}

const today = new Date().toISOString().slice(0, 10)
const headers = {
  'X-Screen-Time-Token': TOKEN,
  'Content-Type': 'application/json',
}

async function pushScreenTime(totalSeconds, date) {
  const res = await fetch(`${API_URL}/health/push`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ totalSeconds, date }),
  })
  if (!res.ok) throw new Error(`推送失败: ${res.status}`)
  console.log(`✅ 已同步：${totalSeconds} 秒`)
}

async function getDailyGoal(date) {
  const res = await fetch(`${API_URL}/health/daily-goal/data`, {
    headers: { 'X-Screen-Time-Token': TOKEN },
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
  const goal = await getDailyGoal(today)
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

**Q: Token 过期了怎么办？**
A: 在个人资料的数字健康板块重新生成新 Token，并更新本地脚本的环境变量。

**Q: 如何获取屏幕使用时间？**
- **Windows**：通过 `GetLastInputInfo`、`GetTickCount`、`System.Diagnostics.Stopwatch` 等 API
- **macOS**：通过 `CGEventSourceSecondsSinceLastEventType`、`IOKit` 等
- **Linux**：通过 `/proc/uptime`、`xprintidle` 等

建议每 5-10 分钟推送一次，保持数据实时性。

**Q: 推送失败怎么办？**
脚本应实现重试逻辑。建议在失败时记录日志，下次执行时重试。
