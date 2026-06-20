import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import api from '../lib/api'

interface WallpaperContextType {
  bgUrl: string
  copyright: string
  loaded: boolean
}

const WallpaperContext = createContext<WallpaperContextType | null>(null)

export function WallpaperProvider({ children }: { children: ReactNode }) {
  const [bgUrl, setBgUrl] = useState('')
  const [copyright, setCopyright] = useState('')
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    api.get<{ url: string; copyright: string }>('/bing-wallpaper')
      .then((data) => {
        setBgUrl(data.url)
        setCopyright(data.copyright)
        setLoaded(true)
      })
      .catch((err) => { console.error('Failed to fetch wallpaper:', err) })
  }, [])

  return (
    <WallpaperContext.Provider value={{ bgUrl, copyright, loaded }}>
      {children}
    </WallpaperContext.Provider>
  )
}

export function useWallpaper() {
  const ctx = useContext(WallpaperContext)
  if (!ctx) throw new Error('useWallpaper must be used within WallpaperProvider')
  return ctx
}
