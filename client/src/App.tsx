import { Component, lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ChatProvider } from './contexts/ChatContext'
import { GameProvider } from './contexts/GameContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { DownloadProvider } from './contexts/DownloadContext'
import Layout from './components/Layout'
import { ProtectedRoute, AdminRoute } from './components/Guards'
import DownloadToast from './components/drive/DownloadToast'
import GameInviteToast from './components/games/GameInviteToast'

// 路由级代码分割 — 所有页面和布局懒加载，减少首屏包体积
const HomePage = lazy(() => import('./pages/HomePage'))
const AdminLayout = lazy(() => import('./components/AdminLayout'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const PostsPage = lazy(() => import('./pages/PostsPage'))
const PostPage = lazy(() => import('./pages/PostPage'))
const CalculatorPage = lazy(() => import('./pages/CalculatorPage'))
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'))
const GamesPage = lazy(() => import('./pages/GamesPage'))
const Game2048Page = lazy(() => import('./pages/games/Game2048Page'))
const Game2048OnlinePage = lazy(() => import('./pages/games/Game2048OnlinePage'))
const DoudizhuPage = lazy(() => import('./pages/games/DoudizhuPage'))
const DoudizhuOnlinePage = lazy(() => import('./pages/games/DoudizhuOnlinePage'))
const SnakePage = lazy(() => import('./pages/games/SnakePage'))
const SnakeOnlinePage = lazy(() => import('./pages/games/SnakeOnlinePage'))
const MinesweeperPage = lazy(() => import('./pages/games/MinesweeperPage'))
const MinesweeperOnlinePage = lazy(() => import('./pages/games/MinesweeperOnlinePage'))
const JumpPage = lazy(() => import('./pages/games/JumpPage'))
const JumpOnlinePage = lazy(() => import('./pages/games/JumpOnlinePage'))
const MinecraftPage = lazy(() => import('./pages/games/MinecraftPage'))
const MinecraftOnlinePage = lazy(() => import('./pages/games/MinecraftOnlinePage'))
const GomokuPage = lazy(() => import('./pages/games/GomokuPage'))
const GomokuOnlinePage = lazy(() => import('./pages/games/GomokuOnlinePage'))
const LiarPage = lazy(() => import('./pages/games/LiarPage'))
const LiarOnlinePage = lazy(() => import('./pages/games/LiarOnlinePage'))
const UnoPage = lazy(() => import('./pages/games/UnoPage'))
const UnoOnlinePage = lazy(() => import('./pages/games/UnoOnlinePage'))
const XiangqiPage = lazy(() => import('./pages/games/XiangqiPage'))
const XiangqiOnlinePage = lazy(() => import('./pages/games/XiangqiOnlinePage'))
const DeepSeekChatPage = lazy(() => import('./pages/DeepSeekChatPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const DynamicPage = lazy(() => import('./pages/DynamicPage'))
const DrivePage = lazy(() => import('./pages/DrivePage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const EditorPage = lazy(() => import('./pages/EditorPage'))
const CommentAdminPage = lazy(() => import('./pages/admin/CommentAdminPage'))
const PageList = lazy(() => import('./pages/admin/PageList'))
const PageEditor = lazy(() => import('./pages/admin/PageEditor'))
const UserAdminPage = lazy(() => import('./pages/admin/UserAdminPage'))
const ApiDocsPage = lazy(() => import('./pages/admin/ApiDocsPage'))
const DeviceMonitorPage = lazy(() => import('./pages/admin/DeviceMonitorPage'))
const AiAdminPage = lazy(() => import('./pages/admin/AiAdminPage'))
const AiChatAdminPage = lazy(() => import('./pages/admin/AiChatAdminPage'))
const AppAdminPage = lazy(() => import('./pages/admin/AppAdminPage'))
const AuthorizePage = lazy(() => import('./pages/AuthorizePage'))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 30 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function RouteLoading() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="gh-spinner" />
    </div>
  )
}

interface RouteErrorBoundaryState {
  error: Error | null
}

class RouteErrorBoundary extends Component<{ children: ReactNode }, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main className="gh-route-error" role="alert">
        <div className="gh-route-error-card">
          <p className="gh-route-error-eyebrow">页面加载失败</p>
          <h1 className="gh-route-error-title">暂时无法打开这个页面</h1>
          <p className="gh-route-error-message">请重新加载页面。若问题持续，请先重启开发服务或清理浏览器缓存。</p>
          <button className="gh-btn gh-btn--primary" onClick={() => window.location.reload()}>
            重新加载
          </button>
        </div>
      </main>
    )
  }
}

export default function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ChatProvider>
        <GameProvider>
        <ThemeProvider>
          <DownloadProvider>
              <RouteErrorBoundary>
                <Suspense fallback={<RouteLoading />}>
                  <Routes>
                  {/* Main site layout */}
                  <Route element={<Layout />}>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/posts" element={<PostsPage />} />
                    <Route path="/posts/:slug" element={<PostPage />} />
                    <Route path="/features" element={<FeaturesPage />} />
                    <Route path="/calculator" element={<CalculatorPage />} />
                    <Route path="/games" element={<GamesPage />} />
                    <Route path="/games/2048" element={<Game2048Page />} />
                    <Route path="/games/2048/online" element={
                      <ProtectedRoute><Game2048OnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/2048/online/:matchId" element={
                      <ProtectedRoute><Game2048OnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/doudizhu" element={<DoudizhuPage />} />
                    <Route path="/games/doudizhu/online" element={
                      <ProtectedRoute><DoudizhuOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/doudizhu/online/:matchId" element={
                      <ProtectedRoute><DoudizhuOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/snake" element={<SnakePage />} />
                    <Route path="/games/snake/online" element={
                      <ProtectedRoute><SnakeOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/snake/online/:matchId" element={
                      <ProtectedRoute><SnakeOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/minesweeper" element={<MinesweeperPage />} />
                    <Route path="/games/minesweeper/online" element={
                      <ProtectedRoute><MinesweeperOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/minesweeper/online/:matchId" element={
                      <ProtectedRoute><MinesweeperOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/jump" element={<JumpPage />} />
                    <Route path="/games/jump/online" element={
                      <ProtectedRoute><JumpOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/jump/online/:matchId" element={
                      <ProtectedRoute><JumpOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/minecraft" element={<MinecraftPage />} />
                    <Route path="/games/minecraft/online" element={
                      <ProtectedRoute><MinecraftOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/minecraft/online/:matchId" element={
                      <ProtectedRoute><MinecraftOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/gomoku" element={<GomokuPage />} />
                    <Route path="/games/gomoku/online" element={
                      <ProtectedRoute><GomokuOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/gomoku/online/:matchId" element={
                      <ProtectedRoute><GomokuOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/liar" element={<LiarPage />} />
                    <Route path="/games/liar/online" element={
                      <ProtectedRoute><LiarOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/liar/online/:matchId" element={
                      <ProtectedRoute><LiarOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/uno" element={<UnoPage />} />
                    <Route path="/games/uno/online" element={
                      <ProtectedRoute><UnoOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/uno/online/:matchId" element={
                      <ProtectedRoute><UnoOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/xiangqi" element={<XiangqiPage />} />
                    <Route path="/games/xiangqi/online" element={
                      <ProtectedRoute><XiangqiOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/games/xiangqi/online/:matchId" element={
                      <ProtectedRoute><XiangqiOnlinePage /></ProtectedRoute>
                    } />
                    <Route path="/profile" element={
                      <ProtectedRoute><ProfilePage /></ProtectedRoute>
                    } />
                    <Route path="/page/:slug" element={<DynamicPage />} />
                    <Route path="/drive" element={
                      <ProtectedRoute><DrivePage /></ProtectedRoute>
                    } />
                    <Route path="/chat" element={
                      <ProtectedRoute><ChatPage /></ProtectedRoute>
                    } />
                    <Route path="/chat/:conversationId" element={
                      <ProtectedRoute><ChatPage /></ProtectedRoute>
                    } />
                    {/* DeepSeek 对话（站内统一代理 AI 服务，需登录；每日提问上限见 /admin/ai-chat） */}
                    <Route path="/deepseek" element={
                      <ProtectedRoute><DeepSeekChatPage /></ProtectedRoute>
                    } />
                    {/* 第三方应用授权的账户验证页（未登录会跳登录并带参数返回） */}
                    <Route path="/authorize" element={
                      <ProtectedRoute><AuthorizePage /></ProtectedRoute>
                    } />
                  </Route>

                  {/* Admin layout — separate from main site */}
                  <Route element={<AdminRoute><AdminLayout /></AdminRoute>}>
                    <Route path="/admin" element={<AdminPage />} />
                    <Route path="/admin/new" element={<EditorPage />} />
                    <Route path="/admin/edit/:id" element={<EditorPage />} />
                    <Route path="/admin/comments" element={<CommentAdminPage />} />
                    <Route path="/admin/pages" element={<PageList />} />
                    <Route path="/admin/pages/new" element={<PageEditor />} />
                    <Route path="/admin/pages/:id/edit" element={<PageEditor />} />
                    <Route path="/admin/users" element={<UserAdminPage />} />
                    <Route path="/admin/api" element={<ApiDocsPage />} />
                    <Route path="/admin/devices" element={<DeviceMonitorPage />} />
                    <Route path="/admin/ai" element={<AiAdminPage />} />
                    <Route path="/admin/ai-chat" element={<AiChatAdminPage />} />
                    <Route path="/admin/apps" element={<AppAdminPage />} />
                  </Route>
                  </Routes>
                </Suspense>
              </RouteErrorBoundary>

              {/* 下载进度弹窗 — 放在 Routes 外层，不随页面切换卸载 */}
              <DownloadToast />
              {/* 游戏邀请/开局提示 — 全局监听，任意页面可接收好友邀请 */}
              <GameInviteToast />
            </DownloadProvider>
        </ThemeProvider>
        </GameProvider>
        </ChatProvider>
      </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  )
}
