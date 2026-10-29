/**
 * 站点公告（LineWeb 自有，与 neko 群公告无关）
 */
export type AnnouncementLevel = 'info' | 'success' | 'warning' | 'danger'

export interface SiteAnnouncement {
  id: number
  title: string
  content: string
  level: AnnouncementLevel
  isActive: boolean
  isPinned: boolean
  authorId: number | null
  author?: { id: number; username: string } | null
  createdAt: string
  updatedAt: string
}

export const ANNOUNCEMENT_LEVEL_LABELS: Record<AnnouncementLevel, string> = {
  info: '通知',
  success: '公告',
  warning: '提醒',
  danger: '重要',
}
