import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import UserAvatar from '../components/UserAvatar'
import AvatarCropDialog from '../components/AvatarCropDialog'
import DigitalHealthSection from '../components/DigitalHealthSection'
import { GitHubButton, GitHubBadge, GitHubAlert, GitHubTabNav } from '../components/ui'
import api from '../lib/api'

export default function ProfilePage() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState('')

  const handleLogout = () => { logout(); navigate('/') }

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

                <div style={{ marginTop: '16px' }}>
                  <DigitalHealthSection />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {cropFile && (
        <AvatarCropDialog file={cropFile} onClose={() => setCropFile(null)} />
      )}
    </div>
  )
}
