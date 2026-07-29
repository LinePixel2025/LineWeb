# AGENTS.md — LineWeb Client

React 19 + Vite 6 + TypeScript 前端。端口 5173，路由级代码分割，GitHub Primer 风格纯 CSS 设计系统。

## 目录结构

```
client/src/
├── App.tsx              # 路由中枢 — 6 层 Provider + 19 个 lazy() 页面
├── main.tsx             # ReactDOM.createRoot 入口
├── contexts/            # 6 个 Context（状态管理核心）
│   ├── AuthContext.tsx       # JWT 认证状态（user/loading/isAdmin/login/register/logout）
│   ├── WallpaperContext.tsx  # Bing 壁纸（依赖 AuthContext）
│   ├── ContrastContext.tsx   # 高对比度模式（依赖 WallpaperContext）
│   ├── DownloadContext.tsx   # 文件下载队列
│   └── DriveContext.tsx      # 网盘导航状态（365 行，useReducer）
├── components/          # 43 个组件
│   ├── Layout.tsx / AdminLayout.tsx  # 布局 + Navbar + Outlet
│   ├── Guards.tsx            # ProtectedRoute + AdminRoute
│   ├── Navbar.tsx / UserAvatar.tsx
│   ├── drive/               # 网盘 UI（20 组件，最大模块）— 见下方
│   ├── editor/              # Lexical 编辑器
│   ├── comments/            # CommentSection（树形回复）
│   ├── DigitalHealthCard/   # 屏幕时间卡片
│   └── admin/               # AdminMobileNav
├── pages/               # 19 个页面（全部 lazy()）
│   ├── HomePage / LoginPage / RegisterPage / PostsPage / PostPage
│   ├── ProfilePage / DrivePage / CalculatorPage / FeaturesPage
│   ├── DynamicPage / EditorPage / AdminPage
│   └── admin/              # 6 个管理页面（CommentAdmin/PageEditor/UserAdmin/ApiAdmin/DeviceMonitor/PageList）
├── hooks/               # useThumbnails / useKeyboardShortcuts / useDragAndDrop / useResponsive
├── lib/                 # api.ts（HTTP 客户端 + JWT + 401 处理）+ format.ts
├── styles/              # 7 个 CSS 文件（无 Tailwind，无 CSS-in-JS）
└── types/               # drive.ts + comment.ts
```

## 哪里找

| 任务 | 位置 | 说明 |
|------|------|------|
| 加新页面 | `pages/` 创建 → `App.tsx` 加 `lazy()` + Route | 公开页放 `<Layout>`，管理页放 `<AdminRoute><AdminLayout>` |
| 改认证/登录流 | `contexts/AuthContext.tsx` + `lib/api.ts` | api.ts 统一 401 处理 |
| 改路由守卫 | `components/Guards.tsx` | ProtectedRoute（需登录）/ AdminRoute（需 admin） |
| 加全局状态 | `contexts/` 新建 Context | 6 层 Provider 嵌套在 App.tsx |
| 加 API 调用 | `lib/api.ts` 已封装 get/post/put/del | 自动附 Bearer token，30s 超时 |
| 网盘功能 | `components/drive/` + `contexts/DriveContext.tsx` + `pages/DrivePage.tsx` | 双 reducer 架构 |
| 样式修改 | `styles/` 中对应 CSS 文件 | 普通 CSS，无 Tailwind |

## 认证流程

```
localStorage.lineweb_token → AuthContext 初始化时读 token → GET /api/auth/me 验证
→ 401 时 api.ts handleUnauthorized() 清 token + 跳 /login
→ ProtectedRoute 检查 user 是否存在 → 无则重定向 /login
→ AdminRoute 检查 isAdmin → 非 admin 重定向 /
```

**特殊**：`/login`、`/register`、`/auth/me` 路径不触发 401 重定向。

## Provider 嵌套顺序

```
BrowserRouter → AuthProvider → ThemeProvider → WallpaperProvider
→ DownloadProvider → Suspense → Routes
```

## Context 依赖图

```
AuthContext ← WallpaperContext ← ContrastContext
     ↓              ↓
ThemeContext    Layout/AdminLayout（读取主题和壁纸状态）
```

`DownloadContext` 和 `DriveContext` 独立。

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
- **仅 client 有测试**（13 个文件），server 无
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
