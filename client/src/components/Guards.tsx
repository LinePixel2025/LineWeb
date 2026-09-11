import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { canAccessAdminPath, firstAllowedAdminPath } from '../lib/permissions'

function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="gh-spinner" />
    </div>
  )
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, hasAdminAccess } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  // 管理区入口：账号需具备任意管理能力（admin 拥有全部能力）
  if (!hasAdminAccess) return <Navigate to="/" replace />
  return <>{children}</>
}

/**
 * 管理区内的按能力守卫
 *
 * AdminRoute 只判断「能否进入管理区」，具体某个页面还需要对应能力。
 * 全部管理页都渲染在 AdminLayout 内，因此由 AdminLayout 统一套一层本组件，
 * 新增管理页时不会因为忘记加守卫而出现「导航已隐藏但仍可直达」或「落到无权页面 403」。
 */
export function AdminCapabilityRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (canAccessAdminPath(user, location.pathname)) return <>{children}</>

  const fallback = firstAllowedAdminPath(user)
  // 回退落点仍是当前路径（例如账号没有任何可用管理页）时不再重定向，直接回到主站，避免死循环
  if (fallback === location.pathname || fallback === '/') return <Navigate to="/" replace />
  return <Navigate to={fallback} replace />
}
