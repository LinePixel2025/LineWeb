import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../lib/api'
import type { DriveItem } from '../types/drive'

export function useDriveSearch() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DriveItem[] | null>(null)
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!query.trim()) {
      setResults(null)
      setSearching(false)
      return
    }

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setSearching(true)
      try {
        const data = await api.get<DriveItem[]>(`/drive/search?q=${encodeURIComponent(query)}`)
        setResults(data)
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [query])

  const clearSearch = useCallback(() => {
    setQuery('')
    setResults(null)
    setSearching(false)
  }, [])

  return {
    query,
    setQuery,
    results,
    searching,
    isSearchActive: results !== null,
    clearSearch,
  }
}
