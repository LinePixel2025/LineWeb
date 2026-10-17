# LineWeb 登录认证 API 接入文档

> 适用版本：2026-09 起（认证已统一为「账号登录令牌 + 角色能力矩阵」）
> 相关文档：[`api.md`](./api.md)（全部端点详解）、[`app-auth-api.md`](./app-auth-api.md)（**第三方应用授权**，OAuth 2.0 授权码 + PKCE）、[`health-api.md`](./health-api.md)（屏幕时间/数字健康）、[`time-master-api-guide.md`](./time-master-api-guide.md)（设备接入）
> 服务端实现：`server/src/middleware/auth.ts`、`server/src/lib/permissions.ts`、`server/src/routes/auth.ts`

> **给第三方应用开发者**：如果你的应用需要代表用户访问 LineWeb API，请优先使用 [`app-auth-api.md`](./app-auth-api.md) 描述的 OAuth 授权流程 —— 用户不必把密码交给你，令牌权限也能被限制在最小范围。本文档描述的账号登录令牌适合浏览器前端、自用脚本等「用户自己直接持有凭据」的场景。

---

## 目录

1. [概述](#1-概述)
2. [快速开始](#2-快速开始)
3. [认证端点](#3-认证端点)
4. [令牌规范与生命周期](#4-令牌规范与生命周期)
5. [角色与能力矩阵](#5-角色与能力矩阵)
6. [公开端点与可选认证](#6-公开端点与可选认证)
7. [下载票据](#7-下载票据)
8. [错误处理](#8-错误处理)
9. [客户端接入示例](#9-客户端接入示例)
10. [从 API Key / 屏幕时间 Token 迁移](#10-从-api-key--屏幕时间-token-迁移)
11. [安全建议](#11-安全建议)
12. [接入自检清单](#12-接入自检清单)

---

## 1. 概述

LineWeb **只有一种 API 凭证**：用 LineWeb 账号登录换取的访问令牌（JWT）。

```
POST /api/auth/login  →  { token, user }
                          ↓
之后每个请求：Authorization: Bearer <token>
                          ↓
服务端逐请求解析该账号的 role → capabilities → 放行 / 403
```

| 特性 | 说明 |
|---|---|
| 唯一凭证 | 账号登录令牌；**没有** API Key，也**没有**独立的屏幕时间 Token |
| 权限来源 | 账号角色（`user` / `admin`）展开的能力矩阵，随请求从数据库解析 |
| 角色即时生效 | 管理员调整某账号角色后，该账号**无需重新登录**即按新权限放行 |
| 同一账号多端 | 浏览器、脚本、桌面设备可用同一个令牌体系，各自独立登录 |
| 令牌失效 | 登出、修改密码、删除账号后旧令牌立即失效（精确到毫秒） |
| 设备长期登录 | 登录时可传 `rememberDays`（1–90 天），仍是同一登录令牌 |

**不再支持的凭证**（调用会得到 401）：

- `X-API-Key: lw_...`（API Key 已删除，`api_keys` 表已移除）
- `X-Screen-Time-Token: st_...`（屏幕时间 Token 已删除，`screen_time_tokens` 表已移除）
- 对应的端点 `/api/api-keys`、`/api/health/tokens`、`/api/health/screen-time/data`、`/api/health/daily-goal/data` 已移除（404）

---

## 2. 快速开始

```bash
# 1) 登录换取令牌
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin","password":"你的密码"}'

# 2) 查看当前账号与能力清单
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer <token>"

# 3) 调用业务端点（示例：文章列表）
curl "http://localhost:3001/api/posts?page=1&limit=10" \
  -H "Authorization: Bearer <token>"
```

生产环境把 `http://localhost:3001` 换成公网入口 `https://web.linetech.online`（Cloudflare Tunnel，HTTPS）；IP 直连 `http://<ECS 公网 IP>:3001` 为明文备用入口。

---

## 3. 认证端点

所有端点前缀 `/api`，请求与响应均为 JSON（`Content-Type: application/json`）。

### 3.1 登录

```
POST /api/auth/login
```

**请求体**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `identifier` | string | 三选一 | 用户名或邮箱，自动识别 |
| `username` | string | 三选一 | 兼容写法，等价于 `identifier` |
| `email` | string | 三选一 | 兼容写法，等价于 `identifier` |
| `password` | string | ✅ | 账号密码 |
| `rememberDays` | integer | ✖ | 设备长期令牌有效期（天），**1–90**；不传则用默认值 7 天 |

**响应 200**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9....",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "admin@lineweb.dev",
    "role": "admin",
    "capabilities": [
      "content:write", "comment:moderate", "user:manage",
      "stats:view", "device:view", "ai:configure", "drive:all"
    ],
    "settings": null,
    "canAccessDrive": true
  }
}
```

**错误**

| 状态码 | 响应 | 场景 |
|---|---|---|
| 400 | `{"error":"输入数据无效"}` | 缺少标识或密码、`rememberDays` 越界 |
| 401 | `{"error":"用户名或邮箱与密码不匹配"}` | 账号不存在或密码错误（不区分，避免账号探测） |
| 429 | `{"error":"请求过于频繁，请 15 分钟后再试"}` | 登录限流：**每 IP 20 次 / 15 分钟** |

> `capabilities` 是「本账号当前拥有的能力」，前端可直接用它渲染菜单与页面；服务端在每次请求上重新解析，不能也不应缓存在客户端当作权限判断依据。

### 3.2 注册

```
POST /api/auth/register
```

**请求体**：`username`（2–50 字符）、`email`（合法邮箱，≤100）、`password`（6–100）。

**响应 201**：与登录相同结构（含 `token` 与 `user.capabilities`）。新账号角色固定为 `user`（无管理能力），网盘访问需管理员开启。

**错误**：400 输入无效；409 `{"error":"用户名或邮箱已被注册"}`；429 限流（同登录，20 次 / 15 分钟）。

### 3.3 获取当前账号

```
GET /api/auth/me        (需登录)
```

**响应 200**

```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@lineweb.dev",
  "role": "admin",
  "capabilities": ["content:write", "..."],
  "settings": null,
  "canAccessDrive": true,
  "createdAt": "2026-08-21T10:00:00.000Z"
}
```

### 3.4 更新个人资料（用户名 / 密码）

```
PUT /api/auth/profile   (需登录)
```

| 字段 | 说明 |
|---|---|
| `username` | 新用户名（2–50），需唯一 |
| `currentPassword` | 当前密码（改密码时必填） |
| `newPassword` | 新密码（6–100） |

至少提供 `username` 或 `newPassword` 之一。

**响应 200**

```json
{ "user": { "id": 1, "username": "newname", "..." : "..." }, "token": "新令牌（仅改密码时返回）" }
```

- 改密码成功后会**使该账号所有旧令牌立即失效**，并返回一个可用于继续当前会话的新 `token`（客户端应立即替换本地令牌）。
- 错误：400 `请输入当前密码` / `当前密码错误`；409 `用户名已被使用`。

### 3.5 更新个性化设置

```
PUT /api/auth/settings  (需登录)
```

请求体 `{ "settings": "<JSON 字符串>" }`（必须是合法 JSON 字符串，如 `"{\"theme\":\"dark\"}"`）。响应 `{ "user": { ... } }`。

### 3.6 登出

```
POST /api/auth/logout   (需登录)
```

响应 `{ "message": "已登出" }`，并**使该账号已签发的所有令牌立即失效**（含其它设备与脚本）。

### 3.7 头像

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| POST | `/api/auth/avatar` | 需登录 | 上传自己的头像（`multipart/form-data`，文件字段名 `avatar`；服务端取第一个文件字段，并用 sharp 处理） |
| GET | `/api/auth/avatar` | 需登录 | 获取自己的头像 |
| GET | `/api/auth/avatar/:userId` | 公开 | 获取指定用户头像（可匿名访问，便于评论列表展示） |
| DELETE | `/api/auth/avatar` | 需登录 | 删除自己的头像 |

---

## 4. 令牌规范与生命周期

### 4.1 传递方式

| 方式 | 用法 | 场景 |
|---|---|---|
| 请求头（推荐） | `Authorization: Bearer <token>` | 全部 API |
| 查询参数 | `?token=<token>` | 仅用于浏览器**下载直链**（`<a href>` 无法设置请求头）、下载票据 |

### 4.2 令牌内容

令牌是 HS256 JWT，载荷含 `userId`、`role` 与毫秒级签发时间 `ts`，并带标准 `iat` / `exp`。

> 客户端**不应**自行解析或依赖载荷内容做权限判断：`role` 只是审计冗余，服务端放行依据始终是数据库中的实时角色与能力。

### 4.3 有效期

| 场景 | 有效期 |
|---|---|
| 默认登录 | 7 天 |
| `rememberDays: n` | n 天（1–90），用于设备/脚本长期登录 |
| 下载票据 | 5 分钟（见第 7 节） |

### 4.4 失效与生效

| 事件 | 影响 |
|---|---|
| `POST /api/auth/logout` | 该账号**所有**已签发令牌立即失效 |
| `PUT /api/auth/profile` 改密码 | 同上；接口返回新令牌供当前会话继续 |
| 账号被删除 | 令牌立即失效（401 `账号不存在或已注销，请重新登录`） |
| 角色变更（如 user → admin） | **无需重新登录**：下一次请求即按新能力放行 |
| `canAccessDrive` 开关变更 | 同上，下一次请求即生效 |
| 令牌过期或签名不匹配 | 401 `Token 无效` / `Token 已失效，请重新登录` |

### 4.5 客户端处理约定

| 状态码 | 建议动作 |
|---|---|
| 401 | 令牌不可用：清除本地令牌 → 重新登录（若配置了账号密码）→ 重试一次原请求 |
| 403 | 令牌有效但权限不足：**不要**清除令牌，提示用户或跳过该功能 |
| 429 | 退避重试（登录限流较严：20 次 / 15 分钟） |

---

## 5. 角色与能力矩阵

### 5.1 角色

| 角色 | 说明 |
|---|---|
| `admin` | 管理员，**自动拥有全部能力**（含网盘全量访问） |
| `user` | 普通用户，无管理能力；可访问全部非管理端点，网盘受个人开关约束 |

> 能力矩阵定义在 `server/src/lib/permissions.ts`，是新增角色的唯一扩展点；路由守卫使用 `requireCapability(...)`，不再有散落的 `role === 'admin'` 判断。

### 5.2 能力清单

| 能力 | 中文 | 覆盖范围 |
|---|---|---|
| `content:write` | 内容编辑 | 文章、页面的管理与写操作；AI 写作辅助 |
| `comment:moderate` | 评论管理 | 评论列表、编辑、删除 |
| `user:manage` | 用户管理 | 用户 CRUD、角色调整、网盘开关、设置头像 |
| `stats:view` | 站点统计 | Dashboard 汇总 |
| `device:view` | 设备监控 | 设备列表 |
| `ai:configure` | AI 配置 | AI 提供商 / 模型 / Key 配置读写 |
| `drive:all` | 网盘全量访问 | 豁免 `canAccessDrive` 开关；可操作他人文件 |

### 5.3 端点 → 能力对照

| 端点 | 需要 |
|---|---|
| `POST /api/posts`、`PUT/DELETE /api/posts/:id`、`GET /api/posts/admin/*` | `content:write` |
| `GET /api/pages`、`POST /api/pages`、`GET/PUT/DELETE /api/pages/:id` | `content:write` |
| `GET /api/comments/admin/*`、`PUT/DELETE /api/comments/:id` | `comment:moderate` |
| `POST /api/comments` | 登录即可 |
| `GET /api/users`、`GET/PUT/DELETE /api/users/:id`、`/api/users/:id/drive-access`、`/api/users/:id/avatar` | `user:manage` |
| `GET /api/devices` | `device:view` |
| `GET /api/stats` | `stats:view` |
| `POST /api/ai/write/*` | `content:write` |
| `GET/PUT /api/ai/config` | `ai:configure` |
| `/api/drive/**` | 网盘门禁（见 5.4） |
| `/api/health/screen-time*`、`/api/health/daily-goal`、`POST /api/health/push` | 登录即可（**只能读写本人数据**） |
| `/api/auth/me`、`/api/auth/profile`、`/api/auth/settings`、`/api/auth/logout`、`/api/auth/avatar` | 登录即可 |

### 5.4 网盘门禁两条规则

1. **模块准入**：`user.canAccessDrive === true` **或** 账号具备 `drive:all`（即 admin 自动通过）。不满足返回 403 `无网盘访问权限`。
2. **文件所有权**：普通用户只能读取/操作自己上传的文件；具备 `drive:all` 的账号可操作全部文件。越权返回 404/403。

---

## 6. 公开端点与可选认证

### 6.1 公开端点（无需任何凭证）

| 路径 | 说明 |
|---|---|
| `POST /api/auth/login` / `POST /api/auth/register` | 登录 / 注册 |
| `GET /api/auth/avatar/:userId` | 指定用户头像 |
| `GET /api/health` | 服务健康检查（DB 与存储节点状态） |
| `GET /api/version` | 部署版本信息 |
| `GET /api/posts`、`GET /api/posts/:slug` | 已发布文章列表 / 详情 |
| `GET /api/pages/featured`、`GET /api/pages/slug/:slug` | 已发布页面 |
| `GET /api/comments/post/:postId` | 文章评论树 |
| `GET /api/stats/public` | 公开统计（文章/用户/评论/页面数） |
| `POST /api/ai/chat`、`GET /api/ai/chat/public` | AI 对话与状态（可选认证） |

> ⚠️ 白名单只表示「全局中间件不强制登录」；个别端点内部仍会要求登录（例如 `POST /api/posts` 需要 `content:write`，匿名请求会得到 401）。

### 6.2 可选认证（`optionalAuthenticate`）

`POST /api/ai/chat` 公开可用；若携带有效令牌，服务端会注入该账号的额外上下文（站点统计、最近评论、已发布页面、近 14 天屏幕时间等）。令牌无效时按游客处理，**不返回 401**。

### 6.3 关于 `X-API-Key` 与 `X-Screen-Time-Token`

两个请求头已不再被识别：携带它们等同于未认证（受保护端点返回 401 `未登录`）。CORS 允许的头只剩 `Content-Type` 与 `Authorization`。

---

## 7. 下载票据

浏览器直链下载（`<a href>`）无法设置请求头，因此网盘提供一次性下载票据。

### 7.1 申请票据

```
POST /api/drive/download-ticket/:id      (需登录 + 网盘门禁)
```

- `:id` 必须是**文件**（文件夹返回 404），且当前账号有该文件的操作权。
- **响应 200**：`{ "ticket": "<JWT>", "expiresIn": 300 }`（有效期 5 分钟）

### 7.2 使用票据

```
GET /api/drive/download/:id?token=<ticket>
GET /api/drive/files/:id/download?token=<ticket>     # 兼容路径
```

票据与文件强绑定（内含 `downloadFileId` 与一次性 `downloadNonce`）：拿 A 文件的票据下载 B 文件会得到 403 `下载票据与文件不匹配`。

### 7.3 票据的作用域限制（重要）

票据**不是**通用账号令牌：

| 目标 | 结果 |
|---|---|
| 两个下载端点 | ✅ 正常（校验文件绑定与网盘权限） |
| 其它任意端点（`/api/auth/me`、`/api/users`、`/api/health/push`、再申请票据…） | ❌ 403 `下载票据仅可用于文件下载` |

> 设计原因：票据会出现在 URL、浏览器历史与访问日志中，因此把它限制在「下载这一个文件」的范围内，避免令牌泄漏面扩大。同时它带有毫秒级 `ts`，与登录令牌享有同样的失效精度。

---

## 8. 错误处理

### 8.1 通用响应体

| 形状 | 出现位置 |
|---|---|
| `{ "error": "..." }` | 绝大多数错误 |
| `{ "error": "输入数据无效", "details": { "fieldErrors": { ... } } }` | Zod 校验失败（注册、资料更新、设置更新等使用 `flatten()` 的端点；登录的 400 只有 `error`） |
| `{ "error": "...", "code": "P2025" }` | Prisma 已知错误（唯一约束、记录不存在等） |

### 8.2 状态码

| 状态码 | 含义 | 客户端动作 |
|---|---|---|
| 200 / 201 | 成功 | — |
| 400 | 参数或格式错误 | 修正请求，不要重试 |
| 401 | 未登录 / 令牌无效 / 令牌已失效 / 账号已删除 | 清除令牌并重新登录 |
| 403 | 已登录但权限不足；票据越界使用；网盘无权限 | 提示用户，**不要**清除令牌 |
| 404 | 资源不存在（含已移除的旧端点） | 检查路径 |
| 409 | 唯一约束冲突（用户名/邮箱已占用） | 提示用户换值 |
| 429 | 触发限流 | 退避重试 |
| 500 / 503 | 服务端异常 / 存储节点未连接 | 稍后重试 |

### 8.3 限流

| 范围 | 限制 | 触发响应 |
|---|---|---|
| 全局（每 IP） | 600 次 / 15 分钟 | 429 `请求过于频繁，请稍后再试` |
| 登录 / 注册（每 IP） | 20 次 / 15 分钟 | 429 `请求过于频繁，请 15 分钟后再试` |

> 设备/脚本请**缓存令牌**而不是每次调用都登录；仅在收到 401 时重新登录一次，并对 429 做指数退避。

---

## 9. 客户端接入示例

### 9.1 curl

```bash
BASE="http://localhost:3001"

TOKEN=$(curl -s -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin","password":"你的密码"}' | python -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 查看能力
curl -s "$BASE/api/auth/me" -H "Authorization: Bearer $TOKEN"

# 管理端点（需要对应能力）
curl -s "$BASE/api/users?page=1&limit=20" -H "Authorization: Bearer $TOKEN"

# 申请下载票据并直链下载
TICKET=$(curl -s -X POST "$BASE/api/drive/download-ticket/1" -H "Authorization: Bearer $TOKEN" | python -c "import sys,json;print(json.load(sys.stdin)['ticket'])")
curl -L -o file.bin "$BASE/api/drive/download/1?token=$TICKET"
```

### 9.2 PowerShell（Windows 服务器/脚本）

```powershell
$base = "http://127.0.0.1:3001/api"
$login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' `
  -Body '{"identifier":"admin","password":"你的密码"}'
$h = @{ Authorization = "Bearer $($login.token)" }

$login.user.role                     # admin
$login.user.capabilities.Count       # 7

(Invoke-RestMethod "$base/users" -Headers $h).total
```

### 9.3 JavaScript / TypeScript（含 401 自动重登）

```ts
const BASE = 'https://web.linetech.online'   // 生产公网入口（Cloudflare Tunnel，HTTPS）；临时排查可用 http://120.24.223.65:3001

type LoginResult = {
  token: string
  user: { id: number; username: string; role: string; capabilities: string[]; canAccessDrive: boolean }
}

class LineWebClient {
  private token: string | null = null

  constructor(private username: string, private password: string, private rememberDays = 30) {}

  private async login(): Promise<void> {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: this.username, password: this.password, rememberDays: this.rememberDays }),
    })
    if (res.status === 429) throw new Error('登录过于频繁，请稍后重试')
    if (!res.ok) throw new Error(`登录失败：${res.status}`)
    this.token = ((await res.json()) as LoginResult).token
  }

  async request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    if (!this.token) await this.login()
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${this.token}` },
    })

    if (res.status === 401 && retry) {       // 令牌失效 → 重登一次
      this.token = null
      return this.request<T>(path, init, false)
    }
    if (res.status === 403) throw new Error('当前账号权限不足')   // 不要清令牌
    if (!res.ok) throw new Error(`请求失败：${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }
}

// 用法
const client = new LineWebClient('admin', process.env.LINEWEB_PASSWORD!, 90)
const me = await client.request<{ capabilities: string[] }>('/api/auth/me')
```

### 9.4 Python（设备推送屏幕时间：登录取令牌 → 推送 → 401 重登）

```python
import os, time, requests

BASE = os.environ.get("LINEWEB_API_URL", "http://localhost:3001").rstrip("/")
USERNAME, PASSWORD = os.environ["LINEWEB_USERNAME"], os.environ["LINEWEB_PASSWORD"]
REMEMBER_DAYS = int(os.environ.get("LINEWEB_REMEMBER_DAYS", "90"))

_token: str | None = None

def login() -> str:
    resp = requests.post(f"{BASE}/api/auth/login", timeout=30, json={
        "identifier": USERNAME, "password": PASSWORD, "rememberDays": REMEMBER_DAYS,
    })
    if resp.status_code == 429:
        raise RuntimeError("登录限流（20 次/15 分钟），请稍后重试")
    resp.raise_for_status()
    return resp.json()["token"]

def token() -> str:
    global _token
    if not _token:
        _token = login()
    return _token

def push(total_seconds: int, date: str) -> None:
    global _token
    url = f"{BASE}/api/health/push"
    body = {"totalSeconds": total_seconds, "date": date}
    resp = requests.post(url, json=body, timeout=30, headers={"Authorization": f"Bearer {token()}"})
    if resp.status_code == 401:                 # 令牌过期/已失效 → 重登一次
        _token = login()
        resp = requests.post(url, json=body, timeout=30, headers={"Authorization": f"Bearer {_token}"})
    resp.raise_for_status()

if __name__ == "__main__":
    push(3600, time.strftime("%Y-%m-%d"))       # 只能写入登录账号自己的数据
    print("已同步")
```

> 仓库内现成脚本：`scripts/time-master-push.py`（同上逻辑，可直接用于计划任务）。

---

## 10. 从 API Key / 屏幕时间 Token 迁移

| 旧用法 | 新用法 |
|---|---|
| `X-API-Key: lw_...` | 账号登录取 `token`，改发 `Authorization: Bearer <token>` |
| `X-Screen-Time-Token: st_...` + `POST /api/health/push` | 设备用账号登录取令牌，再 `POST /api/health/push`（同一令牌） |
| `GET /api/health/screen-time/data` | `GET /api/health/screen-time`（登录态，返回本人数据） |
| `GET /api/health/daily-goal/data` | `GET /api/health/daily-goal` |
| `/api/health/tokens`（生成/列/删密钥） | 不再需要：登录时用 `rememberDays` 申请长期令牌 |
| `/api/api-keys`（增删查改） | 已移除（404） |

**迁移步骤**

1. 为每个调用方确定一个 LineWeb 账号（建议按用途拆分账号，便于单独撤销）。
2. 用该账号调用 `POST /api/auth/login`（设备传 `rememberDays: 90`）换取令牌。
3. 把请求头从 `X-API-Key` / `X-Screen-Time-Token` 改为 `Authorization: Bearer <token>`。
4. 实现 401 重登与 429 退避（见 9.3 / 9.4）。
5. 删除旧密钥的本地留存（旧密钥在服务端已随表删除，必然失效）。

> 若调用方需要管理权限，请让管理员把对应账号角色设为 `admin`（或未来新增的细粒度角色），而不是共享同一个管理员账号。

---

## 11. 安全建议

- 令牌等同于账号身份：不要写入日志、URL（下载票据除外）、前端源码或仓库。
- 优先使用 `Authorization` 请求头；`?token=` 仅用于无法设置请求头的下载直链。
- 设备令牌（`rememberDays`）请按最小权限账号申请，并设置合理天数；一旦怀疑泄漏，让该账号 `POST /api/auth/logout` 或在管理端改密码即可让所有旧令牌失效。
- 不要在客户端缓存 `capabilities` 当作长期权限判断：服务端每次请求都会重新解析（角色变更即时生效），客户端缓存只应用于渲染。
- 浏览器端令牌存于 `localStorage`（标准 SPA 模式，存在 XSS 风险）：请保持 CSP、避免引入不可信脚本；服务端 CSP 已由 helmet 设置。
- 生产已通过 Cloudflare Tunnel 提供 HTTPS（`https://web.linetech.online`）；IP 直连 `http://120.24.223.65:3001` 仍是明文信道，只作备用，建议把安全组收敛到可信来源 IP。

---

## 12. 接入自检清单

```powershell
$base = "http://127.0.0.1:3001/api"

# ① 登录返回能力清单
$login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType 'application/json' `
  -Body '{"identifier":"admin","password":"你的密码"}'
$login.user.capabilities.Count        # admin → 7

# ② 管理端点可访问
$h = @{ Authorization = "Bearer $($login.token)" }
(Invoke-RestMethod "$base/users" -Headers $h).total

# ③ 旧凭证必须失败（401）
try { Invoke-RestMethod "$base/users" -Headers @{ 'X-API-Key' = 'lw_test' } } catch { $_.Exception.Response.StatusCode.value__ }

# ④ 已移除端点必须 404
foreach ($p in '/api-keys', '/health/tokens', '/health/screen-time/data') {
  try { Invoke-RestMethod "$base$p" -Headers $h } catch { "$p → $($_.Exception.Response.StatusCode.value__)" }
}

# ⑤ 令牌失效：登出后旧令牌必须 401
Invoke-RestMethod "$base/auth/logout" -Method Post -Headers $h | Out-Null
try { Invoke-RestMethod "$base/auth/me" -Headers $h } catch { $_.Exception.Response.StatusCode.value__ }   # 401
```

接入方还应确认：

- [ ] 使用 `Authorization: Bearer`，未使用 `X-API-Key` / `X-Screen-Time-Token`
- [ ] 401 会重新登录并重试一次；403 不会误判为登录失效
- [ ] 429 有退避策略；设备脚本缓存令牌而非每次请求都登录
- [ ] 设备/脚本账号使用 `rememberDays` 而非共享管理员账号
- [ ] 下载使用「先申请票据、再用 `?token=` 直链」的流程，未把票据复用到其它 API
