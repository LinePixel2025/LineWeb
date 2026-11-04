import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { usePoints } from '../contexts/PointsContext'
import { useCrisis } from '../contexts/CrisisContext'
import UserAvatar from '../components/UserAvatar'
import UserTitleBadge from '../components/UserTitleBadge'
import AvatarCropDialog from '../components/AvatarCropDialog'
import DigitalHealthSection from '../components/DigitalHealthSection'
import { Button, Badge, Alert, SegmentedControl, Input, Icon } from '../components/ui'
import api from '../lib/api'
import { appScopeLabel, isHighRiskScope } from '../lib/appScopes'
import { roleLabel } from '../lib/permissions'
import { useLowPerformanceMode } from '../lib/performanceMode'

interface UserGrant {
  id: number
  scopes: string[]
  createdAt: string
  lastUsedAt: string | null
  client: {
    name: string
    description: string | null
    homepage: string | null
  }
}

export default function ProfilePage() {
  const { user, logout, updateProfile } = useAuth()
  const { profile: pointsProfile, refresh: refreshPoints } = usePoints()
  const { state: crisisState, setTaxEnabled } = useCrisis()
  const [lowPerformanceMode, setLowPerformanceMode] = useLowPerformanceMode()
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
  const [grants, setGrants] = useState<UserGrant[]>([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [grantsError, setGrantsError] = useState('')
  const [revokingId, setRevokingId] = useState<number | null>(null)
  const [equippingTitleId, setEquippingTitleId] = useState<number | null>(null)
  const [taxBusy, setTaxBusy] = useState(false)

  // 危机税款开关（税率与开关状态都来自危机 state；失败由 context 回滚，这里照页面惯例 alert）
  const crisisTaxOptIn = crisisState?.taxOptIn === true
  const crisisTaxPct = crisisState?.rules.spendTaxPct ?? 5

  const toggleCrisisTax = async () => {
    if (taxBusy) return
    setTaxBusy(true)
    try {
      await setTaxEnabled(!crisisTaxOptIn)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '切换危机税款开关失败')
    } finally {
      setTaxBusy(false)
    }
  }

  const fetchGrants = () => {
    setGrantsLoading(true)
    api.get<{ grants: UserGrant[] }>('/oauth/grants')
      .then((data) => { setGrants(data.grants); setGrantsError('') })
      .catch((err: unknown) => setGrantsError(err instanceof Error ? err.message : '加载已授权应用失败'))
      .finally(() => setGrantsLoading(false))
  }

  useEffect(() => { fetchGrants() }, [])

  const handleRevoke = async (grant: UserGrant) => {
    if (!confirm(`确定要撤销「${grant.client.name}」的授权吗？该应用的访问令牌将立即失效。`)) return
    setRevokingId(grant.id)
    try {
      await api.delete(`/oauth/grants/${grant.id}`)
      setGrants((prev) => prev.filter((g) => g.id !== grant.id))
    } catch (err: unknown) {
      setGrantsError(err instanceof Error ? err.message : '撤销失败')
    } finally {
      setRevokingId(null)
    }
  }

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

  const equipLeaderTitle = async (id: number) => {
    if (equippingTitleId !== null) return
    setEquippingTitleId(id)
    try {
      await api.post(`/points/leader-titles/${id}/equip`)
      await refreshPoints()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '佩戴失败')
    } finally {
      setEquippingTitleId(null)
    }
  }

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <h1 className="gh-page-title">个人资料</h1>
        <p className="gh-page-subtitle">管理账号信息、安全设置与已授权应用</p>
      </div>

      <div className="gh-profile">
        {/* 左：身份卡 + 积分 + 称号 */}
        <aside className="gh-profile-side">
          <div className="gh-identity-card gh-identity-card--profile">
            <UserAvatar userId={user!.id} username={user!.username} size="xl" />
            <div className="gh-identity-copy">
              <h2 className="gh-identity-name">{user?.username}</h2>
              <p className="gh-identity-meta">{user?.email}</p>
              <div className="gh-identity-badges">
                <Badge variant={user?.role === 'admin' ? 'accent' : user?.role === 'author' ? 'success' : 'default'}>
                  {roleLabel(user?.role)}
                </Badge>
                {(pointsProfile?.title || pointsProfile?.equippedLeaderTitle) && (
                  <UserTitleBadge title={pointsProfile.title ?? pointsProfile.equippedLeaderTitle} size="md" />
                )}
              </div>
            </div>

            <div className="gh-profile-avatar-actions">
              <label className="gh-btn gh-btn--secondary gh-btn--sm gh-file-btn">
                上传头像
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleFileSelect}
                />
              </label>
              <Button variant="ghost" size="sm" onClick={handleAvatarRemove}>
                移除头像
              </Button>
            </div>
            <Button variant="danger" size="sm" fullWidth onClick={handleLogout}>
              退出登录
            </Button>
          </div>

          <div className="gh-box gh-profile-points-card">
            <div className="gh-profile-points-head">
              <h3 className="gh-box-heading">积分</h3>
              <Link className="gh-profile-points-more" to="/points">积分中心 →</Link>
            </div>
            <div className="gh-profile-stat-list">
              <div className="gh-profile-stat-row">
                <span className="gh-profile-stat-icon gh-profile-stat-icon--coin"><Icon name="coin" size={15} /></span>
                <span className="gh-profile-stat-label">当前积分</span>
                <strong className="gh-profile-stat-value">{pointsProfile?.balance ?? 0}</strong>
              </div>
              <div className="gh-profile-stat-row">
                <span className="gh-profile-stat-icon"><Icon name="wallet" size={15} /></span>
                <span className="gh-profile-stat-label">累计获得</span>
                <strong className="gh-profile-stat-value">{pointsProfile?.earned ?? 0}</strong>
              </div>
              <div className="gh-profile-stat-row">
                <span className="gh-profile-stat-icon"><Icon name="trophy" size={15} /></span>
                <span className="gh-profile-stat-label">全站排名</span>
                <strong className="gh-profile-stat-value">#{pointsProfile?.rank ?? '—'}</strong>
              </div>
            </div>
            <div className="gh-profile-actions">
              <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/points">积分中心</Link>
              <Link className="gh-btn gh-btn--ghost gh-btn--sm" to="/games">赚积分</Link>
            </div>
          </div>

          {pointsProfile && pointsProfile.leaderTitles.length > 0 && (
            <div className="gh-box">
              <h3 className="gh-box-heading">传说称号</h3>
              <p className="gh-settings-hint">
                单机排行榜第一名自动获得，被超越后自动消失；点击「佩戴」显示在顶栏、聊天与排行榜。
              </p>
              <div className="gh-profile-legend-titles">
                {pointsProfile.leaderTitles.map((item) => {
                  const equipped = pointsProfile.equippedLeaderTitle?.id === item.id
                  return (
                    <span key={item.id} className="gh-profile-legend-row">
                      <UserTitleBadge title={item} size="md" />
                      {equipped ? (
                        <span className="gh-badge gh-badge--success">佩戴中</span>
                      ) : (
                        <button
                          type="button"
                          className="gh-btn gh-btn--ghost gh-btn--sm"
                          disabled={equippingTitleId !== null}
                          onClick={() => { void equipLeaderTitle(item.id) }}
                        >
                          {equippingTitleId === item.id ? '佩戴中…' : '佩戴'}
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </aside>

        {/* 右：设置面板 */}
        <div className="gh-profile-main">
          <SegmentedControl
            tabs={[
              { value: 'overview', label: '概览' },
              { value: 'digital-health', label: '数字健康' },
            ]}
            active={activeTab}
            onChange={setActiveTab}
          />

          {activeTab === 'overview' && (
            <div className="gh-profile-panels">
              <section className="gh-settings-group" aria-labelledby="profile-account-title">
                <div className="gh-settings-head">
                  <span className="gh-settings-icon" aria-hidden="true"><Icon name="user" size={16} /></span>
                  <div>
                    <h2 className="gh-settings-title" id="profile-account-title">账号信息</h2>
                    <p className="gh-settings-desc">当前账号的基础身份与权限。</p>
                  </div>
                </div>
                <div className="gh-settings-list">
                  <div className="gh-settings-row">
                    <span className="gh-settings-label">用户名</span>
                    <span className="gh-settings-value">{user?.username}</span>
                  </div>
                  <div className="gh-settings-row">
                    <span className="gh-settings-label">邮箱</span>
                    <span className="gh-settings-value">{user?.email}</span>
                  </div>
                  <div className="gh-settings-row">
                    <span className="gh-settings-label">角色</span>
                    <span className="gh-settings-value">{roleLabel(user?.role)}</span>
                  </div>
                </div>
              </section>

              {saveSuccess && <Alert variant="success">设置已保存</Alert>}
              {saveError && <Alert variant="danger">{saveError}</Alert>}

              <section className="gh-settings-group">
                <div className="gh-settings-head">
                  <span className="gh-settings-icon" aria-hidden="true"><Icon name="edit" size={16} /></span>
                  <div>
                    <h2 className="gh-settings-title">修改用户名</h2>
                    <p className="gh-settings-desc">用于登录与站内展示，2–50 个字符。</p>
                  </div>
                </div>
                <form className="gh-settings-form" onSubmit={handleUsernameSubmit}>
                  <Input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="新用户名（2-50 字符）"
                    required
                    minLength={2}
                    maxLength={50}
                    fullWidth
                  />
                  <div className="gh-settings-form-actions">
                    <Button type="submit" variant="primary" disabled={updatingUsername || !username.trim() || username.trim() === user?.username}>
                      {updatingUsername ? '保存中…' : '保存'}
                    </Button>
                  </div>
                </form>
                {usernameSuccess && <Alert variant="success">用户名已更新</Alert>}
                {usernameError && <Alert variant="danger">{usernameError}</Alert>}
              </section>

              <section className="gh-settings-group">
                <div className="gh-settings-head">
                  <span className="gh-settings-icon" aria-hidden="true"><Icon name="lock" size={16} /></span>
                  <div>
                    <h2 className="gh-settings-title">修改密码</h2>
                    <p className="gh-settings-desc">修改后其他设备上的登录令牌会立即失效。</p>
                  </div>
                </div>
                <form className="gh-settings-form" onSubmit={handlePasswordSubmit}>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={e => setCurrentPassword(e.target.value)}
                    placeholder="当前密码"
                    required
                    autoComplete="current-password"
                    fullWidth
                  />
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="新密码（至少 6 位）"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    fullWidth
                  />
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="确认新密码"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    fullWidth
                  />
                  <div className="gh-settings-form-actions">
                    <Button type="submit" variant="primary" disabled={updatingPassword}>
                      {updatingPassword ? '修改中…' : '修改密码'}
                    </Button>
                  </div>
                </form>
                {passwordSuccess && <Alert variant="success">密码已修改，其他设备已退出登录</Alert>}
                {passwordError && <Alert variant="danger">{passwordError}</Alert>}
              </section>

              <section className="gh-settings-group" aria-labelledby="profile-perf-title">
                <div className="gh-settings-head">
                  <span className="gh-settings-icon" aria-hidden="true"><Icon name="sparkles" size={16} /></span>
                  <div>
                    <h2 className="gh-settings-title" id="profile-perf-title">性能与动效</h2>
                    <p className="gh-settings-desc">老旧设备、集成显卡或开启省电模式时，可以削弱界面上的动态特效。</p>
                  </div>
                </div>
                <div className="gh-settings-list">
                  <label className="gh-settings-row gh-perf-row">
                    <span className="gh-settings-label">
                      <span className="gh-perf-row-title">低性能模式</span>
                      <span className="gh-perf-row-hint">
                        称号保留配色但关闭粒子、旋转光晕与扫光，头像框粒子与聊天装饰动画一并减弱
                        （不是完全关闭）。设置只保存在这台设备，不影响其他设备。
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={lowPerformanceMode}
                      aria-label={`低性能模式：${lowPerformanceMode ? '已开启' : '已关闭'}`}
                      className={`gh-feature-switch ${lowPerformanceMode ? 'gh-feature-switch--on' : ''}`}
                      onClick={() => setLowPerformanceMode(!lowPerformanceMode)}
                    >
                      <span className="gh-feature-switch-knob" />
                    </button>
                  </label>
                </div>
              </section>

              <section className="gh-settings-group" aria-labelledby="profile-crisis-tax-title">
                <div className="gh-settings-head">
                  <span className="gh-settings-icon" aria-hidden="true"><Icon name="coin" size={16} /></span>
                  <div>
                    <h2 className="gh-settings-title" id="profile-crisis-tax-title">危机税款</h2>
                    <p className="gh-settings-desc">自愿向 Lineweb 危机公共银行多缴一份税，随时可关。</p>
                  </div>
                </div>
                <div className="gh-settings-list">
                  <label className="gh-settings-row gh-perf-row">
                    <span className="gh-settings-label">
                      <span className="gh-perf-row-title">积分税款</span>
                      <span className="gh-perf-row-hint">
                        开启后每次花费积分额外扣 {crisisTaxPct}%，直接进入 Lineweb 危机公共银行
                        （还危机账单本身不抽税，游戏输分与管理员加分也不抽税）。
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={crisisTaxOptIn}
                      aria-label={`危机积分税款：${crisisTaxOptIn ? '已开启' : '已关闭'}`}
                      className={`gh-feature-switch ${crisisTaxOptIn ? 'gh-feature-switch--on' : ''}`}
                      disabled={taxBusy}
                      onClick={() => { void toggleCrisisTax() }}
                    >
                      <span className="gh-feature-switch-knob" />
                    </button>
                  </label>
                </div>
              </section>

              <section className="gh-settings-group">
                <div className="gh-settings-head">
                  <span className="gh-settings-icon" aria-hidden="true"><Icon name="shield" size={16} /></span>
                  <div>
                    <h2 className="gh-settings-title">已授权的应用</h2>
                    <p className="gh-settings-desc">这些第三方应用可以使用你的账号访问 LineWeb API，撤销后令牌立即失效。</p>
                  </div>
                </div>

                {grantsError && <Alert variant="danger">{grantsError}</Alert>}

                {grantsLoading ? (
                  <div className="gh-loading-row"><div className="gh-spinner" /></div>
                ) : grants.length === 0 ? (
                  <p className="gh-settings-hint">目前没有已授权的应用</p>
                ) : (
                  <div className="gh-grant-list">
                    {grants.map((grant) => (
                      <div key={grant.id} className="gh-grant-row">
                        <div className="gh-grant-copy">
                          <div className="gh-grant-name">{grant.client.name}</div>
                          {grant.client.description && (
                            <p className="gh-settings-hint">{grant.client.description}</p>
                          )}
                          <div className="gh-grant-scopes">
                            {grant.scopes.map((scope) => (
                              <Badge key={scope} variant={isHighRiskScope(scope) ? 'warning' : 'default'}>
                                {appScopeLabel(scope)}
                              </Badge>
                            ))}
                          </div>
                          <p className="gh-grant-time">
                            授权于 {new Date(grant.createdAt).toLocaleString('zh-CN')}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={revokingId === grant.id}
                          onClick={() => handleRevoke(grant)}
                        >
                          {revokingId === grant.id ? '撤销中…' : '撤销授权'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === 'digital-health' && <DigitalHealthSection />}
        </div>
      </div>

      {cropFile && (
        <AvatarCropDialog file={cropFile} onClose={() => setCropFile(null)} />
      )}
    </div>
  )
}
