# AGENTS.md — LineWeb Client

React 19 + Vite 6 + TypeScript 前端。端口 5173，路由级代码分割，GitHub Primer 风格纯 CSS 设计系统。

## 目录结构

```
client/src/
├── App.tsx              # 路由中枢 — 多层 Provider + 22 个 lazy() 页面
├── main.tsx             # ReactDOM.createRoot 入口
├── contexts/            # 7 个 Context（状态管理核心）
│   ├── AuthContext.tsx       # 账号登录状态（user/loading/isAdmin/hasAdminAccess/can()/login/register/logout）
│   ├── ChatContext.tsx       # /ws/chat 连接、未读摘要、transport（ws/polling）
│   ├── GameContext.tsx       # 游戏邀请/对局、轮询 sync + presence
│   ├── WallpaperContext.tsx  # Bing 壁纸（依赖 AuthContext）
│   ├── ContrastContext.tsx   # 高对比度模式（依赖 WallpaperContext）
│   ├── DownloadContext.tsx   # 文件下载队列
│   └── DriveContext.tsx      # 网盘导航状态（365 行，useReducer）
├── components/          # 组件
│   ├── Layout.tsx / AdminLayout.tsx  # 布局 + Navbar + Outlet
│   ├── Guards.tsx            # ProtectedRoute + AdminRoute + AdminCapabilityRoute（按能力放行）
│   ├── Navbar.tsx / UserAvatar.tsx
│   ├── drive/               # 网盘 UI（20 组件，最大模块）— 见下方
│   ├── games/               # 游戏棋盘/好友邀请/对局面板/邀请弹窗
│   ├── editor/              # Lexical 编辑器
│   ├── comments/            # CommentSection（树形回复）
│   ├── DigitalHealthCard/   # 屏幕时间卡片
│   └── admin/               # AdminMobileNav
├── pages/               # 22 个页面（全部 lazy()）
│   ├── HomePage / LoginPage / RegisterPage / PostsPage / PostPage
│   ├── ProfilePage / DrivePage / CalculatorPage / FeaturesPage / GamesPage
│   ├── DynamicPage / EditorPage / AdminPage
│   ├── games/              # Game2048Page（单机）+ Game2048OnlinePage（联机）
│   └── admin/              # 6 个管理页面（CommentAdmin/PageEditor/UserAdmin/ApiDocs/DeviceMonitor/PageList）
├── hooks/               # useThumbnails / useKeyboardShortcuts / useDragAndDrop / useResponsive / useGame2048Input
├── lib/                 # api.ts + permissions.ts + format.ts + realtime.ts + games/（2048 引擎/目录）
├── styles/              # 11 个 CSS 文件（无 Tailwind，无 CSS-in-JS）
└── types/               # drive.ts + comment.ts + chat.ts + game.ts
```

## 哪里找

| 任务 | 位置 | 说明 |
|------|------|------|
| 加新页面 | `pages/` 创建 → `App.tsx` 加 `lazy()` + Route | 公开页放 `<Layout>`，管理页放 `<AdminRoute><AdminLayout>` |
| 改认证/登录流 | `contexts/AuthContext.tsx` + `lib/api.ts` | api.ts 统一 401 处理；登录返回的 `user.capabilities` 驱动 `can()` |
| 改路由守卫 | `components/Guards.tsx` + `lib/permissions.ts` | ProtectedRoute（需登录）/ AdminRoute（需任意管理能力）/ AdminCapabilityRoute（按当前路径所需能力，缺能力重定向到第一个可用管理页） |
| 加全局状态 | `contexts/` 新建 Context | 多层 Provider 嵌套在 App.tsx；注意 Chat → Game 依赖顺序 |
| 加 API 调用 | `lib/api.ts` 已封装 get/post/put/del | 自动附 Bearer token，30s 超时 |
| 网盘功能 | `components/drive/` + `contexts/DriveContext.tsx` + `pages/DrivePage.tsx` | 双 reducer 架构 |
| 游戏/2048 | `pages/GamesPage.tsx` + `pages/games/` + `components/games/` + `contexts/GameContext.tsx` + `lib/games/` | 单机纯前端引擎；联机 REST + `/ws/chat` 的 `game:*` 事件；无 WS 时按 `lib/realtime.ts` 轮询 |
| 实时传输降级 | `lib/realtime.ts` + `contexts/ChatContext.tsx` | `transport: 'ws' \| 'polling'`；WS 不支持/阻断/8 秒超时自动轮询；`?transport=polling` 强制 |
| 样式修改 | `styles/` 中对应 CSS 文件 | 普通 CSS，无 Tailwind |

