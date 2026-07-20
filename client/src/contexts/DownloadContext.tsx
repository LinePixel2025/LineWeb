import { createContext, useContext, useState, useCallback, useRef, useMemo, type ReactNode } from 'react'
import type { DownloadTask, DriveItem } from '../types/drive'

interface DownloadContextValue {
  tasks: DownloadTask[]
  startDownload: (item: DriveItem) => void
  cancelDownload: (id: string) => void
}

const DownloadContext = createContext<DownloadContextValue | null>(null)

const MAX_MEMORY_SIZE = 100 * 1024 * 1024 // 100MB

export function DownloadProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([])
  const downloadIdRef = useRef(0)
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map())

  const removeTaskAfter = useCallback((id: string, delay: number) => {
    setTimeout(() => setTasks(prev => prev.filter(t => t.id !== id)), delay)
  }, [])

  const directDownload = useCallback((item: DriveItem) => {
    const token = localStorage.getItem('lineweb_token')
    const a = document.createElement('a')
    a.href = `/api/drive/download/${item.id}?token=${encodeURIComponent(token!)}`
    a.download = item.name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }, [])

  const streamDownloadWithProgress = useCallback(async (item: DriveItem) => {
    const id = `dl-${++downloadIdRef.current}`
    const abortController = new AbortController()
    abortControllersRef.current.set(id, abortController)

    setTasks(prev => [...prev, {
      id, fileName: item.name, loaded: 0, total: 0, speed: 0, status: 'downloading' as const,
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
      let lastUpdate = Date.now()
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
              ...t, loaded, total: contentLength || loaded, speed: windowSpeed,
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
      removeTaskAfter(id, 3000)
    } catch (err: unknown) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      setTasks(prev => prev.map(t => t.id === id ? {
        ...t, status: (aborted ? 'cancelled' : 'error') as 'cancelled' | 'error',
        error: aborted ? undefined : (err instanceof Error ? err.message : '下载失败'),
      } : t))
      removeTaskAfter(id, aborted ? 1000 : 5000)
    } finally {
      abortControllersRef.current.delete(id)
    }
  }, [removeTaskAfter])

  const startDownload = useCallback((item: DriveItem) => {
    if (item.isFolder) return
    const size = Number(item.size)
    if (size > MAX_MEMORY_SIZE) {
      directDownload(item)
    } else {
      streamDownloadWithProgress(item)
    }
  }, [directDownload, streamDownloadWithProgress])

  const cancelDownload = useCallback((id: string) => {
    abortControllersRef.current.get(id)?.abort()
    abortControllersRef.current.delete(id)
  }, [])

  const value = useMemo<DownloadContextValue>(() => ({
    tasks, startDownload, cancelDownload,
  }), [tasks, startDownload, cancelDownload])

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  )
}

export function useDownload(): DownloadContextValue {
  const ctx = useContext(DownloadContext)
  if (!ctx) throw new Error('useDownload must be used within a DownloadProvider')
  return ctx
}
