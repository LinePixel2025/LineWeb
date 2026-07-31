import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'

interface DailyGoalData {
  dailyGoalSeconds: number | null
  date: string
}

function formatGoal(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0 && minutes > 0) return `${hours} 小时 ${minutes} 分钟`
  if (hours > 0) return `${hours} 小时`
  return `${minutes} 分钟`
}

export default function DailyGoalSetter() {
  const [data, setData] = useState<DailyGoalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [hours, setHours] = useState(0)
  const [minutes, setMinutes] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const fetchGoal = useCallback(async () => {
    try {
      setLoading(true)
      setError('')
      const result = await api.get<DailyGoalData>('/health/daily-goal')
      setData(result)
      if (result.dailyGoalSeconds != null) {
        setHours(Math.floor(result.dailyGoalSeconds / 3600))
        setMinutes(Math.floor((result.dailyGoalSeconds % 3600) / 60))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载目标失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGoal()
  }, [fetchGoal])

  const updateGoal = async (goalSeconds: number | null) => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const result = await api.put<DailyGoalData>('/health/daily-goal', { goalSeconds })
      setData(result)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存目标失败，请稍后重试。')
    } finally {
      setSaving(false)
    }
  }

  const goalSeconds = hours * 3600 + minutes * 60
  const hasCurrentGoal = (data?.dailyGoalSeconds ?? 0) > 0

  return (
    <section className="digital-health-settings__section" aria-labelledby="daily-goal-title">
      <div className="digital-health-settings__section-header">
        <div>
          <h3 id="daily-goal-title">今日使用目标</h3>
          <p>达到上限时，首页会提示你暂时离开屏幕。</p>
        </div>
        {hasCurrentGoal && <span className="gh-badge gh-badge--accent">当前目标：{formatGoal(data!.dailyGoalSeconds!)}</span>}
      </div>

      {loading && !data ? (
        <div className="digital-health-settings__loading">加载中…</div>
      ) : (
        <div className="digital-health-goal-form">
          <div className="digital-health-goal-form__fields">
            <label>
              <span>小时</span>
              <input type="number" min={0} max={23} value={hours} onChange={(event) => setHours(Math.max(0, Math.min(23, parseInt(event.target.value, 10) || 0)))} className="gh-input" inputMode="numeric" />
            </label>
            <label>
              <span>分钟</span>
              <input type="number" min={0} max={59} value={minutes} onChange={(event) => setMinutes(Math.max(0, Math.min(59, parseInt(event.target.value, 10) || 0)))} className="gh-input" inputMode="numeric" />
            </label>
          </div>
          <div className="digital-health-goal-form__actions">
            <button type="button" onClick={() => updateGoal(goalSeconds)} disabled={saving || goalSeconds === 0} className="gh-btn gh-btn--primary gh-btn--sm">
              {saving ? '保存中…' : '保存目标'}
            </button>
            {hasCurrentGoal && (
              <button type="button" onClick={() => { setHours(0); setMinutes(0); updateGoal(null) }} disabled={saving} className="gh-btn gh-btn--ghost gh-btn--sm">清除目标</button>
            )}
            <span className="digital-health-form-status" aria-live="polite">{saved ? '✓ 已保存' : ''}</span>
          </div>
        </div>
      )}

      {error && <p className="digital-health-form-error" role="alert">{error}</p>}
    </section>
  )
}
