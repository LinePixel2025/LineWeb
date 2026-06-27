import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { WallpaperProvider } from './contexts/WallpaperContext'
import { ContrastProvider } from './contexts/ContrastContext'
import Layout from './components/Layout'
import AdminLayout from './components/AdminLayout'
import { ProtectedRoute, AdminRoute } from './components/Guards'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import PostsPage from './pages/PostsPage'
import PostPage from './pages/PostPage'
import CalculatorPage from './pages/CalculatorPage'
import FeaturesPage from './pages/FeaturesPage'
import ProfilePage from './pages/ProfilePage'
import AdminPage from './pages/AdminPage'
import EditorPage from './pages/EditorPage'
import CommentAdminPage from './pages/admin/CommentAdminPage'
import PageList from './pages/admin/PageList'
import PageEditor from './pages/admin/PageEditor'
import UserAdminPage from './pages/admin/UserAdminPage'
import DynamicPage from './pages/DynamicPage'
import DrivePage from './pages/DrivePage'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WallpaperProvider>
          <ContrastProvider>
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
              </Route>
            </Routes>
          </ContrastProvider>
        </WallpaperProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
