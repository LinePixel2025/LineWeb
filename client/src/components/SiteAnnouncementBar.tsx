import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSiteAnnouncements } from '../contexts/SiteAnnouncementContext'
import SiteAnnouncementDialog from './SiteAnnouncementDialog'
import { ANNOUNCEMENT_LEVEL_LABELS } from '../types/announcement'

/** 全站顶部站点公告条（LineWeb 自有公告；管理员在 /admin/announcements 发布） */
export default function SiteAnnouncementBar() {
  const { visible, pendingAck, announcements, dismiss, acknowledge } = useSiteAnnouncements()
  const [open, setOpen] = useState(false)
  const [ackBusy, setAckBusy] = useState(false)
  const location = useLocation()
  // 需要确认的公告优先展示（不点「我已知晓」不会消失）
  const latest = pendingAck[0] ?? visible[0] ?? null
  const needAck = !!latest && latest.requireAck && !latest.acknowledgedAt

  // 管理区不显示站点公告（避免干扰编辑界面）
  if (location.pathname.startsWith('/admin')) return null
  if (!latest) return null

  const handleAck = async () => {
    if (!latest || ackBusy) return
    setAckBusy(true)
    try {
      await acknowledge(latest)
    } catch {
      // 失败时保持横幅，用户可重试；详细错误在弹窗里展示
    } finally {
      setAckBusy(false)
    }
  }

  return (
    <>
      <aside className={`gh-announce-bar gh-announce-bar--${latest.level} ${needAck ? 'gh-announce-bar--ack' : ''}`} role="status">
        <span className="gh-announce-bar-icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 6.5v3l1.5.5 8 3.5V3L4 6.5z" />
            <path d="M4.5 10v2.5a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V10M14 7v2" />
          </svg>
        </span>
        <span className="gh-announce-bar-tag">{ANNOUNCEMENT_LEVEL_LABELS[latest.level]}</span>
        <strong className="gh-announce-bar-title">{latest.title}</strong>
        <span className="gh-announce-bar-text">{latest.content}</span>
        {needAck ? (
          <button
            type="button"
            className="gh-announce-bar-ack"
            disabled={ackBusy}
            onClick={() => void handleAck()}
          >
            {ackBusy ? '确认中…' : '我已知晓'}
          </button>
        ) : (
          <button type="button" className="gh-announce-bar-close" aria-label="不再显示这条公告" title="不再显示这条公告（公告更新后会重新出现）" onClick={() => dismiss(latest)}>
            ×
          </button>
        )}
        <button type="button" className="gh-announce-bar-more" onClick={() => setOpen(true)}>
          {announcements.length > 1 ? `全部 ${announcements.length} 条` : '查看'}
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
