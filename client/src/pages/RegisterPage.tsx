import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useFeature } from '../contexts/FeatureContext'
import { Button, Input } from '../components/ui'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const { register } = useAuth()
  const { isEnabled } = useFeature()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(''); setLoading(true)
    try {
      await register(username, email, password)
      setSuccess(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '注册失败')
    } finally { setLoading(false) }
  }

  if (!isEnabled('registration')) {
    return (
      <div className="gh-auth-page">
        <div className="gh-auth-card">
          <div className="gh-auth-head">
            <h1 className="gh-auth-title">注册暂未开放</h1>
            <p className="gh-auth-subtitle">管理员已暂时关闭新用户注册，请稍后再试。</p>
          </div>
          <Button variant="primary" size="lg" fullWidth href="/login">返回登录</Button>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="gh-auth-page">
        <div className="gh-auth-card">
          <div className="gh-auth-head">
            <h1 className="gh-auth-title">注册成功，等待管理员审核</h1>
            <p className="gh-auth-subtitle">申请已提交。管理员通过后即可使用账号登录，请稍后再试。</p>
          </div>
          <Button variant="primary" size="lg" fullWidth href="/login">返回登录</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="gh-auth-page">
      <div className="gh-auth-card">
        <div className="gh-auth-head">
          <h1 className="gh-auth-title">注册</h1>
          <p className="gh-auth-subtitle">创建你的 Line Web 账号（需管理员审核）</p>
        </div>

        <form className="gh-auth-form" onSubmit={handleSubmit}>
          {error && (
            <div className="gh-alert gh-alert--danger" role="alert">
              {error}
            </div>
          )}
          <label className="gh-form-field">
            <span>用户名</span>
            <Input type="text" placeholder="用户名" value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" required minLength={2} fullWidth />
          </label>
          <label className="gh-form-field">
            <span>邮箱</span>
            <Input type="email" placeholder="邮箱" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" inputMode="email" required fullWidth />
          </label>
          <label className="gh-form-field">
            <span>密码</span>
            <Input type="password" placeholder="至少 6 位" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required minLength={6} fullWidth />
          </label>
          <Button type="submit" variant="primary" size="lg" fullWidth disabled={loading}>
            {loading ? '注册中…' : '注册'}
          </Button>
        </form>

        <p className="gh-auth-foot">
          已有账号？ <Link to="/login">登录</Link>
        </p>
      </div>
    </div>
  )
}
