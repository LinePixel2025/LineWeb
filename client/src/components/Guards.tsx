import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page container" style={{ display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <div className="page container" style={{ display: 'flex', justifyContent: 'center' }}><div className="spinner" /></div>
  if (!user) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}
