# LineWeb 功能开关 API

> 服务端实现：`server/src/lib/features.ts`、`services/featureService.ts`、`middleware/featureGuard.ts`、`routes/features.ts`
> 前端实现：`client/src/lib/features.ts`、`contexts/FeatureContext.tsx`、`components/Guards.tsx`、`pages/admin/FeatureAdminPage.tsx`

## 1. 语义

- 模块级全局开关；缺失 key 默认开启。
- 管理员（`role === 'admin'`）和被关闭功能的管理员入口始终可用。
- 普通用户：客户端隐藏入口 + 服务端返回 `403 { error: '该功能已关闭', code: 'FEATURE_DISABLED', feature: '<key>' }`。
- 纯前端功能（计算器、单机游戏）没有服务端 API，只能由前端 `RequireFeature` 拦截；文档中需明确。

## 2. 开关键

`posts`、`comments`、`pages`、`drive`、`chat`、`games`、`gamesSingle`、`gamesOnline`、`aiAssistant`、`aiChat`、`webProxy`、`calculator`、`oauthApps`、`registration`。

`gamesSingle` / `gamesOnline` 的生效值 = `games && 自身开关`。

## 3. 端点

- `GET /api/features`（公开）：`{ features: Record<key, boolean> }`
- `GET /api/admin/features`（`feature:manage`）：`{ features, definitions }`
- `PUT /api/admin/features/:key`（`feature:manage`）：`{ enabled: boolean }`

开关持久化到 `FeatureFlag` 表（`key` 主键、`enabled`、`updatedBy`、`updatedAt`），服务端 5 秒内存缓存，写入后立即失效。
