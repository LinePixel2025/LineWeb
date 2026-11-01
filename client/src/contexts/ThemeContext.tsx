import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import api, { getToken } from '../lib/api'
import type { ThemesView } from '../types/theme'

type Theme = 'light' | 'dark' | 'auto'
type ResolvedTheme = 'light' | 'dark'

interface ThemeContextType {
  /* ---------- 明暗主题（既有 API，保持不变） ---------- */
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  /* ---------- LineWeb 全站主题 ---------- */
  /** 已佩戴并持久化的主题 key（'default' 表示默认主题） */
  siteTheme: string
  /** 服务端确认的已佩戴主题（与 siteTheme 同步，单独暴露便于页面判断「是否有未保存的改动」） */
  equippedTheme: string
  /** 正在全站试穿的主题；null 表示没有试穿 */
  previewTheme: string | null
  /** 当前视觉上真正生效的主题 = previewTheme ?? siteTheme（页面徽章用它） */
  activeTheme: string
  /** 最近一次拉取到的商店视图（未登录 / 尚未加载时为 null） */
  themesView: ThemesView | null
  /** 佩戴主题：default 走 DELETE /themes/equipped，其它走 POST /themes/:key/equip；失败抛错交给页面 toast */
  applyTheme: (key: string) => Promise<void>
  /** 恢复默认主题（等价于 applyTheme('default')） */
  clearTheme: () => Promise<void>
  /** 全站试穿：只改 <html> 属性与内存状态，不调接口、不写 localStorage、不扣积分 */
  startPreview: (key: string) => void
  /** 结束试穿，回到已佩戴的主题 */
  endPreview: () => void
  /** 重新拉取商店视图并同步服务端的 equipped（未登录时直接返回，失败抛错） */
  refreshThemes: () => Promise<void>
}

const ThemeContext = createContext<ThemeContextType | null>(null)
const STORAGE_KEY = 'lineweb_theme'
/** 全站主题的本地缓存：只存 key；默认主题时删除该项，避免「空主题」也占一条记录 */
const SITE_THEME_STORAGE_KEY = 'lineweb_site_theme'
const DEFAULT_SITE_THEME = 'default'
const SITE_THEME_KEY_RE = /^[a-z][a-z0-9-]{0,31}$/

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'auto') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return theme
}

/**
 * 清洗主题 key。
 * 这里刻意不维护一份主题白名单：未知 key 不会命中任何主题 CSS（视觉上等同默认），
 * 而挂载后与服务端同步时会被纠正；这样新增主题只需改服务端目录 + themes.css，
 * 不会出现「前端白名单没跟上导致已购主题被清掉」的问题。
 */
function sanitizeSiteThemeKey(value: string | null | undefined): string {
  const key = (value ?? '').trim()
  if (!key || key === DEFAULT_SITE_THEME) return DEFAULT_SITE_THEME
  return SITE_THEME_KEY_RE.test(key) ? key : DEFAULT_SITE_THEME
}

