# LineWeb 项目优化总结

> **日期**：2026-07-05
> **范围**：P0-P3 全优先级性能/安全/移动端/动画优化
> **状态**：✅ 全部完成，TypeScript + Vite 构建通过

---

## 摘要

通过双 search agent 对 30+ 文件的核查与逐项实施，共完成 **26 项优化任务**，涵盖性能、安全、移动端适配、动画合成器线程优化、内存泄漏修复、Prisma 索引与外键约束等方面。所有改动均通过 `tsc --noEmit` 与 `vite build` 验证。

---

## P0 — 已在 v1 阶段完成（基线）

| 项 | 文件 | 说明 |
|---|---|---|
| helmet/CSP | `server/src/index.ts` | 安全 HTTP 头 |
| compression | `server/src/index.ts` | gzip 压缩 |
| rateLimit | `server/src/index.ts` | 限流 |
| 优雅停机 | `server/src/index.ts` | SIGTERM 处理 |
| SSRF 白名单 | `server/src/routes/bing.ts` | IP 校验 |
| 所有权校验 | `server/src/routes/drive.ts` | `assertFileOwnership` |
| lazy loading | `client/src/App.tsx` | 18 页全部 lazy + Suspense |
| 移动端 backdrop-filter 降级 | `client/src/styles/globals.css` | 768px 媒体查询 |
| ContrastContext 视口扫描 | `client/src/contexts/ContrastContext.tsx` | 200ms 节流 + RAF |

---

## P1 — 性能/安全关键（12 项）

### 2.1 AuthContext value 记忆化
**文件**：`client/src/contexts/AuthContext.tsx`
- `login`/`register`/`logout`/`updateSettings` 用 `useCallback` 包裹
- `value` 用 `useMemo` 包裹，依赖 `[user, loading, login, register, logout, isAdmin, updateSettings]`
- 避免父组件 state 变化导致所有消费者重渲染

### 2.2 DownloadContext value 记忆化
**文件**：`client/src/contexts/DownloadContext.tsx`
- `value` 用 `useMemo` 包裹，依赖 `[tasks, startDownload, cancelDownload]`

### 2.3 PostPage XSS 防护
**文件**：`client/src/pages/PostPage.tsx`
- 引入 `dompurify`，`dangerouslySetInnerHTML` 前 `DOMPurify.sanitize(post.content, { USE_PROFILES: { html: true } })`

### 2.4 LiquidGlass 鼠标跟随改用 CSS 变量
**文件**：`client/src/components/glass/LiquidGlass.tsx` + `client/src/styles/globals.css`
- 鼠标移动时 `setProperty('--lg-specular-x', ...)` 替代字符串拼接
- `radial-gradient(circle at var(--lg-specular-x, 30%) var(--lg-specular-y, 20%), ...)`

### 2.5 移除壁纸 `?_t` 缓存破坏参数
**文件**：`client/src/contexts/WallpaperContext.tsx`
- 删除 `?_t=${Date.now()}`，直接 `setBgUrl(data.url)`
- 避免每次切换壁纸重新下载

### 2.6 移动端触摸目标 44px
**文件**：`client/src/styles/globals.css`
- `@media (hover: none) and (pointer: coarse)` 块中 `.lex-btn`/`.pagination-btn`/`.posts-search-submit`/`.admin-page-btn`/`.page-editor-canvas-item-tool-btn`/`.drive-view-toggle` 全部 44×44px

### 2.7 hover 守卫
**文件**：`client/src/styles/globals.css`
- 5 个 `:hover` 规则移入 `@media (hover: hover) { ... }`，避免触屏设备 hover 卡死

### 2.8 viewport dvh 回退
**文件**：`client/src/styles/globals.css`
- `.page`/`.admin-layout`/`.page-editor`/`.preview-container` 等加 `100dvh`/`85dvh` 第二声明（渐进增强）

