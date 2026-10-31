import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import api from '@/lib/api'
import Icon from '@/components/ui/Icon'

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
    <section className="dh-card" aria-labelledby="digital-health-overview-title">
      <header className="dh-head">
        <span className="dh-icon" aria-hidden="true"><Icon name="heart" size={19} /></span>
        <div className="dh-heading">
          <h2 id="digital-health-overview-title">数字健康</h2>
          <p>今日屏幕使用情况</p>
        </div>
        <button
          type="button"
          className="dh-refresh"
          onClick={fetchData}
          disabled={loading}
          aria-label="刷新今日屏幕时间"
          title="刷新"
        >
          <span className={loading ? 'dh-spin' : undefined}><Icon name="refresh" size={16} /></span>
        </button>
      </header>

      <div className="dh-body">
        <div className="dh-today" aria-live="polite">
          {loading && !data && (
            <div className="dh-skeleton" aria-label="正在加载屏幕时间">
              <span className="gh-skeleton dh-skeleton-value" />
              <span className="gh-skeleton dh-skeleton-meta" />
            </div>
          )}

          {error && (
            <div className="dh-error" role="alert">
              <span>暂时无法获取数据。</span>
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={fetchData}>重试</button>
            </div>
          )}

          {!loading && !error && data && hasUsage && (
            <>
              <span className="dh-eyebrow">今日已使用</span>
              <strong className="dh-value">{formatDuration(data.totalSeconds)}</strong>
              <span className="dh-updated">{timeAgo(data.reportedAt)}</span>

              {hasGoal ? (
                <div className="dh-progress">
                  <div className="dh-progress-meta">
                    <span>目标 {formatDuration(data.dailyGoalSeconds!)}</span>
                    <span className={`dh-progress-status ${goalStatus.className}`}>{goalStatus.label} · {progress}%</span>
                  </div>
                  <div
                    className="dh-progress-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.min(progress, 100)}
                    aria-label={`今日已使用目标的 ${progress}%`}
                  >
                    <span className={goalStatus.className} style={{ width: `${Math.min(progress, 100)}%` }} />
                  </div>
                </div>
              ) : (
                <Link className="dh-link" to="/profile#digital-health">设置今日目标</Link>
              )}
            </>
          )}

          {!loading && !error && data && !hasUsage && (
            <div className="dh-empty">
              <span className="dh-eyebrow">今日已使用</span>
              <strong className="dh-value dh-value--empty">0 分钟</strong>
              <p>{hasGoal ? `今日目标为 ${formatDuration(data.dailyGoalSeconds!)}，等待首次同步。` : '还没有屏幕时间数据。连接 Time Master 后开始同步。'}</p>
              <Link className="gh-btn gh-btn--secondary gh-btn--sm" to="/profile#digital-health">去连接</Link>
            </div>
          )}
        </div>

        <div className="dh-heat">
          <div className="dh-heat-head">
            <div className="dh-heat-heading">
              <h3 id="digital-health-heatmap-title">使用热力图</h3>
              <p>{mode === 'week' ? '近 7 天' : '近 30 天'}电脑使用情况</p>
            </div>
            <div className="dh-toggle" role="group" aria-label="热力图时间范围">
              <button
                type="button"
                className={`dh-toggle-btn${mode === 'week' ? ' dh-toggle-btn--active' : ''}`}
                onClick={() => setMode('week')}
                aria-pressed={mode === 'week'}
              >周</button>
              <button
                type="button"
                className={`dh-toggle-btn${mode === 'month' ? ' dh-toggle-btn--active' : ''}`}
                onClick={() => setMode('month')}
                aria-pressed={mode === 'month'}
              >月</button>
            </div>
          </div>

          {heatmapError ? (
            <div className="dh-heat-error" role="alert">
              <span>暂时无法获取使用记录。</span>
              <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => fetchHeatmap(mode)}>重试</button>
            </div>
          ) : heatmapDays.length === 0 ? (
            <div className={`dh-grid dh-grid--${mode}`} aria-label="正在加载使用记录">
              {Array.from({ length: heatmapCellCount }, (_, index) => (
                <div key={index} className="gh-skeleton dh-cell" />
              ))}
            </div>
          ) : (
            <>
              <div className={`dh-grid dh-grid--${mode}${heatmapLoading ? ' dh-grid--loading' : ''}`}>
                {heatmapDays.map((day) => (
                  <div
                    key={day.date}
                    className={`dh-cell dh-cell--l${usageLevel(day.totalSeconds)}${day.isToday ? ' dh-cell--today' : ''}`}
                    title={formatHeatmapTooltip(day)}
                  >
                    <span className="dh-cell-label">{mode === 'month' ? day.dayOfMonth : day.weekday}</span>
                  </div>
                ))}
              </div>

              <div className="dh-heat-foot">
                <span>累计 {formatDuration(heatmapTotal)}</span>
                <span>日均 {formatDuration(Math.round(heatmapAverage))}</span>
                <span className="dh-legend">
                  少
                  {[0, 1, 2, 3, 4].map((level) => (
                    <i key={level} className={`dh-legend-swatch dh-cell--l${level}`} aria-hidden="true" />
                  ))}
                  多
                </span>
              </div>
              {heatmapTotal === 0 && (
                <p className="dh-heat-empty">暂无使用记录，数据将从 Time Master 首次同步起累积。</p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
