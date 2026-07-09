# HarmonyOS 客户端 API 集成指南

## 概述

本文档说明鸿蒙（HarmonyOS）客户端如何调用 LineWeb 后端的所有 API 接口。后端运行在 Express + Prisma 上，所有 API 端点挂载在 `/api` 路径下。

---

## 基础配置

### 1. API 地址

已在 [ApiConfig.ets](file:///C:/Users/22798/DevEcoStudioProjects/LineWeb/entry/src/main/ets/constants/ApiConfig.ets) 中配置为生产环境，直接使用即可：

```typescript
export class ApiConfig {
  static readonly BASE_URL: string = 'https://lineweb-production.up.railway.app/api';
  static readonly TIMEOUT: number = 30000;
  static readonly TOKEN_KEY: string = 'lineweb_token';
}
```

> 后端服务器持续运行在 Railway 上，鸿蒙端无需额外配置即可访问。

### 2. 启动流程

在 [EntryAbility.ets](file:///C:/Users/22798/DevEcoStudioProjects/LineWeb/entry/src/main/ets/entryability/EntryAbility.ets) 的 `onWindowStageCreate` 中已配置：

```typescript
apiClient.setContext(this.context);  // 设置上下文
apiClient.loadToken();               // 从本地存储恢复 token
authStore.loadUser();                // 用 token 恢复用户信息
```

### 3. ApiClient 核心方法

[ApiClient.ets](file:///C:/Users/22798/DevEcoStudioProjects/LineWeb/entry/src/main/ets/services/ApiClient.ets) 提供四个通用请求方法：

| 方法 | 说明 |
|---|---|
| `apiClient.get<T>(path)` | GET 请求 |
| `apiClient.post<T>(path, body?)` | POST 请求 |
| `apiClient.put<T>(path, body?)` | PUT 请求 |
| `apiClient.delete<T>(path)` | DELETE 请求 |

- 自动在 URL 前拼接 `BASE_URL`
- 自动注入 `Authorization: Bearer {token}`（如果有）
- 非 200/201 响应抛 `ApiError`（含 `status` 和 `message`）

---

## 完整 API 接口

### 1. 认证

**登录**

```typescript
// AuthService.ets
authService.login('admin@lineweb.dev', 'admin123')
```

```
POST /api/auth/login
Content-Type: application/json

Request:
{
  "email": "admin@lineweb.dev",
  "password": "admin123"
}

Response 200:
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": 1,
    "username": "admin",
    "email": "admin@lineweb.dev",
    "role": "admin",
    "settings": "{}",
    "canAccessDrive": true
  }
}

Error 401:
{ "error": "邮箱或密码错误" }
```

**注册**

```typescript
authService.register('newuser', 'new@user.com', 'password123')
```

```
POST /api/auth/register

Request: { "username": "newuser", "email": "new@user.com", "password": "password123" }
Response 201: { "token": "...", "user": { ... } }
Error 409: { "error": "用户名或邮箱已被注册" }
```

**获取当前用户**

```typescript
authService.getCurrentUser()
```

```
GET /api/auth/me
Authorization: Bearer {token}

Response 200:
{
  "id": 1,
  "username": "admin",
  "email": "admin@lineweb.dev",
  "role": "admin",
  "settings": "{}",
  "canAccessDrive": true,
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

**更新设置**

```typescript
authService.updateSettings('{"theme":"dark","language":"zh"}')
```

```
PUT /api/auth/settings
Authorization: Bearer {token}

Request: { "settings": "{\"theme\":\"dark\",\"language\":\"zh\"}" }
Response 200: { "user": { "id": 1, "username": "admin", "email": "admin@lineweb.dev", "role": "admin", "settings": "{\"theme\":\"dark\",\"language\":\"zh\"}", "canAccessDrive": true } }
```

**退出**

```typescript
authService.logout()
// 仅清除本地 token，无需调用后端
```

---

### 2. 文章

**获取文章列表（公开）**

```typescript
postService.getPosts(page: number = 1, limit: number = 10)
```

```
GET /api/posts?page=1&limit=10

Response 200:
{
  "posts": [
    {
      "id": 1,
      "title": "文章标题",
      "summary": "文章简介",
      "slug": "my-post",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "author": { "username": "admin" }
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 10,
  "totalPages": 1
}
```

**获取单篇文章（公开）**

```typescript
postService.getPostBySlug(slug: string)
```

```
GET /api/posts/my-post

Response 200:
{
  "id": 1,
  "title": "文章标题",
  "content": "<p>HTML 内容</p>",
  "summary": "简介",
  "slug": "my-post",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "author": { "username": "admin" }
}

Error 404: { "error": "文章不存在" }
```

**创建文章（需管理员）**

```typescript
postService.createPost(data: PostData)
```

```
POST /api/posts
Authorization: Bearer {token}

Request:
{
  "title": "新文章",
  "content": "<p>内容</p>",
  "slug": "new-post",
  "summary": "简介（可选）",
  "published": true
}

Response 201: { "id": 2, "title": "新文章", ... }
Error 409: { "error": "该 slug 已被使用" }
```

**更新文章（需管理员）**

```typescript
postService.updatePost(id: number, data: PostData)
```

```
PUT /api/posts/2
Authorization: Bearer {token}

Request: { "title": "修改后的标题", "published": false }
Response 200: { "id": 2, "title": "修改后的标题", ... }
```

**删除文章（需管理员）**

```typescript
postService.deletePost(id: number)
```

```
DELETE /api/posts/2
Authorization: Bearer {token}

Response 200: { "message": "已删除" }
```

---

### 3. 评论

**获取评论（分页扁平列表）**

```typescript
commentService.getComments(postId: number, page: number = 1, limit: number = 20)
```

```
GET /api/comments?postId=1&page=1&limit=20

Response 200:
{
  "comments": [
    {
      "id": 1,
      "content": "评论内容",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "postId": 1,
      "author": { "username": "user1" }
    }
  ],
  "total": 1,
  "page": 1,
  "totalPages": 1
}
```

**发表评论（需登录）**

```typescript
commentService.createComment(postId: number, content: string)
```

```
POST /api/comments
Authorization: Bearer {token}

Request: { "postId": 1, "content": "评论内容" }

Response 201:
{
  "id": 2,
  "content": "评论内容",
  "createdAt": "2025-01-01T00:00:00.000Z",
  "postId": 1,
  "parentId": null,
  "author": { "id": 1, "username": "admin" }
}
```

> 如需回复评论，在请求体中添加 `parentId`：`{ "postId": 1, "content": "回复", "parentId": 1 }`

**删除评论（需管理员）**

```typescript
commentService.deleteComment(id: number)
```

```
DELETE /api/comments/2
Authorization: Bearer {token}

Response 200: { "message": "评论已删除" }
```

---

### 4. 网盘

所有网盘接口需要用户有 `canAccessDrive = true` 权限。

**获取文件列表**

```typescript
driveService.getFiles(parentId: number | null, page: number = 1, limit: number = 15)
```

```
GET /api/drive/files?page=1&limit=15           （根目录）
GET /api/drive/files?page=1&limit=15&parentId=3（进入文件夹 ID=3）

Response 200:
{
  "data": [
    {
      "id": 1,
      "name": "文档",
      "isFolder": true,
      "parentId": null,
      "size": 0,
      "mimeType": null,
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "uploadedBy": { "id": 1, "username": "admin" }
    },
    {
      "id": 2,
      "name": "report.pdf",
      "isFolder": false,
      "parentId": null,
      "size": 1024000,
      "mimeType": "application/pdf",
      "createdAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z",
      "uploadedBy": { "id": 1, "username": "admin" }
    }
  ],
  "total": 2,
  "page": 1,
  "pageCount": 1
}
```

**搜索文件**

```typescript
driveService.searchFiles(query: string)
```

```
GET /api/drive/search?q=报告

Response 200: DriveItem[]
```

**创建文件夹**

```typescript
driveService.createFolder(name: string, parentId: number | null)
```

```
POST /api/drive/files
Authorization: Bearer {token}

Request: { "name": "新文件夹", "isFolder": true, "parentId": null }

Response 201:
{
  "id": 4,
  "name": "新文件夹",
  "isFolder": true,
  "parentId": null,
  "size": 0,
  "mimeType": null,
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "uploadedBy": { "id": 1, "username": "admin" }
}
```

**重命名文件/文件夹**

```typescript
driveService.renameFile(id: number, name: string)
```

```
PUT /api/drive/files/2
Authorization: Bearer {token}

Request: { "name": "new-name.pdf" }
Response 200: DriveItem
```

**删除文件/文件夹**

```typescript
driveService.deleteFile(id: number)
```

```
DELETE /api/drive/files/2
Authorization: Bearer {token}

Response 200: { "message": "已删除" }
```

**同步网盘**

```typescript
driveService.sync()
```

```
POST /api/drive/sync
Authorization: Bearer {token}

Response 200: SyncReport（同步结果报告）
```

**下载文件**

```typescript
driveService.getDownloadUrl(id: number): string
// 返回: "https://.../api/drive/files/{id}/download"
```

下载使用 `@ohos.net.http` 的 `http.request` 直接流式下载：

```typescript
import http from '@ohos.net.http';

async function downloadFile(fileId: number, savePath: string) {
  const httpRequest = http.createHttp();
  try {
    const result = await httpRequest.request(
      `https://lineweb-production.up.railway.app/api/drive/files/${fileId}/download`,
      {
        method: http.RequestMethod.GET,
        header: {
          'Authorization': `Bearer ${apiClient.getToken()}`,
        },
        // 使用 filePath 保存到本地
        filePath: savePath,
        expectDataType: http.HttpDataType.FILE,
      }
    );
    return result;
  } finally {
    httpRequest.destroy();
  }
}
```

---

### 5. 必应壁纸

**获取壁纸**

```typescript
wallpaperService.getWallpaper(mode?: string, date?: string)

// 最新壁纸
wallpaperService.getWallpaper('latest')

// 随机壁纸
wallpaperService.getWallpaper('random')

// 指定日期（YYYYMMDD）
wallpaperService.getWallpaper('date', '20250601')
```

```
GET /api/bing-wallpaper?mode=latest

Response 200:
{
  "url": "https://.../image.jpg",
  "copyright": "© 2025 ...",
  "title": "壁纸标题",
  "headline": "头条标题",
  "date": "20250601"
}
```

**获取壁纸历史**

```typescript
wallpaperService.getHistory()
```

```
GET /api/bing-wallpaper?history=true

Response 200:
{
  "items": [
    {
      "date": "20250601",
      "title": "壁纸标题",
      "copyright": "© 2025 ...",
      "image_url_4k": "https://.../4k.jpg",
      "image_url_1080": "https://.../1080.jpg",
      "image_url": "https://.../image.jpg"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 8,
    "total": 30
  }
}
```

---

## 数据模型

### User

```typescript
interface User {
  id: number;
  username: string;
  email: string;
  role: string;           // "user" | "admin"
  settings: string;       // JSON 字符串
  canAccessDrive: boolean;
}

interface AuthResponse {
  token: string;
  user: User;
}
```

### Post

```typescript
interface Post {
  id: number;
  title: string;
  content: string;        // HTML
  summary: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  author: { username: string };
}

interface PostsResponse {
  posts: Post[];
  total: number;
  page: number;
  totalPages: number;
}

interface PostData {
  title: string;
  content: string;
  summary: string;
  slug: string;
  published: boolean;
}
```

### Comment

```typescript
interface Comment {
  id: number;
  content: string;
  createdAt: string;
  author: { username: string };
  postId: number;
}

interface CommentsResponse {
  comments: Comment[];
  total: number;
  page: number;
  totalPages: number;
}
```

### DriveItem

```typescript
interface DriveItem {
  id: number;
  name: string;
  isFolder: boolean;
  parentId: number;
  size: number;
  mimeType: string;
  createdAt: string;
  updatedAt: string;
  uploadedBy: { id: number; username: string };
}

interface DriveListResponse {
  data: DriveItem[];
  total: number;
  page: number;
  pageCount: number;
}
```

### Wallpaper

```typescript
interface WallpaperData {
  url: string;
  copyright: string;
  title: string;
  headline: string;
  date: string;
}

interface HistoryItem {
  date: string;
  title: string;
  copyright: string;
  image_url_4k: string;
  image_url_1080: string;
  image_url: string;
}

interface HistoryResponse {
  items: HistoryItem[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
  };
}
```

---

## 错误处理

所有接口在出错时返回统一格式：

```typescript
// 401 — 未登录或 token 过期
{ "error": "未登录" }
{ "error": "令牌无效或已过期" }

// 403 — 权限不足
{ "error": "需要管理员权限" }
{ "error": "无网盘访问权限" }

// 404 — 资源不存在
{ "error": "文章不存在" }

// 409 — 冲突（如重复 slug）
{ "error": "该 slug 已被使用" }
```

ApiClient 已封装错误处理：非 200/201 状态码会抛出 `ApiError`（含 `status` 和 `message`）。

```typescript
try {
  const result = await apiClient.get<Post>('/posts/non-existent');
} catch (err) {
  if (err instanceof ApiError) {
    console.log(`错误 ${err.status}: ${err.message}`);
    // 如 401 则跳转登录页
    if (err.status === 401) {
      // 跳转到登录页
    }
  }
}
```

---

## 补充说明

### 尚未在鸿蒙端实现的接口

以下后端接口已就绪，但鸿蒙客户端未编写对应的 Service 方法：

| 接口 | 说明 | 鸿蒙端状态 |
|---|---|---|
| `POST /api/drive/upload` | 文件上传（multipart 流式） | ❌ 未实现 |
| `GET/PUT/DELETE /api/users` | 用户管理（管理员用） | ❌ 仅占位 UI |
| `POST /api/comments` 的 `parentId` 参数 | 回复评论 | ❌ 未传参 |

### 测试账号

```
管理员: admin@lineweb.dev / admin123
管理员: line@lineweb.dev / liang798119
```

### 本地启动后端

```bash
# 在根目录
npm run dev
# 后端 → http://localhost:3001
# 前端 → http://localhost:5173
```
