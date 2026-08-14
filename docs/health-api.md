# LineWeb 健康系统 API 文档

数字健康模块——将本地电脑屏幕使用时间同步到 LineWeb，读取/设置每日使用目标，供首页「数字健康」卡片与热力图展示。本模块**独立于普通业务 API**，自带一套 `st_` 开头的屏幕时间 Token 认证，适合第三方桌面客户端（如 Time Master）、脚本直接接入。

## 目录

- [1. 概述](#1-概述)
- [2. 认证方式](#2-认证方式)
- [3. 屏幕时间 Token 管理（JWT）](#3-屏幕时间-token-管理jwt)
- [4. 推送屏幕使用时间](#4-推送屏幕使用时间)
- [5. 读取今日屏幕时间](#5-读取今日屏幕时间)
- [6. 读取日期范围历史](#6-读取日期范围历史)
- [7. 每日使用目标](#7-每日使用目标)
- [8. 时区说明](#8-时区说明)
- [9. 完整示例](#9-完整示例)
- [10. 常见问题](#10-常见问题)

---

## 1. 概述

```
┌─────────────────┐    POST /api/health/push      ┌──────────────────┐
│  第三方客户端     │ ───────────────────────────► │  LineWeb Server   │
│  (Time Master)  │    推送今日屏幕使用时间         │                  │
│                 │ ◄───────────────────────────  │                  │
│                 │    GET /api/health/daily-goal/data               │
│                 │    读取每日使用目标             │                  │
└─────────────────┘                              └──────────────────┘
```

| 属性 | 值 |
|---|---|
| 基础 URL | 生产 `http://服务器地址:3001/api` / 开发 `http://localhost:3001/api` |
| 数据格式 | JSON（`Content-Type: application/json`） |
| 日期格式 | `YYYY-MM-DD`（如 `2026-08-12`） |
| 时区 | **Asia/Shanghai (UTC+8)**，服务端按此计算"今日" |
| 数据粒度 | 按用户 + 日期一行（`screen_time_logs` 表，唯一键 `userId_date`），同一天重复推送为覆盖更新 |

**模块前缀**：所有端点以 `/api/health` 开头。

**端点一览：**

| 方法 | 路径 | 认证 | 用途 |
|---|---|---|---|
| POST | `/api/health/push` | `st_` Token | 推送今日屏幕使用时间 |
| GET | `/api/health/screen-time` | JWT | 网页端：我的今日屏幕时间 |
| GET | `/api/health/screen-time/range?from=&to=` | JWT | 网页端：日期范围历史（热力图） |
| GET | `/api/health/screen-time/data` | `st_` Token | 第三方：读取今日屏幕时间 |
| PUT | `/api/health/daily-goal` | JWT | 网页端：设置今日使用目标 |
| GET | `/api/health/daily-goal` | JWT | 网页端：读取今日使用目标 |
| GET | `/api/health/daily-goal/data` | `st_` Token | 第三方：读取每日使用目标 |
| POST | `/api/health/tokens` | JWT | 生成屏幕时间 Token |
| GET | `/api/health/tokens` | JWT | 列出我的屏幕时间 Token |
| DELETE | `/api/health/tokens/:id` | JWT | 删除屏幕时间 Token |

---

## 2. 认证方式

健康系统支持两套认证，按调用方区分：

### 2.1 JWT（网页端）

LineWeb 前端页面使用，与普通业务 API 一致：

```
Authorization: Bearer <jwt_token>
```

Token 通过 `POST /api/auth/login` 获取，有效期 7 天。

### 2.2 屏幕时间 Token（第三方/脚本）

为桌面客户端、命令行脚本等设计的独立凭证，**不需要账号密码**，仅用于健康模块的特定端点。

```
X-Screen-Time-Token: st_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- 格式：`st_` + 64 位 hex（如 `st_a1b2c3d4...`）
- 数据库只存 **sha256 哈希**，明文仅生成时返回一次
- 支持设置过期时间（永久 / 7 天 / 30 天）
- 两个端点的**备选传法**：也可放入 `Authorization: Bearer <st_...>`

> `GET /api/health/push` 在全局公开白名单中，但其路由层强制校验 `st_` Token（Token 无效返回 401），所以**不携带 Token 无法使用**。

**获取方式**：登录 LineWeb → 个人资料页（`/profile`）→ 数字健康板块 →「生成新 Token」→ 输入名称、选择有效期 → **立即复制**（仅显示一次，离开后无法找回）。

---

## 3. 屏幕时间 Token 管理（JWT）

### 3.1 生成 Token

```
POST /api/health/tokens
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| name | string | 否 | `Time Master` | Token 名称，1-100 字符，用于区分多个客户端 |
| expiresAt | string | 否 | 永久 | 过期时间，ISO 日期（如 `2027-01-01`） |

**成功响应（200）：**

```json
{
  "id": 2,
  "name": "我的电脑",
  "token": "st_a1b2c3d4...64位hex",
  "expiresAt": null,
  "createdAt": "2026-08-12T10:00:00.000Z"
}
```

> ⚠️ `token` 仅此一次返回完整值，请立即保存。之后任何接口都只能看到脱敏形式 `st_a1b2...cdef`。

### 3.2 列出我的 Token

```
GET /api/health/tokens
Authorization: Bearer <jwt_token>
```

**响应：**

```json
{
  "tokens": [
    {
      "id": 2,
      "name": "我的电脑",
      "token": "st_a1b2...cdef",
      "expiresAt": null,
      "createdAt": "2026-08-12T10:00:00.000Z"
    }
  ]
}
```

> `token` 字段为脱敏形式（前 6 位 + `...` + 后 6 位），仅用于识别。

### 3.3 删除 Token

```
DELETE /api/health/tokens/:id
Authorization: Bearer <jwt_token>
```

删除后使用该 Token 的客户端立即失效。

**响应：** `{ "message": "已删除" }`

---

## 4. 推送屏幕使用时间

第三方客户端定期把当日累计屏幕使用秒数推送到 LineWeb。

```
POST /api/health/push
X-Screen-Time-Token: st_你的token
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 范围 | 说明 |
|---|---|---|---|---|
| totalSeconds | number (整数) | 是 | 0 - 86400 | 当日累计使用秒数 |
| date | string | 是 | `YYYY-MM-DD` | 日期 |

```json
{
  "totalSeconds": 3665,
  "date": "2026-08-12"
}
```

**成功响应（200）：**

```json
{ "message": "已同步" }
```

**错误响应：**

| 状态码 | 说明 |
|---|---|
| 400 | `totalSeconds` 超范围或 `date` 格式错误 |
| 401 | Token 无效或已过期 |

> **语义**：`totalSeconds` 是**当日累计值**（从零点到现在的总时长），不是增量。同一日期重复推送会覆盖该日记录，所以建议周期性（每 5-15 分钟）推送当前累计值即可。
>
> 历史数据从首次推送起逐日累积，无需额外批量导入。

---

## 5. 读取今日屏幕时间

### 5.1 网页端（JWT）

```
GET /api/health/screen-time
Authorization: Bearer <jwt_token>
```

**响应：**

```json
{
  "totalSeconds": 5400,
  "dailyGoalSeconds": 7200,
  "date": "2026-08-12",
  "reportedAt": "2026-08-12T10:30:00.000Z",
  "updatedAt": "2026-08-12T10:30:00.000Z"
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| totalSeconds | number | 今日累计使用秒数（无记录时为 0） |
| dailyGoalSeconds | number \| null | 今日使用目标秒数，null 表示未设置 |
| date | string | 日期 `YYYY-MM-DD` |
| reportedAt | string \| null | 最近一次推送时间（未推送过为 null） |
| updatedAt | string \| null | 最近一次更新（含仅设置目标）时间 |

### 5.2 第三方（st_ Token）

```
GET /api/health/screen-time/data
X-Screen-Time-Token: st_你的token
```

响应结构与 5.1 相同。供第三方客户端展示或联动。

---

## 6. 读取日期范围历史

供首页「数字健康」热力图使用，按日期范围返回逐日记录。

```
GET /api/health/screen-time/range?from=2026-08-01&to=2026-08-12
Authorization: Bearer <jwt_token>
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| from | string | 是 | 起始日期 `YYYY-MM-DD` |
| to | string | 是 | 结束日期 `YYYY-MM-DD`；不得早于 from，跨度不超过 **62 天** |

**成功响应（200）：**

```json
{
  "logs": [
    { "date": "2026-08-01", "totalSeconds": 5400, "dailyGoalSeconds": 7200 },
    { "date": "2026-08-02", "totalSeconds": 7200, "dailyGoalSeconds": null }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| logs | array | 范围内已有记录，按日期升序；缺失日期视为 0（未推送） |
| logs[].date | string | 日期 |
| logs[].totalSeconds | number | 当日累计使用秒数 |
| logs[].dailyGoalSeconds | number \| null | 当日目标秒数，null 表示未设置 |

**错误响应：**

| 状态码 | 说明 |
|---|---|
| 400 | from/to 格式错误、结束早于起始或跨度超过 62 天 |
| 401 | 未登录或 Token 无效 |

> 本端点仅支持 JWT 认证（网页端内部使用）；第三方客户端不需要调用，只需持续推送当日时长。

---

## 7. 每日使用目标

### 7.1 设置今日目标（JWT）

```
PUT /api/health/daily-goal
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 范围 | 说明 |
|---|---|---|---|---|
| goalSeconds | number \| null | 是 | 0 - 86400 | 目标秒数；传 `null` 清除目标 |

```json
{ "goalSeconds": 7200 }
```

**成功响应：** 返回设置后的目标：

```json
{ "dailyGoalSeconds": 7200, "date": "2026-08-12" }
```

> 设置目标会创建/更新当日的日志行（`totalSeconds` 无记录时为 0）。

### 7.2 读取今日目标（JWT）

```
GET /api/health/daily-goal
Authorization: Bearer <jwt_token>
```

**响应：**

```json
{ "dailyGoalSeconds": 7200, "date": "2026-08-12" }
```

未设置时 `dailyGoalSeconds` 为 `null`。

### 7.3 第三方读取每日目标

```
GET /api/health/daily-goal/data
X-Screen-Time-Token: st_你的token
```

响应结构与 7.2 相同。Time Master 读取到此目标后，可据此进行时长提醒或锁定。

---

## 8. 时区说明

- 服务端所有"今日"计算统一使用 **Asia/Shanghai (UTC+8)**，不随服务器时区变化。
- 代码中采用手动 +8 小时偏移（`getTodayDate()`），避免 Alpine 环境缺 ICU 导致 `Intl` 异常。
- **日期由谁决定**：
  - 推送（`push`）：`date` 字段由调用方指定。第三方建议用**本地日期**（与用户所在时区一致）计算。
  - 读取（`screen-time`、`daily-goal`）：服务端按 UTC+8 计算"今日"。
- 中国不实行夏令时，无需额外修正。

---

## 9. 完整示例

### 9.1 curl（推送 + 读目标）

```bash
TOKEN="st_你的token"
API="http://服务器地址:3001/api"
TODAY=$(date +%Y-%m-%d)

# 1. 推送今日屏幕使用时间（示例：1.5 小时）
curl -s -X POST "$API/health/push" \
  -H "X-Screen-Time-Token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"totalSeconds\": 5400, \"date\": \"$TODAY\"}"

echo ""

# 2. 读取每日目标
curl -s "$API/health/daily-goal/data" \
  -H "X-Screen-Time-Token: $TOKEN"
```

### 9.2 Python（推荐，完整流程）

```python
#!/usr/bin/env python3
"""推送屏幕时间并检查每日目标"""

import os
import requests
from datetime import date

API_URL = os.getenv("LINEWEB_API_URL", "http://服务器地址:3001/api")
TOKEN = os.getenv("LINEWEB_SCREEN_TIME_TOKEN")

if not TOKEN:
    raise RuntimeError("请设置 LINEWEB_SCREEN_TIME_TOKEN 环境变量")

HEADERS = {
    "X-Screen-Time-Token": TOKEN,
    "Content-Type": "application/json",
}

today = date.today().isoformat()


def get_total_seconds_today() -> int:
    """获取今日屏幕使用秒数——替换为实际的系统 API 调用。"""
    # TODO: Windows 可用 GetLastInputInfo / GetTickCount 等 API
    # macOS 可用 CGEventSourceSecondsSinceLastEventType 等
    return 5400  # 占位：1.5 小时


def push_screen_time(total_seconds: int, date_str: str):
    resp = requests.post(
        f"{API_URL}/health/push",
        headers=HEADERS,
        json={"totalSeconds": total_seconds, "date": date_str},
        timeout=30,
    )
    resp.raise_for_status()
    print(f"✅ 已同步：{total_seconds} 秒")


def check_daily_goal(date_str: str) -> int | None:
    resp = requests.get(
        f"{API_URL}/health/daily-goal/data",
        headers={"X-Screen-Time-Token": TOKEN},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("dailyGoalSeconds")


def main():
    total_seconds = get_total_seconds_today()
    push_screen_time(total_seconds, today)

    goal = check_daily_goal(today)
    if goal:
        remaining = goal - total_seconds
        print(f"📊 今日目标：{goal // 3600} 小时 {(goal % 3600) // 60} 分钟")
        if remaining <= 0:
            print(f"⚠️  已超目标 {abs(remaining) // 60} 分钟！")
        else:
            print(f"✅ 剩余可用：{remaining // 60} 分钟")
    else:
        print("📝 今日未设置使用目标")


if __name__ == "__main__":
    main()
```

> 仓库内已有可直接运行的参考脚本：`scripts/time-master-push.py`（默认每 15 分钟推送一次，`--now` 立即推送）。

### 9.3 Node.js

```javascript
#!/usr/bin/env node
const API_URL = process.env.LINEWEB_API_URL || 'http://服务器地址:3001/api'
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

async function getDailyGoal() {
  const res = await fetch(`${API_URL}/health/daily-goal/data`, {
    headers: { 'X-Screen-Time-Token': TOKEN },
  })
  if (!res.ok) throw new Error(`获取目标失败: ${res.status}`)
  return (await res.json()).dailyGoalSeconds
}

;(async () => {
  const totalSeconds = 5400 // 示例：1.5 小时
  await pushScreenTime(totalSeconds, today)

  const goal = await getDailyGoal()
  if (goal) {
    const remaining = goal - totalSeconds
    console.log(`📊 今日目标：${Math.floor(goal / 3600)} 小时 ${Math.floor((goal % 3600) / 60)} 分钟`)
    console.log(remaining <= 0
      ? `⚠️  已超目标 ${Math.floor(Math.abs(remaining) / 60)} 分钟！`
      : `✅ 剩余可用：${Math.floor(remaining / 60)} 分钟`)
  } else {
    console.log('📝 今日未设置使用目标')
  }
})()
```

### 9.4 网页端读取历史（JWT）

```python
import requests

API = 'http://服务器地址:3001/api'
TOKEN = 'eyJhbGciOiJIUzI1NiIs...'  # 登录获取

resp = requests.get(
    f'{API}/health/screen-time/range',
    params={'from': '2026-07-01', 'to': '2026-07-31'},
    headers={'Authorization': f'Bearer {TOKEN}'},
)
print(resp.json()['logs'])
```

---

## 10. 常见问题

**Q: Token 过期了怎么办？**
在个人资料的数字健康板块重新生成新 Token，并更新本地脚本的环境变量。

**Q: Token 泄露了怎么办？**
在个人资料页删除该 Token，所有使用它的客户端立即失效，然后重新生成。

**Q: 如何获取本机屏幕使用时间？**
- **Windows**：`GetLastInputInfo`、`GetTickCount`、`System.Diagnostics.Stopwatch` 等
- **macOS**：`CGEventSourceSecondsSinceLastEventType`、`IOKit` 等
- **Linux**：`/proc/uptime`、`xprintidle` 等

建议每 5-10 分钟推送一次，保持数据实时性。

**Q: 推送失败怎么办？**
脚本应实现重试逻辑：失败时记录日志，下次执行时重试（服务端按 `userId + date` 覆盖写入，重复推送无害）。

**Q: 网页端如何给第三方生成 Token？**
网页端登录后 `POST /api/health/tokens`（JWT）即可生成，无需进入个人资料页。

**Q: 今日屏幕时间为什么是 0？**
说明今日还没有推送过记录。第三方首次推送后即正常。

---

## 参考

- 仓库脚本：`scripts/time-master-push.py`、`scripts/time-master-guide.md`、`scripts/lineweb-screen-time-api.md`
- 服务端实现：`server/src/routes/health.ts`、`server/src/services/screenTimeService.ts`、`server/src/middleware/screenTimeAuth.ts`
- 通用 API 教程：`docs/api.md`
- 部署指南：`docs/DEPLOYMENT_HTTP_3001.md`
