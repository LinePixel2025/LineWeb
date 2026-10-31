# 个人空间 API（Personal Space）

> 路由：`server/src/routes/personalSpace.ts`
> 页面：`client/src/pages/PersonalSpacePage.tsx`（`/personal-space`）
> 能力：`personal:manage`（仅 admin 角色，见 `server/src/lib/permissions.ts`）

## 概述

个人空间是**仅管理员可进**的私人页面，用于承载管理员私人服务；每个管理员的数据互相隔离（`PersonalSpace.userId @unique`，一管理员一行）。首个私人服务为 **RustDesk 远程桌面**（配置卡片 + 快捷连接）：

- 保存 RustDesk 服务端信息：ID 服务器 / 中继服务器 / 公钥 Key / Web 客户端地址（均可选）。
- 配置一键复制、打开 Web 客户端、输入被控 ID 生成 `rustdesk://connection/new/<id>` 深链唤起本机客户端。

## 权限口径

- 全部端点挂 `requireCapability('personal:manage')`（读认证阶段解析好的 `req.user.capabilities`），admin 自动全权，非管理员 403。
- 第三方应用令牌不在 appScopes 端点白名单内，天然 403。
- 不挂 FeatureFlag（纯管理员页面，管理员天然绕过功能开关）、不挂额外限流（全局限流已覆盖，写操作极低频）。

## 数据模型（`server/prisma/schema.prisma`）

`PersonalSpace` → 表 `personal_spaces`（additive，`prisma db push` 即可）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `userId` | Int @unique | 属主管理员（User 反向关系 `personalSpace`，`onDelete: Cascade`） |
| `spaceName` | String，默认 `个人空间` | 空间名；API 首次访问自动创建时取 `<用户名> 的私人空间` |
| `rustdeskIdServer` | String? | RustDesk ID 服务器 |
| `rustdeskRelayServer` | String? | RustDesk 中继服务器 |
| `rustdeskKey` | String? | RustDesk 公钥 Key |
| `rustdeskWebClient` | String? | RustDesk Web 客户端地址（http/https） |

## 端点

### GET /api/personal-space

返回当前登录管理员的个人空间；不存在则自动创建默认行（`spaceName = <用户名> 的私人空间`）。

### PUT /api/personal-space

更新空间名与 RustDesk 配置，返回更新后的 DTO。请求体：

```json
{
  "spaceName": "我的私人空间",
  "rustdeskIdServer": "rustdesk.example.com:21116",
  "rustdeskRelayServer": "rustdesk.example.com:21117",
  "rustdeskKey": "OeVuKk5nlHiXp+8NqP6HhcW1mkAg2rcXScVLNTK5K0o=",
  "rustdeskWebClient": "https://rustdesk.example.com"
}
```

校验规则（不通过返回 400）：

- `spaceName`：trim 后 1–30 字符。
- RustDesk 四个字段：均可选，trim 后各 ≤200 字符，空串表示清除（落库为 NULL）。
- `rustdeskWebClient`：非空时必须以 `http://` 或 `https://` 开头（该地址会以新窗口打开，防止 `javascript:` 注入）。

> **整体保存语义**：PUT 会用请求体整体覆盖该管理员的配置，未传（省略）的可选 RustDesk 字段等同空串，同样会被清除；页面自身永远全量传参，不受影响。

## DTO

```json
{
  "id": 1,
  "spaceName": "admin 的私人空间",
  "rustdeskIdServer": "rustdesk.example.com:21116",
  "rustdeskRelayServer": "rustdesk.example.com:21117",
  "rustdeskKey": "OeVuKk5nlHiXp+8NqP6HhcW1mkAg2rcXScVLNTK5K0o=",
  "rustdeskWebClient": "https://rustdesk.example.com",
  "createdAt": "2026-10-31T00:00:00.000Z",
  "updatedAt": "2026-10-31T00:00:00.000Z"
}
```

未配置的可空字段在 DTO 中统一输出为空字符串 `""`，前端输入框可直接绑定；提交时空串写回 NULL。

## 错误码

| 状态 | 场景 |
| --- | --- |
| 401 | 未登录 / 令牌失效 |
| 403 | 非管理员（无 `personal:manage` 能力）或应用令牌访问 |
| 400 | 入参校验失败（空间名超长、Web 地址非 http/https 等） |
