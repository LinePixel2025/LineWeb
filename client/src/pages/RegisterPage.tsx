import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { GitHubButton, GitHubInput } from '../components/ui'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { register } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await register(username, email, password)
      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally { setLoading(false) }
  }

  return (
    <div className="gh-page-container gh-auth-page">
      <div className="gh-box gh-auth-card">
        <h2 style={{ textAlign: 'center', marginBottom: '4px' }}>注册</h2>
        <p className="gh-text-secondary" style={{ textAlign: 'center', marginBottom: '24px', fontSize: '0.88rem' }}>
          创建你的 Line Web 账号
        </p>

        {error && (
          <div className="gh-alert gh-alert--danger" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label className="gh-form-field">
            <span>用户名</span>
            <GitHubInput type="text" placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required minLength={2} fullWidth />
          </label>
          <label className="gh-form-field">
            <span>邮箱</span>
            <GitHubInput type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" inputMode="email" required fullWidth />
          </label>
          <label className="gh-form-field">
            <span>密码</span>
            <GitHubInput type="password" placeholder="至少 6 位" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required minLength={6} fullWidth />
          </label>
          <GitHubButton type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
            {loading ? '注册中...' : '注册'}
          </GitHubButton>
        </form>

        <p className="gh-text-tertiary" style={{ textAlign: 'center', marginTop: '20px' }}>
          已有账号？ <Link to="/login">登录</Link>
        </p>
      </div>
    </div>
  )
}
