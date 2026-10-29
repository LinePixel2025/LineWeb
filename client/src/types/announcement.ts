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
  /** 首次发布要求用户点「我已知晓」；存量公告为 false */
  requireAck: boolean
  /** 本人确认时间（ISO）；null = 未确认。仅登录用户读取接口下发 */
  acknowledgedAt?: string | null
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
