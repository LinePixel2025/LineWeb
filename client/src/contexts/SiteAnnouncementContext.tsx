import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import api from '../lib/api'
import { useAuth } from './AuthContext'
import type { SiteAnnouncement } from '../types/announcement'

/**
 * 站点公告数据层（LineWeb 自有）
 *
 * 管理员在 /admin/announcements 发布；所有登录用户读到同一份 active 公告。
 * 横幅的「关闭」按 公告 id + updatedAt 记忆在 localStorage：公告被编辑后重新出现。
 */

interface SiteAnnouncementValue {
  announcements: SiteAnnouncement[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  /** 未关闭的生效公告（按置顶 + 时间排序，和接口一致） */
  visible: SiteAnnouncement[]
  isDismissed: (announcement: SiteAnnouncement) => boolean
  dismiss: (announcement: SiteAnnouncement) => void
}

const DISMISS_STORAGE_KEY = 'lineweb_site_announcements_dismissed'

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return new Set(Object.keys(parsed))
  } catch {
    return new Set()
  }
}

function writeDismissed(keys: Set<string>): void {
  try {
    const record: Record<string, number> = {}
    for (const key of keys) record[key] = 1
    window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(record))
  } catch {
    // 隐私模式忽略
  }
}

function dismissalKey(announcement: SiteAnnouncement): string {
  return `${announcement.id}@${announcement.updatedAt}`
}

const SiteAnnouncementContext = createContext<SiteAnnouncementValue | null>(null)

export function SiteAnnouncementProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [announcements, setAnnouncements] = useState<SiteAnnouncement[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed())

  const refresh = useCallback(async () => {
    if (!user) {
      setAnnouncements([])
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await api.get<{ announcements: SiteAnnouncement[] }>('/announcements')
      setAnnouncements(Array.isArray(data?.announcements) ? data.announcements : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载站点公告失败')
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isDismissed = useCallback(
    (announcement: SiteAnnouncement) => dismissed.has(dismissalKey(announcement)),
    [dismissed],
  )

  const dismiss = useCallback((announcement: SiteAnnouncement) => {
    setDismissed((prev) => {
      const next = new Set(prev)
      next.add(dismissalKey(announcement))
      writeDismissed(next)
      return next
    })
  }, [])

  const visible = useMemo(
    () => announcements.filter((announcement) => !dismissed.has(dismissalKey(announcement))),
    [announcements, dismissed],
  )

  const value = useMemo<SiteAnnouncementValue>(
    () => ({ announcements, loading, error, refresh, visible, isDismissed, dismiss }),
    [announcements, loading, error, refresh, visible, isDismissed, dismiss],
  )

  return (
    <SiteAnnouncementContext.Provider value={value}>{children}</SiteAnnouncementContext.Provider>
  )
}

export function useSiteAnnouncements(): SiteAnnouncementValue {
  const context = useContext(SiteAnnouncementContext)
  if (!context) throw new Error('useSiteAnnouncements must be used within SiteAnnouncementProvider')
  return context
}
