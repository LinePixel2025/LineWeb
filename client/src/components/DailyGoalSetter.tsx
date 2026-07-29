import { useState, useEffect, useCallback } from 'react'
import api from '@/lib/api'

interface DailyGoalData {
  dailyGoalSeconds: number | null
  date: string
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
      const res = await api.get<DailyGoalData>('/health/daily-goal')
      setData(res)
      if (res.dailyGoalSeconds != null) {
        setHours(Math.floor(res.dailyGoalSeconds / 3600))
        setMinutes(Math.floor((res.dailyGoalSeconds % 3600) / 60))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchGoal()
  }, [fetchGoal])

  const handleSave = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    const goalSeconds = hours * 3600 + minutes * 60
    try {
      const res = await api.put<DailyGoalData>('/health/daily-goal', { goalSeconds })
      setData(res)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const res = await api.put<DailyGoalData>('/health/daily-goal', { goalSeconds: null })
      setData(res)
      setHours(0)
      setMinutes(0)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err instanceof Error ? err.message : '清除失败')
    } finally {
      setSaving(false)
    }
  }

  const formatGoal = (seconds: number): string => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    if (h > 0 && m > 0) return `${h} 小时 ${m} 分钟`
    if (h > 0) return `${h} 小时`
    return `${m} 分钟`
  }

  return (
    <div style={{ marginTop: '28px', paddingTop: '24px', borderTop: '1px solid var(--gh-border)' }}>
      <span className="profile-label">今日使用目标</span>

      {loading && !data ? (
        <div style={{ padding: '12px 0', fontSize: '0.85rem', color: 'var(--gh-text-tertiary)' }}>
          加载中…
        </div>
      ) : (
        <>
          {data?.dailyGoalSeconds != null && data.dailyGoalSeconds > 0 && (
            <div style={{
              marginBottom: '16px', padding: '10px 14px', borderRadius: '10px',
              background: 'rgba(41,151,255,0.06)', border: '1px solid rgba(41,151,255,0.15)',
              fontSize: '0.9rem', color: 'var(--gh-accent)', fontWeight: 500,
            }}>
              当前目标：{formatGoal(data.dailyGoalSeconds)}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="number"
                min={0}
                max={23}
                value={hours}
                onChange={(e) => setHours(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                className="gh-input"
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--gh-text-secondary)' }}>小时</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="number"
                min={0}
                max={59}
                value={minutes}
                onChange={(e) => setMinutes(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                className="gh-input"
              />
              <span style={{ fontSize: '0.85rem', color: 'var(--gh-text-secondary)' }}>分钟</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={handleSave}
              disabled={saving || (hours === 0 && minutes === 0)}
              className="gh-btn gh-btn--primary gh-btn--sm"
              style={{ opacity: (saving || (hours === 0 && minutes === 0)) ? 0.5 : 1 }}
            >
              {saving ? '保存中…' : '保存目标'}
            </button>
            {data?.dailyGoalSeconds != null && data.dailyGoalSeconds > 0 && (
              <button
                onClick={handleClear}
                disabled={saving}
                className="gh-btn gh-btn--ghost gh-btn--sm"
              >
                清除目标
              </button>
            )}
            {saved && (
              <span style={{ color: 'var(--gh-success)', fontSize: '0.85rem', fontWeight: 500 }}>
                ✓ 已保存
              </span>
            )}
          </div>
        </>
      )}

      {error && (
        <div style={{ color: 'var(--gh-danger)', fontSize: '0.85rem', marginTop: '10px' }}>
          {error}
        </div>
      )}
    </div>
  )
}
