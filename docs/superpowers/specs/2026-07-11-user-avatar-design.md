# User Avatar 功能设计

## 概述

为用户添加头像功能。头像图片存储在存储节点（Storage Node）上，使用专用隐藏文件夹 `_avatars/`，不在网盘（Drive）界面显示。

## 数据库变更

### User 模型新增字段

- `avatarPath` — `String?`，可选，存储头像在存储节点上的相对路径（如 `_avatars/1.webp`）。
- Prisma 字段名：`avatarPath`，`@@map` 映射为 `avatar_path`。

### Prisma Schema 变更

```prisma
model User {
  // ... existing fields ...
  avatarPath  String?  @map("avatar_path")
  // ... existing relations ...
}
```

不在 DriveFile 中创建记录。头像文件由存储隧道（storageTunnel）直接读写，不经过 Drive 路由。

## 存储规范

- **路径格式**：`_avatars/{userId}.webp`
- **所有头像统一格式**：WebP
- **尺寸**：256×256（Sharp resize cover）
- **文件大小限制**：2MB
- **允许的源格式**：image/jpeg, image/png, image/webp, image/gif

## API 端点

| 方法 | 路径 | 认证 | 权限 | 说明 |
|------|------|------|------|------|
| POST | `/api/auth/avatar` | JWT | 登录用户 | 上传/更新自己的头像 |
| GET | `/api/auth/avatar` | JWT | 登录用户 | 获取当前登录用户的头像 |
| GET | `/api/auth/avatar/:userId` | JWT | 登录用户 | 获取任意用户的头像 |
| DELETE | `/api/auth/avatar` | JWT | 登录用户 | 删除自己的头像（还原为默认） |
| PUT | `/api/users/:id/avatar` | JWT | 管理员 | 管理员为任意用户设置头像 |

### POST /api/auth/avatar — 上传头像

- Content-Type: `multipart/form-data`
- 字段 `avatar`：图片文件
- 流程：
  1. busboy 解析 multipart，边收边读
  2. 校验 MIME 类型（仅允许图片格式）
  3. 校验文件大小 ≤ 2MB
  4. Sharp 处理：resize 256×256（cover），quality 80，转 webp
  5. `streamWrite` 写入存储节点 `_avatars/{userId}.webp`
  6. 更新 `User.avatarPath` 为 `_avatars/{userId}.webp`
- 响应：`200 { "avatarPath": "_avatars/1.webp" }`

### GET /api/auth/avatar — 获取头像

- 流程：
  1. 查当前用户的 `avatarPath`
  2. 无 → `204 No Content`（前端显示默认头像）
  3. 有 → `streamRead` 流式输出
- 响应头：`Content-Type: image/webp`, `Cache-Control: public, max-age=86400`

### GET /api/auth/avatar/:userId — 获取指定用户头像

同上，按 userId 查用户。

### DELETE /api/auth/avatar — 删除头像

1. 获取当前用户的 `avatarPath`
2. 有则通过存储节点 `delete_file` 删除文件
3. 将 `User.avatarPath` 置为 null
- 响应：`200 { "message": "头像已删除" }`

### PUT /api/users/:id/avatar — 管理员设置头像

与 POST 逻辑相同但由管理员操作任意用户。

## 网盘隐藏策略

- 头像文件存储在 `_avatars/` 路径下，**不创建 DriveFile 记录**
- 修改 `storageSync.ts` 中的 `syncDriveFiles()` 扫描逻辑，跳过以 `_avatars/` 开头的路径
- Drive api 路由无需修改，因为无对应 DriveFile 记录

## 前端组件

### UserAvatar (`client/src/components/UserAvatar.tsx`)

通用头像展示组件。

```tsx
interface UserAvatarProps {
  userId: number
  username: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
}
```

- 尺寸映射：sm=24px, md=32px, lg=48px, xl=80px
- 加载时请求 `/api/auth/avatar/:userId`
- 失败/无头像时显示默认头像
- **默认头像**：背景色 `hsl(userId * 137.508, 50%, 50%)`，白色文字显示用户名前 1-2 字符（取第一个中文字符或英文字母）
- 圆形展示（`border-radius: 50%`）
- 使用 `<img>` 标签加载成功后显示，缓存由浏览器处理

### AvatarUpload (`client/src/components/AvatarUpload.tsx`)

功能：
- 当前头像预览（使用 UserAvatar 组件）
- 文件选择按钮（accept="image/*"）
- 拖放上传区域
- 上传进度指示
- 移除头像按钮
- 裁剪提示

### 集成位置

- **设置页面**：用户管理自己的头像
- **管理后台用户列表**：管理员查看和操作用户头像
- **评论**：CommentCard 中显示评论者头像
- **文章**：文章作者信息区域显示作者头像
- **导航栏**：登录状态显示当前用户头像

## 后端依赖

新增依赖：`sharp`（图片处理，需添加到 `server/package.json`）

## 迁移方案

- 无需数据迁移
- 已有用户无 avatarPath → 前端自动显示默认首字母头像
- 存储节点上已有的 `_avatars/` 文件夹在 sync 时被跳过，不会出现在网盘中

## 错误处理

- 上传非图片文件 → 400 "仅支持图片格式"
- 文件超过 2MB → 400 "文件大小不能超过 2MB"
- 存储节点未连接 → 503 "存储节点不可用"
- 用户不存在（GET avatar by ID）→ 404
