### Task 9: 更新登录页

**Files:**
- Modify: `client/src/pages/LoginPage.tsx`

**Interfaces:**
- Consumes: CSS变量系统，LiquidGlass组件
- Produces: 更新后的登录页

- [ ] **Step 1: 更新登录页组件**

```tsx
// client/src/pages/LoginPage.tsx
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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally { setLoading(false) }
  }

  return (
    <div className="page container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
      <LiquidGlass variant="strong" chromatic={false} style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <h2 style={{ textAlign: 'center', marginBottom: '8px' }}>登录</h2>
        <p style={{ textAlign: 'center', marginBottom: '28px', fontSize: '0.88rem', color: 'var(--color-text-secondary)' }}>
          欢迎回到 Line Web
        </p>

        {error && (
          <div style={{
            background: 'rgba(238,90,90,0.12)',
            color: 'var(--color-error)', padding: '10px 14px',
            borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '0.88rem',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input className="lg-input" type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} required />
          <input className="lg-input" type="password" placeholder="密码" value={password} onChange={e => setPassword(e.target.value)} required />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: '100%', marginTop: '4px' }}
          >
            {loading ? '登录中...' : '登录'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: '20px', color: 'var(--color-text-tertiary)' }}>
          还没有账号？ <Link to="/register">注册</Link>
        </p>
      </LiquidGlass>
    </div>
  )
}
```

- [ ] **Step 2: 验证登录页**

在浏览器中检查登录页是否正确显示。

- [ ] **Step 3: 提交更改**

```bash
git add client/src/pages/LoginPage.tsx
git commit -m "feat: update login page for new design system"
```
