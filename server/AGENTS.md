# AGENTS.md — LineWeb Server

Express 4 + Prisma 6 + JWT + Zod API 后端。端口 3001，`tsx` 运行时，`.js` 后缀导入。

## 目录结构

```
server/
├── src/
│   ├── index.ts           # 入口 — 14 层中间件 + 12 个路由挂载 + WebSocket + 定时同步
│   ├── config/index.ts    # Zod schema（全部端点）+ 环境变量解析
│   ├── middleware/        # auth.ts (JWT+API Key) + errorHandler.ts + screenTimeAuth.ts
│   ├── routes/            # 12 个路由模块（全部前缀 /api）
│   ├── services/          # 8 个服务 — 部分路由直接调 Prisma，不经过 service
│   └── lib/               # prisma.ts（单例）+ utils.ts + asyncHandler.ts（async 路由错误转发）+ errorHandler.ts（⚠️ 未使用）
├── prisma/
│   ├── schema.prisma      # SQLite schema（8 模型）
│   └── seed.ts            # admin@lineweb.dev / admin123
└── scripts/               # generate-mysql-schema.js + generate-pg-schema.js
```

## 哪里找

| 任务 | 位置 | 说明 |
|------|------|------|
| 加新路由 | `routes/` + `index.ts:104-115` 挂载 | 需要 auth → 在 `index.ts` 公开白名单加路径 |
| 改认证逻辑 | `middleware/auth.ts` | JWT + API Key 双认证，内存缓存 token 失效 |
| 加 Zod 校验 | `config/index.ts` | 所有 schema 集中定义 |
| 数据库操作 | `lib/prisma.ts` 单例 | PrismaClient，必须从这里 import |
| 加业务逻辑 | `services/` | authService、postService、avatarService 有 service 层；其余路由直接调 Prisma |
| 文件上传 | routes 中用 `busboy` | drive/avatar/users 三处；无 multer |
| 存储节点通信 | `services/storageTunnel.ts` | WebSocket 命令代理 + 流式读写 |

## 中间件链顺序

```
helmet(CSP) → cors → compression → body parser(10mb) → rate-limit(200/15min)
→ 设备追踪 → 全局认证检查 → routes → errorHandler
```

## 认证

- **JWT**：`Authorization: Bearer <token>`，payload `{ userId, role }`
- **API Key**：`X-API-Key: <key>`，`lw_` 前缀，DB 存 SHA256 哈希
- **屏幕时间 Token**：`X-Screen-Time-Token`，用于 `/api/health/push`
- **公开路径**（全局中间件跳过）：`/auth/login`、`/auth/register`、`/health`、`/health/push`、`/posts`、`/pages/featured`、`/pages/slug`、`/bing-wallpaper`、`/stats/public`、`/version`、`/comments/post`
- **Admin 守卫**：`requireAdmin` 中间件，检查 `req.user.role === 'admin'`
- **Drive 权限**：`checkDriveAccess` 中间件，检查 `canAccessDrive`（60s 内存缓存）

## 路由

| 路由文件 | 关键路径 | 特殊中间件 |
|---------|---------|-----------|
| auth.ts | register/login/me/settings/logout | `authLimiter`（注册/登录限流 20/15分钟） |
| posts.ts | CRUD + admin/all + admin/:id | admin 路由加 `requireAdmin` |
| comments.ts | CRUD + 树形回复 + admin/* | 自引用 `parentId` 实现嵌套 |
| pages.ts | CRUD + featured + slug/:slug | schema 字段存 JSON 控件树 |
| users.ts | CRUD + drive-access + avatar | `router.use(authenticate, requireAdmin)` |
| drive.ts | files/folders/search/upload/download/sync | `router.use(authenticate, checkDriveAccess)` |
| devices.ts | GET / | `router.use(authenticate, requireAdmin)` |
| stats.ts | GET /（admin）+ /public | 60s 内存缓存 |
| apiKeys.ts | CRUD | `router.use(authenticate, requireAdmin)` |
| avatar.ts | POST/GET/DELETE | `router.use(authenticate)` |
| bing.ts | GET / + /proxy | SSRF 白名单（6 域名） |
| health.ts | screen-time/push/tokens | 混合 JWT + screenTimeToken 认证 |

## 服务层

| 服务 | 职责 | Prisma 使用 |
|------|------|------------|
| authService | 注册/登录/JWT 签发/登出 | findUnique/findFirst/create/update |
| postService | 文章 CRUD + 分页 + slug 查重 | findMany+count/findUnique/create/update/delete |
| avatarService | 头像上传处理（sharp）+ 存储节点通信 | update |
| screenTimeService | Token 生成/验证/屏幕时间记录 | create/findMany/upsert/deleteMany |
| storageTunnel | WebSocket 服务器 + 命令代理 | 无（纯 WebSocket） |
| storageSync | 网盘文件同步（节点 ↔ DB） | findMany/deleteMany/upsert |
| dedupDriveFiles | 重复记录清理 | $queryRawUnsafe |
| deviceTracker | 内存设备追踪 | 无（纯 Map） |

## 反模式 / 注意事项

- **`req.user!.userId`**：27 处非空断言，应该用声明合并
- **跨路由依赖**：`users.ts` import `clearDriveAccessCache` from `drive.ts`
- **`lib/errorHandler.ts`**：已定义但未使用，实际用 `middleware/errorHandler.ts`
- **`drive.ts`（833行）**：超大路由文件，建议拆分为独立 handler + service
- **部分路由无 service 层**：comments/pages/stats/apiKeys 直接调 Prisma
- **裸 catch {}**：多处存在且无注释
- **asyncHandler 已应用**：`posts.ts` 和 `pages.ts` 的所有 async 路由处理器已包裹 `asyncHandler()`，确保异步异常正确转发到 `errorHandler`。其他路由文件（comments、drive 等）尚未包裹，仍有未处理 async 异常的风险。

## 命令

```bash
npm run dev           # tsx watch src/index.ts
npm run db:push       # prisma db push → SQLite
npm run db:seed       # prisma db seed
npm run db:studio     # prisma studio
```
