import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import LiquidGlass from '../components/glass/LiquidGlass'

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
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally { setLoading(false) }
  }

  return (
    <div className="page container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <LiquidGlass variant="strong" chromatic={false} style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '8px' }}>登录</h2>
        <p className="text-secondary" style={{ textAlign: 'center', marginBottom: '28px', fontSize: '0.88rem' }}>
          欢迎回到 Line Web
        </p>

        {error && (
          <div style={{
            background: 'rgba(255,59,48,0.12)',
            color: 'var(--lg-danger)', padding: '10px 14px',
            borderRadius: 'var(--lg-radius-md)', marginBottom: '16px', fontSize: '0.88rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input className="lg-input" type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="lg-input" type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} required />
          <button className="liquid-btn primary lg" type="submit" disabled={loading}
            style={{
              width: '100%', marginTop: '4px', padding: '14px', borderRadius: '9999px', fontWeight: 500, fontSize: '1rem',
              background: 'linear-gradient(135deg, var(--lg-accent), #40a9ff)', color: 'white', border: 'none', cursor: 'pointer',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.3), 0 4px 16px var(--lg-accent-glow)',
              transition: 'all 0.2s ease',
              WebkitTapHighlightColor: 'transparent',
            }}
            onTouchStart={e => { if (!loading) e.currentTarget.style.transform = 'scale(0.97)' }}
            onTouchEnd={e => { e.currentTarget.style.transform = 'scale(1)' }}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p className="text-tertiary" style={{ textAlign: 'center', marginTop: '20px' }}>
          还没有账号？ <Link to="/register">注册</Link>
        </p>
      </LiquidGlass>
    </div>
  )
}
