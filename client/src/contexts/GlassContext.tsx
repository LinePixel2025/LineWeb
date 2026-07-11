import { createContext, useContext, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth } from './AuthContext'

interface GlassContextType {
  glassEnabled: boolean
  toggleGlass: () => void
}

const GlassContext = createContext<GlassContextType | null>(null)

export function GlassProvider({ children }: { children: ReactNode }) {
  const { user, updateSettings } = useAuth()

  const glassEnabled = useMemo(() => {
    if (!user?.settings) return true
    try {
      const parsed = JSON.parse(user.settings)
      return parsed.glass !== false // default true
    } catch {
      return true
    }
  }, [user?.settings])

  // Sync data-glass attribute on <html>
  useEffect(() => {
    document.documentElement.dataset.glass = glassEnabled ? 'on' : 'off'
  }, [glassEnabled])

  const toggleGlass = useCallback(async () => {
    if (!user?.settings) {
      await updateSettings(JSON.stringify({ glass: false }))
      return
    }
    try {
      const parsed = JSON.parse(user.settings)
      const newValue = parsed.glass !== false ? false : true
      await updateSettings(JSON.stringify({ ...parsed, glass: newValue }))
    } catch {
      await updateSettings(JSON.stringify({ glass: false }))
    }
  }, [user?.settings, updateSettings])

  const value = useMemo<GlassContextType>(() => ({
    glassEnabled,
    toggleGlass,
  }), [glassEnabled, toggleGlass])

  return (
    <GlassContext.Provider value={value}>
      {children}
    </GlassContext.Provider>
  )
}

export function useGlass() {
  const ctx = useContext(GlassContext)
  if (!ctx) throw new Error('useGlass must be used within GlassProvider')
  return ctx
}
