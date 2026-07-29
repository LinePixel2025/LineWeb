import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { GitHubButton, GitHubInput } from '../components/ui'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally { setLoading(false) }
  }

  return (
    <div className="gh-page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <div className="gh-box" style={{ width: '100%', maxWidth: '400px', padding: '32px', margin: '60px auto' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '4px' }}>登录</h2>
        <p className="gh-text-secondary" style={{ textAlign: 'center', marginBottom: '24px', fontSize: '0.88rem' }}>
          欢迎回到 Line Web
        </p>

        {error && (
          <div className="gh-alert gh-alert--danger" role="alert">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <GitHubInput type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} required fullWidth />
          <GitHubInput type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} required fullWidth />
          <GitHubButton type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </GitHubButton>
        </form>

        <p className="gh-text-tertiary" style={{ textAlign: 'center', marginTop: '20px' }}>
          还没有账号？ <Link to="/register">注册</Link>
        </p>
      </div>
    </div>
  )
}
