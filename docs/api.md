# LineWeb API 接入教程

## 目录

- [1. 概述](#1-概述)
- [2. 快速开始](#2-快速开始)
- [3. 认证](#3-认证)
- [4. 公共 API](#4-公共-api)
- [5. 文章](#5-文章)
- [6. 评论](#6-评论)
- [7. 页面](#7-页面)
- [8. Bing 壁纸](#8-bing-壁纸)
- [9. 网盘（Drive）](#9-网盘drive)
- [10. 管理 API](#10-管理-api)
  - [10.4 API 密钥管理](#104-api-密钥管理)
- [11. 通用模式](#11-通用模式)
  - [11.4 API Key 认证](#114-api-key-认证)
- [12. 错误处理](#12-错误处理)
- [13. CORS 配置](#13-cors-配置)
- [14. 代码示例](#14-代码示例)

---

## 1. 概述

LineWeb API 提供个人网站/CMS 的全部功能，包括 **认证、文章、评论、页面管理、Bing 每日壁纸、网盘文件存储** 以及 **管理面板** 接口。

| 属性 | 值 |
|---|---|
| 基础 URL | `http://localhost:3001/api`（开发）/ 部署域名（生产） |
| 数据格式 | JSON（请求 `Content-Type: application/json`，响应 `application/json`） |
| 认证方式 | JWT Bearer Token 或 API Key（`X-API-Key` 请求头） |
| 分页 | 统一 `page` + `limit` 参数，响应含 `total` / `page` / `pageCount` |

> **安全策略**：除 `POST /api/auth/login`（登录）、`POST /api/auth/register`（注册）和 `GET /api/health`（健康检查）外，**所有 API 端点均需身份认证**。每次请求必须携带有效的 JWT Token 或 API Key，否则返回 `401`。

**API 自描述端点**：访问 `GET /api`（需携带认证凭证）可获取所有可用路由的完整清单。

---

## 2. 快速开始

### 2.1 使用 curl 测试 API

```bash
# 1. 健康检查
curl http://localhost:3001/api/health

# 2. 登录获取 Token
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lineweb.dev","password":"admin123"}'

# 3. 使用 Token 获取个人信息（替换 YOUR_TOKEN）
curl http://localhost:3001/api/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. 获取文章列表（需认证）
curl http://localhost:3001/api/posts?page=1&limit=10 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 2.2 使用 JavaScript/TypeScript（浏览器环境）

```typescript
// 项目已经封装好 api.ts，这里展示底层 fetch 用法
const API_BASE = 'http://localhost:3001/api'

async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!res.ok) throw new Error(await res.json().then(r => r.error))
  return res.json()  // { token, user }
}

async function fetchWithAuth(path: string, token: string) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.json().then(r => r.error))
  return res.json()
}

// 使用示例
const { token } = await login('admin@lineweb.dev', 'admin123')
const me = await fetchWithAuth('/auth/me', token)
console.log(me)
```

### 2.3 使用 Python

```python
import requests

API_BASE = 'http://localhost:3001/api'

# 登录
resp = requests.post(f'{API_BASE}/auth/login', json={
    'email': 'admin@lineweb.dev',
    'password': 'admin123'
})
data = resp.json()
token = data['token']

# 带 Token 请求
headers = {'Authorization': f'Bearer {token}'}
resp = requests.get(f'{API_BASE}/auth/me', headers=headers)
print(resp.json())
```

---

## 3. 认证

### 3.1 注册

创建新用户账户。

```
POST /api/auth/register
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| username | string | 是 | 2-50 字符 |
| email | string | 是 | 合法邮箱，最长 100 字符 |
| password | string | 是 | 6-100 字符 |

**成功响应（201）：**

```json
{
  "id": 3,
  "username": "newuser",
  "email": "user@example.com",
  "role": "user",
  "createdAt": "2026-07-04T10:00:00.000Z"
}
```

**失败响应（409）：**

```json
{ "error": "邮箱已被注册" }
```

### 3.2 登录

```
POST /api/auth/login
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 |
|---|---|---|
| email | string | 是 |
| password | string | 是 |

**成功响应（200）：**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "admin@lineweb.dev",
    "role": "admin",
    "canAccessDrive": true,
    "settings": null
  }
}
```

> **注意**：Token 有效期 **7 天**。过期后需重新登录。所有受保护的 API 需要在 HTTP 头中携带：
> ```
> Authorization: Bearer <token>
> ```
> 或
> ```
> X-API-Key: <api_key>
> ```

### 3.3 获取当前用户

```
GET /api/auth/me
Authorization: Bearer <token>
```

**响应：**

```json
{
  "id": 1,
  "username": "admin",
  "email": "admin@lineweb.dev",
  "role": "admin",
  "canAccessDrive": true,
  "settings": "{\"background\":{\"type\":\"wallpaper\",\"wallpaperMode\":\"latest\"}}",
  "createdAt": "2026-06-01T00:00:00.000Z"
}
```

### 3.4 更新用户设置

```
PUT /api/auth/settings
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| settings | string | 是 | JSON 字符串，存储用户个性化设置 |

settings 支持的格式（示例）：

```json
{
  "settings": "{\"background\":{\"type\":\"wallpaper\",\"wallpaperMode\":\"latest\"}}"
}
```

背景类型选项：
- `type: "wallpaper"` — Bing 每日壁纸
  - `wallpaperMode`: `"latest"`（每日更新）| `"random"`（随机历史）| `"date"`（指定日期）
  - `wallpaperDate`: 当 mode 为 `date` 时指定，格式 `YYYY-MM-DD`
- `type: "solid"` — 纯色背景
  - `solidColor`: 十六进制颜色值，如 `"#0d0d0f"`

---

## 4. 公用 API

### 4.1 健康检查（无需认证）

```
GET /api/health
```

**响应：**

```json
{
  "status": "ok",
  "timestamp": "2026-07-04T10:00:00.000Z"
}
```

### 4.2 API 端点列表（需认证）

```
GET /api
Authorization: Bearer <token> 或 X-API-Key: <key>
```

返回完整 API 路由清单，包含每个端点的 `method`、`path`、`auth` 级别和 `description`。

---

## 5. 文章

文章（Post）模块提供博客内容管理，包含需认证的读取接口和管理接口。

### 5.1 获取文章列表（分页）

```
GET /api/posts?page=1&limit=10
Authorization: Bearer <token> 或 X-API-Key: <key>
```

**查询参数：**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| page | number | 1 | 页码 |
| limit | number | 10 | 每页条数 |

**响应：**

```json
{
  "posts": [
    {
      "id": 1,
      "title": "Hello World",
      "slug": "hello-world",
      "summary": "第一篇文章",
      "published": true,
      "createdAt": "2026-07-01T00:00:00.000Z",
      "author": { "id": 1, "username": "admin" }
    }
  ],
  "total": 1,
  "page": 1,
  "pageCount": 1
}
```

### 5.2 按 slug 获取文章

```
GET /api/posts/:slug
Authorization: Bearer <token> 或 X-API-Key: <key>
```

**路径参数：**

| 参数 | 说明 |
|---|---|
| slug | 文章的唯一标识符（URL 友好名称） |

**响应：**

```json
{
  "id": 1,
  "title": "Hello World",
  "content": "<h1>Hello World</h1><p>这是文章内容 HTML</p>",
  "slug": "hello-world",
  "summary": "第一篇文章",
  "published": true,
  "createdAt": "2026-07-01T00:00:00.000Z",
  "author": { "id": 1, "username": "admin" }
}
```

> 注意：只能获取已发布文章（`published: true`）。

### 5.3 创建文章（管理员）

```
POST /api/posts
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| title | string | 是 | — | 标题，1-200 字符 |
| content | string | 是 | — | HTML 内容 |
| slug | string | 是 | — | URL 标识符，全局唯一 |
| summary | string | 否 | — | 摘要，最长 500 字符 |
| published | boolean | 否 | false | 是否发布 |

**成功响应（201）：**

```json
{
  "id": 2,
  "title": "新文章",
  "slug": "new-post",
  "summary": "摘要",
  "published": false,
  "createdAt": "2026-07-04T10:00:00.000Z"
}
```

### 5.4 更新文章（管理员）

```
PUT /api/posts/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```

请求体所有字段可选（partial update）：

```json
{
  "title": "更新的标题",
  "published": true
}
```

**响应：** 返回更新后的文章对象。

### 5.5 删除文章（管理员）

```
DELETE /api/posts/:id
Authorization: Bearer <admin_token>
```

**响应：**

```json
{ "message": "已删除" }
```

### 5.6 管理：获取所有文章（含未发布）

```
GET /api/posts/admin/all?page=1&limit=20
Authorization: Bearer <admin_token>
```

与公开列表相同结构，但包含未发布的草稿。

### 5.7 管理：按 ID 获取文章

```
GET /api/posts/admin/:id
Authorization: Bearer <admin_token>
```

返回完整文章对象（含未发布状态的）。

---

## 6. 评论

### 6.1 获取文章评论（树状结构）

```
GET /api/comments/post/:postId
Authorization: Bearer <token> 或 X-API-Key: <key>
```

**路径参数：**

| 参数 | 说明 |
|---|---|
| postId | 文章 ID |

**响应：**

```json
[
  {
    "id": 1,
    "content": "好文章！",
    "createdAt": "2026-07-02T00:00:00.000Z",
    "author": { "id": 2, "username": "user1" },
    "replies": [
      {
        "id": 2,
        "content": "谢谢！",
        "createdAt": "2026-07-02T01:00:00.000Z",
        "author": { "id": 1, "username": "admin" },
        "replies": []
      }
    ]
  }
]
```

> 仅支持一级嵌套（`comment → replies`），replies 不能再有子回复。

### 6.2 获取评论列表（扁平分页）

```
GET /api/comments?postId=1&page=1&limit=20
```

返回扁平化的分页评论列表（不含 replies 嵌套）。

### 6.3 发表评论

```
POST /api/comments
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| content | string | 是 | 评论内容，1-2000 字符 |
| postId | number | 是 | 文章 ID |
| parentId | number | 否 | 父评论 ID（回复时使用） |

**成功响应（201）：**

```json
{
  "id": 3,
  "content": "写得很棒！",
  "postId": 1,
  "parentId": null,
  "authorId": 2,
  "createdAt": "2026-07-04T10:00:00.000Z"
}
```

### 6.4 管理评论接口（需要管理员权限）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/comments/admin/posts` | 获取有评论的文章列表（含评论数） |
| GET | `/api/comments/admin/post/:postId` | 获取指定文章的全部评论（含总数） |
| PUT | `/api/comments/:id` | 编辑评论内容 |
| DELETE | `/api/comments/:id` | 删除评论 |

---

## 7. 页面

Page 模块提供动态页面管理（基于 Schema 的控件树）。

### 7.1 获取 Featured 页面列表

```
GET /api/pages/featured
Authorization: Bearer <token> 或 X-API-Key: <key>
```

返回所有标记为 featured 的已发布页面：

```json
[
  {
    "id": 1,
    "title": "计算器",
    "slug": "calculator",
    "featureEmoji": "🧮",
    "featureDesc": "一个优雅的计算器应用"
  }
]
```

### 7.2 按 slug 获取页面

```
GET /api/pages/slug/:slug
Authorization: Bearer <token> 或 X-API-Key: <key>
```

返回已发布页面的完整内容（含 schema）：

```json
{
  "id": 1,
  "title": "计算器",
  "slug": "calculator",
  "schema": "{\"type\":\"container\",\"children\":[...]}"
}
```

### 7.3 管理页面接口（需要管理员权限）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/pages?page=&limit=` | 页面列表（分页，含 published/featured/emoji 等） |
| POST | `/api/pages` | 创建页面 |
| GET | `/api/pages/:id` | 获取页面完整内容（含 schema） |
| PUT | `/api/pages/:id` | 更新页面 |
| DELETE | `/api/pages/:id` | 删除页面 |

**创建/更新页面请求体：**

| 字段 | 类型 | 必填 | 默认 | 说明 |
|---|---|---|---|---|
| title | string | 是 | — | 标题，1-200 字符 |
| slug | string | 是 | — | URL 标识符，全局唯一 |
| schema | string | 是 | — | JSON 字符串，控件树结构 |
| published | boolean | 否 | false | 是否发布 |
| featured | boolean | 否 | false | 是否在功能界面展示 |
| featureEmoji | string | 否 | — | 功能界面显示的 emoji，最长 10 字符 |
| featureDesc | string | 否 | — | 功能简介，最长 200 字符 |

---

## 8. Bing 壁纸

### 8.1 获取壁纸

```
GET /api/bing-wallpaper?mode=latest&date=2026-07-01&history=true
Authorization: Bearer <token> 或 X-API-Key: <key>
```

**查询参数（全部可选）：**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| mode | string | `latest` | `latest`（今日壁纸）\| `random`（随机历史）\| `date`（指定日期） |
| date | string | — | 指定日期，格式 `YYYY-MM-DD`，mode=date 时必填 |
| history | boolean | — | 设为 `true` 时返回壁纸历史列表 |

**获取今日壁纸：**

```json
{
  "url": "https://www.bing.com/th?id=OHR.xxx_ZH-CNxxx_1920x1080.jpg",
  "copyright": "© 版权信息",
  "title": "壁纸标题",
  "date": "2026-07-04"
}
```

**获取历史列表（`?history=true`）：**

```json
{
  "items": [
    {
      "date": "2026-07-04",
      "title": "壁纸标题",
      "copyright": "© 版权信息",
      "image_url_4k": "https://www.bing.com/th?id=OHR.xxx_ZH-CNxxx_UHD.jpg",
      "image_url_1080": "https://www.bing.com/th?id=OHR.xxx_ZH-CNxxx_1920x1080.jpg",
      "image_url": "https://www.bing.com/th?id=OHR.xxx_ZH-CNxxx_1920x1080.jpg"
    }
  ]
}
```

### 8.2 壁纸图片代理

```
GET /api/bing-wallpaper/proxy?url=https://www.bing.com/th?id=OHR.xxx.jpg
```

代理 Bing CDN 图片流，解决 Canvas CORS 限制问题。响应为图片二进制流，缓存 1 天。

---

## 9. 网盘（Drive）

Drive 模块提供文件存储和管理功能。所有端点需要 **登录 + `canAccessDrive` 权限**。

### 9.1 获取文件列表（分页）

```
GET /api/drive/files?parentId=null&page=1&limit=20
Authorization: Bearer <token>
```

**查询参数：**

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| parentId | number | `null`（根目录） | 父文件夹 ID |
| page | number | 1 | 页码 |
| limit | number | 20 | 每页条数 |

**响应：**

```json
{
  "data": [
    {
      "id": 1,
      "name": "文档",
      "isFolder": true,
      "parentId": null,
      "size": 0,
      "mimeType": null,
      "createdAt": "2026-07-01T00:00:00.000Z"
    },
    {
      "id": 2,
      "name": "photo.jpg",
      "isFolder": false,
      "parentId": null,
      "size": 1048576,
      "mimeType": "image/jpeg",
      "createdAt": "2026-07-02T00:00:00.000Z",
      "uploadedBy": { "id": 1, "username": "admin" }
    }
  ],
  "total": 2,
  "page": 1,
  "pageCount": 1
}
```

> **排序规则**：文件夹在前，文件在后；同类型按名称字母升序。

### 9.2 获取文件/文件夹详情

```
GET /api/drive/files/:id
Authorization: Bearer <token>
```

### 9.3 搜索文件

```
GET /api/drive/search?q=关键词
Authorization: Bearer <token>
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| q | string | 是 | 文件名搜索关键词（模糊匹配，最多 50 条） |

### 9.4 创建文件夹

```
POST /api/drive/folders
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| name | string | 是 | 文件夹名称。禁止字符：`<>:"/\\|?*` |
| parentId | number | 否 | 父文件夹 ID，不传则创建在根目录 |

**成功响应（201）：**

```json
{
  "id": 3,
  "name": "新文件夹",
  "isFolder": true,
  "parentId": null,
  "storagePath": "新文件夹",
  "createdAt": "2026-07-04T10:00:00.000Z"
}
```

### 9.5 上传文件

```
POST /api/drive/upload?parentId=1
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

使用 **multipart/form-data** 格式上传。支持通过查询参数 `parentId` 或表单字段 `parentId` 指定目标文件夹。

**功能特性：**
- 流式上传：边收边转发到存储节点，内存峰值 ~64KB
- 同级同名文件自动添加计数器后缀去重（如 `file(1).jpg`）
- 存储节点写入失败时自动回滚 DB 记录

**成功响应（201）：**

```json
{
  "id": 4,
  "name": "document.pdf",
  "size": 2097152,
  "mimeType": "application/pdf",
  "createdAt": "2026-07-04T10:00:00.000Z"
}
```

### 9.6 下载文件

```
GET /api/drive/download/:id
Authorization: Bearer <token>
```

返回文件二进制流。响应头包含：

| 头 | 说明 |
|---|---|
| Content-Type | 文件的 MIME 类型 |
| Content-Disposition | `attachment; filename*=UTF-8''文件名` |
| Content-Length | 文件大小（字节） |
| X-Content-Length | 前端兼容：文件总大小 |
| X-Chunk-Size | 下载块大小（默认 256KB） |

> 流式下载：逐块从存储节点拉取并写入响应，内存峰值 ~256KB。

兼容路径：`GET /api/drive/files/:id/download`

### 9.7 重命名/移动文件

```
PUT /api/drive/files/:id
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体（至少提供一项）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 新文件名。重命名文件夹时会递归更新子文件的 storagePath |
| parentId | number 或 null | 目标父文件夹 ID。`null` 表示移动到根目录。不能移动到自身或子文件夹内 |

### 9.8 删除文件/文件夹

```
DELETE /api/drive/files/:id
Authorization: Bearer <token>
```

**递归删除**：删除文件夹时，其所有子文件和子文件夹也会被删除。

### 9.9 手动触发文件同步

```
POST /api/drive/sync
Authorization: Bearer <token>
```

对比存储节点文件系统与数据库记录：清理孤立文件 + 创建缺失记录。

---

## 10. 管理 API

### 10.1 用户管理（需要管理员权限）

#### 用户列表

```
GET /api/users?page=1&limit=20
Authorization: Bearer <admin_token>
```

**响应：**

```json
{
  "users": [
    {
      "id": 1,
      "username": "admin",
      "email": "admin@lineweb.dev",
      "role": "admin",
      "canAccessDrive": true,
      "createdAt": "2026-06-01T00:00:00.000Z"
    }
  ],
  "total": 2,
  "page": 1,
  "pageCount": 1
}
```

#### 用户详情

```
GET /api/users/:id
Authorization: Bearer <admin_token>
```

#### 更新用户

```
PUT /api/users/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```

| 字段 | 类型 | 说明 |
|---|---|---|
| role | string | `"user"` 或 `"admin"`（不能修改自己的角色） |
| password | string | 新密码，6-100 字符 |

#### 切换网盘权限

```
PUT /api/users/:id/drive-access
Authorization: Bearer <admin_token>
Content-Type: application/json
```

请求体：`{ "canAccessDrive": true }`

#### 删除用户

```
DELETE /api/users/:id
Authorization: Bearer <admin_token>
```

**注意**：不能删除自己。删除用户会同时删除其评论和文章（事务操作）。

### 10.2 设备监控（需要管理员权限）

```
GET /api/devices
Authorization: Bearer <admin_token>
```

返回所有 API 请求来源的设备信息：

```json
{
  "online": [
    {
      "id": 1,
      "ip": "::1",
      "userAgent": "Mozilla/5.0...",
      "os": "Windows 10",
      "browser": "Chrome 120",
      "deviceType": "desktop",
      "firstSeen": "2026-07-04T09:00:00.000Z",
      "lastSeen": "2026-07-04T10:00:00.000Z",
      "requestCount": 42,
      "pathsAccessed": ["/api/auth/login", "/api/posts"]
    }
  ],
  "onlineCount": 1,
  "totalCount": 10,
  "allTime": [ ... ]
}
```

> 设备追踪在内存中维护，30 分钟无活动自动标记为离线。

### 10.3 Dashboard 统计汇总（需要管理员权限）

```
GET /api/stats
Authorization: Bearer <admin_token>
```

**响应：**

```json
{
  "posts": { "total": 15, "published": 10, "draft": 5 },
  "users": { "total": 8, "admins": 2 },
  "comments": { "total": 42 },
  "pages": { "total": 3, "published": 3, "featured": 2 },
  "drive": {
    "files": 120,
    "folders": 15,
    "totalSizeBytes": "5368709120"
  }
}
```

---

### 10.4 API 密钥管理（需要管理员权限）

API Key 管理端点，用于创建和管理外部程序访问 API 的密钥。

#### 创建 API Key

```
POST /api/api-keys
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| name | string | 是 | 密钥名称（1-100 字符） |
| expiresAt | string | 否 | 过期时间，ISO 日期格式（如 `2027-01-01`） |

**成功响应（201）：**

```json
{
  "id": 1,
  "name": "我的博客客户端",
  "key": "lw_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6",
  "prefix": "lw_a1b2...",
  "active": true,
  "expiresAt": null,
  "createdAt": "2026-07-04T10:00:00.000Z",
  "user": { "id": 1, "username": "admin" }
}
```

> **重要**：`key` 字段仅在创建时返回一次，之后无法再次获取完整密钥。请立即复制并妥善保存。

#### 列出所有 API Key

```
GET /api/api-keys
Authorization: Bearer <admin_token>
```

返回列表**不含完整密钥**，只含前缀用于识别：

```json
[
  {
    "id": 1,
    "name": "我的博客客户端",
    "prefix": "lw_a1b2...",
    "active": true,
    "lastUsedAt": "2026-07-04T12:00:00.000Z",
    "expiresAt": null,
    "createdAt": "2026-07-04T10:00:00.000Z",
    "user": { "id": 1, "username": "admin" }
  }
]
```

#### 获取单个 API Key 详情

```
GET /api/api-keys/:id
Authorization: Bearer <admin_token>
```

#### 更新 API Key

```
PUT /api/api-keys/:id
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**请求体（全部可选）：**

| 字段 | 类型 | 说明 |
|---|---|---|
| name | string | 新名称 |
| active | boolean | 启用（`true`）或禁用（`false`） |
| expiresAt | string 或 null | 过期时间，设为 `null` 取消过期 |

#### 删除 API Key

```
DELETE /api/api-keys/:id
Authorization: Bearer <admin_token>
```

---

## 11. 通用模式

### 11.1 分页

所有列表接口统一使用以下查询参数：

| 参数 | 类型 | 默认 | 说明 |
|---|---|---|---|
| page | number | 1 | 页码（从 1 开始） |
| limit | number | 10-20（各接口不同） | 每页条数 |

响应中统一包含分页元信息：

```json
{
  "data": [...],
  "total": 100,
  "page": 1,
  "pageCount": 10
}
```

### 11.2 认证级别

| 值 | 说明 | 如何访问 |
|---|---|---|
| `public` | 无需认证 | 直接请求（仅限 `login`、`register`、`health`） |
| `auth: true` | 需登录 | 请求头加 `Authorization: Bearer <token>` 或 `X-API-Key: <key>` |
| `auth: admin` | 需管理员权限 | 同上，且用户 role 必须为 `admin` |
| `auth: drive` | 需登录 + 网盘权限 | 同上，且用户 `canAccessDrive` 必须为 `true` |

### 11.3 请求头

所有 API 请求建议携带：

| 头 | 值 | 适用场景 |
|---|---|---|
| `Content-Type` | `application/json` | POST/PUT 请求（上传文件用 `multipart/form-data`） |
| `Authorization` | `Bearer <token>` | JWT 认证 |
| `X-API-Key` | `<api_key>` | API Key 认证（外部程序调用时使用） |

### 11.4 API Key 认证

API Key 认证是为外部程序/第三方应用设计的认证方式，与 JWT 双轨并行。

**使用方式：**
```
X-API-Key: lw_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6
```

**认证流程：**
1. 请求先检查 `Authorization: Bearer <jwt>` — 有则走 JWT 验证
2. 无 JWT 时检查 `X-API-Key` 请求头 — 有则查数据库验证
3. 两者都没有 → 401 未授权

**创建 API Key：**
- 通过管理面板 `/admin/api` 创建
- 或调用 API：`POST /api/api-keys`（需管理员权限）

**特性：**
- API Key 继承创建者的角色权限（管理员创建的 key 拥有管理员权限）
- 可在管理面板启用/禁用，无需重新生成
- 可设置过期时间，过期后自动失效
- 最后使用时间自动记录，方便审计

**最佳实践：**
- 为每个客户端创建独立的 API Key，方便管理
- 定期轮换密钥，设置合理的过期时间
- 不再使用的密钥及时吊销（禁用或删除）

---

## 12. 错误处理

所有错误响应统一格式：

```json
{ "error": "错误描述信息" }
```

### 常见 HTTP 状态码

| 状态码 | 含义 | 常见场景 |
|---|---|---|
| 200 | 成功 | GET/PUT/DELETE 请求成功 |
| 201 | 创建成功 | POST 创建资源 |
| 400 | 请求参数错误 | Zod 校验失败，无效 ID，非法字符等 |
| 401 | 未登录 | 缺少或无效的 Token |
| 403 | 权限不足 | 需要管理员/网盘权限 |
| 404 | 资源不存在 | 文章/文件/用户不存在 |
| 409 | 冲突 | 邮箱/用户名/slug 已存在 |
| 500 | 服务器内部错误 | 未知异常 |

---

## 13. CORS 配置

### 13.1 环境变量配置

通过 `CORS_ORIGIN` 环境变量控制跨域访问：

```bash
# 单一源（默认）
CORS_ORIGIN="http://localhost:5173"

# 多个源（逗号分隔）
CORS_ORIGIN="http://localhost:5173,https://myapp.com"

# 允许所有源（生产环境慎用）
CORS_ORIGIN="*"
```

### 13.2 外部应用接入

如果要从外部应用（HarmonyOS、iOS、第三方网站等）调用 API：

1. **部署后端**：将 LineWeb 后端部署到可公开访问的服务器
2. **配置 CORS**：设置 `CORS_ORIGIN` 环境变量为你的应用域名
3. **获取 Token**：调用 `/api/auth/login` 获取 JWT
4. **调用 API**：在请求头中携带 `Authorization: Bearer <token>`

---

## 14. 代码示例

### 14.1 完整的工作流：文章发布

```javascript
// Node.js / 浏览器环境
async function publishArticle() {
  const API = 'http://localhost:3001/api'

  // 1. 登录
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@lineweb.dev', password: 'admin123' }),
  })
  const { token } = await loginRes.json()

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }

  // 2. 创建文章
  const postRes = await fetch(`${API}/posts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      title: '我的新文章',
      slug: 'my-new-post',
      content: '<h1>Hello World</h1><p>这是内容</p>',
      summary: '文章摘要',
      published: true,
    }),
  })
  const post = await postRes.json()
  console.log('文章已创建:', post.id)

  // 3. 查看文章
  const viewRes = await fetch(`${API}/posts/my-new-post`)
  const viewed = await viewRes.json()
  console.log('标题:', viewed.title)

  // 4. 发表评论
  const commentRes = await fetch(`${API}/comments`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      content: '好文章！',
      postId: post.id,
    }),
  })
  const comment = await commentRes.json()
  console.log('评论已发表:', comment.id)

  return { post, comment }
}
```

### 14.2 文件上传（Node.js + FormData）

```javascript
import { createReadStream } from 'fs'
import { FormData, File } from 'formdata-node'

async function uploadFile(token, filePath, parentId) {
  const form = new FormData()
  form.set('file', new File([createReadStream(filePath)], 'photo.jpg'))
  if (parentId) form.set('parentId', String(parentId))

  const res = await fetch('http://localhost:3001/api/drive/upload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  return res.json()
}
```

### 14.3 文件下载（流式）

```javascript
async function downloadFile(token, fileId) {
  const res = await fetch(`http://localhost:3001/api/drive/download/${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const reader = res.body.getReader()
  const chunks = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const blob = new Blob(chunks)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = res.headers.get('Content-Disposition').split("''")[1]
  a.click()
  URL.revokeObjectURL(url)
}
```

### 14.4 Python 完整示例

```python
import requests

class LineWebAPI:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip('/')
        self.token = None

    def login(self, email: str, password: str):
        resp = requests.post(f'{self.base_url}/auth/login', json={
            'email': email, 'password': password,
        })
        data = resp.json()
        self.token = data['token']
        return data['user']

    def _headers(self):
        return {'Authorization': f'Bearer {self.token}'} if self.token else {}

    def get_posts(self, page=1, limit=10):
        resp = requests.get(
            f'{self.base_url}/posts',
            params={'page': page, 'limit': limit},
            headers=self._headers(),
        )
        return resp.json()

    def create_post(self, title, slug, content, summary='', published=False):
        resp = requests.post(
            f'{self.base_url}/posts',
            json={'title': title, 'slug': slug, 'content': content,
                  'summary': summary, 'published': published},
            headers={**self._headers(), 'Content-Type': 'application/json'},
        )
        return resp.json()

    def get_wallpaper(self, mode='latest'):
        resp = requests.get(
            f'{self.base_url}/bing-wallpaper',
            params={'mode': mode},
        )
        return resp.json()

    def get_drive_files(self, parent_id=None, page=1, limit=20):
        params = {'page': page, 'limit': limit}
        if parent_id is not None:
            params['parentId'] = parent_id
        resp = requests.get(
            f'{self.base_url}/drive/files',
            params=params,
            headers=self._headers(),
        )
        return resp.json()

    def upload_file(self, file_path, parent_id=None):
        with open(file_path, 'rb') as f:
            files = {'file': (file_path.split('/')[-1], f)}
            params = {}
            if parent_id is not None:
                params['parentId'] = parent_id
            resp = requests.post(
                f'{self.base_url}/drive/upload',
                params=params,
                files=files,
                headers=self._headers(),
            )
        return resp.json()

    def get_stats(self):
        resp = requests.get(f'{self.base_url}/stats', headers=self._headers())
        return resp.json()


# 使用示例
api = LineWebAPI('http://localhost:3001/api')
user = api.login('admin@lineweb.dev', 'admin123')
print(f'登录成功: {user["username"]}')

# 获取 Dashboard 统计
stats = api.get_stats()
print(f'文章总数: {stats["posts"]["total"]}')
print(f'用户总数: {stats["users"]["total"]}')
print(f'网盘文件数: {stats["drive"]["files"]}')

# 获取文章列表
posts = api.get_posts()
print(f'文章列表: {len(posts["posts"])} 篇')

# 获取壁纸
wallpaper = api.get_wallpaper()
print(f'今日壁纸: {wallpaper.get("title", "")}')
```

### 14.5 使用 curl 的完整工作流

```bash
# === 1. 登录 ===
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@lineweb.dev","password":"admin123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# === 2. 获取 Dashboard 统计 ===
curl -s http://localhost:3001/api/stats \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# === 3. 创建文章 ===
curl -s -X POST http://localhost:3001/api/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "title": "通过 API 创建的文章",
    "slug": "api-post",
    "content": "<p>这是通过 REST API 创建的文章</p>",
    "summary": "API 测试",
    "published": true
  }' | python3 -m json.tool

# === 4. 查看文章（需认证） ===
curl -s http://localhost:3001/api/posts/api-post \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# === 5. 获取今日壁纸（需认证） ===
curl -s http://localhost:3001/api/bing-wallpaper \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# === 6. 获取文件列表 ===
curl -s "http://localhost:3001/api/drive/files?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# === 7. 删除文章 ===
curl -s -X DELETE http://localhost:3001/api/posts/1 \
  -H "Authorization: Bearer $TOKEN"
```

---

## 附录：端点快速索引

| 模块 | 端点数 | 公开 | 需认证 | 需管理员 | 需网盘权限 |
|---|---|---|---|---|---|
| 系统 | 2 | 1 | 1 | 0 | 0 |
| 认证 | 4 | 2 | 2 | 0 | 0 |
| 文章 | 7 | 0 | 2 | 5 | 0 |
| 评论 | 7 | 0 | 3 | 4 | 0 |
| 页面 | 7 | 0 | 2 | 5 | 0 |
| 壁纸 | 2 | 0 | 2 | 0 | 0 |
| 网盘 | 11 | 0 | 0 | 0 | 11 |
| 用户 | 5 | 0 | 0 | 5 | 0 |
| 设备 | 1 | 0 | 0 | 1 | 0 |
| 统计 | 1 | 0 | 0 | 1 | 0 |
| API 密钥 | 5 | 0 | 0 | 5 | 0 |
| **总计** | **52** | **3** | **10** | **26** | **11** |

> **认证说明**：「需认证」= 登录或 API Key 任一即可；「需管理员」= 需管理员权限；「需网盘权限」= 需登录 + canAccessDrive。只有 health / login / register 三个端点为公开（无需任何凭证）。