function readStoredSiteTheme(): string {
  try {
    return sanitizeSiteThemeKey(localStorage.getItem(SITE_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_SITE_THEME
  }
}

/** 把主题写到 <html data-lw-theme>；默认主题移除属性，让站点回到原生配色 */
function applySiteThemeAttribute(key: string): void {
  const root = document.documentElement
  if (!key || key === DEFAULT_SITE_THEME) delete root.dataset.lwTheme
  else root.dataset.lwTheme = key
}

function persistSiteTheme(key: string): void {
  try {
    if (key === DEFAULT_SITE_THEME) localStorage.removeItem(SITE_THEME_STORAGE_KEY)
    else localStorage.setItem(SITE_THEME_STORAGE_KEY, key)
  } catch {
    // 隐私模式 / 配额满时 localStorage 可能不可写：只影响下次首屏的本地预置，不影响本次
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored
    } catch {}
    return 'auto'
  })

  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(theme))

  const [siteTheme, setSiteTheme] = useState<string>(() => {
    const stored = readStoredSiteTheme()
    // 首次渲染就把属性写进 <html>：避免先按默认主题绘制再跳到付费主题的闪烁
    applySiteThemeAttribute(stored)
    return stored
  })
  const [equippedTheme, setEquippedTheme] = useState<string>(siteTheme)
  const [previewTheme, setPreviewTheme] = useState<string | null>(null)
  const [themesView, setThemesView] = useState<ThemesView | null>(null)

  /** 卸载清理与 endPreview 需要读「最新的」已佩戴主题，用 ref 避免闭包过期 */
  const siteThemeRef = useRef(siteTheme)
  const previewRef = useRef<string | null>(null)

  useEffect(() => {
    const resolved = resolveTheme(theme)
    setResolvedTheme(resolved)
    document.documentElement.setAttribute('data-theme', resolved)
  }, [theme])

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (theme === 'auto') {
        const resolved = resolveTheme('auto')
        setResolvedTheme(resolved)
        document.documentElement.setAttribute('data-theme', resolved)
      }
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [theme])

  // 已佩戴主题变化时同步 ref 与属性（试穿中则保持试穿主题，由 startPreview/endPreview 接管）
  useEffect(() => {
    siteThemeRef.current = siteTheme
    applySiteThemeAttribute(previewRef.current ?? siteTheme)
  }, [siteTheme])

  // Provider 卸载时把属性还原为已佩戴主题，避免试穿样式残留到下次挂载
  useEffect(() => () => {
    applySiteThemeAttribute(siteThemeRef.current)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try { localStorage.setItem(STORAGE_KEY, t) } catch {}
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next: Theme = prev === 'light' ? 'dark' : prev === 'dark' ? 'auto' : 'light'
      try { localStorage.setItem(STORAGE_KEY, next) } catch {}
      return next
    })
  }, [])

  /** 用服务端视图对齐本地状态：库里的 equipped 是唯一真相源，本地缓存只是首屏预置 */
  const syncView = useCallback((view: ThemesView) => {
    setThemesView(view)
    const next = sanitizeSiteThemeKey(view.equipped)
    setEquippedTheme(next)
    setSiteTheme(next)
    persistSiteTheme(next)
    // 购买成功后服务端会把新主题设为 equipped：试穿的正好是它时，试穿自然结束
    if (previewRef.current === next) {
      previewRef.current = null
      setPreviewTheme(null)
    }
    applySiteThemeAttribute(previewRef.current ?? next)
  }, [])

  const refreshThemes = useCallback(async () => {
    // ThemeProvider 不依赖 AuthContext（避免 Provider 顺序与测试问题），只按 token 是否存在判断登录态
    if (!getToken()) return
    const view = await api.get<ThemesView>('/themes')
    syncView(view)
  }, [syncView])

  // 挂载后同步一次服务端佩戴状态：未登录 / 网络失败都静默保留本地缓存的主题
  useEffect(() => {
    if (!getToken()) return undefined
    let cancelled = false
    api.get<ThemesView>('/themes')
      .then((view) => {
        if (!cancelled) syncView(view)
      })
      .catch(() => {
        // 401 / 断网：不打扰用户，本地缓存的 key 仍会生效（视觉无害，下次进主题页会重新同步）
      })
    return () => { cancelled = true }
  }, [syncView])

  const startPreview = useCallback((key: string) => {
    const target = sanitizeSiteThemeKey(key)
    previewRef.current = target
    setPreviewTheme(target)
    applySiteThemeAttribute(target)
  }, [])

  const endPreview = useCallback(() => {
    previewRef.current = null
    setPreviewTheme(null)
    applySiteThemeAttribute(siteThemeRef.current)
  }, [])

  const applyTheme = useCallback(async (key: string) => {
    const target = sanitizeSiteThemeKey(key)
    if (target === DEFAULT_SITE_THEME) await api.delete('/themes/equipped')
    else await api.post(`/themes/${encodeURIComponent(target)}/equip`)

    // 佩戴成功后立刻结束试穿：用户看到的已经就是正式效果
    previewRef.current = null
    setPreviewTheme(null)
    setSiteTheme(target)
    setEquippedTheme(target)
    persistSiteTheme(target)
    applySiteThemeAttribute(target)
  }, [])

  const clearTheme = useCallback(async () => {
    await applyTheme(DEFAULT_SITE_THEME)
  }, [applyTheme])

  const activeTheme = previewTheme ?? siteTheme

  const value = useMemo(() => ({
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    siteTheme,
    equippedTheme,
    previewTheme,
    activeTheme,
    themesView,
    applyTheme,
    clearTheme,
    startPreview,
    endPreview,
    refreshThemes,
  }), [
    theme,
    resolvedTheme,
    setTheme,
    toggleTheme,
    siteTheme,
    equippedTheme,
    previewTheme,
    activeTheme,
    themesView,
    applyTheme,
    clearTheme,
    startPreview,
    endPreview,
    refreshThemes,
  ])

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
