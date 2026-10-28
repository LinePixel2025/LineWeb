import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import api from '../lib/api'
import { useAuth } from './AuthContext'
import {
  DEFAULT_FEATURE_MAP,
  effectiveFeatureEnabled,
  type FeatureKey,
} from '../lib/features'

interface FeatureContextValue {
  features: Record<FeatureKey, boolean>
  ready: boolean
  isEnabled: (key: FeatureKey) => boolean
  refresh: () => Promise<void>
}

const FeatureContext = createContext<FeatureContextValue | null>(null)

export function FeatureProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>({ ...DEFAULT_FEATURE_MAP })
  const [ready, setReady] = useState(false)
  const loadingRef = useRef(false)

  const refresh = useCallback(async () => {
    if (loadingRef.current) return
    loadingRef.current = true
    try {
      const data = await api.get<{ features: Record<FeatureKey, boolean> }>('/features', { noRedirect: true })
      setFeatures({ ...DEFAULT_FEATURE_MAP, ...(data.features ?? {}) })
    } catch {
      // 开关接口失败时保持默认全开，避免整站不可用；服务端仍会拦截被关闭的功能
    } finally {
      loadingRef.current = false
      setReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const isEnabled = useCallback((key: FeatureKey) => {
    if (user?.role === 'admin') return true
    return effectiveFeatureEnabled(features, key)
  }, [features, user?.role])

  const value = useMemo<FeatureContextValue>(() => ({
    features,
    ready,
    isEnabled,
    refresh,
  }), [features, ready, isEnabled, refresh])

  return <FeatureContext.Provider value={value}>{children}</FeatureContext.Provider>
}

export function useFeature() {
  const ctx = useContext(FeatureContext)
  if (!ctx) throw new Error('useFeature must be used within FeatureProvider')
  return ctx
}
