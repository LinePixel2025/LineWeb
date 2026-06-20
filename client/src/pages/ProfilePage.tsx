import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/') }

  return (
    <div className="page container" style={{ maxWidth: '500px' }}>
      <h1 style={{ marginBottom: '24px' }}>个人资料</h1>
      <div className="lg-surface-strong" style={{ padding: '32px', animation: 'glassRise 0.5s ease-out' }}>
        <div style={{ marginBottom: '20px' }}>
          <span className="text-tertiary" style={{ fontSize: '0.82rem', display: 'block' }}>用户名</span>
          <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>{user?.username}</span>
        </div>
        <div style={{ marginBottom: '20px' }}>
          <span className="text-tertiary" style={{ fontSize: '0.82rem', display: 'block' }}>邮箱</span>
          <span style={{ fontSize: '1.1rem' }}>{user?.email}</span>
        </div>
        <div style={{ marginBottom: '28px' }}>
          <span className="text-tertiary" style={{ fontSize: '0.82rem', display: 'block' }}>角色</span>
          <span style={{ fontSize: '1.1rem' }}>{user?.role === 'admin' ? '管理员' : '用户'}</span>
        </div>
        <button onClick={handleLogout}
          style={{
            padding: '12px 28px', borderRadius: '9999px', fontWeight: 500, fontSize: '0.9rem',
            background: 'linear-gradient(135deg, #ff3b30, #ff6b6b)', color: 'white', border: 'none',
            cursor: 'pointer', boxShadow: '0 4px 12px rgba(255,59,48,0.3)',
            fontFamily: 'var(--lg-font)',
          }}
        >
          退出登录
        </button>
      </div>
    </div>
  )
}
