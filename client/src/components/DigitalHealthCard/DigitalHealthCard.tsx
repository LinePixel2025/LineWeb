import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'

interface ScreenTimeData {
  totalSeconds: number
  dailyGoalSeconds: number | null
  date: string
  reportedAt: string | null
  updatedAt: string | null
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`
  if (hours > 0) return `${hours} 小时`
  return `${minutes} 分钟`
}

function getGoalProgressColor(percent: number): string {
  if (percent >= 100) return 'var(--gh-danger)'
  if (percent >= 75) return '#f59e0b'
  return 'var(--gh-success)'
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
    <section className="home-health-section" style={{ width: '100%', marginBottom: 'var(--gh-space-4)' }}>
      <div style={{ position: 'relative' }}>
        <div className="gh-box" style={{ padding: 'var(--gh-space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--gh-text)' }}>数字健康</h2>
            <p className="gh-text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>今日电脑屏幕使用时间</p>
          </div>
          <button
            onClick={fetchData}
            disabled={loading}
            className="gh-btn gh-btn--secondary gh-btn--sm"
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
          <div style={{ color: 'var(--gh-danger)', fontSize: '0.9rem' }}>
            获取失败，请稍后重试。
          </div>
        )}

        {!error && loading && !data && (
          <div className="gh-skeleton" style={{ height: '40px', width: '160px', borderRadius: '8px' }} />
        )}

        {!error && !loading && data && data.totalSeconds > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '2.4rem', fontWeight: 700, color: 'var(--gh-accent)' }}>
                {formatDuration(data.totalSeconds)}
              </span>
              <span className="gh-text-tertiary" style={{ fontSize: '0.85rem' }}>
                上次更新：{timeAgo(data.reportedAt)}
              </span>
            </div>
            {data.dailyGoalSeconds != null && data.dailyGoalSeconds > 0 && (
              <div style={{ marginTop: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--gh-text-secondary)' }}>
                    今日目标：{formatDuration(data.dailyGoalSeconds)}
                  </span>
                  <span style={{
                    fontSize: '0.82rem', fontWeight: 600,
                    color: getGoalProgressColor(Math.round((data.totalSeconds / data.dailyGoalSeconds) * 100)),
                  }}>
                    {Math.round((data.totalSeconds / data.dailyGoalSeconds) * 100)}%
                  </span>
                </div>
                <div style={{
                  width: '100%', height: '6px', borderRadius: '3px',
                  background: 'var(--gh-canvas-inset)', overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${Math.min(100, Math.round((data.totalSeconds / data.dailyGoalSeconds) * 100))}%`,
                    height: '100%', borderRadius: '3px',
                    background: getGoalProgressColor(Math.round((data.totalSeconds / data.dailyGoalSeconds) * 100)),
                    transition: 'width 0.5s ease',
                  }} />
                </div>
              </div>
            )}
          </>
        )}

        {!error && !loading && data && data.totalSeconds === 0 && data.dailyGoalSeconds != null && data.dailyGoalSeconds > 0 && (
          <div>
            <p className="gh-text-secondary" style={{ fontSize: '0.95rem', marginBottom: '8px' }}>
              今日目标：{formatDuration(data.dailyGoalSeconds)}
            </p>
            <p className="gh-text-secondary" style={{ fontSize: '0.95rem', marginBottom: '12px' }}>
              还没有屏幕时间数据。连接 Time Master 后开始同步。
            </p>
            <Link
              to="/profile#digital-health"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              style={{ textDecoration: 'none' }}
            >
              去连接
            </Link>
          </div>
        )}

        {!error && !loading && data && data.totalSeconds === 0 && (data.dailyGoalSeconds == null || data.dailyGoalSeconds === 0) && (
          <div>
            <p className="gh-text-secondary" style={{ fontSize: '0.95rem', marginBottom: '12px' }}>
              还没有屏幕时间数据。连接 Time Master 后开始同步。
            </p>
            <Link
              to="/profile#digital-health"
              className="gh-btn gh-btn--secondary gh-btn--sm"
              style={{ textDecoration: 'none' }}
            >
              去连接
            </Link>
          </div>
        )}
      </div>
    </div>
    </section>
  )
}
