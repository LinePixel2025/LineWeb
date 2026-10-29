import { useCallback, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useSiteAnnouncements } from '../contexts/SiteAnnouncementContext'
import {
  ANNOUNCEMENT_LEVEL_LABELS,
  type SiteAnnouncement,
} from '../types/announcement'

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

/**
 * 新公告确认门卫：管理员首次发布且勾选「需要确认」的公告，会在用户进入站点时
 * 弹出不可关闭的确认框，点「我已知晓」后写入服务端确认记录，之后不再弹出。
 * 与顶部公告条的关闭记忆相互独立（未确认时横幅也强制保留）。
 */
export default function SiteAnnouncementAckGate() {
  const { pendingAck, acknowledge } = useSiteAnnouncements()
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const location = useLocation()

  const acknowledgeOne = useCallback(async (announcement: SiteAnnouncement) => {
    setBusyId(announcement.id)
    setError('')
    try {
      await acknowledge(announcement)
    } catch (err) {
      setError(err instanceof Error ? err.message : '确认失败，请稍后再试')
    } finally {
      setBusyId(null)
    }
  }, [acknowledge])

  if (location.pathname.startsWith('/admin')) return null
  if (pendingAck.length === 0) return null

  return (
    <div className="gh-dialog-overlay gh-announce-ack-overlay" role="presentation">
      <div
        className="gh-dialog gh-announce-dialog gh-announce-ack-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label="站点公告确认"
      >
        <div className="gh-announce-dialog-head">
          <div>
            <p className="gh-announce-eyebrow">LineWeb · 站点公告</p>
            <h3 className="gh-dialog-title">请确认阅读</h3>
          </div>
        </div>
        <p className="gh-announce-ack-hint">
          管理员发布了{pendingAck.length > 1 ? `${pendingAck.length} 条需要确认的` : '一条'}公告，点击「我已知晓」后不再弹出。
        </p>
        {error && <div className="gh-alert gh-alert--danger" role="alert">{error}</div>}
        <ul className="gh-announce-list">
          {pendingAck.map((announcement) => (
            <li key={announcement.id} className={`gh-announce-item gh-announce-item--${announcement.level}`}>
              <div className="gh-announce-item-head">
                <span className={`gh-announce-tag gh-announce-tag--${announcement.level}`}>
                  {ANNOUNCEMENT_LEVEL_LABELS[announcement.level]}
                </span>
                {announcement.isPinned && <span className="gh-announce-pin">置顶</span>}
                <strong className="gh-announce-item-title">{announcement.title}</strong>
              </div>
              <p className="gh-announce-item-content">{announcement.content}</p>
              <div className="gh-announce-ack-foot">
                <span className="gh-announce-item-meta">
                  {announcement.author?.username ? `${announcement.author.username} · ` : ''}
                  {formatTime(announcement.updatedAt || announcement.createdAt)}
                </span>
                <button
                  type="button"
                  className="gh-btn gh-btn--primary gh-btn--sm"
                  disabled={busyId === announcement.id}
                  onClick={() => void acknowledgeOne(announcement)}
                >
                  {busyId === announcement.id ? '确认中…' : '我已知晓'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
