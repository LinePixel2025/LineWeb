import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { WallpaperProvider } from './contexts/WallpaperContext'
import { ContrastProvider } from './contexts/ContrastContext'
import Layout from './components/Layout'
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

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WallpaperProvider>
          <ContrastProvider>
            <Routes>
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
                <Route path="/admin" element={
                  <AdminRoute><AdminPage /></AdminRoute>
                } />
                <Route path="/admin/new" element={
                  <AdminRoute><EditorPage /></AdminRoute>
                } />
                <Route path="/admin/edit/:id" element={
                  <AdminRoute><EditorPage /></AdminRoute>
                } />
              </Route>
            </Routes>
          </ContrastProvider>
        </WallpaperProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