### 2.9 API Key sha256 哈希存储
**文件**：`server/prisma/schema.prisma` + `server/src/routes/apiKeys.ts` + `server/src/middleware/auth.ts`
- ApiKey 模型新增 `keyHash String @unique`，`key` 字段仅存掩码
- 创建时 `keyHash = sha256(fullKey)`，认证时 `where: { keyHash: hashApiKey(apiKey) }`
- 全文 key 仅创建时返回一次

### 2.10 JWT 失效机制（DB 校验 + 60s 缓存）
**文件**：`server/prisma/schema.prisma` + `server/src/middleware/auth.ts` + `server/src/services/authService.ts` + `server/src/routes/auth.ts`
- User 模型新增 `tokenValidAfter DateTime @default(now())`
- `authenticate` 校验 `payload.iat * 1000 < validAfter.getTime()` → 401
- 60s 内存缓存 `tokenValidAfterCache` 避免每请求查 DB
- 新增 `/logout` 端点调用 `invalidateUserTokens` + `clearTokenValidAfterCache`

### 2.11 storageTunnel streamWrite 错误处理
**文件**：`server/src/services/storageTunnel.ts`
- init 命令 `await sendCommand(initCmd)` 等待 ack
- 每个 chunk 包 try/catch + `cleanupTempFile()`
- 移除 50ms 固定 sleep
- 整体 try/catch 失败时清理 `.tmp` 残片

### 2.12 transition: all → 具体属性
**文件**：`client/src/styles/globals.css`
- 5 处 `transition: all` 改为 `background-color, color, transform, border-color` 等具体属性

---

## P2 — 中优先级（9 项）

### 3.1 box-shadow 动画改用合成器线程
**文件**：`client/src/styles/globals.css`
- `adminRefreshPulse` 改为 `::after` 伪元素叠加静态 `box-shadow` + `opacity` 切换
- `@keyframes adminRefreshPulse { 0%, 100% { opacity: 0 } 50% { opacity: 1 } }`

### 3.2 touch-action + overscroll-behavior
**文件**：`client/src/styles/globals.css`
- `body { overscroll-behavior: none; }`
- `button, [role="button"], .liquid-btn, .lex-btn { touch-action: manipulation; }`
- `.upload-zone-drop { touch-action: none; }`
- `.drive-toolbar-breadcrumbs { touch-action: pan-x; }`
- 滚动容器 `overscroll-behavior: contain` + `will-change: scroll-position`

### 3.3 Comment 组件 memo 化
**文件**：`client/src/components/comments/CommentSection.tsx`
- `CollapsibleContent`/`ReplyForm`/`CommentCard` 用 `memo()` 包裹
- `fetchComments`/`handleSubmit`/`handleReplyAdded` 用 `useCallback`
- `useEffect` 依赖修正为 `[postId, fetchComments]`

### 3.4 api.ts 增强
**文件**：`client/src/lib/api.ts` + `client/src/contexts/AuthContext.tsx`
- 默认 30s 超时（`AbortController` + `setTimeout`）
- 401 自动登出（清 token + 跳 `/login`，auth 端点豁免避免死循环）
- 模块级 `cachedToken` + `setToken()` 同步缓存，避免每请求读 localStorage

### 3.5 stats 路由 60s 缓存
**文件**：`server/src/routes/stats.ts`
- 模块级 `statsCache: { data, expireAt }`，TTL 60s
- `Cache-Control: private, max-age=60` 响应头
- 11 个并发 prisma 查询结果命中缓存直接返回

### 3.6 Prisma 索引
**文件**：`server/prisma/schema.prisma`
- Post: `@@index([authorId])`
- Comment: `@@index([postId])` + `@@index([authorId])` + `@@index([parentId])`
- DriveFile: `@@index([parentId])` + `@@index([uploadedById])`
- ApiKey: `@@index([userId])`

