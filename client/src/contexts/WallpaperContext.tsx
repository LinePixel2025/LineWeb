import { createContext, useContext, useEffect, useState, useRef, useCallback, useMemo, type ReactNode } from 'react'
import { useAuth } from './AuthContext'
import api from '../lib/api'

type BgType = 'wallpaper' | 'solid'
type WallpaperMode = 'latest' | 'random' | 'date'

interface BackgroundSettings {
  type: BgType
  solidColor?: string
  wallpaperMode?: WallpaperMode
  wallpaperDate?: string
}

interface WallpaperData {
  url: string
  copyright: string
  title?: string
  headline?: string
  date?: string
}

interface HistoryItem {
  date: string
  title: string
  copyright: string
  image_url_4k?: string
  image_url_1080?: string
  image_url?: string
}

interface HistoryResponse {
  items: HistoryItem[]
  pagination?: { page: number; page_size: number; total: number }
}

interface WallpaperContextType {
  bgUrl: string
  bgType: BgType
  solidColor: string
  copyright: string
  wallpaperTitle: string
  wallpaperDate: string
  wallpaperMode: WallpaperMode
  loaded: boolean
  loading: boolean
  refresh: () => void
  /** 按传入参数抓取壁纸（用于预览） */
  previewWallpaper: (opts: { mode?: WallpaperMode; date?: string }) => void
  /** 历史壁纸列表 */
  history: HistoryItem[]
  /** 加载历史列表 */
  loadHistory: () => void
  historyLoading: boolean
}

const WallpaperContext = createContext<WallpaperContextType | null>(null)

const DEFAULT_SOLID_COLOR = '#0d0d0f'

export function WallpaperProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [bgUrl, setBgUrl] = useState('')
  const [bgType, setBgType] = useState<BgType>('wallpaper')
  const [solidColor, setSolidColor] = useState(DEFAULT_SOLID_COLOR)
  const [copyright, setCopyright] = useState('')
  const [wallpaperTitle, setWallpaperTitle] = useState('')
  const [wallpaperDate, setWallpaperDate] = useState('')
  const [wallpaperMode, setWallpaperMode] = useState<WallpaperMode>('latest')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const fetchedOnce = useRef(false)
  const abortRef = useRef<AbortController | null>(null)

  /** 核心抓取方法 */
  const fetchWallpaper = useCallback(async (opts?: { mode?: WallpaperMode; date?: string }) => {
    const mode = opts?.mode || wallpaperMode
    const date = opts?.date

    // 取消上一次未完成的请求
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setLoaded(false)

    const params = new URLSearchParams()
    if (mode === 'random') params.set('mode', 'random')
    if (mode === 'date' && date) { params.set('mode', 'date'); params.set('date', date) }
    const qs = params.toString()

    try {
      const data = await api.get<WallpaperData>(`/bing-wallpaper${qs ? `?${qs}` : ''}`, { signal: controller.signal })
      // 移除 _t 缓存破坏参数 — 让浏览器 HTTP 缓存 + ETag 自然工作
      // ContrastContext 的 _t 剥离逻辑保留作向后兼容
      setBgUrl(data.url)
      setCopyright(data.copyright)
      setWallpaperTitle(data.title || '')
      setWallpaperDate(data.date || '')
      setLoaded(true)
    } catch (err: unknown) {
      // 忽略 abort 导致的取消
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.error('Failed to fetch wallpaper:', err)
    } finally {
      setLoading(false)
    }
  }, [wallpaperMode])

  // 组件卸载时取消未完成的请求
  useEffect(() => {
    return () => { abortRef.current?.abort() }
  }, [])

  /** 首次挂载抓取一次 */
  useEffect(() => {
    if (!fetchedOnce.current) {
      fetchedOnce.current = true
      fetchWallpaper()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** 公开版：按参数预览壁纸 */
  const previewWallpaper = useCallback((opts: { mode?: WallpaperMode; date?: string }) => {
    // 如果 mode 是 date 且提供了 date，切换 wallpaperMode 状态
    if (opts.mode) setWallpaperMode(opts.mode)
    fetchWallpaper(opts)
  }, [fetchWallpaper])

  /** 监听 user.settings 自动应用 */
  useEffect(() => {
    if (user === undefined || !fetchedOnce.current) return

    if (!user || !user.settings) {
      // 未登录 / 无设置 → 默认 wallpaper
      setBgType('wallpaper')
      setWallpaperMode('latest')
      setSolidColor(DEFAULT_SOLID_COLOR)
      return
    }

    try {
      const parsed = JSON.parse(user.settings) as { background?: BackgroundSettings }
      const bg = parsed?.background
      if (!bg) return

      setBgType(bg.type)

      if (bg.type === 'solid') {
        setSolidColor(bg.solidColor || DEFAULT_SOLID_COLOR)
        setBgUrl(''); setCopyright(''); setLoaded(false)
        // 图片立即设为 0
      } else {
        setSolidColor(DEFAULT_SOLID_COLOR)
        const newMode = bg.wallpaperMode || 'latest'
        setWallpaperMode(newMode)

        // 只在首次应用或 mode 为 date 时自动抓取
        if (newMode === 'date' && bg.wallpaperDate) {
          fetchWallpaper({ mode: 'date', date: bg.wallpaperDate })
        } else if (newMode === 'random') {
          fetchWallpaper({ mode: 'random' })
        } else if (!bgUrl) {
          fetchWallpaper()
        }
      }
    } catch {
      // 静默降级
    }
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(() => {
    if (bgType === 'wallpaper') fetchWallpaper()
  }, [bgType, fetchWallpaper])

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    api.get<HistoryResponse>('/bing-wallpaper?history=true')
      .then((data) => setHistory(data.items || []))
      .catch((err) => console.error('Failed to fetch wallpaper history:', err))
      .finally(() => setHistoryLoading(false))
  }, [])

  // 记忆化 Provider value — 避免每次渲染创建新对象导致消费者无谓重渲染
  const value = useMemo<WallpaperContextType>(() => ({
    bgUrl, bgType, solidColor, copyright,
    wallpaperTitle, wallpaperDate, wallpaperMode,
    loaded, loading, refresh,
    previewWallpaper,
    history, loadHistory, historyLoading,
  }), [bgUrl, bgType, solidColor, copyright, wallpaperTitle, wallpaperDate, wallpaperMode, loaded, loading, refresh, previewWallpaper, history, loadHistory, historyLoading])

  return (
    <WallpaperContext.Provider value={value}>
      {children}
    </WallpaperContext.Provider>
  )
}

export function useWallpaper() {
  const ctx = useContext(WallpaperContext)
  if (!ctx) throw new Error('useWallpaper must be used within WallpaperProvider')
  return ctx
}
