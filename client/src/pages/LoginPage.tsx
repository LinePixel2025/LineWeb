import { useState } from 'react'
import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { ApiError } from '../lib/api'
import { GitHubButton, GitHubInput } from '../components/ui'

function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return ''
  return value
}

export default function LoginPage() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [loading, setLoading] = useState(false)
  const { login, user } = useAuth()
  const { isEnabled } = useFeature()
  const location = useLocation()
  const navigate = useNavigate()
  const from = (location.state as { from?: { pathname?: string; search?: string; hash?: string } } | null)?.from
  const fromPath = from?.pathname ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}` : ''
  const returnTo = new URLSearchParams(location.search).get('returnTo')
  const redirectTo = safeReturnTo(fromPath) || safeReturnTo(returnTo) || '/'

  if (user) return <Navigate to={redirectTo} replace />

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setErrorCode(''); setLoading(true)
    try {
      await login(identifier, password)
      navigate(redirectTo, { replace: true })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败')
      setErrorCode(err instanceof ApiError ? err.code ?? '' : '')
    } finally { setLoading(false) }
  }

  return (
    <div className="gh-page-container gh-auth-page">
      <div className="gh-box gh-auth-card">
        <h2 style={{ textAlign: 'center', marginBottom: '4px' }}>登录</h2>
        <p className="gh-text-secondary" style={{ textAlign: 'center', marginBottom: '24px', fontSize: '0.88rem' }}>
          欢迎回到 Line Web
        </p>

        {error && (
          <div
            className={`gh-alert ${errorCode === 'ACCOUNT_PENDING' ? 'gh-alert--warning' : 'gh-alert--danger'}`}
            role="alert"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label className="gh-form-field">
            <span>邮箱或用户名</span>
            <GitHubInput type="text" placeholder="邮箱或用户名" value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" required fullWidth />
          </label>
          <label className="gh-form-field">
            <span>密码</span>
            <GitHubInput type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required fullWidth />
          </label>
          <GitHubButton type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </GitHubButton>
        </form>

        {isEnabled('registration') && (
          <p className="gh-text-tertiary" style={{ textAlign: 'center', marginTop: '20px' }}>
            还没有账号？ <Link to="/register">注册</Link>
          </p>
        )}
      </div>
    </div>
  )
}
