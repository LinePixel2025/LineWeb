import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../lib/api'

export interface ThumbnailOptions {
  size?: 'small' | 'medium' | 'large'
  quality?: number
}

export interface ThumbnailState {
  url: string | null
  loading: boolean
  error: boolean
}

export function useThumbnails(fileIds: number[], options: ThumbnailOptions = {}) {
  const { size = 'medium', quality = 0.8 } = options
  const [thumbnails, setThumbnails] = useState<Map<number, ThumbnailState>>(new Map())
  const cacheRef = useRef<Map<number, string>>(new Map())

  const loadThumbnail = useCallback(async (fileId: number) => {
    const cached = cacheRef.current.get(fileId)
    if (cached) {
      setThumbnails(prev => new Map(prev).set(fileId, {
        url: cached,
        loading: false,
        error: false
      }))
      return
    }

    setThumbnails(prev => new Map(prev).set(fileId, {
      url: null,
      loading: true,
      error: false
    }))

    try {
      const response = await api.get<{ url: string }>(`/drive/thumbnails/${fileId}?size=${size}&quality=${quality}`)

      cacheRef.current.set(fileId, response.url)

      setThumbnails(prev => new Map(prev).set(fileId, {
        url: response.url,
        loading: false,
        error: false
      }))
    } catch (error) {
      console.error(`Failed to load thumbnail for file ${fileId}:`, error)
      setThumbnails(prev => new Map(prev).set(fileId, {
        url: null,
        loading: false,
        error: true
      }))
    }
  }, [size, quality])

  useEffect(() => {
    fileIds.forEach(fileId => {
      if (!thumbnails.has(fileId)) {
        loadThumbnail(fileId)
      }
    })
  }, [fileIds, loadThumbnail])

  const getThumbnail = useCallback((fileId: number): ThumbnailState => {
    return thumbnails.get(fileId) || { url: null, loading: false, error: false }
  }, [thumbnails])

  const clearCache = useCallback(() => {
    cacheRef.current.clear()
  }, [])

  return {
    getThumbnail,
    clearCache
  }
}
