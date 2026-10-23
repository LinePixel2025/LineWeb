# LineWeb 第三方应用授权接入文档（OAuth 2.0 授权码 + PKCE）

> 适用版本：2026-09 起（首次引入第三方应用授权）
> 相关文档：[`auth-api.md`](./auth-api.md)（账号登录令牌）、[`api.md`](./api.md)（全部端点详解）、[`health-api.md`](./health-api.md)（屏幕时间/数字健康）
> 服务端实现：`server/src/routes/oauth.ts`、`server/src/services/oauthService.ts`、`server/src/lib/appScopes.ts`、`server/src/middleware/auth.ts`
> 管理端页面：`/admin/apps`（管理员注册应用）；用户侧撤销入口：个人资料 → 已授权的应用

---

## 目录

1. [概述](#1-概述)
2. [快速开始](#2-快速开始)
3. [第一步：注册应用](#3-第一步注册应用)
4. [第二步：发起授权请求](#4-第二步发起授权请求)
5. [第三步：用授权码换取令牌](#5-第三步用授权码换取令牌)
6. [第四步：调用 API](#6-第四步调用-api)
7. [权限范围（scope）](#7-权限范围scope)
8. [刷新令牌与轮换](#8-刷新令牌与轮换)
9. [撤销授权](#9-撤销授权)
10. [端点参考](#10-端点参考)
11. [错误处理](#11-错误处理)
12. [客户端接入示例](#12-客户端接入示例)
13. [安全建议](#13-安全建议)
14. [接入自检清单](#14-接入自检清单)

---

## 1. 概述

第三方应用**不应保存用户的 LineWeb 密码**。正确做法是走 OAuth 2.0 授权码 + PKCE 流程：

```
① 应用跳转          ② 用户在 LineWeb 同意        ③ 回调带回授权码
/authorize          账户验证页                    redirect_uri?code=...&state=...
   │                    │                              │
   └────────────────────┴──────────────────────────────┘
                          │
④ 应用后端：POST /api/oauth/token（code + code_verifier）
   → access_token（1 小时）+ refresh_token（30 天）
                          │
⑤ 之后每个请求：Authorization: Bearer <access_token>
```

| 特性 | 说明 |
|---|---|
| 不接触密码 | 用户只在 LineWeb 的页面上输入账号密码，应用永远拿不到 |
| 授权码一次性 | 授权码 5 分钟有效且**只能使用一次**，重放会被拒绝 |
| 强制 PKCE | 必须使用 `S256`；不支持 `plain`，也不接受缺失 `code_challenge` 的请求 |
| 令牌有作用域 | 应用只能访问用户同意的 scope 对应的白名单端点 |
| 无任何管理能力 | 应用令牌**永远**无法访问用户管理、设备监控、站点统计、AI 配置等端点 |
| 可随时撤销 | 用户可在个人资料页一键撤销，令牌立即失效 |
| 可轮换 | 刷新令牌每次使用都会换新，重复使用旧刷新令牌会吊销整条授权 |

### 适用场景

- 桌面 / 移动客户端（Time Master 等设备类应用）
- 有服务端或纯前端的第三方 Web 应用
- 需要代用户读写其 LineWeb 数据（屏幕时间、网盘文件等）的集成

> **不适用**：只需要读取公开内容（文章、页面、公开统计）的场景，直接调用 `auth-api.md` 里列出的公开端点即可，无需授权流程。

---

## 2. 快速开始

假设管理员已经注册了应用，且你有 `client_id`（机密客户端还有 `client_secret`），回调地址为 `http://localhost:8080/callback`。

```bash
# 1) 生成 PKCE 参数（code_verifier 43–128 字符的随机串）
#    code_challenge = base64url(sha256(code_verifier))
node -e "const c=require('crypto');const v=c.randomBytes(32).toString('base64url');console.log('verifier='+v);console.log('challenge='+c.createHash('sha256').update(v).digest('base64url'))"

# 2) 让用户在浏览器打开（state 自行生成并保存，用于防 CSRF）
#    http://localhost:3001/authorize?client_id=<CLIENT_ID>&redirect_uri=<CALLBACK>
#      &scope=health%3Aread%20health%3Awrite&state=<STATE>
#      &code_challenge=<CHALLENGE>&code_challenge_method=S256

# 3) 用户同意后浏览器跳回：http://localhost:8080/callback?code=<CODE>&state=<STATE>
#    校验 state 一致后，用授权码换令牌
curl -X POST http://localhost:3001/api/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "authorization_code",
    "code": "<CODE>",
    "client_id": "<CLIENT_ID>",
    "client_secret": "<CLIENT_SECRET>",
    "redirect_uri": "http://localhost:8080/callback",
    "code_verifier": "<VERIFIER>"
  }'
# → { "access_token": "...", "token_type": "Bearer", "expires_in": 3600,
#     "scope": "health:read health:write", "refresh_token": "...", "refresh_expires_in": 2592000 }

# 4) 调用 API
curl http://localhost:3001/api/health/screen-time \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

> 本地开发时前端是 `http://localhost:5173`，生产/内网穿透后是实际域名。`/authorize` 是**前端路由**，`/api/oauth/token` 是**后端接口**，两者域名通常相同。

---

## 3. 第一步：注册应用

应用必须先由 LineWeb **管理员**在管理后台注册，否则 `/authorize` 会拒绝请求。

### 3.1 管理端操作

登录 LineWeb 管理员账号 → 管理面板 → **应用授权**（`/admin/apps`）→ 注册新应用。

| 字段 | 说明 |
|---|---|
| 应用名称 | 显示在授权页，用户据此判断是否信任（建议用真实产品名） |
| 应用简介 | 显示在授权页的一句话说明 |
| 应用主页 | 可选，显示在授权页作为链接 |
| 客户端类型 | **机密**（有服务端，能安全保存密钥）/ **公开**（桌面、移动、纯前端，无密钥） |
| 回调地址 | 一行一个，**必须与授权请求中的 `redirect_uri` 完全一致**（精确匹配，不支持通配符） |
| 允许申请的权限 | 该应用**最多**能申请哪些 scope；应用实际请求超出此范围会被拒绝 |

注册成功后返回 `client_id`（形如 `lw_...`）。**机密客户端还会返回一次 `client_secret`（形如 `lws_...`）——它只显示这一次**，请立即保存到安全的地方（环境变量 / 凭据管理）。遗失后只能由管理员重置，旧密钥会立即失效。

> **公开客户端没有密钥**：桌面 / 移动 / 纯前端应用无法安全保存密钥，因此注册为「公开客户端」，仅依赖 PKCE 保证安全。PKCE 对机密客户端同样必需。

### 3.2 客户端 ID 与密钥

| 类型 | `client_id` | `client_secret` | 保护机制 |
|---|---|---|---|
| 机密客户端 | 需要 | 需要（服务端保存） | PKCE + 密钥 |
| 公开客户端 | 需要 | 无 | 仅 PKCE（`S256`） |

---

## 4. 第二步：发起授权请求

在需要用户登录时，把浏览器**顶层跳转**到授权页（不要用 iframe，见 [13. 安全建议](#13-安全建议)）：

```
GET /authorize?client_id=<CLIENT_ID>
             &redirect_uri=<CALLBACK>
             &scope=<SCOPE_LIST>
             &state=<RANDOM_STATE>
             &code_challenge=<CHALLENGE>
             &code_challenge_method=S256
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `client_id` | ✅ | 注册时获得的客户端 ID |
| `redirect_uri` | ✅ | 必须与注册的回调地址**逐字符相同** |
| `scope` | ✅ | 空格或逗号分隔的权限列表，例如 `health:read health:write` |
| `state` | 建议 | 随机串，回调时会原样带回；用于防 CSRF，请校验一致 |
| `code_challenge` | ✅ | `base64url(sha256(code_verifier))` |
| `code_challenge_method` | ✅ | 只能是 `S256` |

### 4.1 生成 PKCE 参数

`code_verifier` 是 43–128 字符的高熵随机串（推荐 32 字节随机数的 base64url，共 43 字符）：

```js
// Node.js 18+
import crypto from 'node:crypto'

const codeVerifier = crypto.randomBytes(32).toString('base64url')
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
```

```
code_verifier : dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
code_challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
```

> `code_verifier` 必须保存在本地（内存或会话存储），在换令牌时才提交。**不要**把它放进授权 URL。

### 4.2 用户看到什么

浏览器打开 `/authorize` 后：

- 未登录 → 先跳到登录页，**登录后自动回到授权页且参数不丢失**。
- 已登录 → 显示「账户验证」页：应用名称、简介、主页，以及逐条列出的权限说明；高危权限（如"管理自己的文章"）会单独用醒目标记提示，并排在列表最后。
- 用户可以点「拒绝」或「同意授权」。

### 4.3 回调结果

用户点击后浏览器跳转到 `redirect_uri`：

**同意**
```
http://localhost:8080/callback?code=<AUTHORIZATION_CODE>&state=<STATE>
```

**拒绝**
```
http://localhost:8080/callback?error=access_denied&error_description=用户拒绝了授权&state=<STATE>
```

**应用必须做的事**：先校验 `state` 与发起时保存的值一致，再处理结果。若出现 `error` 参数，向用户说明"你取消了授权"，不要重试。

> **重要**：跳转地址由服务端拼装，应用只需跟随跳转。如果 `client_id` 未注册、`redirect_uri` 不匹配或 scope 超出允许范围，服务端会返回错误并**拒绝跳转**（授权页只显示错误提示）——这可以防止开放重定向。

---

## 5. 第三步：用授权码换取令牌

```
POST /api/oauth/token
```

支持 `application/json` 与 `application/x-www-form-urlencoded`（RFC 6749 要求后者）。

| 字段 | 必填 | 说明 |
|---|---|---|
| `grant_type` | ✅ | `authorization_code` |
| `code` | ✅ | 回调带回来的授权码 |
| `client_id` | ✅ | 客户端 ID |
| `client_secret` | 机密客户端必填 | 公开客户端不要传 |
| `redirect_uri` | ✅ | 必须与授权请求、注册值三方一致 |
| `code_verifier` | ✅ | 第 4.1 步生成的原始随机串 |

**响应 200**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "health:read health:write",
  "refresh_token": "3f9a...（64 位十六进制）",
  "refresh_expires_in": 2592000
}
```

| 字段 | 说明 |
|---|---|
| `access_token` | 访问令牌，放在 `Authorization: Bearer` 头里使用 |
| `expires_in` | 访问令牌剩余秒数（3600 = 1 小时） |
| `scope` | 实际授予的权限（空格分隔） |
| `refresh_token` | 刷新令牌，用于免登录续期；**每次刷新都会换新** |
| `refresh_expires_in` | 刷新令牌剩余秒数（2592000 = 30 天） |

**授权码是一次性的**：同一个 `code` 第二次调用会返回 `invalid_grant`。若网络异常导致请求结果不明，请重新走一遍授权流程，不要重复提交同一个码。

---

## 6. 第四步：调用 API

拿到 `access_token` 后，与账号登录令牌的用法完全相同：

```bash
curl http://localhost:3001/api/health/screen-time \
  -H "Authorization: Bearer <ACCESS_TOKEN>"
```

### 6.1 应用令牌能访问哪些端点

应用令牌是**作用域令牌**（内部 `role=app`），只能访问下表列出的端点，且必须持有对应 scope。**未列出的端点一律返回 403。**

| 方法 | 端点 | 需要 scope |
|---|---|---|
| GET | `/api/auth/me` | `profile:read` |
| GET | `/api/auth/avatar`、`/api/auth/avatar/:userId` | `profile:read` |
| GET | `/api/comments` | `content:read` |
| GET | `/api/posts/admin/all`、`/api/posts/admin/:id` | `content:write`（仅返回 / 操作该账号自己的文章） |
| GET | `/api/comments/admin/posts`、`/api/comments/admin/post/:postId` | `comment:moderate` |
| GET | `/api/health/screen-time`、`/api/health/screen-time/range` | `health:read` |
| GET | `/api/health/daily-goal` | `health:read` |
| GET | `/api/drive/files`、`/api/drive/files/:id`、`/api/drive/search`、`/api/drive/fts-search` | `drive:read` |
| GET | `/api/drive/files/:id/download`、`/api/drive/download/:id` | `drive:read` |
| POST | `/api/posts` | `content:write` |
| POST | `/api/ai/write/summary`、`/ai/write/polish`、`/ai/write/titles`、`/ai/write/draft` | `content:write` |
| POST | `/api/comments` | `comment:write` |
| POST | `/api/health/push` | `health:write` |
| POST | `/api/drive/folders`、`/api/drive/files`、`/api/drive/upload` | `drive:write` |
| PUT | `/api/posts/:id` | `content:write`（仅自己的文章） |
| PUT | `/api/comments/:id` | `comment:moderate` |
| PUT | `/api/health/daily-goal` | `health:write` |
| PUT | `/api/drive/files/:id` | `drive:write` |
| DELETE | `/api/posts/:id` | `content:write`（仅自己的文章） |
| DELETE | `/api/comments/:id` | `comment:moderate` |
| DELETE | `/api/drive/files/:id` | `drive:write` |

**永远无法访问**（无论申请什么 scope）：`/api/users/*`、`/api/devices`、`/api/stats`、`/api/ai/config`、`/api/pages/*`（页面管理 = `content:manage`，目前仅管理员）、`/api/chat/*`、`/api/drive/sync`、`/api/drive/resolve-path`、`/api/drive/download-ticket/*`、`/api/drive/favorites/*`、`/api/oauth/*`、`/api/auth/profile`、`/api/auth/settings`、`/api/auth/logout`、`POST|DELETE /api/auth/avatar`、`GET /api`。

> **2026-10 变更（breaking）**：`content:write` scope 的语义收窄为「管理自己的文章」。`/api/pages*` 端点已从应用白名单移除（页面管理改为管理员专属的 `content:manage` 能力，无法通过任何应用 scope 获得）。此前已授权、依赖应用管理页面的集成需要改由管理员账号直接操作，或等待后续新增页面 scope。

> 设计取舍：应用不能改用户账号、不能把用户登出、不能给自己提权，也不能访问其他用户的数据。

### 6.2 数据范围

- 网盘 scope 只覆盖**该用户自己上传的文件**；应用令牌不具备 `drive:all`，因此看不到、也操作不了他人的文件。
- 屏幕时间 scope 只覆盖**该用户本人**的数据。
- 公开内容（已发布文章、页面、评论）本身无需认证即可读取，`content:read` 主要方便应用在统一入口下调用。

### 6.3 权限变更即时生效

如果用户账号在授权后被**降权**（例如管理员被改为普通用户），应用对应的能力派生 scope（`content:write`、`comment:moderate`）会在**下一个请求**立即失效，无需等令牌过期。应用应把这种情况当作 403 处理并提示用户重新授权。`content:write` 降权后应用也会失去文章写权限；页面管理从来不在应用 scope 内。

---

## 7. 权限范围（scope）

| scope | 说明 | 申请门槛 |
|---|---|---|
| `profile:read` | 读取你的用户名、邮箱、角色与头像 | — |
| `content:read` | 读取已发布的文章、页面与评论 | — |
| `comment:write` | 以你的账号发表评论 | — |
| `health:read` | 读取你的屏幕使用时间与每日目标 | — |
| `health:write` | 上报屏幕使用时间、设置每日目标 | — |
| `drive:read` | 列出、搜索并下载你自己的网盘文件 | 账号需有网盘权限 |
| `drive:write` | 上传、新建文件夹、重命名、移动或删除你自己的网盘文件 | 账号需有网盘权限 |
| `content:write` | 创建、编辑、删除**自己的文章**，并可调用 AI 写作辅助（不再包含页面管理） | ⚠️ 账号本身须具备该能力（`author` / `admin`） |
| `comment:moderate` | 编辑或删除任意用户的评论 | ⚠️ 账号本身须具备该能力 |

**同时还有两层限制**：

1. **应用允许范围**：管理员注册时勾选的 `allowedScopes`。应用请求超出该集合会被拒绝（400 `以下权限未被允许：...`）。
2. **账号能力**：最后两项是"能力派生"权限，只有账号本身已具备对应能力时才可授权。普通账号（`user`）申请 `content:write` 会被拒绝（400 `当前账号不具备以下权限，无法授权：content:write`）；`author` / `admin` 可以授权。

> 授权页会把 `content:write`、`comment:moderate` 标记为**高危权限**并排在最后，提醒用户"该应用可以代表你创建、编辑或删除你的文章与评论"。

**不可申请**（不属于应用 scope）：`user:manage`、`device:view`、`ai:configure`、`stats:view`、`drive:all`、`app:manage`。

> 最小权限原则：只申请业务真正需要的 scope。申请得越少，用户越容易信任，审核也越容易通过。

---

## 8. 刷新令牌与轮换

访问令牌 1 小时后过期。过期后用 `refresh_token` 换新令牌，**无需用户再次授权**：

```
POST /api/oauth/token
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `grant_type` | ✅ | `refresh_token` |
| `refresh_token` | ✅ | 上次拿到的刷新令牌 |
| `client_id` | ✅ | 客户端 ID |
| `client_secret` | 机密客户端必填 | 公开客户端不要传 |

**响应 200**：与授权码换令牌相同的结构，其中 `refresh_token` 是**新的**。

### 轮换规则（重要）

```
刷新一次  → 发新 access_token + 新 refresh_token，旧 refresh_token 立即作废
再次使用旧 refresh_token → 400 invalid_grant，并吊销整条授权
```

**应用必须**：

1. 每次刷新后**用新令牌覆盖旧令牌**（持久化到磁盘/配置）；
2. 旧刷新令牌重放会被视为**凭据泄露**，服务端会吊销该应用的整条授权（所有令牌立即失效），用户需要重新授权。

> 请务必先落盘新令牌再丢弃旧令牌，避免并发刷新导致的"自伤"吊销。

---

## 9. 撤销授权

### 9.1 用户主动撤销

用户可在 **个人资料 → 已授权的应用** 中查看所有已授权应用及其权限，并点击「撤销授权」。撤销后该应用的所有令牌（访问令牌 + 刷新令牌）立即失效。

### 9.2 应用主动撤销令牌

应用登出时，应主动失效自己的刷新令牌：

```
POST /api/oauth/revoke
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `token` | ✅ | 要撤销的刷新令牌 |
| `client_id` | ✅ | 客户端 ID |
| `client_secret` | 机密客户端必填 | 公开客户端不要传 |

**响应 200**：`{ "message": "ok" }`（令牌不存在也返回 200，避免泄露令牌是否存在）

### 9.3 其它会使令牌立即失效的情况

| 触发 | 说明 |
|---|---|
| 用户登出 LineWeb | `tokenValidAfter` 前移，所有令牌（含应用令牌）失效 |
| 用户修改密码 | 同上 |
| 管理员**停用**应用 | 该应用所有令牌立即失效，且无法再发起授权 |
| 管理员**删除**应用 | 级联删除所有授权与令牌 |
| 管理员**重置应用密钥** | 旧密钥立即失效，应用需改用新密钥 |
| 账号被降权 | 能力派生 scope 在下一请求失效 |

> 因此应用必须把 **401** 处理为"需要重新授权"，把 **403** 处理为"权限不足（可能是用户降权或应用被停用）"，两者都不要无限重试。

---

## 10. 端点参考

### 10.1 应用侧（公开，无需登录令牌）

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| POST | `/api/oauth/token` | 公开 | 授权码换令牌 / 刷新令牌轮换 |
| POST | `/api/oauth/revoke` | 公开 | 撤销刷新令牌 |

### 10.2 授权页（需用户登录令牌）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/oauth/authorize-context` | 授权页读取应用信息与权限清单 |
| POST | `/api/oauth/authorize` | 提交同意/拒绝，返回跳转地址 |
| GET | `/api/oauth/grants` | 当前用户已授权的应用列表 |
| DELETE | `/api/oauth/grants/:id` | 撤销某应用的授权 |

> 这两个端点由 LineWeb 前端调用，第三方应用**不需要**直接调用它们（应用只负责把用户送到 `/authorize`）。

`GET /api/oauth/authorize-context` 的响应示例：

```json
{
  "client": { "name": "Time Master 桌面版", "description": "…", "homepage": "https://example.com" },
  "scopes": [
    { "scope": "health:read", "label": "读取你的屏幕时间数据", "description": "读取你的屏幕使用时间与每日目标", "highRisk": false },
    { "scope": "content:write", "label": "管理自己的文章", "description": "创建、编辑、删除自己的文章，并可调用 AI 写作辅助", "highRisk": true }
  ],
  "state": "xyz"
}
```

### 10.3 管理端（需 `app:manage` 能力）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/oauth/clients` | 应用列表（不含密钥） |
| POST | `/api/oauth/clients` | 注册应用（密钥仅返回一次） |
| PUT | `/api/oauth/clients/:id` | 更新 / 停用 / 启用应用 |
| POST | `/api/oauth/clients/:id/secret` | 重置密钥（仅返回一次） |
| DELETE | `/api/oauth/clients/:id` | 删除应用（级联撤销授权） |

---

## 11. 错误处理

### 11.1 令牌端点的错误格式（RFC 6749）

```json
{ "error": "invalid_grant", "error_description": "授权码已被使用" }
```

| `error` | HTTP | 含义 | 应用动作 |
|---|---|---|---|
| `invalid_request` | 400 | 缺少或重复参数（如缺 `code_verifier`） | 修正请求 |
| `invalid_client` | 401 | `client_id` / `client_secret` 不匹配 | 检查凭据配置 |
| `invalid_grant` | 400 | 授权码/刷新令牌无效、过期、已使用、PKCE 校验失败，或授权已被撤销 | 重新走授权流程 |
| `unsupported_grant_type` | 400 | `grant_type` 不支持 | 修正请求 |

### 11.2 调用 API 时的错误

与 `auth-api.md` 一致：

| 状态码 | 含义 | 应用动作 |
|---|---|---|
| 200 / 201 | 成功 | — |
| 400 | 参数错误 | 修正请求，不要重试 |
| 401 | 令牌无效 / 已过期 / 授权被撤销 / 应用被停用 / 用户登出或改密 | 清除本地令牌；可尝试刷新令牌，失败则引导重新授权 |
| 403 | **权限不足**：scope 未覆盖该端点，或账号能力被收回 | 提示用户，**不要**清除令牌，不要重试 |
| 404 | 资源不存在（例如操作他人的文件） | 检查 ID 与数据归属 |
| 429 | 触发限流 | 指数退避后重试 |
| 500 / 503 | 服务端异常 | 稍后重试 |

**403 的两种 `error` 文案**：

```json
{ "error": "该端点不允许第三方应用访问" }
{ "error": "应用未获得「drive:read」权限", "required": "drive:read" }
```

### 11.3 限流

| 范围 | 限制 | 触发响应 |
|---|---|---|
| 全局（每 IP） | 600 次 / 15 分钟 | 429 `请求过于频繁，请稍后再试` |
| `/api/oauth/token`、`/api/oauth/revoke`（每 IP） | 60 次 / 15 分钟 | 429 `请求过于频繁，请稍后再试` |

> 请缓存访问令牌并复用，仅在 401 时刷新一次；不要每个请求都去刷新令牌。

---

## 12. 客户端接入示例

### 12.1 浏览器端：跳转授权页

```js
const clientId = 'lw_xxxxxxxxxxxxxxxxxxxxxxxx'
const redirectUri = 'http://localhost:8080/callback'
const scopes = ['health:read', 'health:write']

// 1) 生成并保存 PKCE 参数与 state
const randomString = (bytes = 32) => {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const codeVerifier = randomString(32)
const state = randomString(16)
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

sessionStorage.setItem('pkce_verifier', codeVerifier)
sessionStorage.setItem('oauth_state', state)

// 2) 顶层跳转（不要用 iframe / fetch）
const params = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: scopes.join(' '),
  state,
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
})
window.location.href = `http://localhost:3001/authorize?${params}`
```

### 12.2 回调处理与换令牌（Node.js）

```js
import crypto from 'node:crypto'

const BASE = 'http://localhost:3001'
const CLIENT_ID = process.env.LINEWEB_CLIENT_ID
const CLIENT_SECRET = process.env.LINEWEB_CLIENT_SECRET   // 公开客户端不需要
const REDIRECT_URI = 'http://localhost:8080/callback'

// 回调：/callback?code=...&state=...
function handleCallback(req, res) {
  const { code, state, error } = req.query

  if (error) return res.status(400).send(`授权失败：${error}`)
  if (state !== sessionStore.state) return res.status(400).send('state 校验失败，疑似 CSRF')

  const tokens = await exchangeCode(code, sessionStore.codeVerifier)
  // …持久化 tokens…
  res.send('授权成功')
}

async function exchangeCode(code, codeVerifier) {
  const res = await fetch(`${BASE}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    }),
  })
  if (!res.ok) throw new Error(`换令牌失败：${JSON.stringify(await res.json())}`)
  return res.json()
}

/** 刷新令牌（轮换：必须用返回的新 refresh_token 覆盖旧的） */
async function refresh(refreshToken) {
  const res = await fetch(`${BASE}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  })
  if (!res.ok) throw new Error('刷新失败，需要重新授权')
  const tokens = await res.json()
  // 先落盘新的 refresh_token，再丢弃旧的
  await persistTokens(tokens)
  return tokens
}
```

### 12.3 Python（标准库）

```python
import base64, hashlib, json, os, secrets, urllib.parse, urllib.request

BASE = "http://localhost:3001"
CLIENT_ID = os.environ["LINEWEB_CLIENT_ID"]
CLIENT_SECRET = os.environ.get("LINEWEB_CLIENT_SECRET")  # 公开客户端可不设
REDIRECT_URI = "http://localhost:8080/callback"


def pkce_pair():
    """返回 (code_verifier, code_challenge)"""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


def authorize_url(scopes):
    verifier, challenge = pkce_pair()
    params = {
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "scope": " ".join(scopes),
        "state": secrets.token_urlsafe(16),
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    # 应用需自行保存 verifier 与 state
    return verifier, "http://localhost:3001/authorize?" + urllib.parse.urlencode(params)


def post_form(path, payload):
    data = urllib.parse.urlencode(payload).encode()
    req = urllib.request.Request(
        BASE + path, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def exchange_code(code, verifier):
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI,
        "code_verifier": verifier,
    }
    if CLIENT_SECRET:
        payload["client_secret"] = CLIENT_SECRET
    return post_form("/api/oauth/token", payload)


def api_get(path, access_token):
    req = urllib.request.Request(BASE + path, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


if __name__ == "__main__":
    # 第一步：打印授权链接给用户，并保存 verifier
    verifier, url = authorize_url(["health:read", "health:write"])
    print("请在浏览器打开：", url)
    code = input("把回调地址里的 code 粘贴进来：").strip()
    tokens = exchange_code(code, verifier)
    print("access_token 前 20 位：", tokens["access_token"][:20], "scope =", tokens["scope"])
    print("今日屏幕时间：", api_get("/api/health/screen-time", tokens["access_token"]))
```

### 12.4 按需推送屏幕时间（Time Master 之类的设备应用）

```js
async function pushScreenTime(accessToken, { totalSeconds, date }) {
  const res = await fetch(`${BASE}/api/health/push`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ totalSeconds, date }),
  })
  if (res.status === 401) throw new Error('令牌失效，请重新授权或刷新')
  if (res.status === 403) throw new Error('缺少 health:write 权限')
  if (!res.ok) throw new Error(`推送失败：${res.status}`)
  return res.json() // { message: '已同步' }
}
```

> 推送语义与 `health-api.md` 完全一致（同一日期重复推送为覆盖更新），区别仅在于凭证换成应用令牌。

---

## 13. 安全建议

- **不要在客户端保存 `client_secret`**：有服务端的应用放服务端环境变量；桌面/移动/前端应用注册为**公开客户端**并只依赖 PKCE。
- **必须校验 `state`**：每次授权生成新的随机 `state` 并在回调时比对，防止 CSRF 与授权码注入。
- **必须使用 PKCE `S256`**：不要复用 `code_verifier`；服务端拒绝 `plain` 与缺失 challenge 的请求。
- **`redirect_uri` 精确匹配**：注册值与请求值必须逐字符相同。不要把回调地址做成开放跳转（例如把 `?next=` 参数直接转发），否则授权码可能被劫持。
- **授权页必须顶层跳转**：LineWeb 设置了 `frame-ancestors 'none'`，**不支持被 iframe 嵌入**（这是刻意的防点击劫持设计）。请不要尝试用 iframe 或弹窗内嵌授权页。
- **令牌按凭据对待**：访问令牌与刷新令牌等同于用户在该 scope 下的访问权。使用系统密钥链 / 权限受限的文件保存，不要写入日志、崩溃报告或分析系统。
- **刷新令牌严格轮换**：每次刷新后立即用新值覆盖旧值；旧值一旦被重放，整条授权会被吊销。
- **只申请必要 scope**：权限越少越容易通过审核，也能降低凭据泄露时的影响面。
- **处理 401 / 403 的语义差异**：401 表示凭证失效（可尝试刷新，再引导重新授权）；403 表示权限不足或被停用（不要盲目重试，也不要清除用户数据）。
- **HTTPS**：生产环境请通过 HTTPS 访问（`https://web.linetech.online` 由 Cloudflare Tunnel 提供 HTTPS），避免令牌在传输中被截获；IP 直连 `http://<ECS 公网 IP>:3001` 是明文备用入口，仅用于排查。

---

## 14. 接入自检清单

```bash
# 用实际值替换变量
BASE=http://localhost:3001
CLIENT_ID=lw_xxxxxxxx
CLIENT_SECRET=lws_xxxxxxxx
VERIFIER=<第 4.1 步生成>
CHALLENGE=$(node -e "console.log(require('crypto').createHash('sha256').update('$VERIFIER').digest('base64url'))")
REDIRECT=http://localhost:8080/callback

# 1) 授权页上下文可读（需用户登录令牌；用账号登录令牌模拟）
curl -s "$BASE/api/oauth/authorize-context?client_id=$CLIENT_ID&redirect_uri=$(node -e "console.log(encodeURIComponent('$REDIRECT'))")&scope=profile:read" \
  -H "Authorization: Bearer <用户登录令牌>"

# 2) 回调地址未注册时会被拒绝（应返回 400，且不跳转）
curl -s -o /dev/null -w '%{http_code}\n' \
  "$BASE/api/oauth/authorize-context?client_id=$CLIENT_ID&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&scope=profile:read" \
  -H "Authorization: Bearer <用户登录令牌>"

# 3) 用授权码换令牌（code 来自浏览器回调）
curl -s -X POST "$BASE/api/oauth/token" -H 'Content-Type: application/json' -d "{
  \"grant_type\":\"authorization_code\",\"code\":\"<CODE>\",\"client_id\":\"$CLIENT_ID\",
  \"client_secret\":\"$CLIENT_SECRET\",\"redirect_uri\":\"$REDIRECT\",\"code_verifier\":\"$VERIFIER\"}"

# 4) 用访问令牌调用被允许的端点（应 200）
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/health/screen-time" -H "Authorization: Bearer <ACCESS_TOKEN>"

# 5) 用访问令牌调用管理端点（应 403）
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/api/users" -H "Authorization: Bearer <ACCESS_TOKEN>"
```

- [ ] 应用已在 `/admin/apps` 注册，回调地址逐字符准确
- [ ] 已区分机密 / 公开客户端；机密客户端的 `client_secret` 只存在服务端环境变量或密钥链中
- [ ] 授权请求使用 `code_challenge_method=S256`，且每次生成新的 `code_verifier`
- [ ] 每次授权生成随机 `state`，回调时校验一致
- [ ] 回调地址是**顶层跳转**，未使用 iframe / 弹窗内嵌
- [ ] 只申请业务必需的 scope；未申请任何管理类权限
- [ ] 访问令牌过期后使用 `refresh_token` 续期，并**用新刷新令牌覆盖旧的**
- [ ] 401 处理为刷新 / 重新授权；403 处理为权限不足提示（不重试、不清除数据）
- [ ] 应用登出时调用 `POST /api/oauth/revoke` 失效刷新令牌
- [ ] 令牌未写入日志或崩溃报告；持久化位置有访问限制
- [ ] 已验证第 6.1 节表格中"永远无法访问"的端点确实返回 403
