import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import LiquidGlass from '@/components/glass/LiquidGlass'

interface ScreenTimeData {
  totalSeconds: number
  date: string
  reportedAt: string | null
  updatedAt: string | null
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

function timeAgo(iso: string | null): string {
  if (!iso) return '尚未同步'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时前`
}

export default function DigitalHealthCard() {
  const { user } = useAuth()
  const [data, setData] = useState<ScreenTimeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      setError(false)
      const res = await api.get<ScreenTimeData>('/health/screen-time')
      setData(res)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    fetchData()
  }, [user, fetchData])

  if (!user) return null

  return (
    <section
      className="home-health-section"
      style={{
        maxWidth: '720px',
        margin: '0 auto',
        padding: 'var(--lg-space-7) var(--lg-space-5) var(--lg-space-7)',
      }}
    >
      <LiquidGlass variant="strong" chromatic={false} style={{ padding: 'var(--lg-space-6)', position: 'relative' }}>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            background: 'rgba(0, 0, 0, 0.35)',
            pointerEvents: 'none',
            zIndex: 1,
          }}
        />
        <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--lg-text-primary)' }}>数字健康</h2>
            <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>今日电脑屏幕使用时间</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            style={{
              width: '36px', height: '36px', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)',
              background: 'rgba(255,255,255,0.06)', color: 'var(--lg-text-secondary)', cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
            aria-label="刷新"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: loading ? 'rotate(360deg)' : undefined, transition: 'transform 1s linear' }}>
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        {error && (
          <div style={{ color: 'var(--lg-danger)', fontSize: '0.9rem' }}>
            获取失败，请稍后重试。
          </div>
        )}

        {!error && loading && !data && (
          <div className="skeleton" style={{ height: '40px', width: '160px', borderRadius: '8px' }} />
        )}

        {!error && !loading && data && data.totalSeconds > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '2.4rem', fontWeight: 700, color: 'var(--lg-accent-secondary)' }}>
              {formatDuration(data.totalSeconds)}
            </span>
            <span className="text-tertiary" style={{ fontSize: '0.85rem' }}>
              上次更新：{timeAgo(data.reportedAt)}
            </span>
          </div>
        )}

        {!error && !loading && data && data.totalSeconds === 0 && (
          <div>
            <p className="text-secondary" style={{ fontSize: '0.95rem', marginBottom: '12px' }}>
              还没有屏幕时间数据。连接 Time Master 后开始同步。
            </p>
            <Link
              to="/profile#digital-health"
              className="liquid-btn glass sm"
              style={{ textDecoration: 'none' }}
            >
              去连接
            </Link>
          </div>
        )}
        </div>
      </LiquidGlass>
    </section>
  )
}
