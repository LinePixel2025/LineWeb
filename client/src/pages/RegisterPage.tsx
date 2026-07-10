import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'

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
    <div className="page container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <LiquidGlass variant="strong" chromatic={false} style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '8px' }}>注册</h2>
        <p className="text-secondary" style={{ textAlign: 'center', marginBottom: '28px', fontSize: '0.88rem' }}>
          创建你的 Line Web 账号
        </p>

        {error && (
          <div style={{
            background: 'rgba(255,59,48,0.12)', color: 'var(--lg-danger)',
            padding: '10px 14px', borderRadius: 'var(--lg-radius-md)', marginBottom: '16px', fontSize: '0.88rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input className="lg-input" type="text" placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} required minLength={2} />
          <input className="lg-input" type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="lg-input" type="password" placeholder="密码（至少6位）" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          <LiquidButton
            type="submit"
            variant="primary"
            size="lg"
            disabled={loading}
            style={{ width: '100%', marginTop: '4px' }}
          >
            {loading ? '注册中...' : '注册'}
          </LiquidButton>
        </form>

        <p className="text-tertiary" style={{ textAlign: 'center', marginTop: '20px' }}>
          已有账号？ <Link to="/login" target="_blank" rel="noopener noreferrer">登录</Link>
        </p>
      </LiquidGlass>
    </div>
  )
}
