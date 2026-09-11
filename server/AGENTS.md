# AGENTS.md — LineWeb Server

Express 4 + Prisma 6 + JWT + Zod API 后端。端口 3001，`tsx` 运行时，`.js` 后缀导入。认证已统一为**账号登录令牌 + 角色能力矩阵**。

## 目录结构

```
server/
├── src/
│   ├── index.ts           # 入口 — 中间件链 + 13 个路由挂载 + WebSocket + 定时同步
│   ├── config/index.ts    # Zod schema（全部端点）+ 环境变量解析
│   ├── middleware/        # auth.ts（登录令牌 + requireCapability）+ errorHandler.ts
│   ├── routes/            # 12 个路由模块（全部前缀 /api）
│   ├── services/          # 8 个服务 — 部分路由直接调 Prisma，不经过 service
│   └── lib/               # prisma.ts（单例）+ utils.ts + asyncHandler.ts + permissions.ts（角色能力矩阵）
├── prisma/
│   ├── schema.prisma      # SQLite schema（8 模型）
│   └── seed.ts            # admin@lineweb.dev / admin123
└── scripts/               # generate-mysql-schema.js + generate-pg-schema.js
```

## 哪里找

| 任务 | 位置 | 说明 |
|------|------|------|
| 加新路由 | `routes/` + `index.ts` 挂载 | 需要公开 → 在 `index.ts` 公开白名单加路径 |
| 改认证逻辑 | `middleware/auth.ts` | 单一登录令牌；逐请求解析角色/能力/网盘权限 |
| 改权限规则 | `lib/permissions.ts` | 角色 → 能力矩阵（新增角色只改这里） |
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

**只有一种凭证：账号登录令牌。** `POST /api/auth/login`（支持 `rememberDays` 1–90 天设备长期令牌）返回 JWT，之后所有请求使用 `Authorization: Bearer <token>`（下载直链兼容 `?token=`）。

- **JWT payload**：`{ userId, role, ts }`；`ts` 为毫秒级签发时间，与 `user.tokenValidAfter` 精确比较（登出/改密后同秒内旧令牌也立即失效）。
- **权限不信任令牌**：`capabilities`（由角色展开）与 `canAccessDrive` 每次请求从数据库解析 → 角色变更即时生效。
- **能力矩阵**：`src/lib/permissions.ts`（`USER_ROLES`、`CAPABILITIES`、`capabilitiesForRole`、`roleHasCapability`）；admin 拥有全部能力，user 无管理能力。
- **守卫**：`requireCapability('user:manage')` 等（替代旧的 `requireAdmin`）；`optionalAuthenticate` 用于公开但可选的端点（`/api/ai/chat`）。
- **公开路径**（全局中间件跳过，共 11 条）：`/auth/login`、`/auth/register`、`/auth/avatar`、`/health`、`/posts`、`/pages/featured`、`/pages/slug`、`/stats/public`、`/version`、`/comments/post`、`/ai/chat`。
- **已移除**：`X-API-Key`（apiKeys 路由与 `ApiKey` 表）、`X-Screen-Time-Token`（`middleware/screenTimeAuth.ts` 与 `ScreenTimeToken` 表）。
- **Drive 权限**：`router.use(authenticate, ...)` 内联判断 `req.user.canAccessDrive || 具备 drive:all 能力`（不再有 60s 内存缓存与 `clearDriveAccessCache`）。

## 路由

| 路由文件 | 关键路径 | 特殊中间件 |
|---------|---------|-----------|
| auth.ts | register/login/me/profile/settings/logout | `authLimiter`（注册/登录限流 20/15分钟） |
| posts.ts | CRUD + admin/all + admin/:id | 管理与写操作加 `requireCapability('content:write')` |
| comments.ts | CRUD + 树形回复 + admin/* | `/admin/*`、PUT/DELETE 用 `comment:moderate`；自引用 `parentId` 实现嵌套 |
| pages.ts | CRUD + featured + slug/:slug | `content:write`；schema 字段存 JSON 控件树 |
| users.ts | CRUD + drive-access + avatar | `router.use(authenticate, requireCapability('user:manage'))` |
| drive.ts | files/folders/search/upload/download/sync | `router.use(authenticate, ...)` + `canAccessDrive` / `drive:all` |
| devices.ts | GET / | `router.use(authenticate, requireCapability('device:view'))` |
| stats.ts | GET /（`stats:view`）+ /public | 60s 内存缓存 |
| avatar.ts | POST/GET/DELETE | `router.use(authenticate)` |
| health.ts | screen-time/range、push、daily-goal | 全部使用登录令牌（仅本人数据） |

## 服务层

| 服务 | 职责 | Prisma 使用 |
|------|------|------------|
| authService | 注册/登录/JWT 签发/登出 | findUnique/findFirst/create/update |
| postService | 文章 CRUD + 分页 + slug 查重 | findMany+count/findUnique/create/update/delete |
| avatarService | 头像上传处理（sharp）+ 存储节点通信 | update |
| screenTimeService | 屏幕时间记录/目标/区间查询（无需 Token 逻辑） | upsert/findUnique/findMany |
| storageTunnel | WebSocket 服务器 + 命令代理 | 无（纯 WebSocket） |
| storageSync | 网盘文件同步（节点 ↔ DB） | findMany/deleteMany/upsert |
| dedupDriveFiles | 重复记录清理 | $queryRawUnsafe |
| deviceTracker | 内存设备追踪 | 无（纯 Map） |

## 反模式 / 注意事项

- **`req.user!.userId`**：多处非空断言，应改用 `req.user` 判空或声明合并
- **`lib/errorHandler.ts`**：已定义但未使用，实际用 `middleware/errorHandler.ts`
- **`drive.ts`（约 1050 行）**：超大路由文件，建议拆分为独立 handler + service
- **部分路由无 service 层**：comments/pages/stats/driveFavorites 直接调 Prisma
- **裸 catch {}**：多处存在且无注释
- **asyncHandler 已应用**：`posts.ts` 和 `pages.ts` 的所有 async 路由处理器已包裹 `asyncHandler()`，确保异步异常正确转发到 `errorHandler`。其他路由文件（comments、drive 等）尚未包裹，仍有未处理 async 异常的风险。

## 命令

```bash
npm run dev           # tsx watch src/index.ts
npm run db:push       # prisma db push → SQLite
npm run db:seed       # prisma db seed
npm run db:studio     # prisma studio
```
