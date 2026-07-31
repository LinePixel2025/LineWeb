import { useCallback, useEffect, useState } from 'react'
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

function timeAgo(iso: string | null): string {
  if (!iso) return '尚未同步'

  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return '刚刚同步'
  if (minutes < 60) return `${minutes} 分钟前同步`

  const hours = Math.floor(minutes / 60)
  return `${hours} 小时前同步`
}

function getGoalStatus(progress: number) {
  if (progress >= 100) {
    return { label: '已达到上限', className: 'digital-health-progress--over' }
  }
  if (progress >= 75) {
    return { label: '接近上限', className: 'digital-health-progress--warning' }
  }
  return { label: '在计划内', className: 'digital-health-progress--good' }
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13.5 4.5V1.75m0 0h-2.75m2.75 0A6.25 6.25 0 0 0 2.34 5.2M2.5 11.5v2.75m0 0h2.75M2.5 14.25A6.25 6.25 0 0 0 13.66 10.8" />
    </svg>
  )
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
      setData(await api.get<ScreenTimeData>('/health/screen-time'))
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

  const hasUsage = (data?.totalSeconds ?? 0) > 0
  const hasGoal = (data?.dailyGoalSeconds ?? 0) > 0
  const progress = hasGoal && data ? Math.round((data.totalSeconds / data.dailyGoalSeconds!) * 100) : 0
  const goalStatus = getGoalStatus(progress)

  return (
    <section className="digital-health-overview gh-box" aria-labelledby="digital-health-overview-title">
      <div className="digital-health-overview__header">
        <div className="digital-health-overview__heading">
          <span className="digital-health-overview__icon" aria-hidden="true">
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 14.25s-5.5-3.4-5.5-8.1A2.65 2.65 0 0 1 7.1 4.32L8 5.2l.9-.88a2.65 2.65 0 0 1 4.6 1.83c0 4.7-5.5 8.1-5.5 8.1Z" />
            </svg>
          </span>
          <div>
            <h2 id="digital-health-overview-title">数字健康</h2>
            <p>今日屏幕使用情况</p>
          </div>
        </div>
        <button
          type="button"
          className="digital-health-icon-button"
          onClick={fetchData}
          disabled={loading}
          aria-label="刷新今日屏幕时间"
          title="刷新"
        >
          <span className={loading ? 'digital-health-refresh--spinning' : undefined}><RefreshIcon /></span>
        </button>
      </div>

      <div className="digital-health-overview__body" aria-live="polite">
        {loading && !data && (
          <div className="digital-health-overview__loading" aria-label="正在加载屏幕时间">
            <div className="gh-skeleton digital-health-overview__skeleton-value" />
            <div className="gh-skeleton digital-health-overview__skeleton-meta" />
          </div>
        )}

        {error && (
          <div className="digital-health-overview__message digital-health-overview__message--error" role="alert">
            <span>暂时无法获取数据。</span>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={fetchData}>重试</button>
          </div>
        )}

        {!loading && !error && data && hasUsage && (
          <>
            <div className="digital-health-overview__usage">
              <span className="digital-health-overview__eyebrow">今日已使用</span>
              <strong>{formatDuration(data.totalSeconds)}</strong>
              <span className="digital-health-overview__updated">{timeAgo(data.reportedAt)}</span>
            </div>

            {hasGoal ? (
              <div className="digital-health-progress">
                <div className="digital-health-progress__meta">
                  <span>目标 {formatDuration(data.dailyGoalSeconds!)}</span>
                  <span className={goalStatus.className}>{goalStatus.label} · {progress}%</span>
                </div>
                <div className="digital-health-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(progress, 100)} aria-label={`今日已使用目标的 ${progress}%`}>
                  <span className={goalStatus.className} style={{ width: `${Math.min(progress, 100)}%` }} />
                </div>
              </div>
            ) : (
              <Link className="digital-health-overview__setup-link" to="/profile#digital-health">设置今日目标</Link>
            )}
          </>
        )}

        {!loading && !error && data && !hasUsage && (
          <div className="digital-health-overview__empty">
            <p>{hasGoal ? `今日目标为 ${formatDuration(data.dailyGoalSeconds!)}，等待首次同步。` : '还没有屏幕时间数据。连接 Time Master 后开始同步。'}</p>
            <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/profile#digital-health">去连接</Link>
          </div>
        )}
      </div>
    </section>
  )
}