### 3.7 外键 onDelete 配置
**文件**：`server/prisma/schema.prisma`
- Post.author → User: `onDelete: Cascade`
- Comment.author → User: `onDelete: SetNull`（authorId 改为 `Int?`）
- DriveFile.uploadedBy → User: `onDelete: SetNull`（uploadedById 改为 `Int?`）
- ApiKey.user → User: `onDelete: Cascade`

### 3.8 errorHandler Prisma 错误细化
**文件**：`server/src/middleware/errorHandler.ts`
- `P2002` → 409 唯一约束冲突
- `P2025` → 404 记录不存在
- `P2003` → 400 外键约束失败
- `P2014` → 400 无效的关联 ID

### 3.9 DownloadContext 流式下载（跳过 — 标记为可选）
**决策**：File System Access API 兼容性有限 + 实现复杂度高，当前 Blob 方案功能正常，按计划决策跳过。

---

## P3 — 低优先级（4 项）

### 4.1 deviceTracker 内存泄漏修复
**文件**：`server/src/services/deviceTracker.ts`
- `pathsAccessed` 上限 100（超过 `shift()`）
- `devices` Map 上限 1000（LRU 淘汰 `lastSeen` 最旧）
- `cleanupTimer.unref()` 不阻止 Node 退出

### 4.2 useResponsive 改用 matchMedia
**文件**：`client/src/hooks/useResponsive.ts`
- 完整重写为 `window.matchMedia('(max-width: 480px)')` + `addEventListener('change')`
- 替代 `resize` 事件轮询，SSR 安全

### 4.3 AdminLayout 壁纸刷新 setTimeout 修复
**文件**：`client/src/components/AdminLayout.tsx`
- `setTimeout(() => setRefreshing(false), 1000)` 改为 `try { await refresh() } finally { setRefreshing(false) }`
- refresh 失败时 spinner 不再假装完成

### 4.4 BigInt 序列化优化
**文件**：`server/src/lib/prisma.ts` + `server/src/routes/drive.ts` + `client/src/types/drive.ts`
- 移除全局 `BigInt.prototype.toJSON` 原型污染
- 新增 `transformSize<T extends { size: bigint }>(file)` 在 6 个返回点显式转换
- 前端 `DriveItem.size: number → string`，显示处用 `Number(item.size)`

---

## 验证结果

```bash
cd server && npx tsc --noEmit   # ✅ exit 0
cd client && npx tsc --noEmit   # ✅ exit 0
cd client && npx vite build     # ✅ 139 modules, 2.46s
```

---

## 文件改动统计

**共修改 ~20 个文件**：
- 前端：`AuthContext.tsx`、`DownloadContext.tsx`、`WallpaperContext.tsx`、`AdminLayout.tsx`、`CommentSection.tsx`、`LiquidGlass.tsx`、`PostPage.tsx`、`api.ts`、`useResponsive.ts`、`globals.css`、`types/drive.ts`、`App.tsx`、`index.html`、`ContrastContext.tsx`、`EditorToolbar.tsx`
- 后端：`index.ts`、`auth.ts`、`apiKeys.ts`、`authService.ts`、`drive.ts`、`users.ts`、`bing.ts`、`stats.ts`、`storageTunnel.ts`、`deviceTracker.ts`、`errorHandler.ts`、`prisma.ts`、`schema.prisma`、`package.json`

---

## 后续建议

1. **端到端测试**：`npm run dev` 启动后验证：
   - 评论输入时 CommentCard 不再重渲染（DevTools Performance）
   - dashboard 60s 内重复打开只查一次 DB
   - 触发 Prisma 唯一约束冲突返回 409
   - 移动端模拟器滚动到页面边界不再链式滚动
   - 登出后旧 token 立即 401
2. **API Key 历史数据迁移**：现有 ApiKey 表中 `keyHash` 为空，需写迁移脚本为每个现有 key 生成 `keyHash = sha256(key)`（如需保留）
3. **DownloadContext 流式下载**：若后续需支持超大文件，可单独评估 File System Access API 实现
