import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../lib/api'
import { useFeature } from '../../contexts/FeatureContext'
import {
  FEATURE_DEFINITIONS,
  type FeatureDefinition,
  type FeatureKey,
} from '../../lib/features'

interface FeatureResponse {
  features: Record<FeatureKey, boolean>
  definitions?: readonly FeatureDefinition[]
}

export default function FeatureAdminPage() {
  const [features, setFeatures] = useState<Record<FeatureKey, boolean> | null>(null)
  const [definitions, setDefinitions] = useState<readonly FeatureDefinition[]>(FEATURE_DEFINITIONS)
  const [saving, setSaving] = useState<FeatureKey | null>(null)
  const [error, setError] = useState('')
  const { refresh } = useFeature()

  const load = useCallback(async () => {
    setError('')
    try {
      const data = await api.get<FeatureResponse>('/admin/features')
      setFeatures(data.features)
      if (data.definitions?.length) setDefinitions(data.definitions)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载功能开关失败')
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    const map = new Map<string, FeatureDefinition[]>()
    for (const def of definitions) {
      const list = map.get(def.group) ?? []
      list.push(def)
      map.set(def.group, list)
    }
    return [...map.entries()]
  }, [definitions])

  const toggle = async (def: FeatureDefinition) => {
    if (!features || saving) return
    if ((def.key === 'gamesSingle' || def.key === 'gamesOnline') && !features.games) return
    const next = !features[def.key]
    setError('')
    setSaving(def.key)
    setFeatures({ ...features, [def.key]: next })
    try {
      const data = await api.put<FeatureResponse>(`/admin/features/${def.key}`, { enabled: next })
      setFeatures(data.features)
      void refresh()
    } catch (err) {
      setFeatures({ ...features, [def.key]: !next })
      setError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <div>
          <h1 className="gh-page-title">功能开关</h1>
          <p className="gh-page-subtitle">
            模块级全局开关。关闭后普通用户会隐藏入口并收到 403；管理员始终可以访问。
          </p>
        </div>
        <button type="button" className="gh-btn gh-btn--secondary gh-btn--md" onClick={() => void load()}>
          刷新
        </button>
      </div>

      {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}

      {!features ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px' }}>
          <div className="gh-spinner" />
        </div>
      ) : (
        <div className="gh-feature-groups">
          {groups.map(([group, list]) => (
            <section key={group} className="gh-box gh-feature-group">
              <h2 className="gh-feature-group-title">{group}</h2>
              {list.map((def) => {
                const subGame = def.key === 'gamesSingle' || def.key === 'gamesOnline'
                const disabled = saving === def.key || (subGame && !features.games)
                const enabled = !!features[def.key]
                return (
                  <div key={def.key} className={`gh-feature-row ${disabled ? 'gh-feature-row--disabled' : ''}`}>
                    <div className="gh-feature-copy">
                      <div className="gh-feature-label">
                        {def.label}
                        {subGame && !features.games && <span className="gh-text-tertiary">（游戏总开关已关闭）</span>}
                      </div>
                      <div className="gh-feature-desc">{def.description}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      aria-label={`${def.label}：${enabled ? '已开启' : '已关闭'}`}
                      className={`gh-feature-switch ${enabled ? 'gh-feature-switch--on' : ''}`}
                      disabled={disabled}
                      onClick={() => void toggle(def)}
                    >
                      <span className="gh-feature-switch-knob" />
                    </button>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
