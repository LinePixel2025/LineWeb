import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { canAccessAdminPath, firstAllowedAdminPath } from '../lib/permissions'
import { FEATURE_DEFINITIONS, type FeatureKey } from '../lib/features'

function LoadingSpinner() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="gh-spinner" />
    </div>
  )
}

/** 主站统一登录门禁：登录/注册页不要包在这里 */
export function RequireAuth() {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <LoadingSpinner />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return <Outlet />
}

function FeatureDisabledPage({ feature }: { feature: FeatureKey }) {
  const label = FEATURE_DEFINITIONS.find((item) => item.key === feature)?.label ?? feature
  return (
    <div className="gh-page-container">
      <div className="gh-box" style={{ maxWidth: '560px', margin: '64px auto', padding: '32px', textAlign: 'center' }}>
        <p className="gh-text-tertiary" style={{ marginBottom: '8px' }}>功能已关闭</p>
        <h1 style={{ marginTop: 0 }}>这个功能暂时不可用</h1>
        <p className="gh-text-secondary">
          管理员已关闭「{label}」功能。如需使用，请联系站点管理员。
        </p>
        <Link className="gh-btn gh-btn--primary gh-btn--md" to="/">返回首页</Link>
      </div>
    </div>
  )
}

/** 功能开关守卫：关闭时渲染统一提示；管理员由 FeatureContext 放行 */
export function RequireFeature({ feature, children }: { feature: FeatureKey; children?: React.ReactNode }) {
  const { isEnabled } = useFeature()
  if (!isEnabled(feature)) return <FeatureDisabledPage feature={feature} />
  return children ? <>{children}</> : <Outlet />
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