## 认证流程

```
localStorage.lineweb_token（账号登录令牌）→ AuthContext 初始化时读 token → GET /api/auth/me
→ 401 时 api.ts handleUnauthorized() 清 token + 跳 /login
→ ProtectedRoute 检查 user 是否存在 → 无则重定向 /login
→ AdminRoute 检查 hasAdminAccess（user.capabilities 非空）→ 否则重定向 /
→ AdminCapabilityRoute 按当前路径所需能力（ADMIN_ROUTE_CAPABILITIES）放行，缺能力时送到该账号第一个可用管理页
→ 页面/侧边栏用 can('user:manage') 等能力判断可见性（admin 自动拥有全部能力）
```

**特殊**：`/login`、`/register`、`/auth/me` 路径不触发 401 重定向。能力常量与后端 `server/src/lib/permissions.ts` 一一对应。

## Provider 嵌套顺序

```
BrowserRouter → QueryClient → AuthProvider → ChatProvider → GameProvider
→ ThemeProvider → DownloadProvider → RouteErrorBoundary → Suspense → Routes
```

`ChatProvider` 负责 `/ws/chat`、未读摘要与 `transport`；`GameProvider` 依赖 `ChatProvider`，负责游戏邀请/对局与轮询降级。`GameInviteToast` 与 `DownloadToast` 渲染在 Routes 外。

## Context 依赖图

```
AuthContext ← ChatContext ← GameContext
     ↓              ↓
ThemeContext    Layout/AdminLayout（读取主题和壁纸状态）
```

`DownloadContext` 和 `DriveContext` 独立；`GameProvider` 必须在 `ChatProvider` 内。

## 数据获取模式

管理页面使用 `useState + useEffect + api.get/post/put/del` 手写模式，无 React Query。公开页面（PostPage、PostsPage、FeaturesPage、DynamicPage 等）通过 `src/hooks/useQueries.ts` 使用 React Query，含 `staleTime` 缓存配置。

```tsx
const [data, setData] = useState(null)
const [loading, setLoading] = useState(true)
useEffect(() => {
  api.get('/path').then(setData).catch(console.error).finally(() => setLoading(false))
}, [])
```

## 网盘模块（Drive）

**最大模块**：20 组件 + 2 Context + 4 hooks + 1 page (588行)

- **双 reducer 架构**：`DrivePage` 本地 `useReducer`（文件列表/加载/UI）+ `DriveContext` 全局 `useReducer`（导航/标签页/收藏/选择）
- **DriveSyncBridge** 桥接两个 reducer 的状态
- **无 WebSocket**：前端通过 REST API 操作文件；storage-node 在服务端
- **上传**：`XMLHttpRequest` + `FormData`（实时进度）
- **下载**：`fetch` + `ReadableStream` + `AbortController`
- **死代码**：`DriveSidebar.tsx` 和 `DriveContextMenu.tsx` 已定义未导入

## 测试

- Vitest + jsdom + `@testing-library/react`
- `src/test-setup.ts` → 仅 `import '@testing-library/jest-dom'`
- `__tests__/` 与源代码同目录
- **仅 client 有测试**（server 无）；新增游戏引擎/传输模式/大厅测试，运行 `npm run test`
- 其中 `lib/__tests__/permissions.test.ts` 会读取 `server/src/lib/permissions.ts` 源码做前后端能力清单一致性断言（需要 `client/src/types/node-builtins.d.ts` 提供最小 node:fs 类型声明）
- 无 MSW，全部用 `vi.mock()` 模拟 API
- `npm run test` 在 client/ 目录下运行

## 反模式 / 注意事项

- **`@/` 别名未普及**：仅 `DigitalHealthCard` 和 `DigitalHealthSection` 使用，其余用相对导入
- **`DriveSidebar.tsx` + `DriveContextMenu.tsx`**：死代码
- **PageEditor.tsx (733行)**：超大，拖拽式控件树编辑器
- **DrivePage.tsx (588行)**：超大，双 reducer + 所有子组件协调
- **裸 catch {}**：多处 API 调用静默吞错
- **console.log**：client src 中无（全在 server）
- **CommentSection 懒加载**：PostPage 中使用 `React.lazy` 加载，减少初始 chunk 大小

## 命令

```bash
npm run dev         # vite（端口 5173）
npm run build       # tsc -b && vite build
npm run test        # vitest run
npm run test:watch  # vitest
```
