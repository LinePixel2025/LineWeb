import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSiteAnnouncements } from '../contexts/SiteAnnouncementContext'
import SiteAnnouncementDialog from './SiteAnnouncementDialog'
import { ANNOUNCEMENT_LEVEL_LABELS } from '../types/announcement'

/** 全站顶部站点公告条（LineWeb 自有公告；管理员在 /admin/announcements 发布） */
export default function SiteAnnouncementBar() {
  const { visible, announcements, dismiss } = useSiteAnnouncements()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const latest = visible[0] ?? null

  // 管理区不显示站点公告（避免干扰编辑界面）
  if (location.pathname.startsWith('/admin')) return null
  if (!latest) return null

  return (
    <>
      <aside className={`gh-announce-bar gh-announce-bar--${latest.level}`} role="status">
        <span className="gh-announce-bar-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.5v3l1.5.5 8 3.5V3L4 6.5z" />
            <path d="M4.5 10v2.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V10M14 7v2" />
          </svg>
        </span>
        <span className="gh-announce-bar-tag">{ANNOUNCEMENT_LEVEL_LABELS[latest.level]}</span>
        <strong className="gh-announce-bar-title">{latest.title}</strong>
        <span className="gh-announce-bar-text">{latest.content}</span>
        <button type="button" className="gh-announce-bar-more" onClick={() => setOpen(true)}>
          {announcements.length > 1 ? `全部 ${announcements.length} 条` : '查看'}
        </button>
        <button
          type="button"
          className="gh-announce-bar-close"
          aria-label="不再显示这条公告"
          title="不再显示这条公告（公告更新后会重新出现）"
          onClick={() => dismiss(latest)}
        >
          ×
        </button>
      </aside>
      <SiteAnnouncementDialog
        open={open}
        onClose={() => setOpen(false)}
        only={announcements.length > 1 ? null : latest}
      />
    </>
  )
}
