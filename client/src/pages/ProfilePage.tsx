import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useLocation, useNavigate } from 'react-router-dom'
import UserAvatar from '../components/UserAvatar'
import AvatarCropDialog from '../components/AvatarCropDialog'
import DigitalHealthSection from '../components/DigitalHealthSection'
import { GitHubButton, GitHubBadge, GitHubAlert, GitHubTabNav, GitHubInput } from '../components/ui'
import api from '../lib/api'

export default function ProfilePage() {
  const { user, logout, updateProfile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [activeTab, setActiveTab] = useState(() => location.hash === '#digital-health' ? 'digital-health' : 'overview')
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [username, setUsername] = useState(user?.username ?? '')
  const [usernameError, setUsernameError] = useState('')
  const [usernameSuccess, setUsernameSuccess] = useState(false)
  const [updatingUsername, setUpdatingUsername] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [updatingPassword, setUpdatingPassword] = useState(false)

  useEffect(() => {
    if (location.hash === '#digital-health') setActiveTab('digital-health')
  }, [location.hash])

  useEffect(() => {
    setUsername(user?.username ?? '')
  }, [user?.username])

  const handleLogout = () => { logout(); navigate('/') }

  const handleUsernameSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setUsernameError(''); setUsernameSuccess(false); setUpdatingUsername(true)
    try {
      await updateProfile({ username: username.trim() })
      setUsernameSuccess(true)
    } catch (err: unknown) {
      setUsernameError(err instanceof Error ? err.message : '修改用户名失败')
    } finally { setUpdatingUsername(false) }
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(''); setPasswordSuccess(false)
    if (newPassword !== confirmPassword) {
      setPasswordError('两次输入的新密码不一致')
      return
    }
    setUpdatingPassword(true)
    try {
      await updateProfile({ currentPassword, newPassword })
      setPasswordSuccess(true)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : '修改密码失败')
    } finally { setUpdatingPassword(false) }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      alert('文件大小不能超过 2MB')
      e.target.value = ''
      return
    }
    setCropFile(file)
    e.target.value = ''
  }

  const handleAvatarRemove = async () => {
    try {
      await api.delete('/auth/avatar')
      window.location.reload()
    } catch {
      alert('删除失败')
    }
  }

  return (
    <div className="gh-page-container" style={{ maxWidth: '900px' }}>
      <div className="gh-page-header">
        <h1 className="gh-page-title">个人资料</h1>
      </div>

      <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        {/* Left: Profile Info */}
        <div style={{ flex: '0 0 auto', minWidth: '240px' }}>
          <div className="gh-box" style={{ textAlign: 'center' }}>
            <UserAvatar userId={user!.id} username={user!.username} size="xl" />
            <h2 style={{ fontSize: '1.25rem', margin: '12px 0 4px' }}>{user?.username}</h2>
            <p className="gh-text-secondary" style={{ fontSize: '0.88rem' }}>{user?.email}</p>
            <div style={{ marginTop: '12px' }}>
              <GitHubBadge variant={user?.role === 'admin' ? 'accent' : 'default'}>
                {user?.role === 'admin' ? '管理员' : '用户'}
              </GitHubBadge>
            </div>
            <div style={{ marginTop: '20px', display: 'flex', gap: '8px', flexDirection: 'column', alignItems: 'center' }}>
              <label style={{ cursor: 'pointer', display: 'inline-flex' }}>
                <span className="gh-btn gh-btn--secondary gh-btn--sm">上传头像</span>
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={handleFileSelect}
                />
              </label>
              <GitHubButton variant="ghost" size="sm" onClick={handleAvatarRemove}>
                移除头像
              </GitHubButton>
              <div style={{ borderTop: '1px solid var(--gh-color-border-default)', width: '100%', margin: '8px 0' }} />
              <GitHubButton variant="danger" size="sm" onClick={handleLogout}>
                退出登录
              </GitHubButton>
            </div>
          </div>
        </div>

        {/* Right: Content Tabs */}
        <div style={{ flex: '1 1 400px', minWidth: 0 }}>
          <GitHubTabNav
            tabs={[
              { value: 'overview', label: '概览' },
              { value: 'digital-health', label: '数字健康' },
            ]}
            active={activeTab}
            onChange={setActiveTab}
          />

          <div style={{ marginTop: '16px' }}>
            {activeTab === 'overview' && (
              <>
                <div className="gh-box">
                  <h3 style={{ fontSize: '1rem', margin: '0 0 16px' }}>账号信息</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div>
                      <span className="gh-text-secondary" style={{ fontSize: '0.78rem' }}>用户名</span>
                      <div style={{ fontSize: '0.95rem' }}>{user?.username}</div>
                    </div>
                    <div>
                      <span className="gh-text-secondary" style={{ fontSize: '0.78rem' }}>邮箱</span>
                      <div style={{ fontSize: '0.95rem' }}>{user?.email}</div>
                    </div>
                    <div>
                      <span className="gh-text-secondary" style={{ fontSize: '0.78rem' }}>角色</span>
                      <div style={{ fontSize: '0.95rem' }}>{user?.role === 'admin' ? '管理员' : '用户'}</div>
                    </div>
                  </div>
                </div>

                {saveSuccess && (
                  <GitHubAlert variant="success">设置已保存</GitHubAlert>
                )}
                {saveError && (
                  <GitHubAlert variant="danger">{saveError}</GitHubAlert>
                )}

                <div className="gh-box" style={{ marginTop: '16px' }}>
                  <h3 style={{ fontSize: '1rem', margin: '0 0 16px' }}>修改用户名</h3>
                  <form onSubmit={handleUsernameSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <GitHubInput
                      type="text"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      placeholder="新用户名（2-50 字符）"
                      required
                      minLength={2}
                      maxLength={50}
                      fullWidth
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <GitHubButton type="submit" variant="primary" disabled={updatingUsername || !username.trim() || username.trim() === user?.username}>
                        {updatingUsername ? '保存中…' : '保存'}
                      </GitHubButton>
                    </div>
                  </form>
                  {usernameSuccess && (
                    <GitHubAlert variant="success">用户名已更新</GitHubAlert>
                  )}
                  {usernameError && (
                    <GitHubAlert variant="danger">{usernameError}</GitHubAlert>
                  )}
                </div>

                <div className="gh-box" style={{ marginTop: '16px' }}>
                  <h3 style={{ fontSize: '1rem', margin: '0 0 16px' }}>修改密码</h3>
                  <form onSubmit={handlePasswordSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <GitHubInput
                      type="password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="当前密码"
                      required
                      autoComplete="current-password"
                      fullWidth
                    />
                    <GitHubInput
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="新密码（至少 6 位）"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      fullWidth
                    />
                    <GitHubInput
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="确认新密码"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      fullWidth
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <GitHubButton type="submit" variant="primary" disabled={updatingPassword}>
                        {updatingPassword ? '修改中…' : '修改密码'}
                      </GitHubButton>
                    </div>
                  </form>
                  {passwordSuccess && (
                    <GitHubAlert variant="success">密码已修改，其他设备已退出登录</GitHubAlert>
                  )}
                  {passwordError && (
                    <GitHubAlert variant="danger">{passwordError}</GitHubAlert>
                  )}
                </div>

              </>
            )}
            {activeTab === 'digital-health' && <DigitalHealthSection />}
          </div>
        </div>
      </div>

      {cropFile && (
        <AvatarCropDialog file={cropFile} onClose={() => setCropFile(null)} />
      )}
    </div>
  )
}
