import { useState, useCallback, useRef } from 'react'
import api from '../lib/api'
import type { DriveItem, DriveListResponse, SortOption, CategoryFilter } from '../types/drive'

// === LRU 页面缓存 ===
interface CacheEntry {
  items: DriveItem[]
  total: number
  pageCount: number
}

const PAGE_CACHE = new Map<string, CacheEntry>()
const MAX_CACHE_SIZE = 30

function getCached(key: string): CacheEntry | undefined {
  return PAGE_CACHE.get(key)
}

function setCache(key: string, entry: CacheEntry): void {
  if (PAGE_CACHE.size >= MAX_CACHE_SIZE) {
    const oldest = PAGE_CACHE.keys().next().value
    if (oldest) PAGE_CACHE.delete(oldest)
  }
  PAGE_CACHE.set(key, entry)
}

export function useDriveFiles(
  parentId: number | null,
  sort: SortOption,
  filter: CategoryFilter,
  limit = 50,
) {
  const [items, setItems] = useState<DriveItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // 追踪当前请求 — 避免竞态（快速导航时旧请求覆盖新数据）
  const fetchIdRef = useRef(0)

  const fetchItems = useCallback(async (targetPage?: number, force = false) => {
    const p = targetPage ?? 1
    const cacheKey = `${parentId}:${sort.field}:${sort.direction}:${filter}:${p}:${limit}`
    const fid = ++fetchIdRef.current

    if (!force) {
      const cached = getCached(cacheKey)
      if (cached) {
        setItems(cached.items)
        setTotal(cached.total)
        setTotalPages(cached.pageCount)
        setPage(p)
        setLoading(false)
        setError('')
        return
      }
    }

    setLoading(true)
    setError('')

    try {
      const params = new URLSearchParams()
      if (parentId !== null) params.set('parentId', String(parentId))
      params.set('page', String(p))
      params.set('limit', String(limit))
      const res = await api.get<DriveListResponse>(`/drive/files?${params}`)

      // 竞态检测
      if (fid !== fetchIdRef.current) return

      // 基于 id 去重
      const seen = new Set<number>()
      const deduped = res.data.filter(item => {
        if (seen.has(item.id)) return false
        seen.add(item.id)
        return true
      })

      const entry: CacheEntry = { items: deduped, total: res.total, pageCount: res.pageCount }
      setCache(cacheKey, entry)

      setItems(deduped)
      setTotal(res.total)
      setTotalPages(res.pageCount)
      setPage(p)
    } catch (err: unknown) {
      if (fid !== fetchIdRef.current) return
      const message = err instanceof Error ? err.message : '加载失败'
      setError(message)
      setItems([])
      setTotal(0)
      setTotalPages(1)
      setPage(1)
    } finally {
      if (fid === fetchIdRef.current) setLoading(false)
    }
  }, [parentId, sort.field, sort.direction, filter, limit])

  /** 清除缓存并刷新（创建/删除文件后调用） */
  const invalidate = useCallback(() => {
    PAGE_CACHE.clear()
    fetchItems(1, true)
  }, [fetchItems])

  return {
    items,
    loading,
    error,
    page,
    totalPages,
    total,
    fetchItems,
    invalidate,
  }
}
