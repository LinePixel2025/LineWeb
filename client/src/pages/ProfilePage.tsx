import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useWallpaper } from '../contexts/WallpaperContext'
import { useNavigate } from 'react-router-dom'
import LiquidGlass from '../components/glass/LiquidGlass'
import LiquidButton from '../components/glass/LiquidButton'

const DEFAULT_COLOR = '#0d0d0f'

export default function ProfilePage() {
  const { user, logout, updateSettings } = useAuth()
  const { wallpaperTitle, wallpaperDate: currentWallpaperDate,
    previewWallpaper, history, loadHistory, historyLoading } = useWallpaper()
  const navigate = useNavigate()

  const [bgType, setBgType] = useState<'wallpaper' | 'solid'>('wallpaper')
  const [solidColor, setSolidColor] = useState(DEFAULT_COLOR)
  const [wallpaperMode, setWallpaperMode] = useState<'latest' | 'random' | 'date'>('latest')
  const [selectedDate, setSelectedDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user?.settings) return
    try {
      const parsed = JSON.parse(user.settings)
      const bg = parsed?.background
      if (!bg) return
      if (bg.type === 'solid') {
        setBgType('solid')
        setSolidColor(bg.solidColor || DEFAULT_COLOR)
        setWallpaperMode('latest')
      } else {
        setBgType('wallpaper')
        setWallpaperMode(bg.wallpaperMode || 'latest')
        if (bg.wallpaperDate) setSelectedDate(bg.wallpaperDate)
      }
    } catch { /* ignore */ }
  }, [user?.settings])

  useEffect(() => {
    if (history.length === 0 && !historyLoading) loadHistory()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const bg: Record<string, unknown> = { type: bgType }
      if (bgType === 'solid') {
        bg.solidColor = solidColor
      } else {
        bg.wallpaperMode = wallpaperMode
        if (wallpaperMode === 'date' && selectedDate) bg.wallpaperDate = selectedDate
      }
      await updateSettings(JSON.stringify({ background: bg }))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleLogout = () => { logout(); navigate('/') }

  const handleSelectHistory = (item: { date: string; title: string; copyright: string; image_url_4k?: string; image_url_1080?: string; image_url?: string }) => {
    setWallpaperMode('date')
    setSelectedDate(item.date)
    previewWallpaper({ mode: 'date', date: item.date })
  }

  const isSelected = (date: string) => wallpaperMode === 'date' && selectedDate === date

  return (
    <div className="page container profile-page" style={{ maxWidth: '520px', position: 'relative' }}>
      {/* Page-level dark backdrop */}
      <div style={{ position: 'fixed', inset: 0, zIndex: -1, background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' }} />

      <h1 style={{ marginBottom: '28px', color: 'var(--lg-text-primary)', fontSize: '1.6rem', fontWeight: 600, letterSpacing: '-0.01em' }}>个人资料</h1>

      {/* 资料卡片 */}
      <LiquidGlass variant="strong" chromatic={false} style={{ marginBottom: '24px' }} className="profile-card">
        <div style={{ marginBottom: '22px' }}>
          <span className="profile-label">用户名</span>
          <span style={{ fontSize: '1.1rem', fontWeight: 500, color: 'var(--lg-text-primary)' }}>{user?.username}</span>
        </div>
        <div style={{ marginBottom: '22px' }}>
          <span className="profile-label">邮箱</span>
          <span style={{ fontSize: '1rem', color: 'var(--lg-text-secondary)' }}>{user?.email}</span>
        </div>
        <div style={{ marginBottom: '28px' }}>
          <span className="profile-label">角色</span>
          <span style={{ fontSize: '1rem', color: user?.role === 'admin' ? 'var(--lg-accent)' : 'var(--lg-text-secondary)' }}>
            {user?.role === 'admin' ? '管理员' : '用户'}
          </span>
        </div>
        <LiquidButton variant="danger" size="md" onClick={handleLogout}>
          退出登录
        </LiquidButton>
      </LiquidGlass>

      {/* 网站个性化设置 */}
      <LiquidGlass variant="strong" chromatic={false} className="profile-card">
        <h2 style={{ margin: '0 0 22px', fontSize: '1.1rem', fontWeight: 600, color: 'var(--lg-text-primary)' }}>网站个性化设置</h2>

        {/* 背景类型切换 */}
        <div style={{ marginBottom: '22px' }}>
          <span className="profile-label">背景样式</span>
          <div style={{ display: 'flex', gap: '10px' }}>
            {(['wallpaper', 'solid'] as const).map(t => (
              <button key={t}
                onClick={() => setBgType(t)}
                style={{
                  flex: 1, padding: '10px 16px', borderRadius: '12px', border: '1px solid',
                  borderColor: bgType === t ? 'var(--lg-accent)' : 'rgba(255,255,255,0.10)',
                  background: bgType === t ? 'rgba(41,151,255,0.10)' : 'rgba(255,255,255,0.04)',
                  color: bgType === t ? 'var(--lg-accent)' : 'var(--lg-text-secondary)',
                  cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
                  fontFamily: 'var(--lg-font)', transition: 'all 0.2s ease',
                }}
              >
                {t === 'wallpaper' ? '🖼 每日壁纸' : '🎨 纯色背景'}
              </button>
            ))}
          </div>
        </div>

        {/* 纯色背景选项 */}
        {bgType === 'solid' && (
          <div style={{ marginBottom: '22px' }}>
            <span className="profile-label">选择颜色</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <input type="color" value={solidColor}
                onChange={(e) => setSolidColor(e.target.value)}
                style={{ width: '44px', height: '44px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.10)', padding: 0, cursor: 'pointer', background: 'none' }}
              />
              <input type="text" value={solidColor}
                onChange={(e) => setSolidColor(e.target.value)}
                style={{ flex: 1, padding: '10px 14px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontFamily: 'var(--lg-font)', fontSize: '0.85rem', outline: 'none' }}
                placeholder="#000000"
              />
              <div style={{ width: '38px', height: '38px', borderRadius: '8px', background: solidColor, border: '1px solid rgba(255,255,255,0.15)', flexShrink: 0 }} />
            </div>
          </div>
        )}

        {/* 壁纸模式选项 */}
        {bgType === 'wallpaper' && (
          <>
            <div style={{ marginBottom: '18px' }}>
              <span className="profile-label">壁纸来源</span>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {([
                  { key: 'latest' as const, label: '每日更新', icon: '🔄' },
                  { key: 'random' as const, label: '随机历史', icon: '🎲' },
                  { key: 'date' as const, label: '选择日期', icon: '📅' },
                ]).map(({ key, label, icon }) => (
                  <button key={key}
                    onClick={() => { setWallpaperMode(key); if (key === 'random') previewWallpaper({ mode: 'random' }); else if (key === 'latest') previewWallpaper({ mode: 'latest' }) }}
                    style={{
                      padding: '8px 16px', borderRadius: '9999px', border: '1px solid',
                      borderColor: wallpaperMode === key ? 'var(--lg-accent)' : 'rgba(255,255,255,0.10)',
                      background: wallpaperMode === key ? 'rgba(41,151,255,0.10)' : 'rgba(255,255,255,0.04)',
                      color: wallpaperMode === key ? 'var(--lg-accent)' : 'var(--lg-text-secondary)',
                      cursor: 'pointer', fontSize: '0.82rem', fontWeight: 500,
                      fontFamily: 'var(--lg-font)', transition: 'all 0.2s ease',
                    }}
                  >{icon} {label}</button>
                ))}
              </div>
            </div>

            {/* 历史壁纸选择 */}
            {wallpaperMode === 'date' && (
              <div style={{ marginBottom: '22px' }}>
                <span className="profile-label">
                  挑选一张历史壁纸
                  <span style={{ color: 'rgba(255,255,255,0.25)', marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>（点击预览）</span>
                </span>
                {historyLoading ? (
                  <div style={{ textAlign: 'center', padding: '28px', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>加载中…</div>
                ) : history.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '28px', color: 'rgba(255,255,255,0.3)', fontSize: '0.85rem' }}>暂无历史壁纸</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '10px', maxHeight: '300px', overflowY: 'auto', padding: '2px' }}>
                    {history.map((item) => {
                      const sel = isSelected(item.date)
                      return (
                        <button key={item.date}
                          onClick={() => handleSelectHistory(item)}
                          title={`${item.title || item.date}\n${item.copyright || ''}`}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                            padding: '6px', borderRadius: '10px',
                            border: sel ? '2px solid var(--lg-accent)' : '1px solid rgba(255,255,255,0.08)',
                            background: sel ? 'rgba(41,151,255,0.08)' : 'rgba(255,255,255,0.02)',
                            cursor: 'pointer', transition: 'all 0.2s ease', fontFamily: 'var(--lg-font)',
                          }}
                        >
                          <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: '6px', background: item.image_url_4k ? `url(${item.image_url_4k}) center/cover no-repeat` : 'rgba(255,255,255,0.04)' }} />
                          <span style={{ fontSize: '0.62rem', color: sel ? 'var(--lg-accent)' : 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{item.date}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {wallpaperTitle && (
              <div style={{ marginBottom: '18px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(255,255,255,0.03)', fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)' }}>
                <div style={{ fontWeight: 500, color: 'rgba(255,255,255,0.65)' }}>{wallpaperTitle}</div>
                {currentWallpaperDate && <div style={{ marginTop: 2 }}>📅 {currentWallpaperDate}</div>}
              </div>
            )}
          </>
        )}

        {/* 保存 */}
        <div className="profile-btn-row" style={{ marginTop: '6px' }}>
          <button onClick={handleSave} disabled={saving}
            style={{
              padding: '10px 28px', borderRadius: '9999px', fontWeight: 500, fontSize: '0.9rem',
              background: 'linear-gradient(135deg, var(--lg-accent), #40a9ff)',
              color: '#fff', border: 'none', cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.6 : 1, boxShadow: '0 4px 12px rgba(41,151,255,0.3)',
              fontFamily: 'var(--lg-font)',
            }}
          >{saving ? '保存中…' : '保存设置'}</button>
          {saved && <span style={{ color: 'var(--lg-success)', fontSize: '0.85rem', fontWeight: 500 }}>✓ 已保存</span>}
          {error && <span style={{ color: 'var(--lg-danger)', fontSize: '0.85rem' }}>{error}</span>}
        </div>
      </LiquidGlass>
    </div>
  )
}
