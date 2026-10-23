# AGENTS.md — LineWeb Server

Express 4 + Prisma 6 + JWT + Zod API 后端。端口 3001，`tsx` 运行时，`.js` 后缀导入。认证已统一为**账号登录令牌 + 角色能力矩阵**。

## 目录结构

```
server/
├── src/
│   ├── index.ts           # 入口 — 中间件链 + 14 个路由挂载 + WebSocket(/ws/storage + /ws/chat) + 定时同步
│   ├── config/index.ts    # Zod schema（全部端点）+ 环境变量解析
│   ├── middleware/        # auth.ts（登录令牌 + requireCapability）+ errorHandler.ts
│   ├── routes/            # 14 个路由模块（全部前缀 /api）
│   ├── services/          # 14 个服务 — 部分路由直接调 Prisma，不经过 service
│   └── lib/               # prisma.ts（单例）+ utils.ts + asyncHandler.ts + permissions.ts（角色能力矩阵）
├── prisma/
│   ├── schema.prisma      # SQLite schema（17 模型，含好友/聊天与 storageQuota）
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
helmet(CSP) → cors → compression → body parser(1mb) → rate-limit(600/15min)
→ 设备追踪 → 全局认证检查 → routes → errorHandler
```

## 认证

**只有一种凭证：账号登录令牌。** `POST /api/auth/login`（支持 `rememberDays` 1–90 天设备长期令牌）返回 JWT，之后所有请求使用 `Authorization: Bearer <token>`（下载直链兼容 `?token=`）。

- **JWT payload**：`{ userId, role, ts }`；`ts` 为毫秒级签发时间，与 `user.tokenValidAfter` 精确比较（登出/改密后同秒内旧令牌也立即失效）。
- **权限不信任令牌**：`capabilities`（由角色展开）、`canAccessDrive` 与网盘 `storageQuota` 每次请求从数据库解析 → 角色变更即时生效。
- **能力矩阵**：`src/lib/permissions.ts`（`USER_ROLES`、`CAPABILITIES`、`capabilitiesForRole`、`roleHasCapability`）；角色 `user`/`author`/`admin`，**注册默认 `author`**（schema 默认值 + `registerUser` 显式指定；存量账号可用 `scripts/promote-users-to-author.ts` 一次性提升），`author` 仅 `content:write`，`content:manage`（全站文章 + 页面）仅 admin，admin 拥有全部能力，user 无管理能力。
- **守卫**：`requireCapability('user:manage')` 等（替代旧的 `requireAdmin`）；`optionalAuthenticate` 用于公开但可选的端点（`/api/ai/chat`）。
- **公开路径**（全局中间件跳过，共 13 条）：`/auth/login`、`/auth/register`、`/auth/avatar`、`/health`、`/posts`、`/pages/featured`、`/pages/slug`、`/stats/public`、`/version`、`/comments/post`、`/ai/chat`、`/oauth/token`、`/oauth/revoke`（后两条为精确路径匹配）。
- **已移除**：`X-API-Key`（apiKeys 路由与 `ApiKey` 表）、`X-Screen-Time-Token`（`middleware/screenTimeAuth.ts` 与 `ScreenTimeToken` 表）。
- **Drive 权限**：`router.use(authenticate, ...)` 内联判断 `req.user.canAccessDrive || 具备 drive:all 能力`（不再有 60s 内存缓存与 `clearDriveAccessCache`）；上传受 `storageQuota` 配额约束（`drive:all` 不限），`POST /drive/sync` 仅 `drive:all`；**已用空间包含聊天图片**（`driveQuota.getDriveUsage` 会叠加 `Message.imageSize`，撤回后不计）。
- **聊天**：`/api/chat/*` 全部要求登录；WS `/ws/chat` 用认证帧 + `resolveAuthContext`，拒绝 app/download 令牌；聊天写操作限流 120 次 / 5 分钟 / 用户；**图片消息**走 `chatImageService`（busboy + sharp 转 WebP → 存储节点 `_chat/`，计入网盘配额），**2 分钟撤回**由 `chatService.recallMessage` 强制（撤回图片会删节点文件并释放配额）。
- **下载票据**：`POST /api/drive/download-ticket/:id` 签发的票据带毫秒级 `ts`（与登录令牌同样的失效精度），且 `type === 'download'` 的票据**只能访问两个下载端点**，访问其它 API 返回 403 `下载票据仅可用于文件下载`；`optionalAuthenticate` 对票据按游客处理。

## 路由

