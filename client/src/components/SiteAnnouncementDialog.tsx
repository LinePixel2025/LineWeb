import { useEffect } from 'react'
import { useSiteAnnouncements } from '../contexts/SiteAnnouncementContext'
import {
  ANNOUNCEMENT_LEVEL_LABELS,
  type SiteAnnouncement,
} from '../types/announcement'

interface Props {
  open: boolean
  onClose: () => void
  /** 只展示这一条（聊天页公告横幅点开时用）；省略则展示全部生效公告 */
  only?: SiteAnnouncement | null
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** 站点公告阅读弹窗（LineWeb 自有；与群公告弹窗互不影响） */
export default function SiteAnnouncementDialog({ open, onClose, only = null }: Props) {
  const { announcements, loading, error, refresh } = useSiteAnnouncements()
  const list = only ? [only] : announcements

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="gh-dialog-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="gh-dialog gh-announce-dialog" role="dialog" aria-modal="true" aria-label="站点公告">
        <div className="gh-announce-dialog-head">
          <div>
            <p className="gh-announce-eyebrow">LineWeb · 站点公告</p>
            <h3 className="gh-dialog-title">公告</h3>
          </div>
          <button type="button" className="gh-announce-close" aria-label="关闭公告" onClick={onClose}>
            ×
          </button>
        </div>

        {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}

        {loading && list.length === 0 ? (
          <div className="gh-announce-state">
            <div className="gh-spinner" />
            <span>正在加载公告…</span>
          </div>
        ) : list.length === 0 ? (
          <div className="gh-announce-state">
            <p>暂无站点公告</p>
            <button type="button" className="gh-btn gh-btn--secondary gh-btn--sm" onClick={() => void refresh()}>
              刷新
            </button>
          </div>
        ) : (
          <ul className="gh-announce-list">
            {list.map((announcement) => (
              <li key={announcement.id} className={`gh-announce-item gh-announce-item--${announcement.level}`}>
                <div className="gh-announce-item-head">
                  <span className={`gh-announce-tag gh-announce-tag--${announcement.level}`}>
                    {ANNOUNCEMENT_LEVEL_LABELS[announcement.level]}
                  </span>
                  {announcement.isPinned && <span className="gh-announce-pin">置顶</span>}
                  <strong className="gh-announce-item-title">{announcement.title}</strong>
                </div>
                <p className="gh-announce-item-content">{announcement.content}</p>
                <p className="gh-announce-item-meta">
                  {announcement.author?.username ? `${announcement.author.username} · ` : ''}
                  {formatTime(announcement.updatedAt || announcement.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
