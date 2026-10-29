import { useCallback, useEffect, useState } from 'react'
import api from '../../lib/api'
import { GitHubAlert, GitHubButton } from '../../components/ui'
import {
  ANNOUNCEMENT_LEVEL_LABELS,
  type AnnouncementLevel,
  type SiteAnnouncement,
} from '../../types/announcement'

interface FormState {
  title: string
  content: string
  level: AnnouncementLevel
  isActive: boolean
  isPinned: boolean
}

const EMPTY_FORM: FormState = {
  title: '',
  content: '',
  level: 'info',
  isActive: true,
  isPinned: false,
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN')
}

/**
 * 站点公告管理（LineWeb 自有公告）
 *
 * 与聊天的 neko 群公告不同：这里是站点级广播，发布后全站顶部公告条与聊天页入口都会展示。
 */
export default function AnnouncementAdminPage() {
  const [announcements, setAnnouncements] = useState<SiteAnnouncement[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [editing, setEditing] = useState<SiteAnnouncement | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.get<{ announcements: SiteAnnouncement[] }>('/admin/announcements')
      setAnnouncements(Array.isArray(data?.announcements) ? data.announcements : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载公告失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
    setError('')
    setNotice('')
  }

  const openEdit = (announcement: SiteAnnouncement) => {
    setEditing(announcement)
    setForm({
      title: announcement.title,
      content: announcement.content,
      level: announcement.level,
      isActive: announcement.isActive,
      isPinned: announcement.isPinned,
    })
    setFormOpen(true)
    setError('')
    setNotice('')
  }

  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      setError('标题和内容不能为空')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      if (editing) {
        await api.put(`/admin/announcements/${editing.id}`, form)
        setNotice('公告已更新')
      } else {
        await api.post('/admin/announcements', form)
        setNotice('公告已发布')
      }
      setFormOpen(false)
      setEditing(null)
      setForm(EMPTY_FORM)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存公告失败')
    } finally {
      setSaving(false)
    }
  }

  const quickUpdate = async (announcement: SiteAnnouncement, patch: Partial<FormState>) => {
    setBusyId(announcement.id)
    setError('')
    setNotice('')
    try {
      await api.put(`/admin/announcements/${announcement.id}`, patch)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新公告失败')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (announcement: SiteAnnouncement) => {
    if (!window.confirm(`确定删除公告「${announcement.title}」吗？此操作不可撤销。`)) return
    setBusyId(announcement.id)
    setError('')
    setNotice('')
    try {
      await api.delete(`/admin/announcements/${announcement.id}`)
      setNotice('公告已删除')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除公告失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="gh-page-container">
      <div className="gh-page-header">
        <div>
          <h1 className="gh-page-title">站点公告</h1>
          <p className="gh-page-subtitle">
            LineWeb 自有公告：发布后显示在全站顶部公告条与聊天页「站点公告」入口，与 neko 群公告相互独立。
          </p>
        </div>
        <div className="gh-announce-admin-actions">
          <GitHubButton variant="secondary" size="md" onClick={() => void load()}>
            刷新
          </GitHubButton>
          <GitHubButton variant="primary" size="md" onClick={openCreate}>
            发布公告
          </GitHubButton>
        </div>
      </div>

      {error && <GitHubAlert variant="danger">{error}</GitHubAlert>}
      {notice && <GitHubAlert variant="success">{notice}</GitHubAlert>}

      {formOpen && (
        <section className="gh-box gh-announce-editor" aria-label="公告编辑器">
          <div className="gh-announce-editor-head">
            <h2 className="gh-announce-editor-title">{editing ? '编辑公告' : '发布新公告'}</h2>
            <button
              type="button"
              className="gh-announce-close"
              aria-label="关闭编辑器"
              onClick={() => setFormOpen(false)}
            >
              ×
            </button>
          </div>
          <label className="gh-form-field">
            <span>标题</span>
            <input
              className="gh-input"
              maxLength={80}
              value={form.title}
              placeholder="例如：本周六凌晨系统维护"
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              disabled={saving}
            />
          </label>
          <label className="gh-form-field">
            <span>内容</span>
            <textarea
              className="gh-input gh-announce-editor-content"
              rows={5}
              maxLength={5000}
              value={form.content}
              placeholder="公告正文（支持换行）"
              onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
              disabled={saving}
            />
            <span className="gh-text-tertiary gh-announce-editor-count">{form.content.length}/5000</span>
          </label>
          <div className="gh-announce-editor-row">
            <label className="gh-form-field gh-announce-level-field">
              <span>类型</span>
              <select
                className="gh-input"
                value={form.level}
                onChange={(event) => setForm((prev) => ({ ...prev, level: event.target.value as AnnouncementLevel }))}
                disabled={saving}
              >
                {(Object.keys(ANNOUNCEMENT_LEVEL_LABELS) as AnnouncementLevel[]).map((level) => (
                  <option key={level} value={level}>{ANNOUNCEMENT_LEVEL_LABELS[level]}</option>
                ))}
              </select>
            </label>
            <label className="gh-check">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
                disabled={saving}
              />
              立即生效
            </label>
            <label className="gh-check">
              <input
                type="checkbox"
                checked={form.isPinned}
                onChange={(event) => setForm((prev) => ({ ...prev, isPinned: event.target.checked }))}
                disabled={saving}
              />
              置顶
            </label>
          </div>
          <div className="gh-dialog-actions">
            <GitHubButton variant="secondary" size="md" disabled={saving} onClick={() => setFormOpen(false)}>
              取消
            </GitHubButton>
            <GitHubButton variant="primary" size="md" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : editing ? '保存修改' : '发布公告'}
            </GitHubButton>
          </div>
        </section>
      )}

      {loading ? (
        <div className="gh-announce-state">
          <div className="gh-spinner" />
          <span>正在加载公告…</span>
        </div>
      ) : announcements.length === 0 ? (
        <div className="gh-box gh-announce-empty">
          <p className="gh-announce-empty-title">还没有站点公告</p>
          <p className="gh-text-tertiary">点「发布公告」创建第一条公告。</p>
        </div>
      ) : (
        <ul className="gh-announce-admin-list">
          {announcements.map((announcement) => (
            <li key={announcement.id} className={`gh-box gh-announce-admin-item gh-announce-admin-item--${announcement.level}`}>
              <div className="gh-announce-admin-item-head">
                <span className={`gh-announce-tag gh-announce-tag--${announcement.level}`}>
                  {ANNOUNCEMENT_LEVEL_LABELS[announcement.level]}
                </span>
                {announcement.isPinned && <span className="gh-announce-pin">置顶</span>}
                <strong className="gh-announce-admin-title">{announcement.title}</strong>
                {!announcement.isActive && <span className="gh-announce-off">未生效</span>}
                <span className="gh-announce-admin-time">{formatTime(announcement.updatedAt)}</span>
              </div>
              <p className="gh-announce-admin-content">{announcement.content}</p>
              <div className="gh-announce-admin-foot">
                <span className="gh-announce-admin-author">
                  {announcement.author?.username || '未知作者'}
                </span>
                <div className="gh-announce-admin-buttons">
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busyId === announcement.id}
                    onClick={() => void quickUpdate(announcement, { isActive: !announcement.isActive })}
                  >
                    {announcement.isActive ? '下线' : '发布'}
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busyId === announcement.id}
                    onClick={() => void quickUpdate(announcement, { isPinned: !announcement.isPinned })}
                  >
                    {announcement.isPinned ? '取消置顶' : '置顶'}
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--secondary gh-btn--sm"
                    disabled={busyId === announcement.id}
                    onClick={() => openEdit(announcement)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="gh-btn gh-btn--danger gh-btn--sm"
                    disabled={busyId === announcement.id}
                    onClick={() => void remove(announcement)}
                  >
                    删除
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
