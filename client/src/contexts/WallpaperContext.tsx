import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import api from '../lib/api'

interface WallpaperContextType {
  bgUrl: string
  copyright: string
  loaded: boolean
  loading: boolean
  refresh: () => void
}

const WallpaperContext = createContext<WallpaperContextType | null>(null)

export function WallpaperProvider({ children }: { children: ReactNode }) {
  const [bgUrl, setBgUrl] = useState('')
  const [copyright, setCopyright] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)

  const fetchWallpaper = (cb?: () => void) => {
    setLoading(true)
    setLoaded(false)
    api.get<{ url: string; copyright: string }>('/bing-wallpaper')
      .then((data) => {
        const sep = data.url.includes('?') ? '&' : '?'
        setBgUrl(`${data.url}${sep}_t=${Date.now()}`)
        setCopyright(data.copyright)
        setLoaded(true)
      })
      .catch((err) => { console.error('Failed to fetch wallpaper:', err) })
      .finally(() => { setLoading(false); cb?.() })
  }

  // 首次加载
  useEffect(() => { fetchWallpaper() }, [])

  const refresh = () => { fetchWallpaper() }

  return (
    <WallpaperContext.Provider value={{ bgUrl, copyright, loaded, loading, refresh }}>
      {children}
    </WallpaperContext.Provider>
  )
}

export function useWallpaper() {
  const ctx = useContext(WallpaperContext)
  if (!ctx) throw new Error('useWallpaper must be used within WallpaperProvider')
  return ctx
}
