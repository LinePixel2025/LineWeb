import { useCallback, useEffect, useRef, useState } from 'react'
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

interface ScreenTimeLogEntry {
  date: string
  totalSeconds: number
  dailyGoalSeconds: number | null
}

interface HeatmapDay {
  date: string
  totalSeconds: number
  weekday: string
  dayOfMonth: number
  isToday: boolean
}

type HeatmapMode = 'week' | 'month'

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

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

function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function buildHeatmapDays(mode: HeatmapMode): HeatmapDay[] {
  const today = new Date()
  const count = mode === 'week' ? 7 : 30
  const days: HeatmapDay[] = []
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    days.push({
      date: toDateString(date),
      totalSeconds: 0,
      weekday: WEEKDAY_LABELS[date.getDay()],
      dayOfMonth: date.getDate(),
      isToday: offset === 0,
    })
  }
  return days
}

function usageLevel(totalSeconds: number): 0 | 1 | 2 | 3 | 4 {
  if (totalSeconds <= 0) return 0
  const hours = totalSeconds / 3600
  if (hours < 1) return 1
  if (hours < 3) return 2
  if (hours < 6) return 3
  return 4
}

function formatHeatmapTooltip(day: HeatmapDay): string {
  const month = Number(day.date.slice(5, 7))
  const dayOfMonth = Number(day.date.slice(8, 10))
  const usage = day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : '无使用记录'
  return `${month}月${dayOfMonth}日 · ${usage}`
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
  const [mode, setMode] = useState<HeatmapMode>('month')
  const [heatmapDays, setHeatmapDays] = useState<HeatmapDay[]>([])
  const [heatmapLoading, setHeatmapLoading] = useState(false)
  const [heatmapError, setHeatmapError] = useState(false)
  const modeRef = useRef<HeatmapMode>('month')

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

  const fetchHeatmap = useCallback(async (nextMode: HeatmapMode) => {
    try {
      setHeatmapLoading(true)
      setHeatmapError(false)
      const days = buildHeatmapDays(nextMode)
      const from = days[0].date
      const to = days[days.length - 1].date
      const result = await api.get<{ logs: ScreenTimeLogEntry[] }>(`/health/screen-time/range?from=${from}&to=${to}`)
      if (modeRef.current !== nextMode) return // 丢弃切换前发出的过期响应
      const secondsByDate = new Map(result.logs.map((log) => [log.date, log.totalSeconds]))
      setHeatmapDays(days.map((day) => ({ ...day, totalSeconds: secondsByDate.get(day.date) ?? 0 })))
    } catch {
      setHeatmapError(true)
    } finally {
      setHeatmapLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    fetchData()
  }, [user, fetchData])

  useEffect(() => {
    modeRef.current = mode
    if (!user) return
    fetchHeatmap(mode)
  }, [user, mode, fetchHeatmap])

  if (!user) return null

  const hasUsage = (data?.totalSeconds ?? 0) > 0
  const hasGoal = (data?.dailyGoalSeconds ?? 0) > 0
  const progress = hasGoal && data ? Math.round((data.totalSeconds / data.dailyGoalSeconds!) * 100) : 0
  const goalStatus = getGoalStatus(progress)
  const heatmapTotal = heatmapDays.reduce((sum, day) => sum + day.totalSeconds, 0)
  const heatmapAverage = heatmapDays.length > 0 ? heatmapTotal / heatmapDays.length : 0
  const heatmapCellCount = mode === 'week' ? 7 : 30

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

      <div className="digital-health-heatmap">
        <div className="digital-health-heatmap__header">
          <div className="digital-health-heatmap__heading">
            <h3 id="digital-health-heatmap-title">使用热力图</h3>
            <p>{mode === 'week' ? '近 7 天' : '近 30 天'}电脑使用情况</p>
          </div>
          <div className="digital-health-heatmap__toggle" role="group" aria-label="热力图时间范围">
            <button
              type="button"
              className={`digital-health-heatmap__toggle-btn${mode === 'week' ? ' digital-health-heatmap__toggle-btn--active' : ''}`}
              onClick={() => setMode('week')}
              aria-pressed={mode === 'week'}
            >周</button>
            <button
              type="button"
              className={`digital-health-heatmap__toggle-btn${mode === 'month' ? ' digital-health-heatmap__toggle-btn--active' : ''}`}
              onClick={() => setMode('month')}
              aria-pressed={mode === 'month'}
            >月</button>
          </div>
        </div>

        {heatmapError ? (
          <div className="digital-health-heatmap__message digital-health-heatmap__message--error" role="alert">
            <span>暂时无法获取使用记录。</span>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => fetchHeatmap(mode)}>重试</button>
          </div>
        ) : heatmapDays.length === 0 ? (
          <div className="digital-health-heatmap__grid" aria-label="正在加载使用记录">
            {Array.from({ length: heatmapCellCount }, (_, index) => (
              <div key={index} className="gh-skeleton digital-health-heatmap__cell" />
            ))}
          </div>
        ) : (
          <>
            <div className={`digital-health-heatmap__grid${heatmapLoading ? ' digital-health-heatmap__grid--loading' : ''}`}>
              {heatmapDays.map((day) => (
                <div
                  key={day.date}
                  className={`digital-health-heatmap__cell digital-health-heatmap__cell--l${usageLevel(day.totalSeconds)}${day.isToday ? ' digital-health-heatmap__cell--today' : ''}`}
                  title={formatHeatmapTooltip(day)}
                >
                  {mode === 'month' && <span className="digital-health-heatmap__date">{day.dayOfMonth}</span>}
                </div>
              ))}
            </div>

            {mode === 'week' && (
              <div className="digital-health-heatmap__weekdays">
                {heatmapDays.map((day) => <span key={day.date}>{day.weekday}</span>)}
              </div>
            )}

            <div className="digital-health-heatmap__summary">
              <span>累计 {formatDuration(heatmapTotal)}</span>
              <span>日均 {formatDuration(Math.round(heatmapAverage))}</span>
            </div>

            {heatmapTotal === 0 && (
              <p className="digital-health-heatmap__empty-hint">暂无使用记录，数据将从 Time Master 首次同步起累积。</p>
            )}

            <div className="digital-health-heatmap__legend">
              <span>少</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <span key={level} className={`digital-health-heatmap__legend-swatch digital-health-heatmap__cell--l${level}`} aria-hidden="true" />
              ))}
              <span>多</span>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
