import { Component, lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { DownloadProvider } from './contexts/DownloadContext'
import Layout from './components/Layout'
import { ProtectedRoute, AdminRoute } from './components/Guards'
import DownloadToast from './components/drive/DownloadToast'

// 路由级代码分割 — 所有页面和布局懒加载，减少首屏包体积
const HomePage = lazy(() => import('./pages/HomePage'))
const AdminLayout = lazy(() => import('./components/AdminLayout'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const PostsPage = lazy(() => import('./pages/PostsPage'))
const PostPage = lazy(() => import('./pages/PostPage'))
const CalculatorPage = lazy(() => import('./pages/CalculatorPage'))
const FeaturesPage = lazy(() => import('./pages/FeaturesPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))
const DynamicPage = lazy(() => import('./pages/DynamicPage'))
const DrivePage = lazy(() => import('./pages/DrivePage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const EditorPage = lazy(() => import('./pages/EditorPage'))
const CommentAdminPage = lazy(() => import('./pages/admin/CommentAdminPage'))
const PageList = lazy(() => import('./pages/admin/PageList'))
const PageEditor = lazy(() => import('./pages/admin/PageEditor'))
const UserAdminPage = lazy(() => import('./pages/admin/UserAdminPage'))
const ApiAdminPage = lazy(() => import('./pages/admin/ApiAdminPage'))
const DeviceMonitorPage = lazy(() => import('./pages/admin/DeviceMonitorPage'))
const AiAdminPage = lazy(() => import('./pages/admin/AiAdminPage'))

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
                    <Route path="/profile" element={
                      <ProtectedRoute><ProfilePage /></ProtectedRoute>
                    } />
                    <Route path="/page/:slug" element={<DynamicPage />} />
                    <Route path="/drive" element={
                      <ProtectedRoute><DrivePage /></ProtectedRoute>
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
                    <Route path="/admin/api" element={<ApiAdminPage />} />
                    <Route path="/admin/devices" element={<DeviceMonitorPage />} />
                    <Route path="/admin/ai" element={<AiAdminPage />} />
                  </Route>
                  </Routes>
                </Suspense>
              </RouteErrorBoundary>

              {/* 下载进度弹窗 — 放在 Routes 外层，不随页面切换卸载 */}
              <DownloadToast />
            </DownloadProvider>
        </ThemeProvider>
      </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  )
}
