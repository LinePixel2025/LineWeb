import { useState } from 'react'
import { Navigate, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { ApiError } from '../lib/api'
import { Button, Input } from '../components/ui'

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
    <div className="gh-auth-page">
      <div className="gh-auth-card">
        <div className="gh-auth-head">
          <h1 className="gh-auth-title">登录</h1>
          <p className="gh-auth-subtitle">欢迎回到 Line Web</p>
        </div>

        <form className="gh-auth-form" onSubmit={handleSubmit}>
          {error && (
            <div
              className={`gh-alert ${errorCode === 'ACCOUNT_PENDING' ? 'gh-alert--warning' : 'gh-alert--danger'}`}
              role="alert"
            >
              {error}
            </div>
          )}
          <label className="gh-form-field">
            <span>邮箱或用户名</span>
            <Input type="text" placeholder="邮箱或用户名" value={identifier} onChange={e => setIdentifier(e.target.value)} autoComplete="username" required fullWidth />
          </label>
          <label className="gh-form-field">
            <span>密码</span>
            <Input type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required fullWidth />
          </label>
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
            {loading ? '登录中…' : '登录'}
          </Button>
        </form>

        {isEnabled('registration') && (
          <p className="gh-auth-foot">
            还没有账号？ <Link to="/register">注册</Link>
          </p>
        )}
      </div>
    </div>
  )
}
