# LineWeb 健康系统 API 文档

数字健康模块——将本地电脑屏幕使用时间同步到 LineWeb，读取/设置每日使用目标，供首页「数字健康」卡片与热力图展示。适合第三方桌面客户端（如 Time Master）、脚本直接接入：**设备使用账号登录令牌**（`POST /api/auth/login` 换取，可用 `rememberDays` 申请长期令牌），不再有独立的屏幕时间 Token。

> **凭证变更（2026-09）**：屏幕时间 Token（`X-Screen-Time-Token`、`st_` 前缀）及其管理端点 `/api/health/tokens` 已移除，表 `screen_time_tokens` 已删除，旧 Token 全部失效；`/api/health/screen-time/data`、`/api/health/daily-goal/data` 两个「第三方专用」端点同步取消。第三方设备改为**账号登录**，所有请求携带 `Authorization: Bearer <登录令牌>`。

## 目录

- [1. 概述](#1-概述)
- [2. 认证方式](#2-认证方式)
- [3. 设备长期登录令牌（rememberDays）](#3-设备长期登录令牌rememberdays)
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
│                 │    GET /api/health/daily-goal    │                  │
│                 │    读取每日使用目标             │                  │
└─────────────────┘                              └──────────────────┘
```

| 属性 | 值 |
|---|---|
| 基础 URL | 生产 `http://服务器地址:3001/api` / 开发 `http://localhost:3001/api` |
| 数据格式 | JSON（`Content-Type: application/json`） |
| 认证 | 账号登录令牌 `Authorization: Bearer <token>`（**全部端点**） |
| 日期格式 | `YYYY-MM-DD`（如 `2026-08-12`） |
| 时区 | **Asia/Shanghai (UTC+8)**，服务端按此计算"今日" |
| 数据粒度 | 按用户 + 日期一行（`screen_time_logs` 表，唯一键 `userId_date`），同一天重复推送为覆盖更新 |
| 数据范围 | 令牌只能读写**登录账号本人**的数据，无法跨账号访问 |

**模块前缀**：所有端点以 `/api/health` 开头。

**端点一览：**

| 方法 | 路径 | 认证 | 用途 |
|---|---|---|---|
| POST | `/api/health/push` | 登录令牌 | 推送今日屏幕使用时间（写入本人数据） |
| GET | `/api/health/screen-time` | 登录令牌 | 我的今日屏幕时间 |
| GET | `/api/health/screen-time/range?from=&to=` | 登录令牌 | 日期范围历史（热力图） |
| PUT | `/api/health/daily-goal` | 登录令牌 | 设置今日使用目标 |
| GET | `/api/health/daily-goal` | 登录令牌 | 读取今日使用目标 |

> `GET /api/health`（服务健康检查）是唯一的公开端点，不在此表内。
>
> **已移除**：`POST/GET/DELETE /api/health/tokens`（屏幕时间 Token 管理）、`GET /api/health/screen-time/data`、`GET /api/health/daily-goal/data`（原第三方专用读取端点）。第三方直接调用上面的 `/api/health/screen-time` 与 `/api/health/daily-goal` 即可，响应结构完全相同。

---

## 2. 认证方式

健康模块**只有一种认证**：账号登录令牌。网页端与第三方设备使用完全相同的凭证与请求头。

```
Authorization: Bearer <jwt_token>
```

令牌通过 `POST /api/auth/login` 获取：

- 默认有效期 **7 天**
- 请求体可带 `rememberDays`（整数 1–90）申请更长的有效期，供设备长期登录使用（仍是同一个登录令牌，**不引入第二套凭证**）
- 令牌只签 `{ userId, role }`；能力与网盘开关每次请求从数据库解析；登出 / 改密码会让该账号所有旧令牌立即失效

> **已移除的请求头**：`X-Screen-Time-Token`（以及 `X-API-Key`）自 2026-09 起不再被识别，携带它们等同于未认证，返回 `401`。
>
> `POST /api/health/push` 不在全局公开白名单中（`/health/*` 前缀在白名单内，但其路由内部强制 `authenticate`），**不携带登录令牌无法使用**。

---

## 3. 设备长期登录令牌（rememberDays）

第三方设备（Time Master、脚本、定时任务）不需要任何独立密钥，用**账号登录**换取令牌即可长期使用。

### 3.1 登录换取令牌

```
POST /api/auth/login
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| identifier | string | 是 | 用户名或邮箱 |
| password | string | 是 | 账号密码 |
| rememberDays | integer | 否 | 令牌有效期天数，**1–90**；默认 7 天。设备建议传 90 |

```json
{
  "identifier": "admin",
  "password": "你的密码",
  "rememberDays": 90
}
```

**成功响应（200）：**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin",
    "capabilities": ["content:write", "comment:moderate", "user:manage", "stats:view", "device:view", "ai:configure", "drive:all"],
    "canAccessDrive": true
  }
}
```

> `rememberDays` 只影响令牌有效期，签发的仍是**同一个账号登录令牌**。健康模块端点只要求登录，不要求任何管理能力，`capabilities` 为空也完全可用。

### 3.2 设备端处理约定

- **缓存令牌**：首次登录后把令牌存到本地配置文件或环境变量，后续推送直接复用
- **401 时重新登录**：令牌过期、账号登出或改密码后服务端返回 `401`，重新登录一次并覆盖本地缓存即可
- **注意限流**：登录端点 **20 次 / 15 分钟（按 IP）**，不要每次推送都登录；返回 `429` 说明登录过于频繁
- **无需任何密钥**：设备与网页端共用账号，不需要单独发放凭证，也无法拿到第二套凭证

> **已移除**（2026-09）：`POST /api/health/tokens`、`GET /api/health/tokens`、`DELETE /api/health/tokens/:id` 三个屏幕时间 Token 管理端点，以及屏幕时间 Token 本身。个人资料页不再提供「生成 Token」，第三方设备改用上面的账号登录流程。

---

## 4. 推送屏幕使用时间

第三方客户端定期把当日累计屏幕使用秒数推送到 LineWeb，写入的是**登录账号自己**的数据。

```
POST /api/health/push
Authorization: Bearer <jwt_token>
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
| 401 | 未携带登录令牌 / 令牌无效或已过期（需重新登录） |

> **语义**：`totalSeconds` 是**当日累计值**（从零点到现在的总时长），不是增量。同一日期重复推送会覆盖该日记录，所以建议周期性（每 5-15 分钟）推送当前累计值即可。
>
> 历史数据从首次推送起逐日累积，无需额外批量导入。

---

## 5. 读取今日屏幕时间

网页端与第三方客户端使用**同一个端点**：

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

> 该端点同时服务于网页端与第三方客户端：返回的永远是**令牌所属账号**今日的数据（原第三方端点 `GET /api/health/screen-time/data` 已随屏幕时间 Token 一并移除，改用本端点即可，响应结构完全相同）。

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
| 401 | 未携带登录令牌 / 令牌无效或已过期 |

> 本端点使用账号登录令牌；第三方客户端一般不需要调用（只需持续推送当日时长），如需展示历史可直接用同一令牌请求。

---

## 7. 每日使用目标

### 7.1 设置今日目标

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

### 7.2 读取今日目标

```
GET /api/health/daily-goal
Authorization: Bearer <jwt_token>
```

**响应：**

```json
{ "dailyGoalSeconds": 7200, "date": "2026-08-12" }
```

未设置时 `dailyGoalSeconds` 为 `null`。

> Time Master 等第三方客户端用同一登录令牌请求本端点即可读到用户在 LineWeb 设定的目标，据此进行时长提醒或锁定（原第三方端点 `GET /api/health/daily-goal/data` 已移除，响应结构完全相同）。

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

### 9.1 curl（登录 + 推送 + 读目标）

```bash
API="http://服务器地址:3001/api"
TODAY=$(date +%Y-%m-%d)

# 1. 登录换取令牌（设备建议 rememberDays=90 申请长期令牌）
TOKEN=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin","password":"你的密码","rememberDays":90}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# 2. 推送今日屏幕使用时间（示例：1.5 小时）
curl -s -X POST "$API/health/push" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"totalSeconds\": 5400, \"date\": \"$TODAY\"}"

echo ""

# 3. 读取每日目标
curl -s "$API/health/daily-goal" \
  -H "Authorization: Bearer $TOKEN"
```

### 9.2 Python（推荐，完整流程）

```python
#!/usr/bin/env python3
"""登录 LineWeb → 推送屏幕时间 → 检查每日目标"""

import os
import requests
from datetime import date

API_URL = os.getenv("LINEWEB_API_URL", "http://服务器地址:3001/api").rstrip("/")
USERNAME = os.getenv("LINEWEB_USERNAME", "admin")
PASSWORD = os.getenv("LINEWEB_PASSWORD")
REMEMBER_DAYS = int(os.getenv("LINEWEB_REMEMBER_DAYS", "90"))

if not PASSWORD:
    raise RuntimeError("请设置 LINEWEB_PASSWORD 环境变量")

today = date.today().isoformat()
_token = os.getenv("LINEWEB_TOKEN") or None


def login() -> str:
    """用账号密码换取账号登录令牌（rememberDays 1–90 天，默认 7 天）。"""
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


def get_total_seconds_today() -> int:
    """获取今日屏幕使用秒数——替换为实际的系统 API 调用。"""
    # TODO: Windows 可用 GetLastInputInfo / GetTickCount 等 API
    # macOS 可用 CGEventSourceSecondsSinceLastEventType 等
    return 5400  # 占位：1.5 小时


def push_screen_time(total_seconds: int, date_str: str):
    global _token
    resp = requests.post(
        f"{API_URL}/health/push",
        headers=auth_headers(),
        json={"totalSeconds": total_seconds, "date": date_str},
        timeout=30,
    )
    if resp.status_code == 401:      # 令牌过期 / 账号改密码 → 重新登录一次
        _token = login()
        resp = requests.post(
            f"{API_URL}/health/push",
            headers=auth_headers(),
            json={"totalSeconds": total_seconds, "date": date_str},
            timeout=30,
        )
    resp.raise_for_status()
    print(f"✅ 已同步：{total_seconds} 秒")


def check_daily_goal() -> int | None:
    resp = requests.get(
        f"{API_URL}/health/daily-goal",
        headers=auth_headers(),
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("dailyGoalSeconds")


def main():
    total_seconds = get_total_seconds_today()
    push_screen_time(total_seconds, today)

    goal = check_daily_goal()
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

> 仓库内已有可直接运行的参考脚本：`scripts/time-master-push.py`（账号登录 + `rememberDays`，默认每 15 分钟推送一次，`--now` 立即推送）。

### 9.3 Node.js

```javascript
#!/usr/bin/env node
const API_URL = process.env.LINEWEB_API_URL || 'http://服务器地址:3001/api'
const USERNAME = process.env.LINEWEB_USERNAME || 'admin'
const PASSWORD = process.env.LINEWEB_PASSWORD
const REMEMBER_DAYS = Number(process.env.LINEWEB_REMEMBER_DAYS || 90)

if (!PASSWORD) {
  console.error('请设置 LINEWEB_PASSWORD 环境变量')
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
  if (res.status === 401) {            // 令牌过期 / 账号改密码 → 重新登录一次
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

### 9.4 读取历史（登录令牌）

```python
import requests

API = 'http://服务器地址:3001/api'
TOKEN = 'eyJhbGciOiJIUzI1NiIs...'  # POST /api/auth/login 获取

resp = requests.get(
    f'{API}/health/screen-time/range',
    params={'from': '2026-07-01', 'to': '2026-07-31'},
    headers={'Authorization': f'Bearer {TOKEN}'},
)
print(resp.json()['logs'])
```

---

## 10. 常见问题

**Q: 登录令牌过期了怎么办？**
重新调用 `POST /api/auth/login` 换取新令牌并更新本地缓存。设备建议登录时传 `rememberDays`（最大 90 天）减少重新登录次数。

**Q: 令牌泄露了怎么办？**
在 LineWeb 修改密码（或登出），该账号的**所有**旧令牌立即失效；然后重新登录一次即可继续推送。

**Q: 还需要去个人资料页生成 Token 吗？**
不需要。屏幕时间 Token 已移除，个人资料页不再有「生成 Token」。第三方设备用账号登录换取令牌即可，健康模块只要求登录、不要求任何管理能力。

**Q: 如何获取本机屏幕使用时间？**
- **Windows**：`GetLastInputInfo`、`GetTickCount`、`System.Diagnostics.Stopwatch` 等
- **macOS**：`CGEventSourceSecondsSinceLastEventType`、`IOKit` 等
- **Linux**：`/proc/uptime`、`xprintidle` 等

建议每 5-10 分钟推送一次，保持数据实时性。

**Q: 推送失败怎么办？**
脚本应实现重试逻辑：失败时记录日志，下次执行时重试（服务端按 `userId + date` 覆盖写入，重复推送无害）。收到 `401` 时重新登录一次；收到 `429` 说明登录过于频繁，需退避重试。

**Q: 推送的数据会写到别人账号上吗？**
不会。`POST /api/health/push` 只写入**登录令牌所属账号**的数据，请求体中没有也不接受 `userId`。

**Q: 今日屏幕时间为什么是 0？**
说明今日还没有推送过记录。第三方首次推送后即正常。

---

## 参考

- 仓库脚本：`scripts/time-master-push.py`、`scripts/time-master-guide.md`、`scripts/lineweb-screen-time-api.md`
- 服务端实现：`server/src/routes/health.ts`、`server/src/services/screenTimeService.ts`
- 通用 API 教程：`docs/api.md`
- 部署指南：`docs/DEPLOYMENT_HTTP_3001.md`
