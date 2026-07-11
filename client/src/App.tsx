import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { WallpaperProvider } from './contexts/WallpaperContext'
import { GlassProvider } from './contexts/GlassContext'
import { ContrastProvider } from './contexts/ContrastContext'
import { DownloadProvider } from './contexts/DownloadContext'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import { ProtectedRoute, AdminRoute } from './components/Guards'
import DownloadToast from './components/drive/DownloadToast'

// 路由级代码分割 — 所有页面懒加载，减少首屏包体积
const HomePage = lazy(() => import('./pages/HomePage'))
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
const GlassTestPage = lazy(() => import('./pages/GlassTestPage'))

function RouteLoading() {
  return (
    <div className="page container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="spinner" />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WallpaperProvider>
          <GlassProvider>
            <ContrastProvider>
            <DownloadProvider>
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
                    <Route path="/glass-test" element={<GlassTestPage />} />
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
                  </Route>
                </Routes>
              </Suspense>

              {/* 下载进度弹窗 — 放在 Routes 外层，不随页面切换卸载 */}
              <DownloadToast />
            </DownloadProvider>
          </ContrastProvider>
          </GlassProvider>
        </WallpaperProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