| 路由文件 | 关键路径 | 特殊中间件 |
|---------|---------|-----------|
| auth.ts | register/login/me/profile/settings/logout | `authLimiter`（注册/登录限流 20/15分钟） |
| posts.ts | CRUD + admin/all + admin/:id | 写/管理读加 `requireCapability('content:write')`；作者只能操作自己的文章（否则 404），`content:manage` 可跨作者 |
| comments.ts | CRUD + 树形回复 + admin/* | `/admin/*`、PUT/DELETE 用 `comment:moderate`；自引用 `parentId` 实现嵌套 |
| pages.ts | CRUD + featured + slug/:slug | 管理路由用 `content:manage`（仅 admin）；schema 字段存 JSON 控件树 |
| users.ts | CRUD + drive-access + avatar + quota | `router.use(authenticate, requireCapability('user:manage'))`；列表/详情返回配额字符串，`PUT /:id/quota` 调空间上限 |
| drive.ts | files/folders/search/upload/download/sync/quota | `router.use(authenticate, ...)` + `canAccessDrive` / `drive:all`；上传三阶段配额校验；`GET /quota`；`/sync` 仅 drive:all |
| devices.ts | GET / | `router.use(authenticate, requireCapability('device:view'))` |
| stats.ts | GET /（`stats:view`）+ /public | 60s 内存缓存 |
| avatar.ts | POST/GET/DELETE | `router.use(authenticate)` |
| health.ts | screen-time/range、push、daily-goal | 全部使用登录令牌（仅本人数据） |
| ai.ts | chat / chat/public / write/* / config | `/chat` 走 `optionalAuthenticate`；写作辅助需 `content:write`，`/config` 需 `ai:configure` |
| oauth.ts | token / revoke / authorize-context / authorize / grants / clients | `token`、`revoke` 公开（精确路径 + `oauthLimiter`）；`authorize*`/`grants` 需登录；`clients` 需 `app:manage` |
| driveFavorites.ts | 收藏夹 CRUD + reorder | `router.use(authenticate)`；挂载在 `/api/drive/favorites` |
| chat.ts | summary / users/search / friends / friend-requests / conversations / messages / images / recall / read / group members | `router.use(authenticate)`；写操作 5 分钟 120 次/用户限流；返回前广播 WS 事件（含 `message:recalled`）；图片读取支持 `?token=` 直链 |

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
| aiService | OpenAI 兼容调用、提示词与上下文拼装 | findUnique/update（AiConfig） |
| oauthService | OAuth 2.0 授权码 / PKCE / 刷新轮换与吊销 | OAuthClient/Grant/Code/RefreshToken |
| ftsSearch | SQLite FTS5 全文索引（启动时建表） | $queryRaw（FTS 虚拟表） |
| driveQuota | 网盘配额计算（getDriveUsage / getDriveQuota / formatQuotaSize）；getDriveUsage = 网盘文件 + 聊天图片 | aggregate/groupBy（DriveFile.size / Message.imageSize） |
| chatService | 好友 / 好友申请 / 会话 / 消息（文本、图片 DTO）/ 2 分钟撤回 / 群管理业务逻辑 | Friendship/FriendRequest/Conversation/ConversationMember/Message |
| chatImageService | 聊天图片：busboy 流 → sharp 归一化（EXIF/2048/WebP）→ 存储节点 `_chat/<conversationId>/` → 配额复核 | Message（内部由路由事务写入） |
| chatHub | 聊天 WebSocket Hub：认证、在线连接 Map、心跳、sendToUser(s) | 无（纯 WebSocket + resolveAuthContext） |

## 反模式 / 注意事项

- **`req.user!.userId`**：多处非空断言，应改用 `req.user` 判空或声明合并
- **`lib/errorHandler.ts`**：已定义但未使用，实际用 `middleware/errorHandler.ts`
- **`drive.ts`（约 1050 行）**：超大路由文件，建议拆分为独立 handler + service
- **部分路由无 service 层**：comments/pages/stats/driveFavorites 直接调 Prisma
- **裸 catch {}**：多处存在且无注释
- **asyncHandler 已应用**：`posts.ts` 和 `pages.ts` 的所有 async 路由处理器已包裹 `asyncHandler()`，确保异步异常正确转发到 `errorHandler`。其他路由文件（comments、drive 等）尚未包裹，仍有未处理 async 异常的风险。
- **WebSocket upgrade 分发**：`chatHub` 用 `noServer: true` 接管 `server` 的 `upgrade` 事件并按路径分发（`/ws/chat` 自己处理，其余转交先前监听器），因此 `initChatHub` 必须在 `initStorageTunnel` 之后调用；新增 WS 服务需接入同一分发。
- **BigInt 序列化**：`User.storageQuota`、`DriveFile.size` 不能直接进 JSON；所有对外响应显式 `String()`，客户端按字符串展示。

## 命令

```bash
npm run dev           # tsx watch src/index.ts
npm run db:push       # prisma db push → SQLite
npm run db:seed       # prisma db seed
npm run db:studio     # prisma studio
```
