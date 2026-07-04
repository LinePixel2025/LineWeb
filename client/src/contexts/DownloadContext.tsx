import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import type { DownloadTask, DriveItem } from '../types/drive'

interface DownloadContextValue {
  tasks: DownloadTask[]
  startDownload: (item: DriveItem) => void
  cancelDownload: (id: string) => void
}

const DownloadContext = createContext<DownloadContextValue | null>(null)

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const downloadIdRef = useRef(0)
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  const startDownload = useCallback(async (item: DriveItem) => {
    if (item.isFolder) return

    const id = `dl-${++downloadIdRef.current}`
    const abortController = new AbortController()
    abortControllersRef.current.set(id, abortController)

    setTasks(prev => [...prev, {
      id, fileName: item.name, loaded: 0, total: 0, speed: 0, status: 'downloading',
    }])

    try {
      const token = localStorage.getItem('lineweb_token')
      const res = await fetch(`/api/drive/download/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: abortController.signal,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || '下载失败')
      }

      const contentLength = parseInt(res.headers.get('X-Content-Length') || '0', 10)
      const reader = res.body!.getReader()
      const chunks: Uint8Array[] = []
      let loaded = 0
      const startTime = Date.now()
      let lastUpdate = startTime
      let lastLoaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        loaded += value.length
        const now = Date.now()

        if (now - lastUpdate > 200) {
          const windowSpeed = (loaded - lastLoaded) / ((now - lastUpdate) / 1000)
          lastUpdate = now
          lastLoaded = loaded

          setTasks(prev =>
            prev.map(t => t.id === id ? {
              ...t, loaded, total: contentLength || loaded,
              speed: windowSpeed,
            } : t)
          )
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: item.mimeType || undefined })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = item.name
      a.click()
      URL.revokeObjectURL(url)

      setTasks(prev =>
        prev.map(t => t.id === id ? { ...t, status: 'complete' as const, loaded, total: contentLength || loaded } : t)
      )
      setTimeout(() => setTasks(prev => prev.filter(t => t.id !== id)), 3000)
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      if (aborted) {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'cancelled' as const } : t))
      } else {
        const message = err instanceof Error ? err.message : '下载失败'
        setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'error' as const, error: message } : t))
      }
      setTimeout(() => setTasks(prev => prev.filter(t => t.id !== id)), 5000)
    } finally {
      abortControllersRef.current.delete(id)
    }
  }, [])

  const cancelDownload = useCallback((id: string) => {
    abortControllersRef.current.get(id)?.abort()
    abortControllersRef.current.delete(id)
  }, [])

  return (
    <DownloadContext.Provider value={{ tasks, startDownload, cancelDownload }}>
      {children}
    </DownloadContext.Provider>
  )
}

export function useDownload(): DownloadContextValue {
  const ctx = useContext(DownloadContext)
  if (!ctx) throw new Error('useDownload must be used within a DownloadProvider')
  return ctx
}
