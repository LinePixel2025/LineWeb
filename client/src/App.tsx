import { Component, lazy, Suspense, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { FeatureProvider } from './contexts/FeatureContext'
import { PointsProvider } from './contexts/PointsContext'
import { GameStatsProvider } from './contexts/GameStatsContext'
import { ChatProvider } from './contexts/ChatContext'
import { XmppChatProvider } from './contexts/XmppChatContext'
import { GameProvider } from './contexts/GameContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { DownloadProvider } from './contexts/DownloadContext'
import { MusicProvider } from './contexts/MusicPlayerContext'
import Layout from './components/Layout'
import { ProtectedRoute, AdminRoute, RequireAuth, RequireFeature } from './components/Guards'
import DownloadToast from './components/drive/DownloadToast'
import GameInviteToast from './components/games/GameInviteToast'
import ChatMessageToast from './components/chat/ChatMessageToast'
import MusicPlayerBar from './components/music/MusicPlayerBar'

// 路由级代码分割 — 所有页面和布局懒加载，减少首屏包体积
const HomePage = lazy(() => import('./pages/HomePage'))
const AdminLayout = lazy(() => import('./components/AdminLayout'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const PostsPage = lazy(() => import('./pages/PostsPage'))
const PostPage = lazy(() => import('./pages/PostPage'))
const CalculatorPage = lazy(() => import('./pages/CalculatorPage'))
const StocksPage = lazy(() => import('./pages/StocksPage'))
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'))
const GamesPage = lazy(() => import('./pages/GamesPage'))
const GameLeaderboardPage = lazy(() => import('./pages/games/GameLeaderboardPage'))
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
const ParkourPage = lazy(() => import('./pages/games/ParkourPage'))
const ParkourOnlinePage = lazy(() => import('./pages/games/ParkourOnlinePage'))
const FarmPage = lazy(() => import('./pages/games/FarmPage'))
const PetsPage = lazy(() => import('./pages/PetsPage'))
const PointsPage = lazy(() => import('./pages/PointsPage'))
const DeepSeekChatPage = lazy(() => import('./pages/DeepSeekChatPage'))
const WebProxyPage = lazy(() => import('./pages/WebProxyPage'))
const WebProxyViewPage = lazy(() => import('./pages/WebProxyViewPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const DynamicPage = lazy(() => import('./pages/DynamicPage'))
const DrivePage = lazy(() => import('./pages/DrivePage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const EditorPage = lazy(() => import('./pages/EditorPage'))
const PageEditor = lazy(() => import('./pages/admin/PageEditor'))
// 合并后的管理页（Tab 容器）+ 保留的独立管理页
const ContentAdminPage = lazy(() => import('./pages/admin/ContentAdminPage'))
const UserDeviceAdminPage = lazy(() => import('./pages/admin/UserDeviceAdminPage'))
const AiSettingsAdminPage = lazy(() => import('./pages/admin/AiSettingsAdminPage'))
const ApiDocsPage = lazy(() => import('./pages/admin/ApiDocsPage'))
const AppAdminPage = lazy(() => import('./pages/admin/AppAdminPage'))
const ProxyAdminPage = lazy(() => import('./pages/admin/ProxyAdminPage'))
const FeatureAdminPage = lazy(() => import('./pages/admin/FeatureAdminPage'))
const PointsAdminPage = lazy(() => import('./pages/admin/PointsAdminPage'))
const ChatAdminPage = lazy(() => import('./pages/admin/ChatAdminPage'))
const PersonalSpacePage = lazy(() => import('./pages/PersonalSpacePage'))
const AuthorizePage = lazy(() => import('./pages/AuthorizePage'))
const ReaderPage = lazy(() => import('./pages/ReaderPage'))
const ReaderBookPage = lazy(() => import('./pages/ReaderBookPage'))
const MusicPage = lazy(() => import('./pages/MusicPage'))

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

/** 登出/换号时清空 React Query 缓存，避免上一个账号的数据串号 */
function AuthCacheReset() {
  const { user } = useAuth()
  useEffect(() => {
    if (!user) queryClient.clear()
  }, [user])
  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthCacheReset />
        <FeatureProvider>
        <PointsProvider>
        <GameStatsProvider>
        <ChatProvider>
        <XmppChatProvider>
        <GameProvider>
        <ThemeProvider>
          <DownloadProvider>
              <MusicProvider>
              <RouteErrorBoundary>
                <Suspense fallback={<RouteLoading />}>
                  <Routes>
                  {/* Main site layout */}
                  <Route element={<Layout />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route element={<RequireAuth />}>
                      <Route path="/" element={<HomePage />} />
                      <Route element={<RequireFeature feature="posts" />}>
                        <Route path="/posts" element={<PostsPage />} />
                        <Route path="/posts/:slug" element={<PostPage />} />
                      </Route>
                      <Route element={<RequireFeature feature="pages" />}>
                        <Route path="/features" element={<FeaturesPage />} />
                        <Route path="/page/:slug" element={<DynamicPage />} />
                      </Route>
                      <Route element={<RequireFeature feature="calculator" />}>
                        <Route path="/calculator" element={<CalculatorPage />} />
                      </Route>
                      {/* 模拟股市：虚构行情 + 积分投资，进入前弹窗提示 */}
                      <Route element={<RequireFeature feature="stock" />}>
                        <Route path="/stocks" element={
                          <ProtectedRoute><StocksPage /></ProtectedRoute>
                        } />
                      </Route>
                      {/* 宠物：花积分召唤并照顾一只 2D 小宠物（需登录） */}
                      <Route element={<RequireFeature feature="pet" />}>
                        <Route path="/pets" element={<PetsPage />} />
                      </Route>
                      {/* 小说阅读器：上传 EPUB/TXT 在线阅读，进度多端同步（需登录） */}
                      <Route element={<RequireFeature feature="reader" />}>
                        <Route path="/reader" element={
                          <ProtectedRoute><ReaderPage /></ProtectedRoute>
                        } />
                        <Route path="/reader/:bookId" element={
                          <ProtectedRoute><ReaderBookPage /></ProtectedRoute>
                        } />
                      </Route>
                      {/* 网易云音乐：扫码绑定个人账号，搜索与播放（需登录） */}
                      <Route element={<RequireFeature feature="music" />}>
                        <Route path="/music" element={
                          <ProtectedRoute><MusicPage /></ProtectedRoute>
                        } />
                      </Route>
                      <Route element={<RequireFeature feature="games" />}>
                        <Route path="/games" element={<GamesPage />} />
                        <Route path="/games/leaderboard" element={<GameLeaderboardPage />} />
                        <Route element={<RequireFeature feature="farm" />}>
                          <Route path="/games/farm" element={<FarmPage />} />
                        </Route>
                        <Route element={<RequireFeature feature="gamesSingle" />}>
                          <Route path="/games/2048" element={<Game2048Page />} />
                          <Route path="/games/doudizhu" element={<DoudizhuPage />} />
                          <Route path="/games/snake" element={<SnakePage />} />
                          <Route path="/games/minesweeper" element={<MinesweeperPage />} />
                          <Route path="/games/jump" element={<JumpPage />} />
                          <Route path="/games/minecraft" element={<MinecraftPage />} />
                          <Route path="/games/gomoku" element={<GomokuPage />} />
                          <Route path="/games/liar" element={<LiarPage />} />
                          <Route path="/games/uno" element={<UnoPage />} />
                          <Route path="/games/xiangqi" element={<XiangqiPage />} />
                          <Route path="/games/parkour" element={<ParkourPage />} />
                        </Route>
                        <Route element={<RequireFeature feature="gamesOnline" />}>
                          <Route path="/games/2048/online" element={
                            <ProtectedRoute><Game2048OnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/2048/online/:matchId" element={
                            <ProtectedRoute><Game2048OnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/doudizhu/online" element={
                            <ProtectedRoute><DoudizhuOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/doudizhu/online/:matchId" element={
                            <ProtectedRoute><DoudizhuOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/snake/online" element={
                            <ProtectedRoute><SnakeOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/snake/online/:matchId" element={
                            <ProtectedRoute><SnakeOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/minesweeper/online" element={
                            <ProtectedRoute><MinesweeperOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/minesweeper/online/:matchId" element={
                            <ProtectedRoute><MinesweeperOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/jump/online" element={
                            <ProtectedRoute><JumpOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/jump/online/:matchId" element={
                            <ProtectedRoute><JumpOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/minecraft/online" element={
                            <ProtectedRoute><MinecraftOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/minecraft/online/:matchId" element={
                            <ProtectedRoute><MinecraftOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/gomoku/online" element={
                            <ProtectedRoute><GomokuOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/gomoku/online/:matchId" element={
                            <ProtectedRoute><GomokuOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/liar/online" element={
                            <ProtectedRoute><LiarOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/liar/online/:matchId" element={
                            <ProtectedRoute><LiarOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/uno/online" element={
                            <ProtectedRoute><UnoOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/uno/online/:matchId" element={
                            <ProtectedRoute><UnoOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/xiangqi/online" element={
                            <ProtectedRoute><XiangqiOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/xiangqi/online/:matchId" element={
                            <ProtectedRoute><XiangqiOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/parkour/online" element={
                            <ProtectedRoute><ParkourOnlinePage /></ProtectedRoute>
                          } />
                          <Route path="/games/parkour/online/:matchId" element={
                            <ProtectedRoute><ParkourOnlinePage /></ProtectedRoute>
                          } />
                        </Route>
                      </Route>
                      <Route path="/profile" element={
                        <ProtectedRoute><ProfilePage /></ProtectedRoute>
                      } />
                      <Route path="/points" element={
                        <ProtectedRoute><PointsPage /></ProtectedRoute>
                      } />
                      <Route element={<RequireFeature feature="drive" />}>
                        <Route path="/drive" element={
                          <ProtectedRoute><DrivePage /></ProtectedRoute>
                        } />
                      </Route>
                      <Route element={<RequireFeature feature="chat" />}>
                        <Route path="/chat" element={
                          <ProtectedRoute><ChatPage /></ProtectedRoute>
                        } />
                        <Route path="/chat/:conversationId" element={
                          <ProtectedRoute><ChatPage /></ProtectedRoute>
                        } />
                      </Route>
                      {/* DeepSeek 对话（站内统一代理 AI 服务，需登录；每日提问上限见 /admin/ai-chat） */}
                      <Route element={<RequireFeature feature="aiChat" />}>
                        <Route path="/deepseek" element={
                          <ProtectedRoute><DeepSeekChatPage /></ProtectedRoute>
                        } />
                      </Route>
                      {/* 网页反代：站点与登录态按账号保存在服务端，需登录 */}
                      <Route element={<RequireFeature feature="webProxy" />}>
                        <Route path="/webproxy" element={
                          <ProtectedRoute><WebProxyPage /></ProtectedRoute>
                        } />
                        <Route path="/webproxy/:siteId" element={
                          <ProtectedRoute><WebProxyViewPage /></ProtectedRoute>
                        } />
                      </Route>
                      {/* 第三方应用授权的账户验证页（未登录会跳登录并带参数返回） */}
                      <Route element={<RequireFeature feature="oauthApps" />}>
                        <Route path="/authorize" element={
                          <ProtectedRoute><AuthorizePage /></ProtectedRoute>
                        } />
                      </Route>
                    </Route>
                  </Route>

                  {/* Admin layout — separate from main site */}
                  <Route element={<AdminRoute><AdminLayout /></AdminRoute>}>
                    {/* 内容管理：文章/页面/公告/评论四合一（Tab 容器）；编辑器仍走独立路由 */}
                    <Route path="/admin" element={<ContentAdminPage />} />
                    <Route path="/admin/new" element={<EditorPage />} />
                    <Route path="/admin/edit/:id" element={<EditorPage />} />
                    {/* 旧地址 → 内容管理对应 Tab（能力守卫由 ADMIN_ROUTE_CAPABILITIES 保持原语义） */}
                    <Route path="/admin/comments" element={<Navigate to="/admin?tab=comments" replace />} />
                    <Route path="/admin/pages" element={<Navigate to="/admin?tab=pages" replace />} />
                    <Route path="/admin/pages/new" element={<PageEditor />} />
                    <Route path="/admin/pages/:id/edit" element={<PageEditor />} />
                    <Route path="/admin/announcements" element={<Navigate to="/admin?tab=announcements" replace />} />
                    {/* 用户与设备二合一；旧地址 /admin/devices → 设备 Tab */}
                    <Route path="/admin/users" element={<UserDeviceAdminPage />} />
                    <Route path="/admin/devices" element={<Navigate to="/admin/users?tab=devices" replace />} />
                    <Route path="/admin/features" element={<FeatureAdminPage />} />
                    <Route path="/admin/points" element={<PointsAdminPage />} />
                    <Route path="/admin/chat" element={<ChatAdminPage />} />
                    <Route path="/admin/api" element={<ApiDocsPage />} />
                    {/* AI 设置二合一（AI 助手 + AI 对话）；旧地址 /admin/ai-chat → 对话 Tab */}
                    <Route path="/admin/ai" element={<AiSettingsAdminPage />} />
                    <Route path="/admin/ai-chat" element={<Navigate to="/admin/ai?tab=chat" replace />} />
                    <Route path="/admin/apps" element={<AppAdminPage />} />
                    <Route path="/admin/proxy" element={<ProxyAdminPage />} />
                    {/* 个人空间：仅管理员可进（personal:manage），AdminCapabilityRoute 按路径能力守卫 */}
                    <Route path="/personal-space" element={<PersonalSpacePage />} />
                  </Route>
                  </Routes>
                </Suspense>
              </RouteErrorBoundary>

              {/* 下载进度弹窗 — 放在 Routes 外层，不随页面切换卸载 */}
              <DownloadToast />
              {/* 游戏邀请/开局提示 — 全局监听，任意页面可接收好友邀请 */}
              <GameInviteToast />
              {/* 新消息提示 — 任意页面（含游戏对局）都能收到聊天消息提醒 */}
              <ChatMessageToast />
              {/* 全局音乐播放条 — 有播放中的歌曲时常驻底部，跨页持续播放 */}
              <MusicPlayerBar />
            </MusicProvider>
            </DownloadProvider>
        </ThemeProvider>
        </GameProvider>
        </XmppChatProvider>
        </ChatProvider>
        </GameStatsProvider>
        </PointsProvider>
        </FeatureProvider>
      </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  )
}
